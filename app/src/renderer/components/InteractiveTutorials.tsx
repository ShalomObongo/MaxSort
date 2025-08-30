import React, { useState, useEffect } from 'react';
import './InteractiveTutorials.css';

interface TutorialStep {
  id: string;
  title: string;
  content: React.ReactNode;
  targetSelector?: string;
  action?: {
    type: 'click' | 'input' | 'wait' | 'navigate';
    selector?: string;
    value?: string;
    timeout?: number;
  };
  validation?: () => boolean;
}

interface Tutorial {
  id: string;
  title: string;
  description: string;
  category: 'getting-started' | 'advanced' | 'tips-tricks';
  duration: string;
  difficulty: 'beginner' | 'intermediate' | 'advanced';
  prerequisite?: string[];
  steps: TutorialStep[];
}

interface InteractiveTutorialsProps {
  onTutorialComplete?: (tutorialId: string) => void;
  onTutorialStart?: (tutorialId: string) => void;
}

const InteractiveTutorials: React.FC<InteractiveTutorialsProps> = ({
  onTutorialComplete,
  onTutorialStart
}) => {
  const [selectedTutorial, setSelectedTutorial] = useState<Tutorial | null>(null);
  const [currentStep, setCurrentStep] = useState(0);
  const [completedTutorials, setCompletedTutorials] = useState<Set<string>>(new Set());
  const [isPlaying, setIsPlaying] = useState(false);
  const [highlightElement, setHighlightElement] = useState<Element | null>(null);

  // Tutorial definitions
  const tutorials: Tutorial[] = [
    {
      id: 'first-file-analysis',
      title: 'Your First File Analysis',
      description: 'Learn how to select a directory, configure AI models, and analyze files for organization suggestions.',
      category: 'getting-started',
      duration: '5 min',
      difficulty: 'beginner',
      steps: [
        {
          id: 'welcome',
          title: 'Welcome to MaxSort',
          content: (
            <div className="tutorial-welcome">
              <h3>Let's Get Started! 🚀</h3>
              <p>This tutorial will walk you through your first file analysis with MaxSort. You'll learn how to:</p>
              <ul>
                <li>Select a directory to organize</li>
                <li>Configure AI models for analysis</li>
                <li>Review and apply suggestions</li>
                <li>Use the undo system for safety</li>
              </ul>
              <p><strong>This tutorial is completely safe</strong> - we'll use preview mode so no files will be actually moved.</p>
            </div>
          )
        },
        {
          id: 'select-directory',
          title: 'Select a Directory',
          content: (
            <div className="tutorial-step">
              <h3>Step 1: Choose Your Directory</h3>
              <p>First, let's select a directory to organize. For this tutorial, we recommend choosing a folder with a few test files (10-50 files work best).</p>
              <p><strong>Click the "Browse" button</strong> to open the directory picker.</p>
              <div className="tutorial-tip">
                <strong>💡 Tip:</strong> You can also drag and drop a folder directly onto the main window!
              </div>
            </div>
          ),
          targetSelector: '[data-feature="directory-picker"]',
          action: {
            type: 'click',
            selector: '[data-feature="directory-picker"] button'
          }
        },
        {
          id: 'configure-model',
          title: 'Configure AI Model',
          content: (
            <div className="tutorial-step">
              <h3>Step 2: Choose Your AI Model</h3>
              <p>MaxSort uses AI models to understand your files and suggest improvements. Let's select a model that's right for your system.</p>
              <p><strong>Click on "Model Configuration"</strong> to see available options.</p>
              <div className="tutorial-options">
                <div className="option-card">
                  <h4>🚀 llama3.2:3b (Recommended)</h4>
                  <p>Best balance of speed and accuracy</p>
                </div>
                <div className="option-card">
                  <h4>⚡ llama3.2:1b (Fast)</h4>
                  <p>Faster processing, good for quick tasks</p>
                </div>
              </div>
            </div>
          ),
          targetSelector: '[data-feature="model-selector"]',
          action: {
            type: 'click',
            selector: '[data-feature="model-selector"]'
          }
        },
        {
          id: 'start-analysis',
          title: 'Start Analysis',
          content: (
            <div className="tutorial-step">
              <h3>Step 3: Analyze Your Files</h3>
              <p>Now that we have a directory and model selected, let's analyze your files! This process will:</p>
              <ol>
                <li><strong>Scan</strong> all files in your directory</li>
                <li><strong>Analyze</strong> file names and patterns</li>
                <li><strong>Generate</strong> intelligent suggestions</li>
                <li><strong>Display</strong> results with confidence scores</li>
              </ol>
              <p><strong>Click "Start Analysis"</strong> to begin the process.</p>
              <div className="tutorial-safety">
                <strong>🔒 Safe Mode:</strong> This is just a preview - no files will be moved until you approve!
              </div>
            </div>
          ),
          targetSelector: '[data-feature="start-analysis"]',
          action: {
            type: 'click',
            selector: '[data-feature="start-analysis"]'
          }
        },
        {
          id: 'review-results',
          title: 'Review Suggestions',
          content: (
            <div className="tutorial-step">
              <h3>Step 4: Review AI Suggestions</h3>
              <p>Great! MaxSort has analyzed your files and generated suggestions. Let's understand what you're seeing:</p>
              <div className="confidence-guide">
                <div className="confidence-item high">
                  <div className="confidence-indicator">90-100%</div>
                  <div className="confidence-desc">
                    <strong>High Confidence</strong><br />
                    These suggestions are very reliable and safe to apply automatically.
                  </div>
                </div>
                <div className="confidence-item medium">
                  <div className="confidence-indicator">70-89%</div>
                  <div className="confidence-desc">
                    <strong>Medium Confidence</strong><br />
                    Good suggestions that might benefit from a quick review.
                  </div>
                </div>
                <div className="confidence-item low">
                  <div className="confidence-indicator">&lt;70%</div>
                  <div className="confidence-desc">
                    <strong>Low Confidence</strong><br />
                    Requires manual verification before applying.
                  </div>
                </div>
              </div>
              <p><strong>Try clicking on a suggestion</strong> to see the detailed preview.</p>
            </div>
          ),
          targetSelector: '[data-feature="analysis-results"]'
        },
        {
          id: 'preview-changes',
          title: 'Preview Changes',
          content: (
            <div className="tutorial-step">
              <h3>Step 5: Preview Before/After</h3>
              <p>Excellent! You can see a detailed preview showing exactly what will happen to each file. This includes:</p>
              <ul>
                <li><strong>Current name</strong> → <strong>Suggested name</strong></li>
                <li><strong>Current location</strong> → <strong>New location</strong></li>
                <li><strong>Reason</strong> for the suggestion</li>
                <li><strong>Confidence score</strong> and explanation</li>
              </ul>
              <p>You can <strong>approve individual suggestions</strong> or <strong>approve all high-confidence ones</strong> at once.</p>
              <div className="tutorial-tip">
                <strong>💡 Pro Tip:</strong> Use the filters at the top to focus on specific confidence levels or file types!
              </div>
            </div>
          ),
          targetSelector: '[data-feature="preview-modal"]'
        },
        {
          id: 'apply-changes',
          title: 'Apply Changes',
          content: (
            <div className="tutorial-step">
              <h3>Step 6: Apply Approved Changes</h3>
              <p>Now you can apply the changes you've approved. MaxSort will:</p>
              <ol>
                <li>Create a backup point for undo capability</li>
                <li>Move/rename files according to your approvals</li>
                <li>Show real-time progress</li>
                <li>Log all operations for review</li>
              </ol>
              <p><strong>Click "Apply Changes"</strong> to execute the approved operations.</p>
              <div className="tutorial-safety">
                <strong>🔄 Fully Reversible:</strong> Every operation can be undone with Cmd+Z or the History tab!
              </div>
            </div>
          ),
          targetSelector: '[data-feature="apply-changes"]',
          action: {
            type: 'click',
            selector: '[data-feature="apply-changes"]'
          }
        },
        {
          id: 'completion',
          title: 'Tutorial Complete!',
          content: (
            <div className="tutorial-completion">
              <h3>🎉 Congratulations!</h3>
              <p>You've successfully completed your first file analysis with MaxSort! You now know how to:</p>
              <div className="completion-checklist">
                <div className="checklist-item">✅ Select and scan directories</div>
                <div className="checklist-item">✅ Configure AI models</div>
                <div className="checklist-item">✅ Review suggestions with confidence scores</div>
                <div className="checklist-item">✅ Preview changes before applying</div>
                <div className="checklist-item">✅ Apply approved changes safely</div>
              </div>
              <div className="next-tutorials">
                <h4>What's Next?</h4>
                <p>Try these tutorials to become a MaxSort expert:</p>
                <ul>
                  <li><strong>Advanced Batch Operations</strong> - Process thousands of files efficiently</li>
                  <li><strong>Custom Organization Rules</strong> - Create personalized file organization patterns</li>
                  <li><strong>System Optimization</strong> - Tune performance for your workflow</li>
                </ul>
              </div>
            </div>
          )
        }
      ]
    },
    {
      id: 'batch-operations',
      title: 'Advanced Batch Operations',
      description: 'Master large-scale file organization with batch processing, queues, and automation.',
      category: 'advanced',
      duration: '8 min',
      difficulty: 'intermediate',
      prerequisite: ['first-file-analysis'],
      steps: [
        {
          id: 'intro',
          title: 'Batch Operations Overview',
          content: (
            <div className="tutorial-step">
              <h3>Processing Files at Scale 📊</h3>
              <p>MaxSort's batch operations let you organize thousands of files efficiently. In this tutorial, you'll learn:</p>
              <ul>
                <li>How to configure batch processing settings</li>
                <li>Managing operation queues and priorities</li>
                <li>Monitoring progress and performance</li>
                <li>Handling errors and conflicts</li>
              </ul>
            </div>
          )
        },
        {
          id: 'batch-settings',
          title: 'Configure Batch Settings',
          content: (
            <div className="tutorial-step">
              <h3>Optimize for Your System</h3>
              <p>Before processing large batches, let's configure settings for optimal performance:</p>
              <div className="settings-guide">
                <div className="setting-item">
                  <strong>Batch Size:</strong> Number of files processed together (50-500 recommended)
                </div>
                <div className="setting-item">
                  <strong>Concurrency:</strong> How many operations run simultaneously (2-8 recommended)
                </div>
                <div className="setting-item">
                  <strong>Memory Limit:</strong> Maximum memory usage (adjust based on available RAM)
                </div>
              </div>
              <p><strong>Open Settings → Performance</strong> to configure these options.</p>
            </div>
          ),
          targetSelector: '[data-feature="performance-tab"]'
        }
      ]
    },
    {
      id: 'keyboard-shortcuts',
      title: 'Keyboard Shortcuts & Power User Tips',
      description: 'Accelerate your workflow with keyboard shortcuts and advanced features.',
      category: 'tips-tricks',
      duration: '4 min',
      difficulty: 'beginner',
      steps: [
        {
          id: 'shortcuts-overview',
          title: 'Essential Shortcuts',
          content: (
            <div className="tutorial-step">
              <h3>Speed Up Your Workflow ⚡</h3>
              <p>Master these keyboard shortcuts to work more efficiently:</p>
              <div className="shortcuts-grid">
                <div className="shortcut-item">
                  <kbd>Cmd+O</kbd>
                  <span>Open Directory</span>
                </div>
                <div className="shortcut-item">
                  <kbd>Cmd+R</kbd>
                  <span>Run Analysis</span>
                </div>
                <div className="shortcut-item">
                  <kbd>Cmd+Z</kbd>
                  <span>Undo Operation</span>
                </div>
                <div className="shortcut-item">
                  <kbd>Cmd+S</kbd>
                  <span>Open Settings</span>
                </div>
                <div className="shortcut-item">
                  <kbd>F1</kbd>
                  <span>Contextual Help</span>
                </div>
                <div className="shortcut-item">
                  <kbd>Space</kbd>
                  <span>Preview Selection</span>
                </div>
              </div>
              <p><strong>Try pressing F1</strong> to see context-sensitive help based on what you're doing!</p>
            </div>
          )
        }
      ]
    }
  ];

  useEffect(() => {
    // Load completed tutorials from localStorage
    const saved = localStorage.getItem('maxsort-completed-tutorials');
    if (saved) {
      try {
        setCompletedTutorials(new Set(JSON.parse(saved)));
      } catch (error) {
        console.error('Failed to load completed tutorials:', error);
      }
    }
  }, []);

  const startTutorial = (tutorial: Tutorial) => {
    setSelectedTutorial(tutorial);
    setCurrentStep(0);
    setIsPlaying(true);
    onTutorialStart?.(tutorial.id);
  };

  const nextStep = () => {
    if (selectedTutorial && currentStep < selectedTutorial.steps.length - 1) {
      setCurrentStep(currentStep + 1);
    } else {
      completeTutorial();
    }
  };

  const previousStep = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
    }
  };

  const completeTutorial = () => {
    if (selectedTutorial) {
      const newCompleted = new Set([...completedTutorials, selectedTutorial.id]);
      setCompletedTutorials(newCompleted);
      localStorage.setItem('maxsort-completed-tutorials', JSON.stringify([...newCompleted]));
      onTutorialComplete?.(selectedTutorial.id);
    }
    
    setSelectedTutorial(null);
    setCurrentStep(0);
    setIsPlaying(false);
    setHighlightElement(null);
  };

  const exitTutorial = () => {
    setSelectedTutorial(null);
    setCurrentStep(0);
    setIsPlaying(false);
    setHighlightElement(null);
  };

  useEffect(() => {
    if (selectedTutorial && isPlaying) {
      const currentStepData = selectedTutorial.steps[currentStep];
      
      if (currentStepData.targetSelector) {
        const element = document.querySelector(currentStepData.targetSelector);
        if (element) {
          setHighlightElement(element);
          element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      } else {
        setHighlightElement(null);
      }
    }
  }, [selectedTutorial, currentStep, isPlaying]);

  useEffect(() => {
    if (highlightElement) {
      highlightElement.classList.add('tutorial-highlight');
      return () => {
        highlightElement.classList.remove('tutorial-highlight');
      };
    }
  }, [highlightElement]);

  const getDifficultyColor = (difficulty: Tutorial['difficulty']) => {
    switch (difficulty) {
      case 'beginner': return '#4CAF50';
      case 'intermediate': return '#FF9800';
      case 'advanced': return '#F44336';
      default: return '#9E9E9E';
    }
  };

  const getCategoryIcon = (category: Tutorial['category']) => {
    switch (category) {
      case 'getting-started': return '🚀';
      case 'advanced': return '🎓';
      case 'tips-tricks': return '💡';
      default: return '📚';
    }
  };

  const canStartTutorial = (tutorial: Tutorial) => {
    if (!tutorial.prerequisite) return true;
    return tutorial.prerequisite.every(prereq => completedTutorials.has(prereq));
  };

  if (selectedTutorial && isPlaying) {
    const currentStepData = selectedTutorial.steps[currentStep];
    
    return (
      <div className="tutorial-overlay">
        <div className="tutorial-player">
          <div className="tutorial-header">
            <div className="tutorial-info">
              <h2>{selectedTutorial.title}</h2>
              <div className="tutorial-progress">
                <div className="progress-bar">
                  <div 
                    className="progress-fill"
                    style={{ width: `${((currentStep + 1) / selectedTutorial.steps.length) * 100}%` }}
                  />
                </div>
                <span className="progress-text">
                  Step {currentStep + 1} of {selectedTutorial.steps.length}
                </span>
              </div>
            </div>
            <button className="tutorial-exit" onClick={exitTutorial}>
              ✕
            </button>
          </div>
          
          <div className="tutorial-content">
            <h3>{currentStepData.title}</h3>
            <div className="tutorial-step-content">
              {currentStepData.content}
            </div>
          </div>
          
          <div className="tutorial-controls">
            <button 
              className="btn btn-outline"
              onClick={previousStep}
              disabled={currentStep === 0}
            >
              Previous
            </button>
            
            <button className="btn btn-text" onClick={exitTutorial}>
              Exit Tutorial
            </button>
            
            <button 
              className="btn btn-primary"
              onClick={nextStep}
            >
              {currentStep === selectedTutorial.steps.length - 1 ? 'Complete' : 'Next'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="interactive-tutorials">
      <div className="tutorials-header">
        <h2>Interactive Tutorials</h2>
        <p>Learn MaxSort step-by-step with hands-on guidance</p>
      </div>
      
      <div className="tutorials-categories">
        {['getting-started', 'advanced', 'tips-tricks'].map(category => {
          const categoryTutorials = tutorials.filter(t => t.category === category);
          if (categoryTutorials.length === 0) return null;
          
          return (
            <div key={category} className="tutorial-category">
              <h3 className="category-header">
                {getCategoryIcon(category as Tutorial['category'])}
                {category.replace('-', ' ').replace(/\b\w/g, l => l.toUpperCase())}
              </h3>
              
              <div className="tutorials-grid">
                {categoryTutorials.map(tutorial => (
                  <div 
                    key={tutorial.id} 
                    className={`tutorial-card ${completedTutorials.has(tutorial.id) ? 'completed' : ''} ${!canStartTutorial(tutorial) ? 'locked' : ''}`}
                  >
                    <div className="tutorial-card-header">
                      <h4>{tutorial.title}</h4>
                      <div className="tutorial-badges">
                        {completedTutorials.has(tutorial.id) && (
                          <span className="badge completed">✓ Completed</span>
                        )}
                        <span 
                          className="badge difficulty"
                          style={{ backgroundColor: getDifficultyColor(tutorial.difficulty) }}
                        >
                          {tutorial.difficulty}
                        </span>
                      </div>
                    </div>
                    
                    <p className="tutorial-description">{tutorial.description}</p>
                    
                    <div className="tutorial-meta">
                      <span className="tutorial-duration">🕒 {tutorial.duration}</span>
                      <span className="tutorial-steps">{tutorial.steps.length} steps</span>
                    </div>
                    
                    {tutorial.prerequisite && !canStartTutorial(tutorial) && (
                      <div className="tutorial-prerequisite">
                        <small>Complete "{tutorials.find(t => t.id === tutorial.prerequisite![0])?.title}" first</small>
                      </div>
                    )}
                    
                    <div className="tutorial-actions">
                      <button 
                        className="btn btn-primary"
                        onClick={() => startTutorial(tutorial)}
                        disabled={!canStartTutorial(tutorial)}
                      >
                        {completedTutorials.has(tutorial.id) ? 'Replay' : 'Start Tutorial'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default InteractiveTutorials;
