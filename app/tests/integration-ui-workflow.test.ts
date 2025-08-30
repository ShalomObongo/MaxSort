/**
 * Integration Tests for Complete UI Workflows
 * Testing end-to-end user interactions across all UI components
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { App } from '../src/renderer/App';
import { AppStateProvider } from '../src/renderer/store/AppStateContext';
import { ThemeProvider } from '../src/renderer/contexts/ThemeContext';

// Mock Electron APIs
const mockElectronAPI = {
  // Directory and file operations
  selectDirectory: vi.fn().mockResolvedValue('/test/directory'),
  scanDirectory: vi.fn().mockResolvedValue({ files: [], progress: 100 }),
  
  // Analysis operations
  getAnalysisResults: vi.fn().mockResolvedValue([]),
  approveAnalysisResult: vi.fn().mockResolvedValue(true),
  rejectAnalysisResult: vi.fn().mockResolvedValue(true),
  previewAnalysisResults: vi.fn().mockResolvedValue({}),
  
  // Batch operations
  startBatchOperation: vi.fn().mockResolvedValue({ id: 'batch-1' }),
  getBatchOperationStatus: vi.fn().mockResolvedValue({ status: 'running', progress: 50 }),
  pauseBatchOperation: vi.fn().mockResolvedValue(true),
  resumeBatchOperation: vi.fn().mockResolvedValue(true),
  cancelBatchOperation: vi.fn().mockResolvedValue(true),
  
  // History operations
  getOperationHistory: vi.fn().mockResolvedValue([]),
  undoOperation: vi.fn().mockResolvedValue(true),
  redoOperation: vi.fn().mockResolvedValue(true),
  exportOperationHistory: vi.fn().mockResolvedValue(true),
  
  // System health
  getSystemHealth: vi.fn().mockResolvedValue({
    agents: { active: 2, total: 4 },
    memory: { used: 512, available: 1024 },
    performance: { cpu: 25, operations: 10 }
  }),
  
  // Settings and preferences
  getUserSettings: vi.fn().mockResolvedValue({}),
  saveUserSettings: vi.fn().mockResolvedValue(true),
  exportSettings: vi.fn().mockResolvedValue('/path/to/settings.json'),
  importSettings: vi.fn().mockResolvedValue(true),
  
  // Event streaming
  subscribeToEvents: vi.fn().mockImplementation((callback) => {
    // Mock real-time events
    setTimeout(() => callback({ type: 'system_health_updated', data: {} }), 100);
    return () => {}; // Unsubscribe function
  }),
  
  // Models
  getAvailableModels: vi.fn().mockResolvedValue([
    { id: 'llama2', name: 'Llama 2', size: '7B' },
    { id: 'codellama', name: 'Code Llama', size: '13B' }
  ]),
  
  // Error and notification handling
  showNotification: vi.fn(),
  logError: vi.fn(),
  
  // Help system
  getHelpContent: vi.fn().mockResolvedValue({}),
  getContextualHelp: vi.fn().mockResolvedValue([]),
  markFeatureDiscovered: vi.fn().mockResolvedValue(true),
  
  // Onboarding
  getOnboardingStatus: vi.fn().mockResolvedValue({ completed: false }),
  updateOnboardingProgress: vi.fn().mockResolvedValue(true)
};

// Setup test environment
Object.defineProperty(window, 'electronAPI', {
  value: mockElectronAPI,
  writable: true
});

// Wrapper component for providers
const TestWrapper = ({ children }: { children: React.ReactNode }) => (
  <ThemeProvider>
    <AppStateProvider>
      {children}
    </AppStateProvider>
  </ThemeProvider>
);

describe('Complete UI Workflow Integration Tests', () => {
  let user: ReturnType<typeof userEvent.setup>;

  beforeEach(() => {
    user = userEvent.setup();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('Directory Scan to File Analysis Workflow', () => {
    it('should complete full workflow from directory selection to analysis results', async () => {
      render(
        <TestWrapper>
          <App />
        </TestWrapper>
      );

      // Wait for app to load
      await waitFor(() => {
        expect(screen.getByRole('main')).toBeInTheDocument();
      });

      // Navigate to Dashboard
      const dashboardTab = screen.getByRole('tab', { name: /dashboard/i });
      await user.click(dashboardTab);

      // Select directory
      const selectDirButton = screen.getByRole('button', { name: /select directory/i });
      await user.click(selectDirButton);
      
      expect(mockElectronAPI.selectDirectory).toHaveBeenCalled();

      // Start scan
      await waitFor(() => {
        const scanButton = screen.getByRole('button', { name: /start scan/i });
        expect(scanButton).toBeInTheDocument();
      });

      const scanButton = screen.getByRole('button', { name: /start scan/i });
      await user.click(scanButton);
      
      expect(mockElectronAPI.scanDirectory).toHaveBeenCalled();

      // Navigate to Analysis Results
      const analysisTab = screen.getByRole('tab', { name: /analysis/i });
      await user.click(analysisTab);

      // Verify analysis results component loads
      await waitFor(() => {
        expect(screen.getByText(/file analysis results/i)).toBeInTheDocument();
      });

      expect(mockElectronAPI.getAnalysisResults).toHaveBeenCalled();
    });

    it('should handle analysis result approval workflow', async () => {
      // Mock analysis results
      mockElectronAPI.getAnalysisResults.mockResolvedValue([
        {
          id: 'result-1',
          originalPath: '/test/document1.txt',
          suggestedName: 'Important_Document.txt',
          confidence: 0.85,
          category: 'document'
        }
      ]);

      render(
        <TestWrapper>
          <App />
        </TestWrapper>
      );

      // Navigate to Analysis Results
      const analysisTab = screen.getByRole('tab', { name: /analysis/i });
      await user.click(analysisTab);

      // Wait for results to load
      await waitFor(() => {
        expect(screen.getByText('document1.txt')).toBeInTheDocument();
      });

      // Approve a suggestion
      const approveButton = screen.getByRole('button', { name: /approve/i });
      await user.click(approveButton);

      expect(mockElectronAPI.approveAnalysisResult).toHaveBeenCalledWith('result-1');

      // Apply approved changes
      const applyButton = screen.getByRole('button', { name: /apply changes/i });
      await user.click(applyButton);

      expect(mockElectronAPI.startBatchOperation).toHaveBeenCalled();
    });
  });

  describe('Batch Operation Management Workflow', () => {
    it('should manage batch operations through complete lifecycle', async () => {
      render(
        <TestWrapper>
          <App />
        </TestWrapper>
      );

      // Navigate to Operations
      const operationsTab = screen.getByRole('tab', { name: /operations/i });
      await user.click(operationsTab);

      // Verify batch operation manager loads
      await waitFor(() => {
        expect(screen.getByText(/batch operation manager/i)).toBeInTheDocument();
      });

      // Start a batch operation
      const startButton = screen.getByRole('button', { name: /start operation/i });
      await user.click(startButton);

      expect(mockElectronAPI.startBatchOperation).toHaveBeenCalled();

      // Check operation status
      await waitFor(() => {
        expect(mockElectronAPI.getBatchOperationStatus).toHaveBeenCalled();
      });

      // Pause operation
      const pauseButton = screen.getByRole('button', { name: /pause/i });
      await user.click(pauseButton);

      expect(mockElectronAPI.pauseBatchOperation).toHaveBeenCalled();

      // Resume operation
      const resumeButton = screen.getByRole('button', { name: /resume/i });
      await user.click(resumeButton);

      expect(mockElectronAPI.resumeBatchOperation).toHaveBeenCalled();
    });
  });

  describe('Operation History and Undo Workflow', () => {
    it('should display history and perform undo operations', async () => {
      // Mock operation history
      mockElectronAPI.getOperationHistory.mockResolvedValue([
        {
          id: 'op-1',
          type: 'rename',
          timestamp: Date.now(),
          status: 'completed',
          details: { from: 'old.txt', to: 'new.txt' }
        }
      ]);

      render(
        <TestWrapper>
          <App />
        </TestWrapper>
      );

      // Navigate to History
      const historyTab = screen.getByRole('tab', { name: /history/i });
      await user.click(historyTab);

      // Wait for history to load
      await waitFor(() => {
        expect(screen.getByText(/operation history/i)).toBeInTheDocument();
      });

      expect(mockElectronAPI.getOperationHistory).toHaveBeenCalled();

      // Perform undo operation
      const undoButton = screen.getByRole('button', { name: /undo/i });
      await user.click(undoButton);

      expect(mockElectronAPI.undoOperation).toHaveBeenCalled();

      // Export history
      const exportButton = screen.getByRole('button', { name: /export/i });
      await user.click(exportButton);

      expect(mockElectronAPI.exportOperationHistory).toHaveBeenCalled();
    });
  });

  describe('System Health Monitoring Workflow', () => {
    it('should display system health and allow agent management', async () => {
      render(
        <TestWrapper>
          <App />
        </TestWrapper>
      );

      // Navigate to System Health
      const healthTab = screen.getByRole('tab', { name: /system health/i });
      await user.click(healthTab);

      // Wait for health data to load
      await waitFor(() => {
        expect(screen.getByText(/system health/i)).toBeInTheDocument();
      });

      expect(mockElectronAPI.getSystemHealth).toHaveBeenCalled();

      // Verify real-time updates subscription
      expect(mockElectronAPI.subscribeToEvents).toHaveBeenCalled();

      // Check for health metrics display
      await waitFor(() => {
        expect(screen.getByText(/memory usage/i)).toBeInTheDocument();
        expect(screen.getByText(/agent status/i)).toBeInTheDocument();
      });
    });
  });

  describe('Settings and Preferences Workflow', () => {
    it('should save and load user preferences', async () => {
      render(
        <TestWrapper>
          <App />
        </TestWrapper>
      );

      // Navigate to Settings
      const settingsTab = screen.getByRole('tab', { name: /settings/i });
      await user.click(settingsTab);

      // Wait for settings to load
      await waitFor(() => {
        expect(screen.getByText(/user preferences/i)).toBeInTheDocument();
      });

      expect(mockElectronAPI.getUserSettings).toHaveBeenCalled();

      // Modify a setting
      const themeSelect = screen.getByRole('combobox', { name: /theme/i });
      await user.selectOptions(themeSelect, 'dark');

      // Save settings
      const saveButton = screen.getByRole('button', { name: /save settings/i });
      await user.click(saveButton);

      expect(mockElectronAPI.saveUserSettings).toHaveBeenCalled();
    });

    it('should export and import settings', async () => {
      render(
        <TestWrapper>
          <App />
        </TestWrapper>
      );

      // Navigate to Settings
      const settingsTab = screen.getByRole('tab', { name: /settings/i });
      await user.click(settingsTab);

      // Export settings
      const exportButton = screen.getByRole('button', { name: /export settings/i });
      await user.click(exportButton);

      expect(mockElectronAPI.exportSettings).toHaveBeenCalled();

      // Import settings
      const importButton = screen.getByRole('button', { name: /import settings/i });
      await user.click(importButton);

      expect(mockElectronAPI.importSettings).toHaveBeenCalled();
    });
  });

  describe('Error Handling and Recovery Workflow', () => {
    it('should handle errors gracefully and provide recovery options', async () => {
      // Mock an error scenario
      mockElectronAPI.scanDirectory.mockRejectedValue(new Error('Permission denied'));

      render(
        <TestWrapper>
          <App />
        </TestWrapper>
      );

      // Navigate to Dashboard and trigger error
      const dashboardTab = screen.getByRole('tab', { name: /dashboard/i });
      await user.click(dashboardTab);

      const scanButton = screen.getByRole('button', { name: /start scan/i });
      await user.click(scanButton);

      // Check for error notification
      await waitFor(() => {
        expect(screen.getByText(/error/i)).toBeInTheDocument();
      });

      // Verify error logging
      expect(mockElectronAPI.logError).toHaveBeenCalled();
    });
  });

  describe('Help System and Onboarding Workflow', () => {
    it('should display help system and handle user guidance', async () => {
      render(
        <TestWrapper>
          <App />
        </TestWrapper>
      );

      // Navigate to Help
      const helpTab = screen.getByRole('tab', { name: /help/i });
      await user.click(helpTab);

      // Wait for help content to load
      await waitFor(() => {
        expect(screen.getByText(/help center/i)).toBeInTheDocument();
      });

      expect(mockElectronAPI.getHelpContent).toHaveBeenCalled();

      // Test contextual help
      const contextButton = screen.getByRole('button', { name: /contextual help/i });
      await user.click(contextButton);

      expect(mockElectronAPI.getContextualHelp).toHaveBeenCalled();
    });

    it('should guide users through onboarding process', async () => {
      // Mock incomplete onboarding
      mockElectronAPI.getOnboardingStatus.mockResolvedValue({ completed: false, step: 1 });

      render(
        <TestWrapper>
          <App />
        </TestWrapper>
      );

      // Check for onboarding overlay
      await waitFor(() => {
        expect(screen.getByText(/welcome/i)).toBeInTheDocument();
      });

      // Complete onboarding step
      const nextButton = screen.getByRole('button', { name: /next/i });
      await user.click(nextButton);

      expect(mockElectronAPI.updateOnboardingProgress).toHaveBeenCalled();
    });
  });

  describe('Accessibility and Keyboard Navigation', () => {
    it('should support keyboard navigation across all components', async () => {
      render(
        <TestWrapper>
          <App />
        </TestWrapper>
      );

      // Test tab navigation
      await user.tab();
      expect(document.activeElement).toHaveAttribute('role', 'tab');

      // Test arrow key navigation in tabs
      await user.keyboard('{ArrowRight}');
      await user.keyboard('{Enter}');

      // Verify focus management
      expect(document.activeElement).toBeInTheDocument();
    });

    it('should provide proper ARIA labels and roles', () => {
      render(
        <TestWrapper>
          <App />
        </TestWrapper>
      );

      // Check main navigation
      expect(screen.getByRole('navigation')).toBeInTheDocument();
      expect(screen.getByRole('main')).toBeInTheDocument();

      // Check tab list
      expect(screen.getByRole('tablist')).toBeInTheDocument();

      // Check tab panels
      const tabpanel = screen.getByRole('tabpanel');
      expect(tabpanel).toHaveAttribute('aria-labelledby');
    });
  });

  describe('Performance and Responsiveness', () => {
    it('should render components within performance targets', async () => {
      const startTime = performance.now();

      render(
        <TestWrapper>
          <App />
        </TestWrapper>
      );

      await waitFor(() => {
        expect(screen.getByRole('main')).toBeInTheDocument();
      });

      const endTime = performance.now();
      const renderTime = endTime - startTime;

      // Should render within 100ms for good UX
      expect(renderTime).toBeLessThan(100);
    });

    it('should handle large datasets efficiently', async () => {
      // Mock large dataset
      const largeHistory = Array.from({ length: 1000 }, (_, i) => ({
        id: `op-${i}`,
        type: 'rename',
        timestamp: Date.now() - i * 1000,
        status: 'completed'
      }));

      mockElectronAPI.getOperationHistory.mockResolvedValue(largeHistory);

      render(
        <TestWrapper>
          <App />
        </TestWrapper>
      );

      // Navigate to History
      const historyTab = screen.getByRole('tab', { name: /history/i });
      await user.click(historyTab);

      // Should render without performance issues
      await waitFor(() => {
        expect(screen.getByText(/operation history/i)).toBeInTheDocument();
      }, { timeout: 2000 });

      // Check for virtual scrolling or pagination
      const historyItems = screen.getAllByTestId(/operation-item/i);
      expect(historyItems.length).toBeLessThan(100); // Should use virtualization
    });
  });
});
