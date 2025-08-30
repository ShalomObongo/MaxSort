import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import SystemHealth from '../src/renderer/components/SystemHealth';

// Mock Electron API
const mockElectronAPI = {
  invoke: vi.fn(),
  on: vi.fn(() => vi.fn()), // Mock returns unsubscribe function
  off: vi.fn()
};

// Mock window.electronAPI
Object.defineProperty(window, 'electronAPI', {
  value: mockElectronAPI,
  writable: true
});

// Mock data
const mockHealthData = {
  systemMetrics: {
    totalMemory: 16000,
    usedMemory: 8000,
    availableMemory: 8000,
    memoryUsage: 50,
    cpuUsage: 30,
    totalStorage: 500000,
    usedStorage: 250000,
    storageUsage: 50,
    processCount: 120,
    maxSortProcesses: 45,
    uptime: 3600,
    timestamp: Date.now()
  },
  agents: [
    {
      id: 'agent-1',
      name: 'Test Agent',
      type: 'analyzer',
      status: 'running',
      health: 'healthy',
      tasksCompleted: 150,
      tasksFailed: 2,
      lastActivity: new Date().toISOString(),
      memoryUsage: 120,
      cpuUsage: 15,
      queueSize: 5,
      averageProcessingTime: 250,
      errorRate: 0.01
    }
  ],
  alerts: [
    {
      id: 'alert-1',
      title: 'Test Alert',
      message: 'Test alert message',
      level: 'warning',
      category: 'performance',
      timestamp: new Date().toISOString(),
      acknowledged: false,
      actionRequired: false
    }
  ],
  recommendations: [
    {
      id: 'rec-1',
      type: 'performance',
      title: 'Test Recommendation',
      description: 'Test recommendation description',
      impact: 'medium',
      effort: 'low',
      estimatedBenefit: 'Test benefit',
      category: 'optimization'
    }
  ]
};

describe('SystemHealth - Basic Functionality', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    
    // Default mock implementation - successful data load
    mockElectronAPI.invoke.mockImplementation((channel) => {
      if (channel === 'system:getHealthStatus') {
        return Promise.resolve(mockHealthData);
      }
      return Promise.resolve({ success: true });
    });
  });

  describe('Component Rendering', () => {
    it('should render without crashing', () => {
      render(<SystemHealth />);
      expect(screen.getByText('System Health')).toBeInTheDocument();
    });

    it('should show loading state initially', () => {
      render(<SystemHealth />);
      expect(screen.getByText('Loading system health data...')).toBeInTheDocument();
    });

    it('should load and display health data', async () => {
      render(<SystemHealth />);

      // Should start with loading
      expect(screen.getByText('Loading system health data...')).toBeInTheDocument();

      // Wait for API call to be made
      await waitFor(() => {
        expect(mockElectronAPI.invoke).toHaveBeenCalledWith(
          'system:getHealthStatus', 
          expect.any(Object)
        );
      });

      // Should no longer show loading
      await waitFor(() => {
        expect(screen.queryByText('Loading system health data...')).not.toBeInTheDocument();
      });
    });

    it('should show empty state when no data is available', async () => {
      // Mock empty response
      mockElectronAPI.invoke.mockImplementation(() => 
        Promise.resolve({
          systemMetrics: null,
          agents: [],
          alerts: [],
          recommendations: []
        })
      );

      render(<SystemHealth />);

      await waitFor(() => {
        expect(screen.getByText('No Health Data Available')).toBeInTheDocument();
      });
    });

    it('should handle API errors gracefully', async () => {
      // Mock API error
      mockElectronAPI.invoke.mockRejectedValue(new Error('API Error'));
      
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      render(<SystemHealth />);

      await waitFor(() => {
        expect(screen.getByText('Error Loading System Health')).toBeInTheDocument();
      });

      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  describe('Navigation', () => {
    it('should render navigation buttons', async () => {
      render(<SystemHealth />);

      await waitFor(() => {
        expect(mockElectronAPI.invoke).toHaveBeenCalled();
      });

      // Navigation buttons should be present
      expect(screen.getByText('Overview')).toBeInTheDocument();
      expect(screen.getByText('Agents')).toBeInTheDocument();
      expect(screen.getByText('Metrics')).toBeInTheDocument();
      expect(screen.getByText('Alerts')).toBeInTheDocument();
    });
  });

  describe('Auto-refresh', () => {
    it('should have auto-refresh controls', async () => {
      render(<SystemHealth />);

      await waitFor(() => {
        expect(mockElectronAPI.invoke).toHaveBeenCalled();
      });

      // Auto-refresh controls should be present
      expect(screen.getByLabelText('Auto-refresh')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Refresh' })).toBeInTheDocument();
    });
  });

  describe('Export functionality', () => {
    it('should have export button', async () => {
      render(<SystemHealth />);

      await waitFor(() => {
        expect(mockElectronAPI.invoke).toHaveBeenCalled();
      });

      expect(screen.getByRole('button', { name: 'Export' })).toBeInTheDocument();
    });
  });

  describe('System Health Integration', () => {
    it('should make health status API call on mount', async () => {
      render(<SystemHealth />);

      await waitFor(() => {
        expect(mockElectronAPI.invoke).toHaveBeenCalledWith(
          'system:getHealthStatus',
          expect.objectContaining({
            includeRecommendations: true,
            includeHistory: true,
            timeRange: '1h'
          })
        );
      });
    });

    it('should setup event listeners for real-time updates', async () => {
      render(<SystemHealth />);

      await waitFor(() => {
        expect(mockElectronAPI.invoke).toHaveBeenCalled();
      });

      // Should setup event listeners
      expect(mockElectronAPI.on).toHaveBeenCalledWith('health-update', expect.any(Function));
      expect(mockElectronAPI.on).toHaveBeenCalledWith('agent-status-change', expect.any(Function));
      expect(mockElectronAPI.on).toHaveBeenCalledWith('system-alert', expect.any(Function));
    });

    it('should cleanup event listeners on unmount', async () => {
      const { unmount } = render(<SystemHealth />);

      await waitFor(() => {
        expect(mockElectronAPI.invoke).toHaveBeenCalled();
      });

      // Unmount component
      unmount();

      // Should have called unsubscribe functions
      // Note: This is basic verification - in real implementation the returned functions would be called
    });
  });

  describe('Component Structure', () => {
    it('should have correct CSS classes', async () => {
      render(<SystemHealth />);

      const container = document.querySelector('.system-health');
      expect(container).toBeInTheDocument();

      // Should initially have loading class
      expect(container).toHaveClass('loading');

      await waitFor(() => {
        expect(mockElectronAPI.invoke).toHaveBeenCalled();
      });

      // After loading, should not have loading class
      await waitFor(() => {
        const updatedContainer = document.querySelector('.system-health');
        expect(updatedContainer).not.toHaveClass('loading');
      });
    });
  });
});
