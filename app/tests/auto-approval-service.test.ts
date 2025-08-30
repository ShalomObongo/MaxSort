/**
 * Tests for AutoApprovalService
 */

import { describe, test, expect, beforeEach, vi } from 'vitest';
import { AutoApprovalService, createAutoApprovalService } from '../src/lib/auto-approval-service';
import { SuggestionFilter } from '../src/lib/suggestion-filter';
import { BatchOperationManager } from '../src/lib/batch-operation-manager';
import { ProcessedSuggestion } from '../src/lib/confidence-scorer';
import { 
  SuggestionCategory,
  createDefaultConfidenceThresholdConfig 
} from '../src/lib/confidence-threshold-config';

// Mock the logger
vi.mock('../src/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    startPerformanceTimer: vi.fn(() => 'timer-id'),
    endPerformanceTimer: vi.fn(),
  },
  AnalysisError: class AnalysisError extends Error {
    constructor(type: string, message: string, context?: any) {
      super(message);
      this.name = 'AnalysisError';
    }
  },
  AnalysisErrorType: {
    VALIDATION_ERROR: 'validation_error',
  }
}));

// Mock SuggestionFilter
const mockSuggestionFilter = {
  filterSuggestions: vi.fn(),
  getConfig: vi.fn(),
  updateConfig: vi.fn(),
} as unknown as SuggestionFilter;

// Mock BatchOperationManager
const mockBatchOperationManager = {
  addOperation: vi.fn(),
  createBatch: vi.fn(),
  getBatchStatus: vi.fn(),
  cancelBatch: vi.fn(),
} as unknown as BatchOperationManager;

describe('AutoApprovalService', () => {
  let autoApprovalService: AutoApprovalService;
  let sampleSuggestions: ProcessedSuggestion[];
  let sampleFileMetadata: Map<string, any>;

  beforeEach(() => {
    vi.clearAllMocks();
    
    autoApprovalService = new AutoApprovalService(
      mockSuggestionFilter,
      mockBatchOperationManager,
      {
        maxQueueSize: 10,
        maxAutoApprovalsPerBatch: 3,
        batchProcessingIntervalMs: 1000,
        enableSafetyChecks: true,
        requireMinimumConfidence: 0.80,
      }
    );

    sampleSuggestions = [
      {
        value: 'high_confidence_file.pdf',
        confidence: 95,
        originalConfidence: 95,
        adjustedConfidence: 95,
        qualityScore: 90,
        validationFlags: ['good-pattern-lowercase-with-separators'],
        isRecommended: true,
        rank: 1
      },
      {
        value: 'medium_confidence_file.docx',
        confidence: 75,
        originalConfidence: 75,
        adjustedConfidence: 85, // Above minimum confidence
        qualityScore: 70,
        validationFlags: ['consistent-case'],
        isRecommended: false,
        rank: 2
      },
      {
        value: 'low_confidence_file.tmp',
        confidence: 25,
        originalConfidence: 25,
        adjustedConfidence: 25,
        qualityScore: 30,
        validationFlags: ['contains-generic-terms'],
        isRecommended: false,
        rank: 3
      }
    ];

    sampleFileMetadata = new Map([
      ['high_confidence_file.pdf', {
        fileId: 1,
        originalPath: '/Users/test/downloads/document.pdf',
        targetPath: '/Users/test/documents/high_confidence_file.pdf',
        fileType: 'pdf',
        size: 1024000,
        operationType: 'rename'
      }],
      ['medium_confidence_file.docx', {
        fileId: 2,
        originalPath: '/Users/test/downloads/file.docx',
        targetPath: '/Users/test/documents/medium_confidence_file.docx',
        fileType: 'docx',
        size: 512000,
        operationType: 'rename'
      }],
      ['low_confidence_file.tmp', {
        fileId: 3,
        originalPath: '/Users/test/downloads/temp.tmp',
        targetPath: '/Users/test/documents/low_confidence_file.tmp',
        fileType: 'tmp',
        size: 128000,
        operationType: 'rename'
      }]
    ]);
  });

  describe('constructor and configuration', () => {
    test('should create service with default configuration', () => {
      const service = new AutoApprovalService(mockSuggestionFilter, mockBatchOperationManager);
      
      const status = service.getQueueStatus();
      expect(status.maxQueueSize).toBe(100); // Default value
      expect(status.queueSize).toBe(0);
      expect(status.isProcessing).toBe(false);
    });

    test('should create service with custom configuration', () => {
      const config = {
        maxQueueSize: 50,
        maxAutoApprovalsPerBatch: 10,
        enableSafetyChecks: false,
      };
      
      const service = new AutoApprovalService(mockSuggestionFilter, mockBatchOperationManager, config);
      
      const status = service.getQueueStatus();
      expect(status.maxQueueSize).toBe(50);
    });

    test('should update configuration', () => {
      const updates = {
        maxQueueSize: 20,
        enableSafetyChecks: false,
      };
      
      autoApprovalService.updateConfig(updates);
      
      const status = autoApprovalService.getQueueStatus();
      expect(status.maxQueueSize).toBe(20);
    });
  });

  describe('processSuggestions', () => {
    test('should process suggestions and queue auto-approved ones', async () => {
      // Setup mock filter to return auto-approved suggestions
      (mockSuggestionFilter.filterSuggestions as any).mockResolvedValue({
        filteredSuggestions: [
          {
            originalSuggestion: sampleSuggestions[0],
            category: SuggestionCategory.AUTO_APPROVE,
            reason: 'High confidence',
            canOverride: true,
          },
          {
            originalSuggestion: sampleSuggestions[1],
            category: SuggestionCategory.AUTO_APPROVE,
            reason: 'High confidence',
            canOverride: true,
          },
          {
            originalSuggestion: sampleSuggestions[2],
            category: SuggestionCategory.REJECT,
            reason: 'Low confidence',
            canOverride: false,
          }
        ],
        statistics: {
          totalSuggestions: 3,
          autoApproved: 2,
          manualReview: 0,
          rejected: 1,
          averageConfidence: 0.68,
          filteringEffectiveness: 100,
          confidenceDistribution: []
        },
        totalProcessed: 3,
        filteringDuration: 100,
      });

      const result = await autoApprovalService.processSuggestions(sampleSuggestions, sampleFileMetadata);

      expect(result.totalProcessed).toBe(3);
      expect(result.queuedCount).toBe(2); // Two auto-approved suggestions
      expect(result.rejectedCount).toBe(1); // One rejected suggestion
      
      const status = autoApprovalService.getQueueStatus();
      expect(status.queueSize).toBe(2); // Two items in queue
    });

    test('should reject suggestions below minimum confidence', async () => {
      // Mock a suggestion that would be auto-approved by filter but below service minimum
      const lowConfidenceSuggestion = {
        ...sampleSuggestions[0],
        adjustedConfidence: 75, // Below 80% minimum
      };

      (mockSuggestionFilter.filterSuggestions as any).mockResolvedValue({
        filteredSuggestions: [
          {
            originalSuggestion: lowConfidenceSuggestion,
            category: SuggestionCategory.AUTO_APPROVE,
            reason: 'High confidence',
            canOverride: true,
          }
        ],
        statistics: {
          totalSuggestions: 1,
          autoApproved: 1,
          manualReview: 0,
          rejected: 0,
          averageConfidence: 0.75,
          filteringEffectiveness: 100,
          confidenceDistribution: []
        },
        totalProcessed: 1,
        filteringDuration: 50,
      });

      const result = await autoApprovalService.processSuggestions([lowConfidenceSuggestion], sampleFileMetadata);

      expect(result.queuedCount).toBe(0);
      expect(result.rejectedCount).toBe(1);
      
      const status = autoApprovalService.getQueueStatus();
      expect(status.queueSize).toBe(0);
    });

    test('should reject dangerous operations', async () => {
      // Create metadata for delete operation
      const dangerousMetadata = new Map([
        ['high_confidence_file.pdf', {
          ...sampleFileMetadata.get('high_confidence_file.pdf'),
          operationType: 'delete', // Delete operations are never auto-approved
        }]
      ]);

      (mockSuggestionFilter.filterSuggestions as any).mockResolvedValue({
        filteredSuggestions: [
          {
            originalSuggestion: sampleSuggestions[0],
            category: SuggestionCategory.AUTO_APPROVE,
            reason: 'High confidence',
            canOverride: true,
          }
        ],
        statistics: {
          totalSuggestions: 1,
          autoApproved: 1,
          manualReview: 0,
          rejected: 0,
          averageConfidence: 0.95,
          filteringEffectiveness: 100,
          confidenceDistribution: []
        },
        totalProcessed: 1,
        filteringDuration: 50,
      });

      const result = await autoApprovalService.processSuggestions([sampleSuggestions[0]], dangerousMetadata);

      expect(result.queuedCount).toBe(0);
      expect(result.rejectedCount).toBe(1);
    });

    test('should reject system file paths', async () => {
      // Create metadata with system path
      const systemPathMetadata = new Map([
        ['high_confidence_file.pdf', {
          ...sampleFileMetadata.get('high_confidence_file.pdf'),
          originalPath: '/System/important_file.pdf',
          targetPath: '/System/renamed_file.pdf',
        }]
      ]);

      (mockSuggestionFilter.filterSuggestions as any).mockResolvedValue({
        filteredSuggestions: [
          {
            originalSuggestion: sampleSuggestions[0],
            category: SuggestionCategory.AUTO_APPROVE,
            reason: 'High confidence',
            canOverride: true,
          }
        ],
        statistics: {
          totalSuggestions: 1,
          autoApproved: 1,
          manualReview: 0,
          rejected: 0,
          averageConfidence: 0.95,
          filteringEffectiveness: 100,
          confidenceDistribution: []
        },
        totalProcessed: 1,
        filteringDuration: 50,
      });

      const result = await autoApprovalService.processSuggestions([sampleSuggestions[0]], systemPathMetadata);

      expect(result.queuedCount).toBe(0);
      expect(result.rejectedCount).toBe(1);
    });

    test('should handle queue full scenario', async () => {
      // Fill up the queue first
      const manyMetadata = new Map();
      const manySuggestions: ProcessedSuggestion[] = [];
      
      for (let i = 0; i < 15; i++) { // More than maxQueueSize (10)
        const suggestion: ProcessedSuggestion = {
          ...sampleSuggestions[0],
          value: `file_${i}.pdf`,
          rank: i + 1
        };
        manySuggestions.push(suggestion);
        manyMetadata.set(`file_${i}.pdf`, {
          fileId: i + 1,
          originalPath: `/Users/test/downloads/file_${i}.pdf`,
          targetPath: `/Users/test/documents/file_${i}.pdf`,
          fileType: 'pdf',
          size: 1024000,
          operationType: 'rename'
        });
      }

      (mockSuggestionFilter.filterSuggestions as any).mockResolvedValue({
        filteredSuggestions: manySuggestions.map(suggestion => ({
          originalSuggestion: suggestion,
          category: SuggestionCategory.AUTO_APPROVE,
          reason: 'High confidence',
          canOverride: true,
        })),
        statistics: {
          totalSuggestions: manySuggestions.length,
          autoApproved: manySuggestions.length,
          manualReview: 0,
          rejected: 0,
          averageConfidence: 0.95,
          filteringEffectiveness: 100,
          confidenceDistribution: []
        },
        totalProcessed: manySuggestions.length,
        filteringDuration: 200,
      });

      const result = await autoApprovalService.processSuggestions(manySuggestions, manyMetadata);

      expect(result.queuedCount).toBeGreaterThan(0); // Some items should be queued
      expect(result.queuedCount).toBeLessThanOrEqual(10); // But not more than maxQueueSize
      expect(result.rejectedCount).toBeGreaterThan(0); // Some should be rejected
      expect(result.queuedCount + result.rejectedCount).toBe(manySuggestions.length);
      
      const status = autoApprovalService.getQueueStatus();
      expect(status.queueSize).toBeLessThanOrEqual(10); // Queue should not exceed max size
    });

    test('should handle missing metadata', async () => {
      const incompleteMetadata = new Map([
        ['high_confidence_file.pdf', sampleFileMetadata.get('high_confidence_file.pdf')]
        // Missing metadata for second suggestion
      ]);

      (mockSuggestionFilter.filterSuggestions as any).mockResolvedValue({
        filteredSuggestions: [
          {
            originalSuggestion: sampleSuggestions[0],
            category: SuggestionCategory.AUTO_APPROVE,
            reason: 'High confidence',
            canOverride: true,
          },
          {
            originalSuggestion: sampleSuggestions[1],
            category: SuggestionCategory.AUTO_APPROVE,
            reason: 'High confidence',
            canOverride: true,
          }
        ],
        statistics: {
          totalSuggestions: 2,
          autoApproved: 2,
          manualReview: 0,
          rejected: 0,
          averageConfidence: 0.90,
          filteringEffectiveness: 100,
          confidenceDistribution: []
        },
        totalProcessed: 2,
        filteringDuration: 100,
      });

      const result = await autoApprovalService.processSuggestions([sampleSuggestions[0], sampleSuggestions[1]], incompleteMetadata);

      expect(result.queuedCount).toBe(1); // Only one has metadata
      expect(result.rejectedCount).toBe(1); // One rejected due to missing metadata
    });
  });

  describe('queue management', () => {
    test('should get queue status', () => {
      const status = autoApprovalService.getQueueStatus();
      
      expect(status).toHaveProperty('queueSize');
      expect(status).toHaveProperty('maxQueueSize');
      expect(status).toHaveProperty('queuedEntries');
      expect(status).toHaveProperty('isProcessing');
      expect(Array.isArray(status.queuedEntries)).toBe(true);
    });

    test('should clear queue', () => {
      // First add some items to queue (mock the process)
      autoApprovalService.clearQueue();
      
      const status = autoApprovalService.getQueueStatus();
      expect(status.queueSize).toBe(0);
    });

    test('should force process queue', async () => {
      (mockBatchOperationManager.addOperation as any).mockReturnValue('op-1');
      (mockBatchOperationManager.createBatch as any).mockReturnValue('batch-123');

      // First add some items to queue by processing suggestions
      (mockSuggestionFilter.filterSuggestions as any).mockResolvedValue({
        filteredSuggestions: [
          {
            originalSuggestion: sampleSuggestions[0],
            category: SuggestionCategory.AUTO_APPROVE,
            reason: 'High confidence',
            canOverride: true,
          }
        ],
        statistics: {
          totalSuggestions: 1,
          autoApproved: 1,
          manualReview: 0,
          rejected: 0,
          averageConfidence: 0.95,
          filteringEffectiveness: 100,
          confidenceDistribution: []
        },
        totalProcessed: 1,
        filteringDuration: 50,
      });

      await autoApprovalService.processSuggestions([sampleSuggestions[0]], sampleFileMetadata);
      
      // Verify item was queued
      let status = autoApprovalService.getQueueStatus();
      expect(status.queueSize).toBe(1);

      // Force process the queue
      const batchId = await autoApprovalService.forceProcessQueue();
      expect(batchId).toBe('batch-123');

      // Verify queue is now empty
      status = autoApprovalService.getQueueStatus();
      expect(status.queueSize).toBe(0);
    });
  });

  describe('factory function', () => {
    test('should create service with factory', () => {
      const service = createAutoApprovalService(mockSuggestionFilter, mockBatchOperationManager);
      
      expect(service).toBeInstanceOf(AutoApprovalService);
      
      const status = service.getQueueStatus();
      expect(status.maxQueueSize).toBe(100); // Default value
    });

    test('should create service with custom config via factory', () => {
      const config = { maxQueueSize: 25, enableSafetyChecks: false };
      const service = createAutoApprovalService(mockSuggestionFilter, mockBatchOperationManager, config);
      
      const status = service.getQueueStatus();
      expect(status.maxQueueSize).toBe(25);
    });
  });

  describe('shutdown', () => {
    test('should shutdown cleanly', () => {
      autoApprovalService.shutdown();
      
      const status = autoApprovalService.getQueueStatus();
      expect(status.queueSize).toBe(0);
    });
  });
});
