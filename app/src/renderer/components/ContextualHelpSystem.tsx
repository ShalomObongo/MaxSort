import React, { useState, useEffect, useRef, createContext, useContext } from 'react';
import './ContextualHelpSystem.css';

interface HelpItem {
  id: string;
  title: string;
  content: string;
  category: 'basic' | 'advanced' | 'troubleshooting' | 'tips';
  keywords: string[];
  relatedItems?: string[];
  interactive?: boolean;
  videoUrl?: string;
  steps?: string[];
}

interface TooltipProps {
  content: string;
  position?: 'top' | 'bottom' | 'left' | 'right';
  trigger?: 'hover' | 'click' | 'focus';
  delay?: number;
  maxWidth?: number;
  children: React.ReactNode;
}

interface HelpContextType {
  showHelp: (itemId: string) => void;
  hideHelp: () => void;
  toggleHelpMode: () => void;
  isHelpModeActive: boolean;
}

const HelpContext = createContext<HelpContextType | null>(null);

export const useHelp = () => {
  const context = useContext(HelpContext);
  if (!context) {
    throw new Error('useHelp must be used within a HelpProvider');
  }
  return context;
};

const helpItems: HelpItem[] = [
  {
    id: 'directory-picker',
    title: 'Selecting Directories',
    content: 'Choose the folder you want to organize. MaxSort will analyze all files within this directory and its subdirectories.',
    category: 'basic',
    keywords: ['directory', 'folder', 'select', 'choose', 'pick'],
    steps: [
      'Click the "Select Directory" button',
      'Navigate to your desired folder',
      'Click "Select Folder" to confirm',
      'Wait for the scanning process to complete'
    ]
  },
  {
    id: 'file-analysis',
    title: 'File Analysis Results',
    content: 'View detailed analysis of your files including AI-powered rename suggestions and organization recommendations.',
    category: 'basic',
    keywords: ['analysis', 'results', 'ai', 'suggestions', 'rename'],
    relatedItems: ['batch-operations', 'confidence-scores']
  },
  {
    id: 'batch-operations',
    title: 'Batch File Operations',
    content: 'Apply multiple file operations at once. You can rename, move, or organize hundreds of files with a single click.',
    category: 'advanced',
    keywords: ['batch', 'bulk', 'operations', 'multiple', 'files'],
    steps: [
      'Review analysis results',
      'Select files you want to operate on',
      'Choose operation type (rename, move, etc.)',
      'Preview changes before applying',
      'Execute batch operation'
    ],
    relatedItems: ['file-analysis', 'operation-preview']
  },
  {
    id: 'confidence-scores',
    title: 'Understanding Confidence Scores',
    content: 'Confidence scores indicate how certain the AI is about its suggestions. Higher scores (80%+) are generally more reliable.',
    category: 'advanced',
    keywords: ['confidence', 'score', 'ai', 'reliability', 'accuracy'],
    interactive: true
  },
  {
    id: 'ollama-setup',
    title: 'Setting up Ollama',
    content: 'Ollama provides local AI models for file analysis. Install and configure it for the best experience.',
    category: 'troubleshooting',
    keywords: ['ollama', 'setup', 'install', 'ai', 'models'],
    steps: [
      'Download Ollama from https://ollama.ai',
      'Install the application',
      'Open terminal and run "ollama serve"',
      'Download models with "ollama pull llama2"',
      'Restart MaxSort to detect Ollama'
    ],
    videoUrl: 'https://example.com/ollama-setup'
  },
  {
    id: 'file-safety',
    title: 'File Safety Features',
    content: 'MaxSort includes multiple safety features to protect your files during operations.',
    category: 'tips',
    keywords: ['safety', 'backup', 'undo', 'protection'],
    steps: [
      'Automatic backups before operations',
      'Operation preview and confirmation',
      'Undo functionality for recent changes',
      'Transaction logs for audit trail'
    ]
  },
  {
    id: 'performance-optimization',
    title: 'Optimizing Performance',
    content: 'Tips to improve MaxSort performance when working with large file collections.',
    category: 'tips',
    keywords: ['performance', 'speed', 'optimization', 'large', 'files'],
    steps: [
      'Close other applications to free memory',
      'Process files in smaller batches',
      'Use SSD storage for better I/O performance',
      'Ensure stable internet connection for AI models'
    ]
  },
  {
    id: 'keyboard-shortcuts',
    title: 'Keyboard Shortcuts',
    content: 'Speed up your workflow with these helpful keyboard shortcuts.',
    category: 'tips',
    keywords: ['shortcuts', 'keyboard', 'hotkeys', 'speed', 'workflow'],
    steps: [
      'Ctrl/Cmd + O: Open directory picker',
      'Ctrl/Cmd + A: Select all files',
      'Ctrl/Cmd + D: Deselect all files',
      'Ctrl/Cmd + Z: Undo last operation',
      'F5: Refresh current view',
      'F1: Open help system'
    ]
  }
];

export const Tooltip: React.FC<TooltipProps> = ({
  content,
  position = 'top',
  trigger = 'hover',
  delay = 500,
  maxWidth = 250,
  children
}) => {
  const [isVisible, setIsVisible] = useState(false);
  const [coords, setCoords] = useState({ x: 0, y: 0 });
  const timeoutRef = useRef<number | null>(null);
  const triggerRef = useRef<HTMLDivElement>(null);

  const showTooltip = (event: React.MouseEvent | React.FocusEvent) => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    const rect = event.currentTarget.getBoundingClientRect();
    let x = rect.left + rect.width / 2;
    let y = rect.top;

    // Adjust position based on prop
    switch (position) {
      case 'bottom':
        y = rect.bottom;
        break;
      case 'left':
        x = rect.left;
        y = rect.top + rect.height / 2;
        break;
      case 'right':
        x = rect.right;
        y = rect.top + rect.height / 2;
        break;
    }

    setCoords({ x, y });

    if (trigger === 'hover') {
      timeoutRef.current = window.setTimeout(() => {
        setIsVisible(true);
      }, delay);
    } else {
      setIsVisible(!isVisible);
    }
  };

  const hideTooltip = () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    if (trigger === 'hover') {
      setIsVisible(false);
    }
  };

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  return (
    <>
      <div
        ref={triggerRef}
        className="tooltip-trigger"
        onMouseEnter={trigger === 'hover' ? showTooltip : undefined}
        onMouseLeave={trigger === 'hover' ? hideTooltip : undefined}
        onClick={trigger === 'click' ? showTooltip : undefined}
        onFocus={trigger === 'focus' ? showTooltip : undefined}
        onBlur={trigger === 'focus' ? hideTooltip : undefined}
      >
        {children}
      </div>

      {isVisible && (
        <div
          className={`tooltip tooltip-${position}`}
          style={{
            position: 'fixed',
            left: coords.x,
            top: coords.y,
            maxWidth: `${maxWidth}px`,
            zIndex: 10000
          }}
        >
          <div className="tooltip-content">
            {content}
          </div>
          <div className="tooltip-arrow"></div>
        </div>
      )}
    </>
  );
};

interface HelpPanelProps {
  isVisible: boolean;
  onClose: () => void;
  searchQuery?: string;
}

const HelpPanel: React.FC<HelpPanelProps> = ({ isVisible, onClose, searchQuery = '' }) => {
  const [currentItem, setCurrentItem] = useState<HelpItem | null>(null);
  const [searchTerm, setSearchTerm] = useState(searchQuery);
  const [selectedCategory, setSelectedCategory] = useState<string>('all');

  const filteredItems = helpItems.filter(item => {
    const matchesSearch = searchTerm === '' || 
      item.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
      item.content.toLowerCase().includes(searchTerm.toLowerCase()) ||
      item.keywords.some(keyword => keyword.toLowerCase().includes(searchTerm.toLowerCase()));
    
    const matchesCategory = selectedCategory === 'all' || item.category === selectedCategory;
    
    return matchesSearch && matchesCategory;
  });

  const categories = [
    { id: 'all', name: 'All Topics', count: helpItems.length },
    { id: 'basic', name: 'Getting Started', count: helpItems.filter(i => i.category === 'basic').length },
    { id: 'advanced', name: 'Advanced Features', count: helpItems.filter(i => i.category === 'advanced').length },
    { id: 'troubleshooting', name: 'Troubleshooting', count: helpItems.filter(i => i.category === 'troubleshooting').length },
    { id: 'tips', name: 'Tips & Tricks', count: helpItems.filter(i => i.category === 'tips').length }
  ];

  const getCategoryIcon = (category: string) => {
    switch (category) {
      case 'basic':
        return '📚';
      case 'advanced':
        return '🔧';
      case 'troubleshooting':
        return '🔍';
      case 'tips':
        return '💡';
      default:
        return '❓';
    }
  };

  if (!isVisible) return null;

  return (
    <div className="help-panel">
      <div className="help-panel-overlay" onClick={onClose}></div>
      <div className="help-panel-content">
        <div className="help-panel-header">
          <h2>Help & Documentation</h2>
          <button className="help-close-button" onClick={onClose}>×</button>
        </div>

        <div className="help-panel-body">
          {!currentItem ? (
            <>
              <div className="help-search">
                <input
                  type="text"
                  placeholder="Search help topics..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="help-search-input"
                />
              </div>

              <div className="help-categories">
                {categories.map(category => (
                  <button
                    key={category.id}
                    className={`category-button ${selectedCategory === category.id ? 'active' : ''}`}
                    onClick={() => setSelectedCategory(category.id)}
                  >
                    {category.name}
                    <span className="category-count">({category.count})</span>
                  </button>
                ))}
              </div>

              <div className="help-items-list">
                {filteredItems.map(item => (
                  <div
                    key={item.id}
                    className="help-item-card"
                    onClick={() => setCurrentItem(item)}
                  >
                    <div className="help-item-header">
                      <span className="category-icon">{getCategoryIcon(item.category)}</span>
                      <h3>{item.title}</h3>
                    </div>
                    <p>{item.content.substring(0, 100)}...</p>
                    <div className="help-item-meta">
                      <span className={`category-badge category-${item.category}`}>
                        {item.category}
                      </span>
                      {item.interactive && <span className="interactive-badge">Interactive</span>}
                      {item.videoUrl && <span className="video-badge">📹 Video</span>}
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="help-item-detail">
              <div className="help-item-detail-header">
                <button 
                  className="help-back-button"
                  onClick={() => setCurrentItem(null)}
                >
                  ← Back to Help
                </button>
                <div className="help-item-title">
                  <span className="category-icon">{getCategoryIcon(currentItem.category)}</span>
                  <h2>{currentItem.title}</h2>
                </div>
              </div>

              <div className="help-item-content">
                <p className="help-item-description">{currentItem.content}</p>

                {currentItem.steps && (
                  <div className="help-steps">
                    <h3>Step-by-step Instructions</h3>
                    <ol>
                      {currentItem.steps.map((step, index) => (
                        <li key={index}>{step}</li>
                      ))}
                    </ol>
                  </div>
                )}

                {currentItem.videoUrl && (
                  <div className="help-video">
                    <h3>Video Tutorial</h3>
                    <div className="video-placeholder">
                      <p>📹 Video tutorial available</p>
                      <a href={currentItem.videoUrl} target="_blank" rel="noopener noreferrer">
                        Watch Video
                      </a>
                    </div>
                  </div>
                )}

                {currentItem.relatedItems && currentItem.relatedItems.length > 0 && (
                  <div className="help-related">
                    <h3>Related Topics</h3>
                    <div className="related-items">
                      {currentItem.relatedItems.map(itemId => {
                        const relatedItem = helpItems.find(i => i.id === itemId);
                        return relatedItem ? (
                          <button
                            key={itemId}
                            className="related-item-button"
                            onClick={() => setCurrentItem(relatedItem)}
                          >
                            {relatedItem.title}
                          </button>
                        ) : null;
                      })}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

interface HelpProviderProps {
  children: React.ReactNode;
}

export const HelpProvider: React.FC<HelpProviderProps> = ({ children }) => {
  const [isHelpPanelVisible, setIsHelpPanelVisible] = useState(false);
  const [isHelpModeActive, setIsHelpModeActive] = useState(false);
  const [currentHelpItem, setCurrentHelpItem] = useState<string | null>(null);

  const showHelp = (itemId: string) => {
    setCurrentHelpItem(itemId);
    setIsHelpPanelVisible(true);
  };

  const hideHelp = () => {
    setIsHelpPanelVisible(false);
    setCurrentHelpItem(null);
  };

  const toggleHelpMode = () => {
    setIsHelpModeActive(!isHelpModeActive);
  };

  // Keyboard shortcut for help
  useEffect(() => {
    const handleKeyPress = (event: KeyboardEvent) => {
      if (event.key === 'F1' || (event.ctrlKey && event.key === '?')) {
        event.preventDefault();
        setIsHelpPanelVisible(true);
      }
      if (event.key === 'Escape' && isHelpPanelVisible) {
        setIsHelpPanelVisible(false);
      }
    };

    document.addEventListener('keydown', handleKeyPress);
    return () => document.removeEventListener('keydown', handleKeyPress);
  }, [isHelpPanelVisible]);

  const contextValue: HelpContextType = {
    showHelp,
    hideHelp,
    toggleHelpMode,
    isHelpModeActive
  };

  return (
    <HelpContext.Provider value={contextValue}>
      <div className={`help-container ${isHelpModeActive ? 'help-mode-active' : ''}`}>
        {children}
        <HelpPanel
          isVisible={isHelpPanelVisible}
          onClose={hideHelp}
          searchQuery={currentHelpItem ? helpItems.find(i => i.id === currentHelpItem)?.title || '' : ''}
        />
        
        {/* Help Mode Indicator */}
        {isHelpModeActive && (
          <div className="help-mode-indicator">
            <span>Help Mode Active - Click on elements for help</span>
            <button onClick={toggleHelpMode}>Exit Help Mode</button>
          </div>
        )}
      </div>
    </HelpContext.Provider>
  );
};

// HOC for adding help to components
export const withHelp = (helpId: string) => <P extends object>(
  WrappedComponent: React.ComponentType<P>
) => {
  const WithHelpComponent: React.FC<P> = (props) => {
    const { showHelp, isHelpModeActive } = useHelp();

    const handleHelpClick = (event: React.MouseEvent) => {
      if (isHelpModeActive) {
        event.stopPropagation();
        showHelp(helpId);
      }
    };

    return (
      <div 
        className={`help-enabled-component ${isHelpModeActive ? 'help-interactive' : ''}`}
        onClick={handleHelpClick}
      >
        <WrappedComponent {...props} />
      </div>
    );
  };

  WithHelpComponent.displayName = `withHelp(${WrappedComponent.displayName || WrappedComponent.name})`;
  return WithHelpComponent;
};

export default HelpProvider;
