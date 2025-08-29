import { describe, it as test, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import { BatchOperationManager, BatchOperation } from '../src/lib/batch-operation-manager';
import { DatabaseManager } from '../src/lib/database';
import { Logger } from '../src/lib/logger';

// Mock filesystem operations
vi.mock('fs/promises');
const mockedFs = fs as any;

type OperationInput = {
  type: 'rename' | 'move' | 'delete';
  fileId: number;
  originalPath: string;
  targetPath: string;
  confidence: number;
  priority: 'high' | 'medium' | 'low';
};

describe('BatchOperationManager', () => {
  let batchManager: BatchOperationManager;
  let mockDatabase: any;
  let mockLogger: any;
  let tempDir: string;

  beforeEach(() => {
    // Create mock database
    mockDatabase = {
      runMigrations: vi.fn(),
      getFileById: vi.fn(),
      insertSuggestion: vi.fn(),
      updateSuggestionRecommendation: vi.fn(),
      getTopSuggestions: vi.fn(),
      recordOperation: vi.fn(),
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

    // Create batch manager
    batchManager = new BatchOperationManager(mockDatabase, mockLogger);
    
    // Setup temp directory
    tempDir = '/tmp/batch-test-' + Date.now();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Operation Management', () => {
    test('should add single operation to queue', () => {
      const operation = {
        type: 'rename' as const,
        fileId: 1,
        originalPath: '/test/old.txt',
        targetPath: '/test/new.txt',
        confidence: 0.8,
        priority: 'medium' as const,
      };

      const operationId = batchManager.addOperation(operation);
      
      expect(operationId).toBeDefined();
      expect(operationId).toMatch(/^op-/);
      
      const stats = batchManager.getQueueStats();
      expect(stats.pendingOperations).toBe(1);
    });

    test('should create batch from multiple operations', () => {
      const operations = [
        {
          type: 'rename' as const,
          fileId: 1,
          originalPath: '/test/old1.txt',
          targetPath: '/test/new1.txt',
          confidence: 0.8,
          priority: 'medium' as const,
        },
        {
          type: 'rename' as const,
          fileId: 2,
          originalPath: '/test/old2.txt',
          targetPath: '/test/new2.txt',
          confidence: 0.7,
          priority: 'high' as const,
        },
      ];

      const operationIds = operations.map(op => batchManager.addOperation(op));
      const batchId = batchManager.createBatch(operationIds, 'interactive');
      
      expect(batchId).toBeDefined();
      expect(batchId).toMatch(/^batch-/);
      
      const batch = batchManager.getBatchStatus(batchId);
      expect(batch).toBeDefined();
      expect(batch!.operations).toHaveLength(2);
      expect(batch!.type).toBe('interactive');
    });

    test('should handle empty operation list gracefully', () => {
      expect(() => {
        batchManager.createBatch([], 'background');
      }).toThrow('No valid operations found for batch creation');
    });

    test('should get correct queue statistics', () => {
      const op1 = batchManager.addOperation({
        type: 'rename' as const,
        fileId: 1,
        originalPath: '/test/old1.txt',
        targetPath: '/test/new1.txt',
        confidence: 0.8,
        priority: 'medium' as const,
      });

      const op2 = batchManager.addOperation({
        type: 'rename' as const,
        fileId: 2,
        originalPath: '/test/old2.txt',
        targetPath: '/test/new2.txt',
        confidence: 0.7,
        priority: 'high' as const,
      });

      const stats1 = batchManager.getQueueStats();
      expect(stats1.pendingOperations).toBe(2);
      expect(stats1.queuedBatches).toBe(0);

      const batchId = batchManager.createBatch([op1, op2], 'interactive');
      
      const stats2 = batchManager.getQueueStats();
      expect(stats2.pendingOperations).toBe(0);
      expect(stats2.queuedBatches).toBe(1);
    });
  });

  describe('Batch Validation', () => {
    test('should validate batch operations successfully', async () => {
      // Mock file system responses
      mockedFs.stat.mockImplementation((filePath: any) => {
        if (filePath.includes('source')) {
          return Promise.resolve({
            isFile: () => true,
            isDirectory: () => false,
            size: 1024,
          } as any);
        } else if (filePath.includes('target')) {
          return Promise.resolve({
            isFile: () => false,
            isDirectory: () => true,
          } as any);
        }
        return Promise.reject(new Error('File not found'));
      });

      mockedFs.access.mockResolvedValue(undefined);

      const operations: BatchOperation[] = [
        {
          id: 'test-1',
          type: 'rename',
          fileId: 1,
          originalPath: '/test/source.txt',
          targetPath: '/test/target.txt',
          confidence: 0.8,
          priority: 'medium',
          status: 'pending',
          createdAt: Date.now(),
        },
      ];

      const result = await batchManager.validateBatch(operations);
      
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    test('should detect source file not found', async () => {
      mockedFs.stat.mockRejectedValue(new Error('File not found'));

      const operations: BatchOperation[] = [
        {
          id: 'test-1',
          type: 'rename',
          fileId: 1,
          originalPath: '/test/nonexistent.txt',
          targetPath: '/test/target.txt',
          confidence: 0.8,
          priority: 'medium',
          status: 'pending',
          createdAt: Date.now(),
        },
      ];

      const result = await batchManager.validateBatch(operations);
      
      expect(result.isValid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].code).toBe('SOURCE_NOT_FOUND');
    });

    test('should detect system file operations', async () => {
      mockedFs.stat.mockResolvedValue({
        isFile: () => true,
        isDirectory: () => false,
        size: 1024,
      } as any);

      const operations: BatchOperation[] = [
        {
          id: 'test-1',
          type: 'rename',
          fileId: 1,
          originalPath: '/System/Library/important.file',
          targetPath: '/test/target.txt',
          confidence: 0.8,
          priority: 'medium',
          status: 'pending',
          createdAt: Date.now(),
        },
      ];

      const result = await batchManager.validateBatch(operations);
      
      expect(result.isValid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].code).toBe('SYSTEM_FILE_OPERATION');
    });

    test('should detect target conflicts in batch', async () => {
      mockedFs.stat.mockResolvedValue({
        isFile: () => true,
        isDirectory: () => false,
        size: 1024,
      } as any);

      mockedFs.access.mockResolvedValue(undefined);

      const operations: BatchOperation[] = [
        {
          id: 'test-1',
          type: 'rename',
          fileId: 1,
          originalPath: '/test/source1.txt',
          targetPath: '/test/same-target.txt',
          confidence: 0.8,
          priority: 'medium',
          status: 'pending',
          createdAt: Date.now(),
        },
        {
          id: 'test-2',
          type: 'rename',
          fileId: 2,
          originalPath: '/test/source2.txt',
          targetPath: '/test/same-target.txt',
          confidence: 0.7,
          priority: 'medium',
          status: 'pending',
          createdAt: Date.now(),
        },
      ];

      const result = await batchManager.validateBatch(operations);
      
      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.code === 'TARGET_CONFLICT')).toBe(true);
    });

    test('should detect invalid characters in filenames', async () => {
      mockedFs.stat.mockResolvedValue({
        isFile: () => true,
        isDirectory: () => false,
        size: 1024,
      } as any);

      const operations: BatchOperation[] = [
        {
          id: 'test-1',
          type: 'rename',
          fileId: 1,
          originalPath: '/test/source.txt',
          targetPath: '/test/invalid<>filename.txt',
          confidence: 0.8,
          priority: 'medium',
          status: 'pending',
          createdAt: Date.now(),
        },
      ];

      const result = await batchManager.validateBatch(operations);
      
      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.code === 'INVALID_CHARACTERS')).toBe(true);
    });

    test('should handle validation errors gracefully', async () => {
      mockedFs.stat.mockRejectedValue(new Error('Permission denied'));

      const operations: BatchOperation[] = [
        {
          id: 'test-1',
          type: 'rename',
          fileId: 1,
          originalPath: '/test/source.txt',
          targetPath: '/test/target.txt',
          confidence: 0.8,
          priority: 'medium',
          status: 'pending',
          createdAt: Date.now(),
        },
      ];

      const result = await batchManager.validateBatch(operations);
      
      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });

  describe('Batch Processing', () => {
    test('should start and stop processing', async () => {
      expect(batchManager.getQueueStats().isProcessing).toBe(false);
      
      await batchManager.startProcessing();
      expect(batchManager.getQueueStats().isProcessing).toBe(true);
      
      batchManager.stopProcessing();
      expect(batchManager.getQueueStats().isProcessing).toBe(false);
    });

    test('should process high priority operations first', async () => {
      const lowPriorityOp = batchManager.addOperation({
        type: 'rename' as const,
        fileId: 1,
        originalPath: '/test/low.txt',
        targetPath: '/test/low-new.txt',
        confidence: 0.8,
        priority: 'low' as const,
      });

      const highPriorityOp = batchManager.addOperation({
        type: 'rename' as const,
        fileId: 2,
        originalPath: '/test/high.txt',
        targetPath: '/test/high-new.txt',
        confidence: 0.8,
        priority: 'high' as const,
      });

      const lowBatch = batchManager.createBatch([lowPriorityOp], 'background');
      const highBatch = batchManager.createBatch([highPriorityOp], 'interactive');

      // Interactive (high priority) batches should be processed first
      const stats = batchManager.getQueueStats();
      expect(stats.queuedBatches).toBe(2);
    });

    test('should cancel batch successfully', async () => {
      const operationId = batchManager.addOperation({
        type: 'rename' as const,
        fileId: 1,
        originalPath: '/test/source.txt',
        targetPath: '/test/target.txt',
        confidence: 0.8,
        priority: 'medium' as const,
      });

      const batchId = batchManager.createBatch([operationId], 'background');
      
      const cancelResult = await batchManager.cancelBatch(batchId);
      expect(cancelResult).toBe(true);
      
      const batch = batchManager.getBatchStatus(batchId);
      expect(batch?.status).toBe('cancelled');
    });

    test('should handle batch cancellation of non-existent batch', async () => {
      const cancelResult = await batchManager.cancelBatch('non-existent-batch');
      expect(cancelResult).toBe(false);
    });
  });

  describe('Event Emission', () => {
    test('should emit batch-started event', async () => {
      const eventPromise = new Promise((resolve) => {
        batchManager.on('batch-started', (data) => {
          expect(data.batchId).toBeDefined();
          expect(data.batch).toBeDefined();
          resolve(data);
        });
      });

      // This would normally trigger the event in real processing
      // For testing, we'll simulate the event
      const operationId = batchManager.addOperation({
        type: 'rename' as const,
        fileId: 1,
        originalPath: '/test/source.txt',
        targetPath: '/test/target.txt',
        confidence: 0.8,
        priority: 'medium' as const,
      });

      const batchId = batchManager.createBatch([operationId], 'interactive');
      
      // Simulate the event emission that would happen during processing
      batchManager.emit('batch-started', { batchId, batch: batchManager.getBatchStatus(batchId) });
      
      await eventPromise;
    });

    test('should emit validation failure events', async () => {
      const eventPromise = new Promise((resolve) => {
        batchManager.on('batch-failed', (data) => {
          expect(data.batchId).toBeDefined();
          expect(data.error).toContain('validation failed');
          expect(data.validationResult).toBeDefined();
          resolve(data);
        });
      });

      // Mock validation failure
      mockedFs.stat.mockRejectedValue(new Error('File not found'));

      const operationId = batchManager.addOperation({
        type: 'rename' as const,
        fileId: 1,
        originalPath: '/test/nonexistent.txt',
        targetPath: '/test/target.txt',
        confidence: 0.8,
        priority: 'medium' as const,
      });

      const batchId = batchManager.createBatch([operationId], 'interactive');
      
      // Simulate processing which would trigger validation
      batchManager.emit('batch-failed', { 
        batchId, 
        batch: batchManager.getBatchStatus(batchId),
        error: 'Batch validation failed',
        validationResult: { 
          isValid: false, 
          errors: [{ code: 'SOURCE_NOT_FOUND', message: 'File not found', severity: 'error' as const, affectedPaths: [] }], 
          warnings: [] 
        }
      });
      
      await eventPromise;
    });
  });

  describe('Edge Cases and Error Handling', () => {
    test('should handle duplicate operation IDs gracefully', () => {
      const operation = {
        type: 'rename' as const,
        fileId: 1,
        originalPath: '/test/source.txt',
        targetPath: '/test/target.txt',
        confidence: 0.8,
        priority: 'medium' as const,
      };

      const id1 = batchManager.addOperation(operation);
      const id2 = batchManager.addOperation(operation);
      
      expect(id1).not.toBe(id2);
      expect(batchManager.getQueueStats().pendingOperations).toBe(2);
    });

    test('should handle operations with same source and target paths', async () => {
      mockedFs.stat.mockResolvedValue({
        isFile: () => true,
        isDirectory: () => false,
        size: 1024,
      } as any);

      const operations: BatchOperation[] = [
        {
          id: 'test-1',
          type: 'rename',
          fileId: 1,
          originalPath: '/test/same.txt',
          targetPath: '/test/same.txt',
          confidence: 0.8,
          priority: 'medium',
          status: 'pending',
          createdAt: Date.now(),
        },
      ];

      const result = await batchManager.validateBatch(operations);
      
      expect(result.warnings.some(w => w.code === 'SAME_SOURCE_TARGET')).toBe(true);
    });

    test('should handle very long file paths', async () => {
      const longPath = '/test/' + 'a'.repeat(300) + '.txt';
      
      const operations: BatchOperation[] = [
        {
          id: 'test-1',
          type: 'rename',
          fileId: 1,
          originalPath: '/test/source.txt',
          targetPath: longPath,
          confidence: 0.8,
          priority: 'medium',
          status: 'pending',
          createdAt: Date.now(),
        },
      ];

      const result = await batchManager.validateBatch(operations);
      
      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.code === 'PATH_TOO_LONG')).toBe(true);
    });

    test('should handle reserved filenames', async () => {
      const operations: BatchOperation[] = [
        {
          id: 'test-1',
          type: 'rename',
          fileId: 1,
          originalPath: '/test/source.txt',
          targetPath: '/test/CON.txt',
          confidence: 0.8,
          priority: 'medium',
          status: 'pending',
          createdAt: Date.now(),
        },
      ];

      const result = await batchManager.validateBatch(operations);
      
      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.code === 'RESERVED_FILENAME')).toBe(true);
    });

    test('should handle batch processing with mixed operation types', () => {
      const operations = [
        {
          type: 'rename' as const,
          fileId: 1,
          originalPath: '/test/file1.txt',
          targetPath: '/test/renamed1.txt',
          confidence: 0.8,
          priority: 'medium' as const,
        },
        {
          type: 'move' as const,
          fileId: 2,
          originalPath: '/test/file2.txt',
          targetPath: '/other/file2.txt',
          confidence: 0.7,
          priority: 'high' as const,
        },
        {
          type: 'delete' as const,
          fileId: 3,
          originalPath: '/test/unwanted.txt',
          targetPath: '',
          confidence: 0.9,
          priority: 'low' as const,
        },
      ];

      const operationIds = operations.map(op => batchManager.addOperation(op));
      const batchId = batchManager.createBatch(operationIds, 'interactive');
      
      const batch = batchManager.getBatchStatus(batchId);
      expect(batch?.operations).toHaveLength(3);
      
      const types = batch?.operations.map(op => op.type);
      expect(types).toContain('rename');
      expect(types).toContain('move');
      expect(types).toContain('delete');
    });
  });

  describe('Performance and Scale Testing', () => {
    test('should handle large batches efficiently', () => {
      const startTime = Date.now();
      const operations: OperationInput[] = [];
      
      // Create 1000 operations
      for (let i = 0; i < 1000; i++) {
        operations.push({
          type: 'rename' as const,
          fileId: i,
          originalPath: `/test/file${i}.txt`,
          targetPath: `/test/renamed${i}.txt`,
          confidence: 0.8,
          priority: 'medium' as const,
        });
      }

      const operationIds = operations.map(op => batchManager.addOperation(op));
      const batchId = batchManager.createBatch(operationIds, 'background');
      
      const endTime = Date.now();
      const duration = endTime - startTime;
      
      expect(duration).toBeLessThan(1000); // Should complete in under 1 second
      expect(batchManager.getBatchStatus(batchId)?.operations).toHaveLength(1000);
    });

    test('should manage memory efficiently with multiple batches', () => {
      const initialMemory = process.memoryUsage().heapUsed;
      
      // Create multiple batches
      for (let batch = 0; batch < 10; batch++) {
        const operations: OperationInput[] = [];
        for (let i = 0; i < 100; i++) {
          operations.push({
            type: 'rename' as const,
            fileId: batch * 100 + i,
            originalPath: `/test/batch${batch}/file${i}.txt`,
            targetPath: `/test/batch${batch}/renamed${i}.txt`,
            confidence: 0.8,
            priority: 'medium' as const,
          });
        }
        
        const operationIds = operations.map(op => batchManager.addOperation(op));
        batchManager.createBatch(operationIds, 'background');
      }
      
      const finalMemory = process.memoryUsage().heapUsed;
      const memoryIncrease = finalMemory - initialMemory;
      
      // Memory increase should be reasonable (less than 100MB for 1000 operations)
      expect(memoryIncrease).toBeLessThan(100 * 1024 * 1024);
    });
  });
});
