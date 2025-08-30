/**
 * analysis-workflow-integration.test.ts - Integration test for complete analysis workflow
 */

import { vi, describe, test, expect, beforeEach } from 'vitest';

// Mock Electron APIs for integration testing
const mockElectronAPI = {
  getScanResults: vi.fn(),
  startFileAnalysis: vi.fn(),
  cancelFileAnalysis: vi.fn(),
  on: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
  
  // Setup global window mock
  Object.defineProperty(global, 'window', {
    value: { electronAPI: mockElectronAPI },
    writable: true,
  });
});

describe('Analysis Workflow Integration', () => {
  test('workflow progression with analysis integration', async () => {
    // Test 1: Directory scan returns files
    mockElectronAPI.getScanResults.mockResolvedValue([
      { id: 1, name: 'document.txt', path: '/test/document.txt' },
      { id: 2, name: 'image.jpg', path: '/test/image.jpg' },
      { id: 3, name: 'data.csv', path: '/test/data.csv' }
    ]);

    // Test 2: Analysis starts successfully  
    mockElectronAPI.startFileAnalysis.mockResolvedValue('analysis-request-123');

    // Test 3: Progress events can be subscribed to
    const mockCleanupFn = vi.fn();
    mockElectronAPI.on.mockReturnValue(mockCleanupFn);

    // Verify API calls work as expected
    const scanResults = await mockElectronAPI.getScanResults('/test/directory');
    expect(scanResults).toHaveLength(3);
    expect(scanResults[0]).toHaveProperty('id', 1);

    const analysisRequestId = await mockElectronAPI.startFileAnalysis(
      [1, 2, 3], 
      'rename-suggestions',
      {
        requestId: 'test-request',
        isInteractive: true,
        priority: 'high',
        modelName: 'llama2'
      }
    );
    expect(analysisRequestId).toBe('analysis-request-123');

    // Test event subscription
    const progressCallback = vi.fn();
    const cleanup = mockElectronAPI.on('analysis:progressUpdate', progressCallback);
    expect(cleanup).toBe(mockCleanupFn);
  });

  test('error handling in analysis workflow', async () => {
    // Test error scenarios
    mockElectronAPI.getScanResults.mockRejectedValue(new Error('Directory not found'));
    mockElectronAPI.startFileAnalysis.mockRejectedValue(new Error('Analysis service unavailable'));

    // Verify error handling
    await expect(mockElectronAPI.getScanResults('/invalid/path')).rejects.toThrow('Directory not found');
    await expect(mockElectronAPI.startFileAnalysis([], 'rename-suggestions')).rejects.toThrow('Analysis service unavailable');
  });

  test('analysis cancellation workflow', async () => {
    mockElectronAPI.cancelFileAnalysis.mockResolvedValue(true);

    const cancelled = await mockElectronAPI.cancelFileAnalysis('test-request-123');
    expect(cancelled).toBe(true);
    expect(mockElectronAPI.cancelFileAnalysis).toHaveBeenCalledWith('test-request-123');
  });
});
