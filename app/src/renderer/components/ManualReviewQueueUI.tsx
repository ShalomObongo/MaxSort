import React, { useState, useEffect, useMemo } from 'react';
import { 
    ManualReviewQueue, 
    ReviewQueueEntry, 
    QueueStats,
    ManualReviewQueueConfig 
} from '../../lib/manual-review-queue';
import './ManualReviewQueueUI.css';

interface ManualReviewQueueUIProps {
    queue: ManualReviewQueue;
    onProcessDecision?: (entryId: string, decision: 'approve' | 'reject', reason: string) => void;
    onBatchReview?: (decisions: Array<{ entryId: string; decision: 'approve' | 'reject'; reason: string; }>) => void;
}

interface FilterOptions {
    sortBy: 'priority' | 'confidence' | 'addedAt';
    sortOrder: 'asc' | 'desc';
    minConfidence: number;
    maxConfidence: number;
    operationType: string;
    showOnlyPending: boolean;
}

interface BatchSelection {
    [entryId: string]: {
        selected: boolean;
        decision: 'approve' | 'reject' | '';
        reason: string;
    };
}

export const ManualReviewQueueUI: React.FC<ManualReviewQueueUIProps> = ({ 
    queue, 
    onProcessDecision, 
    onBatchReview 
}) => {
    const [queueEntries, setQueueEntries] = useState<ReviewQueueEntry[]>([]);
    const [stats, setStats] = useState<QueueStats | null>(null);
    const [filterOptions, setFilterOptions] = useState<FilterOptions>({
        sortBy: 'priority',
        sortOrder: 'desc',
        minConfidence: 0,
        maxConfidence: 100,
        operationType: '',
        showOnlyPending: true
    });
    const [batchSelection, setBatchSelection] = useState<BatchSelection>({});
    const [showBatchMode, setShowBatchMode] = useState(false);
    const [selectedEntry, setSelectedEntry] = useState<ReviewQueueEntry | null>(null);
    const [reviewDecision, setReviewDecision] = useState<'approve' | 'reject' | ''>('');
    const [reviewReason, setReviewReason] = useState('');

    // Load queue data
    const loadQueueData = () => {
        try {
            const entries = queue.getPendingItems({
                sortBy: filterOptions.sortBy,
                sortOrder: filterOptions.sortOrder,
                filterBy: {
                    minConfidence: filterOptions.minConfidence / 100,
                    maxConfidence: filterOptions.maxConfidence / 100,
                    operationType: filterOptions.operationType || undefined,
                }
            });
            
            setQueueEntries(filterOptions.showOnlyPending 
                ? entries.filter(e => e.status === 'pending')
                : entries
            );
            
            setStats(queue.getQueueStats());
        } catch (error) {
            console.error('Failed to load queue data:', error);
        }
    };

    useEffect(() => {
        loadQueueData();
    }, [filterOptions, queue]);

    // Handle single decision
    const handleSingleDecision = async () => {
        if (!selectedEntry || !reviewDecision || !reviewReason.trim()) {
            return;
        }

        try {
            await queue.processReviewDecision(
                selectedEntry.id, 
                { 
                    action: reviewDecision, 
                    reason: reviewReason, 
                    appliedAt: new Date() 
                },
                'current-user', // TODO: Get actual user ID
                reviewReason
            );

            if (onProcessDecision) {
                onProcessDecision(selectedEntry.id, reviewDecision, reviewReason);
            }

            // Reset form and reload data
            setSelectedEntry(null);
            setReviewDecision('');
            setReviewReason('');
            loadQueueData();
        } catch (error) {
            console.error('Failed to process review decision:', error);
        }
    };

    // Handle batch review
    const handleBatchReview = async () => {
        const decisions = Object.entries(batchSelection)
            .filter(([_, selection]) => selection.selected && selection.decision && selection.reason.trim())
            .map(([entryId, selection]) => ({
                entryId,
                decision: {
                    action: selection.decision as 'approve' | 'reject',
                    reason: selection.reason,
                    appliedAt: new Date()
                },
                notes: selection.reason
            }));

        if (decisions.length === 0) {
            return;
        }

        try {
            await queue.processBatchReview(decisions, 'current-user'); // TODO: Get actual user ID
            
            if (onBatchReview) {
                onBatchReview(decisions.map(d => ({
                    entryId: d.entryId,
                    decision: d.decision.action,
                    reason: d.decision.reason
                })));
            }

            // Reset batch selection and reload data
            setBatchSelection({});
            loadQueueData();
        } catch (error) {
            console.error('Failed to process batch review:', error);
        }
    };

    // Update batch selection
    const updateBatchSelection = (entryId: string, updates: Partial<BatchSelection[string]>) => {
        setBatchSelection(prev => ({
            ...prev,
            [entryId]: {
                ...prev[entryId],
                ...updates
            }
        }));
    };

    // Get selected batch count
    const selectedBatchCount = Object.values(batchSelection).filter(s => s?.selected).length;

    // Memoized confidence color helper
    const getConfidenceColor = useMemo(() => (confidence: number) => {
        if (confidence >= 0.8) return '#10b981'; // green
        if (confidence >= 0.6) return '#f59e0b'; // amber
        return '#ef4444'; // red
    }, []);

    const formatDate = (date: Date) => {
        return new Intl.DateTimeFormat('en-US', {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        }).format(date);
    };

    const formatDuration = (ms: number) => {
        const minutes = Math.floor(ms / (1000 * 60));
        const hours = Math.floor(minutes / 60);
        const days = Math.floor(hours / 24);
        
        if (days > 0) return `${days}d ${hours % 24}h`;
        if (hours > 0) return `${hours}h ${minutes % 60}m`;
        return `${minutes}m`;
    };

    return (
        <div className="manual-review-queue">
            <div className="review-queue-header">
                <h2>Manual Review Queue</h2>
                
                {/* Queue Statistics */}
                {stats && (
                    <div className="queue-stats">
                        <div className="stat-item">
                            <span className="stat-label">Total:</span>
                            <span className="stat-value">{stats.totalItems}</span>
                        </div>
                        <div className="stat-item">
                            <span className="stat-label">Pending:</span>
                            <span className="stat-value">{stats.pendingItems}</span>
                        </div>
                        <div className="stat-item">
                            <span className="stat-label">Avg Confidence:</span>
                            <span className="stat-value">{(stats.averageConfidence * 100).toFixed(1)}%</span>
                        </div>
                        {stats.oldestEntryAge > 0 && (
                            <div className="stat-item">
                                <span className="stat-label">Oldest:</span>
                                <span className="stat-value">{formatDuration(stats.oldestEntryAge)}</span>
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* Filter Controls */}
            <div className="filter-controls">
                <div className="filter-group">
                    <label>Sort by:</label>
                    <select 
                        value={filterOptions.sortBy} 
                        onChange={(e) => setFilterOptions(prev => ({
                            ...prev, 
                            sortBy: e.target.value as FilterOptions['sortBy']
                        }))}
                    >
                        <option value="priority">Priority</option>
                        <option value="confidence">Confidence</option>
                        <option value="addedAt">Date Added</option>
                    </select>
                    
                    <select 
                        value={filterOptions.sortOrder} 
                        onChange={(e) => setFilterOptions(prev => ({
                            ...prev, 
                            sortOrder: e.target.value as FilterOptions['sortOrder']
                        }))}
                    >
                        <option value="desc">Descending</option>
                        <option value="asc">Ascending</option>
                    </select>
                </div>

                <div className="filter-group">
                    <label>Confidence Range:</label>
                    <input
                        type="range"
                        min="0"
                        max="100"
                        value={filterOptions.minConfidence}
                        onChange={(e) => setFilterOptions(prev => ({
                            ...prev,
                            minConfidence: parseInt(e.target.value)
                        }))}
                    />
                    <span>{filterOptions.minConfidence}%</span>
                    <span>to</span>
                    <input
                        type="range"
                        min="0"
                        max="100"
                        value={filterOptions.maxConfidence}
                        onChange={(e) => setFilterOptions(prev => ({
                            ...prev,
                            maxConfidence: parseInt(e.target.value)
                        }))}
                    />
                    <span>{filterOptions.maxConfidence}%</span>
                </div>

                <div className="filter-group">
                    <label>Operation:</label>
                    <input
                        type="text"
                        placeholder="Filter by operation type..."
                        value={filterOptions.operationType}
                        onChange={(e) => setFilterOptions(prev => ({
                            ...prev,
                            operationType: e.target.value
                        }))}
                    />
                </div>

                <div className="filter-group">
                    <label>
                        <input
                            type="checkbox"
                            checked={filterOptions.showOnlyPending}
                            onChange={(e) => setFilterOptions(prev => ({
                                ...prev,
                                showOnlyPending: e.target.checked
                            }))}
                        />
                        Show only pending
                    </label>
                </div>
            </div>

            {/* Batch Mode Toggle */}
            <div className="batch-controls">
                <button
                    className={`batch-toggle ${showBatchMode ? 'active' : ''}`}
                    onClick={() => setShowBatchMode(!showBatchMode)}
                >
                    {showBatchMode ? 'Exit Batch Mode' : 'Batch Review Mode'}
                </button>
                
                {showBatchMode && selectedBatchCount > 0 && (
                    <button
                        className="batch-process-btn"
                        onClick={handleBatchReview}
                    >
                        Process {selectedBatchCount} Selected Items
                    </button>
                )}
            </div>

            {/* Queue Entries */}
            <div className="queue-entries">
                {queueEntries.length === 0 ? (
                    <div className="no-entries">
                        <p>No entries match the current filters.</p>
                    </div>
                ) : (
                    queueEntries.map(entry => (
                        <div 
                            key={entry.id} 
                            className={`queue-entry ${entry.status} ${selectedEntry?.id === entry.id ? 'selected' : ''}`}
                        >
                            {showBatchMode && (
                                <div className="batch-checkbox">
                                    <input
                                        type="checkbox"
                                        checked={batchSelection[entry.id]?.selected || false}
                                        onChange={(e) => updateBatchSelection(entry.id, {
                                            selected: e.target.checked,
                                            decision: '',
                                            reason: ''
                                        })}
                                    />
                                </div>
                            )}

                            <div className="entry-details">
                                <div className="entry-header">
                                    <div className="path-info">
                                        <strong>{entry.suggestion.originalPath}</strong>
                                        {entry.suggestion.suggestedPath && (
                                            <>
                                                <span className="arrow"> → </span>
                                                <span className="suggested-path">{entry.suggestion.suggestedPath}</span>
                                            </>
                                        )}
                                    </div>
                                    
                                    <div className="entry-meta">
                                        <span 
                                            className="confidence-badge"
                                            style={{ backgroundColor: getConfidenceColor(entry.suggestion.confidence) }}
                                        >
                                            {(entry.suggestion.confidence * 100).toFixed(1)}%
                                        </span>
                                        <span className="priority">Priority: {entry.priority}</span>
                                        <span className="date">{formatDate(entry.addedAt)}</span>
                                    </div>
                                </div>

                                <div className="entry-content">
                                    <div className="operation-type">
                                        <strong>Operation:</strong> {entry.suggestion.operation}
                                    </div>
                                    
                                    {entry.suggestion.reason && (
                                        <div className="reason">
                                            <strong>Reason:</strong> {entry.suggestion.reason}
                                        </div>
                                    )}

                                    {entry.status === 'reviewed' && entry.decision && (
                                        <div className={`decision ${entry.decision.action}`}>
                                            <strong>Decision:</strong> {entry.decision.action}
                                            <span className="decision-reason"> - {entry.decision.reason}</span>
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* Single Review Controls */}
                            {!showBatchMode && entry.status === 'pending' && (
                                <div className="review-controls">
                                    <button
                                        className={`review-btn ${selectedEntry?.id === entry.id ? 'active' : ''}`}
                                        onClick={() => setSelectedEntry(selectedEntry?.id === entry.id ? null : entry)}
                                    >
                                        Review
                                    </button>
                                </div>
                            )}

                            {/* Batch Review Controls */}
                            {showBatchMode && batchSelection[entry.id]?.selected && (
                                <div className="batch-review-controls">
                                    <select
                                        value={batchSelection[entry.id]?.decision || ''}
                                        onChange={(e) => updateBatchSelection(entry.id, {
                                            selected: true,
                                            decision: e.target.value as 'approve' | 'reject' | '',
                                            reason: batchSelection[entry.id]?.reason || ''
                                        })}
                                    >
                                        <option value="">Choose decision...</option>
                                        <option value="approve">Approve</option>
                                        <option value="reject">Reject</option>
                                    </select>
                                    
                                    <input
                                        type="text"
                                        placeholder="Enter reason..."
                                        value={batchSelection[entry.id]?.reason || ''}
                                        onChange={(e) => updateBatchSelection(entry.id, {
                                            selected: true,
                                            decision: batchSelection[entry.id]?.decision || '',
                                            reason: e.target.value
                                        })}
                                    />
                                </div>
                            )}
                        </div>
                    ))
                )}
            </div>

            {/* Single Review Modal */}
            {selectedEntry && !showBatchMode && (
                <div className="review-modal-overlay" onClick={() => setSelectedEntry(null)}>
                    <div className="review-modal" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3>Review Suggestion</h3>
                            <button 
                                className="close-btn"
                                onClick={() => setSelectedEntry(null)}
                            >
                                ×
                            </button>
                        </div>
                        
                        <div className="modal-content">
                            <div className="suggestion-details">
                                <div className="detail-row">
                                    <strong>File:</strong>
                                    <span>{selectedEntry.suggestion.originalPath}</span>
                                </div>
                                
                                {selectedEntry.suggestion.suggestedPath && (
                                    <div className="detail-row">
                                        <strong>Suggested Path:</strong>
                                        <span>{selectedEntry.suggestion.suggestedPath}</span>
                                    </div>
                                )}
                                
                                <div className="detail-row">
                                    <strong>Operation:</strong>
                                    <span>{selectedEntry.suggestion.operation}</span>
                                </div>
                                
                                <div className="detail-row">
                                    <strong>Confidence:</strong>
                                    <span 
                                        style={{ color: getConfidenceColor(selectedEntry.suggestion.confidence) }}
                                    >
                                        {(selectedEntry.suggestion.confidence * 100).toFixed(1)}%
                                    </span>
                                </div>
                                
                                {selectedEntry.suggestion.reason && (
                                    <div className="detail-row">
                                        <strong>AI Reasoning:</strong>
                                        <span>{selectedEntry.suggestion.reason}</span>
                                    </div>
                                )}
                            </div>

                            <div className="decision-form">
                                <div className="decision-options">
                                    <label>
                                        <input
                                            type="radio"
                                            name="decision"
                                            value="approve"
                                            checked={reviewDecision === 'approve'}
                                            onChange={(e) => setReviewDecision(e.target.value as 'approve')}
                                        />
                                        <span className="approve">Approve</span>
                                    </label>
                                    
                                    <label>
                                        <input
                                            type="radio"
                                            name="decision"
                                            value="reject"
                                            checked={reviewDecision === 'reject'}
                                            onChange={(e) => setReviewDecision(e.target.value as 'reject')}
                                        />
                                        <span className="reject">Reject</span>
                                    </label>
                                </div>
                                
                                <textarea
                                    placeholder="Enter reason for your decision..."
                                    value={reviewReason}
                                    onChange={(e) => setReviewReason(e.target.value)}
                                    required
                                />
                                
                                <div className="modal-actions">
                                    <button
                                        className="submit-btn"
                                        onClick={handleSingleDecision}
                                        disabled={!reviewDecision || !reviewReason.trim()}
                                    >
                                        Submit Decision
                                    </button>
                                    <button
                                        className="cancel-btn"
                                        onClick={() => {
                                            setSelectedEntry(null);
                                            setReviewDecision('');
                                            setReviewReason('');
                                        }}
                                    >
                                        Cancel
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
