import React, { useState, useEffect } from 'react';
import InteractiveTutorials from './InteractiveTutorials';
import ContextualHelp from './ContextualHelp';
import FeatureDiscovery from './FeatureDiscovery';
import './HelpSystem.css';

interface HelpSystemProps {
  isVisible?: boolean;
  initialView?: 'tutorials' | 'help' | 'discovery';
  currentContext?: string;
  onClose?: () => void;
  onTutorialComplete?: (tutorialId: string) => void;
  onFeatureDiscovered?: (featureId: string) => void;
}

const HelpSystem: React.FC<HelpSystemProps> = ({
  isVisible = false,
  initialView = 'tutorials',
  currentContext = 'general',
  onClose,
  onTutorialComplete,
  onFeatureDiscovered
}) => {
  const [activeView, setActiveView] = useState<'tutorials' | 'help' | 'discovery'>(initialView);
  const [helpContext, setHelpContext] = useState(currentContext);
  const [userProgress, setUserProgress] = useState({
    completedTutorials: new Set<string>(),
    discoveredFeatures: new Set<string>(),
    helpTopicsViewed: new Set<string>()
  });

  // Load user progress from localStorage
  useEffect(() => {
    try {
      const savedProgress = {
        completedTutorials: new Set(JSON.parse(localStorage.getItem('maxsort-completed-tutorials') || '[]') as string[]),
        discoveredFeatures: new Set(JSON.parse(localStorage.getItem('maxsort-discovered-features') || '[]') as string[]),
        helpTopicsViewed: new Set(JSON.parse(localStorage.getItem('maxsort-help-topics-viewed') || '[]') as string[])
      };
      setUserProgress(savedProgress);
    } catch (error) {
      console.error('Failed to load user progress:', error);
    }
  }, []);

  // Handle tutorial completion
  const handleTutorialComplete = (tutorialId: string) => {
    const newCompleted = new Set([...userProgress.completedTutorials, tutorialId]);
    const updatedProgress = {
      ...userProgress,
      completedTutorials: newCompleted
    };
    
    setUserProgress(updatedProgress);
    localStorage.setItem('maxsort-completed-tutorials', JSON.stringify([...newCompleted]));
    onTutorialComplete?.(tutorialId);
  };

  // Handle feature discovery
  const handleFeatureDiscovery = (featureId: string) => {
    const newDiscovered = new Set([...userProgress.discoveredFeatures, featureId]);
    const updatedProgress = {
      ...userProgress,
      discoveredFeatures: newDiscovered
    };
    
    setUserProgress(updatedProgress);
    localStorage.setItem('maxsort-discovered-features', JSON.stringify([...newDiscovered]));
    onFeatureDiscovered?.(featureId);
  };

  // Handle help topic viewing
  const handleHelpTopicView = (topicId: string) => {
    const newViewed = new Set([...userProgress.helpTopicsViewed, topicId]);
    const updatedProgress = {
      ...userProgress,
      helpTopicsViewed: newViewed
    };
    
    setUserProgress(updatedProgress);
    localStorage.setItem('maxsort-help-topics-viewed', JSON.stringify([...newViewed]));
  };

  // Update context when it changes
  useEffect(() => {
    setHelpContext(currentContext);
  }, [currentContext]);

  // Handle keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!isVisible) return;

      if (event.key === 'Escape') {
        onClose?.();
      }
      
      if (event.key === '1' && event.metaKey) {
        setActiveView('tutorials');
        event.preventDefault();
      }
      
      if (event.key === '2' && event.metaKey) {
        setActiveView('help');
        event.preventDefault();
      }
      
      if (event.key === '3' && event.metaKey) {
        setActiveView('discovery');
        event.preventDefault();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isVisible, onClose]);

  if (!isVisible) {
    return (
      <>
        {/* Feature Discovery runs independently */}
        <FeatureDiscovery />
      </>
    );
  }

  const getProgressStats = () => {
    const totalTutorials = 3; // Based on InteractiveTutorials component
    const totalFeatures = 8; // Based on FeatureDiscovery component
    const totalHelpTopics = 7; // Based on ContextualHelp component
    
    return {
      tutorials: {
        completed: userProgress.completedTutorials.size,
        total: totalTutorials,
        percentage: Math.round((userProgress.completedTutorials.size / totalTutorials) * 100)
      },
      features: {
        discovered: userProgress.discoveredFeatures.size,
        total: totalFeatures,
        percentage: Math.round((userProgress.discoveredFeatures.size / totalFeatures) * 100)
      },
      help: {
        viewed: userProgress.helpTopicsViewed.size,
        total: totalHelpTopics,
        percentage: Math.round((userProgress.helpTopicsViewed.size / totalHelpTopics) * 100)
      }
    };
  };

  const stats = getProgressStats();

  return (
    <div className="help-system-overlay">
      <div className="help-system">
        <div className="help-system-header">
          <div className="help-system-title">
            <h1>MaxSort Help Center</h1>
            <p>Learn, discover, and get support</p>
          </div>
          
          <div className="help-system-progress">
            <div className="progress-item">
              <div className="progress-label">Tutorials</div>
              <div className="progress-bar">
                <div 
                  className="progress-fill"
                  style={{ width: `${stats.tutorials.percentage}%` }}
                />
              </div>
              <div className="progress-text">{stats.tutorials.completed}/{stats.tutorials.total}</div>
            </div>
            
            <div className="progress-item">
              <div className="progress-label">Features</div>
              <div className="progress-bar">
                <div 
                  className="progress-fill"
                  style={{ width: `${stats.features.percentage}%` }}
                />
              </div>
              <div className="progress-text">{stats.features.discovered}/{stats.features.total}</div>
            </div>
          </div>
          
          <button className="help-system-close" onClick={onClose}>
            ✕
          </button>
        </div>
        
        <div className="help-system-nav">
          <button
            className={`nav-tab ${activeView === 'tutorials' ? 'active' : ''}`}
            onClick={() => setActiveView('tutorials')}
          >
            <span className="nav-icon">🎓</span>
            <span className="nav-label">Interactive Tutorials</span>
            <span className="nav-shortcut">⌘1</span>
          </button>
          
          <button
            className={`nav-tab ${activeView === 'help' ? 'active' : ''}`}
            onClick={() => setActiveView('help')}
          >
            <span className="nav-icon">📚</span>
            <span className="nav-label">Help & Documentation</span>
            <span className="nav-shortcut">⌘2</span>
          </button>
          
          <button
            className={`nav-tab ${activeView === 'discovery' ? 'active' : ''}`}
            onClick={() => setActiveView('discovery')}
          >
            <span className="nav-icon">🔍</span>
            <span className="nav-label">Feature Discovery</span>
            <span className="nav-shortcut">⌘3</span>
          </button>
        </div>
        
        <div className="help-system-content">
          {activeView === 'tutorials' && (
            <InteractiveTutorials
              onTutorialComplete={handleTutorialComplete}
              onTutorialStart={(id) => console.log('Tutorial started:', id)}
            />
          )}
          
          {activeView === 'help' && (
            <ContextualHelp
              currentContext={helpContext}
              isVisible={true}
              onClose={() => {}} // Don't close the whole system, just switch views
            />
          )}
          
          {activeView === 'discovery' && (
            <div className="discovery-view">
              <div className="discovery-header">
                <h2>Feature Discovery Center</h2>
                <p>Explore MaxSort's capabilities and discover new features</p>
              </div>
              
              <div className="discovery-stats">
                <div className="stat-card">
                  <div className="stat-number">{stats.features.discovered}</div>
                  <div className="stat-label">Features Discovered</div>
                  <div className="stat-progress">
                    <div 
                      className="stat-progress-fill"
                      style={{ width: `${stats.features.percentage}%` }}
                    />
                  </div>
                </div>
                
                <div className="stat-card">
                  <div className="stat-number">{stats.tutorials.completed}</div>
                  <div className="stat-label">Tutorials Completed</div>
                  <div className="stat-progress">
                    <div 
                      className="stat-progress-fill"
                      style={{ width: `${stats.tutorials.percentage}%` }}
                    />
                  </div>
                </div>
              </div>
              
              <div className="discovery-controls">
                <h3>Feature Discovery Settings</h3>
                <div className="discovery-options">
                  <label className="discovery-option">
                    <input 
                      type="checkbox" 
                      defaultChecked
                      onChange={(e) => {
                        localStorage.setItem('maxsort-feature-discovery-enabled', e.target.checked.toString());
                      }}
                    />
                    <span>Enable feature discovery tooltips</span>
                  </label>
                  
                  <label className="discovery-option">
                    <input 
                      type="checkbox"
                      defaultChecked={false}
                      onChange={(e) => {
                        localStorage.setItem('maxsort-advanced-features-enabled', e.target.checked.toString());
                      }}
                    />
                    <span>Show advanced features</span>
                  </label>
                  
                  <label className="discovery-option">
                    <input 
                      type="checkbox"
                      defaultChecked
                      onChange={(e) => {
                        localStorage.setItem('maxsort-context-hints-enabled', e.target.checked.toString());
                      }}
                    />
                    <span>Show contextual hints</span>
                  </label>
                </div>
                
                <div className="discovery-actions">
                  <button 
                    className="btn btn-outline"
                    onClick={() => {
                      // Reset all discovered features
                      localStorage.removeItem('maxsort-discovered-features');
                      setUserProgress(prev => ({
                        ...prev,
                        discoveredFeatures: new Set()
                      }));
                    }}
                  >
                    Reset Discovery Progress
                  </button>
                  
                  <button 
                    className="btn btn-primary"
                    onClick={() => {
                      // Trigger feature discovery tour
                      setActiveView('tutorials');
                    }}
                  >
                    Start Feature Tour
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
        
        <div className="help-system-footer">
          <div className="footer-links">
            <a href="#" onClick={(e) => { e.preventDefault(); /* Open documentation */ }}>
              Documentation
            </a>
            <a href="#" onClick={(e) => { e.preventDefault(); /* Open support */ }}>
              Support
            </a>
            <a href="#" onClick={(e) => { e.preventDefault(); /* Open feedback */ }}>
              Feedback
            </a>
            <a href="#" onClick={(e) => { e.preventDefault(); /* Open shortcuts */ }}>
              Keyboard Shortcuts
            </a>
          </div>
          
          <div className="footer-context">
            Current Context: <span className="context-indicator">{helpContext}</span>
            {helpContext !== 'general' && (
              <button 
                className="btn btn-small btn-text"
                onClick={() => setHelpContext('general')}
              >
                Clear Context
              </button>
            )}
          </div>
        </div>
      </div>
      
      {/* Independent Feature Discovery */}
      <FeatureDiscovery />
    </div>
  );
};

export default HelpSystem;
