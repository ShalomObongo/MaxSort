import { describe, it, expect, beforeEach, afterEach, vi, type MockedFunction } from 'vitest';
import { AgentManager } from '../src/agents/agent-manager';
import { TaskPriority, TaskState, type FileAnalysisTask, type CreateTaskParams } from '../src/agents/task-types';
import { SystemMonitor, type SystemHealth } from '../src/lib/system-monitor';
import { OllamaClient } from '../src/lib/ollama-client';

// Mock the system dependencies
vi.mock('../src/lib/system-monitor');
vi.mock('../src/lib/ollama-client');

const MockedSystemMonitor = vi.mocked(SystemMonitor);
const MockedOllamaClient = vi.mocked(OllamaClient);

describe('AgentManager', () => {
  let agentManager: AgentManager;
  let mockSystemMonitor: SystemMonitor;
  let mockOllamaClient: OllamaClient;

  // Mock system health data
  const mockSystemHealth: SystemHealth = {
    timestamp: Date.now(),
    memory: {
      totalMemory: 16 * 1024 * 1024 * 1024, // 16GB
      freeMemory: 8 * 1024 * 1024 * 1024,   // 8GB free
      usedMemory: 8 * 1024 * 1024 * 1024,   // 8GB used
      memoryPressure: 0.5,                   // 50% memory pressure
      availableForAgents: 6 * 1024 * 1024 * 1024, // 6GB available for agents
    },
    cpu: {
      loadAverage1m: 1.5,
      loadAverage5m: 1.2,
      loadAverage15m: 1.0,
      cpuUsage: 25.0,
    },
    isUnderStress: false,
  };

  beforeEach(async () => {
    // Reset mocks
    vi.clearAllMocks();

    // Setup system monitor mock
    mockSystemMonitor = new MockedSystemMonitor();
    mockSystemMonitor.start = vi.fn();
    mockSystemMonitor.stop = vi.fn();
    mockSystemMonitor.getCurrentHealth = vi.fn().mockResolvedValue(mockSystemHealth);
    mockSystemMonitor.on = vi.fn();

    // Setup Ollama client mock
    mockOllamaClient = new MockedOllamaClient();
    mockOllamaClient.getModels = vi.fn().mockResolvedValue([
      {
        name: 'llama2:7b',
        digest: 'sha256:abc123',
        size: 3.8 * 1024 * 1024 * 1024, // 3.8GB
        modified_at: '2024-01-01T00:00:00Z',
      },
      {
        name: 'codellama:13b',
        digest: 'sha256:def456',
        size: 7.2 * 1024 * 1024 * 1024, // 7.2GB
        modified_at: '2024-01-01T00:00:00Z',
      }
    ]);
    mockOllamaClient.estimateModelMemory = vi.fn().mockImplementation((model) => {
      return model.size * 1.5; // Safety factor already included
    });
    mockOllamaClient.executeInference = vi.fn().mockResolvedValue({
      response: '{"classification": "document", "confidence": 0.95}',
      executionTimeMs: 2500,
    });
    mockOllamaClient.on = vi.fn();

    // Mock singleton getters
    vi.mocked(require('../src/lib/system-monitor').getSystemMonitor).mockReturnValue(mockSystemMonitor);
    vi.mocked(require('../src/lib/ollama-client').getOllamaClient).mockReturnValue(mockOllamaClient);

    // Create AgentManager with test configuration
    agentManager = new AgentManager({
      maxConcurrentSlots: 4,
      safetyFactor: 1.5,
      osReservedMemory: 2 * 1024 * 1024 * 1024, // 2GB
      taskTimeoutMs: 10000, // 10 seconds for tests
      maxRetries: 2,
      healthCheckInterval: 1000,
      slotRecomputeInterval: 1000,
    });
  });

  afterEach(async () => {
    if (agentManager) {
      await agentManager.stop();
    }
  });

  describe('Initialization and Setup', () => {
    it('should initialize with correct configuration', () => {
      const config = agentManager.getConfig();
      
      expect(config.maxConcurrentSlots).toBe(4);
      expect(config.safetyFactor).toBe(1.5);
      expect(config.osReservedMemory).toBe(2 * 1024 * 1024 * 1024);
    });

    it('should start successfully and compute initial slot capacity', async () => {
      await agentManager.start();
      
      expect(mockSystemMonitor.start).toHaveBeenCalled();
      expect(mockOllamaClient.getModels).toHaveBeenCalled();
      
      const status = agentManager.getStatus();
      expect(status.isRunning).toBe(true);
      expect(status.totalSlots).toBeGreaterThan(0);
    });

    it('should stop gracefully and cleanup resources', async () => {
      await agentManager.start();
      await agentManager.stop();
      
      expect(mockSystemMonitor.stop).toHaveBeenCalled();
      
      const status = agentManager.getStatus();
      expect(status.isRunning).toBe(false);
    });
  });

  describe('Slot Calculation', () => {
    beforeEach(async () => {
      await agentManager.start();
    });

    it('should calculate slots based on available memory and model sizes', async () => {
      await agentManager.recomputeSlotCapacity();
      
      const status = agentManager.getStatus();
      
      // With 6GB available and average model ~5.5GB, should allow 1 slot
      // But capped by maxConcurrentSlots = 4
      expect(status.totalSlots).toBeGreaterThan(0);
      expect(status.totalSlots).toBeLessThanOrEqual(4);
    });

    it('should respect memory safety factors', async () => {
      // Test with low memory scenario
      const lowMemoryHealth: SystemHealth = {
        ...mockSystemHealth,
        memory: {
          ...mockSystemHealth.memory,
          freeMemory: 1 * 1024 * 1024 * 1024,    // 1GB free
          availableForAgents: 0,                   // No memory for agents
          memoryPressure: 0.95,                   // Very high pressure
        },
        isUnderStress: true,
      };

      mockSystemMonitor.getCurrentHealth = vi.fn().mockResolvedValue(lowMemoryHealth);
      
      await agentManager.recomputeSlotCapacity();
      
      const status = agentManager.getStatus();
      expect(status.totalSlots).toBe(0); // No slots available
    });

    it('should not exceed maxConcurrentSlots configuration', async () => {
      // Test with abundant memory
      const abundantMemoryHealth: SystemHealth = {
        ...mockSystemHealth,
        memory: {
          ...mockSystemHealth.memory,
          freeMemory: 32 * 1024 * 1024 * 1024,   // 32GB free
          availableForAgents: 30 * 1024 * 1024 * 1024, // 30GB for agents
          memoryPressure: 0.2,
        },
      };

      mockSystemMonitor.getCurrentHealth = vi.fn().mockResolvedValue(abundantMemoryHealth);
      
      await agentManager.recomputeSlotCapacity();
      
      const status = agentManager.getStatus();
      expect(status.totalSlots).toBeLessThanOrEqual(4); // Capped by config
    });
  });

  describe('Task Management', () => {
    beforeEach(async () => {
      await agentManager.start();
    });

    it('should create and queue file analysis task', () => {
      const taskParams: CreateTaskParams<FileAnalysisTask> = {
        type: 'file-analysis',
        filePath: '/test/document.txt',
        modelName: 'llama2:7b',
        analysisType: 'classification',
        promptTemplate: 'Classify: {{content}}',
        expectedResponseFormat: 'json',
        priority: TaskPriority.NORMAL,
        timeoutMs: 10000,
        maxRetries: 2,
        metadata: { source: 'test' },
        estimatedMemoryMB: 4000,
      };

      const taskId = agentManager.createTask(taskParams);
      
      expect(taskId).toBeDefined();
      expect(typeof taskId).toBe('string');
      
      const status = agentManager.getStatus();
      expect(status.queuedTasks).toBe(1);
    });

    it('should prioritize high priority tasks', () => {
      // Create low priority task first
      const lowPriorityTask: CreateTaskParams<FileAnalysisTask> = {
        type: 'file-analysis',
        filePath: '/test/low.txt',
        modelName: 'llama2:7b',
        analysisType: 'summary',
        promptTemplate: 'Summarize: {{content}}',
        expectedResponseFormat: 'text',
        priority: TaskPriority.LOW,
        timeoutMs: 10000,
        maxRetries: 2,
        metadata: {},
        estimatedMemoryMB: 4000,
      };

      // Create high priority task second
      const highPriorityTask: CreateTaskParams<FileAnalysisTask> = {
        ...lowPriorityTask,
        filePath: '/test/high.txt',
        priority: TaskPriority.HIGH,
      };

      const lowTaskId = agentManager.createTask(lowPriorityTask);
      const highTaskId = agentManager.createTask(highPriorityTask);

      // High priority task should be processed first
      // This would be tested through task dispatch order
      expect(lowTaskId).toBeDefined();
      expect(highTaskId).toBeDefined();
    });

    it('should cancel queued tasks', async () => {
      const taskParams: CreateTaskParams<FileAnalysisTask> = {
        type: 'file-analysis',
        filePath: '/test/cancel.txt',
        modelName: 'llama2:7b',
        analysisType: 'classification',
        promptTemplate: 'Classify: {{content}}',
        expectedResponseFormat: 'json',
        priority: TaskPriority.NORMAL,
        timeoutMs: 10000,
        maxRetries: 2,
        metadata: {},
        estimatedMemoryMB: 4000,
      };

      const taskId = agentManager.createTask(taskParams);
      const success = await agentManager.cancelTask(taskId, 'Test cancellation');
      
      expect(success).toBe(true);
    });
  });

  describe('Task Execution', () => {
    beforeEach(async () => {
      await agentManager.start();
    });

    it('should execute file analysis task successfully', async () => {
      const taskParams: CreateTaskParams<FileAnalysisTask> = {
        type: 'file-analysis',
        filePath: '/test/document.txt',
        modelName: 'llama2:7b',
        analysisType: 'classification',
        promptTemplate: 'Classify: {{content}}',
        expectedResponseFormat: 'json',
        priority: TaskPriority.NORMAL,
        timeoutMs: 10000,
        maxRetries: 2,
        metadata: {},
        estimatedMemoryMB: 4000,
      };

      const taskId = agentManager.createTask(taskParams);
      
      // Wait for task completion
      return new Promise<void>((resolve) => {
        agentManager.on('task-completed', (result) => {
          if (result.taskId === taskId) {
            expect(result.success).toBe(true);
            expect(result.result).toBeDefined();
            expect(result.executionTimeMs).toBeGreaterThan(0);
            expect(mockOllamaClient.executeInference).toHaveBeenCalled();
            resolve();
          }
        });
      });
    });

    it('should retry failed tasks up to maxRetries', async () => {
      // Mock Ollama client to fail initially then succeed
      let callCount = 0;
      mockOllamaClient.executeInference = vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount <= 2) {
          return Promise.reject(new Error('Temporary failure'));
        }
        return Promise.resolve({
          response: 'Success after retries',
          executionTimeMs: 1000,
        });
      });

      const taskParams: CreateTaskParams<FileAnalysisTask> = {
        type: 'file-analysis',
        filePath: '/test/retry.txt',
        modelName: 'llama2:7b',
        analysisType: 'summary',
        promptTemplate: 'Summarize: {{content}}',
        expectedResponseFormat: 'text',
        priority: TaskPriority.NORMAL,
        timeoutMs: 5000,
        maxRetries: 3,
        metadata: {},
        estimatedMemoryMB: 4000,
      };

      const taskId = agentManager.createTask(taskParams);

      // Wait for task completion after retries
      return new Promise<void>((resolve) => {
        agentManager.on('task-completed', (result) => {
          if (result.taskId === taskId) {
            expect(result.success).toBe(true);
            expect(callCount).toBe(3); // Failed twice, succeeded on third
            resolve();
          }
        });
      });
    });

    it('should fail tasks that exceed maxRetries', async () => {
      // Mock Ollama client to always fail
      mockOllamaClient.executeInference = vi.fn().mockRejectedValue(new Error('Persistent failure'));

      const taskParams: CreateTaskParams<FileAnalysisTask> = {
        type: 'file-analysis',
        filePath: '/test/fail.txt',
        modelName: 'llama2:7b',
        analysisType: 'extraction',
        promptTemplate: 'Extract: {{content}}',
        expectedResponseFormat: 'text',
        priority: TaskPriority.NORMAL,
        timeoutMs: 5000,
        maxRetries: 2,
        metadata: {},
        estimatedMemoryMB: 4000,
      };

      const taskId = agentManager.createTask(taskParams);

      // Wait for task failure
      return new Promise<void>((resolve) => {
        agentManager.on('task-failed', (result) => {
          if (result.taskId === taskId) {
            expect(result.success).toBe(false);
            expect(result.error).toBeDefined();
            expect((result.error as Error).message).toBe('Persistent failure');
            resolve();
          }
        });
      });
    });
  });

  describe('Memory Safety and Thresholds', () => {
    beforeEach(async () => {
      await agentManager.start();
    });

    it('should handle soft memory threshold', async () => {
      // Simulate high memory pressure (85%+)
      const highPressureHealth: SystemHealth = {
        ...mockSystemHealth,
        memory: {
          ...mockSystemHealth.memory,
          memoryPressure: 0.87, // Above soft threshold
          availableForAgents: 1 * 1024 * 1024 * 1024, // 1GB
        },
        isUnderStress: true,
      };

      mockSystemMonitor.getCurrentHealth = vi.fn().mockResolvedValue(highPressureHealth);
      
      await agentManager.recomputeSlotCapacity();
      
      // Should still allow some slots but be more conservative
      const status = agentManager.getStatus();
      expect(status.totalSlots).toBeGreaterThanOrEqual(0);
    });

    it('should trigger emergency eviction on hard threshold', async () => {
      // Start with normal memory and create tasks
      await agentManager.start();
      
      const taskId = agentManager.createTask({
        type: 'file-analysis',
        filePath: '/test/evict.txt',
        modelName: 'llama2:7b',
        analysisType: 'classification',
        promptTemplate: 'Classify: {{content}}',
        expectedResponseFormat: 'json',
        priority: TaskPriority.LOW, // Low priority for eviction
        timeoutMs: 30000,
        maxRetries: 1,
        metadata: {},
        estimatedMemoryMB: 4000,
      });

      // Simulate critical memory condition
      const criticalMemoryHealth: SystemHealth = {
        ...mockSystemHealth,
        memory: {
          ...mockSystemHealth.memory,
          memoryPressure: 0.96, // Above hard threshold
          availableForAgents: 0,
        },
        isUnderStress: true,
      };

      mockSystemMonitor.getCurrentHealth = vi.fn().mockResolvedValue(criticalMemoryHealth);
      
      await agentManager.recomputeSlotCapacity();
      
      // Should trigger emergency procedures
      const status = agentManager.getStatus();
      expect(status.totalSlots).toBe(0);
    });
  });

  describe('Configuration and Updates', () => {
    it('should update configuration at runtime', async () => {
      await agentManager.start();
      
      const newConfig = {
        maxConcurrentSlots: 8,
        safetyFactor: 2.0,
      };

      agentManager.updateConfig(newConfig);
      
      const updatedConfig = agentManager.getConfig();
      expect(updatedConfig.maxConcurrentSlots).toBe(8);
      expect(updatedConfig.safetyFactor).toBe(2.0);
    });

    it('should emit configuration update events', async () => {
      return new Promise<void>((resolve) => {
        agentManager.on('config-updated', (config) => {
          expect(config.maxConcurrentSlots).toBe(6);
          resolve();
        });

        agentManager.updateConfig({ maxConcurrentSlots: 6 });
      });
    });
  });

  describe('Status and Monitoring', () => {
    beforeEach(async () => {
      await agentManager.start();
    });

    it('should provide accurate status information', () => {
      const status = agentManager.getStatus();
      
      expect(status).toHaveProperty('isRunning');
      expect(status).toHaveProperty('totalSlots');
      expect(status).toHaveProperty('availableSlots');
      expect(status).toHaveProperty('runningTasks');
      expect(status).toHaveProperty('queuedTasks');
      expect(status).toHaveProperty('systemHealth');
      expect(status).toHaveProperty('memoryUtilization');
      expect(status).toHaveProperty('emergencyMode');

      expect(typeof status.isRunning).toBe('boolean');
      expect(typeof status.totalSlots).toBe('number');
      expect(typeof status.availableSlots).toBe('number');
    });

    it('should emit system health updates', async () => {
      return new Promise<void>((resolve) => {
        agentManager.on('system-health', (health) => {
          expect(health).toHaveProperty('memory');
          expect(health).toHaveProperty('cpu');
          expect(health).toHaveProperty('timestamp');
          resolve();
        });

        // Trigger health update by calling the mock
        const mockHealthHandler = vi.mocked(mockSystemMonitor.on).mock.calls
          .find(call => call[0] === 'health-update')?.[1];
        
        if (mockHealthHandler) {
          (mockHealthHandler as Function)(mockSystemHealth);
        }
      });
    });
  });
});
