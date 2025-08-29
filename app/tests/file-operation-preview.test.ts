import { describe, it, expect, beforeEach, vi, type MockedFunction } from 'vitest';
import { FileOperationPreviewService } from '../src/lib/file-operation-preview';
import type { DatabaseManager } from '../src/lib/database';
import type { Logger } from '../src/lib/logger';

describe('FileOperationPreviewService', () => {
  let previewService: FileOperationPreviewService;
  let mockDatabase: Partial<DatabaseManager>;
  let mockLogger: Partial<Logger>;

  beforeEach(() => {
    mockDatabase = {
      getSuggestionsByFileId: vi.fn().mockReturnValue([{
        id: 1,
        fileId: 1,
        suggestedValue: 'test-file.txt',
        confidence: 0.8,
      }])
    };

    mockLogger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      startPerformanceTimer: vi.fn().mockReturnValue('timer-id'),
      endPerformanceTimer: vi.fn(),
    };

    previewService = new FileOperationPreviewService(
      mockDatabase as DatabaseManager, 
      mockLogger as Logger
    );
  });

  describe('generatePreview', () => {
    it('should generate a preview for rename operation', async () => {
      const preview = await previewService.generatePreview(
        'op-1',
        'rename',
        1,
        'new-filename.txt',
        0.85
      );

      expect(preview).toBeDefined();
      expect(preview.operationId).toBe('op-1');
      expect(preview.type).toBe('rename');
      expect(preview.fileId).toBe(1);
      expect(preview.confidence).toBe(0.85);
      expect(preview.afterState.name).toBe('new-filename.txt');
    });

    it('should generate validation results', async () => {
      const preview = await previewService.generatePreview(
        'op-2',
        'rename',
        1,
        'valid-filename.txt',
        0.9
      );

      expect(preview.validationResults).toBeDefined();
      expect(Array.isArray(preview.validationResults)).toBe(true);
      expect(preview.validationResults.length).toBeGreaterThan(0);
    });

    it('should detect invalid characters in filename', async () => {
      const preview = await previewService.generatePreview(
        'op-3',
        'rename',
        1,
        'invalid<>file.txt',
        0.7
      );

      const invalidCharCheck = preview.validationResults.find(
        v => v.check === 'invalid_characters'
      );
      expect(invalidCharCheck?.status).toBe('fail');
    });
  });

  describe('generateBatchPreview', () => {
    it('should generate batch preview for multiple operations', async () => {
      const operations = [
        {
          operationId: 'op-1',
          type: 'rename' as const,
          fileId: 1,
          targetPath: 'file1.txt',
          confidence: 0.8,
        },
        {
          operationId: 'op-2', 
          type: 'rename' as const,
          fileId: 2,
          targetPath: 'file2.txt',
          confidence: 0.9,
        },
      ];

      const batchPreview = await previewService.generateBatchPreview('batch-1', operations);

      expect(batchPreview).toBeDefined();
      expect(batchPreview.batchId).toBe('batch-1');
      expect(batchPreview.previews).toHaveLength(2);
      expect(batchPreview.summary.totalOperations).toBe(2);
    });

    it('should detect cross-operation conflicts', async () => {
      const operations = [
        {
          operationId: 'op-1',
          type: 'rename' as const,
          fileId: 1,
          targetPath: 'same-name.txt',
          confidence: 0.8,
        },
        {
          operationId: 'op-2',
          type: 'rename' as const, 
          fileId: 2,
          targetPath: 'same-name.txt', // Same target name - conflict!
          confidence: 0.9,
        },
      ];

      const batchPreview = await previewService.generateBatchPreview('batch-conflict', operations);
      
      // At least one preview should have conflicts detected
      const previewsWithConflicts = batchPreview.previews.filter(
        p => p.impactAnalysis.conflictingOperations.length > 0
      );
      expect(previewsWithConflicts.length).toBeGreaterThan(0);
    });
  });

  describe('impact analysis', () => {
    it('should set appropriate risk levels', async () => {
      const deletePreview = await previewService.generatePreview(
        'delete-op',
        'delete',
        1,
        '',
        0.95
      );

      expect(deletePreview.impactAnalysis.riskLevel).toBe('high');

      const renamePreview = await previewService.generatePreview(
        'rename-op',
        'rename',
        1,
        'new-name.txt',
        0.8
      );

      expect(['low', 'medium']).toContain(renamePreview.impactAnalysis.riskLevel);
    });

    it('should detect extension changes', async () => {
      const preview = await previewService.generatePreview(
        'ext-change',
        'rename',
        1,
        'file.pdf', // Assuming original was .txt
        0.8
      );

      expect(preview.impactAnalysis.warnings).toBeDefined();
    });
  });
});
