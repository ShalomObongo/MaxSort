import React, { useState, useEffect, useCallback, useMemo } from 'react';
import './OperationHistory.css';

// Interfaces for operation history
interface HistoricalOperation {
  id: string;
  type: 'file-rename' | 'file-move' | 'directory-reorganize' | 'bulk-analysis' | 'batch-operation';
  title: string;
  description?: string;
  status: 'completed' | 'failed' | 'cancelled' | 'partially-completed';
  startTime: Date;
  endTime?: Date;
  duration?: number; // in milliseconds
  itemsProcessed: number;
  itemsTotal: number;
  itemsFailed: number;
  agentUsed?: string;
  modelUsed?: string;
  errorMessage?: string;
  metadata: OperationMetadata;
  canUndo: boolean;
  canRedo: boolean;
  undoComplexity: 'simple' | 'moderate' | 'complex' | 'risky';
  relatedOperations?: string[]; // IDs of related operations
}

interface OperationMetadata {
  directoryPath?: string;
  fileCount?: number;
  sizeProcessed?: number; // in bytes
  confidenceThreshold?: number;
  batchSize?: number;
  concurrency?: number;
  retryAttempts?: number;
  backupCreated: boolean;
  validationPerformed: boolean;
  checksumVerification: boolean;
}

interface UndoRedoOperation {
  operationId: string;
  type: 'undo' | 'redo';
  reason?: string;
  confirmationRequired: boolean;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  affectedFiles: string[];
  estimatedDuration: number;
  prerequisites: string[];
}

interface HistoryFilters {
  dateRange: 'today' | 'week' | 'month' | 'all' | 'custom';
  customStartDate?: Date;
  customEndDate?: Date;
  operationType: 'all' | 'file-rename' | 'file-move' | 'directory-reorganize' | 'bulk-analysis' | 'batch-operation';
  status: 'all' | 'completed' | 'failed' | 'cancelled' | 'partially-completed';
  searchText: string;
  sortBy: 'date' | 'type' | 'status' | 'duration' | 'items';
  sortOrder: 'asc' | 'desc';
  showUndoableOnly: boolean;
  showRedoableOnly: boolean;
}

interface AuditTrailEntry {
  id: string;
  timestamp: Date;
  operationId: string;
  action: string;
  user: string;
  details: Record<string, any>;
  systemState?: {
    memory: number;
    cpu: number;
    activeAgents: number;
  };
}

interface OperationHistoryProps {
  className?: string;
  onOperationUndo?: (operation: HistoricalOperation) => void;
  onOperationRedo?: (operation: HistoricalOperation) => void;
  onExportHistory?: (operations: HistoricalOperation[], format: 'json' | 'csv' | 'pdf') => void;
  showAuditTrail?: boolean;
  maxHistoryItems?: number;
}

const OperationHistory: React.FC<OperationHistoryProps> = ({
  className = '',
  onOperationUndo,
  onOperationRedo,
  onExportHistory,
  showAuditTrail = true,
  maxHistoryItems = 1000
}) => {
  const [operations, setOperations] = useState<HistoricalOperation[]>([]);
  const [auditTrail, setAuditTrail] = useState<AuditTrailEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedOperation, setSelectedOperation] = useState<string | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const [showUndoConfirmation, setShowUndoConfirmation] = useState<UndoRedoOperation | null>(null);
  const [filters, setFilters] = useState<HistoryFilters>({
    dateRange: 'all',
    operationType: 'all',
    status: 'all',
    searchText: '',
    sortBy: 'date',
    sortOrder: 'desc',
    showUndoableOnly: false,
    showRedoableOnly: false
  });

  // Load operation history from IPC
  const loadOperationHistory = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const response = await window.electronAPI.invoke('history:getOperations', {
        limit: maxHistoryItems,
        includeAuditTrail: showAuditTrail,
        filters: {
          dateRange: filters.dateRange,
          operationType: filters.operationType === 'all' ? undefined : filters.operationType,
          status: filters.status === 'all' ? undefined : filters.status,
          searchText: filters.searchText || undefined,
          showUndoableOnly: filters.showUndoableOnly,
          showRedoableOnly: filters.showRedoableOnly
        }
      });

      if (response.success) {
        setOperations(response.operations || []);
        if (showAuditTrail) {
          setAuditTrail(response.auditTrail || []);
        }
      } else {
        throw new Error(response.error || 'Failed to load operation history');
      }
    } catch (err) {
      console.error('Error loading operation history:', err);
      setError(err instanceof Error ? err.message : 'Failed to load history');
    } finally {
      setLoading(false);
    }
  }, [maxHistoryItems, showAuditTrail, filters]);

  // Initial load and refresh on filter changes
  useEffect(() => {
    loadOperationHistory();
  }, [loadOperationHistory]);

  // Subscribe to real-time history updates
  useEffect(() => {
    const unsubscribeHistoryUpdate = window.electronAPI.on?.('history:operationAdded', (operation: HistoricalOperation) => {
      setOperations(prev => [operation, ...prev.slice(0, maxHistoryItems - 1)]);
    });

    const unsubscribeAuditUpdate = window.electronAPI.on?.('history:auditTrailAdded', (entry: AuditTrailEntry) => {
      if (showAuditTrail) {
        setAuditTrail(prev => [entry, ...prev.slice(0, 999)]);
      }
    });

    return () => {
      unsubscribeHistoryUpdate?.();
      unsubscribeAuditUpdate?.();
    };
  }, [maxHistoryItems, showAuditTrail]);

  // Filter and sort operations
  const filteredOperations = useMemo(() => {
    let filtered = [...operations];

    // Apply text search
    if (filters.searchText) {
      const searchTerm = filters.searchText.toLowerCase();
      filtered = filtered.filter(op => 
        op.title.toLowerCase().includes(searchTerm) ||
        op.description?.toLowerCase().includes(searchTerm) ||
        op.metadata.directoryPath?.toLowerCase().includes(searchTerm) ||
        op.agentUsed?.toLowerCase().includes(searchTerm) ||
        op.modelUsed?.toLowerCase().includes(searchTerm)
      );
    }

    // Apply date range filter
    if (filters.dateRange !== 'all') {
      const now = new Date();
      let cutoffDate: Date | undefined;
      
      switch (filters.dateRange) {
        case 'today':
          cutoffDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
          break;
        case 'week':
          cutoffDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
          break;
        case 'month':
          cutoffDate = new Date(now.getFullYear(), now.getMonth(), 1);
          break;
        case 'custom':
          if (filters.customStartDate) {
            filtered = filtered.filter(op => {
              const opDate = new Date(op.startTime);
              const start = filters.customStartDate!;
              const end = filters.customEndDate || now;
              return opDate >= start && opDate <= end;
            });
          }
          break;
      }

      if (filters.dateRange !== 'custom' && cutoffDate) {
        filtered = filtered.filter(op => new Date(op.startTime) >= cutoffDate);
      }
    }

    // Apply undo/redo filters
    if (filters.showUndoableOnly) {
      filtered = filtered.filter(op => op.canUndo);
    }
    if (filters.showRedoableOnly) {
      filtered = filtered.filter(op => op.canRedo);
    }

    // Sort operations
    filtered.sort((a, b) => {
      let comparison = 0;
      
      switch (filters.sortBy) {
        case 'date':
          comparison = new Date(a.startTime).getTime() - new Date(b.startTime).getTime();
          break;
        case 'type':
          comparison = a.type.localeCompare(b.type);
          break;
        case 'status':
          comparison = a.status.localeCompare(b.status);
          break;
        case 'duration':
          comparison = (a.duration || 0) - (b.duration || 0);
          break;
        case 'items':
          comparison = a.itemsTotal - b.itemsTotal;
          break;
      }

      return filters.sortOrder === 'asc' ? comparison : -comparison;
    });

    return filtered;
  }, [operations, filters]);

  // Undo operation
  const initiateUndo = async (operation: HistoricalOperation) => {
    try {
      const response = await window.electronAPI.invoke('history:prepareUndo', {
        operationId: operation.id
      });

      if (response.success) {
        setShowUndoConfirmation(response.undoOperation);
      } else {
        throw new Error(response.error || 'Failed to prepare undo operation');
      }
    } catch (err) {
      console.error('Error preparing undo operation:', err);
      setError(err instanceof Error ? err.message : 'Failed to prepare undo');
    }
  };

  // Confirm and execute undo
  const confirmUndo = async (undoOp: UndoRedoOperation) => {
    try {
      const response = await window.electronAPI.invoke('history:executeUndo', {
        operationId: undoOp.operationId,
        reason: undoOp.reason
      });

      if (response.success) {
        const operation = operations.find(op => op.id === undoOp.operationId);
        if (operation) {
          onOperationUndo?.(operation);
        }
        setShowUndoConfirmation(null);
        loadOperationHistory(); // Refresh to show updated state
      } else {
        throw new Error(response.error || 'Failed to execute undo operation');
      }
    } catch (err) {
      console.error('Error executing undo operation:', err);
      setError(err instanceof Error ? err.message : 'Failed to execute undo');
    }
  };

  // Redo operation
  const initiateRedo = async (operation: HistoricalOperation) => {
    try {
      const response = await window.electronAPI.invoke('history:executeRedo', {
        operationId: operation.id
      });

      if (response.success) {
        onOperationRedo?.(operation);
        loadOperationHistory(); // Refresh to show updated state
      } else {
        throw new Error(response.error || 'Failed to redo operation');
      }
    } catch (err) {
      console.error('Error redoing operation:', err);
      setError(err instanceof Error ? err.message : 'Failed to redo operation');
    }
  };

  // Export history
  const handleExport = async (format: 'json' | 'csv' | 'pdf') => {
    try {
      const response = await window.electronAPI.invoke('history:exportOperations', {
        operations: filteredOperations.map(op => op.id),
        format,
        includeAuditTrail: showAuditTrail
      });

      if (response.success) {
        onExportHistory?.(filteredOperations, format);
      } else {
        throw new Error(response.error || 'Failed to export history');
      }
    } catch (err) {
      console.error('Error exporting history:', err);
      setError(err instanceof Error ? err.message : 'Failed to export history');
    }
  };

  // Format duration
  const formatDuration = (ms: number): string => {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${Math.round(ms / 1000)}s`;
    if (ms < 3600000) return `${Math.round(ms / 60000)}m`;
    return `${Math.round(ms / 3600000)}h`;
  };

  // Format file size
  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${Math.round(bytes / (1024 * 1024))} MB`;
    return `${Math.round(bytes / (1024 * 1024 * 1024))} GB`;
  };

  // Get status color
  const getStatusColor = (status: HistoricalOperation['status']): string => {
    switch (status) {
      case 'completed': return '#28a745';
      case 'failed': return '#dc3545';
      case 'cancelled': return '#6c757d';
      case 'partially-completed': return '#ffc107';
      default: return '#17a2b8';
    }
  };

  // Get risk level color
  const getRiskColor = (risk: UndoRedoOperation['riskLevel']): string => {
    switch (risk) {
      case 'low': return '#28a745';
      case 'medium': return '#ffc107';
      case 'high': return '#fd7e14';
      case 'critical': return '#dc3545';
      default: return '#6c757d';
    }
  };

  if (loading) {
    return (
      <div className={`operation-history loading ${className}`}>
        <div className="loading-spinner" data-testid="loading-spinner"></div>
        <span>Loading operation history...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className={`operation-history error ${className}`}>
        <div className="error-content">
          <h3>Error Loading Operation History</h3>
          <p>{error}</p>
          <button onClick={loadOperationHistory} className="retry-button">
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={`operation-history ${className}`}>
      {/* Header */}
      <div className="history-header">
        <div className="header-title">
          <h2>Operation History</h2>
          <div className="history-stats">
            <span className="stat">
              <span className="stat-label">Total:</span>
              <span className="stat-value">{operations.length}</span>
            </span>
            <span className="stat">
              <span className="stat-label">Shown:</span>
              <span className="stat-value">{filteredOperations.length}</span>
            </span>
            <span className="stat">
              <span className="stat-label">Undoable:</span>
              <span className="stat-value">{operations.filter(op => op.canUndo).length}</span>
            </span>
          </div>
        </div>

        <div className="header-controls">
          <button
            onClick={() => handleExport('json')}
            className="export-button"
            title="Export as JSON"
          >
            📄 JSON
          </button>
          <button
            onClick={() => handleExport('csv')}
            className="export-button"
            title="Export as CSV"
          >
            📊 CSV
          </button>
          <button
            onClick={() => handleExport('pdf')}
            className="export-button"
            title="Export as PDF"
          >
            📋 PDF
          </button>
          <button
            onClick={loadOperationHistory}
            className="refresh-button"
            title="Refresh History"
          >
            🔄 Refresh
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="history-filters">
        <div className="filter-row">
          <div className="filter-group">
            <label>
              Search:
              <input
                type="text"
                value={filters.searchText}
                onChange={(e) => setFilters(prev => ({ ...prev, searchText: e.target.value }))}
                placeholder="Search operations..."
                className="search-input"
              />
            </label>
          </div>

          <div className="filter-group">
            <label>
              Date Range:
              <select 
                value={filters.dateRange} 
                onChange={(e) => setFilters(prev => ({ ...prev, dateRange: e.target.value as any }))}
              >
                <option value="all">All Time</option>
                <option value="today">Today</option>
                <option value="week">Last Week</option>
                <option value="month">Last Month</option>
                <option value="custom">Custom Range</option>
              </select>
            </label>
          </div>

          <div className="filter-group">
            <label>
              Type:
              <select 
                value={filters.operationType} 
                onChange={(e) => setFilters(prev => ({ ...prev, operationType: e.target.value as any }))}
              >
                <option value="all">All Types</option>
                <option value="file-rename">File Rename</option>
                <option value="file-move">File Move</option>
                <option value="directory-reorganize">Directory Reorganize</option>
                <option value="bulk-analysis">Bulk Analysis</option>
                <option value="batch-operation">Batch Operation</option>
              </select>
            </label>
          </div>

          <div className="filter-group">
            <label>
              Status:
              <select 
                value={filters.status} 
                onChange={(e) => setFilters(prev => ({ ...prev, status: e.target.value as any }))}
              >
                <option value="all">All Status</option>
                <option value="completed">Completed</option>
                <option value="failed">Failed</option>
                <option value="cancelled">Cancelled</option>
                <option value="partially-completed">Partially Completed</option>
              </select>
            </label>
          </div>
        </div>

        <div className="filter-row">
          <div className="filter-group">
            <label>
              Sort by:
              <select 
                value={filters.sortBy} 
                onChange={(e) => setFilters(prev => ({ ...prev, sortBy: e.target.value as any }))}
              >
                <option value="date">Date</option>
                <option value="type">Type</option>
                <option value="status">Status</option>
                <option value="duration">Duration</option>
                <option value="items">Items Processed</option>
              </select>
            </label>
          </div>

          <div className="filter-group">
            <label>
              Order:
              <select 
                value={filters.sortOrder} 
                onChange={(e) => setFilters(prev => ({ ...prev, sortOrder: e.target.value as any }))}
              >
                <option value="desc">Newest First</option>
                <option value="asc">Oldest First</option>
              </select>
            </label>
          </div>

          <div className="filter-group checkbox-group">
            <label>
              <input
                type="checkbox"
                checked={filters.showUndoableOnly}
                onChange={(e) => setFilters(prev => ({ ...prev, showUndoableOnly: e.target.checked }))}
              />
              Undoable Only
            </label>
          </div>

          <div className="filter-group checkbox-group">
            <label>
              <input
                type="checkbox"
                checked={filters.showRedoableOnly}
                onChange={(e) => setFilters(prev => ({ ...prev, showRedoableOnly: e.target.checked }))}
              />
              Redoable Only
            </label>
          </div>
        </div>
      </div>

      {/* Custom Date Range */}
      {filters.dateRange === 'custom' && (
        <div className="custom-date-range">
          <label>
            Start Date:
            <input
              type="date"
              value={filters.customStartDate?.toISOString().split('T')[0] || ''}
              onChange={(e) => setFilters(prev => ({ 
                ...prev, 
                customStartDate: e.target.value ? new Date(e.target.value) : undefined 
              }))}
            />
          </label>
          <label>
            End Date:
            <input
              type="date"
              value={filters.customEndDate?.toISOString().split('T')[0] || ''}
              onChange={(e) => setFilters(prev => ({ 
                ...prev, 
                customEndDate: e.target.value ? new Date(e.target.value) : undefined 
              }))}
            />
          </label>
        </div>
      )}

      {/* Operations List */}
      <div className="operations-list">
        {filteredOperations.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">📜</div>
            <h3>No Operations Found</h3>
            <p>
              {filters.searchText || filters.dateRange !== 'all' || filters.operationType !== 'all' || filters.status !== 'all'
                ? 'No operations match your current filters.'
                : 'No operations have been recorded yet.'}
            </p>
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
                    {operation.type === 'batch-operation' && '⚡'}
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
                    className="status-badge"
                    style={{ backgroundColor: getStatusColor(operation.status) }}
                  >
                    {operation.status}
                  </span>
                  {operation.canUndo && (
                    <span className="undo-badge">Undoable</span>
                  )}
                  {operation.canRedo && (
                    <span className="redo-badge">Redoable</span>
                  )}
                </div>
              </div>

              <div className="operation-summary">
                <div className="summary-stats">
                  <span className="stat">
                    <strong>{operation.itemsProcessed}</strong> / {operation.itemsTotal} items
                  </span>
                  {operation.itemsFailed > 0 && (
                    <span className="stat failed">
                      <strong>{operation.itemsFailed}</strong> failed
                    </span>
                  )}
                  {operation.duration && (
                    <span className="stat">
                      Duration: <strong>{formatDuration(operation.duration)}</strong>
                    </span>
                  )}
                  {operation.metadata.sizeProcessed && (
                    <span className="stat">
                      Size: <strong>{formatFileSize(operation.metadata.sizeProcessed)}</strong>
                    </span>
                  )}
                </div>

                <div className="operation-timestamp">
                  <time dateTime={operation.startTime.toISOString()}>
                    {operation.startTime.toLocaleString()}
                  </time>
                </div>
              </div>

              <div className="operation-actions">
                {operation.canUndo && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      initiateUndo(operation);
                    }}
                    className="action-button undo"
                  >
                    ↶ Undo
                  </button>
                )}
                
                {operation.canRedo && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      initiateRedo(operation);
                    }}
                    className="action-button redo"
                  >
                    ↷ Redo
                  </button>
                )}

                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowDetails(selectedOperation === operation.id ? !showDetails : true);
                    setSelectedOperation(operation.id);
                  }}
                  className="action-button details"
                >
                  📋 Details
                </button>
              </div>

              {operation.errorMessage && (
                <div className="operation-error">
                  <span className="error-icon">⚠️</span>
                  <span className="error-text">{operation.errorMessage}</span>
                </div>
              )}

              {/* Detailed information panel */}
              {selectedOperation === operation.id && showDetails && (
                <div className="operation-details">
                  <div className="details-grid">
                    <div className="detail-section">
                      <h5>Operation Details</h5>
                      <dl>
                        <dt>ID:</dt>
                        <dd>{operation.id}</dd>
                        <dt>Type:</dt>
                        <dd>{operation.type}</dd>
                        <dt>Status:</dt>
                        <dd>{operation.status}</dd>
                        {operation.agentUsed && (
                          <>
                            <dt>Agent:</dt>
                            <dd>{operation.agentUsed}</dd>
                          </>
                        )}
                        {operation.modelUsed && (
                          <>
                            <dt>Model:</dt>
                            <dd>{operation.modelUsed}</dd>
                          </>
                        )}
                        <dt>Undo Complexity:</dt>
                        <dd>{operation.undoComplexity}</dd>
                      </dl>
                    </div>

                    <div className="detail-section">
                      <h5>Processing Stats</h5>
                      <dl>
                        <dt>Items Total:</dt>
                        <dd>{operation.itemsTotal}</dd>
                        <dt>Items Processed:</dt>
                        <dd>{operation.itemsProcessed}</dd>
                        <dt>Items Failed:</dt>
                        <dd>{operation.itemsFailed}</dd>
                        <dt>Success Rate:</dt>
                        <dd>{Math.round((operation.itemsProcessed - operation.itemsFailed) / operation.itemsTotal * 100)}%</dd>
                      </dl>
                    </div>

                    <div className="detail-section">
                      <h5>Configuration</h5>
                      <dl>
                        {operation.metadata.directoryPath && (
                          <>
                            <dt>Directory:</dt>
                            <dd>{operation.metadata.directoryPath}</dd>
                          </>
                        )}
                        {operation.metadata.confidenceThreshold && (
                          <>
                            <dt>Confidence:</dt>
                            <dd>{operation.metadata.confidenceThreshold}%</dd>
                          </>
                        )}
                        {operation.metadata.batchSize && (
                          <>
                            <dt>Batch Size:</dt>
                            <dd>{operation.metadata.batchSize}</dd>
                          </>
                        )}
                        {operation.metadata.concurrency && (
                          <>
                            <dt>Concurrency:</dt>
                            <dd>{operation.metadata.concurrency}</dd>
                          </>
                        )}
                        <dt>Backup Created:</dt>
                        <dd>{operation.metadata.backupCreated ? 'Yes' : 'No'}</dd>
                        <dt>Validation:</dt>
                        <dd>{operation.metadata.validationPerformed ? 'Yes' : 'No'}</dd>
                      </dl>
                    </div>
                  </div>

                  {operation.relatedOperations && operation.relatedOperations.length > 0 && (
                    <div className="related-operations">
                      <h5>Related Operations</h5>
                      <ul>
                        {operation.relatedOperations.map(relatedId => (
                          <li key={relatedId}>
                            <button 
                              onClick={() => setSelectedOperation(relatedId)}
                              className="related-operation-link"
                            >
                              {relatedId}
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {/* Undo Confirmation Modal */}
      {showUndoConfirmation && (
        <div className="modal-overlay">
          <div className="confirmation-modal">
            <div className="modal-header">
              <h3>Confirm Undo Operation</h3>
              <button
                onClick={() => setShowUndoConfirmation(null)}
                className="close-button"
              >
                ✕
              </button>
            </div>
            
            <div className="modal-content">
              <div className="risk-indicator" style={{ borderLeftColor: getRiskColor(showUndoConfirmation.riskLevel) }}>
                <h4>Risk Level: {showUndoConfirmation.riskLevel.toUpperCase()}</h4>
                <p>This operation will affect <strong>{showUndoConfirmation.affectedFiles.length}</strong> files.</p>
                <p>Estimated duration: <strong>{formatDuration(showUndoConfirmation.estimatedDuration)}</strong></p>
              </div>

              {showUndoConfirmation.prerequisites.length > 0 && (
                <div className="prerequisites">
                  <h5>Prerequisites:</h5>
                  <ul>
                    {showUndoConfirmation.prerequisites.map((prereq, index) => (
                      <li key={index}>{prereq}</li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="affected-files">
                <h5>Affected Files ({showUndoConfirmation.affectedFiles.length}):</h5>
                <div className="file-list">
                  {showUndoConfirmation.affectedFiles.slice(0, 10).map((file, index) => (
                    <div key={index} className="affected-file">{file}</div>
                  ))}
                  {showUndoConfirmation.affectedFiles.length > 10 && (
                    <div className="file-count-more">
                      ... and {showUndoConfirmation.affectedFiles.length - 10} more files
                    </div>
                  )}
                </div>
              </div>

              <div className="reason-input">
                <label>
                  Reason for undo (optional):
                  <textarea
                    value={showUndoConfirmation.reason || ''}
                    onChange={(e) => setShowUndoConfirmation(prev => prev ? { ...prev, reason: e.target.value } : null)}
                    placeholder="Describe why you're undoing this operation..."
                    rows={3}
                  />
                </label>
              </div>
            </div>

            <div className="modal-actions">
              <button
                onClick={() => setShowUndoConfirmation(null)}
                className="cancel-button"
              >
                Cancel
              </button>
              <button
                onClick={() => confirmUndo(showUndoConfirmation)}
                className={`confirm-button ${showUndoConfirmation.riskLevel}`}
              >
                {showUndoConfirmation.riskLevel === 'critical' ? '⚠️ ' : ''}
                Confirm Undo
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Audit Trail Panel */}
      {showAuditTrail && auditTrail.length > 0 && (
        <div className="audit-trail">
          <h3>Audit Trail</h3>
          <div className="audit-entries">
            {auditTrail.slice(0, 50).map(entry => (
              <div key={entry.id} className="audit-entry">
                <div className="audit-header">
                  <time dateTime={entry.timestamp.toISOString()}>
                    {entry.timestamp.toLocaleString()}
                  </time>
                  <span className="audit-action">{entry.action}</span>
                  <span className="audit-user">{entry.user}</span>
                </div>
                <div className="audit-details">
                  {Object.entries(entry.details).map(([key, value]) => (
                    <span key={key} className="audit-detail">
                      <strong>{key}:</strong> {String(value)}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default OperationHistory;
