/**
 * Error recovery and fallback mechanisms for file analysis pipeline
 * Implements circuit breaker pattern, retry logic, and degraded service modes
 */

import { logger, AnalysisError, AnalysisErrorType } from './logger';
import { EventEmitter } from 'events';

export enum RecoveryMode {
  NORMAL = 'normal',
  DEGRADED = 'degraded',
  EMERGENCY = 'emergency',
  OFFLINE = 'offline'
}

export interface RecoveryMetrics {
  mode: RecoveryMode;
  totalFailures: number;
  recoveredFailures: number;
  consecutiveFailures: number;
  lastFailureTime: number;
  circuitBreakerTrips: number;
  fallbackActivations: number;
}

export interface RecoveryConfig {
  maxConsecutiveFailures: number;
  recoveryTimeoutMs: number;
  circuitBreakerThreshold: number;
  circuitBreakerResetTimeMs: number;
  maxRetryAttempts: number;
  retryBackoffMultiplier: number;
  fallbackTimeoutMs: number;
}

export class ErrorRecoveryManager extends EventEmitter {
  private metrics: RecoveryMetrics;
  private config: RecoveryConfig;
  private circuitBreakers: Map<string, CircuitBreaker> = new Map();
  private activeRecoveries: Map<string, Promise<any>> = new Map();

  constructor(config: Partial<RecoveryConfig> = {}) {
    super();
    
    this.config = {
      maxConsecutiveFailures: 5,
      recoveryTimeoutMs: 30000,
      circuitBreakerThreshold: 10,
      circuitBreakerResetTimeMs: 60000,
      maxRetryAttempts: 3,
      retryBackoffMultiplier: 2,
      fallbackTimeoutMs: 10000,
      ...config
    };

    this.metrics = {
      mode: RecoveryMode.NORMAL,
      totalFailures: 0,
      recoveredFailures: 0,
      consecutiveFailures: 0,
      lastFailureTime: 0,
      circuitBreakerTrips: 0,
      fallbackActivations: 0
    };

    logger.info('ErrorRecoveryManager', 'Error recovery manager initialized', {
      config: this.config
    });
  }

  /**
   * Execute operation with automatic error recovery
   */
  public async executeWithRecovery<T>(
    operationName: string,
    operation: () => Promise<T>,
    fallback?: () => Promise<T>
  ): Promise<T> {
    const timerId = logger.startPerformanceTimer('ErrorRecoveryManager.executeWithRecovery');
    
    try {
      // Check circuit breaker
      const circuitBreaker = this.getCircuitBreaker(operationName);
      if (circuitBreaker.isOpen()) {
        logger.warn('ErrorRecoveryManager', `Circuit breaker open for ${operationName}`, {
          operationName,
          failureCount: circuitBreaker.getFailureCount(),
          lastFailure: circuitBreaker.getLastFailureTime()
        });
        
        if (fallback) {
          return await this.executeFallback(operationName, fallback);
        }
        
        throw new AnalysisError(
          AnalysisErrorType.AI_MODEL_UNAVAILABLE,
          `Circuit breaker open for ${operationName}`,
          { stage: 'circuit-breaker', recoverable: false }
        );
      }

      // Execute with retry logic
      return await this.executeWithRetry(operationName, operation);
      
    } catch (error) {
      const analysisError = error instanceof AnalysisError ? error : AnalysisError.fromError(error as Error);
      
      // Record failure
      this.recordFailure(operationName, analysisError);
      
      // Try fallback if available and error is recoverable
      if (fallback && analysisError.recoverable) {
        logger.info('ErrorRecoveryManager', `Attempting fallback for ${operationName}`, {
          operationName,
          errorType: analysisError.type
        });
        
        try {
          return await this.executeFallback(operationName, fallback);
        } catch (fallbackError) {
          logger.error('ErrorRecoveryManager', `Fallback also failed for ${operationName}`, fallbackError as Error);
          throw analysisError; // Throw original error
        }
      }
      
      throw analysisError;
    } finally {
      logger.endPerformanceTimer(timerId, 'ErrorRecoveryManager', 'executeWithRecovery');
    }
  }

  /**
   * Execute operation with retry logic
   */
  private async executeWithRetry<T>(operationName: string, operation: () => Promise<T>): Promise<T> {
    let lastError: Error | null = null;
    let attempt = 0;

    while (attempt < this.config.maxRetryAttempts) {
      try {
        const result = await operation();
        
        // Success - reset consecutive failures
        if (attempt > 0) {
          logger.info('ErrorRecoveryManager', `Operation succeeded on retry ${attempt}`, {
            operationName,
            attempt
          });
          this.metrics.recoveredFailures++;
        }
        
        this.resetConsecutiveFailures();
        this.getCircuitBreaker(operationName).recordSuccess();
        
        return result;
        
      } catch (error) {
        lastError = error as Error;
        attempt++;
        
        logger.warn('ErrorRecoveryManager', `Operation attempt ${attempt} failed: ${lastError.message}`, {
          operationName,
          attempt,
          remainingAttempts: this.config.maxRetryAttempts - attempt,
          errorMessage: lastError.message
        });
        
        // Don't retry on certain error types
        if (error instanceof AnalysisError && !error.recoverable) {
          break;
        }
        
        // Wait before next attempt with exponential backoff
        if (attempt < this.config.maxRetryAttempts) {
          const delayMs = Math.min(1000 * Math.pow(this.config.retryBackoffMultiplier, attempt - 1), 10000);
          await this.sleep(delayMs);
        }
      }
    }

    // All retries failed
    this.getCircuitBreaker(operationName).recordFailure();
    throw lastError || new Error(`Operation ${operationName} failed after ${this.config.maxRetryAttempts} attempts`);
  }

  /**
   * Execute fallback operation with timeout
   */
  private async executeFallback<T>(operationName: string, fallback: () => Promise<T>): Promise<T> {
    this.metrics.fallbackActivations++;
    
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Fallback timeout for ${operationName}`));
      }, this.config.fallbackTimeoutMs);
    });

    try {
      const result = await Promise.race([fallback(), timeoutPromise]);
      
      logger.info('ErrorRecoveryManager', `Fallback succeeded for ${operationName}`, {
        operationName
      });
      
      return result;
    } catch (error) {
      logger.error('ErrorRecoveryManager', `Fallback failed for ${operationName}`, error as Error, {
        operationName
      });
      throw error;
    }
  }

  /**
   * Record a failure and update recovery state
   */
  private recordFailure(operationName: string, error: AnalysisError): void {
    this.metrics.totalFailures++;
    this.metrics.consecutiveFailures++;
    this.metrics.lastFailureTime = Date.now();

    // Check if we need to change recovery mode
    if (this.metrics.consecutiveFailures >= this.config.maxConsecutiveFailures) {
      this.changeRecoveryMode(RecoveryMode.DEGRADED, `Too many consecutive failures: ${this.metrics.consecutiveFailures}`);
    }

    logger.error('ErrorRecoveryManager', `Recorded failure for ${operationName}`, error, {
      operationName,
      totalFailures: this.metrics.totalFailures,
      consecutiveFailures: this.metrics.consecutiveFailures,
      recoveryMode: this.metrics.mode
    });
  }

  /**
   * Reset consecutive failure counter
   */
  private resetConsecutiveFailures(): void {
    if (this.metrics.consecutiveFailures > 0) {
      logger.info('ErrorRecoveryManager', `Resetting consecutive failures`, {
        previousCount: this.metrics.consecutiveFailures
      });
      this.metrics.consecutiveFailures = 0;
    }

    // Check if we can return to normal mode
    if (this.metrics.mode !== RecoveryMode.NORMAL) {
      this.changeRecoveryMode(RecoveryMode.NORMAL, 'Operations recovered successfully');
    }
  }

  /**
   * Change recovery mode
   */
  private changeRecoveryMode(mode: RecoveryMode, reason: string): void {
    const previousMode = this.metrics.mode;
    this.metrics.mode = mode;

    logger.info('ErrorRecoveryManager', `Recovery mode changed: ${previousMode} -> ${mode}`, {
      previousMode,
      newMode: mode,
      reason
    });

    this.emit('recovery-mode-changed', {
      previousMode,
      newMode: mode,
      reason,
      metrics: { ...this.metrics }
    });
  }

  /**
   * Get or create circuit breaker for operation
   */
  private getCircuitBreaker(operationName: string): CircuitBreaker {
    let circuitBreaker = this.circuitBreakers.get(operationName);
    
    if (!circuitBreaker) {
      circuitBreaker = new CircuitBreaker(this.config.circuitBreakerThreshold, this.config.circuitBreakerResetTimeMs);
      this.circuitBreakers.set(operationName, circuitBreaker);
      
      circuitBreaker.on('state-changed', (state) => {
        if (state === 'open') {
          this.metrics.circuitBreakerTrips++;
        }
        
        logger.info('ErrorRecoveryManager', `Circuit breaker state changed for ${operationName}`, {
          operationName,
          state,
          failureCount: circuitBreaker!.getFailureCount()
        });
      });
    }
    
    return circuitBreaker;
  }

  /**
   * Get current recovery metrics
   */
  public getMetrics(): RecoveryMetrics {
    return { ...this.metrics };
  }

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

/**
 * Circuit breaker implementation
 */
class CircuitBreaker extends EventEmitter {
  private failureCount = 0;
  private lastFailureTime = 0;
  private state: 'closed' | 'open' | 'half-open' = 'closed';

  constructor(
    private threshold: number,
    private resetTimeMs: number
  ) {
    super();
  }

  public recordSuccess(): void {
    this.failureCount = 0;
    this.setState('closed');
  }

  public recordFailure(): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();
    
    if (this.failureCount >= this.threshold) {
      this.setState('open');
    }
  }

  public isOpen(): boolean {
    if (this.state === 'open') {
      // Check if we should try half-open
      if (Date.now() - this.lastFailureTime >= this.resetTimeMs) {
        this.setState('half-open');
        return false;
      }
      return true;
    }
    
    return false;
  }

  public getFailureCount(): number {
    return this.failureCount;
  }

  public getLastFailureTime(): number {
    return this.lastFailureTime;
  }

  private setState(newState: 'closed' | 'open' | 'half-open'): void {
    if (this.state !== newState) {
      this.state = newState;
      this.emit('state-changed', newState);
    }
  }
}

// Export singleton instance
export const errorRecoveryManager = new ErrorRecoveryManager();
