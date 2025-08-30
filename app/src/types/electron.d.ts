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

  // Analysis and suggestion management
  getSuggestionsByFileIds?: (fileIds: number[], analysisType?: string) => Promise<{ success: boolean; suggestions?: any[]; error?: string }>;
  updateSuggestionRecommendation?: (suggestionId: number, isRecommended: boolean) => Promise<{ success: boolean; error?: string }>;
  startFileAnalysis?: (fileIds: number[], analysisType: string, options?: any) => Promise<{ success: boolean; requestId?: string; error?: string }>;
  cancelFileAnalysis?: (requestId: string) => Promise<{ success: boolean; error?: string }>;
  getAnalysisProgress?: (requestId: string) => Promise<{ success: boolean; progress?: any; error?: string }>;

  // Analysis event listeners
  onAnalysisProgressUpdate?: (callback: (progress: any) => void) => () => void;
  onAnalysisComplete?: (callback: (result: any) => void) => () => void;
  onAnalysisError?: (callback: (error: any) => void) => () => void;

  // Batch operation management
  getBatchOperationQueue?: () => Promise<{ success: boolean; operations?: any[]; queue?: any; error?: string }>;
  startBatchOperation?: (operationId: string) => Promise<{ success: boolean; error?: string }>;
  pauseBatchOperation?: (operationId: string) => Promise<{ success: boolean; error?: string }>;
  cancelBatchOperation?: (operationId: string) => Promise<{ success: boolean; error?: string }>;
  updateOperationPriority?: (operationId: string, priority: string) => Promise<{ success: boolean; error?: string }>;
  createBatchOperation?: (type: string, configuration: any) => Promise<{ success: boolean; operationId?: string; error?: string }>;
  
  // Batch execution methods
  executeBatchOperations?: (operations: Array<{
    type: 'rename' | 'move';
    sourcePath: string;
    targetPath: string;
    fileId: number;
    suggestionId?: number;
  }>, options?: {
    priority?: 'high' | 'medium' | 'low';
    continueOnError?: boolean;
    createBackups?: boolean;
  }) => Promise<{ success: boolean; batchId?: string; error?: string }>;
  cancelBatchExecution?: (batchId: string, reason?: string) => Promise<{ success: boolean; error?: string }>;
  getBatchProgress?: (batchId: string) => Promise<{ success: boolean; progress?: any; error?: string }>;
  getBatchQueueStatus?: () => Promise<{ success: boolean; status?: any; error?: string }>;
  validateBatchOperations?: (operations: Array<{
    type: 'rename' | 'move';
    sourcePath: string;
    targetPath: string;
    fileId: number;
    suggestionId?: number;
  }>) => Promise<{ success: boolean; validation?: any; error?: string }>;

  // Batch operation event listeners
  onBatchOperationProgress?: (callback: (progress: any) => void) => () => void;
  onBatchOperationStatusChanged?: (callback: (status: any) => void) => () => void;

  // Suggestion execution methods
  executeSuggestions?: (options: {
    fileIds?: number[];
    suggestionIds?: number[];
    selectionCriteria?: {
      confidenceThreshold?: number;
      types?: string[];
      grouping?: 'none' | 'confidence' | 'type' | 'directory';
    };
    executionOptions?: {
      priority?: 'high' | 'medium' | 'low';
      continueOnError?: boolean;
      createBackups?: boolean;
      validateBefore?: boolean;
    };
  }) => Promise<{ success: boolean; transactionId?: string; completedOperations?: number; errors?: string[]; error?: string }>;

  getSuggestionExecutionStatus?: (batchId?: string) => Promise<{ success: boolean; batch?: any; activeBatches?: any[]; error?: string }>;
  cancelSuggestionExecution?: (batchId: string, reason?: string) => Promise<{ success: boolean; error?: string }>;
  undoTransaction?: (transactionId: string, reason?: string) => Promise<{ success: boolean; completedOperations?: number; errors?: string[]; error?: string }>;

  // Suggestion execution event listeners
  onSuggestionExecutionStarted?: (callback: (data: { batchId: string; operations: any[] }) => void) => () => void;
  onSuggestionExecutionProgress?: (callback: (data: { batchId: string; progress: any }) => void) => () => void;
  onSuggestionExecutionCompleted?: (callback: (data: { batchId: string; results: any }) => void) => () => void;
  onSuggestionExecutionFailed?: (callback: (data: { batchId: string; error: any }) => void) => () => void;

  // Operation history and audit trail management
  getOperationHistory?: () => Promise<{ success: boolean; operations?: any[]; auditTrail?: any[]; error?: string }>;
  prepareUndoOperation?: (operationId: string) => Promise<{ success: boolean; undoOperation?: any; error?: string }>;
  executeUndoOperation?: (operationId: string, reason?: string) => Promise<{ success: boolean; error?: string }>;
  executeRedoOperation?: (operationId: string) => Promise<{ success: boolean; error?: string }>;
  exportOperationHistory?: (operationIds: string[], format: string, includeAuditTrail: boolean) => Promise<{ success: boolean; error?: string }>;

  // History event listeners
  onHistoryOperationAdded?: (callback: (operation: any) => void) => () => void;
  onHistoryAuditTrailAdded?: (callback: (entry: any) => void) => () => void;

  // Settings and user preferences management
  settings?: {
    getUserProfile: () => Promise<any>;
    getUserPreferences: () => Promise<any>;
    getAvailableModels: () => Promise<any[]>;
    saveUserPreferences: (preferences: any) => Promise<{ success: boolean; error?: string }>;
    updateUserProfile: (profile: any) => Promise<{ success: boolean; error?: string }>;
    getDefaultPreferences: () => Promise<any>;
    exportSettings: (data: any) => Promise<{ success: boolean; filePath?: string; error?: string }>;
    importSettings: () => Promise<{ success: boolean; data?: any; error?: string }>;
  };

  // System information and health monitoring
  system?: {
    getSystemInfo: () => Promise<any>;
    getHealthStatus: () => Promise<any>;
    getResourceUsage: () => Promise<any>;
  };

  // Generic IPC methods
  invoke: (channel: string, ...args: any[]) => Promise<any>;
  on?: (channel: string, callback: (...args: any[]) => void) => () => void;
  removeListener?: (channel: string, callback?: (...args: any[]) => void) => void;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}