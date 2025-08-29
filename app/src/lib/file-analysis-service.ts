import { EventEmitter } from 'events';
import { AgentManager, getAgentManager } from '../agents/agent-manager';
import { getAnalysisTaskGenerator, AnalysisTaskGenerator, GenerateTasksRequest, TaskGenerationResult } from './analysis-task-generator';
import { PromptTemplateManager, FileContext, AnalysisType, PromptOptions } from '../agents/prompt-templates';
import { getDatabase, DatabaseManager, FileRecord } from './database';
import { TaskResult, TaskState } from '../agents/task-types';
import { logger, AnalysisError, AnalysisErrorType } from './logger';

/**
 * File analysis service configuration
 */
export interface FileAnalysisServiceConfig {
  maxConcurrentAnalysis: number;          // Maximum concurrent analysis operations
  defaultTimeoutMs: number;               // Default timeout for analysis operations
  retryAttempts: number;                  // Number of retry attempts for failed analyses
  batchProcessingSize: number;            // Files per batch for background processing
  progressUpdateInterval: number;         // Interval for progress updates (ms)
  errorThreshold: number;                 // Max consecutive errors before stopping
  analysisModels: {                       // Model preferences by analysis type
    rename: string;
    classification: string;
    summary: string;
    metadata: string;
  };
}

/**
 * Analysis request parameters
 */
export interface AnalysisRequest {
  requestId: string;
  fileIds?: number[];                     // Specific files to analyze
  rootPath?: string;                      // Root path for batch analysis
  analysisTypes: AnalysisType[];          // Types of analysis to perform
  isInteractive: boolean;                 // User-triggered vs background
  priority: 'high' | 'normal' | 'low';   // Analysis priority
  modelName?: string;                     // Override default model
  options?: Partial<PromptOptions>;       // Custom prompt options
}

/**
 * Analysis progress information
 */
export interface AnalysisProgress {
  requestId: string;
  totalFiles: number;
  processedFiles: number;
  completedFiles: number;
  failedFiles: number;
  currentFile?: string;
  currentAnalysisType?: AnalysisType;
  estimatedTimeRemaining: number;         // Seconds
  phase: 'initializing' | 'analyzing' | 'completing' | 'complete' | 'error';
  errorRate: number;                      // Percentage of failed analyses
}

/**
 * Analysis result for a single file
 */
export interface FileAnalysisResult {
  fileId: number;
  fileName: string;
  filePath: string;
  analysisType: AnalysisType;
  success: boolean;
  result?: any;                           // Parsed analysis result
  confidence?: number;                    // Analysis confidence score (0-100)
  reasoning?: string;                     // AI reasoning explanation
  error?: string;                         // Error message if failed
  executionTimeMs: number;
  modelUsed: string;
  timestamp: number;
}

/**
 * Complete analysis session result
 */
export interface AnalysisSessionResult {
  requestId: string;
  totalFiles: number;
  successfulFiles: number;
  failedFiles: number;
  results: FileAnalysisResult[];
  totalExecutionTime: number;
  averageExecutionTime: number;
  completedAt: number;
  errorSummary?: string[];
}

/**
 * File Analysis Service - coordinates AI analysis tasks with proper error handling and monitoring
 */
export class FileAnalysisService extends EventEmitter {
  private config: FileAnalysisServiceConfig;
  private agentManager: AgentManager;
  private taskGenerator: AnalysisTaskGenerator;
  private database: DatabaseManager;
  
  // Active analysis tracking
  private activeAnalyses: Map<string, AnalysisProgress> = new Map();
  private analysisResults: Map<string, FileAnalysisResult[]> = new Map();
  private taskToRequestMap: Map<string, string> = new Map();
  
  // Error tracking and recovery
  private consecutiveErrors: number = 0;
  private lastErrorTime: number = 0;
  private isEmergencyMode: boolean = false;
  
  // Performance monitoring
  private performanceMetrics = {
    totalAnalyses: 0,
    successfulAnalyses: 0,
    failedAnalyses: 0,
    averageExecutionTime: 0,
    totalExecutionTime: 0,
  };

  private static readonly DEFAULT_CONFIG: FileAnalysisServiceConfig = {
    maxConcurrentAnalysis: 5,
    defaultTimeoutMs: 45000,              // 45 seconds per file
    retryAttempts: 2,
    batchProcessingSize: 25,
    progressUpdateInterval: 2000,         // 2 seconds
    errorThreshold: 10,                   // Max 10 consecutive errors
    analysisModels: {
      rename: 'llama2',                   // Default models, will be updated from database
      classification: 'llama2',
      summary: 'llama2', 
      metadata: 'llama2',
    },
  };

  constructor(config: Partial<FileAnalysisServiceConfig> = {}) {
    super();
    
    this.config = { ...FileAnalysisService.DEFAULT_CONFIG, ...config };
    this.agentManager = getAgentManager();
    this.taskGenerator = getAnalysisTaskGenerator();
    this.database = getDatabase();
    
    this.setupEventListeners();
    this.loadModelPreferences();
  }

  /**
   * Initialize the analysis service
   */
  public async initialize(): Promise<void> {
    const timerId = logger.startPerformanceTimer('FileAnalysisService.initialize');
    
    try {
      logger.info('FileAnalysisService', 'Initializing file analysis service...');
      
      // Ensure Agent Manager is running
      if (!this.agentManager.getStatus().isRunning) {
        logger.info('FileAnalysisService', 'Starting Agent Manager...');
        await this.agentManager.start();
      }
      
      logger.info('FileAnalysisService', 'File Analysis Service initialized successfully');
      this.emit('service-ready');
      
    } catch (error) {
      const analysisError = AnalysisError.fromError(
        error as Error, 
        AnalysisErrorType.AI_MODEL_UNAVAILABLE
      );
      
      logger.critical('FileAnalysisService', 'Failed to initialize File Analysis Service', analysisError, {
        agentManagerStatus: this.agentManager.getStatus()
      });
      
      throw analysisError;
    } finally {
      logger.endPerformanceTimer(timerId, 'FileAnalysisService', 'initialize', true);
    }
  }

  /**
   * Start analysis for files or directory
   */
  public async startAnalysis(request: AnalysisRequest): Promise<string> {
    const timerId = logger.startPerformanceTimer('FileAnalysisService.startAnalysis');
    
    logger.info('FileAnalysisService', `Starting analysis request ${request.requestId}`, {
      requestId: request.requestId,
      isInteractive: request.isInteractive,
      fileCount: request.fileIds?.length || 0,
      analysisTypes: request.analysisTypes,
      modelName: request.modelName
    });
    
    try {
      // Validate request
      this.validateAnalysisRequest(request);
      
      // Check if system is in emergency mode
      if (this.isEmergencyMode) {
        const error = new AnalysisError(
          AnalysisErrorType.AI_MODEL_UNAVAILABLE,
          'Analysis service is in emergency mode due to repeated failures',
          { recoverable: false }
        );
        logger.error('FileAnalysisService', 'Rejecting analysis request - emergency mode active', error);
        throw error;
      }
      
      // Initialize progress tracking
      const progress: AnalysisProgress = {
        requestId: request.requestId,
        totalFiles: 0,
        processedFiles: 0,
        completedFiles: 0,
        failedFiles: 0,
        estimatedTimeRemaining: 0,
        phase: 'initializing',
        errorRate: 0,
      };
      
      this.activeAnalyses.set(request.requestId, progress);
      this.analysisResults.set(request.requestId, []);
      
      this.emit('analysis-started', { requestId: request.requestId, progress });
      
      // Process each analysis type
      for (const analysisType of request.analysisTypes) {
        await this.processAnalysisType(request, analysisType);
      }
      
      // Update progress phase
      progress.phase = 'analyzing';
      this.emit('progress-update', progress);
      
      logger.info('FileAnalysisService', `Analysis request ${request.requestId} started successfully`, {
        requestId: request.requestId,
        totalFiles: progress.totalFiles,
        analysisTypes: request.analysisTypes
      });
      
      return request.requestId;
      
    } catch (error) {
      // Clean up on error
      this.activeAnalyses.delete(request.requestId);
      this.analysisResults.delete(request.requestId);
      
      const analysisError = error instanceof AnalysisError 
        ? error 
        : AnalysisError.fromError(error as Error);
      
      logger.error('FileAnalysisService', `Analysis request ${request.requestId} failed`, analysisError, {
        requestId: request.requestId,
        errorType: analysisError.type,
        recoverable: analysisError.recoverable
      });
      
      this.handleAnalysisError(request.requestId, analysisError);
      throw analysisError;
    } finally {
      logger.endPerformanceTimer(timerId, 'FileAnalysisService', 'startAnalysis', true);
    }
  }

  /**
   * Cancel an active analysis
   */
  public async cancelAnalysis(requestId: string, reason: string = 'User cancelled'): Promise<boolean> {
    const progress = this.activeAnalyses.get(requestId);
    if (!progress) {
      return false;
    }
    
    console.log(`Cancelling analysis ${requestId}: ${reason}`);
    
    // Cancel all related tasks in Agent Manager
    const relatedTaskIds = Array.from(this.taskToRequestMap.entries())
      .filter(([_, reqId]) => reqId === requestId)
      .map(([taskId, _]) => taskId);
    
    for (const taskId of relatedTaskIds) {
      await this.agentManager.cancelTask(taskId, reason);
      this.taskToRequestMap.delete(taskId);
    }
    
    // Update progress and clean up
    progress.phase = 'error';
    this.emit('analysis-cancelled', { requestId, reason });
    
    this.activeAnalyses.delete(requestId);
    this.analysisResults.delete(requestId);
    
    return true;
  }

  /**
   * Get analysis progress
   */
  public getAnalysisProgress(requestId: string): AnalysisProgress | null {
    return this.activeAnalyses.get(requestId) || null;
  }

  /**
   * Get analysis results
   */
  public getAnalysisResults(requestId: string): FileAnalysisResult[] {
    return this.analysisResults.get(requestId) || [];
  }

  /**
   * Get service performance metrics
   */
  public getPerformanceMetrics(): typeof this.performanceMetrics {
    return { ...this.performanceMetrics };
  }

  /**
   * Process a specific analysis type for the request
   */
  private async processAnalysisType(request: AnalysisRequest, analysisType: AnalysisType): Promise<void> {
    const timerId = logger.startPerformanceTimer('FileAnalysisService.processAnalysisType');
    
    try {
      const modelName = request.modelName || this.getModelForAnalysisType(analysisType);
      
      logger.info('FileAnalysisService', `Processing analysis type: ${analysisType}`, {
        requestId: request.requestId,
        analysisType,
        modelName,
        fileCount: request.fileIds?.length || 0
      });
      
      // Create task generation request
      const taskRequest: GenerateTasksRequest = {
        fileIds: request.fileIds,
        rootPath: request.rootPath,
        analysisType: this.mapAnalysisTypeToTaskType(analysisType),
        isInteractive: request.isInteractive,
        modelName,
      };
      
      // Generate tasks through task generator
      const taskResult = await this.taskGenerator.generateTasks(taskRequest);
      
      if (taskResult.tasksCreated === 0) {
        logger.warn('FileAnalysisService', `No tasks created for analysis type: ${analysisType}`, {
          requestId: request.requestId,
          analysisType,
          fileIds: request.fileIds
        });
        return;
      }
      
      // Update progress with total file count
      const progress = this.activeAnalyses.get(request.requestId);
      if (!progress) {
        throw new AnalysisError(
          AnalysisErrorType.UNKNOWN_ERROR,
          `Progress tracking lost for request ${request.requestId}`,
          { stage: 'progress-tracking', recoverable: false }
        );
      }
      
      progress.totalFiles += taskResult.totalFiles;
      progress.estimatedTimeRemaining = Math.max(progress.estimatedTimeRemaining, taskResult.estimatedDuration);
      
      // Track task IDs for this request
      for (const taskId of taskResult.taskIds) {
        this.taskToRequestMap.set(taskId, request.requestId);
      }
      
      logger.info('FileAnalysisService', `Generated ${taskResult.tasksCreated} tasks for ${analysisType} analysis`, {
        requestId: request.requestId,
        analysisType,
        tasksCreated: taskResult.tasksCreated,
        totalFiles: taskResult.totalFiles,
        estimatedDuration: taskResult.estimatedDuration
      });
      
      this.emit('tasks-generated', { requestId: request.requestId, analysisType, taskResult });
      
    } catch (error) {
      const analysisError = error instanceof AnalysisError 
        ? error 
        : new AnalysisError(
            AnalysisErrorType.UNKNOWN_ERROR,
            `Failed to process analysis type ${analysisType}: ${(error as Error).message}`,
            {
              stage: 'task-generation',
              recoverable: true,
              cause: error as Error
            }
          );
      
      logger.error('FileAnalysisService', `Failed to process analysis type: ${analysisType}`, analysisError, {
        requestId: request.requestId,
        analysisType
      });
      
      throw analysisError;
    } finally {
      logger.endPerformanceTimer(timerId, 'FileAnalysisService', `processAnalysisType.${analysisType}`);
    }
  }

  /**
   * Setup event listeners for Agent Manager events
   */
  private setupEventListeners(): void {
    this.agentManager.on('task-completed', (result: TaskResult) => {
      this.handleTaskCompletion(result);
    });
    
    this.agentManager.on('task-failed', (result: TaskResult) => {
      this.handleTaskFailure(result);
    });
    
    this.agentManager.on('task-cancelled', ({ taskId, reason }) => {
      this.handleTaskCancellation(taskId, reason);
    });
    
    this.agentManager.on('emergency-stop', ({ reason }) => {
      this.handleEmergencyStop(reason);
    });
    
    // Setup progress update timer
    setInterval(() => {
      this.updateAllProgress();
    }, this.config.progressUpdateInterval);
  }

  /**
   * Handle successful task completion
   */
  private handleTaskCompletion(result: TaskResult): void {
    const requestId = this.taskToRequestMap.get(result.taskId);
    if (!requestId) {
      logger.warn('FileAnalysisService', `Received completion for unmapped task: ${result.taskId}`);
      return;
    }
    
    const progress = this.activeAnalyses.get(requestId);
    const results = this.analysisResults.get(requestId);
    
    if (!progress || !results) {
      logger.warn('FileAnalysisService', `Missing progress/results for request: ${requestId}`, {
        taskId: result.taskId,
        requestId,
        hasProgress: !!progress,
        hasResults: !!results
      });
      return;
    }
    
    const timerId = logger.startPerformanceTimer('FileAnalysisService.handleTaskCompletion');
    
    try {
      // Parse analysis result
      const fileResult = this.parseTaskResult(result);
      results.push(fileResult);
      
      // Update progress
      progress.completedFiles++;
      progress.processedFiles = progress.completedFiles + progress.failedFiles;
      progress.errorRate = progress.failedFiles / Math.max(progress.processedFiles, 1);
      
      // Update performance metrics
      this.performanceMetrics.totalAnalyses++;
      this.performanceMetrics.successfulAnalyses++;
      this.performanceMetrics.totalExecutionTime += result.executionTimeMs;
      this.performanceMetrics.averageExecutionTime = 
        this.performanceMetrics.totalExecutionTime / this.performanceMetrics.totalAnalyses;
      
      // Reset consecutive error count on success
      this.consecutiveErrors = 0;
      
      logger.info('FileAnalysisService', `Analysis completed successfully`, {
        taskId: result.taskId,
        requestId,
        fileName: fileResult.fileName,
        confidence: fileResult.confidence,
        executionTime: result.executionTimeMs,
        hasResult: !!fileResult.result
      });
      
      // Emit preview update for real-time UI updates
      this.emit('preview-update', {
        requestId,
        fileResult,
        progress: { ...progress },
      });
      
      // Check if analysis is complete
      if (progress.processedFiles >= progress.totalFiles) {
        this.completeAnalysis(requestId);
      }
      
    } catch (error) {
      const analysisError = new AnalysisError(
        AnalysisErrorType.VALIDATION_ERROR,
        `Failed to process task completion: ${(error as Error).message}`,
        {
          stage: 'result-processing',
          recoverable: true,
          cause: error as Error
        }
      );
      
      logger.error('FileAnalysisService', `Failed to process task completion for ${result.taskId}`, analysisError, {
        taskId: result.taskId,
        requestId,
        resultData: result
      });
      
      // Treat as task failure
      this.handleTaskFailure(result);
    } finally {
      logger.endPerformanceTimer(timerId, 'FileAnalysisService', 'handleTaskCompletion');
      // Clean up task mapping
      this.taskToRequestMap.delete(result.taskId);
    }
  }

  /**
   * Handle task failure
   */
  private handleTaskFailure(result: TaskResult): void {
    const requestId = this.taskToRequestMap.get(result.taskId);
    if (!requestId) {
      logger.warn('FileAnalysisService', `Received failure for unmapped task: ${result.taskId}`, {
        taskId: result.taskId,
        error: result.error?.message
      });
      return;
    }
    
    const progress = this.activeAnalyses.get(requestId);
    const results = this.analysisResults.get(requestId);
    
    if (!progress || !results) {
      logger.warn('FileAnalysisService', `Missing progress/results for failed request: ${requestId}`, {
        taskId: result.taskId,
        requestId,
        hasProgress: !!progress,
        hasResults: !!results
      });
      return;
    }
    
    const timerId = logger.startPerformanceTimer('FileAnalysisService.handleTaskFailure');
    
    try {
      // Categorize the error
      const errorType = result.error ? AnalysisError.detectErrorType(result.error) : AnalysisErrorType.UNKNOWN_ERROR;
      const isRecoverable = AnalysisError.isRecoverable(errorType);
      
      // Create failure result
      const fileResult: FileAnalysisResult = {
        fileId: 0, // Would need to extract from task metadata
        fileName: 'unknown', // Would extract from task metadata
        filePath: 'unknown', // Would extract from task metadata
        analysisType: 'rename-suggestions', // Would extract from task
        success: false,
        error: result.error?.message || 'Analysis failed',
        executionTimeMs: result.executionTimeMs,
        modelUsed: 'unknown', // Would extract from task metadata
        timestamp: Date.now(),
      };
      
      results.push(fileResult);
      
      // Update progress
      progress.failedFiles++;
      progress.processedFiles = progress.completedFiles + progress.failedFiles;
      progress.errorRate = (progress.failedFiles / Math.max(progress.processedFiles, 1)) * 100;
      
      // Update performance metrics
      this.performanceMetrics.totalAnalyses++;
      this.performanceMetrics.failedAnalyses++;
      
      // Track consecutive errors
      this.consecutiveErrors++;
      this.lastErrorTime = Date.now();
      
      logger.error('FileAnalysisService', `Analysis task failed`, result.error || new Error('Unknown task failure'), {
        taskId: result.taskId,
        requestId,
        errorType,
        isRecoverable,
        consecutiveErrors: this.consecutiveErrors,
        executionTime: result.executionTimeMs
      });
      
      // Check error threshold
      if (this.consecutiveErrors >= this.config.errorThreshold) {
        const reason = `Too many consecutive analysis failures (${this.consecutiveErrors}/${this.config.errorThreshold})`;
        logger.critical('FileAnalysisService', 'Entering emergency mode due to error threshold', undefined, {
          consecutiveErrors: this.consecutiveErrors,
          errorThreshold: this.config.errorThreshold,
          lastError: result.error?.message
        });
        this.enterEmergencyMode(reason);
        return;
      }
      
      // Emit error update
      this.emit('analysis-error', {
        requestId,
        error: result.error,
        errorType,
        isRecoverable,
        progress: { ...progress },
      });
      
      // Check if analysis is complete
      if (progress.processedFiles >= progress.totalFiles) {
        this.completeAnalysis(requestId);
      }
      
    } catch (error) {
      logger.critical('FileAnalysisService', `Critical error in failure handler for task ${result.taskId}`, error as Error, {
        taskId: result.taskId,
        requestId,
        originalError: result.error?.message
      });
    } finally {
      logger.endPerformanceTimer(timerId, 'FileAnalysisService', 'handleTaskFailure');
      // Clean up task mapping
      this.taskToRequestMap.delete(result.taskId);
    }
  }

  /**
   * Handle task cancellation
   */
  private handleTaskCancellation(taskId: string, reason: string): void {
    const requestId = this.taskToRequestMap.get(taskId);
    if (!requestId) return;
    
    console.log(`Task ${taskId} cancelled: ${reason}`);
    this.taskToRequestMap.delete(taskId);
  }

  /**
   * Parse task result into file analysis result
   */
  private parseTaskResult(result: TaskResult): FileAnalysisResult {
    // Extract metadata from task result
    const metadata = result.result || {};
    
    return {
      fileId: metadata.fileId || 0,
      fileName: metadata.fileName || 'unknown',
      filePath: metadata.filePath || 'unknown',
      analysisType: metadata.analysisRequest || 'rename-suggestions',
      success: result.success,
      result: metadata.analysis,
      confidence: metadata.confidence || 0,
      reasoning: metadata.reasoning,
      executionTimeMs: result.executionTimeMs,
      modelUsed: metadata.modelUsed || 'unknown',
      timestamp: Date.now(),
    };
  }

  /**
   * Complete analysis and emit final results
   */
  private completeAnalysis(requestId: string): void {
    const progress = this.activeAnalyses.get(requestId);
    const results = this.analysisResults.get(requestId);
    
    if (!progress || !results) return;
    
    progress.phase = 'complete';
    progress.estimatedTimeRemaining = 0;
    
    // Create session result
    const sessionResult: AnalysisSessionResult = {
      requestId,
      totalFiles: progress.totalFiles,
      successfulFiles: progress.completedFiles,
      failedFiles: progress.failedFiles,
      results: [...results],
      totalExecutionTime: results.reduce((sum, r) => sum + r.executionTimeMs, 0),
      averageExecutionTime: results.length > 0 
        ? results.reduce((sum, r) => sum + r.executionTimeMs, 0) / results.length 
        : 0,
      completedAt: Date.now(),
    };
    
    // Add error summary if there were failures
    if (progress.failedFiles > 0) {
      sessionResult.errorSummary = results
        .filter(r => !r.success && r.error)
        .map(r => r.error!)
        .slice(0, 10); // Limit to 10 error messages
    }
    
    console.log(`Analysis complete for ${requestId}: ${progress.completedFiles}/${progress.totalFiles} successful`);
    
    this.emit('analysis-complete', sessionResult);
    
    // Clean up
    this.activeAnalyses.delete(requestId);
    this.analysisResults.delete(requestId);
  }

  /**
   * Update progress for all active analyses
   */
  private updateAllProgress(): void {
    for (const [requestId, progress] of this.activeAnalyses) {
      if (progress.phase === 'analyzing') {
        // Update estimated time remaining
        if (progress.processedFiles > 0) {
          const remainingFiles = progress.totalFiles - progress.processedFiles;
          const averageTimePerFile = this.performanceMetrics.averageExecutionTime / 1000; // Convert to seconds
          progress.estimatedTimeRemaining = Math.ceil(remainingFiles * averageTimePerFile / this.config.maxConcurrentAnalysis);
        }
        
        this.emit('progress-update', { ...progress });
      }
    }
  }

  /**
   * Handle analysis error and recovery
   */
  private handleAnalysisError(requestId: string, error: Error): void {
    console.error(`Analysis error for ${requestId}:`, error);
    
    const progress = this.activeAnalyses.get(requestId);
    if (progress) {
      progress.phase = 'error';
      this.emit('analysis-error', { requestId, error, progress });
    }
  }

  /**
   * Enter emergency mode due to repeated failures
   */
  private enterEmergencyMode(reason: string): void {
    console.error(`Entering emergency mode: ${reason}`);
    this.isEmergencyMode = true;
    
    // Cancel all active analyses
    for (const requestId of this.activeAnalyses.keys()) {
      this.cancelAnalysis(requestId, `Emergency mode: ${reason}`);
    }
    
    this.emit('emergency-mode', { reason, consecutiveErrors: this.consecutiveErrors });
    
    // Auto-recovery after 5 minutes
    setTimeout(() => {
      this.exitEmergencyMode();
    }, 5 * 60 * 1000);
  }

  /**
   * Exit emergency mode
   */
  private exitEmergencyMode(): void {
    console.log('Exiting emergency mode');
    this.isEmergencyMode = false;
    this.consecutiveErrors = 0;
    this.emit('emergency-mode-exit');
  }

  /**
   * Handle Agent Manager emergency stop
   */
  private handleEmergencyStop(reason: string): void {
    console.error(`Agent Manager emergency stop: ${reason}`);
    
    // Cancel all analyses
    for (const requestId of this.activeAnalyses.keys()) {
      this.cancelAnalysis(requestId, `System emergency stop: ${reason}`);
    }
    
    this.enterEmergencyMode(`Agent Manager emergency: ${reason}`);
  }

  /**
   * Validate analysis request
   */
  private validateAnalysisRequest(request: AnalysisRequest): void {
    if (!request.requestId || request.requestId.trim() === '') {
      throw new Error('Request ID is required');
    }
    
    if (!request.fileIds && !request.rootPath) {
      throw new Error('Either fileIds or rootPath must be specified');
    }
    
    if (request.analysisTypes.length === 0) {
      throw new Error('At least one analysis type must be specified');
    }
    
    if (this.activeAnalyses.has(request.requestId)) {
      throw new Error(`Analysis with ID ${request.requestId} is already active`);
    }
  }

  /**
   * Get model for specific analysis type
   */
  private getModelForAnalysisType(analysisType: AnalysisType): string {
    switch (analysisType) {
      case 'rename-suggestions':
        return this.config.analysisModels.rename;
      case 'classification':
        return this.config.analysisModels.classification;
      case 'content-summary':
        return this.config.analysisModels.summary;
      case 'metadata-extraction':
        return this.config.analysisModels.metadata;
      default:
        return this.config.analysisModels.rename;
    }
  }

  /**
   * Map analysis type to task type
   */
  private mapAnalysisTypeToTaskType(analysisType: AnalysisType): 'rename-suggestions' | 'classification' | 'content-summary' {
    // Map to task generator analysis types
    switch (analysisType) {
      case 'rename-suggestions':
        return 'rename-suggestions';
      case 'classification':
        return 'classification';
      case 'content-summary':
        return 'content-summary';
      case 'metadata-extraction':
        return 'content-summary'; // Map metadata extraction to content summary
      default:
        return 'rename-suggestions';
    }
  }

  /**
   * Load model preferences from database
   */
  private async loadModelPreferences(): Promise<void> {
    try {
      const preferences = this.database.getModelPreferences();
      
      if (preferences.mainModel) {
        this.config.analysisModels.rename = preferences.mainModel;
        this.config.analysisModels.classification = preferences.mainModel;
      }
      
      if (preferences.subModel) {
        this.config.analysisModels.summary = preferences.subModel;
        this.config.analysisModels.metadata = preferences.subModel;
      }
      
    } catch (error) {
      console.error('Failed to load model preferences:', error);
      // Continue with defaults
    }
  }

  /**
   * Update configuration
   */
  public updateConfig(updates: Partial<FileAnalysisServiceConfig>): void {
    this.config = { ...this.config, ...updates };
    console.log('File Analysis Service configuration updated');
  }

  /**
   * Get current configuration
   */
  public getConfig(): FileAnalysisServiceConfig {
    return { ...this.config };
  }

  /**
   * Shutdown service gracefully
   */
  public async shutdown(): Promise<void> {
    console.log('Shutting down File Analysis Service');
    
    // Cancel all active analyses
    for (const requestId of this.activeAnalyses.keys()) {
      await this.cancelAnalysis(requestId, 'Service shutdown');
    }
    
    this.removeAllListeners();
  }
}

// Singleton instance
let serviceInstance: FileAnalysisService | null = null;

export function getFileAnalysisService(config?: Partial<FileAnalysisServiceConfig>): FileAnalysisService {
  if (!serviceInstance) {
    serviceInstance = new FileAnalysisService(config);
  }
  return serviceInstance;
}

export function destroyFileAnalysisService(): Promise<void> {
  if (serviceInstance) {
    const promise = serviceInstance.shutdown();
    serviceInstance = null;
    return promise;
  }
  return Promise.resolve();
}
