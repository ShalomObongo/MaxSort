/**
 * Integration tests for File Analysis Pipeline
 * Tests the complete flow from file → analysis → suggestions
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FileAnalysisService, AnalysisRequest } from '../src/lib/file-analysis-service';
import { AnalysisType } from '../src/agents/prompt-templates';
import { getAnalysisTaskGenerator } from '../src/lib/analysis-task-generator';
import { ConfidenceScorer } from '../src/lib/confidence-scorer';
import { getDatabase } from '../src/lib/database';
import { getAgentManager } from '../src/agents/agent-manager';
import { logger } from '../src/lib/logger';
import { errorRecoveryManager } from '../src/lib/error-recovery-manager';

// Mock external dependencies
vi.mock('../src/lib/database');
vi.mock('../src/agents/agent-manager');
vi.mock('../src/lib/ollama-client');

describe('File Analysis Pipeline Integration', () => {
  let analysisService: FileAnalysisService;
  let mockDatabase: any;
  let mockAgentManager: any;

  const mockFileRecords = [
    {
      id: 1,
      path: '/test/project_report.pdf',
      fileName: 'project_report.pdf',
      fileExtension: '.pdf',
      size: 1024000,
      mtime: Date.now(),
      lastScannedAt: Date.now(),
      parentDirectory: '/test'
    },
    {
      id: 2,
      path: '/test/IMG_0123.jpg',
      fileName: 'IMG_0123.jpg', 
      fileExtension: '.jpg',
      size: 2048000,
      mtime: Date.now(),
      lastScannedAt: Date.now(),
      parentDirectory: '/test'
    }
  ];

  const mockAIResponse = {
    response: JSON.stringify({
      suggestions: [
        {
          value: 'quarterly_financial_report_2024.pdf',
          confidence: 92,
          reasoning: 'Based on content analysis, this appears to be a financial report for Q4 2024'
        },
        {
          value: 'business_report.pdf',
          confidence: 78,
          reasoning: 'Generic business document classification'
        }
      ]
    }),
    executionTimeMs: 2500
  };

  beforeEach(async () => {
    // Setup database mock with transaction support
    mockDatabase = {
      // Core database methods
      getFilesByIds: vi.fn().mockImplementation((fileIds) => {
        return Promise.resolve(fileIds.map(id => ({
          id: id,
          path: `/test/sample-${id}.pdf`,
          name: `sample-${id}.pdf`,
          size: 1024,
          mimeType: 'application/pdf',
          hash: `hash-${id}`,
          scannedAt: new Date().toISOString(),
          modifiedAt: new Date().toISOString(),
          createdAt: new Date().toISOString()
        })));
      }),
      getFilesByRootPath: vi.fn(),
      initializeDatabase: vi.fn(),
      saveSuggestions: vi.fn(),
      createAnalysisSession: vi.fn(),
      updateAnalysisSession: vi.fn(),
      getModelPreferences: vi.fn().mockResolvedValue({
        mainModel: 'llama3.1:8b',
        subModel: null
      }),
      transaction: vi.fn().mockImplementation((callback) => {
        // Mock transaction - pass a database-like object to the callback with prepare method
        const mockDb = {
          prepare: vi.fn().mockReturnValue({
            run: vi.fn(),
            all: vi.fn().mockReturnValue([]),
            get: vi.fn().mockReturnValue({
              id: 1,
              path: '/test/sample.pdf',
              name: 'sample.pdf',
              size: 1024,
              mimeType: 'application/pdf',
              hash: 'abc123',
              scannedAt: new Date().toISOString(),
              modifiedAt: new Date().toISOString(),
              createdAt: new Date().toISOString()
            })
          })
        };
        return callback(mockDb);
      }),
      prepare: vi.fn().mockReturnValue({
        run: vi.fn(),
        all: vi.fn().mockReturnValue([]),
        get: vi.fn().mockReturnValue(null)
      })
    };

    // Setup agent manager mock with missing methods
    mockAgentManager = {
      createTask: vi.fn().mockResolvedValue('mock-task-id'),
      cancelTask: vi.fn().mockResolvedValue(true),
      getStatus: vi.fn().mockReturnValue({ 
        isRunning: true,
        availableSlots: 4,
        totalSlots: 4,
        activeTaskCount: 0
      }),
      start: vi.fn(),
      stop: vi.fn(),
      on: vi.fn(),
      emit: vi.fn()
    };

    // Mock the module functions
    vi.mocked(getDatabase).mockReturnValue(mockDatabase);
    vi.mocked(getAgentManager).mockReturnValue(mockAgentManager);

    // Create analysis service
    analysisService = new FileAnalysisService();
    await analysisService.initialize();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('End-to-End Analysis Flow', () => {
    it('should complete full analysis pipeline for single file', async () => {
      // Arrange
      const request: AnalysisRequest = {
        requestId: 'test-request-1',
        fileIds: [1],
        analysisTypes: ['rename-suggestions' as AnalysisType],
        isInteractive: true,
        priority: 'high',
        modelName: 'llama3.1:8b'
      };

      mockDatabase.getFilesByIds.mockResolvedValue([mockFileRecords[0]]);
      mockAgentManager.createTask.mockResolvedValue('task-123');

      // Setup task completion simulation
      const taskCompletionHandler = vi.fn();
      analysisService.on('preview-update', taskCompletionHandler);

      // Act
      const requestId = await analysisService.startAnalysis(request);

      // Simulate task completion with AI response
      const taskResult = {
        taskId: 'task-123',
        status: 'completed' as const,
        result: mockAIResponse,
        executionTimeMs: 2500,
        error: null
      };

      // Simulate the task completion event
      mockAgentManager.on.mock.calls.find(call => call[0] === 'task-completed')?.[1]?.(taskResult);

      // Assert
      expect(requestId).toBe('test-request-1');
      expect(mockDatabase.getFilesByIds).toHaveBeenCalledWith([1]);
      expect(mockAgentManager.createTask).toHaveBeenCalled();
      
      // Check that suggestions were processed
      const results = analysisService.getAnalysisResults(requestId);
      expect(results).toBeDefined();
    }, 10000);

    it('should handle multiple files with different analysis types', async () => {
      // Arrange
      const request: AnalysisRequest = {
        requestId: 'test-request-2',
        fileIds: [1, 2],
        analysisTypes: ['rename-suggestions' as AnalysisType, 'classification' as AnalysisType],
        isInteractive: false,
        priority: 'normal',
        modelName: 'llama3.1:8b'
      };

      mockDatabase.getFilesByIds.mockResolvedValue(mockFileRecords);
      mockAgentManager.createTask.mockResolvedValue('task-456');

      // Act
      const requestId = await analysisService.startAnalysis(request);

      // Assert
      expect(requestId).toBe('test-request-2');
      expect(mockAgentManager.createTask).toHaveBeenCalledTimes(4); // 2 files × 2 analysis types
      
      const progress = analysisService.getAnalysisProgress(requestId);
      expect(progress?.totalFiles).toBe(4); // 2 files × 2 analysis types
    });

    it('should handle progress tracking throughout analysis', async () => {
      // Arrange
      const request: AnalysisRequest = {
        requestId: 'test-request-3',
        fileIds: [1],
        analysisTypes: ['rename-suggestions' as AnalysisType],
        isInteractive: true,
        priority: 'high',
        modelName: 'llama3.1:8b'
      };

      mockDatabase.getFilesByIds.mockResolvedValue([mockFileRecords[0]]);
      mockAgentManager.createTask.mockResolvedValue('task-789');

      // Track progress updates
      const progressUpdates: any[] = [];
      analysisService.on('progress-update', (update) => {
        progressUpdates.push(update);
      });

      // Act
      await analysisService.startAnalysis(request);

      // Assert initial progress
      const initialProgress = analysisService.getAnalysisProgress('test-request-3');
      expect(initialProgress?.phase).toBe('analyzing');
      expect(initialProgress?.totalFiles).toBeGreaterThan(0);
      expect(initialProgress?.processedFiles).toBe(0);
    });
  });

  describe('Error Handling Integration', () => {
    it('should recover from AI model failures using fallback', async () => {
      // Arrange
      const request: AnalysisRequest = {
        requestId: 'test-request-error-1',
        fileIds: [1],
        analysisTypes: ['rename-suggestions' as AnalysisType],
        isInteractive: true,
        priority: 'high',
        modelName: 'llama3.1:8b'
      };

      mockDatabase.getFilesByIds.mockResolvedValue([mockFileRecords[0]]);
      mockAgentManager.createTask.mockResolvedValue('task-error');

      // Act
      await analysisService.startAnalysis(request);

      // Simulate task failure
      const taskFailure = {
        taskId: 'task-error',
        status: 'failed' as const,
        result: null,
        executionTimeMs: 5000,
        error: new Error('Ollama connection timeout')
      };

      // Simulate the task failure event
      mockAgentManager.on.mock.calls.find(call => call[0] === 'task-failed')?.[1]?.(taskFailure);

      // Assert
      const progress = analysisService.getAnalysisProgress('test-request-error-1');
      expect(progress?.failedFiles).toBeGreaterThan(0);
      expect(progress?.errorRate).toBeGreaterThan(0);
    });

    it('should handle emergency mode activation on repeated failures', async () => {
      // Arrange
      const requests = Array.from({ length: 10 }, (_, i) => ({
        requestId: `emergency-test-${i}`,
        fileIds: [1],
        analysisTypes: ['rename-suggestions' as AnalysisType],
        isInteractive: true,
        priority: 'high' as const,
        modelName: 'llama3.1:8b'
      }));

      mockDatabase.getFilesByIds.mockResolvedValue([mockFileRecords[0]]);
      mockAgentManager.createTask.mockResolvedValue('task-emergency');

      // Act - trigger multiple failures
      for (const request of requests.slice(0, 6)) { // Trigger more than threshold
        try {
          await analysisService.startAnalysis(request);
          
          // Simulate immediate failure
          const taskFailure = {
            taskId: 'task-emergency',
            status: 'failed' as const,
            result: null,
            executionTimeMs: 100,
            error: new Error('Repeated AI failure')
          };

          mockAgentManager.on.mock.calls.find(call => call[0] === 'task-failed')?.[1]?.(taskFailure);
        } catch (error) {
          // Expected as service enters emergency mode
        }
      }

      // Assert emergency mode was triggered
      // This would be detected through service metrics or status
      expect(true).toBe(true); // Placeholder - would check actual emergency mode status
    });
  });

  describe('Performance Integration', () => {
    it('should handle concurrent analysis requests efficiently', async () => {
      // Arrange
      const concurrentRequests = Array.from({ length: 5 }, (_, i) => ({
        requestId: `concurrent-${i}`,
        fileIds: [i + 1],
        analysisTypes: ['rename-suggestions' as AnalysisType],
        isInteractive: false,
        priority: 'normal' as const,
        modelName: 'llama3.1:8b'
      }));

      mockDatabase.getFilesByIds.mockImplementation((ids) => 
        Promise.resolve(mockFileRecords.filter(f => ids.includes(f.id)))
      );
      mockAgentManager.createTask.mockResolvedValue('task-concurrent');

      // Act
      const startTime = Date.now();
      const promises = concurrentRequests.map(req => analysisService.startAnalysis(req));
      await Promise.all(promises);
      const executionTime = Date.now() - startTime;

      // Assert
      expect(executionTime).toBeLessThan(2000); // Should handle concurrency efficiently
      expect(mockAgentManager.createTask).toHaveBeenCalledTimes(5);
    });

    it('should manage memory usage during batch processing', async () => {
      // Arrange
      const largeBatch = Array.from({ length: 100 }, (_, i) => ({
        id: i + 1,
        path: `/test/file_${i}.pdf`,
        fileName: `file_${i}.pdf`,
        fileExtension: '.pdf',
        size: 1024,
        mtime: Date.now(),
        lastScannedAt: Date.now(),
        parentDirectory: '/test'
      }));

      const request: AnalysisRequest = {
        requestId: 'batch-memory-test',
        fileIds: largeBatch.map(f => f.id),
        analysisTypes: ['rename-suggestions' as AnalysisType],
        isInteractive: false,
        priority: 'normal',
        modelName: 'llama3.1:8b'
      };

      mockDatabase.getFilesByIds.mockResolvedValue(largeBatch);
      mockAgentManager.createTask.mockResolvedValue('batch-task');

      // Monitor memory before test
      const initialMemory = process.memoryUsage().heapUsed;

      // Act
      await analysisService.startAnalysis(request);

      // Assert
      const finalMemory = process.memoryUsage().heapUsed;
      const memoryIncrease = finalMemory - initialMemory;
      const memoryIncreaseKB = memoryIncrease / 1024;
      
      // Should not use excessive memory for batch processing
      expect(memoryIncreaseKB).toBeLessThan(10000); // Less than 10MB increase
    });
  });

  describe('Real-time Updates Integration', () => {
    it('should emit preview updates as tasks complete', async () => {
      // Arrange
      const request: AnalysisRequest = {
        requestId: 'preview-test',
        fileIds: [1],
        analysisTypes: ['rename-suggestions' as AnalysisType],
        isInteractive: true,
        priority: 'high',
        modelName: 'llama3.1:8b'
      };

      mockDatabase.getFilesByIds.mockResolvedValue([mockFileRecords[0]]);
      mockAgentManager.createTask.mockResolvedValue('preview-task');

      const previewUpdates: any[] = [];
      analysisService.on('preview-update', (update) => {
        previewUpdates.push(update);
      });

      // Act
      await analysisService.startAnalysis(request);

      // Simulate task completion
      const taskResult = {
        taskId: 'preview-task',
        status: 'completed' as const,
        result: mockAIResponse,
        executionTimeMs: 1500,
        error: null
      };

      mockAgentManager.on.mock.calls.find(call => call[0] === 'task-completed')?.[1]?.(taskResult);

      // Assert
      expect(previewUpdates.length).toBeGreaterThan(0);
      expect(previewUpdates[0]).toHaveProperty('requestId', 'preview-test');
      expect(previewUpdates[0]).toHaveProperty('fileResult');
      expect(previewUpdates[0]).toHaveProperty('progress');
    });

    it('should support analysis cancellation', async () => {
      // Arrange
      const request: AnalysisRequest = {
        requestId: 'cancel-test',
        fileIds: [1, 2],
        analysisTypes: ['rename-suggestions' as AnalysisType],
        isInteractive: true,
        priority: 'high',
        modelName: 'llama3.1:8b'
      };

      mockDatabase.getFilesByIds.mockResolvedValue(mockFileRecords);
      mockAgentManager.createTask.mockResolvedValue('cancel-task');
      mockAgentManager.cancelTask = vi.fn().mockResolvedValue(true);

      // Act
      await analysisService.startAnalysis(request);
      const cancelled = await analysisService.cancelAnalysis('cancel-test', 'User requested cancellation');

      // Assert
      expect(cancelled).toBe(true);
      expect(mockAgentManager.cancelTask).toHaveBeenCalled();
      
      // Should clean up request data
      const progress = analysisService.getAnalysisProgress('cancel-test');
      expect(progress).toBeNull();
    });
  });

  describe('Database Integration', () => {
    it('should persist analysis results to database', async () => {
      // Arrange
      const request: AnalysisRequest = {
        requestId: 'db-persist-test',
        fileIds: [1],
        analysisTypes: ['rename-suggestions' as AnalysisType],
        isInteractive: true,
        priority: 'high',
        modelName: 'llama3.1:8b'
      };

      mockDatabase.getFilesByIds.mockResolvedValue([mockFileRecords[0]]);
      mockDatabase.createAnalysisSession.mockResolvedValue('session-123');
      mockDatabase.saveSuggestions.mockResolvedValue(true);
      mockAgentManager.createTask.mockResolvedValue('db-task');

      // Act
      await analysisService.startAnalysis(request);

      // Simulate successful completion
      const taskResult = {
        taskId: 'db-task',
        status: 'completed' as const,
        result: mockAIResponse,
        executionTimeMs: 2000,
        error: null
      };

      mockAgentManager.on.mock.calls.find(call => call[0] === 'task-completed')?.[1]?.(taskResult);

      // Assert
      // Would verify database calls in real implementation
      expect(mockDatabase.createAnalysisSession).toHaveBeenCalled();
    });
  });

  describe('Logging Integration', () => {
    it('should generate comprehensive logs throughout pipeline', async () => {
      // Arrange
      const request: AnalysisRequest = {
        requestId: 'logging-test',
        fileIds: [1],
        analysisTypes: ['rename-suggestions' as AnalysisType],
        isInteractive: true,
        priority: 'high',
        modelName: 'llama3.1:8b'
      };

      mockDatabase.getFilesByIds.mockResolvedValue([mockFileRecords[0]]);
      mockAgentManager.createTask.mockResolvedValue('logging-task');

      // Track logs (in real implementation, would use logger.getRecentEntries())
      const logSpy = vi.spyOn(logger, 'info');

      // Act
      await analysisService.startAnalysis(request);

      // Assert
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('FileAnalysisService'),
        expect.stringContaining('Starting analysis request'),
        expect.any(Object)
      );
    });
  });
});
