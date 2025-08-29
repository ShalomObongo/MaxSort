/**
 * Centralized logging system for MaxSort application
 * Provides structured logging with different levels and performance monitoring
 */

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
  CRITICAL = 4
}

export interface LogEntry {
  timestamp: Date;
  level: LogLevel;
  category: string;
  message: string;
  data?: any;
  error?: Error;
  performanceMetric?: {
    operation: string;
    duration: number;
    memoryUsage?: number;
  };
}

export interface LogMetrics {
  totalEntries: number;
  errorCount: number;
  warningCount: number;
  avgResponseTime?: number;
  memoryUsage?: number;
}

export class Logger {
  private static instance: Logger;
  private entries: LogEntry[] = [];
  private maxEntries = 10000; // Limit memory usage
  private currentLevel = LogLevel.INFO;
  private performanceTimers: Map<string, number> = new Map();

  private constructor() {}

  public static getInstance(): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger();
    }
    return Logger.instance;
  }

  public setLogLevel(level: LogLevel): void {
    this.currentLevel = level;
  }

  public debug(category: string, message: string, data?: any): void {
    this.log(LogLevel.DEBUG, category, message, data);
  }

  public info(category: string, message: string, data?: any): void {
    this.log(LogLevel.INFO, category, message, data);
  }

  public warn(category: string, message: string, data?: any): void {
    this.log(LogLevel.WARN, category, message, data);
  }

  public error(category: string, message: string, error?: Error, data?: any): void {
    this.log(LogLevel.ERROR, category, message, data, error);
  }

  public critical(category: string, message: string, error?: Error, data?: any): void {
    this.log(LogLevel.CRITICAL, category, message, data, error);
  }

  public startPerformanceTimer(operation: string): string {
    const timerId = `${operation}_${Date.now()}_${Math.random()}`;
    this.performanceTimers.set(timerId, Date.now());
    return timerId;
  }

  public endPerformanceTimer(
    timerId: string, 
    category: string, 
    operation: string,
    includeMemory = false
  ): number {
    const startTime = this.performanceTimers.get(timerId);
    if (!startTime) {
      this.warn('Logger', `Performance timer ${timerId} not found for operation: ${operation}`);
      return 0;
    }

    const duration = Date.now() - startTime;
    this.performanceTimers.delete(timerId);

    const memoryUsage = includeMemory ? process.memoryUsage().heapUsed : undefined;

    this.log(LogLevel.INFO, category, `Performance: ${operation} completed`, undefined, undefined, {
      operation,
      duration,
      memoryUsage
    });

    return duration;
  }

  public logAnalysisProgress(
    category: string,
    fileId: string,
    fileName: string,
    stage: string,
    progress: number,
    data?: any
  ): void {
    this.info(category, `Analysis progress: ${stage}`, {
      fileId,
      fileName,
      stage,
      progress,
      ...data
    });
  }

  public logAnalysisError(
    category: string,
    fileId: string,
    fileName: string,
    stage: string,
    error: Error,
    recoverable = false
  ): void {
    this.error(category, `Analysis error in ${stage}: ${error.message}`, error, {
      fileId,
      fileName,
      stage,
      recoverable,
      stack: error.stack
    });
  }

  public logAgentOperation(
    agentId: string,
    operation: string,
    status: 'started' | 'completed' | 'failed',
    data?: any
  ): void {
    const level = status === 'failed' ? LogLevel.ERROR : LogLevel.INFO;
    this.log(level, 'AgentManager', `Agent ${agentId} ${operation} ${status}`, {
      agentId,
      operation,
      status,
      ...data
    });
  }

  public getMetrics(): LogMetrics {
    const total = this.entries.length;
    const errors = this.entries.filter(e => e.level >= LogLevel.ERROR).length;
    const warnings = this.entries.filter(e => e.level === LogLevel.WARN).length;
    
    const performanceEntries = this.entries.filter(e => e.performanceMetric);
    const avgResponseTime = performanceEntries.length > 0 
      ? performanceEntries.reduce((sum, e) => sum + (e.performanceMetric?.duration || 0), 0) / performanceEntries.length
      : undefined;

    return {
      totalEntries: total,
      errorCount: errors,
      warningCount: warnings,
      avgResponseTime,
      memoryUsage: process.memoryUsage().heapUsed
    };
  }

  public getRecentEntries(limit = 100): LogEntry[] {
    return this.entries.slice(-limit);
  }

  public getEntriesByCategory(category: string, limit = 100): LogEntry[] {
    return this.entries
      .filter(entry => entry.category === category)
      .slice(-limit);
  }

  public clearLogs(): void {
    this.entries = [];
    this.performanceTimers.clear();
  }

  private log(
    level: LogLevel, 
    category: string, 
    message: string, 
    data?: any, 
    error?: Error,
    performanceMetric?: LogEntry['performanceMetric']
  ): void {
    if (level < this.currentLevel) {
      return;
    }

    const entry: LogEntry = {
      timestamp: new Date(),
      level,
      category,
      message,
      data,
      error,
      performanceMetric
    };

    // Always output to console for now
    const levelStr = LogLevel[level];
    const timestamp = entry.timestamp.toISOString();
    const logMessage = `[${timestamp}] ${levelStr} [${category}] ${message}`;
    
    if (error) {
      console.error(logMessage, error, data);
    } else if (level >= LogLevel.WARN) {
      console.warn(logMessage, data);
    } else {
      console.log(logMessage, data);
    }

    // Store in memory
    this.entries.push(entry);

    // Limit memory usage
    if (this.entries.length > this.maxEntries) {
      this.entries.splice(0, this.entries.length - this.maxEntries);
    }
  }
}

// Export singleton instance
export const logger = Logger.getInstance();

// Error categorization utilities
export enum AnalysisErrorType {
  AI_TIMEOUT = 'ai_timeout',
  AI_INVALID_RESPONSE = 'ai_invalid_response', 
  AI_MODEL_UNAVAILABLE = 'ai_model_unavailable',
  FILE_ACCESS_ERROR = 'file_access_error',
  VALIDATION_ERROR = 'validation_error',
  DATABASE_ERROR = 'database_error',
  NETWORK_ERROR = 'network_error',
  MEMORY_ERROR = 'memory_error',
  UNKNOWN_ERROR = 'unknown_error'
}

export class AnalysisError extends Error {
  public readonly type: AnalysisErrorType;
  public readonly fileId?: string;
  public readonly fileName?: string;
  public readonly stage?: string;
  public readonly recoverable: boolean;
  public readonly retryCount?: number;
  public readonly cause?: Error;

  constructor(
    type: AnalysisErrorType,
    message: string,
    options: {
      fileId?: string;
      fileName?: string;
      stage?: string;
      recoverable?: boolean;
      retryCount?: number;
      cause?: Error;
    } = {}
  ) {
    super(message);
    this.name = 'AnalysisError';
    this.type = type;
    this.fileId = options.fileId;
    this.fileName = options.fileName;
    this.stage = options.stage;
    this.recoverable = options.recoverable ?? false;
    this.retryCount = options.retryCount;
    this.cause = options.cause;
  }

  public static fromError(error: Error, type?: AnalysisErrorType): AnalysisError {
    const detectedType = type || AnalysisError.detectErrorType(error);
    return new AnalysisError(detectedType, error.message, {
      recoverable: AnalysisError.isRecoverable(detectedType),
      cause: error
    });
  }

  public static detectErrorType(error: Error): AnalysisErrorType {
    const message = error.message.toLowerCase();
    
    if (message.includes('timeout')) {
      return AnalysisErrorType.AI_TIMEOUT;
    }
    if (message.includes('network') || message.includes('connection')) {
      return AnalysisErrorType.NETWORK_ERROR;
    }
    if (message.includes('file') && message.includes('access')) {
      return AnalysisErrorType.FILE_ACCESS_ERROR;
    }
    if (message.includes('database') || message.includes('sql')) {
      return AnalysisErrorType.DATABASE_ERROR;
    }
    if (message.includes('memory') || message.includes('heap')) {
      return AnalysisErrorType.MEMORY_ERROR;
    }
    if (message.includes('validation') || message.includes('invalid')) {
      return AnalysisErrorType.VALIDATION_ERROR;
    }
    
    return AnalysisErrorType.UNKNOWN_ERROR;
  }

  public static isRecoverable(type: AnalysisErrorType): boolean {
    return [
      AnalysisErrorType.AI_TIMEOUT,
      AnalysisErrorType.NETWORK_ERROR,
      AnalysisErrorType.AI_MODEL_UNAVAILABLE
    ].includes(type);
  }
}
