/**
 * Dashboard.test.tsx - Basic unit tests for Dashboard component with analysis integration
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { vi, describe, test, expect, beforeAll } from 'vitest';
import Dashboard from '../Dashboard';

// Mock dependencies
vi.mock('../DirectoryPicker', () => ({
  default: () => <div data-testid="directory-picker">Directory Picker</div>
}));

vi.mock('../ModelSelector', () => ({
  default: () => <div data-testid="model-selector">Model Selector</div>
}));

vi.mock('../FileAnalysisResults', () => ({
  default: () => <div data-testid="file-analysis-results">File Analysis Results</div>
}));

vi.mock('../Dashboard.css', () => ({}));

// Mock Electron API
const mockElectronAPI = {
  getScanResults: vi.fn().mockResolvedValue([]),
  startFileAnalysis: vi.fn(),
  cancelFileAnalysis: vi.fn(),
  on: vi.fn().mockReturnValue(vi.fn()),
};

beforeAll(() => {
  Object.defineProperty(global, 'window', {
    value: { electronAPI: mockElectronAPI },
    writable: true,
  });
});

describe('Dashboard Component - Analysis Integration', () => {
  test('renders workflow steps', () => {
    render(<Dashboard />);
    
    expect(screen.getByText('File Organization Workflow')).toBeInTheDocument();
    expect(screen.getByText('Setup & Configuration')).toBeInTheDocument();
    expect(screen.getByText('Select Directory')).toBeInTheDocument();
    expect(screen.getByText('Scan Files')).toBeInTheDocument();
    expect(screen.getByText('Review Suggestions')).toBeInTheDocument();
    expect(screen.getByText('Execute Operations')).toBeInTheDocument();
  });

  test('shows model selector in first step', () => {
    render(<Dashboard />);
    expect(screen.getByTestId('model-selector')).toBeInTheDocument();
  });

  test('displays proper step indicators', () => {
    render(<Dashboard />);
    
    // Check that all step numbers are displayed
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('4')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();
  });

  test('has proper workflow structure', () => {
    render(<Dashboard />);
    
    // Check for workflow progress section
    expect(screen.getByText('Follow the steps below to organize your files with AI assistance')).toBeInTheDocument();
    
    // Check navigation controls exist
    expect(screen.getByText('Previous')).toBeInTheDocument();
    expect(screen.getByText('Next →')).toBeInTheDocument();
    expect(screen.getByText('Step 1 of 5')).toBeInTheDocument();
  });
});
