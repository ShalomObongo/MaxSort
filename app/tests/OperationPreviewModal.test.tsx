import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import OperationPreviewModal from '../src/renderer/components/OperationPreviewModal';
import type { ExecutionBatch, ExecutionSummary } from '../src/lib/suggestion-execution-service';

describe('OperationPreviewModal', () => {
  const mockBatches: ExecutionBatch[] = [
    {
      id: 'batch-1',
      suggestions: [
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
        }
      ],
      operations: [
        {
          id: 'op-1',
          type: 'rename',
          fileId: 1,
          originalPath: '/test/document.txt',
          targetPath: '/test/document-renamed.txt',
          confidence: 0.95,
          priority: 'high',
          status: 'pending',
          createdAt: Date.now()
        }
      ],
      groupCriteria: 'High Confidence Operations',
      estimatedDuration: 1000,
      riskLevel: 'low'
    },
    {
      id: 'batch-2',
      suggestions: [
        {
          id: 2,
          fileId: 2,
          requestId: 'req-2',
          analysisType: 'rename-suggestions' as const,
          suggestedValue: 'image-processed.jpg',
          originalConfidence: 0.65,
          adjustedConfidence: 0.65,
          qualityScore: 0.7,
          reasoning: 'Lower confidence rename',
          modelUsed: 'test-model',
          analysisDuration: 120,
          rankPosition: 2,
          isRecommended: true
        }
      ],
      operations: [
        {
          id: 'op-2',
          type: 'rename',
          fileId: 2,
          originalPath: '/test/image.jpg',
          targetPath: '/test/image-processed.jpg',
          confidence: 0.65,
          priority: 'medium',
          status: 'pending',
          createdAt: Date.now()
        }
      ],
      groupCriteria: 'Medium Confidence Operations',
      estimatedDuration: 1500,
      riskLevel: 'medium'
    }
  ];

  const mockSummary: ExecutionSummary = {
    totalSuggestions: 2,
    totalBatches: 2,
    estimatedDuration: 2500,
    riskAssessment: {
      low: 1,
      medium: 1,
      high: 0
    },
    operationCounts: {
      rename: 2,
      move: 0
    }
  };

  const defaultProps = {
    isOpen: true,
    batches: mockBatches,
    summary: mockSummary,
    onConfirm: vi.fn(),
    onCancel: vi.fn(),
    showRiskAnalysis: true,
    allowPartialSelection: true
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Modal Display', () => {
    it('should render modal when open', () => {
      render(<OperationPreviewModal {...defaultProps} />);
      
      expect(screen.getByText('Operation Preview & Confirmation')).toBeInTheDocument();
      expect(screen.getByText('Execution Summary')).toBeInTheDocument();
    });

    it('should not render modal when closed', () => {
      render(<OperationPreviewModal {...defaultProps} isOpen={false} />);
      
      expect(screen.queryByText('Operation Preview & Confirmation')).not.toBeInTheDocument();
    });

    it('should display execution summary correctly', () => {
      render(<OperationPreviewModal {...defaultProps} />);
      
      expect(screen.getByText('2')).toBeInTheDocument(); // Total operations
      expect(screen.getByText('2')).toBeInTheDocument(); // Batches
      expect(screen.getByText(/2s/)).toBeInTheDocument(); // Duration formatting
    });

    it('should display risk assessment when enabled', () => {
      render(<OperationPreviewModal {...defaultProps} />);
      
      expect(screen.getByText('Risk Assessment')).toBeInTheDocument();
      expect(screen.getByText('Low Risk')).toBeInTheDocument();
      expect(screen.getByText('Medium Risk')).toBeInTheDocument();
      expect(screen.getByText('High Risk')).toBeInTheDocument();
    });

    it('should hide risk assessment when disabled', () => {
      render(<OperationPreviewModal {...defaultProps} showRiskAnalysis={false} />);
      
      expect(screen.queryByText('Risk Assessment')).not.toBeInTheDocument();
    });
  });

  describe('Batch Selection', () => {
    it('should select all batches by default', () => {
      render(<OperationPreviewModal {...defaultProps} />);
      
      const checkboxes = screen.getAllByRole('checkbox');
      checkboxes.forEach(checkbox => {
        expect(checkbox).toBeChecked();
      });
    });

    it('should allow individual batch selection', () => {
      render(<OperationPreviewModal {...defaultProps} />);
      
      const checkboxes = screen.getAllByRole('checkbox');
      const firstCheckbox = checkboxes[0];
      
      fireEvent.click(firstCheckbox);
      
      expect(firstCheckbox).not.toBeChecked();
    });

    it('should handle select all functionality', () => {
      render(<OperationPreviewModal {...defaultProps} />);
      
      const selectAllButton = screen.getByText('Deselect All');
      fireEvent.click(selectAllButton);
      
      const checkboxes = screen.getAllByRole('checkbox');
      checkboxes.forEach(checkbox => {
        expect(checkbox).not.toBeChecked();
      });
      
      expect(screen.getByText('Select All')).toBeInTheDocument();
    });

    it('should disable partial selection when not allowed', () => {
      render(<OperationPreviewModal {...defaultProps} allowPartialSelection={false} />);
      
      expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
      expect(screen.queryByText('Select All')).not.toBeInTheDocument();
    });
  });

  describe('Batch Expansion', () => {
    it('should expand batch to show operations', () => {
      render(<OperationPreviewModal {...defaultProps} />);
      
      const expandButtons = screen.getAllByLabelText(/Expand batch/);
      const firstExpandButton = expandButtons[0];
      
      fireEvent.click(firstExpandButton);
      
      expect(screen.getByText('document-renamed.txt')).toBeInTheDocument();
      expect(screen.getByText('File 1')).toBeInTheDocument();
    });

    it('should collapse expanded batch', () => {
      render(<OperationPreviewModal {...defaultProps} />);
      
      const expandButtons = screen.getAllByLabelText(/Expand batch/);
      const firstExpandButton = expandButtons[0];
      
      // Expand first
      fireEvent.click(firstExpandButton);
      expect(screen.getByText('document-renamed.txt')).toBeInTheDocument();
      
      // Collapse
      const collapseButton = screen.getByLabelText(/Collapse batch/);
      fireEvent.click(collapseButton);
      
      expect(screen.queryByText('document-renamed.txt')).not.toBeInTheDocument();
    });
  });

  describe('Validation', () => {
    it('should show validation results', async () => {
      render(<OperationPreviewModal {...defaultProps} />);
      
      await waitFor(() => {
        expect(screen.getByText('Validation Results')).toBeInTheDocument();
      });
    });

    it('should detect duplicate target paths', async () => {
      const batchesWithDuplicates = [
        {
          ...mockBatches[0],
          suggestions: [
            mockBatches[0].suggestions[0],
            { ...mockBatches[0].suggestions[0], id: 3, fileId: 3 }
          ]
        }
      ];

      render(<OperationPreviewModal {...defaultProps} batches={batchesWithDuplicates} />);
      
      await waitFor(() => {
        expect(screen.getByText(/Duplicate target paths detected/)).toBeInTheDocument();
      });
    });

    it('should warn about low confidence operations', async () => {
      const lowConfidenceBatch = {
        ...mockBatches[1],
        suggestions: [{
          ...mockBatches[1].suggestions[0],
          adjustedConfidence: 0.4
        }]
      };

      render(<OperationPreviewModal {...defaultProps} batches={[lowConfidenceBatch]} />);
      
      await waitFor(() => {
        expect(screen.getByText(/very low confidence/)).toBeInTheDocument();
      });
    });
  });

  describe('Advanced Details', () => {
    it('should toggle advanced details', () => {
      render(<OperationPreviewModal {...defaultProps} />);
      
      const expandButtons = screen.getAllByLabelText(/Expand batch/);
      fireEvent.click(expandButtons[0]); // Expand batch first
      
      const toggleButton = screen.getByText('Show Details');
      fireEvent.click(toggleButton);
      
      expect(screen.getByText('Hide Details')).toBeInTheDocument();
      expect(screen.getByText(/95% confidence/)).toBeInTheDocument();
      expect(screen.getByText('High confidence rename')).toBeInTheDocument();
    });
  });

  describe('Modal Actions', () => {
    it('should call onCancel when cancel button is clicked', () => {
      const onCancel = vi.fn();
      render(<OperationPreviewModal {...defaultProps} onCancel={onCancel} />);
      
      fireEvent.click(screen.getByText('Cancel'));
      
      expect(onCancel).toHaveBeenCalled();
    });

    it('should call onCancel when overlay is clicked', () => {
      const onCancel = vi.fn();
      render(<OperationPreviewModal {...defaultProps} onCancel={onCancel} />);
      
      const overlay = screen.getByRole('dialog').parentElement;
      fireEvent.click(overlay!);
      
      expect(onCancel).toHaveBeenCalled();
    });

    it('should call onConfirm with selected batches when confirmed', async () => {
      const onConfirm = vi.fn();
      render(<OperationPreviewModal {...defaultProps} onConfirm={onConfirm} />);
      
      // Wait for validation to complete
      await waitFor(() => {
        expect(screen.queryByText('Validating...')).not.toBeInTheDocument();
      });
      
      const confirmButton = screen.getByText(/Execute 2 Batches/);
      fireEvent.click(confirmButton);
      
      expect(onConfirm).toHaveBeenCalledWith(mockBatches);
    });

    it('should disable confirm button when no batches selected', () => {
      render(<OperationPreviewModal {...defaultProps} />);
      
      // Deselect all batches
      const selectAllButton = screen.getByText('Deselect All');
      fireEvent.click(selectAllButton);
      
      const confirmButton = screen.getByText(/Execute 0 Batch/);
      expect(confirmButton).toBeDisabled();
    });

    it('should disable confirm button during validation', () => {
      render(<OperationPreviewModal {...defaultProps} />);
      
      const confirmButton = screen.queryByText('Validating...');
      if (confirmButton) {
        expect(confirmButton).toBeDisabled();
      }
    });
  });

  describe('Duration Formatting', () => {
    it('should format milliseconds correctly', () => {
      const { rerender } = render(<OperationPreviewModal {...defaultProps} />);
      
      // Test seconds
      const summary1000ms = { ...mockSummary, estimatedDuration: 1000 };
      rerender(<OperationPreviewModal {...defaultProps} summary={summary1000ms} />);
      expect(screen.getByText('1s')).toBeInTheDocument();
      
      // Test minutes
      const summary60000ms = { ...mockSummary, estimatedDuration: 60000 };
      rerender(<OperationPreviewModal {...defaultProps} summary={summary60000ms} />);
      expect(screen.getByText('1m 0s')).toBeInTheDocument();
    });
  });

  describe('Accessibility', () => {
    it('should have proper ARIA labels', () => {
      render(<OperationPreviewModal {...defaultProps} />);
      
      expect(screen.getByLabelText('Close modal')).toBeInTheDocument();
      expect(screen.getAllByLabelText(/Expand batch/)).toHaveLength(2);
    });

    it('should prevent modal content click from closing modal', () => {
      const onCancel = vi.fn();
      render(<OperationPreviewModal {...defaultProps} onCancel={onCancel} />);
      
      const modalContent = screen.getByText('Operation Preview & Confirmation').closest('.operation-preview-modal');
      fireEvent.click(modalContent!);
      
      expect(onCancel).not.toHaveBeenCalled();
    });
  });
});
