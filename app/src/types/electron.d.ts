// Shared types for Electron API
export interface ElectronAPI {
  // App information
  getVersion: () => Promise<string>;
  getPlatform: () => Promise<string>;
  getAgentStatus: () => Promise<any>;
  
  // Window controls
  minimize?: () => Promise<void>;
  maximize?: () => Promise<void>;
  close?: () => Promise<void>;

  // Directory operations
  selectDirectory?: () => Promise<string>;
  scanDirectory?: (options: { rootPath: string; include?: string[]; exclude?: string[] }) => Promise<void>;
  onScanProgress?: (callback: (progress: { fileCount: number; currentFile: string; percent: number }) => void) => () => void;
  removeScanProgressListener?: () => void;
  getScanResults?: (rootPath?: string) => Promise<any[]>;
  getScanJobs?: () => Promise<any[]>;

  // Ollama model management
  getOllamaHealth: () => Promise<any>;
  getAvailableModels: () => Promise<any[]>;
  validateModel: (modelName: string) => Promise<boolean>;
  getModelMemoryEstimate: (model: any) => Promise<any>;
  saveModelPreferences: (mainModel: string | null, subModel: string | null) => Promise<void>;
  getModelPreferences: () => Promise<{ mainModel: string | null; subModel: string | null }>;
  onOllamaHealthUpdate: (callback: (health: any) => void) => () => void;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
