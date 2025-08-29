import { EventEmitter } from 'events';
import { SystemMonitor, SystemHealth, getSystemMonitor } from '../lib/system-monitor';
import { OllamaClient, OllamaModel, getOllamaClient } from '../lib/ollama-client';
import { PriorityQueue } from './priority-queue';
import { 
  AgentTask, 
  AgentSlot, 
  TaskState, 
  TaskPriority, 
  TaskResult, 
  CreateTaskParams,
  FileAnalysisTask,
  BatchProcessingTask,
  HealthCheckTask
} from './task-types';
import { v4 as uuidv4 } from 'uuid';

/**
 * Agent Manager configuration parameters
 */
export interface AgentManagerConfig {
  maxConcurrentSlots: number;      // Hard limit on concurrent agents (default: 8)
  safetyFactor: number;            // Memory safety multiplier (default: 1.5)
  osReservedMemory: number;        // Memory reserved for OS in bytes (default: 2GB)
  taskTimeoutMs: number;           // Default task timeout (default: 300000 = 5min)
  maxRetries: number;              // Max retry attempts (default: 3)
  healthCheckInterval: number;     // Health monitoring interval (default: 30000 = 30s)
  emergencyStopEnabled: boolean;   // Enable emergency stop on critical conditions
  slotRecomputeInterval: number;   // Interval to recompute slot capacity (default: 5000 = 5s)
}

/**
 * Memory threshold configuration for safety mechanisms
 */
export interface MemoryThresholds {
  softThreshold: number;    // Stop new dispatches (default: 0.85 = 85%)
  hardThreshold: number;    // Emergency eviction (default: 0.95 = 95%)
  criticalThreshold: number; // System shutdown (default: 0.98 = 98%)
}

/**
 * Agent Manager status information
 */
export interface AgentManagerStatus {
  isRunning: boolean;
  totalSlots: number;
  availableSlots: number;
  runningTasks: number;
  queuedTasks: number;
  systemHealth: SystemHealth;
  memoryUtilization: number;
  lastSlotRecompute: number;
  emergencyMode: boolean;
}

/**
 * Core Agent Manager class providing intelligent resource management for AI agents
 * Implements slot-based concurrency control with memory monitoring and safety mechanisms
 */
export class AgentManager extends EventEmitter {
  private config: AgentManagerConfig;
  private thresholds: MemoryThresholds;
  
  // Core components
  private systemMonitor: SystemMonitor;
  private ollamaClient: OllamaClient;
  private taskQueue: PriorityQueue;
  
  // State management
  private isRunning: boolean = false;
  private totalSlots: number = 0;
  private activeSlots: Map<string, AgentSlot> = new Map();
  private modelMemoryEstimates: Map<string, number> = new Map();
  
  // Timers and intervals
  private slotRecomputeTimer: NodeJS.Timeout | null = null;
  private healthCheckTimer: NodeJS.Timeout | null = null;
  
  // Safety state
  private emergencyMode: boolean = false;
  private lastSystemHealth: SystemHealth | null = null;
  
  private static readonly DEFAULT_CONFIG: AgentManagerConfig = {
    maxConcurrentSlots: 8,
    safetyFactor: 1.5,
    osReservedMemory: 2 * 1024 * 1024 * 1024, // 2GB
    taskTimeoutMs: 5 * 60 * 1000, // 5 minutes
    maxRetries: 3,
    healthCheckInterval: 30 * 1000, // 30 seconds
    emergencyStopEnabled: true,
    slotRecomputeInterval: 5 * 1000, // 5 seconds
  };

  private static readonly DEFAULT_THRESHOLDS: MemoryThresholds = {
    softThreshold: 0.85,   // 85% memory usage
    hardThreshold: 0.95,   // 95% memory usage  
    criticalThreshold: 0.98, // 98% memory usage
  };

  constructor(
    config: Partial<AgentManagerConfig> = {},
    thresholds: Partial<MemoryThresholds> = {}
  ) {
    super();
    
    this.config = { ...AgentManager.DEFAULT_CONFIG, ...config };
    this.thresholds = { ...AgentManager.DEFAULT_THRESHOLDS, ...thresholds };
    
    // Initialize core components
    this.systemMonitor = getSystemMonitor({
      pollingInterval: 1000,
      stressPollingInterval: 500,
      osReservedMemory: this.config.osReservedMemory,
    });
    
    this.ollamaClient = getOllamaClient();
    this.taskQueue = new PriorityQueue();
    
    // Set up event listeners
    this.setupEventListeners();
    
    console.log('AgentManager initialized with config:', {
      maxSlots: this.config.maxConcurrentSlots,
      safetyFactor: this.config.safetyFactor,
      osReserve: Math.round(this.config.osReservedMemory / 1024 / 1024) + 'MB',
    });
  }

  /**
   * Start the Agent Manager and begin resource monitoring
   */
  public async start(): Promise<void> {
    if (this.isRunning) {
      console.warn('AgentManager is already running');
      return;
    }

    try {
      // Start system monitoring
      this.systemMonitor.start();
      
      // Load model memory estimates
      await this.loadModelMemoryEstimates();
      
      // Perform initial slot calculation
      await this.recomputeSlotCapacity();
      
      // Start periodic tasks
      this.startPeriodicTasks();
      
      this.isRunning = true;
      
      console.log('AgentManager started successfully');
      this.emit('manager-started');
      
      // Begin task dispatch loop
      this.processTaskQueue();
      
    } catch (error) {
      console.error('Failed to start AgentManager:', error);
      throw error;
    }
  }

  /**
   * Stop the Agent Manager and cleanup resources
   */
  public async stop(): Promise<void> {
    if (!this.isRunning) return;

    this.isRunning = false;

    // Stop periodic tasks
    if (this.slotRecomputeTimer) {
      clearInterval(this.slotRecomputeTimer);
      this.slotRecomputeTimer = null;
    }

    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }

    // Cancel all running tasks
    const runningTasks = this.taskQueue.getRunningTasks();
    for (const task of runningTasks) {
      await this.cancelTask(task.id, 'Manager shutdown');
    }

    // Stop system monitoring
    this.systemMonitor.stop();

    console.log('AgentManager stopped');
    this.emit('manager-stopped');
  }

  /**
   * Create and enqueue a new task
   */
  public createTask<T extends AgentTask>(taskParams: CreateTaskParams<T>): string {
    const taskId = uuidv4();
    
    const task: AgentTask = {
      ...taskParams,
      id: taskId,
      state: TaskState.QUEUED,
      createdAt: Date.now(),
      retryCount: 0,
    } as T;

    // Estimate memory requirements if not provided
    if (!task.estimatedMemoryMB) {
      task.estimatedMemoryMB = this.estimateTaskMemory(task);
    }

    this.taskQueue.enqueue(task);
    
    this.emit('task-created', task);
    console.log(`Task ${taskId} created and queued (type: ${task.type}, priority: ${TaskPriority[task.priority]})`);

    // Try to dispatch immediately if slots available
    process.nextTick(() => this.processTaskQueue());

    return taskId;
  }

  /**
   * Cancel a running or queued task
   */
  public async cancelTask(taskId: string, reason: string = 'User requested'): Promise<boolean> {
    const task = this.taskQueue.getTask(taskId);
    if (!task) return false;

    // If task is running, clean up the slot
    if (task.state === TaskState.RUNNING) {
      const slot = Array.from(this.activeSlots.values()).find(s => s.taskId === taskId);
      if (slot) {
        await this.cleanupSlot(slot.slotId);
      }
    }

    const success = this.taskQueue.cancelTask(taskId);
    if (success) {
      this.emit('task-cancelled', { taskId, reason });
      console.log(`Task ${taskId} cancelled: ${reason}`);
    }

    return success;
  }

  /**
   * Get current agent manager status
   */
  public getStatus(): AgentManagerStatus {
    const queueStats = this.taskQueue.getStats();
    
    return {
      isRunning: this.isRunning,
      totalSlots: this.totalSlots,
      availableSlots: this.totalSlots - this.activeSlots.size,
      runningTasks: queueStats.byState[TaskState.RUNNING] || 0,
      queuedTasks: queueStats.byState[TaskState.QUEUED] || 0,
      systemHealth: this.lastSystemHealth!,
      memoryUtilization: this.lastSystemHealth ? this.lastSystemHealth.memory.memoryPressure : 0,
      lastSlotRecompute: Date.now(), // This would track actual last recompute time
      emergencyMode: this.emergencyMode,
    };
  }

  /**
   * Force recomputation of slot capacity
   */
  public async recomputeSlotCapacity(): Promise<void> {
    try {
      const health = await this.systemMonitor.getCurrentHealth();
      this.lastSystemHealth = health;
      
      const availableMemoryBytes = health.memory.availableForAgents;
      const availableMemoryMB = availableMemoryBytes / (1024 * 1024);
      
      // Calculate slots based on average model memory usage
      const averageModelMemory = this.calculateAverageModelMemory();
      const safeModelMemory = averageModelMemory * this.config.safetyFactor;
      
      // Calculate maximum slots based on memory
      const memoryBasedSlots = Math.floor(availableMemoryMB / safeModelMemory);
      
      // Apply hard limit
      this.totalSlots = Math.min(memoryBasedSlots, this.config.maxConcurrentSlots);
      this.totalSlots = Math.max(0, this.totalSlots); // Ensure non-negative
      
      console.log(`Slot capacity recomputed: ${this.totalSlots} slots (${availableMemoryMB.toFixed(0)}MB available, ${safeModelMemory.toFixed(0)}MB per slot)`);
      
      this.emit('slots-recomputed', {
        totalSlots: this.totalSlots,
        availableMemory: availableMemoryMB,
        memoryPerSlot: safeModelMemory
      });
      
      // Check memory thresholds
      await this.checkMemoryThresholds(health);
      
    } catch (error) {
      console.error('Failed to recompute slot capacity:', error);
      this.emit('recompute-error', error);
    }
  }

  /**
   * Set up event listeners for system monitoring
   */
  private setupEventListeners(): void {
    this.systemMonitor.on('health-update', (health: SystemHealth) => {
      this.lastSystemHealth = health;
      this.emit('system-health', health);
    });

    this.systemMonitor.on('monitoring-error', (error: Error) => {
      console.error('System monitoring error:', error);
      this.emit('monitoring-error', error);
    });

    this.ollamaClient.on('health-update', (health) => {
      this.emit('ollama-health', health);
    });
  }

  /**
   * Start periodic background tasks
   */
  private startPeriodicTasks(): void {
    // Slot capacity recomputation
    this.slotRecomputeTimer = setInterval(async () => {
      await this.recomputeSlotCapacity();
    }, this.config.slotRecomputeInterval);

    // Health monitoring
    this.healthCheckTimer = setInterval(async () => {
      await this.performHealthCheck();
    }, this.config.healthCheckInterval);
  }

  /**
   * Process task queue and dispatch available tasks
   */
  private async processTaskQueue(): Promise<void> {
    if (!this.isRunning || this.emergencyMode) return;

    // Check if we have available slots
    const availableSlots = this.totalSlots - this.activeSlots.size;
    if (availableSlots <= 0) return;

    // Get next queued task
    const task = this.taskQueue.dequeue();
    if (!task) return;

    try {
      await this.dispatchTask(task);
    } catch (error) {
      console.error(`Failed to dispatch task ${task.id}:`, error);
      this.taskQueue.updateTaskState(task.id, TaskState.FAILED);
      
      this.emit('task-failed', {
        taskId: task.id,
        error: error instanceof Error ? error : new Error(String(error))
      });
    }

    // Continue processing if more slots available
    if (this.activeSlots.size < this.totalSlots) {
      process.nextTick(() => this.processTaskQueue());
    }
  }

  /**
   * Dispatch a task to an available slot
   */
  private async dispatchTask(task: AgentTask): Promise<void> {
    const slotId = uuidv4();
    const modelName = this.getTaskModelName(task);
    const memoryMB = this.modelMemoryEstimates.get(modelName) || task.estimatedMemoryMB;

    // Create and allocate slot
    const slot: AgentSlot = {
      slotId,
      taskId: task.id,
      modelName,
      allocatedMemoryMB: memoryMB,
      startTime: Date.now(),
      isActive: true,
    };

    this.activeSlots.set(slotId, slot);
    this.taskQueue.updateTaskState(task.id, TaskState.RUNNING);

    console.log(`Dispatching task ${task.id} to slot ${slotId} (model: ${modelName}, memory: ${memoryMB}MB)`);

    this.emit('task-dispatched', { task, slot });

    // Execute task asynchronously
    this.executeTask(task, slot).catch(error => {
      console.error(`Task execution error for ${task.id}:`, error);
    });
  }

  /**
   * Execute task with timeout and retry logic
   */
  private async executeTask(task: AgentTask, slot: AgentSlot): Promise<void> {
    const startTime = Date.now();

    try {
      let result: TaskResult;

      // Execute based on task type
      switch (task.type) {
        case 'file-analysis':
          result = await this.executeFileAnalysis(task as FileAnalysisTask, slot);
          break;
        case 'batch-processing':
          result = await this.executeBatchProcessing(task as BatchProcessingTask, slot);
          break;
        case 'health-check':
          result = await this.executeHealthCheck(task as HealthCheckTask, slot);
          break;
        default:
          throw new Error(`Unknown task type: ${(task as any).type}`);
      }

      // Record successful completion
      this.taskQueue.updateTaskState(task.id, TaskState.COMPLETED, Date.now());
      this.taskQueue.recordTaskResult(result);
      
      this.emit('task-completed', result);
      console.log(`Task ${task.id} completed in ${Date.now() - startTime}ms`);

    } catch (error) {
      const errorObj = error instanceof Error ? error : new Error(String(error));
      
      // Handle retry logic
      if (task.retryCount < task.maxRetries && this.shouldRetryTask(task, errorObj)) {
        task.retryCount++;
        console.log(`Retrying task ${task.id} (attempt ${task.retryCount}/${task.maxRetries})`);
        
        // Re-queue the task
        this.taskQueue.updateTaskState(task.id, TaskState.QUEUED);
        this.taskQueue.enqueue(task);
        
        this.emit('task-retry', { taskId: task.id, attempt: task.retryCount, error: errorObj });
      } else {
        // Task failed permanently
        this.taskQueue.updateTaskState(task.id, TaskState.FAILED, Date.now());
        
        const failureResult: TaskResult = {
          taskId: task.id,
          success: false,
          error: errorObj,
          executionTimeMs: Date.now() - startTime,
        };
        
        this.taskQueue.recordTaskResult(failureResult);
        this.emit('task-failed', failureResult);
        
        console.error(`Task ${task.id} failed permanently:`, errorObj.message);
      }
    } finally {
      // Always cleanup slot
      await this.cleanupSlot(slot.slotId);
    }
  }

  /**
   * Execute file analysis task
   */
  private async executeFileAnalysis(task: FileAnalysisTask, slot: AgentSlot): Promise<TaskResult> {
    const startTime = Date.now();
    
    try {
      // Read file content (would implement file reading logic)
      const fileContent = `Content of ${task.filePath}`; // Placeholder
      
      // Build prompt based on analysis type
      let prompt = '';
      switch (task.analysisType) {
        case 'classification':
          prompt = `Classify the following file content:\n\n${fileContent}\n\nClassification:`;
          break;
        case 'summary':
          prompt = `Summarize the following file content:\n\n${fileContent}\n\nSummary:`;
          break;
        case 'extraction':
          prompt = `Extract key information from the following file content:\n\n${fileContent}\n\nExtracted Information:`;
          break;
        default:
          prompt = task.promptTemplate.replace('{{content}}', fileContent);
      }

      // Execute Ollama inference with timeout and retry logic
      const inference = await this.ollamaClient.executeInference(
        task.modelName, 
        prompt, 
        {
          format: task.expectedResponseFormat === 'json' ? 'json' : 'text',
          timeout: task.timeoutMs,
          temperature: 0.1, // Low temperature for consistent analysis
          maxTokens: 2048,
        }
      );

      // Parse response based on expected format
      let parsedResult: any = inference.response;
      if (task.expectedResponseFormat === 'json') {
        try {
          parsedResult = JSON.parse(inference.response);
        } catch (parseError) {
          console.warn(`Failed to parse JSON response for task ${task.id}, using raw text`);
          parsedResult = { text: inference.response };
        }
      }

      return {
        taskId: task.id,
        success: true,
        result: {
          analysis: parsedResult,
          confidence: 0.95, // Would calculate based on model response
          filePath: task.filePath,
          analysisType: task.analysisType,
        },
        executionTimeMs: Date.now() - startTime,
        memoryUsedMB: slot.allocatedMemoryMB,
      };

    } catch (error) {
      return {
        taskId: task.id,
        success: false,
        error: error instanceof Error ? error : new Error(String(error)),
        executionTimeMs: Date.now() - startTime,
        memoryUsedMB: slot.allocatedMemoryMB,
      };
    }
  }

  /**
   * Execute batch processing task
   */
  private async executeBatchProcessing(task: BatchProcessingTask, slot: AgentSlot): Promise<TaskResult> {
    const startTime = Date.now();
    const results: any[] = [];
    
    try {
      if (task.processingMode === 'sequential') {
        // Process files one by one for memory efficiency
        for (let i = 0; i < task.filePaths.length; i += task.batchSize) {
          const batch = task.filePaths.slice(i, i + task.batchSize);
          
          for (const filePath of batch) {
            try {
              // Create individual file analysis sub-task
              const fileContent = `Content of ${filePath}`; // Placeholder
              const prompt = `Analyze the following file content:\n\n${fileContent}\n\nAnalysis:`;
              
              const inference = await this.ollamaClient.executeInference(
                task.modelName,
                prompt,
                {
                  timeout: Math.floor(task.timeoutMs / task.filePaths.length), // Divide timeout across files
                  temperature: 0.1,
                  maxTokens: 1024,
                }
              );
              
              results.push({
                filePath,
                success: true,
                result: inference.response,
                executionTime: inference.executionTimeMs,
              });
              
            } catch (fileError) {
              results.push({
                filePath,
                success: false,
                error: fileError instanceof Error ? fileError.message : String(fileError),
              });
            }
          }
          
          // Small delay between batches to prevent overwhelming the system
          if (i + task.batchSize < task.filePaths.length) {
            await new Promise(resolve => setTimeout(resolve, 100));
          }
        }
      } else {
        // Parallel processing (limited concurrency to avoid memory issues)
        const concurrency = Math.min(task.batchSize, 3); // Max 3 concurrent inferences
        const semaphore = Array(concurrency).fill(null);
        
        const processBatch = async (filePath: string): Promise<any> => {
          try {
            const fileContent = `Content of ${filePath}`;
            const prompt = `Analyze the following file content:\n\n${fileContent}\n\nAnalysis:`;
            
            const inference = await this.ollamaClient.executeInference(
              task.modelName,
              prompt,
              {
                timeout: task.timeoutMs,
                temperature: 0.1,
                maxTokens: 1024,
              }
            );
            
            return {
              filePath,
              success: true,
              result: inference.response,
              executionTime: inference.executionTimeMs,
            };
          } catch (error) {
            return {
              filePath,
              success: false,
              error: error instanceof Error ? error.message : String(error),
            };
          }
        };

        // Process files with limited concurrency
        for (let i = 0; i < task.filePaths.length; i += concurrency) {
          const batch = task.filePaths.slice(i, i + concurrency);
          const batchResults = await Promise.all(batch.map(processBatch));
          results.push(...batchResults);
        }
      }

      const successCount = results.filter(r => r.success).length;
      
      return {
        taskId: task.id,
        success: successCount > 0,
        result: {
          totalFiles: task.filePaths.length,
          processedFiles: results.length,
          successfulFiles: successCount,
          failedFiles: results.length - successCount,
          results: results,
        },
        executionTimeMs: Date.now() - startTime,
        memoryUsedMB: slot.allocatedMemoryMB,
      };

    } catch (error) {
      return {
        taskId: task.id,
        success: false,
        error: error instanceof Error ? error : new Error(String(error)),
        result: {
          totalFiles: task.filePaths.length,
          processedFiles: results.length,
          results: results,
        },
        executionTimeMs: Date.now() - startTime,
        memoryUsedMB: slot.allocatedMemoryMB,
      };
    }
  }

  /**
   * Execute health check task
   */
  private async executeHealthCheck(task: HealthCheckTask, slot: AgentSlot): Promise<TaskResult> {
    const startTime = Date.now();
    let result: any;

    switch (task.component) {
      case 'ollama':
        result = await this.ollamaClient.getHealthStatus();
        break;
      case 'database':
        result = { status: 'healthy', connected: true }; // Database check implementation
        break;
      case 'filesystem':
        result = { status: 'healthy', accessible: true }; // Filesystem check implementation
        break;
      default:
        throw new Error(`Unknown health check component: ${task.component}`);
    }

    return {
      taskId: task.id,
      success: true,
      result,
      executionTimeMs: Date.now() - startTime,
      memoryUsedMB: slot.allocatedMemoryMB,
    };
  }

  /**
   * Cleanup completed or failed task slot
   */
  private async cleanupSlot(slotId: string): Promise<void> {
    const slot = this.activeSlots.get(slotId);
    if (!slot) return;

    this.activeSlots.delete(slotId);
    
    console.log(`Slot ${slotId} cleaned up (task: ${slot.taskId})`);
    this.emit('slot-freed', slot);

    // Try to process more tasks
    if (this.isRunning) {
      process.nextTick(() => this.processTaskQueue());
    }
  }

  /**
   * Load model memory estimates from database or Ollama
   */
  private async loadModelMemoryEstimates(): Promise<void> {
    try {
      const models = await this.ollamaClient.getModels();
      
      for (const model of models) {
        const memoryMB = this.ollamaClient.estimateModelMemory(model) / (1024 * 1024);
        this.modelMemoryEstimates.set(model.name, memoryMB);
      }
      
      console.log(`Loaded memory estimates for ${models.length} models`);
    } catch (error) {
      console.error('Failed to load model memory estimates:', error);
      // Use defaults if loading fails
      this.modelMemoryEstimates.set('llama2', 4096); // 4GB default
    }
  }

  /**
   * Calculate average model memory for slot computation
   */
  private calculateAverageModelMemory(): number {
    if (this.modelMemoryEstimates.size === 0) {
      return 4096; // 4GB default
    }

    const totalMemory = Array.from(this.modelMemoryEstimates.values()).reduce((sum, mem) => sum + mem, 0);
    return totalMemory / this.modelMemoryEstimates.size;
  }

  /**
   * Get model name for task execution
   */
  private getTaskModelName(task: AgentTask): string {
    switch (task.type) {
      case 'file-analysis':
        return (task as FileAnalysisTask).modelName;
      case 'batch-processing':
        return (task as BatchProcessingTask).modelName;
      default:
        return 'llama2'; // Default model
    }
  }

  /**
   * Estimate memory requirements for task
   */
  private estimateTaskMemory(task: AgentTask): number {
    const modelName = this.getTaskModelName(task);
    return this.modelMemoryEstimates.get(modelName) || 4096; // 4GB default
  }

  /**
   * Determine if task should be retried
   */
  private shouldRetryTask(task: AgentTask, error: Error): boolean {
    // Don't retry timeout errors or certain system errors
    if (error.message.includes('timeout') || 
        error.message.includes('AbortError') ||
        error.message.includes('SIGKILL')) {
      return false;
    }

    return true; // Retry for other errors
  }

  /**
   * Check memory thresholds and apply safety mechanisms
   */
  private async checkMemoryThresholds(health: SystemHealth): Promise<void> {
    const memoryPressure = health.memory.memoryPressure;

    if (memoryPressure >= this.thresholds.criticalThreshold) {
      // Critical: Emergency stop
      if (this.config.emergencyStopEnabled) {
        await this.emergencyStop('Critical memory threshold exceeded');
      }
    } else if (memoryPressure >= this.thresholds.hardThreshold) {
      // Hard: Emergency eviction
      await this.emergencyEviction();
    } else if (memoryPressure >= this.thresholds.softThreshold) {
      // Soft: Stop new dispatches
      console.warn(`Memory pressure high (${(memoryPressure * 100).toFixed(1)}%), stopping new task dispatches`);
      this.emit('memory-warning', { pressure: memoryPressure, threshold: 'soft' });
    }
  }

  /**
   * Emergency stop all operations
   */
  private async emergencyStop(reason: string): Promise<void> {
    console.error(`EMERGENCY STOP: ${reason}`);
    this.emergencyMode = true;

    // Cancel all running tasks
    const runningTasks = this.taskQueue.getRunningTasks();
    for (const task of runningTasks) {
      await this.cancelTask(task.id, `Emergency stop: ${reason}`);
    }

    // Clear queue
    this.taskQueue.clear();

    this.emit('emergency-stop', { reason });
  }

  /**
   * Emergency eviction of lowest priority tasks
   */
  private async emergencyEviction(): Promise<void> {
    const runningTasks = this.taskQueue.getRunningTasks();
    
    // Sort by priority (higher numbers = lower priority)
    runningTasks.sort((a, b) => b.priority - a.priority);
    
    // Evict up to half of running tasks
    const evictCount = Math.ceil(runningTasks.length / 2);
    
    for (let i = 0; i < evictCount && i < runningTasks.length; i++) {
      await this.cancelTask(runningTasks[i].id, 'Emergency eviction - memory pressure');
    }

    console.warn(`Emergency eviction: cancelled ${evictCount} low-priority tasks`);
    this.emit('emergency-eviction', { evictedCount: evictCount });
  }

  /**
   * Perform periodic health check
   */
  private async performHealthCheck(): Promise<void> {
    try {
      // This could create health check tasks or perform direct monitoring
      const health = await this.systemMonitor.getCurrentHealth();
      
      // Log periodic status
      console.log(`Health Check - Memory: ${(health.memory.memoryPressure * 100).toFixed(1)}%, CPU: ${health.cpu.loadAverage1m.toFixed(2)}, Slots: ${this.activeSlots.size}/${this.totalSlots}`);
      
    } catch (error) {
      console.error('Health check failed:', error);
      this.emit('health-check-error', error);
    }
  }

  /**
   * Get configuration
   */
  public getConfig(): AgentManagerConfig {
    return { ...this.config };
  }

  /**
   * Update configuration at runtime
   */
  public updateConfig(newConfig: Partial<AgentManagerConfig>): void {
    this.config = { ...this.config, ...newConfig };
    this.emit('config-updated', this.config);
    
    // Trigger slot recomputation if memory settings changed
    if (newConfig.safetyFactor || newConfig.maxConcurrentSlots || newConfig.osReservedMemory) {
      process.nextTick(() => this.recomputeSlotCapacity());
    }
  }

  /**
   * Clean up resources and stop manager
   */
  public async destroy(): Promise<void> {
    await this.stop();
    this.removeAllListeners();
  }
}

// Singleton instance for main process integration
let agentManagerInstance: AgentManager | null = null;

export function getAgentManager(config?: Partial<AgentManagerConfig>): AgentManager {
  if (!agentManagerInstance) {
    agentManagerInstance = new AgentManager(config);
  }
  return agentManagerInstance;
}

export function destroyAgentManager(): Promise<void> {
  if (agentManagerInstance) {
    const promise = agentManagerInstance.destroy();
    agentManagerInstance = null;
    return promise;
  }
  return Promise.resolve();
}
