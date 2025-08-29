import { AgentTask, TaskPriority, TaskState, QueueStats, TaskResult } from './task-types';

/**
 * Priority-based task queue with FIFO ordering within priority levels
 */
export class PriorityQueue {
  // Separate queues for each priority level
  private queues: Map<TaskPriority, AgentTask[]> = new Map();
  private completedTasks: TaskResult[] = [];
  private maxCompletedHistory: number = 1000;

  constructor() {
    // Initialize empty queues for each priority level
    Object.values(TaskPriority).forEach(priority => {
      if (typeof priority === 'number') {
        this.queues.set(priority, []);
      }
    });
  }

  /**
   * Add task to appropriate priority queue
   */
  public enqueue(task: AgentTask): void {
    const queue = this.queues.get(task.priority);
    if (!queue) {
      throw new Error(`Invalid priority level: ${task.priority}`);
    }

    // Insert task maintaining FIFO order within priority
    queue.push(task);

    console.log(`Task ${task.id} enqueued with priority ${TaskPriority[task.priority]} (queue size: ${queue.length})`);
  }

  /**
   * Get next highest priority task from queues
   */
  public dequeue(): AgentTask | null {
    // Check queues in priority order (lowest number = highest priority)
    const priorities = Array.from(this.queues.keys()).sort((a, b) => a - b);
    
    for (const priority of priorities) {
      const queue = this.queues.get(priority)!;
      const task = queue.find(t => t.state === TaskState.QUEUED);
      
      if (task) {
        // Remove from queue but keep reference for state tracking
        const index = queue.indexOf(task);
        queue.splice(index, 1);
        
        console.log(`Task ${task.id} dequeued from priority ${TaskPriority[priority]} queue`);
        return task;
      }
    }

    return null; // No queued tasks available
  }

  /**
   * Peek at next task without removing it
   */
  public peek(): AgentTask | null {
    const priorities = Array.from(this.queues.keys()).sort((a, b) => a - b);
    
    for (const priority of priorities) {
      const queue = this.queues.get(priority)!;
      const task = queue.find(t => t.state === TaskState.QUEUED);
      if (task) return task;
    }

    return null;
  }

  /**
   * Get task by ID across all queues and states
   */
  public getTask(taskId: string): AgentTask | null {
    for (const queue of this.queues.values()) {
      const task = queue.find(t => t.id === taskId);
      if (task) return task;
    }
    return null;
  }

  /**
   * Update task state
   */
  public updateTaskState(taskId: string, newState: TaskState, completedAt?: number): boolean {
    const task = this.getTask(taskId);
    if (!task) return false;

    const oldState = task.state;
    task.state = newState;

    if (completedAt && (newState === TaskState.COMPLETED || newState === TaskState.FAILED || newState === TaskState.CANCELLED)) {
      task.completedAt = completedAt;
    }

    if (newState === TaskState.RUNNING && !task.startedAt) {
      task.startedAt = Date.now();
    }

    console.log(`Task ${taskId} state changed: ${oldState} → ${newState}`);
    return true;
  }

  /**
   * Cancel a task (mark as cancelled and remove from execution)
   */
  public cancelTask(taskId: string): boolean {
    const task = this.getTask(taskId);
    if (!task) return false;

    // Only cancel if not already completed
    if (task.state !== TaskState.COMPLETED && task.state !== TaskState.FAILED) {
      task.state = TaskState.CANCELLED;
      task.completedAt = Date.now();
      
      console.log(`Task ${taskId} cancelled`);
      return true;
    }

    return false;
  }

  /**
   * Get all tasks matching criteria
   */
  public getTasks(filter: {
    state?: TaskState;
    priority?: TaskPriority;
    type?: string;
  } = {}): AgentTask[] {
    const allTasks: AgentTask[] = [];
    
    for (const queue of this.queues.values()) {
      allTasks.push(...queue);
    }

    return allTasks.filter(task => {
      if (filter.state && task.state !== filter.state) return false;
      if (filter.priority && task.priority !== filter.priority) return false;
      if (filter.type && task.type !== filter.type) return false;
      return true;
    });
  }

  /**
   * Get queue statistics for monitoring
   */
  public getStats(): QueueStats {
    const allTasks = this.getTasks();
    
    const stats: QueueStats = {
      total: allTasks.length,
      byPriority: {} as Record<TaskPriority, number>,
      byState: {} as Record<TaskState, number>
    };

    // Initialize counters
    Object.values(TaskPriority).forEach(priority => {
      if (typeof priority === 'number') {
        stats.byPriority[priority] = 0;
      }
    });

    Object.values(TaskState).forEach(state => {
      stats.byState[state] = 0;
    });

    // Count tasks
    allTasks.forEach(task => {
      stats.byPriority[task.priority]++;
      stats.byState[task.state]++;
    });

    // Calculate wait time statistics for queued tasks
    const queuedTasks = allTasks.filter(t => t.state === TaskState.QUEUED);
    if (queuedTasks.length > 0) {
      const now = Date.now();
      const waitTimes = queuedTasks.map(t => now - t.createdAt);
      stats.oldestQueuedTask = Math.min(...queuedTasks.map(t => t.createdAt));
      stats.averageWaitTime = waitTimes.reduce((sum, time) => sum + time, 0) / waitTimes.length;
    }

    return stats;
  }

  /**
   * Get tasks that are currently running
   */
  public getRunningTasks(): AgentTask[] {
    return this.getTasks({ state: TaskState.RUNNING });
  }

  /**
   * Get queued tasks ordered by priority
   */
  public getQueuedTasks(): AgentTask[] {
    const queuedTasks = this.getTasks({ state: TaskState.QUEUED });
    return queuedTasks.sort((a, b) => {
      // Sort by priority first, then by creation time (FIFO within priority)
      if (a.priority !== b.priority) {
        return a.priority - b.priority;
      }
      return a.createdAt - b.createdAt;
    });
  }

  /**
   * Clear completed tasks older than specified age
   */
  public cleanupCompletedTasks(maxAgeMs: number = 24 * 60 * 60 * 1000): number { // Default 24 hours
    const cutoffTime = Date.now() - maxAgeMs;
    let removedCount = 0;

    for (const queue of this.queues.values()) {
      const initialLength = queue.length;
      
      // Keep only tasks that are not old completed tasks
      queue.splice(0, queue.length, ...queue.filter(task => {
        const isOldCompleted = (
          (task.state === TaskState.COMPLETED || 
           task.state === TaskState.FAILED || 
           task.state === TaskState.CANCELLED) &&
          task.completedAt && 
          task.completedAt < cutoffTime
        );
        
        if (isOldCompleted) removedCount++;
        return !isOldCompleted;
      }));
    }

    if (removedCount > 0) {
      console.log(`Cleaned up ${removedCount} old completed tasks`);
    }

    return removedCount;
  }

  /**
   * Record completed task result for history tracking
   */
  public recordTaskResult(result: TaskResult): void {
    this.completedTasks.push(result);
    
    // Keep only recent results
    if (this.completedTasks.length > this.maxCompletedHistory) {
      this.completedTasks.shift();
    }
  }

  /**
   * Get task execution history
   */
  public getTaskHistory(limit?: number): TaskResult[] {
    const results = [...this.completedTasks].reverse(); // Most recent first
    return limit ? results.slice(0, limit) : results;
  }

  /**
   * Get performance metrics
   */
  public getPerformanceMetrics(): {
    averageExecutionTime: number;
    successRate: number;
    tasksCompletedLast24h: number;
    totalTasksProcessed: number;
  } {
    const last24h = Date.now() - (24 * 60 * 60 * 1000);
    const recentResults = this.completedTasks.filter(r => r.executionTimeMs && Date.now() - r.executionTimeMs < last24h);
    
    const totalExecutionTime = this.completedTasks.reduce((sum, result) => sum + (result.executionTimeMs || 0), 0);
    const successfulTasks = this.completedTasks.filter(r => r.success).length;
    
    return {
      averageExecutionTime: this.completedTasks.length > 0 ? totalExecutionTime / this.completedTasks.length : 0,
      successRate: this.completedTasks.length > 0 ? successfulTasks / this.completedTasks.length : 0,
      tasksCompletedLast24h: recentResults.length,
      totalTasksProcessed: this.completedTasks.length,
    };
  }

  /**
   * Get queue size for specific priority
   */
  public getQueueSize(priority?: TaskPriority): number {
    if (priority !== undefined) {
      const queue = this.queues.get(priority);
      return queue ? queue.filter(t => t.state === TaskState.QUEUED).length : 0;
    }

    // Return total queued tasks across all priorities
    let total = 0;
    for (const queue of this.queues.values()) {
      total += queue.filter(t => t.state === TaskState.QUEUED).length;
    }
    return total;
  }

  /**
   * Clear all tasks (useful for testing or emergency stops)
   */
  public clear(): void {
    for (const queue of this.queues.values()) {
      queue.length = 0;
    }
    this.completedTasks.length = 0;
    console.log('All task queues cleared');
  }
}
