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
  requestId: string;
  totalFiles: number;
  successfulFiles: number;
  failedFiles: number;
  results: any[];
  totalExecutionTime: number;
  averageExecutionTime: number;
  completedAt: number;
  errorSummary?: string[];
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

    return () => {
      removeProgressListener?.();
      removeCompleteListener?.();
      removeErrorListener?.();
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
