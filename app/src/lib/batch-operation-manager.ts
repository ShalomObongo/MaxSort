import { EventEmitter } from 'events';
import { DatabaseManager } from './database';
import { Logger } from './logger';
import { OperationValidator, ValidationResult, FileOperation } from './operation-validator';

interface PriorityItem<T> {
  item: T;
  priority: number;
}

class BatchPriorityQueue<T> {
  private items: PriorityItem<T>[] = [];

  enqueue(item: T, priority: number): void {
    this.items.push({ item, priority });
    this.items.sort((a, b) => b.priority - a.priority); // Higher priority first
  }

  dequeue(): T | null {
    const item = this.items.shift();
    return item ? item.item : null;
  }

  isEmpty(): boolean {
    return this.items.length === 0;
  }

  size(): number {
    return this.items.length;
  }
}

export interface BatchOperation {
  id: string;
  type: 'rename' | 'move' | 'delete';
  fileId: number;
  originalPath: string;
  targetPath: string;
  confidence: number;
  priority: 'high' | 'medium' | 'low';
  status: 'pending' | 'processing' | 'completed' | 'failed';
  createdAt: number;
  error?: string;
}

export interface BatchGroup {
  id: string;
  operations: BatchOperation[];
  type: 'interactive' | 'background';
  priority: number;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  progress: {
    total: number;
    completed: number;
    failed: number;
    successRate: number;
  };
}

export interface BatchOperationManagerConfig {
  maxBatchSize: number;
  batchTimeoutMs: number;
  maxConcurrentOperations: number;
  priorityWeights: {
    interactive: number;
    background: number;
  };
}

export class BatchOperationManager extends EventEmitter {
  private readonly config: BatchOperationManagerConfig;
  private readonly database: DatabaseManager;
  private readonly logger: Logger;
  private readonly validator: OperationValidator;
  private readonly priorityQueue: BatchPriorityQueue<BatchGroup>;
  private readonly pendingOperations: Map<string, BatchOperation> = new Map();
  private readonly activeBatches: Map<string, BatchGroup> = new Map();
  private batchTimer: NodeJS.Timeout | null = null;
  private isProcessing = false;

  constructor(
    database: DatabaseManager,
    logger: Logger,
    config: Partial<BatchOperationManagerConfig> = {}
  ) {
    super();
    
    this.database = database;
    this.logger = logger;
    this.validator = new OperationValidator(database, logger);
    this.config = {
      maxBatchSize: 100,
      batchTimeoutMs: 5000,
      maxConcurrentOperations: 15,
      priorityWeights: {
        interactive: 100,
        background: 50,
      },
      ...config,
    };

    // Initialize priority queue
    this.priorityQueue = new BatchPriorityQueue<BatchGroup>();

    this.startBatchTimer();
  }

  /**
   * Add operation to batch queue with priority handling
   */
  public addOperation(operation: Omit<BatchOperation, 'id' | 'status' | 'createdAt'>): string {
    const batchOperation: BatchOperation = {
      ...operation,
      id: this.generateOperationId(),
      status: 'pending',
      createdAt: Date.now(),
    };

    this.pendingOperations.set(batchOperation.id, batchOperation);
    
    this.logger.debug('BatchOperationManager', 'Added operation to batch queue', {
      operationId: batchOperation.id,
      type: batchOperation.type,
      priority: batchOperation.priority,
      fileId: batchOperation.fileId,
    });

    // Trigger immediate batch creation for high-priority operations
    if (batchOperation.priority === 'high') {
      this.processPendingOperations(true);
    }

    return batchOperation.id;
  }

  /**
   * Create batch from multiple operations
   */
  public createBatch(
    operationIds: string[],
    type: 'interactive' | 'background' = 'background'
  ): string {
    const operations = operationIds
      .map(id => this.pendingOperations.get(id))
      .filter(op => op !== undefined) as BatchOperation[];

    if (operations.length === 0) {
      throw new Error('No valid operations found for batch creation');
    }

    const batchGroup = this.createBatchGroup(operations, type);
    this.enqueueBatch(batchGroup);

    // Remove operations from pending queue
    operationIds.forEach(id => this.pendingOperations.delete(id));

    this.logger.info('BatchOperationManager', 'Created batch group', {
      batchId: batchGroup.id,
      operationCount: operations.length,
      type: batchGroup.type,
      priority: batchGroup.priority,
    });

    return batchGroup.id;
  }

  /**
   * Cancel ongoing batch operation
   */
  public async cancelBatch(batchId: string): Promise<boolean> {
    const batch = this.activeBatches.get(batchId);
    if (!batch) {
      return false;
    }

    batch.status = 'cancelled';
    
    this.logger.info('BatchOperationManager', 'Cancelling batch operation', {
      batchId,
      completedOperations: batch.progress.completed,
      totalOperations: batch.progress.total,
    });

    this.emit('batch-cancelled', { batchId, batch });
    return true;
  }

  /**
   * Get batch status and progress
   */
  public getBatchStatus(batchId: string): BatchGroup | null {
    return this.activeBatches.get(batchId) || null;
  }

  /**
   * Get all active batches
   */
  public getActiveBatches(): BatchGroup[] {
    return Array.from(this.activeBatches.values());
  }

  /**
   * Start processing queued batches
   */
  public async startProcessing(): Promise<void> {
    if (this.isProcessing) {
      return;
    }

    this.isProcessing = true;
    this.logger.info('BatchOperationManager', 'Starting batch operation processing');

    while (!this.priorityQueue.isEmpty() && this.isProcessing) {
      if (this.activeBatches.size >= this.config.maxConcurrentOperations) {
        // Wait for some batches to complete
        await this.waitForBatchCompletion();
        continue;
      }

      const batch = this.priorityQueue.dequeue();
      if (batch) {
        this.processBatch(batch);
      }
    }
  }

  /**
   * Stop processing batches
   */
  public stopProcessing(): void {
    this.isProcessing = false;
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }
    this.logger.info('BatchOperationManager', 'Stopped batch operation processing');
  }

  /**
   * Get queue statistics
   */
  public getQueueStats() {
    return {
      queuedBatches: this.priorityQueue.size(),
      activeBatches: this.activeBatches.size,
      pendingOperations: this.pendingOperations.size,
      isProcessing: this.isProcessing,
    };
  }

  /**
   * Validate a batch of operations before execution
   */
  public async validateBatch(operations: BatchOperation[]): Promise<ValidationResult> {
    const fileOperations: FileOperation[] = operations.map(op => ({
      id: op.id,
      type: op.type,
      sourcePath: op.originalPath,
      targetPath: op.targetPath,
      fileId: op.fileId
    }));

    return await this.validator.validateBatch(fileOperations, {
      allowSystemFiles: false,
      allowHiddenFiles: false,
      checkDiskSpace: true,
      validatePermissions: true,
      checkConflicts: true,
      maxDepth: 10
    });
  }

  private startBatchTimer(): void {
    this.batchTimer = setTimeout(() => {
      this.processPendingOperations(false);
      this.startBatchTimer();
    }, this.config.batchTimeoutMs);
  }

  private processPendingOperations(immediate: boolean): void {
    const operations = Array.from(this.pendingOperations.values());
    
    if (operations.length === 0) {
      return;
    }

    // Group operations by priority and type
    const interactiveOps = operations.filter(op => op.priority === 'high');
    const backgroundOps = operations.filter(op => op.priority !== 'high');

    // Create batches for interactive operations immediately
    if (interactiveOps.length > 0) {
      const batches = this.createBatchesFromOperations(interactiveOps, 'interactive');
      batches.forEach(batch => this.enqueueBatch(batch));
      interactiveOps.forEach(op => this.pendingOperations.delete(op.id));
    }

    // Create batches for background operations if conditions are met
    if (immediate || backgroundOps.length >= this.config.maxBatchSize) {
      const batches = this.createBatchesFromOperations(backgroundOps, 'background');
      batches.forEach(batch => this.enqueueBatch(batch));
      backgroundOps.forEach(op => this.pendingOperations.delete(op.id));
    }
  }

  private createBatchesFromOperations(
    operations: BatchOperation[],
    type: 'interactive' | 'background'
  ): BatchGroup[] {
    const batches: BatchGroup[] = [];
    
    for (let i = 0; i < operations.length; i += this.config.maxBatchSize) {
      const batchOps = operations.slice(i, i + this.config.maxBatchSize);
      const batch = this.createBatchGroup(batchOps, type);
      batches.push(batch);
    }

    return batches;
  }

  private createBatchGroup(
    operations: BatchOperation[],
    type: 'interactive' | 'background'
  ): BatchGroup {
    return {
      id: this.generateBatchId(),
      operations,
      type,
      priority: this.config.priorityWeights[type],
      status: 'pending',
      createdAt: Date.now(),
      progress: {
        total: operations.length,
        completed: 0,
        failed: 0,
        successRate: 0,
      },
    };
  }

  private enqueueBatch(batch: BatchGroup): void {
    this.priorityQueue.enqueue(batch, batch.priority);
    this.emit('batch-queued', { batchId: batch.id, batch });
  }

  private async processBatch(batch: BatchGroup): Promise<void> {
    this.activeBatches.set(batch.id, batch);
    batch.status = 'processing';
    batch.startedAt = Date.now();

    this.logger.info('BatchOperationManager', 'Processing batch', {
      batchId: batch.id,
      operationCount: batch.operations.length,
      type: batch.type,
    });

    this.emit('batch-started', { batchId: batch.id, batch });

    try {
      // Validate batch operations before processing
      this.logger.info('BatchOperationManager', 'Validating batch operations', { batchId: batch.id });
      const validationResult = await this.validateBatch(batch.operations);
      
      if (!validationResult.isValid) {
        const errorMessage = `Batch validation failed: ${validationResult.errors.map(e => e.message).join('; ')}`;
        this.logger.error('BatchOperationManager', errorMessage);
        
        // Mark all operations as failed due to validation
        batch.operations.forEach(op => {
          op.status = 'failed';
          op.error = errorMessage;
        });
        
        batch.status = 'failed';
        batch.completedAt = Date.now();
        
        this.emit('batch-failed', { 
          batchId: batch.id, 
          batch, 
          error: errorMessage,
          validationResult 
        });
        
        this.activeBatches.delete(batch.id);
        return;
      }

      // Log validation warnings if any
      if (validationResult.warnings.length > 0) {
        this.logger.warn('BatchOperationManager', 'Batch validation warnings', {
          batchId: batch.id,
          warnings: validationResult.warnings.map(w => w.message)
        });
      }

      // Process operations in parallel with concurrency limit
      const concurrencyLimit = Math.min(
        batch.operations.length,
        Math.ceil(this.config.maxConcurrentOperations / this.activeBatches.size)
      );

      await this.processOperationsConcurrently(batch, concurrencyLimit);

      batch.status = batch.progress.failed === 0 ? 'completed' : 'failed';
      batch.completedAt = Date.now();
      
      this.logger.info('BatchOperationManager', 'Batch completed', {
        batchId: batch.id,
        successRate: batch.progress.successRate,
        duration: batch.completedAt - (batch.startedAt || 0),
      });

      this.emit('batch-completed', { batchId: batch.id, batch });
    } catch (error) {
      batch.status = 'failed';
      batch.completedAt = Date.now();
      
      this.logger.error('BatchOperationManager', 'Batch processing failed', error as Error, {
        batchId: batch.id,
      });

      this.emit('batch-failed', { batchId: batch.id, batch, error });
    } finally {
      this.activeBatches.delete(batch.id);
    }
  }

  private async processOperationsConcurrently(
    batch: BatchGroup,
    concurrencyLimit: number
  ): Promise<void> {
    const operations = [...batch.operations];
    const processing: Promise<void>[] = [];

    while (operations.length > 0 || processing.length > 0) {
      // Start new operations up to concurrency limit
      while (processing.length < concurrencyLimit && operations.length > 0) {
        const operation = operations.shift()!;
        const promise = this.processOperation(batch, operation);
        processing.push(promise);
      }

      // Wait for at least one operation to complete
      if (processing.length > 0) {
        await Promise.race(processing);
        
        // Remove completed promises
        for (let i = processing.length - 1; i >= 0; i--) {
          const promise = processing[i];
          if (await this.isPromiseResolved(promise)) {
            processing.splice(i, 1);
          }
        }
      }

      // Update progress
      this.updateBatchProgress(batch);
      this.emit('batch-progress', { batchId: batch.id, batch });
    }
  }

  private async processOperation(batch: BatchGroup, operation: BatchOperation): Promise<void> {
    try {
      operation.status = 'processing';
      
      // Emit operation-specific events through the existing system
      this.emit('operation-started', { batchId: batch.id, operation });

      // The actual file operation will be handled by TransactionalFileManager
      // For now, we just mark it as completed
      operation.status = 'completed';
      batch.progress.completed++;

      this.emit('operation-completed', { batchId: batch.id, operation });
    } catch (error) {
      operation.status = 'failed';
      batch.progress.failed++;
      
      this.logger.error('BatchOperationManager', 'Operation failed', error as Error, {
        batchId: batch.id,
        operationId: operation.id,
        fileId: operation.fileId,
      });

      this.emit('operation-failed', { batchId: batch.id, operation, error });
    }
  }

  private updateBatchProgress(batch: BatchGroup): void {
    const completed = batch.operations.filter(op => 
      op.status === 'completed' || op.status === 'failed'
    ).length;
    
    batch.progress.completed = batch.operations.filter(op => op.status === 'completed').length;
    batch.progress.failed = batch.operations.filter(op => op.status === 'failed').length;
    batch.progress.successRate = completed > 0 ? (batch.progress.completed / completed) * 100 : 0;
  }

  private async waitForBatchCompletion(): Promise<void> {
    return new Promise(resolve => {
      const checkCompletion = () => {
        if (this.activeBatches.size < this.config.maxConcurrentOperations) {
          resolve();
        } else {
          setTimeout(checkCompletion, 100);
        }
      };
      checkCompletion();
    });
  }

  private async isPromiseResolved(promise: Promise<void>): Promise<boolean> {
    try {
      await Promise.race([
        promise,
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 0))
      ]);
      return true;
    } catch {
      // Check if the promise has settled (either fulfilled or rejected)
      const results = await Promise.allSettled([promise]);
      return results[0].status === 'fulfilled' || results[0].status === 'rejected';
    }
  }

  private generateOperationId(): string {
    return `op_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }

  private generateBatchId(): string {
    return `batch_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }
}
