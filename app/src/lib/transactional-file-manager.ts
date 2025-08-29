import * as fs from 'fs/promises';
import * as path from 'path';
import { Logger } from './logger';
import { DatabaseManager } from './database';

export interface FileOperation {
  type: 'rename' | 'move' | 'delete' | 'copy';
  source: string;
  target?: string;
  metadata?: {
    confidence?: number;
    force?: boolean;
    createBackup?: boolean;
  };
}

export interface TransactionContext {
  id: string;
  operations: (FileOperation & { id: string })[];
  status: 'pending' | 'executing' | 'completed' | 'failed' | 'rolled_back';
  createdAt: Date;
  completedAt?: Date;
  error?: string;
}

export interface ExecutionResult {
  success: boolean;
  completedOperations: number;
  errors: string[];
  error?: string;
}

export class TransactionalFileManager {
  private readonly logger: Logger;
  private readonly database: DatabaseManager;
  private readonly transactions: Map<string, TransactionContext> = new Map();
  private readonly backupDirectory: string;
  private readonly backupPaths: Map<string, string[]> = new Map();
  private currentRollbackTransactionId?: string;

  constructor(database: DatabaseManager, logger: Logger, backupDir?: string) {
    this.database = database;
    this.logger = logger;
    this.backupDirectory = backupDir || path.join(process.cwd(), '.maxsort-backups');
  }

  /**
   * Create a new transaction and return its context
   */
  public createTransaction(): TransactionContext {
    const transaction: TransactionContext = {
      id: this.generateTransactionId(),
      operations: [],
      status: 'pending',
      createdAt: new Date(),
    };

    this.transactions.set(transaction.id, transaction);

    this.logger.info('TransactionalFileManager', 'Transaction created', {
      transactionId: transaction.id,
    });

    return transaction;
  }

  /**
   * Add an operation to a transaction
   */
  public addOperation(transactionId: string, operation: FileOperation): { success: boolean; context?: TransactionContext; error?: string } {
    const transaction = this.transactions.get(transactionId);
    if (!transaction) {
      return { success: false, error: `Transaction not found: ${transactionId}` };
    }

    const operationWithId = {
      ...operation,
      id: this.generateOperationId(),
    };

    transaction.operations.push(operationWithId);

    this.logger.debug('TransactionalFileManager', 'Operation added to transaction', {
      transactionId,
      operationId: operationWithId.id,
      type: operation.type,
    });

    return { success: true, context: transaction };
  }

  /**
   * Get transaction status
   */
  public getTransactionStatus(transactionId: string): TransactionContext | null {
    return this.transactions.get(transactionId) || null;
  }

  /**
   * Execute a transaction
   */
  public async executeTransaction(transactionId: string): Promise<ExecutionResult> {
    const transaction = this.transactions.get(transactionId);
    if (!transaction) {
      return {
        success: false,
        completedOperations: 0,
        errors: [`Transaction not found: ${transactionId}`],
        error: `Transaction not found: ${transactionId}`
      };
    }

    this.logger.info('TransactionalFileManager', 'Executing transaction', {
      transactionId,
      operationCount: transaction.operations.length,
    });

    const errors: string[] = [];
    let completedOperations = 0;

    transaction.status = 'executing';

    // Create backup directory if it doesn't exist
    try {
      await fs.mkdir(this.backupDirectory, { recursive: true });
    } catch (error) {
      this.logger.warn('TransactionalFileManager', 'Failed to create backup directory', { error });
    }

    try {
      // Validate all operations first
      for (const operation of transaction.operations) {
        const validationError = await this.validateOperation(operation);
        if (validationError) {
          errors.push(validationError);
          this.logger.error('TransactionalFileManager', 'Operation validation failed', new Error(validationError), {
            transactionId,
            operationId: operation.id,
            operationType: operation.type,
            source: operation.source,
            target: operation.target,
          });
        }
      }

      if (errors.length > 0) {
        transaction.status = 'failed';
        transaction.error = errors.join('; ');
        return {
          success: false,
          completedOperations: 0,
          errors,
          error: errors[0]
        };
      }

      // Execute operations
      for (const operation of transaction.operations) {
        try {
          await this.executeOperation(operation, transactionId);
          completedOperations++;
        } catch (operationError) {
          const errorMessage = (operationError as Error).message;
          errors.push(errorMessage);

          this.logger.error('TransactionalFileManager', 'Operation failed', operationError as Error, {
            transactionId,
            operationId: operation.id,
          });

          // Stop execution and prepare for rollback
          break;
        }
      }

      if (errors.length > 0) {
        // Rollback completed operations
        if (completedOperations > 0) {
          const rollbackErrors = await this.rollbackOperations(transaction.operations.slice(0, completedOperations), transactionId);
          errors.push(...rollbackErrors);
        }
        
        transaction.status = 'failed';
        transaction.error = errors.join('; ');
        transaction.completedAt = new Date();

        return {
          success: false,
          completedOperations: 0,
          errors,
          error: errors[0]
        };
      }

      // All operations successful
      transaction.status = 'completed';
      transaction.completedAt = new Date();

      // Clean up temporary resources
      await this.cleanupTemporaryResources(transactionId);

      this.logger.info('TransactionalFileManager', 'Transaction completed successfully', {
        transactionId,
        completedOperations,
      });

      return {
        success: true,
        completedOperations,
        errors: [],
      };

    } catch (error) {
      transaction.status = 'failed';
      transaction.error = (error as Error).message;
      transaction.completedAt = new Date();

      this.logger.error('TransactionalFileManager', 'Transaction failed', error as Error, {
        transactionId,
      });

      return {
        success: false,
        completedOperations: 0,
        errors: [(error as Error).message],
        error: (error as Error).message
      };
    }
  }

  private async validateOperation(operation: FileOperation & { id: string }): Promise<string | null> {
    try {
      // Check source file exists
      await fs.access(operation.source, fs.constants.F_OK);
    } catch (error) {
      const errMsg = (error as Error).message;
      if (errMsg.includes('no such file')) {
        return `no such file or directory: ${operation.source}`;
      }
      return `File not found: ${operation.source}`;
    }

    // Check source file permissions  
    try {
      await fs.access(operation.source, fs.constants.R_OK | fs.constants.W_OK);
    } catch (error) {
      const errMsg = (error as Error).message;
      if (errMsg.includes('permission denied')) {
        return `permission denied: ${operation.source}`;
      }
      return `Source file is not writable: ${operation.source}`;
    }

    if (operation.type !== 'delete' && operation.target) {
      // Check target doesn't already exist (unless force is specified)
      if (!operation.metadata?.force) {
        try {
          await fs.access(operation.target, fs.constants.F_OK);
          return `Target file already exists: ${operation.target}`;
        } catch {
          // Target doesn't exist, which is good for non-force operations
        }
      }

      // Check target directory is writable
      const targetDir = path.dirname(operation.target);
      try {
        await fs.access(targetDir, fs.constants.W_OK);
      } catch (error) {
        const errMsg = (error as Error).message;
        if (errMsg.includes('permission denied')) {
          return `permission denied: ${targetDir}`;
        }
        if (errMsg.includes('no space left')) {
          return `no space left on device: ${targetDir}`;
        }
        if (errMsg.includes('network')) {
          return `network is unreachable: ${targetDir}`;
        }
        return `Target directory is not writable: ${targetDir}`;
      }
    }

    return null;
  }

  private async executeOperation(operation: FileOperation & { id: string }, transactionId: string): Promise<void> {
    // Create backup if requested
    if (operation.metadata?.createBackup && operation.type !== 'copy') {
      const backupPath = path.join(this.backupDirectory, `${path.basename(operation.source)}.backup.${operation.id}.${Date.now()}`);
      await fs.copyFile(operation.source, backupPath);
      
      // Store backup path for cleanup
      if (!this.backupPaths.has(transactionId)) {
        this.backupPaths.set(transactionId, []);
      }
      this.backupPaths.get(transactionId)!.push(backupPath);
      
      this.logger.debug('TransactionalFileManager', 'Backup created', {
        original: operation.source,
        backup: backupPath,
      });
    }

    switch (operation.type) {
      case 'rename':
        if (!operation.target) {
          throw new Error('Target path required for rename operation');
        }
        await fs.rename(operation.source, operation.target);
        break;

      case 'move':
        if (!operation.target) {
          throw new Error('Target path required for move operation');
        }
        await fs.rename(operation.source, operation.target);
        break;

      case 'delete':
        // Create backup before delete
        if (operation.metadata?.createBackup !== false) {
          const backupPath = path.join(this.backupDirectory, `${path.basename(operation.source)}.deleted.${operation.id}.${Date.now()}`);
          await fs.copyFile(operation.source, backupPath);
        }
        await fs.unlink(operation.source);
        break;

      case 'copy':
        if (!operation.target) {
          throw new Error('Target path required for copy operation');
        }
        await fs.copyFile(operation.source, operation.target);
        break;

      default:
        throw new Error(`Unsupported operation type: ${(operation as any).type}`);
    }

    this.logger.debug('TransactionalFileManager', 'Operation completed', {
      operationId: operation.id,
      type: operation.type,
      source: operation.source,
      target: operation.target,
    });
  }

  private async rollbackOperations(operations: (FileOperation & { id: string })[], transactionId: string): Promise<string[]> {
    this.currentRollbackTransactionId = transactionId;
    const rollbackErrors: string[] = [];
    
    this.logger.info('TransactionalFileManager', 'Rolling back operations', {
      operationCount: operations.length,
    });

    // Rollback in reverse order
    for (const operation of operations.reverse()) {
      try {
        await this.rollbackSingleOperation(operation);
      } catch (rollbackError) {
        const errorMessage = (rollbackError as Error).message;
        rollbackErrors.push(`Rollback failed: ${errorMessage}`);
        this.logger.error(`Rollback failed: ${errorMessage}`, 'Rollback operation failed');
        // Continue with other rollbacks even if one fails
      }
    }
    
    this.currentRollbackTransactionId = undefined;
    return rollbackErrors;
  }

  private async rollbackSingleOperation(operation: FileOperation & { id: string }): Promise<void> {
    this.logger.debug('TransactionalFileManager', 'Rolling back single operation', {
      operationId: operation.id,
      type: operation.type,
    });

    try {
      switch (operation.type) {
        case 'rename':
        case 'move':
          // Undo the rename/move by moving the file back
          if (operation.target) {
            await fs.rename(operation.target, operation.source);
          }
          break;

        case 'copy':
          // Undo copy by deleting the copied file
          if (operation.target) {
            await fs.unlink(operation.target);
          }
          break;

        case 'delete':
          // Try to restore from backup if it exists
          if (this.currentRollbackTransactionId) {
            const backupPaths = this.backupPaths.get(this.currentRollbackTransactionId);
            if (backupPaths) {
              const matchingBackup = backupPaths.find(path => path.includes(operation.id));
              if (matchingBackup) {
                await fs.copyFile(matchingBackup, operation.source);
              }
            }
          }
          break;
      }
    } catch (error) {
      this.logger.error('TransactionalFileManager', 'Single operation rollback failed', error as Error, {
        operationId: operation.id,
        type: operation.type,
      });
      throw error; // Re-throw to be handled by rollbackOperations
    }
  }

  private async cleanupTemporaryResources(transactionId: string): Promise<void> {
    try {
      // Clean up tracked backup files for this transaction
      const backupPaths = this.backupPaths.get(transactionId);
      if (backupPaths) {
        for (const backupPath of backupPaths) {
          await fs.rm(backupPath);
          
          this.logger.debug('TransactionalFileManager', 'Cleaned up backup file', {
            backupPath,
            transactionId,
          });
        }
        // Remove the transaction from backup tracking
        this.backupPaths.delete(transactionId);
      }
    } catch (error) {
      this.logger.warn('TransactionalFileManager', 'Failed to cleanup temporary resources', { 
        error, 
        transactionId 
      });
    }
  }

  private generateTransactionId(): string {
    return `tx_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }

  private generateOperationId(): string {
    return `op_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }
}
