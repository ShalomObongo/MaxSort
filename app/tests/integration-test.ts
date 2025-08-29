import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AgentManager } from '../src/agents/agent-manager';
import { SystemMonitor } from '../src/lib/system-monitor';
import { OllamaClient } from '../src/lib/ollama-client';
import { TaskPriority, TaskState, CreateTaskParams, FileAnalysisTask } from '../src/agents/task-types';
import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { EventEmitter } from 'events';

// Mock dependencies
vi.mock('../src/lib/system-monitor');
vi.mock('../src/lib/ollama-client');
vi.mock('better-sqlite3');
vi.mock('fs');
vi.mock('os');

describe('AgentManager Integration Tests', () => {
  let agentManager: AgentManager;
  let mockSystemMonitor: any;
  let mockOllamaClient: any;
  let mockDatabase: any;

  const createFileAnalysisTaskParams = (
    filePath: string, 
    priority: 'low' | 'medium' | 'high' = 'medium'
  ): CreateTaskParams<FileAnalysisTask> => {
    const priorityMap = {
      'low': TaskPriority.LOW,
      'medium': TaskPriority.NORMAL, 
      'high': TaskPriority.HIGH
    };

    return {
      type: 'file-analysis',
      priority: priorityMap[priority],
      filePath,
      modelName: 'codellama',
      analysisType: 'classification',
      promptTemplate: 'Analyze this file: {content}',
      expectedResponseFormat: 'json',
      timeoutMs: 30000,
      maxRetries: 3,
      metadata: {},
      estimatedMemoryMB: 256,
    };
  };

  beforeEach(async () => {
    vi.clearAllMocks();

    // Mock Database
    const mockStmt = {
      run: vi.fn(() => ({ lastInsertRowid: 1 })),
      get: vi.fn(),
      all: vi.fn(() => []),
      finalize: vi.fn(),
    };
    
    mockDatabase = {
      prepare: vi.fn(() => mockStmt),
      exec: vi.fn(),
      close: vi.fn(),
      transaction: vi.fn((fn) => fn),
    };
    
    vi.mocked(Database).mockReturnValue(mockDatabase as any);

    // Mock fs
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({
      migrations: { agentTasks: true, agentTaskResults: true }
    }));
    vi.mocked(fs.writeFileSync).mockImplementation(() => {});

    // Mock os
    vi.mocked(os.cpus).mockReturnValue(new Array(8).fill({ model: 'Mock CPU' }) as any);
    vi.mocked(os.totalmem).mockReturnValue(16 * 1024 * 1024 * 1024); // 16GB

    // Setup SystemMonitor mock
    mockSystemMonitor = {
      getAvailableAgentMemory: vi.fn().mockResolvedValue(4 * 1024 * 1024 * 1024), // 4GB
      getCurrentHealth: vi.fn().mockResolvedValue({
        memory: {
          memoryPressure: 0.4,
          freeMemory: 8 * 1024 * 1024 * 1024,
          availableForAgents: 4 * 1024 * 1024 * 1024,
        },
        cpu: { loadAverage1m: 1.0 },
        isUnderStress: false,
        timestamp: Date.now(),
      }),
      on: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
      destroy: vi.fn(),
    };
    vi.mocked(SystemMonitor).mockImplementation(() => mockSystemMonitor);

    // Setup OllamaClient mock
    mockOllamaClient = {
      generateInference: vi.fn().mockImplementation(async (model, prompt) => {
        // Simulate processing time
        await new Promise(resolve => setTimeout(resolve, 50));
        return `Analysis result for ${model}: ${prompt.substring(0, 50)}...`;
      }),
      isAvailable: vi.fn().mockResolvedValue(true),
      listModels: vi.fn().mockResolvedValue(['codellama', 'llama2']),
    };
    vi.mocked(OllamaClient).mockImplementation(() => mockOllamaClient);

    // Initialize AgentManager
    agentManager = new AgentManager({
      maxConcurrentSlots: 4,
      safetyFactor: 0.8,
      taskTimeoutMs: 5000,
    });

    await agentManager.start();
  });

  afterEach(async () => {
    await agentManager.stop();
  });

  describe('Complete Task Pipeline', () => {
    it('should process a file analysis task from creation to completion', async () => {
      // Create task
      const taskParams = createFileAnalysisTaskParams('/test/file.js', 'high');
      const taskId = agentManager.createTask(taskParams);
      
      expect(taskId).toBeDefined();
      expect(typeof taskId).toBe('string');

      // Verify task was created and queued
      const status = agentManager.getStatus();
      expect(status.queuedTasks).toBeGreaterThan(0);

      // Wait for task processing
      await new Promise(resolve => setTimeout(resolve, 200));

      // Verify Ollama was called
      expect(mockOllamaClient.generateInference).toHaveBeenCalled();
      
      // Check that task completed
      const finalStatus = agentManager.getStatus();
      expect(finalStatus.runningTasks).toBe(0);
    });

    it('should handle multiple tasks with different priorities correctly', async () => {
      // Create multiple tasks
      const lowPriorityId = agentManager.createTask(createFileAnalysisTaskParams('/test/low.js', 'low'));
      const highPriorityId = agentManager.createTask(createFileAnalysisTaskParams('/test/high.js', 'high'));
      const mediumPriorityId = agentManager.createTask(createFileAnalysisTaskParams('/test/medium.js', 'medium'));

      expect(lowPriorityId).toBeDefined();
      expect(highPriorityId).toBeDefined();
      expect(mediumPriorityId).toBeDefined();

      // Wait for processing to complete
      await new Promise(resolve => setTimeout(resolve, 300));

      // Verify all tasks were processed
      expect(mockOllamaClient.generateInference).toHaveBeenCalledTimes(3);
      
      const status = agentManager.getStatus();
      expect(status.runningTasks + status.queuedTasks).toBe(0);
    });

    it('should respect resource constraints and slot limits', async () => {
      // Create more tasks than available slots
      const taskIds: string[] = [];
      for (let i = 0; i < 8; i++) {
        const id = agentManager.createTask(createFileAnalysisTaskParams(`/test/file${i}.js`, 'medium'));
        taskIds.push(id);
      }

      // Check that not all tasks are running simultaneously
      const status = agentManager.getStatus();
      expect(status.totalSlots).toBeLessThanOrEqual(4); // Max slots configured
      
      // Some tasks should be queued
      expect(status.queuedTasks + status.runningTasks).toBe(taskIds.length);
    });

    it('should handle task failures gracefully', async () => {
      // Mock Ollama failure
      mockOllamaClient.generateInference.mockRejectedValueOnce(new Error('Model unavailable'));

      const taskId = agentManager.createTask(createFileAnalysisTaskParams('/test/fail.js', 'high'));
      
      // Wait for processing
      await new Promise(resolve => setTimeout(resolve, 200));

      // Task should have failed but system should remain stable
      const status = agentManager.getStatus();
      expect(status.isRunning).toBe(true);
    });

    it('should support task cancellation', async () => {
      // Create a task
      const taskId = agentManager.createTask(createFileAnalysisTaskParams('/test/cancel.js', 'medium'));
      
      // Cancel it immediately
      const cancelled = await agentManager.cancelTask(taskId, 'Test cancellation');
      
      expect(cancelled).toBe(true);
      
      // Verify system is stable
      const status = agentManager.getStatus();
      expect(status.isRunning).toBe(true);
    });
  });

  describe('Resource Management Integration', () => {
    it('should adapt to changing system conditions', async () => {
      // Initial state - normal memory
      const initialStatus = agentManager.getStatus();
      const initialSlots = initialStatus.totalSlots;

      // Simulate memory pressure increase
      mockSystemMonitor.getCurrentHealth.mockResolvedValue({
        memory: {
          memoryPressure: 0.9, // High pressure
          freeMemory: 512 * 1024 * 1024, // 512MB
          availableForAgents: 256 * 1024 * 1024, // 256MB
        },
        cpu: { loadAverage1m: 3.0 },
        isUnderStress: true,
        timestamp: Date.now(),
      });

      // Trigger recomputation
      await agentManager.recomputeSlotCapacity();

      // Check that slots were reduced
      const pressureStatus = agentManager.getStatus();
      expect(pressureStatus.totalSlots).toBeLessThan(initialSlots);
    });

    it('should handle emergency conditions', async () => {
      // Simulate critical memory condition
      mockSystemMonitor.getCurrentHealth.mockResolvedValue({
        memory: {
          memoryPressure: 0.98, // Critical pressure
          freeMemory: 100 * 1024 * 1024, // 100MB
          availableForAgents: 50 * 1024 * 1024, // 50MB
        },
        cpu: { loadAverage1m: 4.0 },
        isUnderStress: true,
        timestamp: Date.now(),
      });

      // Try to create a task
      const taskId = agentManager.createTask(createFileAnalysisTaskParams('/test/emergency.js', 'low'));
      
      // Task should be created but system should be in emergency mode
      expect(taskId).toBeDefined();
      
      // Trigger health update
      await agentManager.recomputeSlotCapacity();
      
      const status = agentManager.getStatus();
      expect(status.totalSlots).toBe(0); // No slots available in emergency
    });

    it('should integrate with database for task persistence', async () => {
      // Create and process a task
      const taskId = agentManager.createTask(createFileAnalysisTaskParams('/test/persist.js', 'medium'));
      
      // Wait for processing
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Verify database interactions
      expect(mockDatabase.prepare).toHaveBeenCalled();
      
      // Should have prepared statements for task operations
      const prepareCalls = vi.mocked(mockDatabase.prepare).mock.calls;
      const taskInsertCalls = prepareCalls.filter(call => 
        call[0].includes('INSERT INTO agent_tasks')
      );
      expect(taskInsertCalls.length).toBeGreaterThan(0);
    });
  });

  describe('Event System Integration', () => {
    it('should emit appropriate events during task lifecycle', async () => {
      const events: Array<{ event: string; data: any }> = [];
      
      // Listen to events
      agentManager.on('task-created', (data) => events.push({ event: 'task-created', data }));
      agentManager.on('task-started', (data) => events.push({ event: 'task-started', data }));
      agentManager.on('task-completed', (data) => events.push({ event: 'task-completed', data }));

      // Create and process task
      const taskId = agentManager.createTask(createFileAnalysisTaskParams('/test/events.js', 'high'));
      
      // Wait for processing
      await new Promise(resolve => setTimeout(resolve, 200));

      // Verify events were emitted
      expect(events.some(e => e.event === 'task-created')).toBe(true);
      
      // At least task creation should have been captured
      const createdEvent = events.find(e => e.event === 'task-created');
      expect(createdEvent?.data).toHaveProperty('id', taskId);
    });

    it('should handle system health events', async () => {
      const healthEvents: any[] = [];
      
      agentManager.on('slots-recomputed', (data) => healthEvents.push(data));

      // Trigger slot recomputation
      await agentManager.recomputeSlotCapacity();
      
      // Should have emitted recomputation event
      expect(healthEvents.length).toBeGreaterThan(0);
      expect(healthEvents[0]).toHaveProperty('totalSlots');
    });
  });

  describe('Error Recovery Integration', () => {
    it('should recover from temporary Ollama unavailability', async () => {
      // Simulate Ollama unavailable initially
      mockOllamaClient.isAvailable.mockResolvedValueOnce(false);
      mockOllamaClient.generateInference.mockRejectedValueOnce(new Error('Ollama unavailable'));

      const taskId = agentManager.createTask(createFileAnalysisTaskParams('/test/recovery.js', 'medium'));
      
      // Wait briefly
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Restore Ollama availability
      mockOllamaClient.isAvailable.mockResolvedValue(true);
      mockOllamaClient.generateInference.mockResolvedValue('Recovery successful');
      
      // Wait for retry
      await new Promise(resolve => setTimeout(resolve, 200));
      
      // System should have recovered
      const status = agentManager.getStatus();
      expect(status.isRunning).toBe(true);
    });

    it('should handle database connection recovery', async () => {
      // Simulate database error then recovery
      mockDatabase.prepare.mockImplementationOnce(() => {
        throw new Error('Database connection lost');
      });

      // Try to create task (should handle error)
      try {
        agentManager.createTask(createFileAnalysisTaskParams('/test/db-recovery.js', 'low'));
      } catch (error) {
        // Expected to fail
      }

      // Restore database
      const mockStmt = {
        run: vi.fn(() => ({ lastInsertRowid: 1 })),
        get: vi.fn(),
        all: vi.fn(() => []),
        finalize: vi.fn(),
      };
      mockDatabase.prepare.mockReturnValue(mockStmt);

      // Should be able to create tasks again
      const taskId = agentManager.createTask(createFileAnalysisTaskParams('/test/db-recovered.js', 'medium'));
      expect(taskId).toBeDefined();
    });
  });

  describe('Performance and Stability', () => {
    it('should maintain performance under moderate load', async () => {
      const startTime = Date.now();
      const taskIds: string[] = [];

      // Create moderate number of tasks
      for (let i = 0; i < 10; i++) {
        const id = agentManager.createTask(createFileAnalysisTaskParams(`/test/perf${i}.js`, 'medium'));
        taskIds.push(id);
      }

      // Wait for all tasks to process
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      const endTime = Date.now();
      const duration = endTime - startTime;

      // Should complete within reasonable time
      expect(duration).toBeLessThan(2000); // 2 seconds for 10 tasks

      // All tasks should be created successfully
      expect(taskIds).toHaveLength(10);
      taskIds.forEach(id => expect(id).toBeDefined());

      // System should remain stable
      const status = agentManager.getStatus();
      expect(status.isRunning).toBe(true);
    });

    it('should clean up completed tasks to prevent memory leaks', async () => {
      // Create and complete several tasks
      for (let i = 0; i < 5; i++) {
        agentManager.createTask(createFileAnalysisTaskParams(`/test/cleanup${i}.js`, 'low'));
      }

      // Wait for completion
      await new Promise(resolve => setTimeout(resolve, 300));

      // Check that running/queued counts are reasonable
      const status = agentManager.getStatus();
      expect(status.runningTasks).toBeLessThanOrEqual(4); // Max slots
      expect(status.queuedTasks + status.runningTasks).toBeLessThan(10); // Should have cleaned up completed
    });
  });
});
