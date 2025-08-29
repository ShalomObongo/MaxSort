/**
 * Task priority levels for agent execution
 */
export enum TaskPriority {
  CRITICAL = 0,    // Emergency tasks, system health
  HIGH = 1,        // Interactive user requests  
  NORMAL = 2,      // Scheduled batch operations
  LOW = 3,         // Background processing
  BACKGROUND = 4   // Lowest priority maintenance
}

/**
 * Task execution states
 */
export enum TaskState {
  QUEUED = 'queued',
  RUNNING = 'running', 
  COMPLETED = 'completed',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
  TIMEOUT = 'timeout'
}

/**
 * Base interface for all agent tasks
 */
export interface AgentTaskBase {
  id: string;
  type: string;
  priority: TaskPriority;
  state: TaskState;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  timeoutMs: number;
  retryCount: number;
  maxRetries: number;
  metadata: Record<string, any>;
  estimatedMemoryMB: number;
}

/**
 * File analysis task for Ollama model inference
 */
export interface FileAnalysisTask extends AgentTaskBase {
  type: 'file-analysis';
  filePath: string;
  modelName: string;
  analysisType: 'classification' | 'summary' | 'extraction';
  promptTemplate: string;
  expectedResponseFormat: 'json' | 'text';
}

/**
 * Batch file processing task
 */
export interface BatchProcessingTask extends AgentTaskBase {
  type: 'batch-processing';
  filePaths: string[];
  modelName: string;
  batchSize: number;
  processingMode: 'parallel' | 'sequential';
}

/**
 * System health monitoring task
 */
export interface HealthCheckTask extends AgentTaskBase {
  type: 'health-check';
  component: 'ollama' | 'database' | 'filesystem';
  checkInterval: number;
}

/**
 * Union type for all supported task types
 */
export type AgentTask = FileAnalysisTask | BatchProcessingTask | HealthCheckTask;

/**
 * Task creation parameters (before ID assignment)
 */
export type CreateTaskParams<T extends AgentTask> = Omit<T, 'id' | 'state' | 'createdAt' | 'startedAt' | 'completedAt' | 'retryCount'>;

/**
 * Task execution result
 */
export interface TaskResult {
  taskId: string;
  success: boolean;
  result?: any;
  error?: Error;
  executionTimeMs: number;
  memoryUsedMB?: number;
}

/**
 * Queue statistics for monitoring
 */
export interface QueueStats {
  total: number;
  byPriority: Record<TaskPriority, number>;
  byState: Record<TaskState, number>;
  oldestQueuedTask?: number; // Timestamp of oldest queued task
  averageWaitTime?: number;  // Average wait time in ms
}

/**
 * Agent slot allocation information
 */
export interface AgentSlot {
  slotId: string;
  taskId: string;
  modelName: string;
  allocatedMemoryMB: number;
  startTime: number;
  isActive: boolean;
}
