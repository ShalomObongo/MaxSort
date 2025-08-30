import { contextBridge, ipcRenderer } from 'electron';

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  // App information
  getVersion: () => ipcRenderer.invoke('app:version'),
  getPlatform: () => ipcRenderer.invoke('app:platform'),
  
  // Agent communication (for future use)
  getAgentStatus: () => ipcRenderer.invoke('agent:status'),
  
  // Window controls
  minimize: () => ipcRenderer.invoke('window:minimize'),
  maximize: () => ipcRenderer.invoke('window:maximize'),
  close: () => ipcRenderer.invoke('window:close'),

  // Directory operations with security validation
  selectDirectory: () => ipcRenderer.invoke('directory:select'),
  scanDirectory: (options: { rootPath: string; include?: string[]; exclude?: string[] }) => {
    // Basic path validation on renderer side
    if (!options.rootPath || typeof options.rootPath !== 'string') {
      throw new Error('Invalid directory path provided');
    }
    return ipcRenderer.invoke('directory:scan', options);
  },
  
  // Scan progress communication
  onScanProgress: (callback: (progress: { fileCount: number; currentFile: string; percent: number }) => void) => {
    const wrappedCallback = (_event: any, progress: any) => callback(progress);
    ipcRenderer.on('scan:progress', wrappedCallback);
    return () => ipcRenderer.removeListener('scan:progress', wrappedCallback);
  },
  
  removeScanProgressListener: () => {
    ipcRenderer.removeAllListeners('scan:progress');
  },

  // Get scan results
  getScanResults: (rootPath?: string) => ipcRenderer.invoke('directory:getScanResults', rootPath),
  
  // Get scan job history
  getScanJobs: () => ipcRenderer.invoke('directory:getScanJobs'),

  // Ollama model management
  getOllamaHealth: () => ipcRenderer.invoke('ollama:getHealth'),
  getAvailableModels: () => ipcRenderer.invoke('ollama:getModels'),
  validateModel: (modelName: string) => {
    if (!modelName || typeof modelName !== 'string') {
      throw new Error('Invalid model name provided');
    }
    return ipcRenderer.invoke('ollama:validateModel', modelName);
  },
  getModelMemoryEstimate: (model: any) => ipcRenderer.invoke('ollama:getMemoryEstimate', model),
  saveModelPreferences: (mainModel: string | null, subModel: string | null) => {
    return ipcRenderer.invoke('ollama:savePreferences', { mainModel, subModel });
  },
  getModelPreferences: () => ipcRenderer.invoke('ollama:getPreferences'),

  // Ollama health monitoring
  onOllamaHealthUpdate: (callback: (health: any) => void) => {
    const wrappedCallback = (_event: any, health: any) => callback(health);
    ipcRenderer.on('ollama:healthUpdate', wrappedCallback);
    return () => ipcRenderer.removeListener('ollama:healthUpdate', wrappedCallback);
  },

  // Analysis and suggestion management
  getSuggestionsByFileIds: (fileIds: number[], analysisType?: string) => {
    if (!Array.isArray(fileIds) || fileIds.some(id => typeof id !== 'number')) {
      throw new Error('Invalid file IDs provided');
    }
    return ipcRenderer.invoke('suggestions:getByFileIds', fileIds, analysisType);
  },

  updateSuggestionRecommendation: (suggestionId: number, isRecommended: boolean) => {
    if (typeof suggestionId !== 'number' || typeof isRecommended !== 'boolean') {
      throw new Error('Invalid parameters for suggestion update');
    }
    return ipcRenderer.invoke('suggestions:updateRecommendation', suggestionId, isRecommended);
  },

  startFileAnalysis: (fileIds: number[], analysisType: string, options?: any) => {
    if (!Array.isArray(fileIds) || typeof analysisType !== 'string') {
      throw new Error('Invalid parameters for analysis start');
    }
    return ipcRenderer.invoke('analysis:start', { fileIds, analysisType, ...options });
  },

  cancelFileAnalysis: (requestId: string) => {
    if (typeof requestId !== 'string') {
      throw new Error('Invalid request ID');
    }
    return ipcRenderer.invoke('analysis:cancel', requestId);
  },

  getAnalysisProgress: (requestId: string) => {
    if (typeof requestId !== 'string') {
      throw new Error('Invalid request ID');
    }
    return ipcRenderer.invoke('analysis:getProgress', requestId);
  },

  // Analysis progress monitoring
  onAnalysisProgressUpdate: (callback: (progress: any) => void) => {
    const wrappedCallback = (_event: any, progress: any) => callback(progress);
    ipcRenderer.on('analysis:progressUpdate', wrappedCallback);
    return () => ipcRenderer.removeListener('analysis:progressUpdate', wrappedCallback);
  },

  onAnalysisComplete: (callback: (result: any) => void) => {
    const wrappedCallback = (_event: any, result: any) => callback(result);
    ipcRenderer.on('analysis:complete', wrappedCallback);
    return () => ipcRenderer.removeListener('analysis:complete', wrappedCallback);
  },

  onAnalysisError: (callback: (error: any) => void) => {
    const wrappedCallback = (_event: any, error: any) => callback(error);
    ipcRenderer.on('analysis:error', wrappedCallback);
    return () => ipcRenderer.removeListener('analysis:error', wrappedCallback);
  },

  // Settings and user preferences management
  settings: {
    getUserProfile: () => ipcRenderer.invoke('settings:getUserProfile'),
    getUserPreferences: () => ipcRenderer.invoke('settings:getUserPreferences'),
    getAvailableModels: () => ipcRenderer.invoke('settings:getAvailableModels'),
    saveUserPreferences: (preferences: any) => ipcRenderer.invoke('settings:saveUserPreferences', preferences),
    updateUserProfile: (profile: any) => ipcRenderer.invoke('settings:updateUserProfile', profile),
    getDefaultPreferences: () => ipcRenderer.invoke('settings:getDefaultPreferences'),
    exportSettings: (data: any) => ipcRenderer.invoke('settings:exportSettings', data),
    importSettings: () => ipcRenderer.invoke('settings:importSettings')
  },

  // System information and health monitoring
  system: {
    getSystemInfo: () => ipcRenderer.invoke('system:getInfo'),
    getHealthStatus: () => ipcRenderer.invoke('system:getHealthStatus'),
    getResourceUsage: () => ipcRenderer.invoke('system:getResourceUsage')
  },

  // Generic invoke method for flexibility
  invoke: (channel: string, ...args: any[]) => {
    // Whitelist allowed channels for security
    const allowedChannels = [
      'suggestions:getByFileIds',
      'suggestions:updateRecommendation',
      'analysis:start',
      'analysis:cancel',
      'analysis:getProgress',
      'analysis:getResults',
      'analysis:getSessionHistory',
      'analysis:getModelMetrics',
      // Enhanced UI state synchronization channels
      'ui:getAppState',
      'ui:subscribeUpdates', 
      'ui:updateState',
      'ui:getStateSlice',
      'ui:batchUpdateState',
      'ui:resetState',
      // Enhanced analysis channels
      'suggestions:getAnalysisResults',
      // Batch operation channels
      'batch:getOperationQueue',
      'batch:startOperation',
      'batch:pauseOperation',
      'batch:cancelOperation',
      'batch:updateOperationPriority',
      'batch:createOperation',
      'batch:getOperationStatus',
      // History operation channels
      'history:getOperations',
      'history:prepareUndo',
      'history:executeUndo',
      'history:executeRedo',
      'history:exportOperations',
      // Settings channels
      'settings:getUserProfile',
      'settings:getUserPreferences',
      'settings:getAvailableModels',
      'settings:saveUserPreferences',
      'settings:updateUserProfile',
      'settings:getDefaultPreferences',
      'settings:exportSettings',
      'settings:importSettings',
      // System information channels
      'system:getInfo',
      'system:getHealthStatus',
      'system:getResourceUsage',
      // Event streaming channels
      'events:subscribe',
      'events:unsubscribe',
      'events:getHistory',
      'events:getConnectionStats',
      // Offline capability channels
      'offline:getConnectionStatus',
      'offline:isCapabilityAvailable',
      'offline:queueOperation',
      'offline:getQueue',
      'offline:removeOperation',
      'offline:forceSync',
      // Data validation channels
      'validation:getSchemas',
      'validation:validateData',
      'validation:getRecoveryOptions'
    ];
    
    if (!allowedChannels.includes(channel)) {
      throw new Error(`IPC channel '${channel}' is not allowed`);
    }
    
    return ipcRenderer.invoke(channel, ...args);
  },

  // Event listener helpers
  on: (channel: string, callback: (...args: any[]) => void) => {
    const allowedChannels = [
      'analysis:progressUpdate',
      'analysis:progress-update',
      'analysis:complete',
      'analysis:error',
      'analysis:cancelled',
      'analysis:previewUpdate',
      // Enhanced state synchronization event channels
      'app-state:update',
      'state:update',
      'state:full-update',
      // Real-time event streaming channels
      'realtime:event',
      'connection:established',
      'connection:heartbeat',
      'events:buffered',
      // IPC system event channels
      'ipc:handler-success',
      'ipc:handler-error',
      'ipc:validation-error',
      'ipc:offline-queued',
      'ipc:slow-operation',
      // Analysis progress event channels
      'analysis:progress',
      'analysis:complete',
      // Batch operation event channels
      'batch:operationProgress',
      'batch:operationStatusChanged',
      'batch:operation-update',
      // System monitoring event channels
      'system:health-update',
      'system:error',
      'system:uncaught-exception',
      'system:unhandled-rejection',
      // Offline capability event channels
      'offline:status-change',
      'offline:operation-queued',
      'offline:operation-success',
      'offline:operation-failed',
      'offline:operation-retry',
      'offline:sync-complete',
      'offline:sync-error',
      // History operation event channels
      'history:operationAdded',
      'history:auditTrailAdded',
      'history:operation-added'
    ];
    
    if (!allowedChannels.includes(channel)) {
      throw new Error(`Event channel '${channel}' is not allowed`);
    }
    
    const wrappedCallback = (_event: any, ...args: any[]) => callback(...args);
    ipcRenderer.on(channel, wrappedCallback);
    return () => ipcRenderer.removeListener(channel, wrappedCallback);
  },

  removeListener: (channel: string, callback?: (...args: any[]) => void) => {
    if (callback) {
      ipcRenderer.removeListener(channel, callback);
    } else {
      ipcRenderer.removeAllListeners(channel);
    }
  }
});
