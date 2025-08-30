import { EventEmitter } from 'events';
import { BrowserWindow } from 'electron';
import { logger } from '../lib/logger';

export interface EventStreamData {
  type: string;
  payload: any;
  timestamp: number;
  source: string;
}

export class RealTimeEventStreamer extends EventEmitter {
  private static instance: RealTimeEventStreamer | null = null;
  private eventBuffer: EventStreamData[] = [];
  private maxBufferSize = 1000;
  private subscribers: Set<BrowserWindow> = new Set();
  private connectionStatus: Map<BrowserWindow, { connected: boolean; lastHeartbeat: number }> = new Map();
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private eventHistory: EventStreamData[] = [];

  private constructor() {
    super();
    this.startHeartbeat();
    this.setupCleanupHandlers();
  }

  public static getInstance(): RealTimeEventStreamer {
    if (!RealTimeEventStreamer.instance) {
      RealTimeEventStreamer.instance = new RealTimeEventStreamer();
    }
    return RealTimeEventStreamer.instance;
  }

  // Subscription management
  public subscribe(window: BrowserWindow): void {
    try {
      this.subscribers.add(window);
      this.connectionStatus.set(window, {
        connected: true,
        lastHeartbeat: Date.now()
      });

      // Send connection confirmation
      this.sendToWindow(window, {
        type: 'connection:established',
        payload: { 
          subscriberId: window.id,
          bufferSize: this.eventBuffer.length,
          connectionTime: Date.now()
        },
        timestamp: Date.now(),
        source: 'event-streamer'
      });

      // Send buffered events to new subscriber
      if (this.eventBuffer.length > 0) {
        this.sendToWindow(window, {
          type: 'events:buffered',
          payload: { events: this.eventBuffer },
          timestamp: Date.now(),
          source: 'event-streamer'
        });
      }

      logger.info('EventStreamer', `Event streaming subscriber added: window ${window.id}`);
    } catch (error) {
      logger.error(`Failed to subscribe window ${window.id}:`, String(error));
    }
  }

  public unsubscribe(window: BrowserWindow): void {
    try {
      this.subscribers.delete(window);
      this.connectionStatus.delete(window);
      logger.info('EventStreamer', `Event streaming subscriber removed: window ${window.id}`);
    } catch (error) {
      logger.error(`Failed to unsubscribe window ${window.id}:`, String(error));
    }
  }

  // Event broadcasting
  public broadcast(eventType: string, payload: any, source = 'system'): void {
    const eventData: EventStreamData = {
      type: eventType,
      payload,
      timestamp: Date.now(),
      source
    };

    try {
      // Add to buffer and history
      this.addToBuffer(eventData);
      this.addToHistory(eventData);

      // Broadcast to all connected subscribers
      this.subscribers.forEach(window => {
        if (window && !window.isDestroyed()) {
          this.sendToWindow(window, eventData);
        } else {
          this.unsubscribe(window);
        }
      });

      // Emit internal event for other components to listen
      this.emit('event:broadcast', eventData);

      logger.debug('EventStreamer', `Event broadcasted: ${eventType}`, { 
        subscribers: this.subscribers.size,
        payloadSize: JSON.stringify(payload).length
      });
    } catch (error) {
      logger.error(`Failed to broadcast event ${eventType}:`, String(error));
    }
  }

  // Targeted event sending
  public sendToSubscriber(windowId: number, eventType: string, payload: any, source = 'system'): boolean {
    try {
      const targetWindow = Array.from(this.subscribers).find(w => w.id === windowId);
      if (targetWindow && !targetWindow.isDestroyed()) {
        const eventData: EventStreamData = {
          type: eventType,
          payload,
          timestamp: Date.now(),
          source
        };

        this.sendToWindow(targetWindow, eventData);
        return true;
      }
      return false;
    } catch (error) {
      logger.error(`Failed to send event to subscriber ${windowId}:`, String(error));
      return false;
    }
  }

  // Operation-specific event methods
  public broadcastAnalysisProgress(progress: {
    requestId: string;
    processedFiles: number;
    totalFiles: number;
    currentFile: string;
    estimatedTimeRemaining: number;
  }): void {
    this.broadcast('analysis:progress', progress, 'analysis-engine');
  }

  public broadcastAnalysisComplete(result: {
    requestId: string;
    totalFiles: number;
    suggestions: number;
    duration: number;
    successRate: number;
  }): void {
    this.broadcast('analysis:complete', result, 'analysis-engine');
  }

  public broadcastBatchOperationUpdate(update: {
    operationId: string;
    status: 'queued' | 'processing' | 'paused' | 'completed' | 'failed';
    progress: number;
    message?: string;
    processedItems: number;
    totalItems: number;
  }): void {
    this.broadcast('batch:operation-update', update, 'batch-manager');
  }

  public broadcastSystemHealthUpdate(health: {
    cpu: number;
    memory: number;
    agents: any[];
    activeConnections: number;
    queueSize: number;
  }): void {
    this.broadcast('system:health-update', health, 'system-monitor');
  }

  public broadcastOperationHistoryUpdate(operation: {
    id: string;
    type: string;
    status: string;
    timestamp: number;
    details: any;
  }): void {
    this.broadcast('history:operation-added', operation, 'operation-journal');
  }

  public broadcastErrorEvent(error: {
    code: string;
    message: string;
    severity: 'low' | 'medium' | 'high' | 'critical';
    context?: any;
    recoveryOptions?: string[];
  }): void {
    this.broadcast('system:error', error, 'error-handler');
  }

  // Connection health management
  private startHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }

    this.heartbeatInterval = setInterval(() => {
      this.sendHeartbeat();
      this.checkConnectionHealth();
    }, 30000); // 30 seconds
  }

  private sendHeartbeat(): void {
    this.broadcast('connection:heartbeat', {
      timestamp: Date.now(),
      activeSubscribers: this.subscribers.size,
      bufferSize: this.eventBuffer.length
    }, 'event-streamer');
  }

  private checkConnectionHealth(): void {
    const now = Date.now();
    const staleThreshold = 120000; // 2 minutes

    this.connectionStatus.forEach((status, window) => {
      if (now - status.lastHeartbeat > staleThreshold) {
        logger.warn('EventStreamer', `Stale connection detected for window ${window.id}, removing`);
        this.unsubscribe(window);
      }
    });
  }

  // Buffer management
  private addToBuffer(eventData: EventStreamData): void {
    this.eventBuffer.push(eventData);
    
    // Maintain buffer size
    if (this.eventBuffer.length > this.maxBufferSize) {
      this.eventBuffer.shift();
    }
  }

  private addToHistory(eventData: EventStreamData): void {
    this.eventHistory.push(eventData);
    
    // Keep last 5000 events in history
    if (this.eventHistory.length > 5000) {
      this.eventHistory = this.eventHistory.slice(-5000);
    }
  }

  // Event retrieval
  public getEventHistory(filters?: {
    type?: string;
    source?: string;
    since?: number;
    limit?: number;
  }): EventStreamData[] {
    let filtered = this.eventHistory;

    if (filters) {
      if (filters.type) {
        filtered = filtered.filter(event => event.type.includes(filters.type!));
      }
      if (filters.source) {
        filtered = filtered.filter(event => event.source === filters.source);
      }
      if (filters.since) {
        filtered = filtered.filter(event => event.timestamp >= filters.since!);
      }
      if (filters.limit) {
        filtered = filtered.slice(-filters.limit);
      }
    }

    return filtered;
  }

  public getConnectionStats(): {
    activeSubscribers: number;
    totalEventsSent: number;
    bufferSize: number;
    historySize: number;
    connectionStatus: Array<{ windowId: number; connected: boolean; lastHeartbeat: number }>;
  } {
    return {
      activeSubscribers: this.subscribers.size,
      totalEventsSent: this.eventHistory.length,
      bufferSize: this.eventBuffer.length,
      historySize: this.eventHistory.length,
      connectionStatus: Array.from(this.connectionStatus.entries()).map(([window, status]) => ({
        windowId: window.id,
        connected: status.connected,
        lastHeartbeat: status.lastHeartbeat
      }))
    };
  }

  // Utility methods
  private sendToWindow(window: BrowserWindow, eventData: EventStreamData): void {
    try {
      if (!window.isDestroyed()) {
        window.webContents.send('realtime:event', eventData);
        
        // Update heartbeat timestamp
        const status = this.connectionStatus.get(window);
        if (status) {
          status.lastHeartbeat = Date.now();
        }
      }
    } catch (error) {
      logger.error(`Failed to send event to window ${window.id}:`, String(error));
      this.unsubscribe(window);
    }
  }

  private setupCleanupHandlers(): void {
    // Clean up when windows are closed
    process.on('window-all-closed', () => {
      this.cleanup();
    });

    // Handle process exit
    process.on('exit', () => {
      this.cleanup();
    });
  }

  private cleanup(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
    
    this.subscribers.clear();
    this.connectionStatus.clear();
    this.removeAllListeners();
    
    logger.info('EventStreamer', 'Event streamer cleaned up');
  }
}

// Export singleton instance
export const eventStreamer = RealTimeEventStreamer.getInstance();
