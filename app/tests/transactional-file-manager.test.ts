import { describe, it as test, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import { TransactionalFileManager, TransactionContext, FileOperation } from '../src/lib/transactional-file-manager';
import { DatabaseManager } from '../src/lib/database';
import { Logger } from '../src/lib/logger';

// Mock filesystem operations
vi.mock('fs/promises');
const mockedFs = fs as any;

describe('TransactionalFileManager', () => {
  let transactionManager: TransactionalFileManager;
  let mockDatabase: any;
  let mockLogger: any;
  let tempDir: string;

  beforeEach(() => {
    // Create mock database
    mockDatabase = {
      runMigrations: vi.fn(),
      recordOperation: vi.fn().mockResolvedValue({ id: 'op-123' }),
      updateOperationStatus: vi.fn(),
      getOperations: vi.fn(),
      cleanup: vi.fn(),
    } as any;

    // Create mock logger
    mockLogger = {
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    } as any;

    transactionManager = new TransactionalFileManager(mockDatabase, mockLogger);
    tempDir = '/tmp/transaction-test-' + Date.now();

    // Mock filesystem functions
    mockedFs.access = vi.fn();
    mockedFs.stat = vi.fn();
    mockedFs.readdir = vi.fn();
    mockedFs.mkdir = vi.fn();
    mockedFs.readFile = vi.fn();
    mockedFs.writeFile = vi.fn();
    mockedFs.unlink = vi.fn();
    mockedFs.rename = vi.fn();
    mockedFs.copyFile = vi.fn();
    mockedFs.rm = vi.fn();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Transaction Management', () => {
    test('should create transaction with empty operations', () => {
      const transaction = transactionManager.createTransaction();
      
      expect(transaction).toBeDefined();
      expect(transaction.id).toBeDefined();
      expect(transaction.operations).toEqual([]);
      expect(transaction.status).toBe('pending');
      expect(transaction.createdAt).toBeInstanceOf(Date);
    });

    test('should add operation to transaction', () => {
      const transaction = transactionManager.createTransaction();
      
      const operation: FileOperation = {
        type: 'rename',
        source: '/test/source.txt',
        target: '/test/target.txt',
        metadata: { confidence: 0.8 }
      };

      const result = transactionManager.addOperation(transaction.id, operation);
      
      expect(result.success).toBe(true);
      expect(result.context?.operations).toHaveLength(1);
      expect(result.context?.operations[0]).toEqual(expect.objectContaining(operation));
    });

    test('should reject operation for non-existent transaction', () => {
      const operation: FileOperation = {
        type: 'rename',
        source: '/test/source.txt',
        target: '/test/target.txt',
        metadata: { confidence: 0.8 }
      };

      const result = transactionManager.addOperation('non-existent-tx', operation);
      
      expect(result.success).toBe(false);
      expect(result.error).toContain('Transaction not found');
    });

    test('should get transaction status', () => {
      const transaction = transactionManager.createTransaction();
      
      const status = transactionManager.getTransactionStatus(transaction.id);
      
      expect(status).toEqual(transaction);
    });

    test('should return null for non-existent transaction status', () => {
      const status = transactionManager.getTransactionStatus('non-existent-tx');
      
      expect(status).toBeNull();
    });
  });

  describe('Transaction Execution', () => {
    test('should execute simple rename transaction', async () => {
      // Setup mocks - source exists, target does not exist
      mockedFs.access.mockImplementation(async (path: string) => {
        if (path === '/test/source.txt' || path === '/test') {
          return Promise.resolve(); // Source file and target directory exist
        }
        throw new Error('ENOENT: no such file or directory');
      });
      mockedFs.stat.mockResolvedValue({ isFile: () => true, size: 1000 });
      mockedFs.rename.mockResolvedValue(undefined);

      const transaction = transactionManager.createTransaction();
      
      const operation: FileOperation = {
        type: 'rename',
        source: '/test/source.txt',
        target: '/test/target.txt',
        metadata: { confidence: 0.8 }
      };

      transactionManager.addOperation(transaction.id, operation);
      
      const result = await transactionManager.executeTransaction(transaction.id);
      
      expect(result.success).toBe(true);
      expect(result.completedOperations).toBe(1);
      expect(result.errors).toEqual([]);
      expect(mockedFs.rename).toHaveBeenCalledWith('/test/source.txt', '/test/target.txt');
    });

    test('should handle operation failure and rollback', async () => {
      // Setup mocks - source exists, target does not exist (pass validation), but operation fails
      mockedFs.access.mockImplementation(async (path: string) => {
        if (path === '/test/source.txt' || path === '/test') {
          return Promise.resolve(); // Source file and target directory exist
        }
        throw new Error('ENOENT: no such file or directory');
      });
      mockedFs.stat.mockResolvedValue({ isFile: () => true, size: 1000 });
      mockedFs.rename.mockRejectedValue(new Error('Permission denied'));
      mockedFs.copyFile.mockResolvedValue(undefined);
      mockedFs.unlink.mockResolvedValue(undefined);

      const transaction = transactionManager.createTransaction();
      
      const operation: FileOperation = {
        type: 'rename',
        source: '/test/source.txt',
        target: '/test/target.txt',
        metadata: { confidence: 0.8 }
      };

      transactionManager.addOperation(transaction.id, operation);
      
      const result = await transactionManager.executeTransaction(transaction.id);
      
      expect(result.success).toBe(false);
      expect(result.completedOperations).toBe(0);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('Permission denied');
    });

    test('should execute copy operation', async () => {
      // Setup mocks - source exists, target does not exist
      mockedFs.access.mockImplementation(async (path: string) => {
        if (path === '/test/source.txt' || path === '/test') {
          return Promise.resolve(); // Source file and target directory exist
        }
        throw new Error('ENOENT: no such file or directory');
      });
      mockedFs.stat.mockResolvedValue({ isFile: () => true, size: 1000 });
      mockedFs.copyFile.mockResolvedValue(undefined);

      const transaction = transactionManager.createTransaction();
      
      const operation: FileOperation = {
        type: 'copy',
        source: '/test/source.txt',
        target: '/test/copy.txt',
        metadata: { confidence: 0.9 }
      };

      transactionManager.addOperation(transaction.id, operation);
      
      const result = await transactionManager.executeTransaction(transaction.id);
      
      expect(result.success).toBe(true);
      expect(result.completedOperations).toBe(1);
      expect(mockedFs.copyFile).toHaveBeenCalledWith('/test/source.txt', '/test/copy.txt');
    });

    test('should execute delete operation', async () => {
      // Setup mocks for backup and delete
      mockedFs.access.mockResolvedValue(undefined); // Source exists
      mockedFs.stat.mockResolvedValue({ isFile: () => true, size: 1000 });
      mockedFs.copyFile.mockResolvedValue(undefined); // Backup creation
      mockedFs.unlink.mockResolvedValue(undefined); // Delete operation

      const transaction = transactionManager.createTransaction();
      
      const operation: FileOperation = {
        type: 'delete',
        source: '/test/source.txt',
        metadata: { confidence: 0.7 }
      };

      transactionManager.addOperation(transaction.id, operation);
      
      const result = await transactionManager.executeTransaction(transaction.id);
      
      expect(result.success).toBe(true);
      expect(result.completedOperations).toBe(1);
      expect(mockedFs.copyFile).toHaveBeenCalled(); // Backup created
      expect(mockedFs.unlink).toHaveBeenCalledWith('/test/source.txt');
    });

    test('should fail transaction for non-existent transaction', async () => {
      const result = await transactionManager.executeTransaction('non-existent-tx');
      
      expect(result.success).toBe(false);
      expect(result.error).toContain('Transaction not found');
    });
  });

  describe('Validation and Safety', () => {
    test('should validate source file exists', async () => {
      // Setup mocks
      mockedFs.access.mockRejectedValue(new Error('File not found'));

      const transaction = transactionManager.createTransaction();
      
      const operation: FileOperation = {
        type: 'rename',
        source: '/test/nonexistent.txt',
        target: '/test/target.txt',
        metadata: { confidence: 0.8 }
      };

      transactionManager.addOperation(transaction.id, operation);
      
      const result = await transactionManager.executeTransaction(transaction.id);
      
      expect(result.success).toBe(false);
      expect(result.errors[0]).toContain('File not found');
      expect(mockedFs.rename).not.toHaveBeenCalled();
    });

    test('should prevent overwriting existing files without force flag', async () => {
      // Setup mocks - source exists, target also exists
      mockedFs.access.mockImplementation(async (path: string) => {
        if (path === '/test/source.txt' || path === '/test/target.txt') {
          return Promise.resolve();
        }
        throw new Error('File not found');
      });
      mockedFs.stat.mockResolvedValue({ isFile: () => true, size: 1000 });

      const transaction = transactionManager.createTransaction();
      
      const operation: FileOperation = {
        type: 'rename',
        source: '/test/source.txt',
        target: '/test/target.txt',
        metadata: { confidence: 0.8 }
      };

      transactionManager.addOperation(transaction.id, operation);
      
      const result = await transactionManager.executeTransaction(transaction.id);
      
      expect(result.success).toBe(false);
      expect(result.errors[0]).toContain('Target file already exists');
      expect(mockedFs.rename).not.toHaveBeenCalled();
    });

    test('should allow overwriting with force flag', async () => {
      // Setup mocks - both source and target exist
      mockedFs.access.mockResolvedValue(undefined);
      mockedFs.stat.mockResolvedValue({ isFile: () => true, size: 1000 });
      mockedFs.rename.mockResolvedValue(undefined);

      const transaction = transactionManager.createTransaction();
      
      const operation: FileOperation = {
        type: 'rename',
        source: '/test/source.txt',
        target: '/test/target.txt',
        metadata: { confidence: 0.8, force: true }
      };

      transactionManager.addOperation(transaction.id, operation);
      
      const result = await transactionManager.executeTransaction(transaction.id);
      
      expect(result.success).toBe(true);
      expect(result.completedOperations).toBe(1);
      expect(mockedFs.rename).toHaveBeenCalled();
    });

    test('should validate file permissions before operation', async () => {
      // Setup mocks - file exists but permission check fails during validation
      mockedFs.access.mockImplementation(async (path: string, mode?: number) => {
        if (path === '/test/readonly.txt' && mode === (fs.constants.R_OK | fs.constants.W_OK)) {
          throw new Error('EACCES: permission denied');
        }
        if (path === '/test/readonly.txt' || path === '/test') {
          return Promise.resolve(); // File exists, directory exists
        }
        throw new Error('ENOENT: no such file or directory');
      });
      mockedFs.stat.mockResolvedValue({ isFile: () => true, size: 1000 });
      mockedFs.rename.mockRejectedValue(new Error('EACCES: permission denied'));

      const transaction = transactionManager.createTransaction();
      
      const operation: FileOperation = {
        type: 'rename',
        source: '/test/readonly.txt',
        target: '/test/target.txt',
        metadata: { confidence: 0.8 }
      };

      transactionManager.addOperation(transaction.id, operation);
      
      const result = await transactionManager.executeTransaction(transaction.id);
      
      expect(result.success).toBe(false);
      expect(result.errors[0]).toContain('permission denied');
    });
  });

  describe('Backup and Recovery', () => {
    test('should create backup before destructive operation', async () => {
      // Setup mocks - source exists, target does not exist
      mockedFs.access.mockImplementation(async (path: string) => {
        if (path === '/test/important.txt' || path === '/test') {
          return Promise.resolve(); // Source file and target directory exist
        }
        throw new Error('ENOENT: no such file or directory');
      });
      mockedFs.stat.mockResolvedValue({ isFile: () => true, size: 1000 });
      mockedFs.copyFile.mockResolvedValue(undefined); // Backup creation
      mockedFs.rename.mockResolvedValue(undefined); // Main operation

      const transaction = transactionManager.createTransaction();
      
      const operation: FileOperation = {
        type: 'rename',
        source: '/test/important.txt',
        target: '/test/renamed.txt',
        metadata: { confidence: 0.8, createBackup: true }
      };

      transactionManager.addOperation(transaction.id, operation);
      
      const result = await transactionManager.executeTransaction(transaction.id);
      
      expect(result.success).toBe(true);
      expect(mockedFs.copyFile).toHaveBeenCalled(); // Backup was created
      expect(mockedFs.rename).toHaveBeenCalled(); // Main operation executed
    });

    test('should rollback completed operations on failure', async () => {
      // Setup mocks for multiple operations where validation passes but second operation fails
      mockedFs.access.mockImplementation(async (path: string) => {
        if (path.includes('file1.txt') || path.includes('file2.txt') || path === '/test') {
          return Promise.resolve(); // Source files and target directory exist
        }
        throw new Error('ENOENT: no such file or directory'); // Targets don't exist
      });
      mockedFs.stat.mockResolvedValue({ isFile: () => true, size: 1000 });
      mockedFs.rename.mockImplementation(async (source: string, target: string) => {
        if (source.includes('file2')) {
          throw new Error('Disk full');
        }
        return Promise.resolve();
      });
      mockedFs.copyFile.mockResolvedValue(undefined);

      const transaction = transactionManager.createTransaction();
      
      // Add multiple operations
      transactionManager.addOperation(transaction.id, {
        type: 'rename',
        source: '/test/file1.txt',
        target: '/test/renamed1.txt',
        metadata: { confidence: 0.8 }
      });
      
      transactionManager.addOperation(transaction.id, {
        type: 'rename',
        source: '/test/file2.txt',
        target: '/test/renamed2.txt',
        metadata: { confidence: 0.8 }
      });
      
      const result = await transactionManager.executeTransaction(transaction.id);
      
      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('Disk full');
      // Rollback should have been attempted
      expect(mockedFs.rename).toHaveBeenCalledTimes(3); // 2 forward, 1 rollback
    });

    test('should handle rollback failures gracefully', async () => {
      // Setup mocks where validation passes, main operation succeeds but second fails, rollback also fails
      mockedFs.access.mockImplementation(async (path: string) => {
        if (path.includes('file1.txt') || path.includes('file2.txt') || path === '/test') {
          return Promise.resolve(); // Source files and target directory exist
        }
        throw new Error('ENOENT: no such file or directory'); // Targets don't exist
      });
      mockedFs.stat.mockResolvedValue({ isFile: () => true, size: 1000 });
      mockedFs.rename.mockImplementation(async (source: string, target: string) => {
        // First rename succeeds, second fails, rollback also fails
        if (source.includes('file2')) {
          throw new Error('Disk full');
        }
        if (target.includes('file1')) {  // This is the rollback
          throw new Error('Rollback failed');
        }
        return Promise.resolve();
      });

      const transaction = transactionManager.createTransaction();
      
      transactionManager.addOperation(transaction.id, {
        type: 'rename',
        source: '/test/file1.txt',
        target: '/test/renamed1.txt',
        metadata: { confidence: 0.8 }
      });
      
      transactionManager.addOperation(transaction.id, {
        type: 'rename',
        source: '/test/file2.txt',
        target: '/test/renamed2.txt',
        metadata: { confidence: 0.8 }
      });
      
      const result = await transactionManager.executeTransaction(transaction.id);
      
      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(2); // Original error + rollback error
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Rollback failed'),
        expect.any(String)
      );
    });
  });

  describe('Error Handling', () => {
    test('should handle filesystem errors gracefully', async () => {
      mockedFs.access.mockRejectedValue(new Error('ENOENT: no such file or directory'));

      const transaction = transactionManager.createTransaction();
      
      const operation: FileOperation = {
        type: 'rename',
        source: '/test/missing.txt',
        target: '/test/target.txt',
        metadata: { confidence: 0.8 }
      };

      transactionManager.addOperation(transaction.id, operation);
      
      const result = await transactionManager.executeTransaction(transaction.id);
      
      expect(result.success).toBe(false);
      expect(result.errors[0]).toContain('no such file or directory');
      expect(mockLogger.error).toHaveBeenCalled();
    });

    test('should handle disk space issues', async () => {
      // Setup mocks - validation passes, but operation fails with disk space error
      mockedFs.access.mockImplementation(async (path: string) => {
        if (path === '/test/large.txt' || path === '/test') {
          return Promise.resolve(); // Source file and target directory exist
        }
        throw new Error('ENOENT: no such file or directory');
      });
      mockedFs.stat.mockResolvedValue({ isFile: () => true, size: 1000 });
      mockedFs.rename.mockRejectedValue(new Error('ENOSPC: no space left on device'));

      const transaction = transactionManager.createTransaction();
      
      const operation: FileOperation = {
        type: 'rename',
        source: '/test/large.txt',
        target: '/test/target.txt',
        metadata: { confidence: 0.8 }
      };

      transactionManager.addOperation(transaction.id, operation);
      
      const result = await transactionManager.executeTransaction(transaction.id);
      
      expect(result.success).toBe(false);
      expect(result.errors[0]).toContain('no space left on device');
    });

    test('should handle network path issues', async () => {
      // Setup mocks - validation passes, but operation fails with network error  
      mockedFs.access.mockImplementation(async (path: string) => {
        if (path === '//network/share/file.txt' || path === '/local') {
          return Promise.resolve(); // Source file and target directory exist
        }
        throw new Error('ENOENT: no such file or directory');
      });
      mockedFs.stat.mockResolvedValue({ isFile: () => true, size: 1000 });
      mockedFs.rename.mockRejectedValue(new Error('ENETUNREACH: network is unreachable'));

      const transaction = transactionManager.createTransaction();
      
      const operation: FileOperation = {
        type: 'rename',
        source: '//network/share/file.txt',
        target: '/local/target.txt',
        metadata: { confidence: 0.8 }
      };

      transactionManager.addOperation(transaction.id, operation);
      
      const result = await transactionManager.executeTransaction(transaction.id);
      
      expect(result.success).toBe(false);
      expect(result.errors[0]).toContain('network is unreachable');
    });
  });

  describe('Performance and Resource Management', () => {
    test('should execute operations efficiently', async () => {
      const startTime = Date.now();
      
      // Setup mocks for quick operations - sources exist, targets do not exist
      mockedFs.access.mockImplementation(async (path: string) => {
        if (path.includes('file') && !path.includes('renamed') || path === '/test') {
          return Promise.resolve(); // Source files and target directory exist
        }
        throw new Error('ENOENT: no such file or directory');
      });
      mockedFs.stat.mockResolvedValue({ isFile: () => true, size: 1000 });
      mockedFs.rename.mockResolvedValue(undefined);

      const transaction = transactionManager.createTransaction();
      
      // Add multiple operations
      for (let i = 0; i < 10; i++) {
        transactionManager.addOperation(transaction.id, {
          type: 'rename',
          source: `/test/file${i}.txt`,
          target: `/test/renamed${i}.txt`,
          metadata: { confidence: 0.8 }
        });
      }
      
      const result = await transactionManager.executeTransaction(transaction.id);
      
      const duration = Date.now() - startTime;
      
      expect(result.success).toBe(true);
      expect(result.completedOperations).toBe(10);
      expect(duration).toBeLessThan(1000); // Should complete in under 1 second
    });

    test('should clean up temporary resources', async () => {
      // Setup mocks - source exists, target does not exist
      mockedFs.access.mockImplementation(async (path: string) => {
        if (path === '/test/source.txt' || path === '/test') {
          return Promise.resolve(); // Source file and target directory exist
        }
        throw new Error('ENOENT: no such file or directory');
      });
      mockedFs.stat.mockResolvedValue({ isFile: () => true, size: 1000 });
      mockedFs.rename.mockResolvedValue(undefined);
      mockedFs.copyFile.mockResolvedValue(undefined); // For backup creation
      mockedFs.rm.mockResolvedValue(undefined);

      const transaction = transactionManager.createTransaction();
      
      const operation: FileOperation = {
        type: 'rename',
        source: '/test/source.txt',
        target: '/test/target.txt',
        metadata: { confidence: 0.8, createBackup: true }
      };

      transactionManager.addOperation(transaction.id, operation);
      
      await transactionManager.executeTransaction(transaction.id);
      
      // Verify cleanup was called
      expect(mockedFs.rm).toHaveBeenCalled();
    });

    test('should handle concurrent transactions', async () => {
      // Setup mocks - sources exist, targets do not exist
      mockedFs.access.mockImplementation(async (path: string) => {
        if ((path.includes('file1.txt') || path.includes('file2.txt')) && !path.includes('renamed') || path === '/test') {
          return Promise.resolve(); // Source files and target directory exist
        }
        throw new Error('ENOENT: no such file or directory');
      });
      mockedFs.stat.mockResolvedValue({ isFile: () => true, size: 1000 });
      mockedFs.rename.mockResolvedValue(undefined);

      const transaction1 = transactionManager.createTransaction();
      const transaction2 = transactionManager.createTransaction();
      
      transactionManager.addOperation(transaction1.id, {
        type: 'rename',
        source: '/test/file1.txt',
        target: '/test/renamed1.txt',
        metadata: { confidence: 0.8 }
      });
      
      transactionManager.addOperation(transaction2.id, {
        type: 'rename',
        source: '/test/file2.txt',
        target: '/test/renamed2.txt',
        metadata: { confidence: 0.8 }
      });
      
      // Execute both transactions concurrently
      const [result1, result2] = await Promise.all([
        transactionManager.executeTransaction(transaction1.id),
        transactionManager.executeTransaction(transaction2.id)
      ]);
      
      expect(result1.success).toBe(true);
      expect(result2.success).toBe(true);
    });
  });
});
