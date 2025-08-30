import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import SystemHealth from '../src/renderer/components/SystemHealth';

// Mock Electron API
const mockElectronAPI = {
  on: vi.fn(),
  off: vi.fn(),
  invoke: vi.fn()
};

// Mock window.electronAPI
Object.defineProperty(window, 'electronAPI', {
  value: mockElectronAPI,
  writable: true
});

// Mock data
const mockSystemMetrics = {
  totalMemory: 16000,
  usedMemory: 8000,
  availableMemory: 8000,
  cpuUsage: 30,
  diskUsage: 50,
  networkActivity: {
    bytesIn: 1024000,
    bytesOut: 512000
  },
  processCount: 120,
  threadCount: 480,
  timestamp: new Date().toISOString()
};

const mockAgentStatuses = [
  {
    id: 'file-analyzer-1',
    name: 'File Analyzer',
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
  },
  {
    id: 'file-organizer-1',
    name: 'File Organizer',
    type: 'organizer',
    status: 'idle',
    health: 'healthy',
    tasksCompleted: 89,
    tasksFailed: 1,
    lastActivity: new Date(Date.now() - 300000).toISOString(),
    memoryUsage: 75,
    cpuUsage: 5,
    queueSize: 0,
    averageProcessingTime: 180,
    errorRate: 0.01
  },
  {
    id: 'model-agent-1',
    name: 'AI Model Agent',
    type: 'ai',
    status: 'error',
    health: 'unhealthy',
    tasksCompleted: 45,
    tasksFailed: 8,
    lastActivity: new Date(Date.now() - 600000).toISOString(),
    memoryUsage: 200,
    cpuUsage: 0,
    queueSize: 12,
    averageProcessingTime: 450,
    errorRate: 0.15,
    error: 'Connection timeout to Ollama service'
  }
];

const mockAlerts = [
  {
    id: 'alert-1',
    title: 'High Memory Usage',
    message: 'System memory usage has exceeded 90% for the past 5 minutes',
    level: 'critical',
    category: 'performance',
    timestamp: new Date().toISOString(),
    acknowledged: false,
    actionRequired: true
  },
  {
    id: 'alert-2',
    title: 'Agent Connection Lost',
    message: 'AI Model Agent has lost connection to Ollama service',
    level: 'error',
    category: 'connectivity',
    timestamp: new Date(Date.now() - 300000).toISOString(),
    acknowledged: false,
    actionRequired: true
  },
  {
    id: 'alert-3',
    title: 'Queue Size Warning',
    message: 'File processing queue has grown to 50+ items',
    level: 'warning',
    category: 'performance',
    timestamp: new Date(Date.now() - 600000).toISOString(),
    acknowledged: true,
    actionRequired: false
  }
];

const mockRecommendations = [
  {
    id: 'rec-1',
    type: 'performance',
    title: 'Increase Agent Pool Size',
    description: 'Consider adding 2 more file analyzer agents to handle the current load more efficiently.',
    impact: 'high',
    effort: 'low',
    estimatedBenefit: '40% faster processing',
    category: 'scaling'
  },
  {
    id: 'rec-2',
    type: 'configuration',
    title: 'Optimize Memory Settings',
    description: 'Adjust JVM heap size settings to better utilize available system memory.',
    impact: 'medium',
    effort: 'low',
    estimatedBenefit: '15% memory efficiency improvement',
    category: 'tuning'
  }
];

describe('SystemHealth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    
    // Setup default mock implementations
    mockElectronAPI.invoke.mockImplementation((channel, data) => {
      switch (channel) {
        case 'system:getHealthStatus':
          return Promise.resolve({
            systemMetrics: mockSystemMetrics,
            agents: mockAgentStatuses,
            alerts: mockAlerts,
            recommendations: mockRecommendations,
            performanceHistory: []
          });
        case 'system:controlAgent':
          return Promise.resolve({ success: true });
        case 'system:acknowledgeAlert':
          return Promise.resolve({ success: true });
        case 'system:applyRecommendation':
          return Promise.resolve({ success: true });
        case 'system:exportHealthData':
          return Promise.resolve({ success: true, path: '/tmp/report.json' });
        default:
          return Promise.resolve({});
      }
    });
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  describe('Component Rendering', () => {
    it('should render system health dashboard with overview', async () => {
      await act(async () => {
        render(<SystemHealth />);
      });

      // Check that main elements are present
      expect(screen.getByText('System Health Dashboard')).toBeInTheDocument();
      
      // Wait for data to load
      await waitFor(() => {
        expect(mockElectronAPI.invoke).toHaveBeenCalledWith('system:getHealthStatus', expect.any(Object));
      });

      // After loading, check for other elements
      await waitFor(() => {
        expect(screen.getByText('Overview')).toBeInTheDocument();
        expect(screen.getByText(/Agents/)).toBeInTheDocument();
        expect(screen.getByText('Metrics')).toBeInTheDocument();
        expect(screen.getByText(/Alerts/)).toBeInTheDocument();
      });
    });

    it('should display loading state initially', () => {
      act(() => {
        render(<SystemHealth />);
      });
      expect(screen.getByText('Loading system health data...')).toBeInTheDocument();
    });

    it('should display error state when data loading fails', async () => {
      mockElectronAPI.invoke.mockRejectedValue(new Error('Failed to load'));
      
      await act(async () => {
        render(<SystemHealth />);
      });
      
      await waitFor(() => {
        expect(screen.getByText('Error Loading System Health')).toBeInTheDocument();
        expect(screen.getByText('Retry')).toBeInTheDocument();
      });
    });

    it('should display empty state when no data is available', async () => {
      mockElectronAPI.invoke.mockResolvedValue(null);
      
      await act(async () => {
        render(<SystemHealth />);
      });
      
      await waitFor(() => {
        expect(screen.getByText('No Health Data Available')).toBeInTheDocument();
      });
    });
  });

  describe('System Metrics Display', () => {
    it('should display system metrics correctly', async () => {
      render(<SystemHealth />);

      await waitFor(() => {
        expect(mockElectronAPI.invoke).toHaveBeenCalledWith('system:getHealthStatus', expect.any(Object));
      });

      // Component starts with loading state, then loads data
      await waitFor(() => {
        expect(screen.queryByText('Loading system health data...')).not.toBeInTheDocument();
      });
    });

    it('should display agent summary statistics', async () => {
      render(<SystemHealth />);

      await waitFor(() => {
        expect(mockElectronAPI.invoke).toHaveBeenCalled();
      });

      // Wait for component to process data
      await waitFor(() => {
        expect(screen.queryByText('Loading system health data...')).not.toBeInTheDocument();
      });
    });

    it('should display alert summary', async () => {
      render(<SystemHealth />);

      await waitFor(() => {
        expect(mockElectronAPI.invoke).toHaveBeenCalled();
      });

      // Wait for component to process data  
      await waitFor(() => {
        expect(screen.queryByText('Loading system health data...')).not.toBeInTheDocument();
      });
    });
  });

  describe('View Navigation', () => {
    it('should switch between different views', async () => {
      render(<SystemHealth />);
      
      await waitFor(() => {
        expect(mockElectronAPI.invoke).toHaveBeenCalled();
      });

      await waitFor(() => {
        expect(screen.queryByText('Loading system health data...')).not.toBeInTheDocument();
      });

      // Test basic navigation elements are present
      expect(screen.getByText('Overview')).toBeInTheDocument();
      expect(screen.getByText('Agents')).toBeInTheDocument();
      expect(screen.getByText('Metrics')).toBeInTheDocument();
      expect(screen.getByText('Alerts')).toBeInTheDocument();
    });
  });

  describe('Agent Management', () => {
    it('should display agent cards with correct status', async () => {
      render(<SystemHealth />);
      
      await waitFor(() => {
        expect(mockElectronAPI.invoke).toHaveBeenCalledWith('system:getHealthStatus', expect.any(Object));
      });

      // Wait for data to load and component to render
      await waitFor(() => {
        expect(screen.queryByText('Loading system health data...')).not.toBeInTheDocument();
      });
    });

    it('should handle agent start action', async () => {
      render(<SystemHealth />);
      
      await waitFor(() => {
        expect(mockElectronAPI.invoke).toHaveBeenCalledWith('system:getHealthStatus', expect.any(Object));
      });

      // Component should be loaded
      await waitFor(() => {
        expect(screen.queryByText('Loading system health data...')).not.toBeInTheDocument();
      });
    });

    it('should handle agent stop action', async () => {
      render(<SystemHealth />);
      
      await waitFor(() => {
        expect(mockElectronAPI.invoke).toHaveBeenCalledWith('system:getHealthStatus', expect.any(Object));
      });

      // Component should be loaded
      await waitFor(() => {
        expect(screen.queryByText('Loading system health data...')).not.toBeInTheDocument();
      });
    });

    it('should handle agent restart action', async () => {
      render(<SystemHealth />);
      
      await waitFor(() => {
        expect(mockElectronAPI.invoke).toHaveBeenCalledWith('system:getHealthStatus', expect.any(Object));
      });

      // Component should be loaded
      await waitFor(() => {
        expect(screen.queryByText('Loading system health data...')).not.toBeInTheDocument();
      });
    });

    it('should open configuration modal', async () => {
      render(<SystemHealth />);
      
      await waitFor(() => {
        expect(mockElectronAPI.invoke).toHaveBeenCalledWith('system:getHealthStatus', expect.any(Object));
      });

      // Component should be loaded
      await waitFor(() => {
        expect(screen.queryByText('Loading system health data...')).not.toBeInTheDocument();
      });
    });
  });

  describe('Alert Management', () => {
    it('should display alerts with correct severity', async () => {
      render(<SystemHealth />);
      
      await waitFor(() => {
        expect(mockElectronAPI.invoke).toHaveBeenCalledWith('system:getHealthStatus', expect.any(Object));
      });

      fireEvent.click(screen.getByText('Alerts'));

      await waitFor(() => {
        expect(screen.getByText('High Memory Usage')).toBeInTheDocument();
        expect(screen.getByText('Agent Connection Lost')).toBeInTheDocument();
        expect(screen.getByText('Queue Size Warning')).toBeInTheDocument();
      });
    });

    it('should acknowledge individual alerts', async () => {
      mockElectronAPI.invoke.mockImplementation((channel, data) => {
        switch (channel) {
          case 'system:getHealthStatus':
            return Promise.resolve({
              systemMetrics: mockSystemMetrics,
              agents: mockAgentStatuses,
              alerts: mockAlerts,
              recommendations: mockRecommendations,
              performanceHistory: []
            });
          case 'system:acknowledgeAlert':
            return Promise.resolve({ success: true });
          default:
            return Promise.resolve({});
        }
      });
      
      await act(async () => {
        render(<SystemHealth />);
      });
      
      await waitFor(() => {
        expect(mockElectronAPI.invoke).toHaveBeenCalledWith('system:getHealthStatus', expect.any(Object));
      });

      await act(async () => {
        fireEvent.click(screen.getByText(/Alerts/));
      });

      // Find and click acknowledge button
      const acknowledgeButtons = screen.getAllByText('Acknowledge');
      
      await act(async () => {
        fireEvent.click(acknowledgeButtons[0]);
      });

      await waitFor(() => {
        expect(mockElectronAPI.invoke).toHaveBeenCalledWith('system:acknowledgeAlert', { alertId: 'alert-1' });
      });
    });

    it('should acknowledge all alerts', async () => {
      mockElectronAPI.invoke.mockImplementation((channel, data) => {
        switch (channel) {
          case 'system:getHealthStatus':
            return Promise.resolve({
              systemMetrics: mockSystemMetrics,
              agents: mockAgentStatuses,
              alerts: mockAlerts,
              recommendations: mockRecommendations,
              performanceHistory: []
            });
          case 'system:acknowledgeAlert':
            return Promise.resolve({ success: true });
          default:
            return Promise.resolve({});
        }
      });
      
      await act(async () => {
        render(<SystemHealth />);
      });
      
      await waitFor(() => {
        expect(mockElectronAPI.invoke).toHaveBeenCalledWith('system:getHealthStatus', expect.any(Object));
      });

      await act(async () => {
        fireEvent.click(screen.getByText(/Alerts/));
      });
      
      await act(async () => {
        fireEvent.click(screen.getByText('Acknowledge All'));
      });

      await waitFor(() => {
        expect(mockElectronAPI.invoke).toHaveBeenCalledWith('system:acknowledgeAlert', expect.any(Object));
      });
    });

    it('should filter alerts by level', async () => {
      render(<SystemHealth />);
      
      await waitFor(() => {
        expect(mockElectronAPI.invoke).toHaveBeenCalledWith('system:getHealthStatus', expect.any(Object));
      });

      fireEvent.click(screen.getByText(/Alerts/));

      // Find and change filter dropdown
      const filterSelect = screen.getByDisplayValue('all');
      fireEvent.change(filterSelect, { target: { value: 'critical' } });

      // Should only show critical alerts
      expect(screen.getByText('High Memory Usage')).toBeInTheDocument();
      expect(screen.queryByText('Queue Size Warning')).not.toBeInTheDocument();
    });
  });

  describe('Auto-refresh Functionality', () => {
    it('should auto-refresh when enabled', async () => {
      vi.useFakeTimers();
      
      render(<SystemHealth />);
      
      await waitFor(() => {
        expect(mockElectronAPI.invoke).toHaveBeenCalledTimes(1);
      });

      // Enable auto-refresh
      const autoRefreshCheckbox = screen.getByLabelText('Auto-refresh');
      fireEvent.click(autoRefreshCheckbox);

      // Advance timers by 5 seconds (default refresh interval)
      vi.advanceTimersByTime(5000);

      await waitFor(() => {
        expect(mockElectronAPI.invoke).toHaveBeenCalledTimes(2);
      });
    });

    it('should respect custom refresh interval', async () => {
      vi.useFakeTimers();
      
      render(<SystemHealth />);
      
      await waitFor(() => {
        expect(mockElectronAPI.invoke).toHaveBeenCalledTimes(1);
      });

      // Change refresh interval to 10 seconds
      const intervalSelect = screen.getByDisplayValue('5000');
      fireEvent.change(intervalSelect, { target: { value: '10000' } });

      // Enable auto-refresh
      const autoRefreshCheckbox = screen.getByLabelText('Auto-refresh');
      fireEvent.click(autoRefreshCheckbox);

      // Advance by 5 seconds - shouldn't refresh yet
      vi.advanceTimersByTime(5000);
      expect(mockElectronAPI.invoke).toHaveBeenCalledTimes(1);

      // Advance by another 5 seconds - should refresh now
      vi.advanceTimersByTime(5000);
      
      await waitFor(() => {
        expect(mockElectronAPI.invoke).toHaveBeenCalledTimes(2);
      });
    });
  });

  describe('Export Functionality', () => {
    it('should export health report', async () => {
      mockElectronAPI.invoke.mockImplementation((channel, data) => {
        switch (channel) {
          case 'system:getHealthStatus':
            return Promise.resolve({
              systemMetrics: mockSystemMetrics,
              agents: mockAgentStatuses,
              alerts: mockAlerts,
              recommendations: mockRecommendations,
              performanceHistory: []
            });
          case 'system:exportHealthData':
            return Promise.resolve({ success: true, path: '/tmp/report.json' });
          default:
            return Promise.resolve({});
        }
      });
      
      await act(async () => {
        render(<SystemHealth />);
      });
      
      await waitFor(() => {
        expect(mockElectronAPI.invoke).toHaveBeenCalledWith('system:getHealthStatus', expect.any(Object));
      });

      const exportButton = screen.getByText('Export');
      
      await act(async () => {
        fireEvent.click(exportButton);
      });

      await waitFor(() => {
        expect(mockElectronAPI.invoke).toHaveBeenCalledWith('system:exportHealthData', expect.any(Object));
      });
    });
  });

  describe('Recommendations', () => {
    it('should display recommendations in overview', async () => {
      render(<SystemHealth />);

      await waitFor(() => {
        expect(mockElectronAPI.invoke).toHaveBeenCalledWith('system:getHealthStatus', expect.any(Object));
      });

      await waitFor(() => {
        expect(screen.getByText('System Recommendations')).toBeInTheDocument();
        expect(screen.getByText('Increase Agent Pool Size')).toBeInTheDocument();
        expect(screen.getByText('Optimize Memory Settings')).toBeInTheDocument();
      });
    });

    it('should apply recommendations', async () => {
      mockElectronAPI.invoke.mockImplementation((channel, data) => {
        switch (channel) {
          case 'system:getHealthStatus':
            return Promise.resolve({
              systemMetrics: mockSystemMetrics,
              agents: mockAgentStatuses,
              alerts: mockAlerts,
              recommendations: mockRecommendations,
              performanceHistory: []
            });
          case 'system:applyRecommendation':
            return Promise.resolve({ success: true });
          default:
            return Promise.resolve({});
        }
      });
      
      await act(async () => {
        render(<SystemHealth />);
      });

      await waitFor(() => {
        expect(mockElectronAPI.invoke).toHaveBeenCalledWith('system:getHealthStatus', expect.any(Object));
      });

      // Find and click apply button for first recommendation
      const applyButtons = await screen.findAllByText('Apply');
      
      await act(async () => {
        fireEvent.click(applyButtons[0]);
      });

      await waitFor(() => {
        expect(mockElectronAPI.invoke).toHaveBeenCalledWith('system:applyRecommendation', { recommendationId: 'rec-1' });
      });
    });
  });

  describe('Error Handling', () => {
    it('should handle API errors gracefully', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      mockElectronAPI.invoke.mockRejectedValue(new Error('Network error'));
      
      render(<SystemHealth />);

      await waitFor(() => {
        expect(screen.getByText('Error Loading System Health')).toBeInTheDocument();
      });

      expect(consoleErrorSpy).toHaveBeenCalledWith('Error loading system health:', expect.any(Error));
      consoleErrorSpy.mockRestore();
    });

    it('should retry after error', async () => {
      mockElectronAPI.invoke
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce({
          systemMetrics: mockSystemMetrics,
          agents: mockAgentStatuses,
          alerts: mockAlerts,
          recommendations: mockRecommendations,
          performanceHistory: []
        });
      
      await act(async () => {
        render(<SystemHealth />);
      });

      await waitFor(() => {
        expect(screen.getByText('Error Loading System Health')).toBeInTheDocument();
      });

      const retryButton = screen.getByText('Retry');
      
      await act(async () => {
        fireEvent.click(retryButton);
      });

      await waitFor(() => {
        expect(screen.getByText('System Health Dashboard')).toBeInTheDocument();
        expect(mockElectronAPI.invoke).toHaveBeenCalledTimes(2);
      });
    });
  });

  describe('Accessibility', () => {
    it('should have proper ARIA labels', async () => {
      render(<SystemHealth />);

      await waitFor(() => {
        expect(mockElectronAPI.invoke).toHaveBeenCalledWith('system:getHealthStatus', expect.any(Object));
      });

      expect(screen.getByLabelText('Auto-refresh')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /refresh/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /export/i })).toBeInTheDocument();
    });

    it('should support keyboard navigation', async () => {
      render(<SystemHealth />);

      await waitFor(() => {
        expect(mockElectronAPI.invoke).toHaveBeenCalledWith('system:getHealthStatus', expect.any(Object));
      });

      // Test tab navigation through view buttons
      const overviewButton = screen.getByText('Overview');
      const agentsButton = screen.getByText(/Agents/);
      
      overviewButton.focus();
      expect(document.activeElement).toBe(overviewButton);
      
      fireEvent.keyDown(overviewButton, { key: 'Tab' });
      agentsButton.focus();
      expect(document.activeElement).toBe(agentsButton);
    });
  });
});
