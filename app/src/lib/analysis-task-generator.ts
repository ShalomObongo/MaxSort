import { getDatabase, DatabaseManager, FileRecord } from './database';
import { getAgentManager, AgentManager } from '../agents/agent-manager';
import { logger, AnalysisError, AnalysisErrorType } from './logger';
import { FileAnalysisTask, TaskPriority, CreateTaskParams } from '../agents/task-types';
import { v4 as uuidv4 } from 'uuid';
import * as path from 'path';

/**
 * Configuration for analysis task generation
 */
export interface AnalysisTaskGeneratorConfig {
  batchSize: number;                    // Files to process per batch
  interactivePriority: TaskPriority;   // Priority for user-triggered analysis
  batchPriority: TaskPriority;         // Priority for background batch analysis
  defaultTimeoutMs: number;            // Default timeout per file analysis
  maxConcurrentTasks: number;          // Maximum concurrent analysis tasks
  supportedExtensions: string[];       // File extensions to analyze
}

/**
 * Analysis task generation request parameters
 */
export interface GenerateTasksRequest {
  fileIds?: number[];                  // Specific file IDs to analyze (interactive mode)
  rootPath?: string;                   // Root path for batch analysis
  analysisType: 'rename-suggestions' | 'classification' | 'content-summary';
  isInteractive: boolean;              // User-triggered vs background analysis
  modelName: string;                   // Ollama model to use for analysis
}

/**
 * Task generation result
 */
export interface TaskGenerationResult {
  tasksCreated: number;
  taskIds: string[];
  estimatedDuration: number;           // Estimated completion time in seconds
  totalFiles: number;
  skippedFiles: number;               // Files skipped due to unsupported types
}

/**
 * File analysis task generator that creates per-file analyze tasks from scanned file metadata
 */
export class AnalysisTaskGenerator {
  private config: AnalysisTaskGeneratorConfig;
  private database = getDatabase();
  private agentManager: AgentManager;

  private static readonly DEFAULT_CONFIG: AnalysisTaskGeneratorConfig = {
    batchSize: 50,                              // Process 50 files per batch
    interactivePriority: TaskPriority.HIGH,    // High priority for user requests
    batchPriority: TaskPriority.NORMAL,        // Normal priority for batch processing
    defaultTimeoutMs: 30000,                   // 30 second timeout per file
    maxConcurrentTasks: 10,                    // Max 10 concurrent analysis tasks
    supportedExtensions: [
      // Documents
      '.txt', '.md', '.doc', '.docx', '.pdf', '.rtf', '.odt',
      // Images
      '.jpg', '.jpeg', '.png', '.gif', '.bmp', '.svg', '.webp', '.tiff',
      // Media
      '.mp4', '.avi', '.mov', '.mkv', '.wmv', '.mp3', '.wav', '.flac',
      // Code
      '.js', '.ts', '.py', '.java', '.cpp', '.c', '.cs', '.php', '.rb', '.go',
      // Data
      '.json', '.xml', '.csv', '.yaml', '.yml', '.sql',
      // Archives
      '.zip', '.rar', '.7z', '.tar', '.gz',
    ],
  };

  constructor(config: Partial<AnalysisTaskGeneratorConfig> = {}) {
    this.config = { ...AnalysisTaskGenerator.DEFAULT_CONFIG, ...config };
    this.agentManager = getAgentManager();
  }

  /**
   * Generate analysis tasks for specified files or root path
   */
  public async generateTasks(request: GenerateTasksRequest): Promise<TaskGenerationResult> {
    const timerId = logger.startPerformanceTimer('AnalysisTaskGenerator.generateTasks');
    
    logger.info('AnalysisTaskGenerator', `Starting task generation`, {
      analysisType: request.analysisType,
      isInteractive: request.isInteractive,
      fileIds: request.fileIds?.length || 0,
      rootPath: request.rootPath,
      modelName: request.modelName
    });

    try {
      let filesToAnalyze: FileRecord[] = [];
      
      // Get files to analyze based on request type
      if (request.fileIds && request.fileIds.length > 0) {
        logger.info('AnalysisTaskGenerator', 'Interactive mode: analyzing specific files', {
          fileCount: request.fileIds.length
        });
        filesToAnalyze = await this.getFilesByIds(request.fileIds);
      } else if (request.rootPath) {
        logger.info('AnalysisTaskGenerator', 'Batch mode: analyzing all files in path', {
          rootPath: request.rootPath
        });
        filesToAnalyze = await this.getFilesByRootPath(request.rootPath);
      } else {
        const error = new AnalysisError(
          AnalysisErrorType.VALIDATION_ERROR,
          'Either fileIds or rootPath must be specified',
          { stage: 'task-generation', recoverable: false }
        );
        logger.error('AnalysisTaskGenerator', 'Invalid task generation request', error);
        throw error;
      }

      if (filesToAnalyze.length === 0) {
        logger.warn('AnalysisTaskGenerator', 'No files found to analyze', {
          fileIds: request.fileIds,
          rootPath: request.rootPath
        });
      }

      // Filter files by supported extensions
      const supportedFiles = filesToAnalyze.filter(file => {
        const isSupported = this.isSupportedFileType(file.fileExtension || '');
        if (!isSupported) {
          logger.debug('AnalysisTaskGenerator', `Skipping unsupported file type`, {
            fileName: file.fileName,
            extension: file.fileExtension,
            filePath: file.path
          });
        }
        return isSupported;
      });

      const skippedFiles = filesToAnalyze.length - supportedFiles.length;
      
      logger.info('AnalysisTaskGenerator', `File filtering complete`, {
        totalFiles: filesToAnalyze.length,
        supportedFiles: supportedFiles.length,
        skippedFiles: skippedFiles
      });
      
      if (supportedFiles.length === 0) {
        logger.warn('AnalysisTaskGenerator', 'No supported files found for analysis');
        return {
          tasksCreated: 0,
          taskIds: [],
          estimatedDuration: 0,
          totalFiles: filesToAnalyze.length,
          skippedFiles,
        };
      }

      // Create tasks with appropriate priority
      const priority = request.isInteractive 
        ? this.config.interactivePriority 
        : this.config.batchPriority;

      const taskIds: string[] = [];
      let tasksCreated = 0;
      let taskErrors = 0;

      logger.info('AnalysisTaskGenerator', `Starting batch task creation`, {
        batchSize: this.config.batchSize,
        supportedFilesCount: supportedFiles.length,
        priority
      });

      // Process files in batches to avoid overwhelming the task queue
      for (let i = 0; i < supportedFiles.length; i += this.config.batchSize) {
        const batch = supportedFiles.slice(i, i + this.config.batchSize);
        
        for (const file of batch) {
          try {
            const taskId = await this.createFileAnalysisTask(file, request, priority);
            taskIds.push(taskId);
            tasksCreated++;
            
            logger.debug('AnalysisTaskGenerator', `Created task for file`, {
              fileName: file.fileName,
              taskId: taskId
            });
          } catch (error) {
            taskErrors++;
            logger.error('AnalysisTaskGenerator', `Failed to create analysis task for file`, error as Error, {
              fileName: file.fileName,
              filePath: file.path,
              fileExtension: file.fileExtension
            });
            // Continue with other files
          }
        }

        // Add small delay between batches to prevent overwhelming
        if (i + this.config.batchSize < supportedFiles.length) {
          await this.sleep(100);
        }
      }

      // Calculate estimated duration
      const estimatedDurationPerFile = this.config.defaultTimeoutMs / 1000; // Convert to seconds
      const estimatedDuration = Math.ceil(
        (tasksCreated * estimatedDurationPerFile) / this.config.maxConcurrentTasks
      );

      logger.info('AnalysisTaskGenerator', `Task generation completed`, {
        tasksCreated,
        taskErrors,
        totalFiles: filesToAnalyze.length,
        supportedFiles: supportedFiles.length,
        skippedFiles,
        estimatedDuration
      });

      return {
        tasksCreated,
        taskIds,
        estimatedDuration,
        totalFiles: filesToAnalyze.length,
        skippedFiles,
      };
      
    } catch (error) {
      const analysisError = error instanceof AnalysisError 
        ? error 
        : new AnalysisError(
            AnalysisErrorType.UNKNOWN_ERROR,
            `Task generation failed: ${(error as Error).message}`,
            {
              stage: 'task-generation',
              recoverable: true,
              cause: error as Error
            }
          );
      
      logger.error('AnalysisTaskGenerator', 'Task generation failed', analysisError, {
        analysisType: request.analysisType,
        isInteractive: request.isInteractive,
        fileCount: request.fileIds?.length || 0
      });
      
      throw analysisError;
    } finally {
      logger.endPerformanceTimer(timerId, 'AnalysisTaskGenerator', 'generateTasks');
    }
  }

  /**
   * Create analysis task for a specific file
   */
  private async createFileAnalysisTask(
    file: FileRecord,
    request: GenerateTasksRequest,
    priority: TaskPriority
  ): Promise<string> {
    // Build analysis-specific prompt template based on type
    const promptTemplate = this.buildPromptTemplate(file, request.analysisType);

    // Estimate memory requirements based on file size and model
    const estimatedMemoryMB = this.estimateMemoryRequirements(file, request.modelName);

    // Create task parameters
    const taskParams: CreateTaskParams<FileAnalysisTask> = {
      type: 'file-analysis',
      priority,
      filePath: file.path,
      modelName: request.modelName,
      analysisType: this.mapToAnalysisType(request.analysisType),
      promptTemplate,
      expectedResponseFormat: 'json', // Always expect JSON for structured responses
      timeoutMs: this.calculateTaskTimeout(file),
      maxRetries: 2,
      metadata: {
        fileId: file.id,
        fileName: file.fileName,
        fileExtension: file.fileExtension,
        fileSize: file.size,
        analysisRequest: request.analysisType,
        isInteractive: request.isInteractive,
        requestId: uuidv4(), // Track related analysis requests
      },
      estimatedMemoryMB,
    };

    // Create task via Agent Manager
    const taskId = this.agentManager.createTask(taskParams);

    // Store task relationship in database for tracking
    await this.recordTaskCreation(taskId, file.id!, request);

    return taskId;
  }

  /**
   * Build analysis-specific prompt template
   */
  private buildPromptTemplate(file: FileRecord, analysisType: string): string {
    const fileName = file.fileName || path.basename(file.path);
    const fileExtension = file.fileExtension || '';
    const fileSizeKB = Math.round(file.size / 1024);
    
    const baseContext = `File: ${fileName}\nExtension: ${fileExtension}\nSize: ${fileSizeKB}KB\nPath: ${file.relativePathFromRoot || file.path}`;

    switch (analysisType) {
      case 'rename-suggestions':
        return `Analyze the following file and suggest a better, more descriptive filename.

${baseContext}

Based on the file information above, provide exactly 3 filename suggestions that are:
1. More descriptive and meaningful than the current name
2. Follow good filename conventions (no spaces, clear structure)
3. Maintain the original file extension
4. Are appropriate for the file type and context

Respond in JSON format:
{
  "suggestions": [
    {
      "filename": "suggested-name-1${fileExtension}",
      "confidence": 85,
      "reasoning": "Clear explanation of why this name is better"
    },
    {
      "filename": "suggested-name-2${fileExtension}",
      "confidence": 75,
      "reasoning": "Clear explanation of why this name is better"
    },
    {
      "filename": "suggested-name-3${fileExtension}",
      "confidence": 60,
      "reasoning": "Clear explanation of why this name is better"
    }
  ],
  "originalName": "${fileName}",
  "analysisNotes": "Additional insights about the file naming patterns or suggestions"
}`;

      case 'classification':
        return `Classify the following file into appropriate categories.

${baseContext}

Analyze the file and classify it into relevant categories. Consider:
- File type and format
- Likely content or purpose
- Organization context
- Priority level

Respond in JSON format:
{
  "primaryCategory": "documents|media|code|data|archive|other",
  "secondaryCategories": ["subcategory1", "subcategory2"],
  "contentType": "Description of likely content",
  "priority": "high|medium|low",
  "confidence": 85,
  "reasoning": "Explanation of classification decisions"
}`;

      case 'content-summary':
        return `Provide a concise summary of the file's purpose and content.

${baseContext}

Based on the file information, provide a summary that includes:
- What this file likely contains
- Its probable purpose or use case
- Any notable characteristics

Respond in JSON format:
{
  "summary": "Concise description of file content and purpose",
  "keyPoints": ["point1", "point2", "point3"],
  "fileType": "Specific type description",
  "confidence": 80,
  "reasoning": "Basis for the summary and analysis"
}`;

      default:
        throw new Error(`Unknown analysis type: ${analysisType}`);
    }
  }

  /**
   * Map request analysis type to task analysis type
   */
  private mapToAnalysisType(analysisType: string): 'classification' | 'summary' | 'extraction' {
    switch (analysisType) {
      case 'rename-suggestions':
      case 'classification':
        return 'classification';
      case 'content-summary':
        return 'summary';
      default:
        return 'extraction';
    }
  }

  /**
   * Calculate timeout based on file characteristics
   */
  private calculateTaskTimeout(file: FileRecord): number {
    const basePadding = this.config.defaultTimeoutMs;
    
    // Add extra time for larger files
    const sizeFactor = Math.min(file.size / (1024 * 1024), 10); // Max 10x multiplier for very large files
    const sizeAdjustment = sizeFactor * 5000; // 5 seconds per MB up to 50 seconds
    
    // Add extra time for complex file types
    const extension = file.fileExtension?.toLowerCase() || '';
    let complexityMultiplier = 1.0;
    
    if (['.pdf', '.doc', '.docx', '.ppt', '.pptx'].includes(extension)) {
      complexityMultiplier = 1.5; // Documents may need more processing
    } else if (['.mp4', '.avi', '.mov', '.mkv'].includes(extension)) {
      complexityMultiplier = 1.2; // Media files
    } else if (['.zip', '.rar', '.7z', '.tar'].includes(extension)) {
      complexityMultiplier = 1.3; // Archives
    }

    return Math.ceil((basePadding + sizeAdjustment) * complexityMultiplier);
  }

  /**
   * Estimate memory requirements for task
   */
  private estimateMemoryRequirements(file: FileRecord, modelName: string): number {
    // Base model memory (will be refined by Agent Manager)
    let baseMemoryMB = 2048; // 2GB default

    // Adjust based on file size
    const fileSizeMB = file.size / (1024 * 1024);
    const fileMemoryOverhead = Math.min(fileSizeMB * 0.1, 512); // Max 512MB overhead

    // Adjust based on model name (rough estimates)
    if (modelName.includes('7b')) {
      baseMemoryMB = 4096; // 4GB for 7B models
    } else if (modelName.includes('13b')) {
      baseMemoryMB = 6144; // 6GB for 13B models
    } else if (modelName.includes('70b')) {
      baseMemoryMB = 12288; // 12GB for 70B models
    }

    return Math.ceil(baseMemoryMB + fileMemoryOverhead);
  }

  /**
   * Check if file type is supported for analysis
   */
  private isSupportedFileType(extension: string): boolean {
    return this.config.supportedExtensions.includes(extension.toLowerCase());
  }

  /**
   * Get files by database IDs
   */
  private async getFilesByIds(fileIds: number[]): Promise<FileRecord[]> {
    const files: FileRecord[] = [];
    
    for (const id of fileIds) {
      const stmt = this.database.transaction((db) => 
        db.prepare('SELECT * FROM files WHERE id = ?').get(id)
      );
      
      const file = stmt as FileRecord | undefined;
      if (file) {
        files.push(file);
      }
    }
    
    return files;
  }

  /**
   * Get files by root path
   */
  private async getFilesByRootPath(rootPath: string): Promise<FileRecord[]> {
    return this.database.getFilesByRootPath(rootPath);
  }

  /**
   * Record task creation in database for tracking
   */
  private async recordTaskCreation(taskId: string, fileId: number, request: GenerateTasksRequest): Promise<void> {
    // This would extend the agent_tasks table with additional metadata
    // For now, we rely on the Agent Manager's built-in task tracking
    console.log(`Task ${taskId} created for file ID ${fileId} (type: ${request.analysisType})`);
  }

  /**
   * Utility sleep function
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get current configuration
   */
  public getConfig(): AnalysisTaskGeneratorConfig {
    return { ...this.config };
  }

  /**
   * Update configuration
   */
  public updateConfig(updates: Partial<AnalysisTaskGeneratorConfig>): void {
    this.config = { ...this.config, ...updates };
    console.log('Analysis task generator configuration updated');
  }
}

// Singleton instance
let generatorInstance: AnalysisTaskGenerator | null = null;

export function getAnalysisTaskGenerator(config?: Partial<AnalysisTaskGeneratorConfig>): AnalysisTaskGenerator {
  if (!generatorInstance) {
    generatorInstance = new AnalysisTaskGenerator(config);
  }
  return generatorInstance;
}

export function destroyAnalysisTaskGenerator(): void {
  generatorInstance = null;
}
