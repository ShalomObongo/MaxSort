import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import TroubleshootingInterface from '../src/renderer/components/TroubleshootingInterface';
import { NotificationProvider } from '../src/renderer/components/UserNotificationSystem';
import React from 'react';

// Mock Electron API
const mockElectronAPI = {
  invoke: vi.fn()
};

beforeEach(() => {
  (global as any).window = {
    electronAPI: mockElectronAPI
  };
  vi.clearAllMocks();
});

const TestWrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <NotificationProvider>
    {children}
  </NotificationProvider>
);

describe('TroubleshootingInterface', () => {
  it('renders main interface with tabs', () => {
    render(
      <TestWrapper>
        <TroubleshootingInterface />
      </TestWrapper>
    );

    expect(screen.getByText('Troubleshooting & Diagnostics')).toBeInTheDocument();
    expect(screen.getByText('System Diagnostics')).toBeInTheDocument();
    expect(screen.getByText('Troubleshooting Guides')).toBeInTheDocument();
    expect(screen.getByText('System Information')).toBeInTheDocument();
  });

  it('switches between tabs correctly', () => {
    render(
      <TestWrapper>
        <TroubleshootingInterface />
      </TestWrapper>
    );

    // Default tab should be diagnostics
    expect(screen.getByText('System Health Checks')).toBeInTheDocument();

    // Switch to guides
    fireEvent.click(screen.getByText('Troubleshooting Guides'));
    expect(screen.getByText('Step-by-Step Troubleshooting')).toBeInTheDocument();

    // Switch to system info
    fireEvent.click(screen.getByText('System Information'));
    expect(screen.getByText('System Information')).toBeInTheDocument();
  });

  it('displays system checks', () => {
    render(
      <TestWrapper>
        <TroubleshootingInterface />
      </TestWrapper>
    );

    expect(screen.getByText('Ollama Service')).toBeInTheDocument();
    expect(screen.getByText('File System Permissions')).toBeInTheDocument();
    expect(screen.getByText('Network Connectivity')).toBeInTheDocument();
    expect(screen.getByText('Storage Space')).toBeInTheDocument();
    expect(screen.getByText('Memory Usage')).toBeInTheDocument();
    expect(screen.getByText('Database Integrity')).toBeInTheDocument();
  });

  it('runs diagnostics when button is clicked', async () => {
    mockElectronAPI.invoke.mockResolvedValue({ passed: true, details: 'Check passed' });

    render(
      <TestWrapper>
        <TroubleshootingInterface />
      </TestWrapper>
    );

    const runButton = screen.getByText('Run Diagnostics');
    fireEvent.click(runButton);

    // Button should be disabled during run
    expect(runButton).toBeDisabled();

    // Wait for diagnostics to complete
    await waitFor(() => {
      expect(mockElectronAPI.invoke).toHaveBeenCalledWith('diagnostics:runCheck', expect.any(String));
    });
  });

  it('displays troubleshooting guides', () => {
    render(
      <TestWrapper>
        <TroubleshootingInterface />
      </TestWrapper>
    );

    fireEvent.click(screen.getByText('Troubleshooting Guides'));

    expect(screen.getByText('Ollama Not Detected')).toBeInTheDocument();
    expect(screen.getByText('File Permission Issues')).toBeInTheDocument();
    expect(screen.getByText('Slow Performance')).toBeInTheDocument();
    expect(screen.getByText('Network Connection Problems')).toBeInTheDocument();
  });

  it('opens guide detail view', () => {
    render(
      <TestWrapper>
        <TroubleshootingInterface />
      </TestWrapper>
    );

    fireEvent.click(screen.getByText('Troubleshooting Guides'));
    
    // Click on a guide card
    fireEvent.click(screen.getByText('Ollama Not Detected'));

    expect(screen.getByText('← Back to Guides')).toBeInTheDocument();
    expect(screen.getByText('Step-by-step Instructions')).toBeInTheDocument();
    expect(screen.getByText('Open Terminal or Command Prompt')).toBeInTheDocument();
  });

  it('navigates back from guide detail', () => {
    render(
      <TestWrapper>
        <TroubleshootingInterface />
      </TestWrapper>
    );

    fireEvent.click(screen.getByText('Troubleshooting Guides'));
    fireEvent.click(screen.getByText('Ollama Not Detected'));
    
    expect(screen.getByText('← Back to Guides')).toBeInTheDocument();

    fireEvent.click(screen.getByText('← Back to Guides'));
    
    expect(screen.getByText('Step-by-Step Troubleshooting')).toBeInTheDocument();
  });

  it('displays difficulty badges correctly', () => {
    render(
      <TestWrapper>
        <TroubleshootingInterface />
      </TestWrapper>
    );

    fireEvent.click(screen.getByText('Troubleshooting Guides'));

    // Check for different difficulty levels
    expect(screen.getByText('easy')).toBeInTheDocument();
    expect(screen.getByText('medium')).toBeInTheDocument();
    expect(screen.getByText('advanced')).toBeInTheDocument();
  });

  it('shows warnings in guide detail', () => {
    render(
      <TestWrapper>
        <TroubleshootingInterface />
      </TestWrapper>
    );

    fireEvent.click(screen.getByText('Troubleshooting Guides'));
    fireEvent.click(screen.getByText('File Permission Issues'));

    expect(screen.getByText('⚠️ Important Warnings')).toBeInTheDocument();
    expect(screen.getByText('Be careful when changing system-level permissions')).toBeInTheDocument();
  });

  it('displays system information', async () => {
    const mockSystemInfo = {
      app: { version: '1.0.0' },
      platform: 'darwin',
      arch: 'x64',
      memory: { total: '16 GB', available: '8 GB' },
      cpu: { cores: 8 },
      versions: {
        node: '18.0.0',
        electron: '26.0.0',
        chrome: '116.0.0'
      }
    };

    mockElectronAPI.invoke.mockResolvedValue(mockSystemInfo);

    render(
      <TestWrapper>
        <TroubleshootingInterface />
      </TestWrapper>
    );

    fireEvent.click(screen.getByText('System Information'));

    await waitFor(() => {
      expect(screen.getByText('1.0.0')).toBeInTheDocument();
      expect(screen.getByText('darwin')).toBeInTheDocument();
      expect(screen.getByText('16 GB')).toBeInTheDocument();
    });
  });

  it('handles system check failures', async () => {
    mockElectronAPI.invoke.mockResolvedValue({ 
      passed: false, 
      details: 'Service not running',
      solution: 'Start the Ollama service'
    });

    render(
      <TestWrapper>
        <TroubleshootingInterface />
      </TestWrapper>
    );

    fireEvent.click(screen.getByText('Run Diagnostics'));

    await waitFor(() => {
      expect(screen.getByText('Service not running')).toBeInTheDocument();
      expect(screen.getByText('Start the Ollama service')).toBeInTheDocument();
    });
  });

  it('shows category badges for checks', () => {
    render(
      <TestWrapper>
        <TroubleshootingInterface />
      </TestWrapper>
    );

    // Categories should be visible for each check
    const categories = ['system', 'permissions', 'network', 'storage', 'performance'];
    categories.forEach(category => {
      expect(screen.getByText(category)).toBeInTheDocument();
    });
  });

  it('handles auto-fix functionality', async () => {
    render(
      <TestWrapper>
        <TroubleshootingInterface />
      </TestWrapper>
    );

    // First run diagnostics to get failed state
    mockElectronAPI.invoke.mockResolvedValue({ 
      passed: false, 
      details: 'Service not running' 
    });

    fireEvent.click(screen.getByText('Run Diagnostics'));

    await waitFor(() => {
      const autoFixButtons = screen.queryAllByText('Auto Fix');
      expect(autoFixButtons.length).toBeGreaterThan(0);
    });
  });

  it('loads system info on mount', async () => {
    mockElectronAPI.invoke.mockResolvedValue({
      platform: 'darwin',
      arch: 'x64'
    });

    render(
      <TestWrapper>
        <TroubleshootingInterface />
      </TestWrapper>
    );

    await waitFor(() => {
      expect(mockElectronAPI.invoke).toHaveBeenCalledWith('system:getInfo');
    });
  });

  it('shows running state during diagnostics', async () => {
    // Mock a delayed response
    mockElectronAPI.invoke.mockImplementation(() => 
      new Promise(resolve => setTimeout(() => resolve({ passed: true }), 100))
    );

    render(
      <TestWrapper>
        <TroubleshootingInterface />
      </TestWrapper>
    );

    fireEvent.click(screen.getByText('Run Diagnostics'));

    // Should show running state
    await waitFor(() => {
      const spinners = document.querySelectorAll('.status-spinner');
      expect(spinners.length).toBeGreaterThan(0);
    });
  });

  it('handles error in system checks gracefully', async () => {
    mockElectronAPI.invoke.mockRejectedValue(new Error('System error'));

    render(
      <TestWrapper>
        <TroubleshootingInterface />
      </TestWrapper>
    );

    fireEvent.click(screen.getByText('Run Diagnostics'));

    // Should still complete without crashing
    await waitFor(() => {
      expect(screen.getByText('Run Diagnostics')).not.toBeDisabled();
    });
  });
});
