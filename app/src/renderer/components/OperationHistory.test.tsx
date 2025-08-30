import React from 'react';
import { render, screen, waitFor, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import OperationHistory from './OperationHistory';

// Mock Electron API
const mockElectronAPI = {
  invoke: vi.fn().mockResolvedValue({
    success: true,
    operations: [{
      id: 'op-1',
      type: 'bulk-analysis',
      title: 'File Analysis Operation',
      description: 'Analyzed 25 files for organization suggestions',
      startTime: new Date('2024-01-15T10:25:00Z'),
      endTime: new Date('2024-01-15T10:30:00Z'),
      duration: 5000,
      status: 'completed',
      itemsProcessed: 25,
      itemsTotal: 25,
      itemsFailed: 0,
      agentUsed: 'file-analyzer',
      modelUsed: 'gpt-4',
      metadata: {
        directoryPath: '/Users/test/Documents',
        fileCount: 25,
        sizeProcessed: 1024000,
        confidenceThreshold: 95,
        batchSize: 5,
        concurrency: 2,
        retryAttempts: 0,
        backupCreated: true,
        validationPerformed: true,
        checksumVerification: true
      },
      canUndo: true,
      canRedo: false,
      undoRisk: 'low',
      relatedOperations: []
    }],
    stats: {
      total: 1,
      completed: 1,
      failed: 0,
      cancelled: 0,
      partiallyCompleted: 0
    }
  }),
  on: vi.fn(() => vi.fn()),
  removeAllListeners: vi.fn()
};

describe('OperationHistory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(global, 'window', {
      value: { electronAPI: mockElectronAPI },
      writable: true,
    });
  });

  it('renders loading state initially', () => {
    render(<OperationHistory />);
    expect(screen.getByText('Loading operation history...')).toBeInTheDocument();
    expect(screen.getByTestId('loading-spinner')).toBeInTheDocument();
  });

  it('renders operation history after loading', async () => {
    await act(async () => {
      render(<OperationHistory />);
    });

    await waitFor(() => {
      expect(mockElectronAPI.invoke).toHaveBeenCalledWith('history:getOperations', expect.any(Object));
    });

    await waitFor(() => {
      expect(screen.queryByText('Loading operation history...')).not.toBeInTheDocument();
    });

    expect(screen.getByText('File Analysis Operation')).toBeInTheDocument();
  });
});
