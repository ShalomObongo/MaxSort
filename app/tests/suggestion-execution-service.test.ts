import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SuggestionExecutionService } from '../src/lib/suggestion-execution-service';
import { BatchOperationManager } from '../src/lib/batch-operation-manager';
import { DatabaseManager } from '../src/lib/database';
import { Logger } from '../src/lib/logger';

// Mock dependencies
vi.mock('../src/lib/batch-operation-manager');
vi.mock('../src/lib/database');
vi.mock('../src/lib/operation-validator');
vi.mock('../src/lib/logger');

describe('SuggestionExecutionService', () => {
  let service: SuggestionExecutionService;
  let mockDatabase: any;
  let mockBatchManager: any;
  let mockLogger: any;
  let mockTransactionManager: any;

  const mockSuggestions = [
    {
      id: 1,
      fileId: 1,
      requestId: 'req-1',
      analysisType: 'rename-suggestions' as const,
      suggestedValue: 'document-renamed.txt',
      originalConfidence: 0.95,
      adjustedConfidence: 0.95,
      qualityScore: 0.9,
      reasoning: 'High confidence rename',
      modelUsed: 'test-model',
      analysisDuration: 100,
      rankPosition: 1,
      isRecommended: true
    },
    {
      id: 2,
      fileId: 2,
      requestId: 'req-2',
      analysisType: 'rename-suggestions' as const,
      suggestedValue: 'image-processed.jpg',
      originalConfidence: 0.75,
      adjustedConfidence: 0.75,
      qualityScore: 0.8,
      reasoning: 'Medium confidence rename',
      modelUsed: 'test-model',
      analysisDuration: 120,
      rankPosition: 2,
      isRecommended: true
    },
    {
      id: 3,
      fileId: 3,
      requestId: 'req-3',
      analysisType: 'rename-suggestions' as const,
      suggestedValue: 'low-confidence.txt',
      originalConfidence: 0.6,
      adjustedConfidence: 0.6,
      qualityScore: 0.6,
      reasoning: 'Low confidence rename',
      modelUsed: 'test-model',
      analysisDuration: 90,
      rankPosition: 3,
      isRecommended: true
    }
  ];

  beforeEach(() => {
    // Reset all mocks
    vi.clearAllMocks();

    // Create mock instances
    mockDatabase = {
      getTopSuggestions: vi.fn(),
      getFileById: vi.fn(),
      recordOperation: vi.fn(),
      updateSuggestion: vi.fn(),
      getOperations: vi.fn(),
      updateOperationStatus: vi.fn(),
    } as any;

    mockBatchManager = {
      on: vi.fn(),
      addOperation: vi.fn(),
      createBatch: vi.fn(),
      startProcessing: vi.fn(),
      cancelBatch: vi.fn(),
    } as any;

    mockTransactionManager = {
      createTransaction: vi.fn().mockReturnValue({
        id: 'test-transaction',
        operations: [],
        status: 'pending',
        createdAt: new Date()
      }),
      addOperation: vi.fn().mockReturnValue({
        success: true,
        context: { id: 'test-transaction', operations: [], status: 'pending', createdAt: new Date() }
      }),
      executeTransaction: vi.fn().mockResolvedValue({
        success: true,
        completedOperations: 1,
        errors: []
      }),
      getTransactionStatus: vi.fn().mockReturnValue({
        id: 'test-transaction',
        operations: [{
          id: 'op-1',
          type: 'rename',
          source: '/test/original.txt',
          target: '/test/renamed.txt'
        }],
        status: 'completed',
        createdAt: new Date()
      })
    } as any;

    mockLogger = {
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    } as any;

    const mockValidator = {
      validateBatch: vi.fn().mockResolvedValue({
        isValid: true,
        errors: [],
        warnings: []
      }),
      validateOperation: vi.fn().mockResolvedValue({
        isValid: true,
        errors: [],
        warnings: []
      }),
      generateValidationReport: vi.fn().mockReturnValue('All validations passed'),
    } as any;

    // Mock Logger.getInstance
    vi.mocked(Logger.getInstance).mockReturnValue(mockLogger);

    // Create service instance with transaction manager and validator
    service = new SuggestionExecutionService(mockDatabase, mockBatchManager, mockTransactionManager, mockValidator);
  });

  describe('getApprovedSuggestions', () => {
    it('should retrieve and filter approved suggestions', async () => {
      mockDatabase.getTopSuggestions.mockReturnValue(mockSuggestions);

      const result = await service.getApprovedSuggestions({
        minConfidence: 0.7
      });

      expect(result).toHaveLength(2); // Only suggestions with confidence >= 0.7
      expect(result[0].adjustedConfidence).toBe(0.95);
      expect(result[1].adjustedConfidence).toBe(0.75);
      expect(mockLogger.info).toHaveBeenCalledWith(
        'SuggestionExecutionService',
        'Retrieved approved suggestions',
        expect.any(Object)
      );
    });

    it('should return all approved suggestions when no filters applied', async () => {
      mockDatabase.getTopSuggestions.mockReturnValue(mockSuggestions);

      const result = await service.getApprovedSuggestions();

      expect(result).toHaveLength(3);
      expect(mockLogger.info).toHaveBeenCalled();
    });

    it('should handle database errors', async () => {
      const error = new Error('Database connection failed');
      mockDatabase.getTopSuggestions.mockImplementation(() => {
        throw error;
      });

      await expect(service.getApprovedSuggestions()).rejects.toThrow('Database connection failed');
      expect(mockLogger.error).toHaveBeenCalledWith(
        'SuggestionExecutionService',
        'Failed to retrieve approved suggestions',
        error,
        expect.any(Object)
      );
    });
  });

  describe('createExecutionBatches', () => {
    it('should create single batch when groupBy is none', async () => {
      const batches = await service.createExecutionBatches(mockSuggestions, {
        groupBy: 'none',
        maxBatchSize: 5
      });

      expect(batches).toHaveLength(1);
      expect(batches[0].suggestions).toHaveLength(3);
      expect(batches[0].operations).toHaveLength(3);
      expect(batches[0].groupCriteria).toBe('Batch 1 of 1');
    });

    it('should create multiple batches when maxBatchSize is exceeded', async () => {
      const batches = await service.createExecutionBatches(mockSuggestions, {
        groupBy: 'none',
        maxBatchSize: 2
      });

      expect(batches).toHaveLength(2);
      expect(batches[0].suggestions).toHaveLength(2);
      expect(batches[1].suggestions).toHaveLength(1);
    });

    it('should group by confidence levels', async () => {
      const batches = await service.createExecutionBatches(mockSuggestions, {
        groupBy: 'confidence'
      });

      expect(batches.length).toBeGreaterThan(0);
      expect(mockLogger.info).toHaveBeenCalledWith(
        'SuggestionExecutionService',
        'Created execution batches',
        expect.any(Object)
      );
    });

    it('should assess risk levels correctly', async () => {
      const batches = await service.createExecutionBatches(mockSuggestions, {
        groupBy: 'none'
      });

      const batch = batches[0];
      expect(['low', 'medium', 'high']).toContain(batch.riskLevel);
      expect(batch.estimatedDuration).toBeGreaterThan(0);
    });
  });

  describe('generateExecutionSummary', () => {
    it('should generate comprehensive execution summary', async () => {
      const batches = await service.createExecutionBatches(mockSuggestions, {
        groupBy: 'none'
      });

      const summary = service.generateExecutionSummary(batches);

      expect(summary.totalSuggestions).toBe(3);
      expect(summary.totalBatches).toBe(1);
      expect(summary.estimatedDuration).toBeGreaterThan(0);
      expect(summary.riskAssessment).toHaveProperty('low');
      expect(summary.riskAssessment).toHaveProperty('medium');
      expect(summary.riskAssessment).toHaveProperty('high');
      expect(summary.operationCounts).toHaveProperty('rename');
      expect(summary.operationCounts).toHaveProperty('move');
    });
  });

  describe('executeBatch', () => {
    it('should execute batch through BatchOperationManager', async () => {
      const batches = await service.createExecutionBatches([mockSuggestions[0]], {
        groupBy: 'none'
      });

      mockBatchManager.addOperation.mockReturnValue('op-1');
      mockBatchManager.createBatch.mockReturnValue('batch-1');
      mockBatchManager.startProcessing.mockResolvedValue();

      await service.executeBatch(batches[0]);

      expect(mockBatchManager.addOperation).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'rename',
          fileId: 1,
          confidence: 0.95,
          priority: 'high'
        })
      );
      expect(mockBatchManager.createBatch).toHaveBeenCalledWith(['op-1'], 'interactive');
      expect(mockBatchManager.startProcessing).toHaveBeenCalled();
      expect(mockLogger.info).toHaveBeenCalledWith(
        'SuggestionExecutionService',
        'Starting batch execution',
        expect.any(Object)
      );
    });

    it('should handle execution errors', async () => {
      const batches = await service.createExecutionBatches([mockSuggestions[0]], {
        groupBy: 'none'
      });

      const error = new Error('Execution failed');
      mockBatchManager.addOperation.mockImplementation(() => {
        throw error;
      });

      await expect(service.executeBatch(batches[0])).rejects.toThrow('Execution failed');
      expect(mockLogger.error).toHaveBeenCalledWith(
        'SuggestionExecutionService',
        'Batch execution failed',
        error,
        expect.any(Object)
      );
    });
  });

  describe('cancelBatch', () => {
    it('should cancel batch execution', async () => {
      const batchId = 'test-batch';
      mockBatchManager.cancelBatch.mockResolvedValue(true);

      await service.cancelBatch(batchId);

      expect(mockBatchManager.cancelBatch).toHaveBeenCalledWith(batchId);
      expect(mockLogger.info).toHaveBeenCalledWith(
        'SuggestionExecutionService',
        'Batch execution cancelled',
        { batchId }
      );
    });

    it('should handle cancellation errors', async () => {
      const batchId = 'test-batch';
      const error = new Error('Cancellation failed');
      mockBatchManager.cancelBatch.mockRejectedValue(error);

      await expect(service.cancelBatch(batchId)).rejects.toThrow('Cancellation failed');
      expect(mockLogger.error).toHaveBeenCalledWith(
        'SuggestionExecutionService',
        'Failed to cancel batch',
        error,
        expect.any(Object)
      );
    });
  });

  describe('event forwarding', () => {
    it('should forward batch manager events', () => {
      // Verify that event listeners were registered
      expect(mockBatchManager.on).toHaveBeenCalledWith('batch-started', expect.any(Function));
      expect(mockBatchManager.on).toHaveBeenCalledWith('batch-progress', expect.any(Function));
      expect(mockBatchManager.on).toHaveBeenCalledWith('batch-completed', expect.any(Function));
      expect(mockBatchManager.on).toHaveBeenCalledWith('batch-failed', expect.any(Function));
    });
  });

  describe('transactional operations', () => {
    it('should execute suggestions with transaction manager', async () => {
      const suggestions = [mockSuggestions[0]];
      const mockFileRecord = {
        id: 1,
        path: '/test/original.txt',
        size: 1024,
        mtime: Date.now(),
        lastScannedAt: Date.now()
      };

      mockDatabase.getFileById.mockReturnValue(mockFileRecord);
      mockDatabase.recordOperation.mockReturnValue(true);
      mockDatabase.getOperations.mockReturnValue([]);

      const result = await service.executeWithTransaction(suggestions, { 
        createBackups: true, 
        enableRollback: true 
      });

      expect(result).toBeDefined();
      expect(result.success).toBe(true);
    });

    it('should prepare undo operations correctly', async () => {
      const transactionId = 'test-transaction';
      
      mockDatabase.getOperations.mockReturnValue([{
        id: 'op-1',
        transactionId: transactionId,
        operationType: 'rename',
        sourcePath: '/test/original.txt',
        targetPath: '/test/renamed.txt',
        status: 'completed'
      }]);

      const undoResult = await service.prepareUndo(transactionId);

      expect(undoResult).toBeDefined();
      expect(undoResult.success).toBe(true);
      expect(Array.isArray(undoResult.undoOperations)).toBe(true);
      expect(undoResult.riskLevel).toBeDefined();
      expect(['low', 'medium', 'high', 'critical']).toContain(undoResult.riskLevel);
    });

    it('should get transaction history', async () => {
      const mockOperations = [
        {
          id: 'op-1',
          transactionId: 'tx-1',
          operationType: 'rename',
          sourcePath: '/test/old.txt',
          targetPath: '/test/new.txt',
          status: 'completed'
        }
      ];

      mockDatabase.getOperations.mockReturnValue(mockOperations);

      const result = await service.getTransactionHistory(50);

      expect(result.success).toBe(true);
      expect(result.transactions).toBeDefined();
      expect(Array.isArray(result.transactions)).toBe(true);
    });

    it('should handle transaction errors gracefully', async () => {
      const suggestions = [mockSuggestions[0]];
      const error = new Error('Database error');
      mockDatabase.getFileById.mockImplementation(() => {
        throw error;
      });

      const result = await service.executeWithTransaction(suggestions, {});
      
      expect(result.success).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });

  describe('validation methods', () => {
    it('should validate suggestions before execution', async () => {
      const suggestions = [mockSuggestions[0]];
      const mockFileRecord = {
        id: 1,
        path: '/test/original.txt',
        size: 1024,
        mtime: Date.now(),
        lastScannedAt: Date.now()
      };

      mockDatabase.getFileById.mockReturnValue(mockFileRecord);

      // Mock successful validation
      const mockValidationResult = {
        isValid: true,
        errors: [],
        warnings: []
      };
      
      // We need to mock the internal validator instance
      // For now, we'll test the public interface
      const result = await service.validateSuggestions(suggestions);

      expect(result).toBeDefined();
      expect(result.success).toBeDefined();
      expect(result.validationResult).toBeDefined();
    });

    it('should handle validation errors', async () => {
      const suggestions = [mockSuggestions[0]];
      
      // Mock file not found scenario
      mockDatabase.getFileById.mockReturnValue(null);

      const result = await service.validateSuggestions(suggestions);

      expect(result.success).toBe(false);
      expect(result.canProceed).toBe(false);
      expect(result.criticalIssues).toBe(true);
    });

    it('should validate single suggestion', async () => {
      const suggestion = mockSuggestions[0];
      const mockFileRecord = {
        id: 1,
        path: '/test/original.txt',
        size: 1024,
        mtime: Date.now(),
        lastScannedAt: Date.now()
      };

      mockDatabase.getFileById.mockReturnValue(mockFileRecord);

      const result = await service.validateSingleSuggestion(suggestion);

      expect(result).toBeDefined();
      expect(result.isValid).toBeDefined();
      expect(result.errors).toBeDefined();
      expect(result.warnings).toBeDefined();
    });

    it('should generate validation report', () => {
      const validationResult = {
        isValid: true,
        errors: [],
        warnings: []
      };

      const report = service.generateValidationReport(validationResult);

      expect(typeof report).toBe('string');
      expect(report.length).toBeGreaterThan(0);
    });

    it('should handle partial failures', async () => {
      const failedOps = [
        { id: 'op1', error: 'Permission denied', source: '/test1.txt' }
      ];
      const succeededOps = [
        { id: 'op2', status: 'completed', source: '/test2.txt' }
      ];

      const result = await service.handlePartialFailure('tx-1', failedOps, succeededOps);

      expect(result.success).toBe(true);
      expect(['rollback', 'continue', 'manual_review']).toContain(result.recoveryAction);
    });

    it('should retry failed operations', async () => {
      const failedOps = [
        { id: 'op1', error: 'Network timeout', source: '/test1.txt' }
      ];

      const result = await service.retryFailedOperations(failedOps, 2);

      expect(result.success).toBe(true);
      expect(Array.isArray(result.retriedSuccessfully)).toBe(true);
      expect(Array.isArray(result.permanentFailures)).toBe(true);
    });

    it('should generate error reports', () => {
      const errors = [
        { message: 'Permission denied', operationId: 'op1', path: '/test1.txt' },
        { message: 'File not found', operationId: 'op2', path: '/test2.txt' }
      ];

      const report = service.generateErrorReport(errors);

      expect(typeof report).toBe('string');
      expect(report).toContain('ERROR REPORT');
      expect(report).toContain('PERMISSION');
      expect(report).toContain('FILE_NOT_FOUND');
    });
  });
});
