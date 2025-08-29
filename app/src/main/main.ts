import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import * as path from 'path';
import * as fs from 'fs/promises';
import { createScannerWorker, type ScanOptions, type WorkerMessage, type FileMetadata } from '../workers/file-scanner';
import { getDatabase, type FileRecord } from '../lib/database';
import { getOllamaClient, type OllamaModel, type OllamaHealthStatus } from '../lib/ollama-client';
import { getAgentManager, type AgentManagerStatus } from '../agents/agent-manager';
import { TaskPriority, type CreateTaskParams, type FileAnalysisTask, type BatchProcessingTask, type HealthCheckTask } from '../agents/task-types';
import { Worker } from 'worker_threads';
import { logger } from '../lib/logger';
import { BatchOperationManager } from '../lib/batch-operation-manager';
import { FileOperationPreviewService } from '../lib/file-operation-preview';
import { TransactionalFileManager } from '../lib/transactional-file-manager';
import { OperationJournal } from '../lib/operation-journal';

let mainWindow: BrowserWindow | null = null;
let currentScanWorker: Worker | null = null;
let agentManager: ReturnType<typeof getAgentManager> | null = null;
let batchOperationManager: BatchOperationManager | null = null;
let fileOperationPreview: FileOperationPreviewService | null = null;
let transactionalFileManager: TransactionalFileManager | null = null;
let operationJournal: OperationJournal | null = null;

const createWindow = (): void => {
  // Create the browser window
  mainWindow = new BrowserWindow({
    height: 900,
    width: 1200,
    minHeight: 600,
    minWidth: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, '../preload/preload.js')
    },
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 20, y: 20 },
    show: false,
    resizable: true
  });

  // Load the renderer
  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  // Show window when ready
  mainWindow.once('ready-to-show', () => {
    if (mainWindow) {
      mainWindow.show();
    }
  });

  // Handle window closed
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
};

// App event handlers
app.whenReady().then(async () => {
  // Initialize database
  const db = getDatabase();
  await db.initialize();
  
  createWindow();

  app.on('activate', () => {
    // On macOS, re-create window when dock icon is clicked
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', async () => {
  // Cleanup worker if running
  if (currentScanWorker) {
    currentScanWorker.terminate();
    currentScanWorker = null;
  }
  
  // Cleanup Agent Manager
  if (agentManager) {
    logger.info('MainProcess', 'Shutting down Agent Manager...');
    await agentManager.stop();
    agentManager = null;
  }
  
  // Close database
  const db = getDatabase();
  db.close();
  
  // On macOS, keep app running even when all windows are closed
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Basic IPC channel structure for future use
ipcMain.handle('app:version', () => {
  return app.getVersion();
});

ipcMain.handle('app:platform', () => {
  return process.platform;
});

// Placeholder for future agent communication channels
ipcMain.handle('agent:status', () => {
  return { status: 'ready', agents: [] };
});

// Directory selection with security validation
ipcMain.handle('directory:select', async () => {
  if (!mainWindow) {
    throw new Error('Main window not available');
  }

  try {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory'],
      title: 'Select Directory to Organize',
      buttonLabel: 'Select Directory'
    });

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }

    const selectedPath = result.filePaths[0];
    
    // Security validation: Ensure path is absolute and valid
    if (!path.isAbsolute(selectedPath)) {
      throw new Error('Selected path must be absolute');
    }

    // Verify the directory exists and is accessible
    try {
      const stat = await fs.stat(selectedPath);
      if (!stat.isDirectory()) {
        throw new Error('Selected path is not a directory');
      }
    } catch (error) {
      throw new Error('Directory is not accessible');
    }

    return selectedPath;
  } catch (error) {
    console.error('Directory selection error:', error);
    throw error;
  }
});

// Directory scanning with progress reporting
ipcMain.handle('directory:scan', async (_event, options: { rootPath: string; include?: string[]; exclude?: string[] }) => {
  if (!mainWindow) {
    throw new Error('Main window not available');
  }

  // Security validation
  if (!options.rootPath || typeof options.rootPath !== 'string') {
    throw new Error('Invalid root path provided');
  }

  if (!path.isAbsolute(options.rootPath)) {
    throw new Error('Root path must be absolute');
  }

  // Verify directory exists and is accessible
  try {
    const stat = await fs.stat(options.rootPath);
    if (!stat.isDirectory()) {
      throw new Error('Root path is not a directory');
    }
  } catch (error) {
    throw new Error('Directory is not accessible');
  }

  // Clean up any existing worker
  if (currentScanWorker) {
    currentScanWorker.terminate();
    currentScanWorker = null;
  }

  console.log('Starting directory scan:', options);
  
  const db = getDatabase();
  let jobId: number | null = null;

  try {
    // Create job record
    jobId = db.createJob({
      rootPath: options.rootPath,
      status: 'scanning',
      fileCount: 0,
      createdAt: Math.floor(Date.now() / 1000),
      updatedAt: Math.floor(Date.now() / 1000)
    });

    // Create and start the scanner worker
    const scanOptions: ScanOptions = {
      rootPath: options.rootPath,
      include: options.include,
      exclude: options.exclude
    };

    currentScanWorker = createScannerWorker(scanOptions);
    let fileCount = 0;
    const processedFiles: string[] = [];

    currentScanWorker.on('message', (message: WorkerMessage) => {
      try {
        switch (message.type) {
          case 'progress':
            // Forward progress to renderer
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('scan:progress', message.data);
            }
            break;

          case 'file':
            // Store file metadata in database
            const fileData = message.data as FileMetadata;
            const fileRecord: FileRecord = {
              path: fileData.path,
              sha256: fileData.sha256,
              size: fileData.size,
              mtime: fileData.mtime,
              lastScannedAt: fileData.lastScannedAt,
              relativePathFromRoot: fileData.relativePathFromRoot,
              fileName: fileData.fileName,
              fileExtension: fileData.fileExtension,
              parentDirectory: fileData.parentDirectory
            };
            
            db.upsertFile(fileRecord);
            fileCount++;
            processedFiles.push(fileData.path);
            
            // Update job file count periodically
            if (fileCount % 50 === 0 && jobId) {
              db.updateJob(jobId, { fileCount, updatedAt: Math.floor(Date.now() / 1000) });
            }
            break;

          case 'complete':
            console.log(`Scan completed: ${fileCount} files processed`);
            
            // Clean up files that no longer exist
            const cleanedUp = db.cleanupMissingFiles(options.rootPath, processedFiles);
            console.log(`Cleaned up ${cleanedUp} missing files`);
            
            // Update job status
            if (jobId) {
              db.updateJob(jobId, {
                status: 'complete',
                fileCount,
                updatedAt: Math.floor(Date.now() / 1000)
              });
            }
            
            // Cleanup worker
            currentScanWorker = null;
            break;

          case 'error':
            const error = message.data as Error;
            console.error('Scanner error:', error);
            
            // Update job with error
            if (jobId) {
              db.updateJob(jobId, {
                status: 'error',
                errorMessage: error.message,
                updatedAt: Math.floor(Date.now() / 1000)
              });
            }
            
            // Send error to renderer
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('scan:error', error.message);
            }
            
            // Cleanup worker
            currentScanWorker = null;
            break;
        }
      } catch (dbError) {
        console.error('Database error during scan:', dbError);
        // Continue processing other messages
      }
    });

    currentScanWorker.on('error', (error) => {
      console.error('Worker error:', error);
      if (jobId) {
        db.updateJob(jobId, {
          status: 'error',
          errorMessage: error.message,
          updatedAt: Math.floor(Date.now() / 1000)
        });
      }
      currentScanWorker = null;
    });

    currentScanWorker.on('exit', (code) => {
      console.log(`Worker exited with code ${code}`);
      currentScanWorker = null;
    });

  } catch (error) {
    console.error('Failed to start scan:', error);
    if (jobId) {
      db.updateJob(jobId, {
        status: 'error',
        errorMessage: error instanceof Error ? error.message : String(error),
        updatedAt: Math.floor(Date.now() / 1000)
      });
    }
    throw error;
  }

  return Promise.resolve();
});

// Get scan results from database
ipcMain.handle('directory:getScanResults', async (_event, rootPath?: string) => {
  try {
    const db = getDatabase();
    
    if (rootPath) {
      // Get files for specific directory
      return db.getFilesByRootPath(rootPath);
    } else {
      // Get all files by getting stats and then files for each job
      const recentJobs = db.getRecentJobs(1);
      if (recentJobs.length > 0) {
        return db.getFilesByRootPath(recentJobs[0].rootPath);
      }
      return [];
    }
  } catch (error) {
    console.error('Failed to get scan results:', error);
    throw error;
  }
});

// Get scan jobs (for showing scan history)
ipcMain.handle('directory:getScanJobs', async () => {
  try {
    const db = getDatabase();
    return db.getRecentJobs(10);
  } catch (error) {
    console.error('Failed to get scan jobs:', error);
    throw error;
  }
});

// Ollama IPC handlers
ipcMain.handle('ollama:getHealth', async () => {
  try {
    const ollamaClient = getOllamaClient();
    const health = await ollamaClient.getHealthStatus();
    return health;
  } catch (error) {
    console.error('Failed to get Ollama health:', error);
    return {
      status: 'unhealthy',
      message: error instanceof Error ? error.message : String(error),
      models_available: false,
      model_count: 0
    } as OllamaHealthStatus;
  }
});

ipcMain.handle('ollama:getModels', async () => {
  try {
    const ollamaClient = getOllamaClient();
    const models = await ollamaClient.getModels();
    
    // Store memory estimates in database
    const db = getDatabase();
    const estimates = db.getModelMemoryEstimates();
    const newEstimates = { ...estimates };
    
    for (const model of models) {
      if (!estimates[model.name]) {
        newEstimates[model.name] = ollamaClient.estimateModelMemory(model);
      }
    }
    
    if (Object.keys(newEstimates).length > Object.keys(estimates).length) {
      db.setModelMemoryEstimates(newEstimates);
    }
    
    return models;
  } catch (error) {
    console.error('Failed to get Ollama models:', error);
    throw error;
  }
});

ipcMain.handle('ollama:validateModel', async (_event, modelName: string) => {
  try {
    const ollamaClient = getOllamaClient();
    return await ollamaClient.validateModel(modelName);
  } catch (error) {
    console.error(`Failed to validate model ${modelName}:`, error);
    return false;
  }
});

ipcMain.handle('ollama:getMemoryEstimate', async (_event, model: OllamaModel) => {
  try {
    const ollamaClient = getOllamaClient();
    const estimatedMemory = ollamaClient.estimateModelMemory(model);
    
    return {
      modelName: model.name,
      estimatedMemory,
      safetyFactor: 1.5
    };
  } catch (error) {
    console.error(`Failed to get memory estimate for ${model.name}:`, error);
    // Fallback estimate
    return {
      modelName: model.name,
      estimatedMemory: model.size * 1.5,
      safetyFactor: 1.5
    };
  }
});

ipcMain.handle('ollama:savePreferences', async (_event, preferences: { mainModel: string | null; subModel: string | null }) => {
  try {
    const db = getDatabase();
    db.setModelPreferences(preferences.mainModel, preferences.subModel);
    console.log('Model preferences saved:', preferences);
  } catch (error) {
    console.error('Failed to save model preferences:', error);
    throw error;
  }
});

ipcMain.handle('ollama:getPreferences', async () => {
  try {
    const db = getDatabase();
    return db.getModelPreferences();
  } catch (error) {
    console.error('Failed to get model preferences:', error);
    return { mainModel: null, subModel: null, endpoint: 'http://localhost:11434' };
  }
});

// Initialize Ollama health monitoring and Agent Manager
app.whenReady().then(async () => {
  const ollamaClient = getOllamaClient();
  
  // Start health monitoring
  ollamaClient.startHealthMonitoring(30000); // Check every 30 seconds
  
  // Forward health updates to renderer
  ollamaClient.on('health-update', (health: OllamaHealthStatus) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('ollama:healthUpdate', health);
    }
  });
  
  ollamaClient.on('health-error', (error: Error) => {
    console.error('Ollama health monitoring error:', error);
  });

  // Initialize Agent Manager
  try {
    agentManager = getAgentManager({
      maxConcurrentSlots: 4, // Conservative limit for initial deployment
      safetyFactor: 1.5,
      osReservedMemory: 2 * 1024 * 1024 * 1024, // 2GB
      taskTimeoutMs: 5 * 60 * 1000, // 5 minutes
    });

    // Start Agent Manager
    await agentManager.start();
    
    // Initialize Batch Operation Services
    const database = getDatabase();
    batchOperationManager = new BatchOperationManager(database, logger);
    fileOperationPreview = new FileOperationPreviewService(database, logger);
    transactionalFileManager = new TransactionalFileManager(database, logger);
    operationJournal = new OperationJournal(database, logger);
    
    // Forward batch operation events to renderer
    batchOperationManager.on('batch-started', (data) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('batch:started', data);
      }
    });
    
    batchOperationManager.on('batch-progress', (data) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('batch:progress', data);
      }
    });
    
    batchOperationManager.on('batch-completed', (data) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('batch:completed', data);
      }
    });
    
    batchOperationManager.on('batch-failed', (data) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('batch:failed', data);
      }
    });
    
    // Forward agent events to renderer
    agentManager.on('manager-started', () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('agent:managerStarted');
      }
    });

    agentManager.on('system-health', (health) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('agent:systemHealth', health);
      }
    });

    agentManager.on('task-completed', (result) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('agent:taskCompleted', result);
      }
    });

    agentManager.on('task-failed', (result) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('agent:taskFailed', result);
      }
    });

    agentManager.on('slots-recomputed', (info) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('agent:slotsRecomputed', info);
      }
    });

    agentManager.on('emergency-stop', (info) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('agent:emergencyStop', info);
      }
    });

    console.log('Agent Manager initialized and started');
    
  } catch (error) {
    console.error('Failed to initialize Agent Manager:', error);
  }
});

// Agent Manager IPC handlers
ipcMain.handle('agent:getStatus', async (): Promise<AgentManagerStatus> => {
  if (!agentManager) {
    throw new Error('Agent Manager not initialized');
  }
  return agentManager.getStatus();
});

ipcMain.handle('agent:createFileAnalysisTask', async (_event, params: {
  filePath: string;
  modelName: string;
  analysisType: 'classification' | 'summary' | 'extraction';
  priority?: TaskPriority;
  timeoutMs?: number;
  promptTemplate?: string;
}): Promise<string> => {
  if (!agentManager) {
    throw new Error('Agent Manager not initialized');
  }

  const taskParams: CreateTaskParams<FileAnalysisTask> = {
    type: 'file-analysis',
    filePath: params.filePath,
    modelName: params.modelName,
    analysisType: params.analysisType,
    promptTemplate: params.promptTemplate || 'Analyze the following content: {{content}}',
    expectedResponseFormat: params.analysisType === 'classification' ? 'json' : 'text',
    priority: params.priority || TaskPriority.NORMAL,
    timeoutMs: params.timeoutMs || 300000, // 5 minutes default
    maxRetries: 3,
    metadata: {
      source: 'ui-request',
      requestedAt: Date.now(),
    },
    estimatedMemoryMB: 0, // Will be calculated by AgentManager
  };

  return agentManager.createTask(taskParams);
});

ipcMain.handle('agent:createBatchProcessingTask', async (_event, params: {
  filePaths: string[];
  modelName: string;
  batchSize?: number;
  priority?: TaskPriority;
  timeoutMs?: number;
  processingMode?: 'parallel' | 'sequential';
}): Promise<string> => {
  if (!agentManager) {
    throw new Error('Agent Manager not initialized');
  }

  const taskParams: CreateTaskParams<BatchProcessingTask> = {
    type: 'batch-processing',
    filePaths: params.filePaths,
    modelName: params.modelName,
    batchSize: params.batchSize || 10,
    processingMode: params.processingMode || 'sequential',
    priority: params.priority || TaskPriority.NORMAL,
    timeoutMs: params.timeoutMs || 600000, // 10 minutes for batch
    maxRetries: 2,
    metadata: {
      source: 'batch-request',
      requestedAt: Date.now(),
      totalFiles: params.filePaths.length,
    },
    estimatedMemoryMB: 0,
  };

  return agentManager.createTask(taskParams);
});

ipcMain.handle('agent:createHealthCheckTask', async (_event, params: {
  component: 'ollama' | 'database' | 'filesystem';
  priority?: TaskPriority;
}): Promise<string> => {
  if (!agentManager) {
    throw new Error('Agent Manager not initialized');
  }

  const taskParams: CreateTaskParams<HealthCheckTask> = {
    type: 'health-check',
    component: params.component,
    checkInterval: 30000, // 30 seconds
    priority: params.priority || TaskPriority.HIGH,
    timeoutMs: 30000,
    maxRetries: 1,
    metadata: {
      source: 'health-monitoring',
      requestedAt: Date.now(),
    },
    estimatedMemoryMB: 100, // Minimal memory for health checks
  };

  return agentManager.createTask(taskParams);
});

ipcMain.handle('agent:cancelTask', async (_event, taskId: string, reason?: string): Promise<boolean> => {
  if (!agentManager) {
    throw new Error('Agent Manager not initialized');
  }
  return agentManager.cancelTask(taskId, reason || 'User requested cancellation');
});

ipcMain.handle('agent:getQueueStats', async () => {
  if (!agentManager) {
    throw new Error('Agent Manager not initialized');
  }
  return agentManager.getStatus();
});

ipcMain.handle('agent:pauseProcessing', async (): Promise<void> => {
  if (!agentManager) {
    throw new Error('Agent Manager not initialized');
  }
  
  // Update configuration to stop accepting new tasks
  agentManager.updateConfig({ maxConcurrentSlots: 0 });
  console.log('Agent processing paused');
});

ipcMain.handle('agent:resumeProcessing', async (): Promise<void> => {
  if (!agentManager) {
    throw new Error('Agent Manager not initialized');
  }
  
  // Restore normal slot capacity
  agentManager.updateConfig({ maxConcurrentSlots: 4 });
  console.log('Agent processing resumed');
});

ipcMain.handle('agent:emergencyStop', async (_event, reason?: string): Promise<void> => {
  if (!agentManager) {
    throw new Error('Agent Manager not initialized');
  }
  
  // Get all running tasks and cancel them
  const status = agentManager.getStatus();
  console.log(`Emergency stop requested: ${reason || 'User initiated'}`);
  
  // This would trigger internal emergency stop procedures
  agentManager.updateConfig({ maxConcurrentSlots: 0 });
  
  // Force recompute with minimal capacity
  await agentManager.recomputeSlotCapacity();
});

ipcMain.handle('agent:getPerformanceMetrics', async () => {
  if (!agentManager) {
    throw new Error('Agent Manager not initialized');
  }
  
  // This would return comprehensive performance metrics
  return {
    uptime: Date.now(), // Simplified for now
    totalTasksProcessed: 0,
    averageExecutionTime: 0,
    successRate: 1.0,
    memoryUtilization: 0,
    systemHealth: agentManager.getStatus().systemHealth,
  };
});

// ========================
// File Analysis IPC Endpoints
// ========================

/**
 * Start file analysis for selected files or directory
 */
ipcMain.handle('analysis:start', async (_event, request: {
  requestId: string;
  fileIds?: number[];
  rootPath?: string;
  analysisTypes: string[];
  isInteractive: boolean;
  priority: 'high' | 'normal' | 'low';
  modelName?: string;
}) => {
  try {
    const { getFileAnalysisService } = await import('../lib/file-analysis-service');
    const analysisService = getFileAnalysisService();
    
    await analysisService.initialize();
    
    // Cast analysis types to proper enum values
    const analysisRequest = {
      ...request,
      analysisTypes: request.analysisTypes as ('rename-suggestions' | 'classification' | 'content-summary' | 'metadata-extraction')[],
    };
    
    const requestId = await analysisService.startAnalysis(analysisRequest);
    
    console.log(`Analysis started: ${requestId}`);
    return { success: true, requestId };
    
  } catch (error) {
    console.error('Failed to start analysis:', error);
    return { 
      success: false, 
      error: error instanceof Error ? error.message : String(error) 
    };
  }
});

/**
 * Cancel active analysis
 */
ipcMain.handle('analysis:cancel', async (_event, requestId: string, reason?: string) => {
  try {
    const { getFileAnalysisService } = await import('../lib/file-analysis-service');
    const analysisService = getFileAnalysisService();
    
    const success = await analysisService.cancelAnalysis(requestId, reason);
    
    console.log(`Analysis ${requestId} ${success ? 'cancelled' : 'not found'}`);
    return { success };
    
  } catch (error) {
    console.error('Failed to cancel analysis:', error);
    return { 
      success: false, 
      error: error instanceof Error ? error.message : String(error) 
    };
  }
});

/**
 * Get analysis progress for a request
 */
ipcMain.handle('analysis:getProgress', async (_event, requestId: string) => {
  try {
    const { getFileAnalysisService } = await import('../lib/file-analysis-service');
    const analysisService = getFileAnalysisService();
    
    const progress = analysisService.getAnalysisProgress(requestId);
    return { success: true, progress };
    
  } catch (error) {
    console.error('Failed to get analysis progress:', error);
    return { 
      success: false, 
      error: error instanceof Error ? error.message : String(error) 
    };
  }
});

/**
 * Get analysis results for a request
 */
ipcMain.handle('analysis:getResults', async (_event, requestId: string) => {
  try {
    const { getFileAnalysisService } = await import('../lib/file-analysis-service');
    const analysisService = getFileAnalysisService();
    
    const results = analysisService.getAnalysisResults(requestId);
    return { success: true, results };
    
  } catch (error) {
    console.error('Failed to get analysis results:', error);
    return { 
      success: false, 
      error: error instanceof Error ? error.message : String(error) 
    };
  }
});

/**
 * Get suggestions from database for specific files
 */
ipcMain.handle('suggestions:getByFileIds', async (_event, fileIds: number[], analysisType?: string) => {
  try {
    const database = getDatabase();
    
    const suggestions = database.getTopSuggestions(fileIds, analysisType || 'rename-suggestions', 5);
    return { success: true, suggestions };
    
  } catch (error) {
    console.error('Failed to get suggestions:', error);
    return { 
      success: false, 
      error: error instanceof Error ? error.message : String(error) 
    };
  }
});

/**
 * Update suggestion recommendation status
 */
ipcMain.handle('suggestions:updateRecommendation', async (_event, suggestionId: number, isRecommended: boolean) => {
  try {
    const database = getDatabase();
    
    database.updateSuggestionRecommendation(suggestionId, isRecommended);
    return { success: true };
    
  } catch (error) {
    console.error('Failed to update suggestion:', error);
    return { 
      success: false, 
      error: error instanceof Error ? error.message : String(error) 
    };
  }
});

/**
 * Get analysis session history
 */
ipcMain.handle('analysis:getSessionHistory', async (_event, limit?: number) => {
  try {
    const database = getDatabase();
    
    const sessions = database.getRecentAnalysisSessions(limit || 10);
    return { success: true, sessions };
    
  } catch (error) {
    console.error('Failed to get session history:', error);
    return { 
      success: false, 
      error: error instanceof Error ? error.message : String(error) 
    };
  }
});

/**
 * Get model performance metrics
 */
ipcMain.handle('analysis:getModelMetrics', async (_event, modelName?: string, analysisType?: string) => {
  try {
    const database = getDatabase();
    
    const metrics = database.getModelMetrics(modelName, analysisType);
    return { success: true, metrics };
    
  } catch (error) {
    console.error('Failed to get model metrics:', error);
    return { 
      success: false, 
      error: error instanceof Error ? error.message : String(error) 
    };
  }
});

// ========================
// Batch Operations IPC Endpoints
// ========================

/**
 * Generate preview for batch operations
 */
ipcMain.handle('batch:preview', async (_event, operations: Array<{
  type: 'rename' | 'move';
  sourcePath: string;
  targetPath: string;
  fileId: number;
  suggestionId?: number;
}>) => {
  try {
    if (!fileOperationPreview) {
      throw new Error('File Operation Preview Service not initialized');
    }

    // Generate a temporary batch ID for preview
    const batchId = `preview-${Date.now()}`;
    
    // Transform operations to expected format
    const previewOps = operations.map((op, index) => ({
      operationId: `${batchId}-${index}`,
      type: op.type as 'rename' | 'move' | 'delete',
      fileId: op.fileId,
      targetPath: op.targetPath,
      confidence: 0.8 // Default confidence
    }));

    const preview = await fileOperationPreview.generateBatchPreview(batchId, previewOps);
    return { success: true, preview };

  } catch (error) {
    console.error('Failed to generate batch preview:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
});

/**
 * Execute batch operations
 */
ipcMain.handle('batch:execute', async (_event, operations: Array<{
  type: 'rename' | 'move';
  sourcePath: string;
  targetPath: string;
  fileId: number;
  suggestionId?: number;
}>, options?: {
  priority?: 'high' | 'medium' | 'low';
  continueOnError?: boolean;
  createBackups?: boolean;
}) => {
  try {
    if (!batchOperationManager) {
      throw new Error('Batch Operation Manager not initialized');
    }

    // First add all operations to the queue
    const operationIds: string[] = [];
    for (const op of operations) {
      const opId = batchOperationManager.addOperation({
        type: op.type,
        fileId: op.fileId,
        originalPath: op.sourcePath,
        targetPath: op.targetPath,
        confidence: 0.8, // Default confidence
        priority: options?.priority || 'medium'
      });
      operationIds.push(opId);
    }

    // Create a batch with these operations
    const batchId = batchOperationManager.createBatch(operationIds, 'interactive');

    // Start processing if not already running
    await batchOperationManager.startProcessing();
    
    return { success: true, batchId };

  } catch (error) {
    console.error('Failed to execute batch operations:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
});

/**
 * Get progress of batch operation
 */
ipcMain.handle('batch:getProgress', async (_event, batchId: string) => {
  try {
    if (!batchOperationManager) {
      throw new Error('Batch Operation Manager not initialized');
    }

    const batch = batchOperationManager.getBatchStatus(batchId);
    if (!batch) {
      return { success: false, error: 'Batch not found' };
    }

    const progress = {
      batchId,
      status: batch.status,
      totalOperations: batch.operations.length,
      completedOperations: batch.operations.filter(op => op.status === 'completed').length,
      failedOperations: batch.operations.filter(op => op.status === 'failed').length,
      startedAt: batch.createdAt,
      operations: batch.operations
    };

    return { success: true, progress };

  } catch (error) {
    console.error('Failed to get batch progress:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
});

/**
 * Cancel batch operation
 */
ipcMain.handle('batch:cancel', async (_event, batchId: string, reason?: string) => {
  try {
    if (!batchOperationManager) {
      throw new Error('Batch Operation Manager not initialized');
    }

    const success = await batchOperationManager.cancelBatch(batchId);
    if (success && reason) {
      console.log(`Batch ${batchId} cancelled: ${reason}`);
    }
    return { success };

  } catch (error) {
    console.error('Failed to cancel batch operation:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
});

/**
 * Undo operation from operation journal
 */
ipcMain.handle('operation:undo', async (_event, operationId: string) => {
  try {
    if (!operationJournal) {
      throw new Error('Operation Journal not initialized');
    }

    if (!operationId) {
      return { success: false, error: 'Operation ID is required' };
    }

    const result = await operationJournal.undoOperation(operationId);
    return { success: true, result };

  } catch (error) {
    console.error('Failed to undo operation:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
});

/**
 * Get operation history from journal
 */
ipcMain.handle('operation:getHistory', async (_event, options?: {
  limit?: number;
  offset?: number;
  transactionId?: string;
  batchId?: string;
}) => {
  try {
    if (!operationJournal) {
      throw new Error('Operation Journal not initialized');
    }

    const history = await operationJournal.getOperationHistory(options);
    return { success: true, history };

  } catch (error) {
    console.error('Failed to get operation history:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
});

/**
 * Get current queue status for batch operations
 */
ipcMain.handle('batch:getQueueStatus', async () => {
  try {
    if (!batchOperationManager) {
      throw new Error('Batch Operation Manager not initialized');
    }

    const status = batchOperationManager.getQueueStats();
    return { success: true, status };

  } catch (error) {
    console.error('Failed to get queue status:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
});

/**
 * Validate batch operations before execution
 */
ipcMain.handle('batch:validate', async (_event, operations: Array<{
  type: 'rename' | 'move';
  sourcePath: string;
  targetPath: string;
  fileId: number;
  suggestionId?: number;
}>) => {
  try {
    if (!batchOperationManager) {
      throw new Error('Batch Operation Manager not initialized');
    }

    // Convert to BatchOperation format for validation
    const batchOperations = operations.map((op, index) => ({
      id: `validation-${Date.now()}-${index}`,
      type: op.type as 'rename' | 'move' | 'delete',
      fileId: op.fileId,
      originalPath: op.sourcePath,
      targetPath: op.targetPath,
      confidence: 0.8,
      priority: 'medium' as 'high' | 'medium' | 'low',
      status: 'pending' as 'pending' | 'processing' | 'completed' | 'failed',
      createdAt: Date.now()
    }));

    const validationResult = await batchOperationManager.validateBatch(batchOperations);
    return { success: true, validationResult };

  } catch (error) {
    console.error('Failed to validate batch operations:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
});

// Initialize File Analysis Service and setup event forwarding
let fileAnalysisServiceInitialized = false;

const initializeAnalysisService = async () => {
  if (fileAnalysisServiceInitialized) return;
  
  try {
    const { getFileAnalysisService } = await import('../lib/file-analysis-service');
    const analysisService = getFileAnalysisService();
    
    // Setup event forwarding to renderer
    analysisService.on('analysis-started', (data) => {
      if (mainWindow) {
        mainWindow.webContents.send('analysis:started', data);
      }
    });
    
    analysisService.on('preview-update', (data) => {
      if (mainWindow) {
        mainWindow.webContents.send('analysis:previewUpdate', data);
      }
    });
    
    analysisService.on('progress-update', (progress) => {
      if (mainWindow) {
        mainWindow.webContents.send('analysis:progressUpdate', progress);
      }
    });
    
    analysisService.on('analysis-complete', (result) => {
      if (mainWindow) {
        mainWindow.webContents.send('analysis:complete', result);
      }
    });
    
    analysisService.on('analysis-cancelled', (data) => {
      if (mainWindow) {
        mainWindow.webContents.send('analysis:cancelled', data);
      }
    });
    
    analysisService.on('analysis-error', (data) => {
      if (mainWindow) {
        mainWindow.webContents.send('analysis:error', data);
      }
    });
    
    analysisService.on('emergency-mode', (data) => {
      if (mainWindow) {
        mainWindow.webContents.send('analysis:emergencyMode', data);
      }
    });
    
    analysisService.on('tasks-generated', (data) => {
      if (mainWindow) {
        mainWindow.webContents.send('analysis:tasksGenerated', data);
      }
    });
    
    fileAnalysisServiceInitialized = true;
    console.log('File Analysis Service event forwarding initialized');
    
  } catch (error) {
    console.error('Failed to initialize File Analysis Service:', error);
  }
};

// Initialize when app is ready
app.whenReady().then(async () => {
  await initializeAnalysisService();
});
