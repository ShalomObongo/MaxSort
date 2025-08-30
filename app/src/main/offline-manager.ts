import { EventEmitter } from 'events';
import { logger } from '../lib/logger';

export interface ConnectionStatus {
  online: boolean;
  lastOnline: number;
  reconnectAttempts: number;
  networkState: 'online' | 'offline' | 'slow' | 'unstable';
  capabilities: {
    aiModels: boolean;
    fileOperations: boolean;
    realTimeSync: boolean;
    backgroundSync: boolean;
  };
}

export interface OfflineOperation {
  id: string;
  type: 'analysis' | 'batch-operation' | 'settings-update' | 'state-sync';
  payload: any;
  timestamp: number;
  retryCount: number;
  maxRetries: number;
  priority: 'low' | 'medium' | 'high' | 'critical';
  dependencies?: string[];
}

export class OfflineCapabilityManager extends EventEmitter {
  private static instance: OfflineCapabilityManager | null = null;
  private connectionStatus: ConnectionStatus;
  private offlineQueue: Map<string, OfflineOperation> = new Map();
  private syncInProgress = false;
  private networkCheckInterval: NodeJS.Timeout | null = null;
  private retryTimeouts: Map<string, NodeJS.Timeout> = new Map();

  private constructor() {
    super();
    
    this.connectionStatus = {
      online: true, // Default to online in main process
      lastOnline: Date.now(),
      reconnectAttempts: 0,
      networkState: 'online',
      capabilities: {
        aiModels: true,
        fileOperations: true,
        realTimeSync: true,
        backgroundSync: true
      }
    };
    this.setupConnectionMonitoring();
    this.startNetworkMonitoring();
    this.setupPeriodicSync();
  }

  public static getInstance(): OfflineCapabilityManager {
    if (!OfflineCapabilityManager.instance) {
      OfflineCapabilityManager.instance = new OfflineCapabilityManager();
    }
    return OfflineCapabilityManager.instance;
  }

  // Connection state management
  public getConnectionStatus(): ConnectionStatus {
    return { ...this.connectionStatus };
  }

  public isOnline(): boolean {
    return this.connectionStatus.online;
  }

  public isCapabilityAvailable(capability: keyof ConnectionStatus['capabilities']): boolean {
    return this.connectionStatus.online && this.connectionStatus.capabilities[capability];
  }

  private updateConnectionStatus(updates: Partial<ConnectionStatus>): void {
    const prevStatus = { ...this.connectionStatus };
    this.connectionStatus = { ...this.connectionStatus, ...updates };

    // Emit connection status change event
    this.emit('connection:status-change', {
      previous: prevStatus,
      current: this.connectionStatus,
      timestamp: Date.now()
    });

    logger.info('OfflineManager', 'Connection status updated', {
      online: this.connectionStatus.online,
      networkState: this.connectionStatus.networkState,
      capabilities: this.connectionStatus.capabilities
    });

    // Trigger sync if we just came back online
    if (!prevStatus.online && this.connectionStatus.online) {
      this.triggerOfflineSync();
    }
  }

  // Network monitoring
  private setupConnectionMonitoring(): void {
    // For main process, we'll use net module to check connectivity
    // Instead of window event listeners which don't exist in main process
    import('net').then(net => {
      // Start periodic connectivity checks for main process
      this.startNetworkMonitoring();
    }).catch(() => {
      console.warn('Net module not available, using default online status');
    });
  }

  private startNetworkMonitoring(): void {
    if (this.networkCheckInterval) {
      clearInterval(this.networkCheckInterval);
    }

    // Check network status every 30 seconds
    this.networkCheckInterval = setInterval(() => {
      this.checkNetworkHealth();
    }, 30000);
  }

  private async checkNetworkHealth(): Promise<void> {
    try {
      const startTime = Date.now();
      
      // Test network connectivity with multiple endpoints
      const testEndpoints = [
        'https://www.google.com',
        'https://www.cloudflare.com',
        'https://httpbin.org/get'
      ];

      const connectionTests = testEndpoints.map(async (endpoint) => {
        try {
          const response = await fetch(endpoint, { 
            method: 'HEAD',
            headers: {
              'Cache-Control': 'no-cache'
            },
            signal: AbortSignal.timeout(5000)
          });
          return response.ok;
        } catch {
          return false;
        }
      });

      const results = await Promise.all(connectionTests);
      const successfulConnections = results.filter(Boolean).length;
      const responseTime = Date.now() - startTime;

      // Determine network state
      let networkState: ConnectionStatus['networkState'] = 'offline';
      let online = false;

      if (successfulConnections > 0) {
        online = true;
        if (responseTime < 1000) {
          networkState = 'online';
        } else if (responseTime < 3000) {
          networkState = 'slow';
        } else {
          networkState = 'unstable';
        }
      }

      // Update capabilities based on network state
      const capabilities = {
        aiModels: online && networkState !== 'unstable',
        fileOperations: true, // Always available for local operations
        realTimeSync: online && networkState === 'online',
        backgroundSync: online
      };

      this.updateConnectionStatus({
        online,
        networkState,
        capabilities,
        lastOnline: online ? Date.now() : this.connectionStatus.lastOnline,
        reconnectAttempts: online ? 0 : this.connectionStatus.reconnectAttempts + 1
      });

    } catch (error) {
      logger.error('OfflineManager', 'Network health check failed', error as Error);
      this.updateConnectionStatus({
        online: false,
        networkState: 'offline',
        capabilities: {
          aiModels: false,
          fileOperations: true,
          realTimeSync: false,
          backgroundSync: false
        },
        reconnectAttempts: this.connectionStatus.reconnectAttempts + 1
      });
    }
  }

  private startNetworkChecks(): void {
    // Ping-based network check for Node.js environments
    setInterval(async () => {
      try {
        const { spawn } = await import('child_process');
        const ping = spawn('ping', ['-c', '1', '8.8.8.8'], { stdio: 'pipe' });
        
        ping.on('close', (code) => {
          if (code === 0) {
            if (!this.connectionStatus.online) {
              this.handleOnline();
            }
          } else {
            if (this.connectionStatus.online) {
              this.handleOffline();
            }
          }
        });

        ping.on('error', () => {
          if (this.connectionStatus.online) {
            this.handleOffline();
          }
        });

      } catch (error) {
        logger.error('OfflineManager', 'Network ping check failed', error as Error);
      }
    }, 15000); // Check every 15 seconds
  }

  private handleOnline(): void {
    logger.info('OfflineManager', 'Network connection restored');
    this.updateConnectionStatus({
      online: true,
      networkState: 'online',
      lastOnline: Date.now(),
      reconnectAttempts: 0,
      capabilities: {
        aiModels: true,
        fileOperations: true,
        realTimeSync: true,
        backgroundSync: true
      }
    });
  }

  private handleOffline(): void {
    logger.warn('OfflineManager', 'Network connection lost');
    this.updateConnectionStatus({
      online: false,
      networkState: 'offline',
      capabilities: {
        aiModels: false,
        fileOperations: true,
        realTimeSync: false,
        backgroundSync: false
      }
    });
  }

  // Offline operation queue management
  public queueOfflineOperation(operation: Omit<OfflineOperation, 'id' | 'timestamp' | 'retryCount'>): string {
    const id = `offline_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    const queuedOperation: OfflineOperation = {
      ...operation,
      id,
      timestamp: Date.now(),
      retryCount: 0
    };

    this.offlineQueue.set(id, queuedOperation);

    logger.info('OfflineManager', `Operation queued for offline processing: ${operation.type}`, {
      id,
      priority: operation.priority,
      queueSize: this.offlineQueue.size
    });

    this.emit('offline:operation-queued', queuedOperation);

    // Try immediate execution if online
    if (this.connectionStatus.online) {
      this.executeOfflineOperation(id);
    }

    return id;
  }

  public removeOfflineOperation(id: string): boolean {
    const operation = this.offlineQueue.get(id);
    if (operation) {
      this.offlineQueue.delete(id);
      
      // Clear any retry timeout
      const timeout = this.retryTimeouts.get(id);
      if (timeout) {
        clearTimeout(timeout);
        this.retryTimeouts.delete(id);
      }

      this.emit('offline:operation-removed', operation);
      return true;
    }
    return false;
  }

  public getOfflineQueue(): OfflineOperation[] {
    return Array.from(this.offlineQueue.values()).sort((a, b) => {
      // Sort by priority and timestamp
      const priorityOrder = { critical: 4, high: 3, medium: 2, low: 1 };
      const aPriority = priorityOrder[a.priority];
      const bPriority = priorityOrder[b.priority];
      
      if (aPriority !== bPriority) {
        return bPriority - aPriority;
      }
      
      return a.timestamp - b.timestamp;
    });
  }

  // Offline sync and retry logic
  private async triggerOfflineSync(): Promise<void> {
    if (this.syncInProgress || !this.connectionStatus.online) {
      return;
    }

    this.syncInProgress = true;
    logger.info('OfflineManager', 'Starting offline sync', { queueSize: this.offlineQueue.size });

    try {
      const operations = this.getOfflineQueue();
      const results = {
        success: 0,
        failed: 0,
        skipped: 0
      };

      for (const operation of operations) {
        try {
          const success = await this.executeOfflineOperation(operation.id);
          if (success) {
            results.success++;
          } else {
            results.failed++;
          }
        } catch (error) {
          logger.error('OfflineManager', `Failed to sync operation ${operation.id}`, error as Error);
          results.failed++;
        }
      }

      logger.info('OfflineManager', 'Offline sync completed', results);
      this.emit('offline:sync-complete', results);

    } catch (error) {
      logger.error('OfflineManager', 'Offline sync failed', error as Error);
      this.emit('offline:sync-error', error);
    } finally {
      this.syncInProgress = false;
    }
  }

  private async executeOfflineOperation(operationId: string): Promise<boolean> {
    const operation = this.offlineQueue.get(operationId);
    if (!operation) {
      return false;
    }

    try {
      // Check dependencies
      if (operation.dependencies) {
        const unmetDependencies = operation.dependencies.filter(depId => 
          this.offlineQueue.has(depId)
        );
        
        if (unmetDependencies.length > 0) {
          logger.debug('OfflineManager', `Operation ${operationId} has unmet dependencies, skipping`, {
            dependencies: unmetDependencies
          });
          return false;
        }
      }

      // Execute operation based on type
      let success = false;
      
      switch (operation.type) {
        case 'analysis':
          success = await this.executeAnalysisOperation(operation);
          break;
        case 'batch-operation':
          success = await this.executeBatchOperation(operation);
          break;
        case 'settings-update':
          success = await this.executeSettingsUpdate(operation);
          break;
        case 'state-sync':
          success = await this.executeStateSync(operation);
          break;
        default:
          logger.warn('OfflineManager', `Unknown operation type: ${operation.type}`, { operationId });
          success = false;
      }

      if (success) {
        this.removeOfflineOperation(operationId);
        this.emit('offline:operation-success', operation);
      } else {
        await this.handleOperationFailure(operation);
      }

      return success;

    } catch (error) {
      logger.error('OfflineManager', `Operation execution failed: ${operationId}`, error as Error);
      await this.handleOperationFailure(operation, error as Error);
      return false;
    }
  }

  private async handleOperationFailure(operation: OfflineOperation, error?: Error): Promise<void> {
    operation.retryCount++;

    if (operation.retryCount >= operation.maxRetries) {
      logger.error('OfflineManager', `Operation ${operation.id} exceeded max retries, removing from queue`, undefined, {
        operationId: operation.id,
        retryCount: operation.retryCount,
        maxRetries: operation.maxRetries
      });
      
      this.removeOfflineOperation(operation.id);
      this.emit('offline:operation-failed', { operation, error });
      return;
    }

    // Schedule retry with exponential backoff
    const retryDelay = Math.min(1000 * Math.pow(2, operation.retryCount), 30000); // Max 30 seconds
    
    const timeout = setTimeout(() => {
      this.executeOfflineOperation(operation.id);
      this.retryTimeouts.delete(operation.id);
    }, retryDelay);

    this.retryTimeouts.set(operation.id, timeout);
    
    logger.info('OfflineManager', `Scheduling retry for operation ${operation.id}`, {
      retryCount: operation.retryCount,
      delay: retryDelay
    });

    this.emit('offline:operation-retry', { operation, retryDelay });
  }

  // Operation executors (placeholders - implement based on actual operation types)
  private async executeAnalysisOperation(operation: OfflineOperation): Promise<boolean> {
    // Placeholder: implement actual analysis operation
    logger.info('OfflineManager', 'Executing queued analysis operation', { operation: operation.id });
    return true; // Return true if successful
  }

  private async executeBatchOperation(operation: OfflineOperation): Promise<boolean> {
    // Placeholder: implement actual batch operation
    logger.info('OfflineManager', 'Executing queued batch operation', { operation: operation.id });
    return true; // Return true if successful
  }

  private async executeSettingsUpdate(operation: OfflineOperation): Promise<boolean> {
    // Placeholder: implement actual settings update
    logger.info('OfflineManager', 'Executing queued settings update', { operation: operation.id });
    return true; // Return true if successful
  }

  private async executeStateSync(operation: OfflineOperation): Promise<boolean> {
    // Placeholder: implement actual state sync
    logger.info('OfflineManager', 'Executing queued state sync', { operation: operation.id });
    return true; // Return true if successful
  }

  // Periodic sync setup
  private setupPeriodicSync(): void {
    // Sync every 5 minutes if online
    setInterval(() => {
      if (this.connectionStatus.online && this.offlineQueue.size > 0) {
        this.triggerOfflineSync();
      }
    }, 5 * 60 * 1000);
  }

  // Cleanup
  public cleanup(): void {
    if (this.networkCheckInterval) {
      clearInterval(this.networkCheckInterval);
      this.networkCheckInterval = null;
    }

    // Clear all retry timeouts
    for (const timeout of this.retryTimeouts.values()) {
      clearTimeout(timeout);
    }
    this.retryTimeouts.clear();

    this.removeAllListeners();
    logger.info('OfflineManager', 'Offline capability manager cleaned up');
  }
}

// Export singleton instance
export const offlineManager = OfflineCapabilityManager.getInstance();
