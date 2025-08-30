import React, { useState, useEffect, useCallback } from 'react';
import './BatchOperationManager.css';

// Interfaces for batch operations
interface BatchOperation {
  id: string;
  type: 'file-rename' | 'file-move' | 'directory-reorganize' | 'bulk-analysis';
  title: string;
  description?: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'paused' | 'cancelled';
  priority: 'low' | 'normal' | 'high' | 'urgent';
  progress: number; // 0-100
  totalItems: number;
  processedItems: number;
  failedItems: number;
  estimatedDuration?: number; // in milliseconds
  actualDuration?: number; // in milliseconds
  startTime?: Date;
  endTime?: Date;
  errorMessage?: string;
  configuration: OperationConfiguration;
}

interface OperationConfiguration {
  batchSize: number;
  maxConcurrency: number;
  enableParallel: boolean;
  autoRetry: boolean;
  retryAttempts: number;
  validateBeforeExecute: boolean;
  createBackup: boolean;
  notifyOnCompletion: boolean;
}

interface BatchOperationQueue {
  operations: BatchOperation[];
  totalOperations: number;
  activeOperations: number;
  completedOperations: number;
  failedOperations: number;
  queuedOperations: number;
}

interface OperationProgress {
  operationId: string;
  currentItem: string;
  progress: number;
  estimatedTimeRemaining?: number;
  throughputItems: number;
  throughputDuration: number;
}

interface BatchOperationManagerProps {
  className?: string;
  onOperationComplete?: (operation: BatchOperation) => void;
  onOperationFailed?: (operation: BatchOperation, error: string) => void;
  onQueueUpdated?: (queue: BatchOperationQueue) => void;
}

const BatchOperationManager: React.FC<BatchOperationManagerProps> = ({
  className = '',
  onOperationComplete,
  onOperationFailed,
  onQueueUpdated
}) => {
  const [operations, setOperations] = useState<BatchOperation[]>([]);
  const [queue, setQueue] = useState<BatchOperationQueue>({
    operations: [],
    totalOperations: 0,
    activeOperations: 0,
    completedOperations: 0,
    failedOperations: 0,
    queuedOperations: 0
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedOperation, setSelectedOperation] = useState<string | null>(null);
  const [showConfiguration, setShowConfiguration] = useState(false);
  const [sortBy, setSortBy] = useState<'priority' | 'status' | 'created' | 'duration'>('priority');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [refreshInterval, setRefreshInterval] = useState(1000); // 1 second

  // Default operation configuration
  const defaultConfiguration: OperationConfiguration = {
    batchSize: 50,
    maxConcurrency: 3,
    enableParallel: true,
    autoRetry: true,
    retryAttempts: 3,
    validateBeforeExecute: true,
    createBackup: true,
    notifyOnCompletion: true
  };

  // Load batch operations from IPC
  const loadOperations = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const response = await window.electronAPI.invoke('batch:getOperationQueue', {
        includeHistory: true,
        limit: 100
      });

      if (response.success) {
        setOperations(response.operations);
        setQueue(response.queue);
        onQueueUpdated?.(response.queue);
      } else {
        throw new Error(response.error || 'Failed to load batch operations');
      }
    } catch (err) {
      console.error('Error loading batch operations:', err);
      setError(err instanceof Error ? err.message : 'Failed to load operations');
    } finally {
      setLoading(false);
    }
  }, [onQueueUpdated]);

  // Subscribe to real-time operation updates
  useEffect(() => {
    if (!autoRefresh) return;

    const intervalId = setInterval(loadOperations, refreshInterval);
    
    // Subscribe to IPC events for real-time updates
    const unsubscribeProgress = window.electronAPI.on?.('batch:operationProgress', (data: OperationProgress) => {
      setOperations(prev => prev.map(op => {
        if (op.id === data.operationId) {
          return {
            ...op,
            progress: data.progress,
            processedItems: Math.floor(op.totalItems * data.progress / 100)
          };
        }
        return op;
      }));
    });

    const unsubscribeStatus = window.electronAPI.on?.('batch:operationStatusChanged', (data: { operationId: string; status: BatchOperation['status']; error?: string }) => {
      setOperations(prev => prev.map(op => {
        if (op.id === data.operationId) {
          const updatedOp = {
            ...op,
            status: data.status,
            endTime: data.status === 'completed' || data.status === 'failed' ? new Date() : op.endTime,
            errorMessage: data.error || op.errorMessage
          };

          // Trigger callbacks
          if (data.status === 'completed') {
            onOperationComplete?.(updatedOp);
          } else if (data.status === 'failed') {
            onOperationFailed?.(updatedOp, data.error || 'Operation failed');
          }

          return updatedOp;
        }
        return op;
      }));
    });

    return () => {
      clearInterval(intervalId);
      unsubscribeProgress?.();
      unsubscribeStatus?.();
    };
  }, [autoRefresh, refreshInterval, loadOperations, onOperationComplete, onOperationFailed]);

  // Initial load
  useEffect(() => {
    loadOperations();
  }, [loadOperations]);

  // Start an operation
  const startOperation = async (operationId: string) => {
    try {
      const response = await window.electronAPI.invoke('batch:startOperation', { operationId });
      if (!response.success) {
        throw new Error(response.error || 'Failed to start operation');
      }
      loadOperations(); // Refresh to get updated status
    } catch (err) {
      console.error('Error starting operation:', err);
      setError(err instanceof Error ? err.message : 'Failed to start operation');
    }
  };

  // Pause an operation
  const pauseOperation = async (operationId: string) => {
    try {
      const response = await window.electronAPI.invoke('batch:pauseOperation', { operationId });
      if (!response.success) {
        throw new Error(response.error || 'Failed to pause operation');
      }
      loadOperations();
    } catch (err) {
      console.error('Error pausing operation:', err);
      setError(err instanceof Error ? err.message : 'Failed to pause operation');
    }
  };

  // Cancel an operation
  const cancelOperation = async (operationId: string) => {
    try {
      const response = await window.electronAPI.invoke('batch:cancelOperation', { operationId });
      if (!response.success) {
        throw new Error(response.error || 'Failed to cancel operation');
      }
      loadOperations();
    } catch (err) {
      console.error('Error cancelling operation:', err);
      setError(err instanceof Error ? err.message : 'Failed to cancel operation');
    }
  };

  // Update operation priority
  const updatePriority = async (operationId: string, priority: BatchOperation['priority']) => {
    try {
      const response = await window.electronAPI.invoke('batch:updateOperationPriority', { 
        operationId, 
        priority 
      });
      if (!response.success) {
        throw new Error(response.error || 'Failed to update priority');
      }
      loadOperations();
    } catch (err) {
      console.error('Error updating priority:', err);
      setError(err instanceof Error ? err.message : 'Failed to update priority');
    }
  };

  // Create new batch operation
  const createOperation = async (type: BatchOperation['type'], config: Partial<OperationConfiguration> = {}) => {
    try {
      const finalConfig = { ...defaultConfiguration, ...config };
      const response = await window.electronAPI.invoke('batch:createOperation', {
        type,
        configuration: finalConfig
      });
      if (!response.success) {
        throw new Error(response.error || 'Failed to create operation');
      }
      loadOperations();
    } catch (err) {
      console.error('Error creating operation:', err);
      setError(err instanceof Error ? err.message : 'Failed to create operation');
    }
  };

  // Filter and sort operations
  const filteredOperations = operations
    .filter(op => filterStatus === 'all' || op.status === filterStatus)
    .sort((a, b) => {
      switch (sortBy) {
        case 'priority':
          const priorityOrder = { urgent: 4, high: 3, normal: 2, low: 1 };
          return priorityOrder[b.priority] - priorityOrder[a.priority];
        case 'status':
          return a.status.localeCompare(b.status);
        case 'created':
          return (b.startTime?.getTime() || 0) - (a.startTime?.getTime() || 0);
        case 'duration':
          return (b.actualDuration || 0) - (a.actualDuration || 0);
        default:
          return 0;
      }
    });

  // Format duration
  const formatDuration = (ms: number): string => {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${Math.round(ms / 1000)}s`;
    if (ms < 3600000) return `${Math.round(ms / 60000)}m`;
    return `${Math.round(ms / 3600000)}h`;
  };

  // Get status color
  const getStatusColor = (status: BatchOperation['status']): string => {
    switch (status) {
      case 'running': return '#007acc';
      case 'completed': return '#28a745';
      case 'failed': return '#dc3545';
      case 'paused': return '#ffc107';
      case 'cancelled': return '#6c757d';
      default: return '#17a2b8';
    }
  };

  // Get priority color
  const getPriorityColor = (priority: BatchOperation['priority']): string => {
    switch (priority) {
      case 'urgent': return '#dc3545';
      case 'high': return '#fd7e14';
      case 'normal': return '#007acc';
      case 'low': return '#6c757d';
      default: return '#6c757d';
    }
  };

  if (loading) {
    return (
      <div className={`batch-operation-manager loading ${className}`}>
        <div className="loading-spinner"></div>
        <span>Loading batch operations...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className={`batch-operation-manager error ${className}`}>
        <div className="error-content">
          <h3>Error Loading Batch Operations</h3>
          <p>{error}</p>
          <button onClick={loadOperations} className="retry-button">
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={`batch-operation-manager ${className}`}>
      {/* Header */}
      <div className="batch-manager-header">
        <div className="header-title">
          <h2>Batch Operations</h2>
          <div className="queue-stats">
            <span className="stat">
              <span className="stat-label">Active:</span>
              <span className="stat-value active">{queue.activeOperations}</span>
            </span>
            <span className="stat">
              <span className="stat-label">Queued:</span>
              <span className="stat-value queued">{queue.queuedOperations}</span>
            </span>
            <span className="stat">
              <span className="stat-label">Completed:</span>
              <span className="stat-value completed">{queue.completedOperations}</span>
            </span>
            {queue.failedOperations > 0 && (
              <span className="stat">
                <span className="stat-label">Failed:</span>
                <span className="stat-value failed">{queue.failedOperations}</span>
              </span>
            )}
          </div>
        </div>
        
        <div className="header-controls">
          <button
            onClick={() => setShowConfiguration(!showConfiguration)}
            className="config-button"
            title="Operation Configuration"
          >
            ⚙️ Configure
          </button>
          <button
            onClick={() => setAutoRefresh(!autoRefresh)}
            className={`refresh-button ${autoRefresh ? 'active' : ''}`}
            title={autoRefresh ? 'Disable Auto Refresh' : 'Enable Auto Refresh'}
          >
            🔄 {autoRefresh ? 'Auto' : 'Manual'}
          </button>
          <button
            onClick={loadOperations}
            className="refresh-now-button"
            title="Refresh Now"
          >
            ↻
          </button>
        </div>
      </div>

      {/* Filters and Controls */}
      <div className="batch-controls">
        <div className="filter-controls">
          <label>
            Filter:
            <select 
              value={filterStatus} 
              onChange={(e) => setFilterStatus(e.target.value)}
            >
              <option value="all">All Operations</option>
              <option value="pending">Pending</option>
              <option value="running">Running</option>
              <option value="completed">Completed</option>
              <option value="failed">Failed</option>
              <option value="paused">Paused</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </label>
          
          <label>
            Sort by:
            <select 
              value={sortBy} 
              onChange={(e) => setSortBy(e.target.value as any)}
            >
              <option value="priority">Priority</option>
              <option value="status">Status</option>
              <option value="created">Created</option>
              <option value="duration">Duration</option>
            </select>
          </label>
        </div>

        <div className="action-controls">
          <button
            onClick={() => createOperation('file-rename')}
            className="create-operation-button"
          >
            + New Rename Operation
          </button>
          <button
            onClick={() => createOperation('file-move')}
            className="create-operation-button"
          >
            + New Move Operation
          </button>
          <button
            onClick={() => createOperation('bulk-analysis')}
            className="create-operation-button"
          >
            + New Analysis Operation
          </button>
        </div>
      </div>

      {/* Configuration Panel */}
      {showConfiguration && (
        <div className="configuration-panel">
          <h3>Default Operation Configuration</h3>
          <div className="config-grid">
            <label>
              Batch Size:
              <input
                type="number"
                min="1"
                max="1000"
                defaultValue={defaultConfiguration.batchSize}
              />
            </label>
            <label>
              Max Concurrency:
              <input
                type="number"
                min="1"
                max="10"
                defaultValue={defaultConfiguration.maxConcurrency}
              />
            </label>
            <label>
              <input
                type="checkbox"
                defaultChecked={defaultConfiguration.enableParallel}
              />
              Enable Parallel Processing
            </label>
            <label>
              <input
                type="checkbox"
                defaultChecked={defaultConfiguration.autoRetry}
              />
              Auto Retry Failed Items
            </label>
            <label>
              Retry Attempts:
              <input
                type="number"
                min="0"
                max="10"
                defaultValue={defaultConfiguration.retryAttempts}
              />
            </label>
            <label>
              <input
                type="checkbox"
                defaultChecked={defaultConfiguration.validateBeforeExecute}
              />
              Validate Before Execute
            </label>
            <label>
              <input
                type="checkbox"
                defaultChecked={defaultConfiguration.createBackup}
              />
              Create Backup
            </label>
            <label>
              <input
                type="checkbox"
                defaultChecked={defaultConfiguration.notifyOnCompletion}
              />
              Notify on Completion
            </label>
          </div>
        </div>
      )}

      {/* Operations List */}
      <div className="operations-list">
        {filteredOperations.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">📋</div>
            <h3>No Batch Operations</h3>
            <p>
              {filterStatus === 'all' 
                ? 'No batch operations have been created yet.'
                : `No ${filterStatus} operations found.`}
            </p>
            <button
              onClick={() => createOperation('file-rename')}
              className="create-first-operation-button"
            >
              Create First Operation
            </button>
          </div>
        ) : (
          filteredOperations.map(operation => (
            <div
              key={operation.id}
              className={`operation-item ${operation.status} ${selectedOperation === operation.id ? 'selected' : ''}`}
              onClick={() => setSelectedOperation(operation.id)}
            >
              <div className="operation-header">
                <div className="operation-title">
                  <div className="operation-type-icon">
                    {operation.type === 'file-rename' && '📝'}
                    {operation.type === 'file-move' && '📁'}
                    {operation.type === 'directory-reorganize' && '🗂️'}
                    {operation.type === 'bulk-analysis' && '🔍'}
                  </div>
                  <div className="operation-info">
                    <h4>{operation.title}</h4>
                    {operation.description && (
                      <p className="operation-description">{operation.description}</p>
                    )}
                  </div>
                </div>
                
                <div className="operation-badges">
                  <span 
                    className="priority-badge"
                    style={{ backgroundColor: getPriorityColor(operation.priority) }}
                  >
                    {operation.priority}
                  </span>
                  <span 
                    className="status-badge"
                    style={{ backgroundColor: getStatusColor(operation.status) }}
                  >
                    {operation.status}
                  </span>
                </div>
              </div>

              <div className="operation-progress">
                <div className="progress-info">
                  <span className="progress-text">
                    {operation.processedItems} / {operation.totalItems} items
                    {operation.failedItems > 0 && ` (${operation.failedItems} failed)`}
                  </span>
                  <span className="progress-percentage">{operation.progress}%</span>
                </div>
                <div className="progress-bar">
                  <div 
                    className="progress-fill"
                    style={{ width: `${operation.progress}%` }}
                  />
                </div>
              </div>

              <div className="operation-actions">
                {operation.status === 'pending' && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      startOperation(operation.id);
                    }}
                    className="action-button start"
                  >
                    ▶️ Start
                  </button>
                )}
                
                {operation.status === 'running' && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      pauseOperation(operation.id);
                    }}
                    className="action-button pause"
                  >
                    ⏸️ Pause
                  </button>
                )}
                
                {operation.status === 'paused' && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      startOperation(operation.id);
                    }}
                    className="action-button resume"
                  >
                    ▶️ Resume
                  </button>
                )}
                
                {(operation.status === 'running' || operation.status === 'pending') && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      cancelOperation(operation.id);
                    }}
                    className="action-button cancel"
                  >
                    ❌ Cancel
                  </button>
                )}

                <select
                  value={operation.priority}
                  onChange={(e) => {
                    e.stopPropagation();
                    updatePriority(operation.id, e.target.value as BatchOperation['priority']);
                  }}
                  className="priority-selector"
                  onClick={(e) => e.stopPropagation()}
                >
                  <option value="low">Low Priority</option>
                  <option value="normal">Normal Priority</option>
                  <option value="high">High Priority</option>
                  <option value="urgent">Urgent Priority</option>
                </select>
              </div>

              {operation.errorMessage && (
                <div className="operation-error">
                  <span className="error-icon">⚠️</span>
                  <span className="error-text">{operation.errorMessage}</span>
                </div>
              )}

              <div className="operation-timing">
                {operation.startTime && (
                  <span className="timing-info">
                    Started: {operation.startTime.toLocaleTimeString()}
                  </span>
                )}
                {operation.actualDuration && (
                  <span className="timing-info">
                    Duration: {formatDuration(operation.actualDuration)}
                  </span>
                )}
                {operation.estimatedDuration && operation.status === 'running' && (
                  <span className="timing-info">
                    Est. remaining: {formatDuration(operation.estimatedDuration * (100 - operation.progress) / 100)}
                  </span>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default BatchOperationManager;
