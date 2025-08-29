import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PriorityQueue } from '../src/agents/priority-queue';
import { TaskPriority, TaskState, type AgentTask } from '../src/agents/task-types';

describe('PriorityQueue', () => {
  let queue: PriorityQueue;

  beforeEach(() => {
    queue = new PriorityQueue();
  });

  afterEach(() => {
    queue.clear();
  });

  const createMockTask = (id: string, priority: TaskPriority): AgentTask => ({
    id,
    type: 'file-analysis',
    priority,
    state: TaskState.QUEUED,
    createdAt: Date.now(),
    timeoutMs: 30000,
    retryCount: 0,
    maxRetries: 3,
    metadata: {},
    estimatedMemoryMB: 1000,
  } as AgentTask);

  describe('Basic Queue Operations', () => {
    it('should enqueue and dequeue tasks', () => {
      const task = createMockTask('test-1', TaskPriority.NORMAL);
      
      queue.enqueue(task);
      expect(queue.getQueueSize()).toBe(1);
      
      const dequeuedTask = queue.dequeue();
      expect(dequeuedTask).toBe(task);
      expect(queue.getQueueSize()).toBe(0);
    });

    it('should return null when dequeuing empty queue', () => {
      const task = queue.dequeue();
      expect(task).toBeNull();
    });

    it('should maintain FIFO order within same priority', () => {
      const task1 = createMockTask('task-1', TaskPriority.NORMAL);
      const task2 = createMockTask('task-2', TaskPriority.NORMAL);
      const task3 = createMockTask('task-3', TaskPriority.NORMAL);

      // Add slight delay to ensure different timestamps
      task2.createdAt = task1.createdAt + 1;
      task3.createdAt = task1.createdAt + 2;

      queue.enqueue(task1);
      queue.enqueue(task2);
      queue.enqueue(task3);

      expect(queue.dequeue()).toBe(task1);
      expect(queue.dequeue()).toBe(task2);
      expect(queue.dequeue()).toBe(task3);
    });
  });

  describe('Priority Ordering', () => {
    it('should dequeue highest priority tasks first', () => {
      const lowTask = createMockTask('low', TaskPriority.LOW);
      const highTask = createMockTask('high', TaskPriority.HIGH);
      const normalTask = createMockTask('normal', TaskPriority.NORMAL);
      const criticalTask = createMockTask('critical', TaskPriority.CRITICAL);

      // Enqueue in random order
      queue.enqueue(lowTask);
      queue.enqueue(normalTask);
      queue.enqueue(criticalTask);
      queue.enqueue(highTask);

      // Should dequeue in priority order
      expect(queue.dequeue()).toBe(criticalTask); // Priority 0
      expect(queue.dequeue()).toBe(highTask);     // Priority 1
      expect(queue.dequeue()).toBe(normalTask);   // Priority 2
      expect(queue.dequeue()).toBe(lowTask);      // Priority 3
    });

    it('should handle mixed priorities with FIFO within each priority', () => {
      const high1 = createMockTask('high-1', TaskPriority.HIGH);
      const high2 = createMockTask('high-2', TaskPriority.HIGH);
      const normal1 = createMockTask('normal-1', TaskPriority.NORMAL);
      const normal2 = createMockTask('normal-2', TaskPriority.NORMAL);

      // Ensure different timestamps
      high2.createdAt = high1.createdAt + 1;
      normal1.createdAt = high1.createdAt + 2;
      normal2.createdAt = high1.createdAt + 3;

      queue.enqueue(normal1);
      queue.enqueue(high2);
      queue.enqueue(normal2);
      queue.enqueue(high1);

      expect(queue.dequeue()).toBe(high1);    // First high priority
      expect(queue.dequeue()).toBe(high2);    // Second high priority  
      expect(queue.dequeue()).toBe(normal1);  // First normal priority
      expect(queue.dequeue()).toBe(normal2);  // Second normal priority
    });
  });

  describe('Task State Management', () => {
    it('should update task states', () => {
      const task = createMockTask('state-test', TaskPriority.NORMAL);
      queue.enqueue(task);

      expect(task.state).toBe(TaskState.QUEUED);

      const success = queue.updateTaskState(task.id, TaskState.RUNNING);
      expect(success).toBe(true);
      expect(task.state).toBe(TaskState.RUNNING);

      const completedAt = Date.now();
      queue.updateTaskState(task.id, TaskState.COMPLETED, completedAt);
      expect(task.state).toBe(TaskState.COMPLETED);
      expect(task.completedAt).toBe(completedAt);
    });

    it('should cancel tasks', () => {
      const task = createMockTask('cancel-test', TaskPriority.NORMAL);
      queue.enqueue(task);

      const success = queue.cancelTask(task.id);
      expect(success).toBe(true);
      expect(task.state).toBe(TaskState.CANCELLED);
      expect(task.completedAt).toBeDefined();
    });

    it('should not cancel already completed tasks', () => {
      const task = createMockTask('completed-test', TaskPriority.NORMAL);
      task.state = TaskState.COMPLETED;
      queue.enqueue(task);

      const success = queue.cancelTask(task.id);
      expect(success).toBe(false);
    });
  });

  describe('Queue Statistics', () => {
    it('should provide accurate queue statistics', () => {
      const tasks = [
        createMockTask('task-1', TaskPriority.HIGH),
        createMockTask('task-2', TaskPriority.NORMAL),
        createMockTask('task-3', TaskPriority.LOW),
        createMockTask('task-4', TaskPriority.HIGH),
      ];

      tasks.forEach(task => queue.enqueue(task));
      
      // Update some states
      queue.updateTaskState(tasks[0].id, TaskState.RUNNING);
      queue.updateTaskState(tasks[1].id, TaskState.COMPLETED, Date.now());

      const stats = queue.getStats();
      
      expect(stats.total).toBe(4);
      expect(stats.byPriority[TaskPriority.HIGH]).toBe(2);
      expect(stats.byPriority[TaskPriority.NORMAL]).toBe(1);
      expect(stats.byPriority[TaskPriority.LOW]).toBe(1);
      expect(stats.byState[TaskState.QUEUED]).toBe(2);
      expect(stats.byState[TaskState.RUNNING]).toBe(1);
      expect(stats.byState[TaskState.COMPLETED]).toBe(1);
    });

    it('should calculate wait times for queued tasks', () => {
      const oldTask = createMockTask('old-task', TaskPriority.NORMAL);
      oldTask.createdAt = Date.now() - 10000; // 10 seconds ago
      
      const newTask = createMockTask('new-task', TaskPriority.NORMAL);
      newTask.createdAt = Date.now() - 1000;  // 1 second ago

      queue.enqueue(oldTask);
      queue.enqueue(newTask);

      const stats = queue.getStats();
      
      expect(stats.oldestQueuedTask).toBe(oldTask.createdAt);
      expect(stats.averageWaitTime).toBeGreaterThan(5000); // Should be around 5.5 seconds
    });
  });

  describe('Task Filtering and Retrieval', () => {
    it('should filter tasks by state', () => {
      const tasks = [
        createMockTask('queued-1', TaskPriority.NORMAL),
        createMockTask('queued-2', TaskPriority.HIGH),
        createMockTask('running-1', TaskPriority.NORMAL),
      ];

      tasks.forEach(task => queue.enqueue(task));
      queue.updateTaskState(tasks[2].id, TaskState.RUNNING);

      const queuedTasks = queue.getTasks({ state: TaskState.QUEUED });
      const runningTasks = queue.getTasks({ state: TaskState.RUNNING });

      expect(queuedTasks).toHaveLength(2);
      expect(runningTasks).toHaveLength(1);
      expect(runningTasks[0].id).toBe('running-1');
    });

    it('should filter tasks by priority', () => {
      const tasks = [
        createMockTask('high-1', TaskPriority.HIGH),
        createMockTask('high-2', TaskPriority.HIGH),
        createMockTask('normal-1', TaskPriority.NORMAL),
      ];

      tasks.forEach(task => queue.enqueue(task));

      const highTasks = queue.getTasks({ priority: TaskPriority.HIGH });
      const normalTasks = queue.getTasks({ priority: TaskPriority.NORMAL });

      expect(highTasks).toHaveLength(2);
      expect(normalTasks).toHaveLength(1);
    });

    it('should get running tasks', () => {
      const tasks = [
        createMockTask('task-1', TaskPriority.NORMAL),
        createMockTask('task-2', TaskPriority.NORMAL),
        createMockTask('task-3', TaskPriority.NORMAL),
      ];

      tasks.forEach(task => queue.enqueue(task));
      queue.updateTaskState(tasks[1].id, TaskState.RUNNING);

      const runningTasks = queue.getRunningTasks();
      expect(runningTasks).toHaveLength(1);
      expect(runningTasks[0].id).toBe('task-2');
    });

    it('should get queued tasks in priority order', () => {
      const lowTask = createMockTask('low', TaskPriority.LOW);
      const highTask = createMockTask('high', TaskPriority.HIGH);
      
      queue.enqueue(lowTask);
      queue.enqueue(highTask);

      const queuedTasks = queue.getQueuedTasks();
      expect(queuedTasks).toHaveLength(2);
      expect(queuedTasks[0]).toBe(highTask); // Should be first due to priority
      expect(queuedTasks[1]).toBe(lowTask);
    });
  });

  describe('Task Cleanup', () => {
    it('should cleanup old completed tasks', () => {
      const oldTask = createMockTask('old', TaskPriority.NORMAL);
      const newTask = createMockTask('new', TaskPriority.NORMAL);

      queue.enqueue(oldTask);
      queue.enqueue(newTask);

      // Mark as completed with different times
      const oldTime = Date.now() - 25 * 60 * 60 * 1000; // 25 hours ago
      const newTime = Date.now() - 1 * 60 * 60 * 1000;  // 1 hour ago

      queue.updateTaskState(oldTask.id, TaskState.COMPLETED, oldTime);
      queue.updateTaskState(newTask.id, TaskState.COMPLETED, newTime);

      // Cleanup tasks older than 24 hours
      const removed = queue.cleanupCompletedTasks(24 * 60 * 60 * 1000);
      
      expect(removed).toBe(1); // Only old task should be removed
      expect(queue.getTask(oldTask.id)).toBeNull();
      expect(queue.getTask(newTask.id)).not.toBeNull();
    });
  });

  describe('Performance Metrics', () => {
    it('should track task results and provide performance metrics', () => {
      queue.recordTaskResult({
        taskId: 'test-1',
        success: true,
        executionTimeMs: 1000,
      });

      queue.recordTaskResult({
        taskId: 'test-2',
        success: false,
        executionTimeMs: 2000,
        error: new Error('Test error'),
      });

      queue.recordTaskResult({
        taskId: 'test-3',
        success: true,
        executionTimeMs: 1500,
      });

      const metrics = queue.getPerformanceMetrics();
      
      expect(metrics.totalTasksProcessed).toBe(3);
      expect(metrics.averageExecutionTime).toBe(1500); // (1000 + 2000 + 1500) / 3
      expect(metrics.successRate).toBeCloseTo(0.667, 2); // 2/3 successful
    });

    it('should track task history', () => {
      const results = [
        { taskId: 'task-1', success: true, executionTimeMs: 1000 },
        { taskId: 'task-2', success: false, executionTimeMs: 2000, error: new Error('Test') },
      ];

      results.forEach(result => queue.recordTaskResult(result));

      const history = queue.getTaskHistory();
      expect(history).toHaveLength(2);
      expect(history[0]).toBe(results[1]); // Most recent first
      expect(history[1]).toBe(results[0]);
    });

    it('should limit task history size', () => {
      // Record more than the default limit (1000)
      for (let i = 0; i < 1005; i++) {
        queue.recordTaskResult({
          taskId: `task-${i}`,
          success: true,
          executionTimeMs: 1000,
        });
      }

      const history = queue.getTaskHistory();
      expect(history.length).toBeLessThanOrEqual(1000);
    });
  });
});
