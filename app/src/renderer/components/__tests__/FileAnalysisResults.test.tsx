import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { vi, describe, test, expect, beforeEach } from 'vitest';
import FileAnalysisResults from '../FileAnalysisResults';

// Mock the CSS import
vi.mock('../FileAnalysisResults.css', () => ({}));

// Mock window.electronAPI with all required methods
const mockElectronAPI = {
  getVersion: vi.fn().mockResolvedValue('1.0.0'),
  getPlatform: vi.fn().mockResolvedValue('darwin'),
  getAgentStatus: vi.fn().mockResolvedValue({ status: 'healthy', agents: [] }),
  invoke: vi.fn(),
  on: vi.fn(),
  removeListener: vi.fn()
};

// Mock the window object
Object.defineProperty(global, 'window', {
  value: {
    electronAPI: mockElectronAPI
  },
  writable: true
});

describe('FileAnalysisResults', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    
    // Setup default mock for the on method - return a cleanup function
    mockElectronAPI.on.mockReturnValue(() => {});
    
    // Default invoke response
    mockElectronAPI.invoke.mockResolvedValue({ success: true, suggestions: [] });
  });

  const defaultProps = {
    fileIds: [1, 2, 3],
    analysisType: 'rename-suggestions' as const,
    maxSuggestionsPerFile: 5
  };

  test('renders component without crashing', () => {
    mockElectronAPI.invoke.mockResolvedValue({ success: true, suggestions: [] });
    
    const { container } = render(<FileAnalysisResults {...defaultProps} />);
    expect(container).toBeInTheDocument();
  });

  test('renders loading state initially', () => {
    // Mock invoke to never resolve initially to show loading state
    const neverResolvingPromise = new Promise(() => {});
    mockElectronAPI.invoke.mockReturnValue(neverResolvingPromise);
    
    render(<FileAnalysisResults {...defaultProps} />);
    
    // Check loading state appears immediately
    expect(screen.getByText('Loading analysis results...')).toBeInTheDocument();
  });

  test('shows empty state when no suggestions', async () => {
    mockElectronAPI.invoke.mockResolvedValue({
      success: true,
      suggestions: []
    });

    render(<FileAnalysisResults {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('No suggestions found')).toBeInTheDocument();
    });
  });
});
