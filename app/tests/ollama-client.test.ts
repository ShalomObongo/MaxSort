import { describe, it, expect, beforeEach, vi } from 'vitest'
import { OllamaClient } from '../src/lib/ollama-client'

// Mock fetch globally
global.fetch = vi.fn()

describe('OllamaClient', () => {
  let client: OllamaClient
  const mockFetch = fetch as any

  beforeEach(() => {
    client = new OllamaClient()
    vi.clearAllMocks()
  })

  describe('testConnection', () => {
    it('should return true for successful connection', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200
      })

      const result = await client.testConnection()
      expect(result).toBe(true)
      expect(mockFetch).toHaveBeenCalledWith('http://127.0.0.1:11434/api/version', {
        method: 'GET',
        signal: expect.any(AbortSignal),
        headers: {
          'Content-Type': 'application/json',
        }
      })
    })

    it('should return false for failed connection', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500
      })

      const result = await client.testConnection()
      expect(result).toBe(false)
    })

    it('should return false for network error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'))

      const result = await client.testConnection()
      expect(result).toBe(false)
    })

    it('should return false for undefined response', async () => {
      mockFetch.mockResolvedValueOnce(undefined)

      const result = await client.testConnection()
      expect(result).toBe(false)
    })
  })

  describe('getModels', () => {
    it('should return models for successful response', async () => {
      const mockModels = {
        models: [
          { name: 'llama2:7b', size: 3825819519 },
          { name: 'codellama:13b', size: 7365960935 }
        ]
      }

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue(mockModels)
      })

      const result = await client.getModels()
      expect(result).toEqual(mockModels.models)
      expect(mockFetch).toHaveBeenCalledWith('http://127.0.0.1:11434/api/tags', {
        method: 'GET',
        signal: expect.any(AbortSignal),
        headers: {
          'Content-Type': 'application/json',
        }
      })
    })

    it('should throw error for failed response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error'
      })

      await expect(client.getModels()).rejects.toThrow('Failed to fetch models: HTTP 500')
    })

    it('should throw error for network error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'))

      await expect(client.getModels()).rejects.toThrow('Network error')
    })

    it('should throw error for undefined response', async () => {
      mockFetch.mockResolvedValueOnce(undefined)

      await expect(client.getModels()).rejects.toThrow('Failed to fetch models: HTTP unknown')
    })
  })

  describe('health monitoring', () => {
    it('should start health monitoring', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200
      })

      client.startHealthMonitoring(1000)

      // Stop monitoring to cleanup
      client.stopHealthMonitoring()
    })

    it('should stop health monitoring', () => {
      client.startHealthMonitoring(1000)
      client.stopHealthMonitoring()

      // Test passed if no errors thrown
      expect(true).toBe(true)
    })

    it('should emit health update events', async () => {
      const healthSpy = vi.fn()
      client.on('health-update', healthSpy)

      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ models: [] })
      })

      client.startHealthMonitoring(100)

      // Wait a bit for the first health check
      await new Promise(resolve => setTimeout(resolve, 150))

      expect(healthSpy).toHaveBeenCalled()

      client.stopHealthMonitoring()
    })
  })
})
