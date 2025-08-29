import { Logger } from './logger';
import { DatabaseManager } from './database';

export interface OperationJournalEntry {
  id: string;
  transactionId: string;
  operationId: string;
  type: 'rename' | 'move' | 'delete' | 'copy';
  sourceId: number;
  sourcePath: string;
  targetPath?: string;
  status: 'committed' | 'rolled_back';
  timestamp: number;
  userId?: string;
  undoData: UndoData;
  metadata: {
    fileSize: number;
    fileHash: string;
    originalMtime: number;
    backupPath?: string;
  };
}

export interface UndoData {
  reverseOperation: {
    type: 'rename' | 'move' | 'delete' | 'restore';
    sourcePath: string;
    targetPath?: string;
    restoreFromBackup?: string;
  };
  originalMetadata: {
    path: string;
    size: number;
    mtime: number;
    permissions: string;
  };
  dependencies: string[]; // Other operations that depend on this one
}

export interface OperationHistory {
  entries: OperationJournalEntry[];
  totalCount: number;
  pageSize: number;
  currentPage: number;
  hasMore: boolean;
}

export interface UndoResult {
  operationId: string;
  success: boolean;
  error?: string;
  duration: number;
  filesRestored: number;
}

export interface BatchUndoResult {
  transactionId: string;
  success: boolean;
  undoResults: UndoResult[];
  totalDuration: number;
  filesRestored: number;
  partialFailures: number;
}

export class OperationJournal {
  private readonly logger: Logger;
  private readonly database: DatabaseManager;
  private readonly maxJournalEntries = 10000;
  private readonly maxUndoHistoryDays = 30;

  constructor(database: DatabaseManager, logger: Logger) {
    this.database = database;
    this.logger = logger;
  }

  /**
   * Record a completed operation in the journal
   */
  public async recordOperation(
    transactionId: string,
    operationId: string,
    type: 'rename' | 'move' | 'delete' | 'copy',
    sourceId: number,
    sourcePath: string,
    targetPath: string | undefined,
    undoData: UndoData,
    metadata: OperationJournalEntry['metadata'],
    userId?: string
  ): Promise<string> {
    const entry: OperationJournalEntry = {
      id: this.generateJournalId(),
      transactionId,
      operationId,
      type,
      sourceId,
      sourcePath,
      targetPath,
      status: 'committed',
      timestamp: Date.now(),
      userId,
      undoData,
      metadata,
    };

    // Store in database - we'll extend the operations table schema
    await this.storeJournalEntry(entry);

    this.logger.info('OperationJournal', 'Operation recorded', {
      journalId: entry.id,
      transactionId,
      operationId,
      type,
    });

    // Clean up old entries periodically
    if (Math.random() < 0.01) { // 1% chance to trigger cleanup
      this.cleanupOldEntries().catch(error => {
        this.logger.warn('OperationJournal', 'Cleanup failed', { error });
      });
    }

    return entry.id;
  }

  /**
   * Undo a specific operation by ID
   */
  public async undoOperation(operationId: string): Promise<UndoResult> {
    const startTime = Date.now();

    try {
      const entry = await this.getJournalEntry(operationId);
      if (!entry) {
        throw new Error(`Operation not found: ${operationId}`);
      }

      if (entry.status === 'rolled_back') {
        throw new Error(`Operation already rolled back: ${operationId}`);
      }

      this.logger.info('OperationJournal', 'Starting undo operation', {
        operationId,
        type: entry.type,
        sourcePath: entry.sourcePath,
      });

      // Check for dependencies
      const dependencies = await this.checkUndoDependencies(entry);
      if (dependencies.length > 0) {
        throw new Error(`Cannot undo: operation has dependencies: ${dependencies.join(', ')}`);
      }

      // Execute the reverse operation
      await this.executeReverseOperation(entry);

      // Mark operation as rolled back
      await this.markAsRolledBack(entry.id);

      const duration = Date.now() - startTime;

      this.logger.info('OperationJournal', 'Undo operation completed', {
        operationId,
        duration,
      });

      return {
        operationId,
        success: true,
        duration,
        filesRestored: 1,
      };

    } catch (error) {
      const duration = Date.now() - startTime;
      
      this.logger.error('OperationJournal', 'Undo operation failed', error as Error, {
        operationId,
      });

      return {
        operationId,
        success: false,
        error: (error as Error).message,
        duration,
        filesRestored: 0,
      };
    }
  }

  /**
   * Undo all operations in a transaction
   */
  public async undoTransaction(transactionId: string): Promise<BatchUndoResult> {
    const startTime = Date.now();

    try {
      const entries = await this.getTransactionEntries(transactionId);
      if (entries.length === 0) {
        throw new Error(`Transaction not found: ${transactionId}`);
      }

      const committedEntries = entries.filter(e => e.status === 'committed');
      if (committedEntries.length === 0) {
        throw new Error(`No committed operations to undo in transaction: ${transactionId}`);
      }

      this.logger.info('OperationJournal', 'Starting transaction undo', {
        transactionId,
        operationsToUndo: committedEntries.length,
      });

      const undoResults: UndoResult[] = [];
      let totalFilesRestored = 0;
      let partialFailures = 0;

      // Undo operations in reverse order (LIFO)
      const operationsToUndo = committedEntries.reverse();
      
      for (const entry of operationsToUndo) {
        const result = await this.undoOperation(entry.operationId);
        undoResults.push(result);
        
        if (result.success) {
          totalFilesRestored += result.filesRestored;
        } else {
          partialFailures++;
        }
      }

      const success = partialFailures === 0;
      const totalDuration = Date.now() - startTime;

      this.logger.info('OperationJournal', 'Transaction undo completed', {
        transactionId,
        success,
        filesRestored: totalFilesRestored,
        partialFailures,
        duration: totalDuration,
      });

      return {
        transactionId,
        success,
        undoResults,
        totalDuration,
        filesRestored: totalFilesRestored,
        partialFailures,
      };

    } catch (error) {
      this.logger.error('OperationJournal', 'Transaction undo failed', error as Error, {
        transactionId,
      });

      return {
        transactionId,
        success: false,
        undoResults: [],
        totalDuration: Date.now() - startTime,
        filesRestored: 0,
        partialFailures: 0,
      };
    }
  }

  /**
   * Get operation history with filtering and pagination
   */
  public async getOperationHistory(options: {
    userId?: string;
    transactionId?: string;
    type?: string;
    startDate?: number;
    endDate?: number;
    page?: number;
    pageSize?: number;
  } = {}): Promise<OperationHistory> {
    const pageSize = options.pageSize || 50;
    const currentPage = options.page || 1;
    const offset = (currentPage - 1) * pageSize;

    const entries = await this.queryJournalEntries(options, offset, pageSize);
    const totalCount = await this.countJournalEntries(options);

    return {
      entries,
      totalCount,
      pageSize,
      currentPage,
      hasMore: offset + entries.length < totalCount,
    };
  }

  /**
   * Get detailed audit trail for a specific file
   */
  public async getFileAuditTrail(fileId: number): Promise<OperationJournalEntry[]> {
    return await this.queryJournalEntries({ sourceId: fileId });
  }

  /**
   * Check if an operation can be undone
   */
  public async canUndo(operationId: string): Promise<{
    canUndo: boolean;
    reason?: string;
    dependencies?: string[];
  }> {
    const entry = await this.getJournalEntry(operationId);
    if (!entry) {
      return { canUndo: false, reason: 'Operation not found' };
    }

    if (entry.status === 'rolled_back') {
      return { canUndo: false, reason: 'Operation already rolled back' };
    }

    // Check for dependencies
    const dependencies = await this.checkUndoDependencies(entry);
    if (dependencies.length > 0) {
      return {
        canUndo: false,
        reason: 'Operation has dependencies that must be undone first',
        dependencies,
      };
    }

    // Check if the current file system state allows undo
    const canExecuteReverse = await this.canExecuteReverseOperation(entry);
    if (!canExecuteReverse) {
      return { canUndo: false, reason: 'File system state prevents undo' };
    }

    return { canUndo: true };
  }

  /**
   * Get undo/redo statistics
   */
  public async getUndoStatistics(userId?: string): Promise<{
    totalOperations: number;
    undoneOperations: number;
    undoSuccessRate: number;
    mostUndoneOperationType: string;
    recentUndoActivity: Array<{ date: string; count: number }>;
  }> {
    // This would query the database for statistics
    // For now, return placeholder data
    return {
      totalOperations: 0,
      undoneOperations: 0,
      undoSuccessRate: 0,
      mostUndoneOperationType: 'rename',
      recentUndoActivity: [],
    };
  }

  private async executeReverseOperation(entry: OperationJournalEntry): Promise<void> {
    const reverseOp = entry.undoData.reverseOperation;

    switch (reverseOp.type) {
      case 'rename':
        await this.executeReverseRename(reverseOp, entry);
        break;
      case 'move':
        await this.executeReverseMove(reverseOp, entry);
        break;
      case 'restore':
        await this.executeRestore(reverseOp, entry);
        break;
      default:
        throw new Error(`Unsupported reverse operation: ${reverseOp.type}`);
    }
  }

  private async executeReverseRename(
    reverseOp: UndoData['reverseOperation'],
    entry: OperationJournalEntry
  ): Promise<void> {
    const fs = await import('fs/promises');
    
    if (!reverseOp.targetPath) {
      throw new Error('Target path required for reverse rename');
    }

    await fs.rename(reverseOp.sourcePath, reverseOp.targetPath);
    
    this.logger.debug('OperationJournal', 'Reverse rename executed', {
      from: reverseOp.sourcePath,
      to: reverseOp.targetPath,
    });
  }

  private async executeReverseMove(
    reverseOp: UndoData['reverseOperation'],
    entry: OperationJournalEntry
  ): Promise<void> {
    const fs = await import('fs/promises');
    
    if (!reverseOp.targetPath) {
      throw new Error('Target path required for reverse move');
    }

    await fs.rename(reverseOp.sourcePath, reverseOp.targetPath);
    
    this.logger.debug('OperationJournal', 'Reverse move executed', {
      from: reverseOp.sourcePath,
      to: reverseOp.targetPath,
    });
  }

  private async executeRestore(
    reverseOp: UndoData['reverseOperation'],
    entry: OperationJournalEntry
  ): Promise<void> {
    const fs = await import('fs/promises');
    
    if (!reverseOp.restoreFromBackup) {
      throw new Error('Backup path required for restore operation');
    }

    await fs.copyFile(reverseOp.restoreFromBackup, reverseOp.sourcePath);
    
    this.logger.debug('OperationJournal', 'File restored from backup', {
      backup: reverseOp.restoreFromBackup,
      restored: reverseOp.sourcePath,
    });
  }

  private async checkUndoDependencies(entry: OperationJournalEntry): Promise<string[]> {
    // Check if other operations depend on this one
    // For example, if we renamed A to B, and then renamed B to C,
    // we can't undo A->B without first undoing B->C
    
    const dependentEntries = await this.queryJournalEntries({
      sourcePath: entry.targetPath, // Operations that use this operation's target as their source
      startDate: entry.timestamp, // Only operations that happened after this one
    });

    return dependentEntries
      .filter(e => e.status === 'committed')
      .map(e => e.operationId);
  }

  private async canExecuteReverseOperation(entry: OperationJournalEntry): Promise<boolean> {
    const fs = await import('fs/promises');
    const reverseOp = entry.undoData.reverseOperation;

    try {
      // Check if source file for reverse operation exists
      await fs.access(reverseOp.sourcePath, fs.constants.F_OK);

      // Check if target path is available (doesn't exist)
      if (reverseOp.targetPath) {
        try {
          await fs.access(reverseOp.targetPath, fs.constants.F_OK);
          return false; // Target exists, can't undo
        } catch {
          return true; // Target doesn't exist, can undo
        }
      }

      return true;
    } catch {
      return false; // Source doesn't exist, can't undo
    }
  }

  private async storeJournalEntry(entry: OperationJournalEntry): Promise<void> {
    // This would store the entry in the operations table with JSON serialization
    // For now, it's a placeholder since we need to extend the database schema
    this.logger.debug('OperationJournal', 'Storing journal entry', {
      journalId: entry.id,
      operationId: entry.operationId,
    });
  }

  private async getJournalEntry(operationId: string): Promise<OperationJournalEntry | null> {
    // Query the operations table for the journal entry
    // For now, return null as placeholder
    return null;
  }

  private async getTransactionEntries(transactionId: string): Promise<OperationJournalEntry[]> {
    // Query all journal entries for a transaction
    // For now, return empty array as placeholder
    return [];
  }

  private async queryJournalEntries(
    filters: any,
    offset?: number,
    limit?: number
  ): Promise<OperationJournalEntry[]> {
    // Query journal entries with filters
    // For now, return empty array as placeholder
    return [];
  }

  private async countJournalEntries(filters: any): Promise<number> {
    // Count journal entries matching filters
    // For now, return 0 as placeholder
    return 0;
  }

  private async markAsRolledBack(journalId: string): Promise<void> {
    // Update the journal entry status to 'rolled_back'
    this.logger.debug('OperationJournal', 'Marking as rolled back', { journalId });
  }

  private async cleanupOldEntries(): Promise<void> {
    const cutoffDate = Date.now() - (this.maxUndoHistoryDays * 24 * 60 * 60 * 1000);
    
    this.logger.info('OperationJournal', 'Cleaning up old journal entries', {
      cutoffDate: new Date(cutoffDate).toISOString(),
    });

    // Delete entries older than cutoff date
    // Implementation would depend on database schema
  }

  private generateJournalId(): string {
    return `journal_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }
}
