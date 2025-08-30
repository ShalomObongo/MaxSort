import React, { useState, useEffect } from 'react';
import { useAppState } from '../store/AppStateContext';
import './OnboardingFlow.css';

interface OnboardingStep {
  id: string;
  title: string;
  description: string;
  content: React.ReactNode;
  action?: {
    label: string;
    handler: () => void | Promise<void>;
  };
  validation?: () => boolean | Promise<boolean>;
  skippable?: boolean;
}

interface OnboardingFlowProps {
  onComplete: () => void;
  onSkip: () => void;
}

const OnboardingFlow: React.FC<OnboardingFlowProps> = ({ onComplete, onSkip }) => {
  const { state, dispatch } = useAppState();
  const [currentStep, setCurrentStep] = useState(0);
  const [isValidating, setIsValidating] = useState(false);
  const [completedSteps, setCompletedSteps] = useState<Set<string>>(new Set());
  const [userProgress, setUserProgress] = useState({
    directorySelected: false,
    modelConfigured: false,
    firstScanCompleted: false
  });

  const steps: OnboardingStep[] = [
    {
      id: 'welcome',
      title: 'Welcome to MaxSort',
      description: 'Your AI-powered file organization assistant',
      content: (
        <div className="onboarding-welcome">
          <div className="welcome-hero">
            <div className="welcome-icon">🗂️</div>
            <h2>MaxSort AI File Organizer</h2>
            <p className="welcome-subtitle">
              Organize your files intelligently with AI-powered suggestions and automation
            </p>
          </div>
          <div className="welcome-features">
            <div className="feature-card">
              <div className="feature-icon">🤖</div>
              <h3>AI-Powered Analysis</h3>
              <p>Advanced language models analyze your files and suggest optimal organization</p>
            </div>
            <div className="feature-card">
              <div className="feature-icon">⚡</div>
              <h3>Batch Processing</h3>
              <p>Handle thousands of files efficiently with smart batch operations</p>
            </div>
            <div className="feature-card">
              <div className="feature-icon">🔒</div>
              <h3>Safe & Reversible</h3>
              <p>All operations are reversible with comprehensive undo functionality</p>
            </div>
          </div>
          <div className="welcome-stats">
            <div className="stat">
              <div className="stat-number">10x</div>
              <div className="stat-label">Faster Organization</div>
            </div>
            <div className="stat">
              <div className="stat-number">99%</div>
              <div className="stat-label">Accuracy Rate</div>
            </div>
            <div className="stat">
              <div className="stat-number">∞</div>
              <div className="stat-label">Files Supported</div>
            </div>
          </div>
        </div>
      ),
      skippable: true
    },
    {
      id: 'system-check',
      title: 'System Requirements',
      description: 'Ensuring your system is ready for AI-powered file organization',
      content: (
        <div className="onboarding-system-check">
          <h3>System Compatibility Check</h3>
          <div className="system-checks">
            <div className="check-item">
              <div className="check-icon">✅</div>
              <span>macOS Compatibility</span>
              <span className="check-status">Ready</span>
            </div>
            <div className="check-item">
              <div className="check-icon">✅</div>
              <span>Memory Available</span>
              <span className="check-status">8GB+ Available</span>
            </div>
            <div className="check-item">
              <div className="check-icon">✅</div>
              <span>Disk Space</span>
              <span className="check-status">Sufficient</span>
            </div>
            <div className="check-item">
              <div className="check-icon">⚠️</div>
              <span>AI Model Service</span>
              <span className="check-status">Checking...</span>
            </div>
          </div>
          <div className="system-requirements">
            <h4>Requirements Met</h4>
            <ul>
              <li>macOS 10.15 or later ✓</li>
              <li>4GB+ RAM available ✓</li>
              <li>1GB free disk space ✓</li>
              <li>Internet connection for AI models ⚠️</li>
            </ul>
          </div>
          <div className="system-recommendations">
            <h4>Recommendations</h4>
            <p>For optimal performance:</p>
            <ul>
              <li>Close unnecessary applications to free memory</li>
              <li>Ensure stable internet connection for AI processing</li>
              <li>Consider installing Ollama locally for faster processing</li>
            </ul>
          </div>
        </div>
      ),
      action: {
        label: 'Run System Check',
        handler: async () => {
          setIsValidating(true);
          try {
            // Simulate system check
            await new Promise(resolve => setTimeout(resolve, 2000));
            // In real implementation, check actual system status
            setIsValidating(false);
          } catch (error) {
            setIsValidating(false);
          }
        }
      },
      skippable: true
    },
    {
      id: 'model-setup',
      title: 'AI Model Configuration',
      description: 'Configure your AI model for optimal file analysis',
      content: (
        <div className="onboarding-model-setup">
          <h3>Choose Your AI Model</h3>
          <p>Select the AI model that best fits your needs and system capabilities:</p>
          
          <div className="model-options">
            <div className="model-card recommended">
              <div className="model-header">
                <h4>llama3.2:3b</h4>
                <span className="badge">Recommended</span>
              </div>
              <div className="model-specs">
                <div className="spec">
                  <span className="spec-label">Size:</span>
                  <span className="spec-value">2.0GB</span>
                </div>
                <div className="spec">
                  <span className="spec-label">Speed:</span>
                  <span className="spec-value">Fast</span>
                </div>
                <div className="spec">
                  <span className="spec-label">Quality:</span>
                  <span className="spec-value">High</span>
                </div>
              </div>
              <p>Perfect balance of speed and accuracy for most file organization tasks.</p>
            </div>
            
            <div className="model-card">
              <div className="model-header">
                <h4>llama3.2:1b</h4>
                <span className="badge">Fast</span>
              </div>
              <div className="model-specs">
                <div className="spec">
                  <span className="spec-label">Size:</span>
                  <span className="spec-value">1.3GB</span>
                </div>
                <div className="spec">
                  <span className="spec-label">Speed:</span>
                  <span className="spec-value">Very Fast</span>
                </div>
                <div className="spec">
                  <span className="spec-label">Quality:</span>
                  <span className="spec-value">Good</span>
                </div>
              </div>
              <p>Lightweight option for quick file analysis on lower-end systems.</p>
            </div>
            
            <div className="model-card">
              <div className="model-header">
                <h4>llama3.1:8b</h4>
                <span className="badge">Advanced</span>
              </div>
              <div className="model-specs">
                <div className="spec">
                  <span className="spec-label">Size:</span>
                  <span className="spec-value">4.7GB</span>
                </div>
                <div className="spec">
                  <span className="spec-label">Speed:</span>
                  <span className="spec-value">Moderate</span>
                </div>
                <div className="spec">
                  <span className="spec-label">Quality:</span>
                  <span className="spec-value">Excellent</span>
                </div>
              </div>
              <p>Most accurate analysis for complex file organization scenarios.</p>
            </div>
          </div>
          
          <div className="model-installation">
            <h4>Installation Status</h4>
            <div className="installation-progress">
              <div className="progress-bar">
                <div className="progress-fill" style={{ width: '0%' }}></div>
              </div>
              <span className="progress-text">Ready to install selected model</span>
            </div>
          </div>
          
          <div className="model-note">
            <p><strong>Note:</strong> The selected model will be downloaded and installed locally. This ensures privacy and faster processing times.</p>
          </div>
        </div>
      ),
      action: {
        label: 'Configure Model',
        handler: async () => {
          // Simulate model configuration
          setUserProgress(prev => ({ ...prev, modelConfigured: true }));
        }
      },
      validation: () => userProgress.modelConfigured
    },
    {
      id: 'directory-selection',
      title: 'Choose Directory',
      description: 'Select a directory to organize with MaxSort',
      content: (
        <div className="onboarding-directory">
          <h3>Select Your First Directory</h3>
          <p>Choose a directory that you'd like to organize. We recommend starting with a smaller directory (under 1000 files) for your first experience.</p>
          
          <div className="directory-suggestions">
            <h4>Suggested Starting Directories:</h4>
            <div className="suggestion-cards">
              <div className="suggestion-card">
                <div className="suggestion-icon">📁</div>
                <h5>Downloads</h5>
                <p>Often the messiest folder that needs organization</p>
                <button className="btn btn-outline">Select Downloads</button>
              </div>
              <div className="suggestion-card">
                <div className="suggestion-icon">🗂️</div>
                <h5>Documents</h5>
                <p>Great for organizing work and personal files</p>
                <button className="btn btn-outline">Select Documents</button>
              </div>
              <div className="suggestion-card">
                <div className="suggestion-icon">📷</div>
                <h5>Desktop</h5>
                <p>Clean up your desktop for better productivity</p>
                <button className="btn btn-outline">Select Desktop</button>
              </div>
            </div>
          </div>
          
          <div className="directory-picker-container">
            <h4>Or Choose Custom Directory:</h4>
            <div className="directory-picker">
              <div className="selected-directory">
                <span className="directory-path">No directory selected</span>
                <button className="btn btn-primary">Browse...</button>
              </div>
              <div className="directory-info">
                <div className="info-item">
                  <span className="info-label">Files:</span>
                  <span className="info-value">-</span>
                </div>
                <div className="info-item">
                  <span className="info-label">Size:</span>
                  <span className="info-value">-</span>
                </div>
                <div className="info-item">
                  <span className="info-label">Types:</span>
                  <span className="info-value">-</span>
                </div>
              </div>
            </div>
          </div>
          
          <div className="directory-tips">
            <h4>💡 Tips for Better Results</h4>
            <ul>
              <li>Start with directories containing 50-500 files for best experience</li>
              <li>Avoid system directories (Applications, System, Library)</li>
              <li>Make sure you have write permissions to the selected directory</li>
              <li>Consider backing up important files before organizing</li>
            </ul>
          </div>
        </div>
      ),
      action: {
        label: 'Select Directory',
        handler: async () => {
          try {
            const result = await window.electronAPI?.invoke('directory:select');
            if (result?.path) {
              setUserProgress(prev => ({ ...prev, directorySelected: true }));
              dispatch({
                type: 'SET_DIRECTORY',
                payload: result.path
              });
            }
          } catch (error) {
            console.error('Failed to select directory:', error);
          }
        }
      },
      validation: () => userProgress.directorySelected
    },
    {
      id: 'first-scan',
      title: 'Your First Scan',
      description: 'Experience the power of AI-driven file analysis',
      content: (
        <div className="onboarding-first-scan">
          <h3>Let's Analyze Your Files</h3>
          <p>Now we'll perform your first file analysis to show you how MaxSort works. This process will:</p>
          
          <div className="scan-process">
            <div className="process-step">
              <div className="step-icon">1</div>
              <div className="step-content">
                <h4>Scan Directory</h4>
                <p>Discover all files in your selected directory</p>
              </div>
            </div>
            <div className="process-step">
              <div className="step-icon">2</div>
              <div className="step-content">
                <h4>Analyze Content</h4>
                <p>AI analyzes file names, types, and content patterns</p>
              </div>
            </div>
            <div className="process-step">
              <div className="step-icon">3</div>
              <div className="step-content">
                <h4>Generate Suggestions</h4>
                <p>Create intelligent organization suggestions</p>
              </div>
            </div>
            <div className="process-step">
              <div className="step-icon">4</div>
              <div className="step-content">
                <h4>Review Results</h4>
                <p>Preview and approve suggested changes</p>
              </div>
            </div>
          </div>
          
          <div className="scan-preview">
            <h4>What You'll See:</h4>
            <div className="preview-items">
              <div className="preview-item">
                <span className="preview-icon">📊</span>
                <span>File analysis with confidence scores</span>
              </div>
              <div className="preview-item">
                <span className="preview-icon">🏷️</span>
                <span>Intelligent renaming suggestions</span>
              </div>
              <div className="preview-item">
                <span className="preview-icon">📁</span>
                <span>Folder organization recommendations</span>
              </div>
              <div className="preview-item">
                <span className="preview-icon">🔍</span>
                <span>Detailed before/after preview</span>
              </div>
            </div>
          </div>
          
          <div className="scan-safety">
            <div className="safety-notice">
              <h4>🔒 Safety First</h4>
              <p>Don't worry - this is just a preview! No files will be moved or renamed until you explicitly approve the changes. You can also undo any operation at any time.</p>
            </div>
          </div>
        </div>
      ),
      action: {
        label: 'Start First Scan',
        handler: async () => {
          try {
            // Simulate scan process
            setIsValidating(true);
            await new Promise(resolve => setTimeout(resolve, 3000));
            setUserProgress(prev => ({ ...prev, firstScanCompleted: true }));
            setIsValidating(false);
          } catch (error) {
            setIsValidating(false);
          }
        }
      },
      validation: () => userProgress.firstScanCompleted
    },
    {
      id: 'completion',
      title: 'You\'re All Set!',
      description: 'Welcome to efficient file organization',
      content: (
        <div className="onboarding-completion">
          <div className="completion-celebration">
            <div className="celebration-icon">🎉</div>
            <h2>Congratulations!</h2>
            <p className="celebration-message">
              You've successfully set up MaxSort and completed your first file analysis.
            </p>
          </div>
          
          <div className="completion-summary">
            <h3>What You've Accomplished:</h3>
            <div className="achievement-list">
              <div className="achievement">
                <span className="achievement-icon">✅</span>
                <span>System compatibility verified</span>
              </div>
              <div className="achievement">
                <span className="achievement-icon">✅</span>
                <span>AI model configured and ready</span>
              </div>
              <div className="achievement">
                <span className="achievement-icon">✅</span>
                <span>Directory selected and scanned</span>
              </div>
              <div className="achievement">
                <span className="achievement-icon">✅</span>
                <span>First file analysis completed</span>
              </div>
            </div>
          </div>
          
          <div className="next-steps">
            <h3>Next Steps:</h3>
            <div className="next-step-cards">
              <div className="next-step-card">
                <h4>Review Suggestions</h4>
                <p>Check out the AI-generated organization suggestions for your files</p>
                <button className="btn btn-outline">View Results</button>
              </div>
              <div className="next-step-card">
                <h4>Explore Features</h4>
                <p>Take a quick tour of MaxSort's powerful features and capabilities</p>
                <button className="btn btn-outline">Start Tour</button>
              </div>
              <div className="next-step-card">
                <h4>Customize Settings</h4>
                <p>Adjust preferences, themes, and performance settings to your liking</p>
                <button className="btn btn-outline">Open Settings</button>
              </div>
            </div>
          </div>
          
          <div className="completion-help">
            <h4>Need Help?</h4>
            <p>Check out our comprehensive help system anytime by clicking the help icon (❓) in the navigation bar, or press <kbd>F1</kbd> for contextual assistance.</p>
          </div>
        </div>
      ),
      skippable: false
    }
  ];

  const currentStepData = steps[currentStep];
  const isLastStep = currentStep === steps.length - 1;
  const canProceed = !currentStepData.validation || currentStepData.validation();

  useEffect(() => {
    // Load onboarding progress from localStorage
    const savedProgress = localStorage.getItem('maxsort-onboarding-progress');
    if (savedProgress) {
      try {
        const progress = JSON.parse(savedProgress);
        setUserProgress(progress.userProgress || userProgress);
        setCompletedSteps(new Set(progress.completedSteps || []));
        setCurrentStep(progress.currentStep || 0);
      } catch (error) {
        console.error('Failed to load onboarding progress:', error);
      }
    }
  }, []);

  const saveProgress = () => {
    const progress = {
      currentStep,
      completedSteps: Array.from(completedSteps),
      userProgress
    };
    localStorage.setItem('maxsort-onboarding-progress', JSON.stringify(progress));
  };

  const handleNext = async () => {
    if (currentStepData.action) {
      setIsValidating(true);
      try {
        await currentStepData.action.handler();
        setCompletedSteps(prev => new Set([...prev, currentStepData.id]));
      } catch (error) {
        console.error('Step action failed:', error);
      } finally {
        setIsValidating(false);
      }
    }

    if (canProceed) {
      if (isLastStep) {
        onComplete();
      } else {
        const nextStep = currentStep + 1;
        setCurrentStep(nextStep);
        setCompletedSteps(prev => new Set([...prev, currentStepData.id]));
        saveProgress();
      }
    }
  };

  const handlePrevious = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
      saveProgress();
    }
  };

  const handleSkip = () => {
    if (currentStepData.skippable) {
      if (isLastStep) {
        onComplete();
      } else {
        setCurrentStep(currentStep + 1);
        saveProgress();
      }
    }
  };

  const handleSkipAll = () => {
    onSkip();
  };

  return (
    <div className="onboarding-overlay">
      <div className="onboarding-container">
        <div className="onboarding-header">
          <div className="onboarding-progress">
            <div className="progress-bar">
              <div 
                className="progress-fill"
                style={{ width: `${((currentStep + 1) / steps.length) * 100}%` }}
              />
            </div>
            <span className="progress-text">
              Step {currentStep + 1} of {steps.length}
            </span>
          </div>
          <button 
            className="onboarding-skip-all"
            onClick={handleSkipAll}
            title="Skip onboarding"
          >
            Skip All
          </button>
        </div>

        <div className="onboarding-content">
          <div className="step-header">
            <h1 className="step-title">{currentStepData.title}</h1>
            <p className="step-description">{currentStepData.description}</p>
          </div>

          <div className="step-content">
            {currentStepData.content}
          </div>
        </div>

        <div className="onboarding-footer">
          <div className="onboarding-navigation">
            <button
              className="btn btn-outline"
              onClick={handlePrevious}
              disabled={currentStep === 0}
            >
              Previous
            </button>

            <div className="navigation-center">
              {currentStepData.skippable && (
                <button
                  className="btn btn-text"
                  onClick={handleSkip}
                >
                  Skip This Step
                </button>
              )}
            </div>

            <button
              className="btn btn-primary"
              onClick={handleNext}
              disabled={isValidating || (!canProceed && !currentStepData.skippable)}
            >
              {isValidating ? 'Processing...' : 
               isLastStep ? 'Get Started' : 
               currentStepData.action ? currentStepData.action.label : 'Next'}
            </button>
          </div>
        </div>

        <div className="onboarding-step-indicators">
          {steps.map((step, index) => (
            <div
              key={step.id}
              className={`step-indicator ${
                index === currentStep ? 'active' :
                completedSteps.has(step.id) ? 'completed' :
                index < currentStep ? 'completed' : 'upcoming'
              }`}
              onClick={() => {
                if (index <= currentStep || completedSteps.has(step.id)) {
                  setCurrentStep(index);
                }
              }}
              title={step.title}
            >
              {completedSteps.has(step.id) ? '✓' : index + 1}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default OnboardingFlow;
