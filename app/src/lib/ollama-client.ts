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
   * Execute model inference for agent task with streaming support
   */
  async executeInference(
    modelName: string, 
    prompt: string, 
    options: {
      format?: 'json' | 'text';
      timeout?: number;
      stream?: boolean;
      temperature?: number;
      maxTokens?: number;
    } = {}
  ): Promise<{ response: string; executionTimeMs: number }> {
    const startTime = Date.now();
    const timeout = options.timeout || this.timeout;
    
    return this.withRetry(async () => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      try {
        const requestBody: any = {
          model: modelName,
          prompt: prompt,
          stream: options.stream || false,
        };

        if (options.format) {
          requestBody.format = options.format;
        }

        if (options.temperature !== undefined) {
          requestBody.options = { 
            ...requestBody.options,
            temperature: options.temperature 
          };
        }

        if (options.maxTokens !== undefined) {
          requestBody.options = {
            ...requestBody.options,
            num_predict: options.maxTokens
          };
        }

        const response = await fetch(`${this.endpoint}/api/generate`, {
          method: 'POST',
          signal: controller.signal,
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(requestBody),
        });

        clearTimeout(timeoutId);

        if (!response || !response.ok) {
          throw new Error(`Ollama inference failed: HTTP ${response?.status || 'unknown'} - ${response?.statusText || 'unknown error'}`);
        }

        const result = await response.json();
        const executionTimeMs = Date.now() - startTime;

        // Emit inference metrics for monitoring
        this.emit('inference-completed', {
          modelName,
          executionTimeMs,
          promptLength: prompt.length,
          responseLength: result.response?.length || 0,
        });

        return {
          response: result.response || '',
          executionTimeMs,
        };

      } catch (error) {
        clearTimeout(timeoutId);
        
        // Emit inference failure for monitoring
        this.emit('inference-failed', {
          modelName,
          error: error instanceof Error ? error.message : String(error),
          executionTimeMs: Date.now() - startTime,
        });
        
        throw error;
      }
    });
  }

  /**
   * Execute streaming inference for long-running tasks
   */
  async executeStreamingInference(
    modelName: string,
    prompt: string,
    onChunk: (chunk: string) => void,
    options: {
      timeout?: number;
      temperature?: number;
      maxTokens?: number;
    } = {}
  ): Promise<{ fullResponse: string; executionTimeMs: number }> {
    const startTime = Date.now();
    const timeout = options.timeout || this.timeout * 2; // Longer timeout for streaming
    
    return this.withRetry(async () => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      try {
        const requestBody: any = {
          model: modelName,
          prompt: prompt,
          stream: true,
        };

        if (options.temperature !== undefined) {
          requestBody.options = { 
            ...requestBody.options,
            temperature: options.temperature 
          };
        }

        if (options.maxTokens !== undefined) {
          requestBody.options = {
            ...requestBody.options,
            num_predict: options.maxTokens
          };
        }

        const response = await fetch(`${this.endpoint}/api/generate`, {
          method: 'POST',
          signal: controller.signal,
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(requestBody),
        });

        clearTimeout(timeoutId);

        if (!response || !response.ok) {
          throw new Error(`Ollama streaming inference failed: HTTP ${response?.status || 'unknown'}`);
        }

        const reader = response.body?.getReader();
        if (!reader) {
          throw new Error('Failed to get response reader');
        }

        let fullResponse = '';
        const decoder = new TextDecoder();

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const chunk = decoder.decode(value);
            const lines = chunk.split('\n').filter(line => line.trim());
            
            for (const line of lines) {
              try {
                const data = JSON.parse(line);
                if (data.response) {
                  fullResponse += data.response;
                  onChunk(data.response);
                }
                
                if (data.done) {
                  const executionTimeMs = Date.now() - startTime;
                  
                  this.emit('streaming-inference-completed', {
                    modelName,
                    executionTimeMs,
                    promptLength: prompt.length,
                    responseLength: fullResponse.length,
                  });

                  return { fullResponse, executionTimeMs };
                }
              } catch (parseError) {
                // Skip malformed JSON lines
                console.warn('Failed to parse streaming response line:', parseError);
              }
            }
          }
        } finally {
          reader.releaseLock();
        }

        throw new Error('Streaming response ended unexpectedly');

      } catch (error) {
        clearTimeout(timeoutId);
        
        this.emit('streaming-inference-failed', {
          modelName,
          error: error instanceof Error ? error.message : String(error),
          executionTimeMs: Date.now() - startTime,
        });
        
        throw error;
      }
    });
  }

  /**
   * Check if model is loaded and ready for inference
   */
  async isModelReady(modelName: string): Promise<boolean> {
    try {
      const response = await fetch(`${this.endpoint}/api/show`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: modelName }),
      });

      return response ? response.ok : false;
    } catch (error) {
      console.warn(`Failed to check model readiness for ${modelName}:`, error);
      return false;
    }
  }

  /**
   * Preload model into memory for faster inference
   */
  async preloadModel(modelName: string): Promise<boolean> {
    try {
      // Send empty prompt to load model
      await this.executeInference(modelName, '', { 
        timeout: 30000, // 30 second timeout for model loading
        maxTokens: 1
      });
      
      console.log(`Model ${modelName} preloaded successfully`);
      return true;
    } catch (error) {
      console.error(`Failed to preload model ${modelName}:`, error);
      return false;
    }
  }

  /**
   * Get model performance metrics for optimization
   */
  getInferenceMetrics(): {
    totalInferences: number;
    averageExecutionTime: number;
    successRate: number;
    modelUsage: Record<string, number>;
  } {
    // This would integrate with metrics collection system
    // For now, return placeholder data
    return {
      totalInferences: 0,
      averageExecutionTime: 0,
      successRate: 1.0,
      modelUsage: {},
    };
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
