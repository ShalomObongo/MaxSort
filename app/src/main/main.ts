import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import * as path from 'path';
import * as fs from 'fs/promises';
import { createScannerWorker, type ScanOptions, type WorkerMessage, type FileMetadata } from '../workers/file-scanner';
import { getDatabase, type FileRecord } from '../lib/database-mock';
import { getOllamaClient, type OllamaModel, type OllamaHealthStatus } from '../lib/ollama-client';
import { Worker } from 'worker_threads';

let mainWindow: BrowserWindow | null = null;
let currentScanWorker: Worker | null = null;

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

app.on('window-all-closed', () => {
  // Cleanup worker if running
  if (currentScanWorker) {
    currentScanWorker.terminate();
    currentScanWorker = null;
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

// Initialize Ollama health monitoring
app.whenReady().then(() => {
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
});
