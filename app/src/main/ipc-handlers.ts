import { ipcMain, BrowserWindow } from 'electron';
import { DatabaseManager, getDatabase } from '../lib/database';
import { AgentManager, getAgentManager } from '../agents/agent-manager';
import { logger } from '../lib/logger';
import { eventStreamer } from './event-streamer';
import { offlineManager } from './offline-manager';
import { dataValidator } from './data-validator';
import { secureIPC } from './secure-ipc';

export interface AppState {
  ui: {
    activeTab: string;
    selectedDirectory: string | null;
    selectedModel: string | null;
    analysisInProgress: boolean;
    currentJobId: string | null;
  };
  system: {
    health: any;
    resourceUsage: any;
    agentStatus: any;
  };
  operations: {
    queue: any[];
    history: any[];
    activeOperations: any[];
  };
  preferences: {
    theme: string;
    uiSettings: any;
    modelPreferences: any;
    performanceSettings: any;
  };
}

let globalAppState: AppState = {
  ui: {
    activeTab: 'dashboard',
    selectedDirectory: null,
    selectedModel: null,
    analysisInProgress: false,
    currentJobId: null,
  },
  system: {
    health: null,
    resourceUsage: null,
    agentStatus: null,
  },
  operations: {
    queue: [],
    history: [],
    activeOperations: [],
  },
  preferences: {
    theme: 'system',
    uiSettings: {},
    modelPreferences: {},
    performanceSettings: {},
  },
};

// State synchronization utilities
export function getAppState(): AppState {
  return globalAppState;
}

export function updateAppState(updates: Partial<AppState>): void {
  globalAppState = { ...globalAppState, ...updates };
  broadcastStateUpdate(updates);
}

export function updateUIState(uiUpdates: Partial<AppState['ui']>): void {
  globalAppState.ui = { ...globalAppState.ui, ...uiUpdates };
  broadcastStateUpdate({ ui: globalAppState.ui });
}

export function updateSystemState(systemUpdates: Partial<AppState['system']>): void {
  globalAppState.system = { ...globalAppState.system, ...systemUpdates };
  broadcastStateUpdate({ system: globalAppState.system });
}

export function updateOperationsState(operationsUpdates: Partial<AppState['operations']>): void {
  globalAppState.operations = { ...globalAppState.operations, ...operationsUpdates };
  broadcastStateUpdate({ operations: globalAppState.operations });
}

export function updatePreferencesState(preferencesUpdates: Partial<AppState['preferences']>): void {
  globalAppState.preferences = { ...globalAppState.preferences, ...preferencesUpdates };
  broadcastStateUpdate({ preferences: globalAppState.preferences });
}

function broadcastStateUpdate(updates: Partial<AppState>): void {
  // Legacy IPC updates for existing components
  const allWindows = BrowserWindow.getAllWindows();
  allWindows.forEach(window => {
    window.webContents.send('app-state:update', updates);
  });

  // New event streaming updates
  try {
    const stateKeys = Object.keys(updates);
    if (stateKeys.length === 1) {
      // Single slice update
      const slice = stateKeys[0];
      eventStreamer.broadcast('state:update', {
        slice,
        data: updates[slice as keyof AppState],
        fullState: globalAppState
      }, 'state-manager');
    } else {
      // Multiple slice or full state update
      eventStreamer.broadcast('state:full-update', {
        updates,
        fullState: globalAppState
      }, 'state-manager');
    }
  } catch (error) {
    logger.error('StateManager', 'Failed to broadcast state update via event streamer', error as Error);
  }
}

// Enhanced UI state synchronization IPC handlers
export function registerUIStateSyncHandlers(): void {
  // Get complete application state
  ipcMain.handle('ui:getAppState', async (): Promise<AppState> => {
    try {
      // Refresh system state before returning
      const agentManager = getAgentManager();
      const systemStatus = agentManager.getStatus();
      
      updateSystemState({
        agentStatus: systemStatus,
        resourceUsage: {
          memory: process.memoryUsage(),
          timestamp: Date.now(),
        },
      });

      return globalAppState;
    } catch (error) {
      logger.error('Failed to get app state:', String(error));
      throw error;
    }
  });

  // Subscribe to real-time state updates
  ipcMain.handle('ui:subscribeUpdates', async (_event) => {
    try {
      // Register the renderer for state updates
      const sender = _event.sender;
      
      // Send initial state
      sender.send('app-state:update', globalAppState);
      
      return { success: true, message: 'Subscribed to state updates' };
    } catch (error) {
      logger.error('Failed to subscribe to updates:', String(error));
      throw error;
    }
  });

  // Update UI state
  ipcMain.handle('ui:updateState', async (_event, updates: Partial<AppState['ui']>) => {
    try {
      updateUIState(updates);
      return { success: true };
    } catch (error) {
      logger.error('Failed to update UI state:', String(error));
      throw error;
    }
  });

  // Get specific state slice
  ipcMain.handle('ui:getStateSlice', async (_event, slice: keyof AppState) => {
    try {
      return globalAppState[slice];
    } catch (error) {
      logger.error(`Failed to get state slice '${slice}':`, String(error));
      throw error;
    }
  });

  // Batch state updates for efficiency
  ipcMain.handle('ui:batchUpdateState', async (_event, updates: Array<{ slice: keyof AppState; data: any }>) => {
    try {
      const batchUpdates: Partial<AppState> = {};
      
      for (const update of updates) {
        if (update.slice in globalAppState) {
          batchUpdates[update.slice] = { ...globalAppState[update.slice], ...update.data };
        }
      }
      
      updateAppState(batchUpdates);
      return { success: true, updatedSlices: Object.keys(batchUpdates) };
    } catch (error) {
      logger.error('Failed to batch update state:', String(error));
      throw error;
    }
  });

  // Reset state to defaults
  ipcMain.handle('ui:resetState', async (_event, slice?: keyof AppState) => {
    try {
      if (slice) {
        // Reset specific slice
        switch (slice) {
          case 'ui':
            globalAppState.ui = {
              activeTab: 'dashboard',
              selectedDirectory: null,
              selectedModel: null,
              analysisInProgress: false,
              currentJobId: null,
            };
            break;
          case 'operations':
            globalAppState.operations = {
              queue: [],
              history: [],
              activeOperations: [],
            };
            break;
          default:
            throw new Error(`Cannot reset slice '${slice}'`);
        }
        broadcastStateUpdate({ [slice]: globalAppState[slice] });
      } else {
        // Reset entire state
        globalAppState = {
          ui: {
            activeTab: 'dashboard',
            selectedDirectory: null,
            selectedModel: null,
            analysisInProgress: false,
            currentJobId: null,
          },
          system: {
            health: null,
            resourceUsage: null,
            agentStatus: null,
          },
          operations: {
            queue: [],
            history: [],
            activeOperations: [],
          },
          preferences: {
            theme: 'system',
            uiSettings: {},
            modelPreferences: {},
            performanceSettings: {},
          },
        };
        broadcastStateUpdate(globalAppState);
      }
      
      return { success: true };
    } catch (error) {
      logger.error('Failed to reset state:', String(error));
      throw error;
    }
  });
}

// Enhanced suggestions and analysis IPC handlers
export function registerAnalysisHandlers(): void {
  // Get analysis results with advanced filtering
  ipcMain.handle('suggestions:getAnalysisResults', async (_event, options: {
    fileIds?: number[];
    confidenceThreshold?: number;
    analysisType?: string;
    sortBy?: 'confidence' | 'timestamp' | 'filename';
    sortOrder?: 'asc' | 'desc';
    limit?: number;
    offset?: number;
  }) => {
    try {
      const db = getDatabase();
      const {
        fileIds,
        confidenceThreshold = 0,
        analysisType,
        sortBy = 'confidence',
        sortOrder = 'desc',
        limit = 100,
        offset = 0
      } = options;

      let query = `
        SELECT s.*, f.filename, f.full_path, f.extension, f.size_bytes
        FROM suggestions s
        JOIN files f ON s.file_id = f.id
        WHERE s.confidence_score >= ?
      `;
      const params: any[] = [confidenceThreshold];

      if (fileIds && fileIds.length > 0) {
        query += ` AND s.file_id IN (${fileIds.map(() => '?').join(',')})`;
        params.push(...fileIds);
      }

      if (analysisType) {
        query += ` AND s.analysis_type = ?`;
        params.push(analysisType);
      }

      query += ` ORDER BY s.${sortBy === 'filename' ? 'f.filename' : `s.${sortBy}`} ${sortOrder.toUpperCase()}`;
      query += ` LIMIT ? OFFSET ?`;
      params.push(limit, offset);

      let results: any[] = [];
      
      if (fileIds && fileIds.length > 0) {
        // Get suggestions for specific file IDs
        for (const fileId of fileIds) {
          const suggestions = db.getSuggestionsByFileId(fileId, analysisType);
          results.push(...suggestions.filter(s => s.adjustedConfidence >= confidenceThreshold));
        }
      } else {
        // For now, use the existing methods - would need enhanced DB methods for full filtering
        results = db.getTopSuggestions([], analysisType || 'rename-suggestions', limit);
      }
      
      // Update operations state
      updateOperationsState({
        activeOperations: results.filter((r: any) => r.status === 'processing')
      });

      return {
        results,
        pagination: {
          limit,
          offset: 0,
          total: results.length
        }
      };
    } catch (error) {
      logger.error('Failed to get analysis results:', String(error));
      throw error;
    }
  });

  // Get batch operation status with real-time updates
  ipcMain.handle('batch:getOperationStatus', async (_event, operationId?: string) => {
    try {
      const agentManager = getAgentManager();
      const status = agentManager.getStatus();
      
      if (operationId) {
        // Return specific operation status - for now return general status
        return { taskStatus: { id: operationId, status: 'unknown' }, queueStats: status };
      }
      
      return { queueStats: status };
    } catch (error) {
      logger.error('Failed to get operation status:', String(error));
      throw error;
    }
  });

  // Get operation history with pagination and filtering
  ipcMain.handle('history:getOperations', async (_event, options: {
    operationType?: string;
    startDate?: string;
    endDate?: string;
    status?: string;
    limit?: number;
    offset?: number;
    searchQuery?: string;
  }) => {
    try {
      const db = getDatabase();
      const { limit = 50 } = options;

      // For now, use existing methods - would need enhanced DB methods for full filtering
      const jobs = db.getRecentJobs(limit);
      const operations = jobs.map(job => ({
        id: job.id,
        operation_type: 'scan',
        status: job.status,
        created_at: job.createdAt,
        operation_details: `Scanned ${job.rootPath}`,
        file_path: job.rootPath
      }));

      // Update operations state
      updateOperationsState({
        history: operations
      });

      return {
        operations,
        pagination: {
          limit,
          offset: 0,
          total: operations.length
        }
      };
    } catch (error) {
      logger.error('Failed to get operation history:', String(error));
      throw error;
    }
  });

  // Get comprehensive system health status
  ipcMain.handle('system:getHealthStatus', async () => {
    try {
      const agentManager = getAgentManager();
      const systemStatus = agentManager.getStatus();
      const resourceUsage = {
        memory: process.memoryUsage(),
        timestamp: Date.now(),
      };

      const healthStatus = {
        ...systemStatus,
        resourceUsage,
        uptime: process.uptime(),
        platform: process.platform,
        nodeVersion: process.version,
      };

      // Update system state
      updateSystemState({
        health: healthStatus,
        resourceUsage,
        agentStatus: systemStatus
      });

      return healthStatus;
    } catch (error) {
      logger.error('Failed to get system health status:', String(error));
      throw error;
    }
  });
}

// Event streaming handlers
export function registerEventStreamHandlers(): void {
  // Subscribe to event stream
  ipcMain.handle('events:subscribe', async (event) => {
    try {
      const window = BrowserWindow.fromWebContents(event.sender);
      if (window) {
        eventStreamer.subscribe(window);
        return { success: true, subscriberId: window.id };
      }
      return { success: false, error: 'Invalid window context' };
    } catch (error) {
      logger.error('IPC', 'Failed to subscribe to event stream', error as Error);
      return { success: false, error: (error as Error).message };
    }
  });

  // Unsubscribe from event stream
  ipcMain.handle('events:unsubscribe', async (event) => {
    try {
      const window = BrowserWindow.fromWebContents(event.sender);
      if (window) {
        eventStreamer.unsubscribe(window);
        return { success: true };
      }
      return { success: false, error: 'Invalid window context' };
    } catch (error) {
      logger.error('IPC', 'Failed to unsubscribe from event stream', error as Error);
      return { success: false, error: (error as Error).message };
    }
  });

  // Get event history
  ipcMain.handle('events:getHistory', async (event, filters) => {
    try {
      const history = eventStreamer.getEventHistory(filters);
      return { success: true, data: history };
    } catch (error) {
      logger.error('IPC', 'Failed to get event history', error as Error);
      return { success: false, error: (error as Error).message };
    }
  });

  // Get connection statistics
  ipcMain.handle('events:getConnectionStats', async () => {
    try {
      const stats = eventStreamer.getConnectionStats();
      return { success: true, data: stats };
    } catch (error) {
      logger.error('IPC', 'Failed to get connection stats', error as Error);
      return { success: false, error: (error as Error).message };
    }
  });

  logger.info('IPC', 'Event streaming handlers registered');
}

// Offline capability handlers
export function registerOfflineCapabilityHandlers(): void {
  // Get connection status
  ipcMain.handle('offline:getConnectionStatus', async () => {
    try {
      const status = offlineManager.getConnectionStatus();
      return { success: true, data: status };
    } catch (error) {
      logger.error('IPC', 'Failed to get connection status', error as Error);
      return { success: false, error: (error as Error).message };
    }
  });

  // Check if capability is available
  ipcMain.handle('offline:isCapabilityAvailable', async (event, capability) => {
    try {
      const available = offlineManager.isCapabilityAvailable(capability);
      return { success: true, data: available };
    } catch (error) {
      logger.error('IPC', 'Failed to check capability availability', error as Error);
      return { success: false, error: (error as Error).message };
    }
  });

  // Queue operation for offline processing
  ipcMain.handle('offline:queueOperation', async (event, operation) => {
    try {
      const operationId = offlineManager.queueOfflineOperation(operation);
      return { success: true, data: { operationId } };
    } catch (error) {
      logger.error('IPC', 'Failed to queue offline operation', error as Error);
      return { success: false, error: (error as Error).message };
    }
  });

  // Get offline queue
  ipcMain.handle('offline:getQueue', async () => {
    try {
      const queue = offlineManager.getOfflineQueue();
      return { success: true, data: queue };
    } catch (error) {
      logger.error('IPC', 'Failed to get offline queue', error as Error);
      return { success: false, error: (error as Error).message };
    }
  });

  // Remove operation from offline queue
  ipcMain.handle('offline:removeOperation', async (event, operationId) => {
    try {
      const removed = offlineManager.removeOfflineOperation(operationId);
      return { success: true, data: { removed } };
    } catch (error) {
      logger.error('IPC', 'Failed to remove offline operation', error as Error);
      return { success: false, error: (error as Error).message };
    }
  });

  // Force offline sync
  ipcMain.handle('offline:forceSync', async () => {
    try {
      // Trigger sync by emitting connection status change
      offlineManager.emit('connection:status-change', {
        current: offlineManager.getConnectionStatus(),
        timestamp: Date.now()
      });
      return { success: true };
    } catch (error) {
      logger.error('IPC', 'Failed to force offline sync', error as Error);
      return { success: false, error: (error as Error).message };
    }
  });

  logger.info('IPC', 'Offline capability handlers registered');
}

// Data validation and error recovery handlers
export function registerDataValidationHandlers(): void {
  // Get validation schemas
  ipcMain.handle('validation:getSchemas', async () => {
    try {
      // Return available validation schemas (would need to implement in DataValidationManager)
      return { success: true, data: {} };
    } catch (error) {
      logger.error('IPC', 'Failed to get validation schemas', error as Error);
      return { success: false, error: (error as Error).message };
    }
  });

  // Validate data manually
  ipcMain.handle('validation:validateData', async (event, { channel, data }) => {
    try {
      const result = dataValidator.validateData(channel, data);
      return { success: true, data: result };
    } catch (error) {
      logger.error('IPC', 'Failed to validate data', error as Error);
      return { success: false, error: (error as Error).message };
    }
  });

  // Get error recovery options
  ipcMain.handle('validation:getRecoveryOptions', async (event, { error, channel, data }) => {
    try {
      const recoveryAction = dataValidator.handleIPCError(new Error(error), channel, data);
      return { success: true, data: recoveryAction };
    } catch (handlerError) {
      logger.error('IPC', 'Failed to get recovery options', handlerError as Error);
      return { success: false, error: (handlerError as Error).message };
    }
  });

  logger.info('IPC', 'Data validation handlers registered');
}

// Initialize all IPC handlers
export function initializeAllIPCHandlers(): void {
  registerUIStateSyncHandlers();
  registerAnalysisHandlers();
  registerEventStreamHandlers();
  registerOfflineCapabilityHandlers();
  registerDataValidationHandlers();
  
  // Setup event streaming integration with offline manager
  setupEventStreamIntegration();
  
  logger.info('IPC', 'All IPC handlers initialized with enhanced features');
}

// Setup integration between event streaming and offline management
function setupEventStreamIntegration(): void {
  // Forward offline manager events to event stream
  offlineManager.on('connection:status-change', (statusChange) => {
    eventStreamer.broadcast('offline:status-change', statusChange, 'offline-manager');
  });

  offlineManager.on('offline:operation-queued', (operation) => {
    eventStreamer.broadcast('offline:operation-queued', operation, 'offline-manager');
  });

  offlineManager.on('offline:operation-success', (operation) => {
    eventStreamer.broadcast('offline:operation-success', operation, 'offline-manager');
  });

  offlineManager.on('offline:operation-failed', (data) => {
    eventStreamer.broadcast('offline:operation-failed', data, 'offline-manager');
  });

  offlineManager.on('offline:sync-complete', (results) => {
    eventStreamer.broadcast('offline:sync-complete', results, 'offline-manager');
  });

  logger.info('IPC', 'Event stream integration setup completed');
}
