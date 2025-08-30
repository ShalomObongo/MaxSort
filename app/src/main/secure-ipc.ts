import { ipcMain, IpcMainInvokeEvent } from 'electron';
import { logger } from '../lib/logger';
import { dataValidator, RecoveryStrategy } from './data-validator';
import { offlineManager } from './offline-manager';
import { eventStreamer } from './event-streamer';

export interface IPCResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  errorCode?: string;
  recoveryOptions?: RecoveryStrategy[];
}

export interface IPCHandlerContext {
  event: IpcMainInvokeEvent;
  channel: string;
  data: any;
  startTime: number;
}

export type IPCHandler<TInput = any, TOutput = any> = (
  context: IPCHandlerContext,
  validatedData: TInput
) => Promise<TOutput> | TOutput;

export class SecureIPCManager {
  private static instance: SecureIPCManager | null = null;
  private handlers: Map<string, IPCHandler> = new Map();
  private middlewares: Array<(context: IPCHandlerContext) => Promise<void> | void> = [];

  private constructor() {
    this.setupGlobalErrorHandling();
    this.setupPerformanceMonitoring();
  }

  public static getInstance(): SecureIPCManager {
    if (!SecureIPCManager.instance) {
      SecureIPCManager.instance = new SecureIPCManager();
    }
    return SecureIPCManager.instance;
  }

  // Register secure IPC handlers with validation and error recovery
  public registerSecureHandler<TInput = any, TOutput = any>(
    channel: string,
    handler: IPCHandler<TInput, TOutput>
  ): void {
    this.handlers.set(channel, handler);

    ipcMain.handle(channel, async (event: IpcMainInvokeEvent, data: TInput): Promise<IPCResponse<TOutput>> => {
      const context: IPCHandlerContext = {
        event,
        channel,
        data,
        startTime: Date.now()
      };

      try {
        // Run middleware
        await this.runMiddleware(context);

        // Validate input data
        const validationResult = dataValidator.validateData(channel, data);
        if (!validationResult.valid) {
          return this.handleValidationError(channel, validationResult.errors);
        }

        // Check offline capability if needed
        if (!this.isOfflineCapable(channel) && !offlineManager.isOnline()) {
          return this.handleOfflineError(channel, data);
        }

        // Execute handler with validated data
        const result = await handler(context, validationResult.sanitizedData || data);

        // Log successful execution
        this.logHandlerExecution(context, true);

        // Broadcast execution event
        eventStreamer.broadcast('ipc:handler-success', {
          channel,
          duration: Date.now() - context.startTime,
          dataSize: JSON.stringify(data).length
        }, 'ipc-manager');

        return {
          success: true,
          data: result
        };

      } catch (error) {
        return this.handleHandlerError(context, error as Error);
      }
    });

    logger.info('SecureIPC', `Secure handler registered: ${channel}`);
  }

  // Middleware system
  public addMiddleware(middleware: (context: IPCHandlerContext) => Promise<void> | void): void {
    this.middlewares.push(middleware);
  }

  private async runMiddleware(context: IPCHandlerContext): Promise<void> {
    for (const middleware of this.middlewares) {
      try {
        await middleware(context);
      } catch (error) {
        logger.error('SecureIPC', `Middleware error for ${context.channel}`, error as Error);
        throw error;
      }
    }
  }

  // Error handling
  private handleValidationError(channel: string, errors: string[]): IPCResponse {
    logger.warn('SecureIPC', `Validation failed for ${channel}`, { errors });
    
    eventStreamer.broadcast('ipc:validation-error', {
      channel,
      errors,
      timestamp: Date.now()
    }, 'ipc-manager');

    return {
      success: false,
      error: `Validation failed: ${errors.join(', ')}`,
      errorCode: 'VALIDATION_ERROR',
      recoveryOptions: [RecoveryStrategy.PROMPT_USER]
    };
  }

  private handleOfflineError(channel: string, data: any): IPCResponse {
    logger.info('SecureIPC', `Queuing offline operation for ${channel}`);

    // Queue operation for when online
    const operationId = offlineManager.queueOfflineOperation({
      type: this.getOperationType(channel),
      payload: data,
      maxRetries: 3,
      priority: this.getOperationPriority(channel)
    });

    eventStreamer.broadcast('ipc:offline-queued', {
      channel,
      operationId,
      timestamp: Date.now()
    }, 'ipc-manager');

    return {
      success: false,
      error: 'Operation queued for offline processing',
      errorCode: 'OFFLINE_QUEUED',
      recoveryOptions: [RecoveryStrategy.CACHE_OFFLINE],
      data: { operationId }
    };
  }

  private async handleHandlerError(context: IPCHandlerContext, error: Error): Promise<IPCResponse> {
    this.logHandlerExecution(context, false, error);

    // Get recovery action from data validator
    const recoveryAction = dataValidator.handleIPCError(error, context.channel, context.data);

    // Broadcast error event
    eventStreamer.broadcast('ipc:handler-error', {
      channel: context.channel,
      error: error.message,
      duration: Date.now() - context.startTime,
      recoveryStrategy: recoveryAction.strategy
    }, 'ipc-manager');

    // Handle recovery based on strategy
    switch (recoveryAction.strategy) {
      case RecoveryStrategy.RETRY:
        if (recoveryAction.maxRetries && recoveryAction.retryDelay) {
          setTimeout(() => {
            // Re-trigger the handler after delay
            // This would need to be implemented based on specific retry logic
            logger.info('SecureIPC', `Scheduling retry for ${context.channel}`, {
              delay: recoveryAction.retryDelay
            });
          }, recoveryAction.retryDelay);
        }
        break;

      case RecoveryStrategy.CACHE_OFFLINE:
        this.handleOfflineError(context.channel, context.data);
        break;

      case RecoveryStrategy.FALLBACK:
        if (recoveryAction.fallbackHandler) {
          try {
            const fallbackResult = recoveryAction.fallbackHandler();
            return {
              success: true,
              data: fallbackResult,
              error: 'Used fallback handler due to error'
            };
          } catch (fallbackError) {
            logger.error('SecureIPC', `Fallback handler failed for ${context.channel}`, fallbackError as Error);
          }
        }
        break;
    }

    return {
      success: false,
      error: error.message,
      errorCode: this.getErrorCode(error),
      recoveryOptions: [recoveryAction.strategy]
    };
  }

  // Utility methods
  private isOfflineCapable(channel: string): boolean {
    const offlineCapableChannels = [
      'ui:getAppState',
      'ui:updateState',
      'system:getHealthStatus'
    ];
    
    return offlineCapableChannels.includes(channel);
  }

  private getOperationType(channel: string): 'analysis' | 'batch-operation' | 'settings-update' | 'state-sync' {
    if (channel.startsWith('suggestions:') || channel.startsWith('analysis:')) {
      return 'analysis';
    }
    if (channel.startsWith('batch:')) {
      return 'batch-operation';
    }
    if (channel.startsWith('ui:') || channel.startsWith('state:')) {
      return 'state-sync';
    }
    return 'settings-update';
  }

  private getOperationPriority(channel: string): 'low' | 'medium' | 'high' | 'critical' {
    if (channel.includes('critical') || channel.includes('error')) {
      return 'critical';
    }
    if (channel.startsWith('system:') || channel.startsWith('health:')) {
      return 'high';
    }
    if (channel.startsWith('ui:') || channel.startsWith('state:')) {
      return 'medium';
    }
    return 'low';
  }

  private getErrorCode(error: Error): string {
    if (error.message.includes('validation')) return 'VALIDATION_ERROR';
    if (error.message.includes('timeout')) return 'TIMEOUT_ERROR';
    if (error.message.includes('network')) return 'NETWORK_ERROR';
    if (error.message.includes('permission')) return 'PERMISSION_ERROR';
    if (error.message.includes('not found')) return 'NOT_FOUND_ERROR';
    return 'INTERNAL_ERROR';
  }

  // Performance monitoring
  private setupPerformanceMonitoring(): void {
    this.addMiddleware((context) => {
      // Log slow operations
      const slowThreshold = 5000; // 5 seconds
      
      setTimeout(() => {
        const duration = Date.now() - context.startTime;
        if (duration > slowThreshold) {
          logger.warn('SecureIPC', `Slow operation detected: ${context.channel}`, {
            duration,
            threshold: slowThreshold
          });

          eventStreamer.broadcast('ipc:slow-operation', {
            channel: context.channel,
            duration,
            threshold: slowThreshold
          }, 'performance-monitor');
        }
      }, slowThreshold);
    });

    // Resource usage monitoring
    this.addMiddleware((context) => {
      const memBefore = process.memoryUsage();
      
      // Check memory usage after a delay to capture the operation's impact
      setTimeout(() => {
        const memAfter = process.memoryUsage();
        const memoryDelta = memAfter.heapUsed - memBefore.heapUsed;
        
        if (memoryDelta > 50 * 1024 * 1024) { // 50MB threshold
          logger.warn('SecureIPC', `High memory usage detected: ${context.channel}`, {
            memoryDelta: Math.round(memoryDelta / 1024 / 1024) + 'MB',
            heapUsed: Math.round(memAfter.heapUsed / 1024 / 1024) + 'MB'
          });
        }
      }, 100);
    });
  }

  private logHandlerExecution(context: IPCHandlerContext, success: boolean, error?: Error): void {
    const duration = Date.now() - context.startTime;
    const logData = {
      channel: context.channel,
      duration,
      success,
      dataSize: JSON.stringify(context.data).length
    };

    if (success) {
      logger.info('SecureIPC', `Handler executed successfully: ${context.channel}`, logData);
    } else {
      logger.error('SecureIPC', `Handler failed: ${context.channel}`, error, logData);
    }
  }

  // Global error handling
  private setupGlobalErrorHandling(): void {
    process.on('uncaughtException', (error) => {
      logger.error('SecureIPC', 'Uncaught exception in IPC handler', error);
      
      eventStreamer.broadcast('system:uncaught-exception', {
        error: error.message,
        stack: error.stack,
        timestamp: Date.now()
      }, 'error-handler');
    });

    process.on('unhandledRejection', (reason) => {
      logger.error('SecureIPC', 'Unhandled promise rejection in IPC handler', reason as Error);
      
      eventStreamer.broadcast('system:unhandled-rejection', {
        reason: String(reason),
        timestamp: Date.now()
      }, 'error-handler');
    });
  }

  // Statistics and monitoring
  public getHandlerStats(): {
    totalHandlers: number;
    activeOperations: number;
    totalExecutions: number;
    errorRate: number;
  } {
    return {
      totalHandlers: this.handlers.size,
      activeOperations: 0, // Would need to track active operations
      totalExecutions: 0, // Would need to track total executions
      errorRate: 0 // Would need to track error rate
    };
  }

  // Cleanup
  public cleanup(): void {
    this.handlers.clear();
    this.middlewares.length = 0;
    logger.info('SecureIPC', 'Secure IPC manager cleaned up');
  }
}

// Export singleton instance
export const secureIPC = SecureIPCManager.getInstance();
