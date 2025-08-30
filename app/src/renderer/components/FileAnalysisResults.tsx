import React, { useState, useEffect, useCallback } from 'react';
import './FileAnalysisResults.css';
import { ElectronAPI } from '../../types/electron';

// Import types from the existing analysis system
interface SuggestionRecord {
  id?: number;
  fileId: number;
  requestId: string;
  analysisType: 'rename-suggestions' | 'classification' | 'content-summary' | 'metadata-extraction';
  suggestedValue: string;
  originalConfidence: number;
  adjustedConfidence: number;
  qualityScore: number;
  reasoning?: string;
  modelUsed: string;
  analysisDuration: number;
  modelVersion?: string;
  contentHash?: string;
  validationFlags?: string;
  rankPosition: number;
  isRecommended: boolean;
  createdAt?: number;
  updatedAt?: number;
  file_path?: string;
  file_name?: string;
}

interface AnalysisProgress {
  requestId: string;
  totalFiles: number;
  processedFiles: number;
  completedFiles: number;
  failedFiles: number;
  currentFile?: string;
  currentAnalysisType?: string;
  estimatedTimeRemaining: number;
  phase: 'initializing' | 'analyzing' | 'completing' | 'complete' | 'error';
  errorRate: number;
}

interface FileAnalysisResultsProps {
  fileIds: number[];
  requestId?: string;
  analysisType?: 'rename-suggestions' | 'classification' | 'content-summary' | 'metadata-extraction';
  onSuggestionApply?: (fileId: number, suggestion: SuggestionRecord) => void;
  onSuggestionDismiss?: (suggestionId: number) => void;
  onAnalysisStart?: (fileIds: number[], analysisType: string) => void;
  showAnalysisProgress?: boolean;
  allowBatchOperations?: boolean;
  maxSuggestionsPerFile?: number;
}

interface GroupedSuggestions {
  [fileId: number]: {
    fileName: string;
    filePath: string;
    suggestions: SuggestionRecord[];
  };
}

/**
 * FileAnalysisResults - Display and manage AI-generated file analysis suggestions
 * Handles real-time updates, confidence scoring, and batch operations
 */
const FileAnalysisResults: React.FC<FileAnalysisResultsProps> = ({
  fileIds,
  requestId,
  analysisType = 'rename-suggestions',
  onSuggestionApply,
  onSuggestionDismiss,
  onAnalysisStart,
  showAnalysisProgress = true,
  allowBatchOperations = true,
  maxSuggestionsPerFile = 5
}) => {
  const [suggestions, setSuggestions] = useState<GroupedSuggestions>({});
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [analysisProgress, setAnalysisProgress] = useState<AnalysisProgress | null>(null);
  const [selectedSuggestions, setSelectedSuggestions] = useState<Set<number>>(new Set());
  const [filterByConfidence, setFilterByConfidence] = useState<number>(0);
  const [sortBy, setSortBy] = useState<'confidence' | 'quality' | 'fileName'>('quality');
  const [expandedFiles, setExpandedFiles] = useState<Set<number>>(new Set());

  // Load suggestions from database
  const loadSuggestions = useCallback(async () => {
    if (fileIds.length === 0) {
      setSuggestions({});
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const electronAPI = window.electronAPI;

      // Use IPC to get suggestions
      const result = await electronAPI.invoke('suggestions:getByFileIds', fileIds, analysisType);
      
      if (!result.success) {
        throw new Error(result.error || 'Failed to load suggestions');
      }

      // Group suggestions by file
      const grouped: GroupedSuggestions = {};
      result.suggestions.forEach((suggestion: SuggestionRecord) => {
        if (!grouped[suggestion.fileId]) {
          grouped[suggestion.fileId] = {
            fileName: suggestion.file_name || `File ${suggestion.fileId}`,
            filePath: suggestion.file_path || '',
            suggestions: []
          };
        }
        grouped[suggestion.fileId].suggestions.push(suggestion);
      });

      // Sort suggestions within each file group
      Object.values(grouped).forEach(fileGroup => {
        fileGroup.suggestions.sort((a: SuggestionRecord, b: SuggestionRecord) => b.qualityScore - a.qualityScore);
      });

      setSuggestions(grouped);
    } catch (error) {
      console.error('Failed to load suggestions:', error);
      setError(error instanceof Error ? error.message : 'Failed to load suggestions');
    } finally {
      setLoading(false);
    }
  }, [fileIds, analysisType]);

  // Real-time progress updates via IPC
  useEffect(() => {
    if (!showAnalysisProgress) return;

    const electronAPI = window.electronAPI;

    const handleProgressUpdate = (progress: AnalysisProgress) => {
      setAnalysisProgress(progress);
      
      // Reload suggestions when analysis is complete
      if (progress.phase === 'complete') {
        loadSuggestions();
      }
    };

    // Listen for analysis progress updates
    const cleanup = electronAPI.on?.('analysis:progress-update', handleProgressUpdate);

    return cleanup;
  }, [showAnalysisProgress, loadSuggestions]);

  // Load suggestions on mount and when dependencies change
  useEffect(() => {
    loadSuggestions();
  }, [loadSuggestions]);

  // Handle suggestion application
  const handleApplySuggestion = async (fileId: number, suggestion: SuggestionRecord) => {
    try {
      if (onSuggestionApply) {
        onSuggestionApply(fileId, suggestion);
      }
      
      const electronAPI = window.electronAPI;
      
      // Update recommendation status in database
      if (suggestion.id) {
        await electronAPI.invoke('suggestions:updateRecommendation', suggestion.id, true);
      }
      
      // Reload suggestions to reflect changes
      await loadSuggestions();
    } catch (error) {
      console.error('Failed to apply suggestion:', error);
      setError('Failed to apply suggestion');
    }
  };

  // Handle suggestion dismissal
  const handleDismissSuggestion = async (suggestionId: number) => {
    try {
      if (onSuggestionDismiss) {
        onSuggestionDismiss(suggestionId);
      }
      
      const electronAPI = window.electronAPI;
      
      // Update recommendation status in database
      await electronAPI.invoke('suggestions:updateRecommendation', suggestionId, false);
      
      // Reload suggestions to reflect changes
      await loadSuggestions();
    } catch (error) {
      console.error('Failed to dismiss suggestion:', error);
      setError('Failed to dismiss suggestion');
    }
  };

  // Handle batch analysis start
  const handleStartAnalysis = async () => {
    if (!onAnalysisStart) return;
    
    try {
      onAnalysisStart(fileIds, analysisType);
    } catch (error) {
      console.error('Failed to start analysis:', error);
      setError('Failed to start analysis');
    }
  };

  // Handle batch suggestion application
  const handleApplySelectedSuggestions = async () => {
    const selectedSuggestionsList: Array<{ fileId: number; suggestion: SuggestionRecord }> = [];
    
    Object.entries(suggestions).forEach(([fileIdStr, fileGroup]) => {
      const fileId = parseInt(fileIdStr);
      fileGroup.suggestions.forEach((suggestion: SuggestionRecord) => {
        if (suggestion.id && selectedSuggestions.has(suggestion.id)) {
          selectedSuggestionsList.push({ fileId, suggestion });
        }
      });
    });

    for (const { fileId, suggestion } of selectedSuggestionsList) {
      await handleApplySuggestion(fileId, suggestion);
    }
    
    setSelectedSuggestions(new Set());
  };

  // Toggle file expansion
  const toggleFileExpanded = (fileId: number) => {
    const newExpanded = new Set(expandedFiles);
    if (newExpanded.has(fileId)) {
      newExpanded.delete(fileId);
    } else {
      newExpanded.add(fileId);
    }
    setExpandedFiles(newExpanded);
  };

  // Toggle suggestion selection
  const toggleSuggestionSelection = (suggestionId: number) => {
    const newSelected = new Set(selectedSuggestions);
    if (newSelected.has(suggestionId)) {
      newSelected.delete(suggestionId);
    } else {
      newSelected.add(suggestionId);
    }
    setSelectedSuggestions(newSelected);
  };

  // Get confidence indicator
  const getConfidenceIndicator = (suggestion: SuggestionRecord) => {
    const confidence = suggestion.adjustedConfidence;
    let className = 'confidence-indicator ';
    let label = '';
    
    if (confidence >= 80) {
      className += 'high';
      label = 'High';
    } else if (confidence >= 60) {
      className += 'medium';
      label = 'Medium';
    } else {
      className += 'low';
      label = 'Low';
    }
    
    return { className, label, value: confidence };
  };

  // Get quality indicator
  const getQualityIndicator = (suggestion: SuggestionRecord) => {
    const quality = suggestion.qualityScore;
    let className = 'quality-indicator ';
    
    if (quality >= 80) {
      className += 'excellent';
    } else if (quality >= 60) {
      className += 'good';
    } else {
      className += 'fair';
    }
    
    return { className, value: quality };
  };

  // Filter and sort suggestions
  const getFilteredSuggestions = () => {
    const filtered: GroupedSuggestions = {};
    
    Object.entries(suggestions).forEach(([fileIdStr, fileGroup]) => {
      const fileId = parseInt(fileIdStr);
      const filteredSuggestions = fileGroup.suggestions
        .filter((s: SuggestionRecord) => s.adjustedConfidence >= filterByConfidence)
        .slice(0, maxSuggestionsPerFile);
      
      if (filteredSuggestions.length > 0) {
        filtered[fileId] = {
          ...fileGroup,
          suggestions: filteredSuggestions
        };
      }
    });
    
    // Sort files by the specified criteria
    const sortedEntries = Object.entries(filtered).sort(([, a], [, b]) => {
      switch (sortBy) {
        case 'confidence':
          return (b.suggestions[0]?.adjustedConfidence || 0) - (a.suggestions[0]?.adjustedConfidence || 0);
        case 'quality':
          return (b.suggestions[0]?.qualityScore || 0) - (a.suggestions[0]?.qualityScore || 0);
        case 'fileName':
          return a.fileName.localeCompare(b.fileName);
        default:
          return 0;
      }
    });
    
    return Object.fromEntries(sortedEntries);
  };

  // Render loading state
  if (loading && !analysisProgress) {
    return (
      <div className="file-analysis-results loading">
        <div className="loading-spinner">
          <div className="spinner"></div>
          <p>Loading analysis results...</p>
        </div>
      </div>
    );
  }

  // Render error state
  if (error) {
    return (
      <div className="file-analysis-results error">
        <div className="error-message">
          <span className="error-icon">⚠️</span>
          <p>{error}</p>
          <button 
            className="retry-button"
            onClick={loadSuggestions}
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  const filteredSuggestions = getFilteredSuggestions();
  const totalSuggestions = Object.values(filteredSuggestions).reduce(
    (sum, fileGroup) => sum + fileGroup.suggestions.length, 0
  );
  const selectedCount = selectedSuggestions.size;

  return (
    <div className="file-analysis-results">
      {/* Header with controls */}
      <div className="results-header">
        <div className="header-title">
          <h2>Analysis Results</h2>
          <span className="results-count">
            {totalSuggestions} suggestions for {Object.keys(filteredSuggestions).length} files
          </span>
        </div>
        
        <div className="header-controls">
          {onAnalysisStart && (
            <button 
              className="start-analysis-button"
              onClick={handleStartAnalysis}
              disabled={!!analysisProgress}
            >
              🔍 Start Analysis
            </button>
          )}
          
          {allowBatchOperations && selectedCount > 0 && (
            <button 
              className="apply-selected-button"
              onClick={handleApplySelectedSuggestions}
            >
              Apply Selected ({selectedCount})
            </button>
          )}
        </div>
      </div>

      {/* Analysis progress */}
      {showAnalysisProgress && analysisProgress && (
        <div className="analysis-progress">
          <div className="progress-header">
            <span className="progress-title">Analysis in Progress</span>
            <span className="progress-phase">{analysisProgress.phase}</span>
          </div>
          
          <div className="progress-bar">
            <div 
              className="progress-fill"
              style={{ 
                width: `${(analysisProgress.completedFiles / analysisProgress.totalFiles) * 100}%` 
              }}
            />
          </div>
          
          <div className="progress-details">
            <span>{analysisProgress.completedFiles} / {analysisProgress.totalFiles} files</span>
            {analysisProgress.currentFile && (
              <span className="current-file">Processing: {analysisProgress.currentFile}</span>
            )}
            {analysisProgress.estimatedTimeRemaining > 0 && (
              <span className="time-remaining">
                ~{Math.ceil(analysisProgress.estimatedTimeRemaining / 60)}m remaining
              </span>
            )}
          </div>
        </div>
      )}

      {/* Filters and sorting */}
      <div className="results-filters">
        <div className="filter-group">
          <label>Min Confidence:</label>
          <input 
            type="range"
            min="0"
            max="100"
            value={filterByConfidence}
            onChange={(e) => setFilterByConfidence(parseInt(e.target.value))}
            className="confidence-slider"
          />
          <span className="confidence-value">{filterByConfidence}%</span>
        </div>
        
        <div className="filter-group">
          <label>Sort by:</label>
          <select 
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
            className="sort-select"
          >
            <option value="quality">Quality Score</option>
            <option value="confidence">Confidence</option>
            <option value="fileName">File Name</option>
          </select>
        </div>
        
        <div className="filter-group">
          <label>Show per file:</label>
          <span className="max-suggestions">{maxSuggestionsPerFile}</span>
        </div>
      </div>

      {/* Results list */}
      <div className="results-list">
        {Object.keys(filteredSuggestions).length === 0 ? (
          <div className="empty-results">
            <span className="empty-icon">📄</span>
            <p>No suggestions found</p>
            <p className="empty-subtitle">
              Try lowering the confidence filter or run analysis on the selected files.
            </p>
          </div>
        ) : (
          Object.entries(filteredSuggestions).map(([fileIdStr, fileGroup]) => {
            const fileId = parseInt(fileIdStr);
            const isExpanded = expandedFiles.has(fileId);
            const hasTopSuggestion = fileGroup.suggestions.length > 0;
            const topSuggestion = fileGroup.suggestions[0];
            
            return (
              <div key={fileId} className={`file-result ${isExpanded ? 'expanded' : ''}`}>
                <div className="file-header" onClick={() => toggleFileExpanded(fileId)}>
                  <div className="file-info">
                    <span className="expand-icon">{isExpanded ? '▼' : '▶'}</span>
                    <span className="file-name">{fileGroup.fileName}</span>
                    <span className="file-path">{fileGroup.filePath}</span>
                  </div>
                  
                  {hasTopSuggestion && (
                    <div className="file-summary">
                      <div className="top-suggestion">
                        <span className="suggestion-value">{topSuggestion.suggestedValue}</span>
                        <div className="suggestion-indicators">
                          <span className={getConfidenceIndicator(topSuggestion).className}>
                            {getConfidenceIndicator(topSuggestion).value}%
                          </span>
                          <span className={getQualityIndicator(topSuggestion).className}>
                            Q{getQualityIndicator(topSuggestion).value}
                          </span>
                        </div>
                      </div>
                      <span className="suggestion-count">
                        {fileGroup.suggestions.length} suggestion{fileGroup.suggestions.length > 1 ? 's' : ''}
                      </span>
                    </div>
                  )}
                </div>
                
                {isExpanded && (
                  <div className="suggestions-list">
                    {fileGroup.suggestions.map((suggestion: SuggestionRecord, index: number) => {
                      const confidence = getConfidenceIndicator(suggestion);
                      const quality = getQualityIndicator(suggestion);
                      const isSelected = suggestion.id ? selectedSuggestions.has(suggestion.id) : false;
                      
                      return (
                        <div 
                          key={suggestion.id || index} 
                          className={`suggestion-item ${suggestion.isRecommended ? 'recommended' : ''} ${isSelected ? 'selected' : ''}`}
                        >
                          <div className="suggestion-header">
                            {allowBatchOperations && suggestion.id && (
                              <input 
                                type="checkbox"
                                checked={isSelected}
                                onChange={() => toggleSuggestionSelection(suggestion.id!)}
                                className="suggestion-checkbox"
                              />
                            )}
                            
                            <div className="suggestion-content">
                              <span className="suggestion-value">{suggestion.suggestedValue}</span>
                              <span className="suggestion-rank">#{suggestion.rankPosition}</span>
                            </div>
                            
                            <div className="suggestion-metrics">
                              <span className={confidence.className} title={`Confidence: ${confidence.value}%`}>
                                {confidence.label} {confidence.value}%
                              </span>
                              <span className={quality.className} title={`Quality Score: ${quality.value}`}>
                                Q{quality.value}
                              </span>
                              {suggestion.isRecommended && (
                                <span className="recommended-badge">★ Recommended</span>
                              )}
                            </div>
                          </div>
                          
                          {suggestion.reasoning && (
                            <div className="suggestion-reasoning">
                              <span className="reasoning-label">Reasoning:</span>
                              <p className="reasoning-text">{suggestion.reasoning}</p>
                            </div>
                          )}
                          
                          <div className="suggestion-meta">
                            <span className="model-info">
                              {suggestion.modelUsed} • {suggestion.analysisDuration}ms
                            </span>
                            {suggestion.validationFlags && (
                              <span className="validation-flags">
                                Issues: {JSON.parse(suggestion.validationFlags).join(', ')}
                              </span>
                            )}
                          </div>
                          
                          <div className="suggestion-actions">
                            <button 
                              className="apply-button"
                              onClick={() => handleApplySuggestion(fileId, suggestion)}
                              disabled={suggestion.isRecommended}
                            >
                              {suggestion.isRecommended ? 'Applied' : 'Apply'}
                            </button>
                            
                            <button 
                              className="dismiss-button"
                              onClick={() => suggestion.id && handleDismissSuggestion(suggestion.id)}
                            >
                              Dismiss
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

export default FileAnalysisResults;
