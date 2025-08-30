import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import OperationHistory from './OperationHistory';

// Define types locally for testing
interface HistoricalOperation {
  id: string;
  type: string;
  operation: string;
  description: string;
  timestamp: string;
  duration: number;
  status: 'completed' | 'failed' | 'cancelled' | 'partially_completed';
  user: string;
  metadata?: Record<string, any>;
  results?: Record<string, any>;
  error?: string;
  canUndo: boolean;
  canRedo: boolean;
  undoRisk: 'low' | 'medium' | 'high' | 'critical';
  relatedOperations?: string[];
}

// Mock Electron API
const mockElectronAPI = {
  invoke: vi.fn(),
  on: vi.fn(),
  history: {
    getOperationHistory: vi.fn(),
    getOperationDetails: vi.fn(),
    exportOperationHistory: vi.fn(),
    prepareUndoOperation: vi.fn(),
    executeUndoOperation: vi.fn(),
    executeRedoOperation: vi.fn()
  },
  onHistoryUpdate: vi.fn(),
  onOperationUndone: vi.fn(),
  onOperationRedone: vi.fn(),
  removeAllListeners: vi.fn()
};

// Mock global electron object
Object.defineProperty(window, 'electronAPI', {
  value: mockElectronAPI,
  writable: true
});

// Mock date functions
const mockDate = new Date('2024-01-15T10:30:00Z');
vi.useFakeTimers();
vi.setSystemTime(mockDate);

// Sample test data
const mockOperations: HistoricalOperation[] = [
  {
    id: 'op-1',
    type: 'file_analysis',
    operation: 'analyze_files',
    description: 'Analyzed 25 files for organization suggestions',
    timestamp: '2024-01-15T10:25:00Z',
    duration: 5000,
    status: 'completed',
    user: 'test-user',
    metadata: {
      files: ['file1.txt', 'file2.jpg'],
      analysisType: 'organization',
      confidence: 0.95
    },
    results: {
      totalFiles: 25,
      processedFiles: 25,
      failedFiles: 0,
      suggestions: 15
    },
    canUndo: true,
    canRedo: false,
    undoRisk: 'low',
    relatedOperations: ['op-2']
  },
  {
    id: 'op-2',
    type: 'batch_operation',
    operation: 'move_files',
    description: 'Moved 10 files to organized folders',
    timestamp: '2024-01-15T10:20:00Z',
    duration: 3000,
    status: 'failed',
    user: 'test-user',
    metadata: {
      files: ['file3.txt', 'file4.jpg'],
      targetDirectory: '/Users/test/Documents/Organized'
    },
    results: {
      totalFiles: 10,
      processedFiles: 7,
      failedFiles: 3,
      errors: ['Permission denied for file3.txt']
    },
    error: 'Some files could not be moved due to permission errors',
    canUndo: true,
    canRedo: false,
    undoRisk: 'medium',
    relatedOperations: ['op-1']
  }
];

const mockStats = {
  total: 2,
  completed: 1,
  failed: 1,
  cancelled: 0,
  partiallyCompleted: 0
};

describe('OperationHistory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockElectronAPI.history.getOperationHistory.mockResolvedValue({
      operations: mockOperations,
      stats: mockStats
    });
  });

  afterEach(() => {
    vi.clearAllTimers();
  });

  describe('Initial Rendering', () => {
    it('renders loading state initially', async () => {
      render(<OperationHistory />);
      expect(screen.getByText('Loading operation history...')).toBeInTheDocument();
      expect(screen.getByTestId('loading-spinner')).toBeInTheDocument();
    });

    it('renders operation history after loading', async () => {
      render(<OperationHistory />);
      
      await waitFor(() => {
        expect(screen.getByText('Operation History')).toBeInTheDocument();
      });

      expect(screen.getByText('Analyzed 25 files for organization suggestions')).toBeInTheDocument();
      expect(screen.getByText('Moved 10 files to organized folders')).toBeInTheDocument();
    });

    it('renders statistics correctly', async () => {
      render(<OperationHistory />);
      
      await waitFor(() => {
        expect(screen.getByText('2')).toBeInTheDocument(); // total
        expect(screen.getByText('1')).toBeInTheDocument(); // completed
        expect(screen.getByText('1')).toBeInTheDocument(); // failed
      });
    });

    it('handles empty state', async () => {
      mockElectronAPI.history.getOperationHistory.mockResolvedValue({
        operations: [],
        stats: { total: 0, completed: 0, failed: 0, cancelled: 0, partiallyCompleted: 0 }
      });

      render(<OperationHistory />);
      
      await waitFor(() => {
        expect(screen.getByText('No Operations Found')).toBeInTheDocument();
        expect(screen.getByText(/No operations have been performed yet/)).toBeInTheDocument();
      });
    });

    it('handles error state', async () => {
      const errorMessage = 'Failed to load operation history';
      mockElectronAPI.history.getOperationHistory.mockRejectedValue(new Error(errorMessage));

      render(<OperationHistory />);
      
      await waitFor(() => {
        expect(screen.getByText('Error Loading History')).toBeInTheDocument();
        expect(screen.getByText(errorMessage)).toBeInTheDocument();
      });
    });
  });

  describe('Filtering and Search', () => {
    beforeEach(async () => {
      render(<OperationHistory />);
      await waitFor(() => screen.getByText('Operation History'));
    });

    it('filters by operation type', async () => {
      const user = userEvent.setup();
      
      const typeFilter = screen.getByLabelText('Operation Type:');
      await user.selectOptions(typeFilter, 'file_analysis');
      
      await waitFor(() => {
        expect(screen.getByText('Analyzed 25 files for organization suggestions')).toBeInTheDocument();
        expect(screen.queryByText('Moved 10 files to organized folders')).not.toBeInTheDocument();
      });
    });

    it('filters by status', async () => {
      const user = userEvent.setup();
      
      const statusFilter = screen.getByLabelText('Status:');
      await user.selectOptions(statusFilter, 'failed');
      
      await waitFor(() => {
        expect(screen.queryByText('Analyzed 25 files for organization suggestions')).not.toBeInTheDocument();
        expect(screen.getByText('Moved 10 files to organized folders')).toBeInTheDocument();
      });
    });

    it('searches operations by description', async () => {
      const user = userEvent.setup();
      
      const searchInput = screen.getByPlaceholderText('Search operations...');
      await user.type(searchInput, 'analyzed');
      
      await waitFor(() => {
        expect(screen.getByText('Analyzed 25 files for organization suggestions')).toBeInTheDocument();
        expect(screen.queryByText('Moved 10 files to organized folders')).not.toBeInTheDocument();
      });
    });

    it('filters by date range', async () => {
      const user = userEvent.setup();
      
      const dateFilter = screen.getByLabelText('Date Range:');
      await user.selectOptions(dateFilter, 'custom');
      
      await waitFor(() => {
        expect(screen.getByLabelText('From:')).toBeInTheDocument();
        expect(screen.getByLabelText('To:')).toBeInTheDocument();
      });

      const fromDate = screen.getByLabelText('From:');
      await user.type(fromDate, '2024-01-15');
      
      const toDate = screen.getByLabelText('To:');
      await user.type(toDate, '2024-01-15');
      
      // Verify filtering is applied
      expect(screen.getByText('Analyzed 25 files for organization suggestions')).toBeInTheDocument();
    });

    it('shows only undoable operations when filter is checked', async () => {
      const user = userEvent.setup();
      
      const undoableFilter = screen.getByLabelText('Show only undoable operations');
      await user.click(undoableFilter);
      
      // Both mock operations are undoable, so both should still be visible
      expect(screen.getByText('Analyzed 25 files for organization suggestions')).toBeInTheDocument();
      expect(screen.getByText('Moved 10 files to organized folders')).toBeInTheDocument();
    });
  });

  describe('Operation Actions', () => {
    beforeEach(async () => {
      render(<OperationHistory />);
      await waitFor(() => screen.getByText('Operation History'));
    });

    it('shows undo button for undoable operations', () => {
      const undoButtons = screen.getAllByText('Undo');
      expect(undoButtons).toHaveLength(2); // Both mock operations are undoable
    });

    it('opens undo confirmation modal', async () => {
      const user = userEvent.setup();
      
      mockElectronAPI.history.prepareUndoOperation.mockResolvedValue({
        canUndo: true,
        risk: 'low',
        affectedFiles: ['file1.txt', 'file2.jpg'],
        prerequisites: ['Ensure files are not currently open'],
        estimatedDuration: 2000
      });

      const undoButtons = screen.getAllByText('Undo');
      await user.click(undoButtons[0]);
      
      await waitFor(() => {
        expect(screen.getByText('Confirm Undo Operation')).toBeInTheDocument();
        expect(screen.getByText('Low Risk Operation')).toBeInTheDocument();
      });
    });

    it('executes undo operation after confirmation', async () => {
      const user = userEvent.setup();
      
      mockElectronAPI.history.prepareUndoOperation.mockResolvedValue({
        canUndo: true,
        risk: 'low',
        affectedFiles: ['file1.txt'],
        prerequisites: [],
        estimatedDuration: 1000
      });

      mockElectronAPI.history.executeUndoOperation.mockResolvedValue({
        success: true,
        message: 'Operation undone successfully'
      });

      const undoButtons = screen.getAllByText('Undo');
      await user.click(undoButtons[0]);
      
      await waitFor(() => screen.getByText('Confirm Undo Operation'));
      
      const confirmButton = screen.getByText('Confirm Undo');
      await user.click(confirmButton);
      
      await waitFor(() => {
        expect(mockElectronAPI.history.executeUndoOperation).toHaveBeenCalledWith('op-1', undefined);
      });
    });

    it('shows operation details on expand', async () => {
      const user = userEvent.setup();
      
      const detailsButtons = screen.getAllByText('Details');
      await user.click(detailsButtons[0]);
      
      await waitFor(() => {
        expect(screen.getByText('Operation Details')).toBeInTheDocument();
        expect(screen.getByText('25')).toBeInTheDocument(); // totalFiles
      });
    });
  });

  describe('Export Functionality', () => {
    beforeEach(async () => {
      render(<OperationHistory />);
      await waitFor(() => screen.getByText('Operation History'));
    });

    it('exports operation history', async () => {
      const user = userEvent.setup();
      
      mockElectronAPI.history.exportOperationHistory.mockResolvedValue({
        success: true,
        filePath: '/Users/test/history-export.json',
        exportedCount: 2
      });

      const exportButton = screen.getByText('Export');
      await user.click(exportButton);
      
      await waitFor(() => {
        expect(mockElectronAPI.history.exportOperationHistory).toHaveBeenCalled();
      });
    });
  });

  describe('Real-time Updates', () => {
    it('registers event listeners for real-time updates', () => {
      render(<OperationHistory />);
      
      expect(mockElectronAPI.onHistoryUpdate).toHaveBeenCalled();
      expect(mockElectronAPI.onOperationUndone).toHaveBeenCalled();
      expect(mockElectronAPI.onOperationRedone).toHaveBeenCalled();
    });

    it('cleans up event listeners on unmount', () => {
      const { unmount } = render(<OperationHistory />);
      
      unmount();
      
      expect(mockElectronAPI.removeAllListeners).toHaveBeenCalledWith('history-update');
      expect(mockElectronAPI.removeAllListeners).toHaveBeenCalledWith('operation-undone');
      expect(mockElectronAPI.removeAllListeners).toHaveBeenCalledWith('operation-redone');
    });
  });

  describe('Accessibility', () => {
    beforeEach(async () => {
      render(<OperationHistory />);
      await waitFor(() => screen.getByText('Operation History'));
    });

    it('has proper ARIA labels', () => {
      expect(screen.getByLabelText('Operation Type:')).toBeInTheDocument();
      expect(screen.getByLabelText('Status:')).toBeInTheDocument();
      expect(screen.getByLabelText('Date Range:')).toBeInTheDocument();
    });

    it('supports keyboard navigation', async () => {
      const user = userEvent.setup();
      
      const firstUndoButton = screen.getAllByText('Undo')[0];
      
      // Focus and activate with keyboard
      firstUndoButton.focus();
      expect(firstUndoButton).toHaveFocus();
      
      await user.keyboard('{Enter}');
      
      await waitFor(() => {
        expect(mockElectronAPI.history.prepareUndoOperation).toHaveBeenCalled();
      });
    });

    it('has proper heading structure', () => {
      expect(screen.getByRole('heading', { level: 2, name: 'Operation History' })).toBeInTheDocument();
    });
  });

  describe('Error Handling', () => {
    it('handles undo preparation errors', async () => {
      const user = userEvent.setup();
      
      mockElectronAPI.history.prepareUndoOperation.mockRejectedValue(
        new Error('Cannot undo this operation')
      );

      render(<OperationHistory />);
      await waitFor(() => screen.getByText('Operation History'));

      const undoButtons = screen.getAllByText('Undo');
      await user.click(undoButtons[0]);
      
      await waitFor(() => {
        expect(screen.getByText(/Cannot undo this operation/)).toBeInTheDocument();
      });
    });

    it('handles export errors gracefully', async () => {
      const user = userEvent.setup();
      
      mockElectronAPI.history.exportOperationHistory.mockRejectedValue(
        new Error('Export failed')
      );

      render(<OperationHistory />);
      await waitFor(() => screen.getByText('Operation History'));

      const exportButton = screen.getByText('Export');
      await user.click(exportButton);
      
      await waitFor(() => {
        expect(screen.getByText(/Export failed/)).toBeInTheDocument();
      });
    });
  });

  describe('Responsive Design', () => {
    it('adapts to mobile viewport', async () => {
      // Mock mobile viewport
      Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 375 });
      Object.defineProperty(window, 'innerHeight', { writable: true, configurable: true, value: 667 });
      
      render(<OperationHistory />);
      await waitFor(() => screen.getByText('Operation History'));
      
      // Component should render without errors in mobile viewport
      expect(screen.getByText('Operation History')).toBeInTheDocument();
    });
  });

  describe('Performance', () => {
    it('handles large operation lists efficiently', async () => {
      const largeOperationList = Array.from({ length: 1000 }, (_, i) => ({
        ...mockOperations[0],
        id: `op-${i}`,
        description: `Operation ${i}`
      }));

      mockElectronAPI.history.getOperationHistory.mockResolvedValue({
        operations: largeOperationList,
        stats: { total: 1000, completed: 800, failed: 200, cancelled: 0, partiallyCompleted: 0 }
      });

      render(<OperationHistory />);
      
      await waitFor(() => {
        expect(screen.getByText('Operation History')).toBeInTheDocument();
      }, { timeout: 5000 });

      // Should handle large lists without performance issues
      expect(screen.getByText('1000')).toBeInTheDocument(); // total stat
    });
  });

  describe('Data Validation', () => {
    it('handles malformed operation data gracefully', async () => {
      const malformedOperations = [
        {
          id: 'bad-op',
          // Missing required fields
        } as HistoricalOperation
      ];

      mockElectronAPI.history.getOperationHistory.mockResolvedValue({
        operations: malformedOperations,
        stats: mockStats
      });

      render(<OperationHistory />);
      
      // Should not crash with malformed data
      await waitFor(() => {
        expect(screen.getByText('Operation History')).toBeInTheDocument();
      });
    });
  });

  describe('Undo Confirmation Modal', () => {
    beforeEach(async () => {
      render(<OperationHistory />);
      await waitFor(() => screen.getByText('Operation History'));
    });

    it('shows different risk levels with appropriate styling', async () => {
      const user = userEvent.setup();
      
      // Test high risk operation
      mockElectronAPI.history.prepareUndoOperation.mockResolvedValue({
        canUndo: true,
        risk: 'high',
        affectedFiles: ['important-file.txt'],
        prerequisites: ['Backup important data'],
        estimatedDuration: 5000
      });

      const undoButtons = screen.getAllByText('Undo');
      await user.click(undoButtons[0]);
      
      await waitFor(() => {
        expect(screen.getByText('High Risk Operation')).toBeInTheDocument();
        expect(screen.getByText('Backup important data')).toBeInTheDocument();
      });
    });

    it('accepts reason for undo operation', async () => {
      const user = userEvent.setup();
      
      mockElectronAPI.history.prepareUndoOperation.mockResolvedValue({
        canUndo: true,
        risk: 'medium',
        affectedFiles: ['file1.txt'],
        prerequisites: [],
        estimatedDuration: 1000
      });

      const undoButtons = screen.getAllByText('Undo');
      await user.click(undoButtons[0]);
      
      await waitFor(() => screen.getByText('Confirm Undo Operation'));
      
      const reasonInput = screen.getByLabelText(/reason/i);
      await user.type(reasonInput, 'Testing undo functionality');
      
      const confirmButton = screen.getByText('Confirm Undo');
      await user.click(confirmButton);
      
      await waitFor(() => {
        expect(mockElectronAPI.history.executeUndoOperation).toHaveBeenCalledWith(
          'op-1',
          'Testing undo functionality'
        );
      });
    });
  });
});
