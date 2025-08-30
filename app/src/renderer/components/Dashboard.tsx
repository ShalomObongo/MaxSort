import React, { useState, useEffect } from 'react';
import './Dashboard.css';
import DirectoryPicker from './DirectoryPicker';
import ModelSelector from './ModelSelector';

interface WorkflowStep {
  id: string;
  title: string;
  description: string;
  icon: string;
  status: 'pending' | 'active' | 'completed' | 'error';
  component?: React.ReactNode;
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
      case 2: // Scan (would need scan completion)
        return selectedDirectory !== '' && selectedModels.mainModel !== null;
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
              <h3>Ready to Scan</h3>
              <div className="scan-summary">
                <p><strong>Directory:</strong> {selectedDirectory}</p>
                <p><strong>Main Model:</strong> {selectedModels.mainModel}</p>
                {selectedModels.subModel && (
                  <p><strong>Sub Model:</strong> {selectedModels.subModel}</p>
                )}
              </div>
              <button 
                className="action-button primary"
                onClick={() => {
                  // This will be implemented when file analysis is integrated
                  console.log('Starting scan...');
                  handleNextStep();
                }}
              >
                🔍 Start Scan
              </button>
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
