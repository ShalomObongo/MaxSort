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
  }
});
