import React, { useState, useEffect, useMemo } from 'react';
import './OperationPreviewModal.css';
import type { SuggestionRecord } from '../../lib/database';
import type { ExecutionBatch, ExecutionSummary } from '../../lib/suggestion-execution-service';

export interface OperationPreview {
  id: string;
  fileId: number;
  originalPath: string;
  suggestedPath: string;
  operationType: 'rename' | 'move';
  confidence: number;
  reasoning: string;
  riskLevel: 'low' | 'medium' | 'high';
  fileSize?: number;
  lastModified?: Date;
  impactAnalysis: {
    affectedFiles: number;
    breakingChanges: string[];
    warnings: string[];
  };
}

export interface OperationPreviewModalProps {
  /** Whether the modal is open */
  isOpen: boolean;
  /** Execution batches to preview */
  batches: ExecutionBatch[];
  /** Execution summary */
  summary: ExecutionSummary;
  /** File operation preview service data */
  operationPreviews?: OperationPreview[];
  /** Callback when user confirms execution */
  onConfirm: (confirmedBatches: ExecutionBatch[]) => void;
  /** Callback when user cancels */
  onCancel: () => void;
  /** Whether to show detailed risk analysis */
  showRiskAnalysis?: boolean;
  /** Whether to allow partial batch selection */
  allowPartialSelection?: boolean;
}

export interface PreviewValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  criticalIssues: string[];
}

const OperationPreviewModal: React.FC<OperationPreviewModalProps> = ({
  isOpen,
  batches,
  summary,
  operationPreviews = [],
  onConfirm,
  onCancel,
  showRiskAnalysis = true,
  allowPartialSelection = true
}) => {
  const [selectedBatches, setSelectedBatches] = useState<Set<string>>(new Set());
  const [validationResult, setValidationResult] = useState<PreviewValidationResult | null>(null);
  const [expandedBatches, setExpandedBatches] = useState<Set<string>>(new Set());
  const [isValidating, setIsValidating] = useState(false);
  const [showAdvancedDetails, setShowAdvancedDetails] = useState(false);

  // Initialize selected batches on modal open
  useEffect(() => {
    if (isOpen) {
      setSelectedBatches(new Set(batches.map(b => b.id)));
    }
  }, [isOpen, batches]);

  // Validate operations whenever selection changes
  useEffect(() => {
    if (isOpen && selectedBatches.size > 0) {
      validateOperations();
    }
  }, [selectedBatches, isOpen]);

  // Calculate filtered summary based on selected batches
  const filteredSummary = useMemo(() => {
    const selectedBatchList = batches.filter(b => selectedBatches.has(b.id));
    
    if (selectedBatchList.length === 0) {
      return {
        totalSuggestions: 0,
        totalBatches: 0,
        estimatedDuration: 0,
        riskAssessment: { low: 0, medium: 0, high: 0 },
        operationCounts: { rename: 0, move: 0 }
      };
    }

    const totalSuggestions = selectedBatchList.reduce((sum, batch) => sum + batch.suggestions.length, 0);
    const totalDuration = selectedBatchList.reduce((sum, batch) => sum + batch.estimatedDuration, 0);
    
    const riskCounts = { low: 0, medium: 0, high: 0 };
    const opCounts = { rename: 0, move: 0, delete: 0 };

    selectedBatchList.forEach(batch => {
      riskCounts[batch.riskLevel]++;
      batch.operations.forEach(op => {
        opCounts[op.type]++;
      });
    });

    return {
      totalSuggestions,
      totalBatches: selectedBatchList.length,
      estimatedDuration: totalDuration,
      riskAssessment: riskCounts,
      operationCounts: opCounts
    };
  }, [batches, selectedBatches]);

  /**
   * Validate the selected operations for execution
   */
  const validateOperations = async () => {
    setIsValidating(true);
    
    try {
      const selectedBatchList = batches.filter(b => selectedBatches.has(b.id));
      const errors: string[] = [];
      const warnings: string[] = [];
      const criticalIssues: string[] = [];

      // Check for duplicate target paths across batches
      const allTargetPaths = new Set<string>();
      const duplicates = new Set<string>();
      
      selectedBatchList.forEach(batch => {
        batch.suggestions.forEach(suggestion => {
          if (allTargetPaths.has(suggestion.suggestedValue)) {
            duplicates.add(suggestion.suggestedValue);
          } else {
            allTargetPaths.add(suggestion.suggestedValue);
          }
        });
      });

      if (duplicates.size > 0) {
        criticalIssues.push(`Duplicate target paths detected: ${Array.from(duplicates).join(', ')}`);
      }

      // Check for high-risk operations
      const highRiskBatches = selectedBatchList.filter(b => b.riskLevel === 'high');
      if (highRiskBatches.length > 0) {
        warnings.push(`${highRiskBatches.length} batch(es) contain high-risk operations`);
      }

      // Check for very low confidence operations
      const lowConfidenceOps = selectedBatchList.flatMap(b => 
        b.suggestions.filter(s => s.adjustedConfidence < 0.5)
      );
      if (lowConfidenceOps.length > 0) {
        warnings.push(`${lowConfidenceOps.length} operations have very low confidence (<50%)`);
      }

      // Check for large batch sizes that might impact performance
      const largeBatches = selectedBatchList.filter(b => b.suggestions.length > 100);
      if (largeBatches.length > 0) {
        warnings.push(`${largeBatches.length} batch(es) are very large (>100 operations) and may impact performance`);
      }

      // Check total estimated duration
      if (filteredSummary.estimatedDuration > 300000) { // 5 minutes
        warnings.push(`Estimated execution time is ${Math.round(filteredSummary.estimatedDuration / 60000)} minutes`);
      }

      setValidationResult({
        isValid: criticalIssues.length === 0,
        errors,
        warnings,
        criticalIssues
      });
    } catch (error) {
      setValidationResult({
        isValid: false,
        errors: ['Failed to validate operations'],
        warnings: [],
        criticalIssues: ['Validation process encountered an error']
      });
    } finally {
      setIsValidating(false);
    }
  };

  /**
   * Handle batch selection toggle
   */
  const toggleBatchSelection = (batchId: string) => {
    if (!allowPartialSelection) return;
    
    const newSelection = new Set(selectedBatches);
    if (newSelection.has(batchId)) {
      newSelection.delete(batchId);
    } else {
      newSelection.add(batchId);
    }
    setSelectedBatches(newSelection);
  };

  /**
   * Handle batch expansion toggle
   */
  const toggleBatchExpansion = (batchId: string) => {
    const newExpanded = new Set(expandedBatches);
    if (newExpanded.has(batchId)) {
      newExpanded.delete(batchId);
    } else {
      newExpanded.add(batchId);
    }
    setExpandedBatches(newExpanded);
  };

  /**
   * Handle confirm execution
   */
  const handleConfirm = () => {
    if (!validationResult?.isValid) return;
    
    const confirmedBatches = batches.filter(b => selectedBatches.has(b.id));
    onConfirm(confirmedBatches);
  };

  /**
   * Handle select/deselect all batches
   */
  const handleSelectAll = () => {
    if (selectedBatches.size === batches.length) {
      setSelectedBatches(new Set());
    } else {
      setSelectedBatches(new Set(batches.map(b => b.id)));
    }
  };

  /**
   * Format duration for display
   */
  const formatDuration = (milliseconds: number): string => {
    if (milliseconds < 1000) return `${milliseconds}ms`;
    if (milliseconds < 60000) return `${Math.round(milliseconds / 1000)}s`;
    return `${Math.round(milliseconds / 60000)}m ${Math.round((milliseconds % 60000) / 1000)}s`;
  };

  /**
   * Get risk level color class
   */
  const getRiskLevelClass = (riskLevel: 'low' | 'medium' | 'high'): string => {
    switch (riskLevel) {
      case 'low': return 'risk-low';
      case 'medium': return 'risk-medium';
      case 'high': return 'risk-high';
      default: return '';
    }
  };

  if (!isOpen) return null;

  return (
    <div className="operation-preview-modal-overlay" onClick={onCancel}>
      <div className="operation-preview-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Operation Preview & Confirmation</h2>
          <button 
            className="close-button"
            onClick={onCancel}
            aria-label="Close modal"
          >
            ×
          </button>
        </div>

        <div className="modal-content">
          {/* Execution Summary */}
          <div className="execution-summary">
            <h3>Execution Summary</h3>
            <div className="summary-grid">
              <div className="summary-item">
                <span className="summary-label">Total Operations:</span>
                <span className="summary-value">{filteredSummary.totalSuggestions}</span>
              </div>
              <div className="summary-item">
                <span className="summary-label">Batches:</span>
                <span className="summary-value">{filteredSummary.totalBatches}</span>
              </div>
              <div className="summary-item">
                <span className="summary-label">Estimated Duration:</span>
                <span className="summary-value">{formatDuration(filteredSummary.estimatedDuration)}</span>
              </div>
              <div className="summary-item">
                <span className="summary-label">Renames:</span>
                <span className="summary-value">{filteredSummary.operationCounts.rename}</span>
              </div>
              <div className="summary-item">
                <span className="summary-label">Moves:</span>
                <span className="summary-value">{filteredSummary.operationCounts.move}</span>
              </div>
            </div>

            {/* Risk Assessment */}
            {showRiskAnalysis && (
              <div className="risk-assessment">
                <h4>Risk Assessment</h4>
                <div className="risk-indicators">
                  <div className={`risk-indicator ${getRiskLevelClass('low')}`}>
                    <span className="risk-count">{filteredSummary.riskAssessment.low}</span>
                    <span className="risk-label">Low Risk</span>
                  </div>
                  <div className={`risk-indicator ${getRiskLevelClass('medium')}`}>
                    <span className="risk-count">{filteredSummary.riskAssessment.medium}</span>
                    <span className="risk-label">Medium Risk</span>
                  </div>
                  <div className={`risk-indicator ${getRiskLevelClass('high')}`}>
                    <span className="risk-count">{filteredSummary.riskAssessment.high}</span>
                    <span className="risk-label">High Risk</span>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Validation Results */}
          {validationResult && (
            <div className="validation-results">
              <h3>
                Validation Results 
                {isValidating && <span className="validation-spinner">⟳</span>}
              </h3>
              
              {validationResult.criticalIssues.length > 0 && (
                <div className="validation-issues critical">
                  <h4>Critical Issues:</h4>
                  <ul>
                    {validationResult.criticalIssues.map((issue, index) => (
                      <li key={index}>{issue}</li>
                    ))}
                  </ul>
                </div>
              )}

              {validationResult.warnings.length > 0 && (
                <div className="validation-issues warnings">
                  <h4>Warnings:</h4>
                  <ul>
                    {validationResult.warnings.map((warning, index) => (
                      <li key={index}>{warning}</li>
                    ))}
                  </ul>
                </div>
              )}

              {validationResult.isValid && validationResult.criticalIssues.length === 0 && validationResult.warnings.length === 0 && (
                <div className="validation-success">
                  ✓ All operations validated successfully
                </div>
              )}
            </div>
          )}

          {/* Batch Controls */}
          {allowPartialSelection && (
            <div className="batch-controls">
              <button 
                className="select-all-button"
                onClick={handleSelectAll}
              >
                {selectedBatches.size === batches.length ? 'Deselect All' : 'Select All'}
              </button>
              <button 
                className="toggle-details-button"
                onClick={() => setShowAdvancedDetails(!showAdvancedDetails)}
              >
                {showAdvancedDetails ? 'Hide Details' : 'Show Details'}
              </button>
            </div>
          )}

          {/* Batch List */}
          <div className="batch-list">
            <h3>Operation Batches</h3>
            {batches.map(batch => (
              <div 
                key={batch.id} 
                className={`batch-item ${selectedBatches.has(batch.id) ? 'selected' : ''} ${getRiskLevelClass(batch.riskLevel)}`}
              >
                <div className="batch-header">
                  {allowPartialSelection && (
                    <input
                      type="checkbox"
                      checked={selectedBatches.has(batch.id)}
                      onChange={() => toggleBatchSelection(batch.id)}
                      className="batch-checkbox"
                    />
                  )}
                  <div className="batch-info">
                    <h4>{batch.groupCriteria}</h4>
                    <div className="batch-stats">
                      <span>{batch.suggestions.length} operations</span>
                      <span>{formatDuration(batch.estimatedDuration)}</span>
                      <span className={`batch-risk ${getRiskLevelClass(batch.riskLevel)}`}>
                        {batch.riskLevel} risk
                      </span>
                    </div>
                  </div>
                  <button 
                    className="expand-button"
                    onClick={() => toggleBatchExpansion(batch.id)}
                    aria-label={expandedBatches.has(batch.id) ? 'Collapse batch' : 'Expand batch'}
                  >
                    {expandedBatches.has(batch.id) ? '−' : '+'}
                  </button>
                </div>

                {expandedBatches.has(batch.id) && (
                  <div className="batch-operations">
                    {batch.suggestions.map((suggestion, index) => (
                      <div key={suggestion.id || index} className="operation-item">
                        <div className="operation-info">
                          <div className="operation-path">
                            <span className="operation-type">{batch.operations[index]?.type || 'rename'}</span>
                            <span className="original-path">File {suggestion.fileId}</span>
                            <span className="arrow">→</span>
                            <span className="target-path">{suggestion.suggestedValue}</span>
                          </div>
                          {showAdvancedDetails && (
                            <div className="operation-details">
                              <span className="confidence">
                                {Math.round(suggestion.adjustedConfidence * 100)}% confidence
                              </span>
                              {suggestion.reasoning && (
                                <span className="reasoning">{suggestion.reasoning}</span>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Modal Footer */}
        <div className="modal-footer">
          <div className="footer-info">
            {selectedBatches.size > 0 && (
              <span className="selected-count">
                {selectedBatches.size} of {batches.length} batches selected
              </span>
            )}
          </div>
          <div className="footer-actions">
            <button 
              className="cancel-button"
              onClick={onCancel}
            >
              Cancel
            </button>
            <button 
              className="confirm-button"
              onClick={handleConfirm}
              disabled={!validationResult?.isValid || selectedBatches.size === 0 || isValidating}
            >
              {isValidating ? 'Validating...' : `Execute ${selectedBatches.size} Batch${selectedBatches.size !== 1 ? 'es' : ''}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default OperationPreviewModal;
