import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { act } from 'react';
import React from 'react';
import ModelSelector from '../src/renderer/components/ModelSelector';

// Mock the CSS import
vi.mock('../src/renderer/components/ModelSelector.css', () => ({}));

// Extend Window interface for Electron API
declare global {
  interface Window {
    electronAPI: typeof mockElectronAPI;
  }
}

// Mock electron API with all required properties
const mockElectronAPI = {
  getOllamaHealth: vi.fn(),
  getAvailableModels: vi.fn(),
  validateModel: vi.fn(),
  getModelMemoryEstimate: vi.fn(),
  saveModelPreferences: vi.fn(),
  getModelPreferences: vi.fn(),
  onOllamaHealthUpdate: vi.fn(),
  
  // Required API methods from base interface
  getVersion: vi.fn().mockResolvedValue('1.0.0'),
  getPlatform: vi.fn().mockResolvedValue('darwin'),
  getAgentStatus: vi.fn().mockResolvedValue({ status: 'idle' }),
};

// @ts-ignore
global.window = {
  electronAPI: mockElectronAPI
};

// Mock data
const mockHealthyStatus = {
  status: 'healthy' as const,
  message: 'Ollama daemon is running',
  models_available: true,
  model_count: 2
};

const mockUnhealthyStatus = {
  status: 'unhealthy' as const,
  message: 'Unable to connect to Ollama daemon',
  models_available: false,
  model_count: 0
};

const mockModels = [
  {
    name: 'llama2:7b',
    digest: 'sha256:abcd1234',
    size: 3825819519,
    modified_at: '2024-01-01T00:00:00Z',
    details: {
      format: 'gguf',
      family: 'llama',
      families: ['llama'],
      parameter_size: '7B',
      quantization_level: 'Q4_0',
    },
  },
  {
    name: 'codellama:13b',
    digest: 'sha256:efgh5678',
    size: 7323838464,
    modified_at: '2024-01-02T00:00:00Z',
    details: {
      format: 'gguf',
      family: 'llama',
      families: ['llama'],
      parameter_size: '13B',
      quantization_level: 'Q4_K_M',
    },
  },
];

const mockMemoryEstimate = {
  modelName: 'llama2:7b',
  estimatedMemory: 5738729278,
  safetyFactor: 1.5
};

describe('ModelSelector', () => {
  const mockOnModelSelected = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    
    // Default mock implementations
    mockElectronAPI.onOllamaHealthUpdate.mockImplementation((callback) => {
      // Return cleanup function
      return () => {};
    });
    
    mockElectronAPI.getModelPreferences.mockResolvedValue({
      mainModel: null,
      subModel: null
    });
  });

  afterEach(async () => {
    // Wait for any pending promises to resolve
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
    });
    cleanup();
    vi.restoreAllMocks();
  });

  describe('Loading State', () => {
    it('should show loading state initially', async () => {
      // Make the health check take a while
      mockElectronAPI.getOllamaHealth.mockImplementation(() => 
        new Promise(resolve => setTimeout(() => resolve(mockHealthyStatus), 1000))
      );

      await act(async () => {
        render(<ModelSelector onModelSelected={mockOnModelSelected} />);
      });

      expect(screen.getByText('Loading Ollama models...')).toBeDefined();
      expect(screen.getByText('⟳')).toBeDefined();
    });
  });

  describe('Healthy Ollama with Models', () => {
    beforeEach(() => {
      mockElectronAPI.getOllamaHealth.mockResolvedValue(mockHealthyStatus);
      mockElectronAPI.getAvailableModels.mockResolvedValue(mockModels);
      mockElectronAPI.getModelMemoryEstimate.mockResolvedValue(mockMemoryEstimate);
    });

    it('should display available models when Ollama is healthy', async () => {
      await act(async () => {
        render(<ModelSelector onModelSelected={mockOnModelSelected} />);
      });
      
      await waitFor(() => {
        expect(screen.getByText('Configure AI Models')).toBeDefined();
      });

      await waitFor(() => {
        expect(screen.getByText('llama2:7b')).toBeDefined();
        expect(screen.getByText('codellama:13b')).toBeDefined();
      });
      
      // Check health indicator
      expect(screen.getByText('Ollama: healthy')).toBeDefined();
      expect(screen.getByText('(2 models)')).toBeDefined();
    });

    it('should display model details correctly', async () => {
      render(<ModelSelector onModelSelected={mockOnModelSelected} />);
      
      await waitFor(() => {
        expect(screen.getByText('7B')).toBeDefined();
        expect(screen.getByText('13B')).toBeDefined();
        expect(screen.getByText('Q4_0')).toBeDefined();
        expect(screen.getByText('Q4_K_M')).toBeDefined();
      });
    });

    it('should handle model selection for main agent', async () => {
      mockElectronAPI.validateModel.mockResolvedValue(true);
      mockElectronAPI.saveModelPreferences.mockResolvedValue(undefined);
      
      render(<ModelSelector onModelSelected={mockOnModelSelected} />);
      
      await waitFor(() => {
        expect(screen.getByText('llama2:7b')).toBeDefined();
      });

      // Find and click the model card in the Main Agent section
      const mainAgentCards = screen.getAllByText('llama2:7b');
      const mainAgentCard = mainAgentCards[0].closest('.model-card');
      
      expect(mainAgentCard).toBeDefined();
      fireEvent.click(mainAgentCard!);
      
      await waitFor(() => {
        expect(mockElectronAPI.validateModel).toHaveBeenCalledWith('llama2:7b');
      });

      await waitFor(() => {
        expect(mockElectronAPI.saveModelPreferences).toHaveBeenCalledWith('llama2:7b', null);
        expect(mockOnModelSelected).toHaveBeenCalledWith('llama2:7b', null);
      });
    });

    it('should show selection summary when models are selected', async () => {
      mockElectronAPI.validateModel.mockResolvedValue(true);
      mockElectronAPI.saveModelPreferences.mockResolvedValue(undefined);
      
      // Start with pre-selected models
      mockElectronAPI.getModelPreferences.mockResolvedValue({
        mainModel: 'llama2:7b',
        subModel: 'codellama:13b'
      });

      render(<ModelSelector onModelSelected={mockOnModelSelected} />);
      
      await waitFor(() => {
        expect(screen.getByText('Current Selection')).toBeDefined();
        expect(screen.getByText('Main Agent:')).toBeDefined();
        expect(screen.getByText('Sub Agent:')).toBeDefined();
      });
    });
  });

  describe('Unhealthy Ollama', () => {
    beforeEach(() => {
      mockElectronAPI.getOllamaHealth.mockResolvedValue(mockUnhealthyStatus);
    });

    it('should show error state when Ollama is unavailable', async () => {
      render(<ModelSelector onModelSelected={mockOnModelSelected} />);
      
      await waitFor(() => {
        expect(screen.getByText('Ollama Not Available')).toBeDefined();
        expect(screen.getByText('🚫')).toBeDefined();
      });

      expect(screen.getByText('Troubleshooting:')).toBeDefined();
      expect(screen.getByText('🔄 Retry Connection')).toBeDefined();
    });

    it('should handle retry connection', async () => {
      render(<ModelSelector onModelSelected={mockOnModelSelected} />);
      
      await waitFor(() => {
        expect(screen.getByText('🔄 Retry Connection')).toBeDefined();
      });

      const retryButton = screen.getByText('🔄 Retry Connection');
      fireEvent.click(retryButton);
      
      expect(mockElectronAPI.getOllamaHealth).toHaveBeenCalledTimes(2);
    });
  });

  describe('Healthy Ollama with No Models', () => {
    beforeEach(() => {
      mockElectronAPI.getOllamaHealth.mockResolvedValue({
        ...mockHealthyStatus,
        models_available: false,
        model_count: 0
      });
      mockElectronAPI.getAvailableModels.mockResolvedValue([]);
    });

    it('should show no models state', async () => {
      render(<ModelSelector onModelSelected={mockOnModelSelected} />);
      
      await waitFor(() => {
        expect(screen.getByText('No Models Available')).toBeDefined();
        expect(screen.getByText('📦')).toBeDefined();
      });

      expect(screen.getByText('Get Started:')).toBeDefined();
      expect(screen.getByText('🔄 Refresh Models')).toBeDefined();
    });
  });

  describe('Model Validation', () => {
    beforeEach(() => {
      mockElectronAPI.getOllamaHealth.mockResolvedValue(mockHealthyStatus);
      mockElectronAPI.getAvailableModels.mockResolvedValue(mockModels);
      mockElectronAPI.getModelMemoryEstimate.mockResolvedValue(mockMemoryEstimate);
    });

    it('should handle validation failure', async () => {
      mockElectronAPI.validateModel.mockResolvedValue(false);
      
      render(<ModelSelector onModelSelected={mockOnModelSelected} />);
      
      await waitFor(() => {
        expect(screen.getByText('llama2:7b')).toBeDefined();
      });

      // Click on model card
      const modelCard = screen.getAllByText('llama2:7b')[0].closest('.model-card');
      fireEvent.click(modelCard!);
      
      await waitFor(() => {
        expect(mockElectronAPI.validateModel).toHaveBeenCalledWith('llama2:7b');
      });

      // Should not save preferences on validation failure
      expect(mockElectronAPI.saveModelPreferences).not.toHaveBeenCalled();
      expect(mockOnModelSelected).not.toHaveBeenCalled();
    });

    it('should show validation status indicators', async () => {
      let resolveValidation: (value: boolean) => void;
      const validationPromise = new Promise<boolean>(resolve => {
        resolveValidation = resolve;
      });
      
      mockElectronAPI.validateModel.mockReturnValue(validationPromise);
      
      render(<ModelSelector onModelSelected={mockOnModelSelected} />);
      
      await waitFor(() => {
        expect(screen.getByText('llama2:7b')).toBeDefined();
      });

      // Click on model card to start validation
      const modelCard = screen.getAllByText('llama2:7b')[0].closest('.model-card');
      fireEvent.click(modelCard!);
      
      // Should show validating state
      await waitFor(() => {
        expect(screen.getByText('⟳')).toBeDefined();
      });
      
      // Resolve validation
      resolveValidation!(true);
      
      await waitFor(() => {
        expect(screen.getByText('✓')).toBeDefined();
      });
    });
  });

  describe('Accessibility and Error Handling', () => {
    beforeEach(() => {
      mockElectronAPI.getOllamaHealth.mockResolvedValue(mockHealthyStatus);
      mockElectronAPI.getAvailableModels.mockResolvedValue(mockModels);
      mockElectronAPI.getModelMemoryEstimate.mockResolvedValue(mockMemoryEstimate);
    });

    it('should be disabled when disabled prop is true', async () => {
      render(<ModelSelector onModelSelected={mockOnModelSelected} disabled={true} />);
      
      await waitFor(() => {
        expect(screen.getByText('llama2:7b')).toBeDefined();
      });

      const modelCard = screen.getAllByText('llama2:7b')[0].closest('.model-card');
      fireEvent.click(modelCard!);
      
      // Should not trigger validation when disabled
      expect(mockElectronAPI.validateModel).not.toHaveBeenCalled();
    });

    it('should handle API errors gracefully', async () => {
      mockElectronAPI.getOllamaHealth.mockRejectedValue(new Error('Network error'));
      
      render(<ModelSelector onModelSelected={mockOnModelSelected} />);
      
      await waitFor(() => {
        expect(screen.getByText('Failed to connect to Ollama. Please ensure Ollama is running.')).toBeDefined();
      });
    });
  });

  describe('Refresh Functionality', () => {
    beforeEach(() => {
      mockElectronAPI.getOllamaHealth.mockResolvedValue(mockHealthyStatus);
      mockElectronAPI.getAvailableModels.mockResolvedValue(mockModels);
      mockElectronAPI.getModelMemoryEstimate.mockResolvedValue(mockMemoryEstimate);
    });

    it('should refresh data when refresh button is clicked', async () => {
      render(<ModelSelector onModelSelected={mockOnModelSelected} />);
      
      await waitFor(() => {
        expect(screen.getByText('🔄')).toBeDefined();
      });

      const refreshButton = screen.getByText('🔄');
      fireEvent.click(refreshButton);
      
      // Should call APIs again
      await waitFor(() => {
        expect(mockElectronAPI.getOllamaHealth).toHaveBeenCalledTimes(2);
        expect(mockElectronAPI.getAvailableModels).toHaveBeenCalledTimes(2);
      });
    });
  });
});
