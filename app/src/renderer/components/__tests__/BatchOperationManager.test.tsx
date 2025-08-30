import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { vi, describe, test, expect, beforeEach } from 'vitest';
import BatchOperationManager from '../BatchOperationManager';

// Mock the CSS import
vi.mock('../BatchOperationManager.css', () => ({}));

// Mock window.electronAPI
const mockElectronAPI = {
  invoke: vi.fn(),
  on: vi.fn(),
  removeListener: vi.fn()
};

Object.defineProperty(global, 'window', {
  value: {
    electronAPI: mockElectronAPI
  },
  writable: true
});

describe('BatchOperationManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockElectronAPI.on.mockReturnValue(() => {});
  });

  const mockOperations = [
    {
      id: 'op-1',
      type: 'file-rename',
      title: 'Rename Documents',
      status: 'running',
      priority: 'high',
      progress: 65,
      totalItems: 100,
      processedItems: 65,
      failedItems: 2,
      startTime: new Date(),
      configuration: {
        batchSize: 50,
        maxConcurrency: 3,
        enableParallel: true,
        autoRetry: true,
        retryAttempts: 3,
        validateBeforeExecute: true,
        createBackup: true,
        notifyOnCompletion: true
      }
    }
  ];

  const mockQueue = {
    operations: mockOperations,
    totalOperations: 1,
    activeOperations: 1,
    completedOperations: 0,
    failedOperations: 0,
    queuedOperations: 0
  };

  test('renders component without crashing', () => {
    mockElectronAPI.invoke.mockResolvedValue({ 
      success: true, 
      operations: [], 
      queue: { 
        operations: [], 
        totalOperations: 0, 
        activeOperations: 0, 
        completedOperations: 0, 
        failedOperations: 0, 
        queuedOperations: 0 
      } 
    });
    
    const { container } = render(<BatchOperationManager />);
    expect(container).toBeInTheDocument();
  });

  test('shows loading state initially', () => {
    mockElectronAPI.invoke.mockImplementation(() => new Promise(() => {})); // Never resolves
    
    render(<BatchOperationManager />);
    
    expect(screen.getByText('Loading batch operations...')).toBeInTheDocument();
  });

  test('displays operations when loaded', async () => {
    mockElectronAPI.invoke.mockResolvedValue({
      success: true,
      operations: mockOperations,
      queue: mockQueue
    });

    render(<BatchOperationManager />);

    await waitFor(() => {
      expect(screen.getByText('Batch Operations')).toBeInTheDocument();
    });

    expect(screen.getByText('Rename Documents')).toBeInTheDocument();
    expect(screen.getByText('running')).toBeInTheDocument();
    expect(screen.getByText('65%')).toBeInTheDocument();
  });

  test('shows empty state when no operations', async () => {
    mockElectronAPI.invoke.mockResolvedValue({
      success: true,
      operations: [],
      queue: {
        operations: [],
        totalOperations: 0,
        activeOperations: 0,
        completedOperations: 0,
        failedOperations: 0,
        queuedOperations: 0
      }
    });

    render(<BatchOperationManager />);

    await waitFor(() => {
      expect(screen.getByText('No Batch Operations')).toBeInTheDocument();
    });

    expect(screen.getByText('No batch operations have been created yet.')).toBeInTheDocument();
  });

  test('handles operation controls', async () => {
    mockElectronAPI.invoke.mockResolvedValue({
      success: true,
      operations: mockOperations,
      queue: mockQueue
    });

    render(<BatchOperationManager />);

    await waitFor(() => {
      expect(screen.getByText('Rename Documents')).toBeInTheDocument();
    });

    // Should show pause button for running operation
    expect(screen.getByText('⏸️ Pause')).toBeInTheDocument();
    
    // Should show cancel button for running operation
    expect(screen.getByText('❌ Cancel')).toBeInTheDocument();
  });

  test('filters operations by status', async () => {
    const completedOperation = {
      ...mockOperations[0],
      id: 'op-2',
      status: 'completed',
      progress: 100
    };

    mockElectronAPI.invoke.mockResolvedValue({
      success: true,
      operations: [mockOperations[0], completedOperation],
      queue: {
        ...mockQueue,
        totalOperations: 2,
        completedOperations: 1
      }
    });

    render(<BatchOperationManager />);

    await waitFor(() => {
      expect(screen.getByText('Batch Operations')).toBeInTheDocument();
    });

    // Initially shows all operations
    expect(screen.getAllByText(/Rename Documents/)).toHaveLength(2);

    // Filter to only running operations
    const filterSelect = screen.getByDisplayValue('All Operations');
    fireEvent.change(filterSelect, { target: { value: 'running' } });

    // Should now only show the running operation
    expect(screen.getByText('running')).toBeInTheDocument();
    expect(screen.queryByText('completed')).not.toBeInTheDocument();
  });
});
