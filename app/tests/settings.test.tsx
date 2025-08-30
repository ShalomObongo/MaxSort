import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Settings from '../src/renderer/components/Settings';
import { AppStateProvider } from '../src/renderer/store/AppStateContext';

// Mock the electron API
const mockElectronAPI = {
  settings: {
    getUserProfile: vi.fn(),
    getUserPreferences: vi.fn(),
    getAvailableModels: vi.fn(),
    saveUserPreferences: vi.fn(),
    updateUserProfile: vi.fn(),
    getDefaultPreferences: vi.fn(),
    exportSettings: vi.fn(),
    importSettings: vi.fn()
  },
  system: {
    getSystemInfo: vi.fn(),
    getHealthStatus: vi.fn(),
    getResourceUsage: vi.fn()
  }
};

// Mock window.electronAPI
Object.defineProperty(window, 'electronAPI', {
  value: mockElectronAPI,
  writable: true
});

// Mock user profile and preferences
const mockUserProfile = {
  id: 'user-123',
  name: 'Test User',
  email: 'test@example.com',
  createdAt: '2024-01-01T00:00:00.000Z',
  lastActiveAt: '2024-01-15T12:00:00.000Z',
  preferences: {}
};

const mockPreferences = {
  preferredModel: 'llama2:7b',
  modelSettings: {
    temperature: 0.7,
    maxTokens: 4000,
    timeout: 30
  },
  performance: {
    maxConcurrentOperations: 3,
    memoryLimit: 2048,
    processingPriority: 'normal' as const,
    enableBackgroundProcessing: false
  },
  ui: {
    theme: 'dark' as const,
    compactMode: false,
    showConfidenceIndicators: true,
    autoExpandDetails: false,
    animationsEnabled: true
  },
  workflow: {
    autoApproveHighConfidence: false,
    confidenceThreshold: 0.8,
    requireConfirmation: true,
    enableBatchMode: true,
    defaultBatchSize: 50
  },
  notifications: {
    showDesktopNotifications: true,
    playSound: false,
    notifyOnCompletion: true,
    notifyOnErrors: true,
    quietHours: {
      enabled: false,
      start: '22:00',
      end: '08:00'
    }
  },
  accessibility: {
    highContrast: false,
    fontSize: 'medium' as const,
    reducedMotion: false,
    keyboardNavigation: true
  },
  advanced: {
    enableLogging: true,
    logLevel: 'info' as const,
    enableAnalytics: false,
    autoSaveInterval: 5,
    backupSettings: true
  }
};

const mockAvailableModels = [
  {
    id: 'llama2:7b',
    name: 'Llama 2 7B',
    description: 'General purpose language model',
    parameters: 7000000000,
    size: '3.8GB',
    performance: 'high' as const
  },
  {
    id: 'codellama:13b',
    name: 'Code Llama 13B',
    description: 'Code generation and understanding',
    parameters: 13000000000,
    size: '7.3GB',
    performance: 'medium' as const
  }
];

const SettingsWrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <AppStateProvider>
    {children}
  </AppStateProvider>
);

describe('Settings Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    
    // Set up default mock responses
    mockElectronAPI.settings.getUserProfile.mockResolvedValue(mockUserProfile);
    mockElectronAPI.settings.getUserPreferences.mockResolvedValue(mockPreferences);
    mockElectronAPI.settings.getAvailableModels.mockResolvedValue(mockAvailableModels);
    mockElectronAPI.settings.saveUserPreferences.mockResolvedValue({ success: true });
    mockElectronAPI.settings.updateUserProfile.mockResolvedValue({ success: true });
    mockElectronAPI.system.getSystemInfo.mockResolvedValue({
      appVersion: '1.0.0',
      platform: 'darwin',
      nodeVersion: 'v18.0.0'
    });
  });

  it('renders settings component with all tabs', async () => {
    render(
      <SettingsWrapper>
        <Settings />
      </SettingsWrapper>
    );

    // Wait for component to load
    await waitFor(() => {
      expect(screen.getByText('Settings')).toBeInTheDocument();
    });

    // Check that all tabs are present
    expect(screen.getByText('Model Config')).toBeInTheDocument();
    expect(screen.getByText('Performance')).toBeInTheDocument();
    expect(screen.getByText('Appearance')).toBeInTheDocument();
    expect(screen.getByText('Workflow')).toBeInTheDocument();
    expect(screen.getByText('Notifications')).toBeInTheDocument();
    expect(screen.getByText('Advanced')).toBeInTheDocument();
    expect(screen.getByText('Profile')).toBeInTheDocument();
  });

  it('loads user profile and preferences on mount', async () => {
    render(
      <SettingsWrapper>
        <Settings />
      </SettingsWrapper>
    );

    await waitFor(() => {
      expect(mockElectronAPI.settings.getUserProfile).toHaveBeenCalledOnce();
      expect(mockElectronAPI.settings.getUserPreferences).toHaveBeenCalledOnce();
      expect(mockElectronAPI.settings.getAvailableModels).toHaveBeenCalledOnce();
    });
  });

  it('displays loading state initially', () => {
    render(
      <SettingsWrapper>
        <Settings />
      </SettingsWrapper>
    );

    expect(screen.getByText('Loading settings...')).toBeInTheDocument();
  });

  it('switches between tabs when clicked', async () => {
    render(
      <SettingsWrapper>
        <Settings />
      </SettingsWrapper>
    );

    await waitFor(() => {
      expect(screen.getByText('Settings')).toBeInTheDocument();
    });

    // Click on Performance tab
    const performanceTab = screen.getByText('Performance');
    fireEvent.click(performanceTab);

    // Check that performance content is visible
    expect(screen.getByText('Performance Settings')).toBeInTheDocument();
    expect(screen.getByText('Max Concurrent Operations')).toBeInTheDocument();
  });

  it('displays model configuration options', async () => {
    render(
      <SettingsWrapper>
        <Settings />
      </SettingsWrapper>
    );

    await waitFor(() => {
      expect(screen.getByText('Model Selection')).toBeInTheDocument();
    });

    // Check model selection dropdown
    const modelSelect = screen.getByLabelText('Preferred Model');
    expect(modelSelect).toBeInTheDocument();
    
    // Check that available models are loaded
    await waitFor(() => {
      const options = screen.getAllByRole('option');
      expect(options).toHaveLength(3); // "Select a model" + 2 mock models
    });
  });

  it('updates preferences when settings change', async () => {
    render(
      <SettingsWrapper>
        <Settings />
      </SettingsWrapper>
    );

    await waitFor(() => {
      expect(screen.getByText('Model Selection')).toBeInTheDocument();
    });

    // Change max tokens setting
    const maxTokensInput = screen.getByLabelText('Max Tokens');
    fireEvent.change(maxTokensInput, { target: { value: '5000' } });

    // Check that unsaved changes indicator appears
    await waitFor(() => {
      expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
    });
  });

  it('validates input values', async () => {
    render(
      <SettingsWrapper>
        <Settings />
      </SettingsWrapper>
    );

    await waitFor(() => {
      expect(screen.getByText('Model Selection')).toBeInTheDocument();
    });

    // Enter invalid max tokens value
    const maxTokensInput = screen.getByLabelText('Max Tokens');
    fireEvent.change(maxTokensInput, { target: { value: '50000' } });

    // Check for validation error
    await waitFor(() => {
      expect(screen.getByText('Max tokens must be between 100 and 10,000')).toBeInTheDocument();
    });
  });

  it('saves settings when save button is clicked', async () => {
    render(
      <SettingsWrapper>
        <Settings />
      </SettingsWrapper>
    );

    await waitFor(() => {
      expect(screen.getByText('Model Selection')).toBeInTheDocument();
    });

    // Make a change
    const maxTokensInput = screen.getByLabelText('Max Tokens');
    fireEvent.change(maxTokensInput, { target: { value: '5000' } });

    // Click save button
    const saveButton = screen.getByText('Save Settings');
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(mockElectronAPI.settings.saveUserPreferences).toHaveBeenCalledOnce();
      expect(mockElectronAPI.settings.updateUserProfile).toHaveBeenCalledOnce();
    });
  });

  it('displays user profile information in profile tab', async () => {
    render(
      <SettingsWrapper>
        <Settings />
      </SettingsWrapper>
    );

    await waitFor(() => {
      expect(screen.getByText('Settings')).toBeInTheDocument();
    });

    // Click on Profile tab
    const profileTab = screen.getByText('Profile');
    fireEvent.click(profileTab);

    // Check profile information
    await waitFor(() => {
      expect(screen.getByText('User Profile')).toBeInTheDocument();
      expect(screen.getByText('user-123')).toBeInTheDocument();
      expect(screen.getByText('Test User')).toBeInTheDocument();
      expect(screen.getByText('test@example.com')).toBeInTheDocument();
    });
  });

  it('handles export settings functionality', async () => {
    mockElectronAPI.settings.exportSettings.mockResolvedValue({
      success: true,
      filePath: '/path/to/exported/settings.json'
    });

    render(
      <SettingsWrapper>
        <Settings />
      </SettingsWrapper>
    );

    await waitFor(() => {
      expect(screen.getByText('Settings')).toBeInTheDocument();
    });

    // Navigate to profile tab
    const profileTab = screen.getByText('Profile');
    fireEvent.click(profileTab);

    // Click export button
    const exportButton = screen.getByText('Export Settings');
    fireEvent.click(exportButton);

    await waitFor(() => {
      expect(mockElectronAPI.system.getSystemInfo).toHaveBeenCalledOnce();
      expect(mockElectronAPI.settings.exportSettings).toHaveBeenCalledOnce();
    });
  });

  it('handles import settings functionality', async () => {
    const importedData = {
      version: '1.0',
      exportDate: '2024-01-15T12:00:00.000Z',
      userProfile: mockUserProfile,
      systemInfo: {
        appVersion: '1.0.0',
        platform: 'darwin',
        nodeVersion: 'v18.0.0'
      }
    };

    mockElectronAPI.settings.importSettings.mockResolvedValue({
      success: true,
      data: importedData
    });

    render(
      <SettingsWrapper>
        <Settings />
      </SettingsWrapper>
    );

    await waitFor(() => {
      expect(screen.getByText('Settings')).toBeInTheDocument();
    });

    // Navigate to profile tab
    const profileTab = screen.getByText('Profile');
    fireEvent.click(profileTab);

    // Click import button
    const importButton = screen.getByText('Import Settings');
    fireEvent.click(importButton);

    await waitFor(() => {
      expect(mockElectronAPI.settings.importSettings).toHaveBeenCalledOnce();
      expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
    });
  });

  it('handles reset to defaults functionality', async () => {
    mockElectronAPI.settings.getDefaultPreferences.mockResolvedValue(mockPreferences);

    // Mock window.confirm
    vi.spyOn(window, 'confirm').mockImplementation(() => true);

    render(
      <SettingsWrapper>
        <Settings />
      </SettingsWrapper>
    );

    await waitFor(() => {
      expect(screen.getByText('Settings')).toBeInTheDocument();
    });

    // Navigate to profile tab
    const profileTab = screen.getByText('Profile');
    fireEvent.click(profileTab);

    // Click reset button
    const resetButton = screen.getByText('Reset to Defaults');
    fireEvent.click(resetButton);

    await waitFor(() => {
      expect(mockElectronAPI.settings.getDefaultPreferences).toHaveBeenCalledOnce();
      expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
    });

    // Cleanup
    vi.restoreAllMocks();
  });

  it('prevents saving when validation errors exist', async () => {
    render(
      <SettingsWrapper>
        <Settings />
      </SettingsWrapper>
    );

    await waitFor(() => {
      expect(screen.getByText('Model Selection')).toBeInTheDocument();
    });

    // Enter invalid value to trigger validation error
    const maxTokensInput = screen.getByLabelText('Max Tokens');
    fireEvent.change(maxTokensInput, { target: { value: '50000' } });

    await waitFor(() => {
      const saveButton = screen.getByText('Save Settings') as HTMLButtonElement;
      expect(saveButton.disabled).toBe(true);
      expect(screen.getByText('Please fix validation errors before saving')).toBeInTheDocument();
    });
  });
});
