import { EventEmitter } from 'events';

/**
 * Ollama API Types
 */
export interface OllamaModel {
  name: string;
  digest: string;
  size: number;
  modified_at: string;
  details?: {
    format: string;
    family: string;
    families: string[] | null;
    parameter_size: string;
    quantization_level: string;
  };
}

export interface OllamaModelsResponse {
  models: OllamaModel[];
}

export interface OllamaHealthStatus {
  status: 'healthy' | 'unhealthy' | 'unknown';
  message?: string;
  models_available: boolean;
  model_count: number;
}

export interface OllamaConnectionConfig {
  endpoint?: string;
  timeout?: number;
  retryAttempts?: number;
  retryDelay?: number;
}

/**
 * Client for communicating with local Ollama daemon
 * Handles connection detection, model discovery, and health monitoring
 */
export class OllamaClient extends EventEmitter {
  private endpoint: string;
  private timeout: number;
  private retryAttempts: number;
  private retryDelay: number;
  private healthCheckInterval: NodeJS.Timeout | null = null;
  private isHealthCheckRunning: boolean = false;

  constructor(config: OllamaConnectionConfig = {}) {
    super();
    
    this.endpoint = config.endpoint || 'http://127.0.0.1:11434';
    this.timeout = config.timeout || 10000; // 10 seconds
    this.retryAttempts = config.retryAttempts || 3;
    this.retryDelay = config.retryDelay || 1000; // 1 second
  }

  /**
   * Test connection to Ollama daemon
   */
  async testConnection(): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);

      const response = await fetch(`${this.endpoint}/api/version`, {
        method: 'GET',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
        },
      });

      clearTimeout(timeoutId);
      
      // Ensure response exists before checking .ok
      if (!response || !response.ok) {
        throw new Error(`HTTP ${response?.status || 'unknown'}: ${response?.statusText || 'unknown error'}`);
      }

      return true;
    } catch (error) {
      console.error('Ollama connection test failed:', error);
      return false;
    }
  }

  /**
   * Get list of available models from Ollama
   */
  async getModels(): Promise<OllamaModel[]> {
    return this.withRetry(async () => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);

      try {
        const response = await fetch(`${this.endpoint}/api/tags`, {
          method: 'GET',
          signal: controller.signal,
          headers: {
            'Content-Type': 'application/json',
          },
        });

        clearTimeout(timeoutId);

        if (!response || !response.ok) {
          throw new Error(`Failed to fetch models: HTTP ${response?.status || 'unknown'} - ${response?.statusText || 'unknown error'}`);
        }

        const data = await response.json() as OllamaModelsResponse;
        return data.models || [];
      } catch (error) {
        clearTimeout(timeoutId);
        throw error;
      }
    });
  }

  /**
   * Validate that a specific model is available and pullable
   */
  async validateModel(modelName: string): Promise<boolean> {
    try {
      const models = await this.getModels();
      const model = models.find(m => m.name === modelName);
      
      if (!model) {
        return false;
      }

      // Additional validation: attempt to show model info
      return this.withRetry(async () => {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.timeout);

        try {
          const response = await fetch(`${this.endpoint}/api/show`, {
            method: 'POST',
            signal: controller.signal,
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ name: modelName }),
          });

          clearTimeout(timeoutId);
          return response ? response.ok : false;
        } catch (error) {
          clearTimeout(timeoutId);
          return false;
        }
      });
    } catch (error) {
      console.error(`Model validation failed for ${modelName}:`, error);
      return false;
    }
  }

  /**
   * Estimate memory usage for a model based on its size
   * Includes safety factor for Agent Manager integration
   */
  estimateModelMemory(model: OllamaModel): number {
    // Base calculation: model size + overhead
    const baseMemory = model.size;
    const overhead = Math.max(baseMemory * 0.2, 512 * 1024 * 1024); // At least 512MB overhead
    
    // Apply safety factor (1.5x) for Agent Manager slot calculation
    const safetyFactor = 1.5;
    
    return Math.ceil((baseMemory + overhead) * safetyFactor);
  }

  /**
   * Get comprehensive health status of Ollama daemon
   */
  async getHealthStatus(): Promise<OllamaHealthStatus> {
    try {
      const isConnected = await this.testConnection();
      
      if (!isConnected) {
        return {
          status: 'unhealthy',
          message: 'Unable to connect to Ollama daemon',
          models_available: false,
          model_count: 0,
        };
      }

      const models = await this.getModels();
      
      return {
        status: 'healthy',
        message: 'Ollama daemon is running and responsive',
        models_available: models.length > 0,
        model_count: models.length,
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        message: error instanceof Error ? error.message : 'Unknown error',
        models_available: false,
        model_count: 0,
      };
    }
  }

  /**
   * Start periodic health monitoring
   */
  startHealthMonitoring(intervalMs: number = 30000): void {
    if (this.healthCheckInterval) {
      this.stopHealthMonitoring();
    }

    this.healthCheckInterval = setInterval(async () => {
      if (this.isHealthCheckRunning) return;
      
      this.isHealthCheckRunning = true;
      try {
        const health = await this.getHealthStatus();
        this.emit('health-update', health);
      } catch (error) {
        this.emit('health-error', error);
      } finally {
        this.isHealthCheckRunning = false;
      }
    }, intervalMs);

    // Emit initial health check
    this.getHealthStatus().then(health => {
      this.emit('health-update', health);
    }).catch(error => {
      this.emit('health-error', error);
    });
  }

  /**
   * Stop health monitoring
   */
  stopHealthMonitoring(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
    this.isHealthCheckRunning = false;
  }

  /**
   * Generic retry wrapper for API calls
   */
  private async withRetry<T>(operation: () => Promise<T>): Promise<T> {
    let lastError: Error;
    
    for (let attempt = 1; attempt <= this.retryAttempts; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        
        if (attempt === this.retryAttempts) {
          break;
        }

        // Don't retry on certain errors
        if (lastError.message.includes('AbortError') || 
            lastError.message.includes('404') ||
            lastError.message.includes('400')) {
          break;
        }

        console.warn(`Ollama API attempt ${attempt} failed, retrying in ${this.retryDelay}ms:`, lastError.message);
        await new Promise(resolve => setTimeout(resolve, this.retryDelay));
      }
    }

    throw lastError!;
  }

  /**
   * Get current configuration
   */
  getConfig(): OllamaConnectionConfig {
    return {
      endpoint: this.endpoint,
      timeout: this.timeout,
      retryAttempts: this.retryAttempts,
      retryDelay: this.retryDelay,
    };
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<OllamaConnectionConfig>): void {
    if (config.endpoint) this.endpoint = config.endpoint;
    if (config.timeout) this.timeout = config.timeout;
    if (config.retryAttempts) this.retryAttempts = config.retryAttempts;
    if (config.retryDelay) this.retryDelay = config.retryDelay;
  }

  /**
   * Clean up resources
   */
  destroy(): void {
    this.stopHealthMonitoring();
    this.removeAllListeners();
  }
}

// Singleton instance for main process
let ollamaClientInstance: OllamaClient | null = null;

export function getOllamaClient(config?: OllamaConnectionConfig): OllamaClient {
  if (!ollamaClientInstance) {
    ollamaClientInstance = new OllamaClient(config);
  }
  return ollamaClientInstance;
}

export function destroyOllamaClient(): void {
  if (ollamaClientInstance) {
    ollamaClientInstance.destroy();
    ollamaClientInstance = null;
  }
}
