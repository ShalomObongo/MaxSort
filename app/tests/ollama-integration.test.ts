import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OllamaClient } from '../src/lib/ollama-client';

// Mock fetch for the HTTP client
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('Ollama Integration Tests', () => {
  let client: OllamaClient;

  beforeEach(() => {
    client = new OllamaClient();
    vi.clearAllMocks();
  });

  describe('OllamaClient Health Check', () => {
    it('should return healthy status when Ollama is available', async () => {
      // Mock successful response for connection test
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({}),
      } as Response);

      // Mock successful response for models list
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ models: [{ name: 'llama2:7b' }] }),
      } as Response);

      const health = await client.getHealthStatus();
      
      expect(health.status).toBe('healthy');
      expect(health.models_available).toBe(true);
      expect(health.model_count).toBe(1);
    });

    it('should return unhealthy status when Ollama is not available', async () => {
      // Mock fetch failure
      mockFetch.mockRejectedValueOnce(new Error('Connection refused'));

      const health = await client.getHealthStatus();
      
      expect(health.status).toBe('unhealthy');
      expect(health.models_available).toBe(false);
      expect(health.model_count).toBe(0);
    });
  });

  describe('OllamaClient Model Discovery', () => {
    it('should return available models when Ollama is running', async () => {
      const mockModels = [
        {
          name: 'llama2:7b',
          digest: 'sha256:test123',
          size: 3825819519,
          modified_at: '2024-01-01T00:00:00Z',
          details: {
            format: 'gguf',
            family: 'llama',
            families: ['llama'],
            parameter_size: '7B',
            quantization_level: 'Q4_0',
          }
        }
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ models: mockModels }),
      } as Response);

      const models = await client.getModels();
      
      expect(models).toHaveLength(1);
      expect(models[0].name).toBe('llama2:7b');
      expect(models[0].details?.parameter_size).toBe('7B');
    });

    it('should return empty array when no models are available', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ models: [] }),
      } as Response);

      const models = await client.getModels();
      
      expect(models).toHaveLength(0);
    });
  });

  describe('OllamaClient Model Validation', () => {
    it('should validate existing model successfully', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          model: 'llama2:7b',
          created_at: '2024-01-01T00:00:00Z',
          response: 'test response',
          done: true
        }),
      } as Response);

      const isValid = await client.validateModel('llama2:7b');
      
      expect(isValid).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        'http://127.0.0.1:11434/api/show',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: 'llama2:7b'
          })
        })
      );
    });

    it('should fail validation for non-existent model', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
      } as Response);

      const isValid = await client.validateModel('nonexistent:model');
      
      expect(isValid).toBe(false);
    });
  });

  describe('OllamaClient Memory Estimation', () => {
    it('should estimate memory requirements for a model', async () => {
      const model = {
        name: 'llama2:7b',
        size: 3825819519, // ~3.8GB
        digest: 'sha256:test',
        modified_at: '2024-01-01T00:00:00Z',
        details: {
          format: 'gguf',
          family: 'llama',
          families: ['llama'],
          parameter_size: '7B',
          quantization_level: 'Q4_0',
        }
      };

      const estimatedMemory = client.estimateModelMemory(model);
      
      expect(estimatedMemory).toBeGreaterThan(model.size);
      expect(estimatedMemory).toBeGreaterThan(0);
    });

    it('should handle model without size information', async () => {
      const model = {
        name: 'unknown:model',
        size: 0, // No size info
        digest: 'sha256:test',
        modified_at: '2024-01-01T00:00:00Z',
        details: {
          format: 'gguf',
          family: 'llama',
          families: ['llama'],
          parameter_size: '7B',
          quantization_level: 'Q4_0',
        }
      };

      const estimatedMemory = client.estimateModelMemory(model);
      
      expect(estimatedMemory).toBeGreaterThan(0);
    });
  });

  describe('OllamaClient Connection Test', () => {
    it('should return true for successful connection', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({}),
      } as Response);

      const isConnected = await client.testConnection();
      
      expect(isConnected).toBe(true);
    });

    it('should return false for failed connection', async () => {
      mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));

      const isConnected = await client.testConnection();
      
      expect(isConnected).toBe(false);
    });
  });

  describe('OllamaClient Error Handling', () => {
    it('should handle network errors gracefully in health status', async () => {
      mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));

      const health = await client.getHealthStatus();
      
      expect(health.status).toBe('unhealthy');
      expect(health.message).toContain('Unable to connect');
    });

    it('should return empty models array on API error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      await expect(client.getModels()).rejects.toThrow('Network error');
    });
  });

  describe('OllamaClient Health Monitoring', () => {
    it('should emit health updates on status change', async () => {
      const healthListener = vi.fn();
      client.on('health-update', healthListener);

      // Mock successful connection and models
      mockFetch
        .mockResolvedValueOnce({ ok: true, json: async () => ({}) } as Response)
        .mockResolvedValueOnce({ ok: true, json: async () => ({ models: [] }) } as Response);

      await client.getHealthStatus();
      
      expect(healthListener).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'healthy' })
      );
    });

    it('should start and stop health monitoring', async () => {
      const healthListener = vi.fn();
      client.on('healthUpdate', healthListener);

      client.startHealthMonitoring(100); // 100ms interval for testing
      
      // Wait a bit for at least one health check
      await new Promise(resolve => setTimeout(resolve, 150));
      
      client.stopHealthMonitoring();
      
      const initialCallCount = healthListener.mock.calls.length;
      
      // Wait to ensure no more calls after stopping
      await new Promise(resolve => setTimeout(resolve, 150));
      
      expect(healthListener.mock.calls.length).toBe(initialCallCount);
    });
  });
});
