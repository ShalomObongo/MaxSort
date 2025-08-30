import React, { useState, useEffect, useCallback } from 'react';
import './Dashboard.css';
import DirectoryPicker from './DirectoryPicker';
import ModelSelector from './ModelSelector';
import FileAnalysisResults from './FileAnalysisResults';
import { ElectronAPI } from '../../types/electron';

interface WorkflowStep {
  id: string;
  title: string;
  description: string;
  icon: string;
  status: 'pending' | 'active' | 'completed' | 'error';
  component?: React.ReactNode;
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

interface AnalysisSessionResult {
  totalFiles: number;
  successfulFiles: number;
  failedFiles: number;
  errors: string[];
  totalExecutionTime: number;
  averageExecutionTime: number;
  analysisType: string;
  requestId: string;
}

// Batch execution progress interface
interface BatchExecutionProgress {
  batchId: string;
  batch: {
    id: string;
    status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';
    operations: Array<{
      id: string;
      type: 'rename' | 'move' | 'delete';
      status: 'pending' | 'processing' | 'completed' | 'failed';
      originalPath: string;
      targetPath: string;
      error?: string;
    }>;
    progress: {
      total: number;
      completed: number;
      failed: number;
      successRate: number;
    };
    startedAt?: number;
    completedAt?: number;
  };
}

interface DashboardProps {
  onWorkflowComplete?: (data: any) => void;
}

const Dashboard: React.FC<DashboardProps> = ({ onWorkflowComplete }) => {
  const [currentStep, setCurrentStep] = useState(0);
  const [selectedDirectory, setSelectedDirectory] = useState<string>('');
  const [selectedModels, setSelectedModels] = useState<{
    mainModel: string | null;
    subModel: string | null;
  }>({ mainModel: null, subModel: null });
  
  // Analysis state
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisProgress, setAnalysisProgress] = useState<AnalysisProgress | null>(null);
  const [analysisResults, setAnalysisResults] = useState<AnalysisSessionResult | null>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [currentRequestId, setCurrentRequestId] = useState<string | null>(null);
  const [scannedFileIds, setScannedFileIds] = useState<number[]>([]);

  // Suggestion execution state
  const [isExecutingSuggestions, setIsExecutingSuggestions] = useState(false);
  const [suggestionExecutionProgress, setSuggestionExecutionProgress] = useState<{
    transactionId?: string;
    completedOperations: number;
    totalOperations: number;
    errors: string[];
  } | null>(null);
  const [suggestionExecutionError, setSuggestionExecutionError] = useState<string | null>(null);
  const [currentTransactionId, setCurrentTransactionId] = useState<string | null>(null);

  const [workflowSteps, setWorkflowSteps] = useState<WorkflowStep[]>([
    {
      id: 'setup',
      title: 'Setup & Configuration',
      description: 'Configure AI models and system preferences',
      icon: '⚙️',
      status: 'active'
    },
    {
      id: 'select',
      title: 'Select Directory',
      description: 'Choose the directory you want to organize',
      icon: '📁',
      status: 'pending'
    },
    {
      id: 'scan',
      title: 'Scan Files',
      description: 'Analyze files and generate suggestions',
      icon: '🔍',
      status: 'pending'
    },
    {
      id: 'review',
      title: 'Review Suggestions',
      description: 'Review and approve AI-generated suggestions',
      icon: '📋',
      status: 'pending'
    },
    {
      id: 'execute',
      title: 'Execute Operations',
      description: 'Apply the approved file operations',
      icon: '⚡',
      status: 'pending'
    }
  ]);

  // Update workflow step status based on user progress
  useEffect(() => {
    const updatedSteps = workflowSteps.map((step, index) => {
      if (index < currentStep) {
        return { ...step, status: 'completed' as const };
      } else if (index === currentStep) {
        return { ...step, status: 'active' as const };
      } else {
        return { ...step, status: 'pending' as const };
      }
    });
    setWorkflowSteps(updatedSteps);
  }, [currentStep]);

  // Setup analysis event listeners
  useEffect(() => {
    const electronAPI = window.electronAPI;
    if (!electronAPI) return;

    // Analysis progress updates
    const removeProgressListener = electronAPI.on?.('analysis:progressUpdate', (progress: AnalysisProgress) => {
      console.log('Analysis progress update:', progress);
      setAnalysisProgress(progress);
      
      // Update workflow step status during analysis
      if (progress.phase === 'analyzing' && currentStep === 2) {
        setWorkflowSteps(prev => prev.map((step, index) => 
          index === 2 ? { ...step, status: 'active' } : step
        ));
      }
    });

    // Analysis completion
    const removeCompleteListener = electronAPI.on?.('analysis:complete', (result: AnalysisSessionResult) => {
      console.log('Analysis complete:', result);
      setAnalysisResults(result);
      setIsAnalyzing(false);
      setAnalysisProgress(null);
      
      // Move to next step on successful completion
      if (result.successfulFiles > 0) {
        setCurrentStep(3); // Move to Review Suggestions
      }
    });

    // Analysis errors
    const removeErrorListener = electronAPI.on?.('analysis:error', (error: any) => {
      console.error('Analysis error:', error);
      setAnalysisError(error.error?.message || 'Analysis failed');
      setIsAnalyzing(false);
      
      // Mark scan step as error
      setWorkflowSteps(prev => prev.map((step, index) => 
        index === 2 ? { ...step, status: 'error' } : step
      ));
    });

    // Suggestion execution progress updates
    const removeSuggestionStartedListener = electronAPI.onSuggestionExecutionStarted?.((data) => {
      console.log('Suggestion execution started:', data);
      setSuggestionExecutionProgress({
        completedOperations: 0,
        totalOperations: data.operations.length,
        errors: []
      });
      
      // Update workflow step status during execution
      if (currentStep === 4) {
        setWorkflowSteps(prev => prev.map((step, index) => 
          index === 4 ? { ...step, status: 'active' } : step
        ));
      }
    });

    // Suggestion execution progress updates
    const removeSuggestionProgressListener = electronAPI.onSuggestionExecutionProgress?.((data) => {
      console.log('Suggestion execution progress:', data);
      if (data.progress) {
        setSuggestionExecutionProgress(prev => ({
          ...prev!,
          completedOperations: data.progress.completedOperations || prev?.completedOperations || 0,
          totalOperations: data.progress.totalOperations || prev?.totalOperations || 0,
          errors: data.progress.errors || prev?.errors || []
        }));
      }
    });

    // Suggestion execution completion
    const removeSuggestionCompleteListener = electronAPI.onSuggestionExecutionCompleted?.((data) => {
      console.log('Suggestion execution complete:', data);
      setIsExecutingSuggestions(false);
      setSuggestionExecutionProgress(null);
      
      // Mark execution step as completed
      setWorkflowSteps(prev => prev.map((step, index) => 
        index === 4 ? { ...step, status: 'completed' } : step
      ));
    });

    // Suggestion execution errors
    const removeSuggestionErrorListener = electronAPI.onSuggestionExecutionFailed?.((data) => {
      console.error('Suggestion execution error:', data);
      setSuggestionExecutionError(data.error?.message || 'Suggestion execution failed');
      setIsExecutingSuggestions(false);
      
      // Mark execution step as error
      setWorkflowSteps(prev => prev.map((step, index) => 
        index === 4 ? { ...step, status: 'error' } : step
      ));
    });

    return () => {
      removeProgressListener?.();
      removeCompleteListener?.();
      removeErrorListener?.();
      removeSuggestionStartedListener?.();
      removeSuggestionProgressListener?.();
      removeSuggestionCompleteListener?.();
      removeSuggestionErrorListener?.();
    };
  }, [currentStep]);

  // Load scanned files when directory changes
  useEffect(() => {
    const loadScanResults = async () => {
      if (!selectedDirectory) {
        setScannedFileIds([]);
        return;
      }

      try {
        const electronAPI = window.electronAPI;
        if (electronAPI.getScanResults) {
          const scanResults = await electronAPI.getScanResults(selectedDirectory);
          const fileIds = scanResults?.map((file: any) => file.id).filter(Boolean) || [];
          setScannedFileIds(fileIds);
        }
      } catch (error) {
        console.error('Failed to load scan results:', error);
        setScannedFileIds([]);
      }
    };

    loadScanResults();
  }, [selectedDirectory]);

  const handleDirectorySelected = (path: string) => {
    setSelectedDirectory(path);
    if (path && selectedModels.mainModel) {
      setCurrentStep(Math.max(currentStep, 2)); // Move to scan step
    }
  };

  const handleModelSelected = (mainModel: string | null, subModel: string | null) => {
    setSelectedModels({ mainModel, subModel });
    if (mainModel) {
      setCurrentStep(Math.max(currentStep, 1)); // Move to directory selection
    }
  };

  // Analysis handlers
  const handleStartAnalysis = useCallback(async () => {
    if (!selectedDirectory || !selectedModels.mainModel || scannedFileIds.length === 0) {
      setAnalysisError('Missing requirements for analysis: directory, model, or scanned files');
      return;
    }

    try {
      setIsAnalyzing(true);
      setAnalysisError(null);
      setAnalysisResults(null);
      
      const requestId = `analysis-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      setCurrentRequestId(requestId);

      const electronAPI = window.electronAPI;
      if (!electronAPI.startFileAnalysis) {
        throw new Error('Analysis functionality not available');
      }

      console.log('Starting analysis with:', {
        requestId,
        fileIds: scannedFileIds,
        directory: selectedDirectory,
        model: selectedModels.mainModel
      });

      await electronAPI.startFileAnalysis(scannedFileIds, 'rename-suggestions', {
        requestId,
        isInteractive: true,
        priority: 'high',
        modelName: selectedModels.mainModel
      });

      // Update UI to show analysis is starting
      setWorkflowSteps(prev => prev.map((step, index) => 
        index === 2 ? { ...step, status: 'active' } : step
      ));

    } catch (error) {
      console.error('Failed to start analysis:', error);
      setAnalysisError(error instanceof Error ? error.message : 'Failed to start analysis');
      setIsAnalyzing(false);
      
      setWorkflowSteps(prev => prev.map((step, index) => 
        index === 2 ? { ...step, status: 'error' } : step
      ));
    }
  }, [selectedDirectory, selectedModels.mainModel, scannedFileIds]);

  const handleCancelAnalysis = useCallback(async () => {
    if (!currentRequestId) return;

    try {
      const electronAPI = window.electronAPI;
      if (electronAPI.cancelFileAnalysis) {
        await electronAPI.cancelFileAnalysis(currentRequestId);
      }
      
      setIsAnalyzing(false);
      setAnalysisProgress(null);
      setCurrentRequestId(null);
      
    } catch (error) {
      console.error('Failed to cancel analysis:', error);
    }
  }, [currentRequestId]);

  const handleRetryAnalysis = useCallback(() => {
    setAnalysisError(null);
    handleStartAnalysis();
  }, [handleStartAnalysis]);

  // Suggestion execution handlers
  const handleStartSuggestionExecution = useCallback(async () => {
    try {
      setIsExecutingSuggestions(true);
      setSuggestionExecutionError(null);
      setSuggestionExecutionProgress(null);
      
      const electronAPI = window.electronAPI;
      if (!electronAPI.executeSuggestions) {
        throw new Error('Suggestion execution functionality not available');
      }

      // Execute approved suggestions for the scanned files
      console.log('Starting suggestion execution with files:', scannedFileIds);

      const result = await electronAPI.executeSuggestions({
        fileIds: scannedFileIds,
        selectionCriteria: {
          confidenceThreshold: 0.7, // Only execute high-confidence suggestions
          types: ['rename', 'move']
        },
        executionOptions: {
          priority: 'high',
          continueOnError: false,
          createBackups: true,
          validateBefore: true
        }
      });
      
      if (!result.success) {
        throw new Error(result.error || 'Failed to start suggestion execution');
      }
      
      setCurrentTransactionId(result.transactionId || null);

      // Update UI to show execution is starting
      setWorkflowSteps(prev => prev.map((step, index) => 
        index === 4 ? { ...step, status: 'active' } : step
      ));

    } catch (error) {
      console.error('Failed to start suggestion execution:', error);
      setSuggestionExecutionError(error instanceof Error ? error.message : 'Failed to start execution');
      setIsExecutingSuggestions(false);
      
      setWorkflowSteps(prev => prev.map((step, index) => 
        index === 4 ? { ...step, status: 'error' } : step
      ));
    }
  }, [scannedFileIds]);

  const handleCancelSuggestionExecution = useCallback(async () => {
    if (!currentTransactionId) return;

    try {
      const electronAPI = window.electronAPI;
      if (electronAPI.cancelSuggestionExecution) {
        await electronAPI.cancelSuggestionExecution(currentTransactionId, 'User cancellation');
      }
      
      setIsExecutingSuggestions(false);
      setSuggestionExecutionProgress(null);
      setCurrentTransactionId(null);
      
    } catch (error) {
      console.error('Failed to cancel suggestion execution:', error);
    }
  }, [currentTransactionId]);

  const handleRetrySuggestionExecution = useCallback(() => {
    setSuggestionExecutionError(null);
    handleStartSuggestionExecution();
  }, [handleStartSuggestionExecution]);

  const handleNextStep = () => {
    if (currentStep < workflowSteps.length - 1) {
      setCurrentStep(currentStep + 1);
    }
  };

  const handlePrevStep = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
    }
  };

  const handleStepClick = (stepIndex: number) => {
    // Only allow navigation to completed or current steps
    if (stepIndex <= currentStep || workflowSteps[stepIndex].status === 'completed') {
      setCurrentStep(stepIndex);
    }
  };

  const isStepAccessible = (stepIndex: number) => {
    return stepIndex <= currentStep || workflowSteps[stepIndex].status === 'completed';
  };

  const canProceedToNext = () => {
    switch (currentStep) {
      case 0: // Setup
        return selectedModels.mainModel !== null;
      case 1: // Select Directory  
        return selectedDirectory !== '';
      case 2: // Scan (need analysis completion)
        return analysisResults !== null && analysisResults.successfulFiles > 0;
      case 3: // Review (can proceed if results exist)
        return analysisResults !== null;
      case 4: // Execute (final step)
        return false;
      default:
        return false;
    }
  };

  const renderStepContent = () => {
    switch (currentStep) {
      case 0: // Setup & Configuration
        return (
          <div className="step-content">
            <ModelSelector
              onModelSelected={handleModelSelected}
            />
          </div>
        );
      
      case 1: // Select Directory
        return (
          <div className="step-content">
            <DirectoryPicker
              onDirectorySelected={handleDirectorySelected}
            />
          </div>
        );
      
      case 2: // Scan Files
        return (
          <div className="step-content">
            <div className="scan-ready">
              <h3>AI Analysis</h3>
              <div className="scan-summary">
                <p><strong>Directory:</strong> {selectedDirectory}</p>
                <p><strong>Main Model:</strong> {selectedModels.mainModel}</p>
                {selectedModels.subModel && (
                  <p><strong>Sub Model:</strong> {selectedModels.subModel}</p>
                )}
                <p><strong>Files to analyze:</strong> {scannedFileIds.length}</p>
              </div>

              {/* Analysis Progress */}
              {isAnalyzing && analysisProgress && (
                <div className="analysis-progress">
                  <h4>Analysis in Progress</h4>
                  <div className="progress-info">
                    <p><strong>Phase:</strong> {analysisProgress.phase}</p>
                    <p><strong>Progress:</strong> {analysisProgress.processedFiles} / {analysisProgress.totalFiles} files</p>
                    {analysisProgress.currentFile && (
                      <p><strong>Current file:</strong> {analysisProgress.currentFile}</p>
                    )}
                    <p><strong>Success rate:</strong> {Math.round((1 - analysisProgress.errorRate) * 100)}%</p>
                    {analysisProgress.estimatedTimeRemaining > 0 && (
                      <p><strong>Estimated time remaining:</strong> {Math.round(analysisProgress.estimatedTimeRemaining)}s</p>
                    )}
                  </div>
                  <div className="progress-bar">
                    <div 
                      className="progress-fill"
                      style={{ 
                        width: `${(analysisProgress.processedFiles / Math.max(analysisProgress.totalFiles, 1)) * 100}%` 
                      }}
                    />
                  </div>
                  <button 
                    className="action-button secondary"
                    onClick={handleCancelAnalysis}
                  >
                    Cancel Analysis
                  </button>
                </div>
              )}

              {/* Analysis Error */}
              {analysisError && (
                <div className="analysis-error">
                  <h4>Analysis Failed</h4>
                  <p className="error-message">{analysisError}</p>
                  <div className="error-actions">
                    <button 
                      className="action-button primary"
                      onClick={handleRetryAnalysis}
                    >
                      Retry Analysis
                    </button>
                    <button 
                      className="action-button secondary"
                      onClick={() => setAnalysisError(null)}
                    >
                      Dismiss
                    </button>
                  </div>
                </div>
              )}

              {/* Analysis Results Summary */}
              {analysisResults && (
                <div className="analysis-summary">
                  <h4>Analysis Complete</h4>
                  <div className="summary-stats">
                    <div className="stat-item">
                      <span className="stat-value">{analysisResults.totalFiles}</span>
                      <span className="stat-label">Files Analyzed</span>
                    </div>
                    <div className="stat-item">
                      <span className="stat-value">{analysisResults.successfulFiles}</span>
                      <span className="stat-label">Suggestions Generated</span>
                    </div>
                    <div className="stat-item">
                      <span className="stat-value">{Math.round(analysisResults.averageExecutionTime / 1000)}s</span>
                      <span className="stat-label">Avg. Time per File</span>
                    </div>
                    <div className="stat-item">
                      <span className="stat-value">{Math.round((analysisResults.successfulFiles / Math.max(analysisResults.totalFiles, 1)) * 100)}%</span>
                      <span className="stat-label">Success Rate</span>
                    </div>
                  </div>
                </div>
              )}

              {/* Start Analysis Button */}
              {!isAnalyzing && !analysisResults && (
                <button 
                  className="action-button primary"
                  onClick={handleStartAnalysis}
                  disabled={scannedFileIds.length === 0}
                >
                  🔍 Start AI Analysis
                </button>
              )}

              {/* Restart Analysis Button */}
              {!isAnalyzing && analysisResults && (
                <button 
                  className="action-button secondary"
                  onClick={handleStartAnalysis}
                >
                  🔄 Restart Analysis
                </button>
              )}
            </div>
          </div>
        );

      case 3: // Review Suggestions
        return (
          <div className="step-content">
            {analysisResults && scannedFileIds.length > 0 ? (
              <FileAnalysisResults
                fileIds={scannedFileIds}
                requestId={currentRequestId || undefined}
                analysisType="rename-suggestions"
                showAnalysisProgress={false}
                allowBatchOperations={true}
                maxSuggestionsPerFile={5}
              />
            ) : (
              <div className="placeholder-content">
                <h3>No Analysis Results</h3>
                <p>Please complete the analysis step first to review suggestions.</p>
                <button 
                  className="action-button primary"
                  onClick={() => setCurrentStep(2)}
                >
                  ← Back to Analysis
                </button>
              </div>
            )}
          </div>
        );
      
      case 4: // Execute Operations
        return (
          <div className="step-content">
            <div className="execution-ready">
              <h3>Execute File Operations</h3>
              <div className="execution-summary">
                <p>Ready to apply the approved file organization operations using AI-powered transactional execution.</p>
                {analysisResults && (
                  <div className="operation-stats">
                    <p><strong>Files analyzed:</strong> {analysisResults.successfulFiles}</p>
                    <p><strong>Operations ready:</strong> Approved suggestions will be executed with rollback capability</p>
                  </div>
                )}
              </div>

              {/* Suggestion Execution Progress */}
              {isExecutingSuggestions && suggestionExecutionProgress && (
                <div className="execution-progress">
                  <h4>Execution in Progress</h4>
                  <div className="progress-info">
                    {currentTransactionId && (
                      <p><strong>Transaction ID:</strong> {currentTransactionId}</p>
                    )}
                    <p><strong>Status:</strong> Processing</p>
                    <p><strong>Progress:</strong> {suggestionExecutionProgress.completedOperations} / {suggestionExecutionProgress.totalOperations} operations</p>
                    <p><strong>Success rate:</strong> {Math.round((suggestionExecutionProgress.completedOperations / Math.max(suggestionExecutionProgress.totalOperations, 1)) * 100)}%</p>
                    {suggestionExecutionProgress.errors.length > 0 && (
                      <p><strong>Errors:</strong> {suggestionExecutionProgress.errors.length}</p>
                    )}
                  </div>
                  <div className="progress-bar">
                    <div 
                      className="progress-fill"
                      style={{ 
                        width: `${(suggestionExecutionProgress.completedOperations / Math.max(suggestionExecutionProgress.totalOperations, 1)) * 100}%` 
                      }}
                    />
                  </div>
                  <button 
                    className="action-button secondary"
                    onClick={handleCancelSuggestionExecution}
                  >
                    Cancel Execution
                  </button>
                </div>
              )}

              {/* Suggestion Execution Error */}
              {suggestionExecutionError && (
                <div className="execution-error">
                  <h4>Execution Failed</h4>
                  <p className="error-message">{suggestionExecutionError}</p>
                  <div className="error-actions">
                    <button 
                      className="action-button primary"
                      onClick={handleRetrySuggestionExecution}
                    >
                      Retry Execution
                    </button>
                    <button 
                      className="action-button secondary"
                      onClick={() => setSuggestionExecutionError(null)}
                    >
                      Dismiss
                    </button>
                  </div>
                </div>
              )}

              {/* Start Suggestion Execution Button */}
              {!isExecutingSuggestions && !suggestionExecutionError && (
                <button 
                  className="action-button primary"
                  onClick={handleStartSuggestionExecution}
                >
                  ⚡ Execute AI-Recommended Operations
                </button>
              )}

              {/* Execution Complete */}
              {!isExecutingSuggestions && suggestionExecutionProgress && 
                suggestionExecutionProgress.completedOperations === suggestionExecutionProgress.totalOperations && (
                <div className="execution-complete">
                  <h4>✅ Execution Complete!</h4>
                  <p>All approved file operations have been successfully applied using transactional execution.</p>
                  <div className="completion-stats">
                    <p><strong>Total operations:</strong> {suggestionExecutionProgress.totalOperations}</p>
                    <p><strong>Successful:</strong> {suggestionExecutionProgress.completedOperations}</p>
                    <p><strong>Failed:</strong> {suggestionExecutionProgress.errors.length}</p>
                    <p><strong>Success rate:</strong> {Math.round((suggestionExecutionProgress.completedOperations / Math.max(suggestionExecutionProgress.totalOperations, 1)) * 100)}%</p>
                  </div>
                  {currentTransactionId && (
                    <div className="transaction-actions">
                      <button 
                        className="action-button secondary"
                        onClick={() => {
                          const electronAPI = window.electronAPI;
                          if (electronAPI.undoTransaction) {
                            electronAPI.undoTransaction(currentTransactionId, 'User requested undo');
                          }
                        }}
                      >
                        🔄 Undo All Operations
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        );
      
      default:
        return (
          <div className="step-content">
            <div className="placeholder-content">
              <h3>{workflowSteps[currentStep]?.title}</h3>
              <p>{workflowSteps[currentStep]?.description}</p>
              <p>This feature will be implemented in subsequent tasks.</p>
            </div>
          </div>
        );
    }
  };

  return (
    <div className="dashboard">
      <div className="dashboard-header">
        <h1>File Organization Workflow</h1>
        <p>Follow the steps below to organize your files with AI assistance</p>
      </div>

      {/* Workflow Progress */}
      <div className="workflow-progress">
        <div className="progress-steps">
          {workflowSteps.map((step, index) => (
            <div
              key={step.id}
              className={`progress-step ${step.status} ${isStepAccessible(index) ? 'accessible' : ''}`}
              onClick={() => handleStepClick(index)}
            >
              <div className="step-circle">
                <span className="step-icon">{step.icon}</span>
                <div className="step-number">{index + 1}</div>
              </div>
              <div className="step-info">
                <div className="step-title">{step.title}</div>
                <div className="step-description">{step.description}</div>
              </div>
              {index < workflowSteps.length - 1 && (
                <div className="step-connector" />
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Current Step Content */}
      <div className="workflow-content">
        <div className="current-step-header">
          <h2>
            <span className="step-icon-large">
              {workflowSteps[currentStep]?.icon}
            </span>
            {workflowSteps[currentStep]?.title}
          </h2>
          <p>{workflowSteps[currentStep]?.description}</p>
        </div>

        {renderStepContent()}

        {/* Step Navigation */}
        <div className="step-navigation">
          <button
            className="nav-button secondary"
            onClick={handlePrevStep}
            disabled={currentStep === 0}
          >
            ← Previous
          </button>
          
          <div className="step-indicator">
            Step {currentStep + 1} of {workflowSteps.length}
          </div>
          
          <button
            className="nav-button primary"
            onClick={handleNextStep}
            disabled={!canProceedToNext() || currentStep === workflowSteps.length - 1}
          >
            Next →
          </button>
        </div>
      </div>

      {/* Quick Status Summary */}
      {(selectedDirectory || selectedModels.mainModel) && (
        <div className="quick-status">
          <h3>Current Configuration</h3>
          <div className="status-grid">
            {selectedModels.mainModel && (
              <div className="status-item">
                <span className="status-label">Main Model:</span>
                <span className="status-value">✅ {selectedModels.mainModel}</span>
              </div>
            )}
            {selectedModels.subModel && (
              <div className="status-item">
                <span className="status-label">Sub Model:</span>
                <span className="status-value">✅ {selectedModels.subModel}</span>
              </div>
            )}
            {selectedDirectory && (
              <div className="status-item">
                <span className="status-label">Directory:</span>
                <span className="status-value">✅ {selectedDirectory}</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default Dashboard;
