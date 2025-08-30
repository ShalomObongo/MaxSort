import React, { useState, useEffect, useRef } from 'react';
import './ContextualHelp.css';

interface HelpContent {
  id: string;
  title: string;
  content: React.ReactNode;
  context: string[];
  shortcuts?: string[];
  relatedFeatures?: string[];
}

interface ContextualHelpProps {
  currentContext?: string;
  isVisible?: boolean;
  onClose?: () => void;
}

const ContextualHelp: React.FC<ContextualHelpProps> = ({
  currentContext = 'general',
  isVisible = false,
  onClose
}) => {
  const [activeContent, setActiveContent] = useState<HelpContent | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [filteredContent, setFilteredContent] = useState<HelpContent[]>([]);
  const helpRef = useRef<HTMLDivElement>(null);

  // Comprehensive help content
  const helpContent: HelpContent[] = [
    {
      id: 'getting-started',
      title: 'Getting Started with MaxSort',
      context: ['welcome', 'initial-setup', 'general'],
      content: (
        <div className="help-content">
          <h3>Welcome to MaxSort! 🚀</h3>
          <p>MaxSort is an intelligent file organization tool that uses AI to analyze and suggest improvements to your file structure.</p>
          
          <h4>Quick Start Guide:</h4>
          <ol>
            <li><strong>Select a Directory:</strong> Click "Browse" or drag-and-drop a folder to analyze</li>
            <li><strong>Choose AI Model:</strong> Select an appropriate model for your system capabilities</li>
            <li><strong>Run Analysis:</strong> Let MaxSort analyze your files and suggest improvements</li>
            <li><strong>Review Suggestions:</strong> Check the AI-generated recommendations with confidence scores</li>
            <li><strong>Apply Changes:</strong> Approve and execute the changes you want to make</li>
          </ol>
          
          <div className="help-tip">
            <strong>💡 Pro Tip:</strong> Start with a small test directory (10-50 files) to get familiar with the workflow!
          </div>
        </div>
      ),
      shortcuts: ['Cmd+O', 'Cmd+R'],
      relatedFeatures: ['directory-picker', 'model-selector', 'analysis-engine']
    },
    {
      id: 'directory-picker',
      title: 'Directory Selection',
      context: ['directory-picker', 'file-selection'],
      content: (
        <div className="help-content">
          <h3>Selecting Directories 📁</h3>
          <p>Choose which folders you want MaxSort to organize and analyze.</p>
          
          <h4>Methods to Select Directories:</h4>
          <ul>
            <li><strong>Browse Button:</strong> Click "Browse" to open a folder picker dialog</li>
            <li><strong>Drag & Drop:</strong> Drag folders directly onto the MaxSort window</li>
            <li><strong>Recent Folders:</strong> Select from recently analyzed directories</li>
          </ul>
          
          <h4>What Happens Next:</h4>
          <p>MaxSort will scan the directory and subdirectories to:</p>
          <ul>
            <li>Count total files and identify file types</li>
            <li>Check for potential organization patterns</li>
            <li>Estimate processing time based on directory size</li>
          </ul>
          
          <div className="help-warning">
            <strong>⚠️ Important:</strong> MaxSort only reads file names and metadata - it never opens or modifies file contents during analysis.
          </div>
        </div>
      ),
      shortcuts: ['Cmd+O'],
      relatedFeatures: ['file-scanner', 'batch-operations']
    },
    {
      id: 'model-selector',
      title: 'AI Model Configuration',
      context: ['model-selector', 'ai-configuration', 'ollama'],
      content: (
        <div className="help-content">
          <h3>Choosing the Right AI Model 🤖</h3>
          <p>MaxSort uses different AI models to understand your files. Choose based on your system capabilities and accuracy needs.</p>
          
          <h4>Available Models:</h4>
          <div className="model-guide">
            <div className="model-option">
              <h5>🚀 llama3.2:3b (Recommended)</h5>
              <p><strong>Best for:</strong> Most users seeking balanced performance</p>
              <ul>
                <li>High accuracy file classification</li>
                <li>Good processing speed</li>
                <li>Requires ~2GB RAM</li>
              </ul>
            </div>
            
            <div className="model-option">
              <h5>⚡ llama3.2:1b (Fast)</h5>
              <p><strong>Best for:</strong> Quick processing or limited resources</p>
              <ul>
                <li>Faster analysis</li>
                <li>Good for simple file organization</li>
                <li>Requires ~1GB RAM</li>
              </ul>
            </div>
            
            <div className="model-option">
              <h5>🎯 llama3.2:8b (Precision)</h5>
              <p><strong>Best for:</strong> Complex organization tasks</p>
              <ul>
                <li>Highest accuracy</li>
                <li>Better understanding of context</li>
                <li>Requires ~4GB RAM</li>
              </ul>
            </div>
          </div>
          
          <div className="help-tip">
            <strong>💡 Auto-Detection:</strong> MaxSort will automatically detect installed Ollama models and recommend the best option for your system.
          </div>
        </div>
      ),
      shortcuts: ['F2'],
      relatedFeatures: ['ollama-integration', 'system-monitor', 'performance-settings']
    },
    {
      id: 'analysis-results',
      title: 'Understanding Analysis Results',
      context: ['analysis-results', 'suggestions', 'confidence-scores'],
      content: (
        <div className="help-content">
          <h3>Reading Analysis Results 📊</h3>
          <p>MaxSort provides detailed analysis results with confidence scores to help you make informed decisions.</p>
          
          <h4>Confidence Score Guide:</h4>
          <div className="confidence-explanation">
            <div className="confidence-level high">
              <div className="confidence-badge">90-100%</div>
              <div>
                <strong>High Confidence</strong>
                <p>These suggestions are very reliable and safe to apply automatically. The AI is highly confident in the proposed changes.</p>
              </div>
            </div>
            
            <div className="confidence-level medium">
              <div className="confidence-badge">70-89%</div>
              <div>
                <strong>Medium Confidence</strong>
                <p>Good suggestions that benefit from quick review. The AI sees clear patterns but wants your confirmation.</p>
              </div>
            </div>
            
            <div className="confidence-level low">
              <div className="confidence-badge">&lt;70%</div>
              <div>
                <strong>Low Confidence</strong>
                <p>Requires manual verification. The AI detected potential improvements but isn't certain about the best approach.</p>
              </div>
            </div>
          </div>
          
          <h4>Types of Suggestions:</h4>
          <ul>
            <li><strong>File Renaming:</strong> Improve file names for clarity and consistency</li>
            <li><strong>Folder Organization:</strong> Group related files into logical folders</li>
            <li><strong>Duplicate Detection:</strong> Identify and handle duplicate files</li>
            <li><strong>Format Standardization:</strong> Consistent naming conventions</li>
          </ul>
        </div>
      ),
      relatedFeatures: ['confidence-scorer', 'file-operations', 'undo-system']
    },
    {
      id: 'batch-operations',
      title: 'Batch Operations',
      context: ['batch-operations', 'large-scale', 'performance'],
      content: (
        <div className="help-content">
          <h3>Processing Files at Scale ⚡</h3>
          <p>MaxSort excels at handling large directories with thousands of files efficiently.</p>
          
          <h4>Batch Processing Features:</h4>
          <ul>
            <li><strong>Queue Management:</strong> Operations are queued and processed systematically</li>
            <li><strong>Progress Tracking:</strong> Real-time progress updates with ETA</li>
            <li><strong>Error Handling:</strong> Failed operations are retried and logged</li>
            <li><strong>Performance Tuning:</strong> Automatic optimization based on system resources</li>
          </ul>
          
          <h4>Recommended Settings:</h4>
          <div className="settings-guide">
            <div className="setting-row">
              <strong>Small Directories (&lt;100 files):</strong>
              <span>Batch size: 25, Concurrency: 2</span>
            </div>
            <div className="setting-row">
              <strong>Medium Directories (100-1000 files):</strong>
              <span>Batch size: 50, Concurrency: 4</span>
            </div>
            <div className="setting-row">
              <strong>Large Directories (1000+ files):</strong>
              <span>Batch size: 100, Concurrency: 6</span>
            </div>
          </div>
          
          <div className="help-warning">
            <strong>⚠️ Memory Usage:</strong> Larger batch sizes use more memory but are generally faster. Monitor system performance.
          </div>
        </div>
      ),
      shortcuts: ['Cmd+B'],
      relatedFeatures: ['system-monitor', 'priority-queue', 'performance-settings']
    },
    {
      id: 'undo-system',
      title: 'Undo & Recovery',
      context: ['undo', 'recovery', 'history', 'safety'],
      content: (
        <div className="help-content">
          <h3>Safe Operations with Undo 🔄</h3>
          <p>MaxSort provides comprehensive undo capabilities to ensure your files are always safe.</p>
          
          <h4>Undo Features:</h4>
          <ul>
            <li><strong>Operation History:</strong> Complete log of all file operations</li>
            <li><strong>Selective Undo:</strong> Undo specific operations without affecting others</li>
            <li><strong>Batch Undo:</strong> Reverse entire batch operations at once</li>
            <li><strong>Transaction Safety:</strong> Operations are atomic and reversible</li>
          </ul>
          
          <h4>How to Undo:</h4>
          <ol>
            <li><strong>Quick Undo:</strong> Press Cmd+Z to undo the last operation</li>
            <li><strong>History Panel:</strong> Open History tab to see all operations</li>
            <li><strong>Select Operations:</strong> Choose specific operations to undo</li>
            <li><strong>Confirm Undo:</strong> Review and confirm the undo operation</li>
          </ol>
          
          <div className="help-tip">
            <strong>💡 Safety First:</strong> MaxSort creates backup points before major operations, so you can always restore to a previous state.
          </div>
        </div>
      ),
      shortcuts: ['Cmd+Z', 'Cmd+Shift+Z', 'Cmd+H'],
      relatedFeatures: ['transactional-manager', 'operation-history', 'backup-system']
    },
    {
      id: 'keyboard-shortcuts',
      title: 'Keyboard Shortcuts',
      context: ['shortcuts', 'productivity', 'navigation'],
      content: (
        <div className="help-content">
          <h3>Keyboard Shortcuts ⌨️</h3>
          <p>Speed up your workflow with these essential keyboard shortcuts.</p>
          
          <div className="shortcuts-category">
            <h4>File Operations</h4>
            <div className="shortcuts-list">
              <div className="shortcut"><kbd>Cmd+O</kbd><span>Open Directory</span></div>
              <div className="shortcut"><kbd>Cmd+R</kbd><span>Run Analysis</span></div>
              <div className="shortcut"><kbd>Cmd+S</kbd><span>Save Configuration</span></div>
              <div className="shortcut"><kbd>Space</kbd><span>Preview Selection</span></div>
            </div>
          </div>
          
          <div className="shortcuts-category">
            <h4>Navigation</h4>
            <div className="shortcuts-list">
              <div className="shortcut"><kbd>Tab</kbd><span>Switch Tabs</span></div>
              <div className="shortcut"><kbd>Cmd+1-9</kbd><span>Jump to Tab</span></div>
              <div className="shortcut"><kbd>↑↓</kbd><span>Navigate Results</span></div>
              <div className="shortcut"><kbd>Enter</kbd><span>Select/Apply</span></div>
            </div>
          </div>
          
          <div className="shortcuts-category">
            <h4>Operations</h4>
            <div className="shortcuts-list">
              <div className="shortcut"><kbd>Cmd+Z</kbd><span>Undo</span></div>
              <div className="shortcut"><kbd>Cmd+Y</kbd><span>Redo</span></div>
              <div className="shortcut"><kbd>Cmd+A</kbd><span>Select All</span></div>
              <div className="shortcut"><kbd>Escape</kbd><span>Cancel/Close</span></div>
            </div>
          </div>
          
          <div className="shortcuts-category">
            <h4>Help & System</h4>
            <div className="shortcuts-list">
              <div className="shortcut"><kbd>F1</kbd><span>Contextual Help</span></div>
              <div className="shortcut"><kbd>Cmd+,</kbd><span>Settings</span></div>
              <div className="shortcut"><kbd>Cmd+?</kbd><span>All Shortcuts</span></div>
              <div className="shortcut"><kbd>Cmd+Shift+I</kbd><span>Developer Tools</span></div>
            </div>
          </div>
        </div>
      ),
      relatedFeatures: ['productivity-features', 'navigation', 'accessibility']
    },
    {
      id: 'troubleshooting',
      title: 'Troubleshooting',
      context: ['troubleshooting', 'errors', 'performance', 'issues'],
      content: (
        <div className="help-content">
          <h3>Common Issues & Solutions 🔧</h3>
          
          <div className="troubleshoot-section">
            <h4>Ollama Connection Issues</h4>
            <div className="issue-solution">
              <p><strong>Problem:</strong> "Ollama not detected" or connection errors</p>
              <p><strong>Solutions:</strong></p>
              <ul>
                <li>Ensure Ollama is installed and running</li>
                <li>Check that Ollama is listening on localhost:11434</li>
                <li>Try restarting Ollama service</li>
                <li>Verify firewall settings aren't blocking the connection</li>
              </ul>
            </div>
          </div>
          
          <div className="troubleshoot-section">
            <h4>Performance Issues</h4>
            <div className="issue-solution">
              <p><strong>Problem:</strong> Slow analysis or high memory usage</p>
              <p><strong>Solutions:</strong></p>
              <ul>
                <li>Reduce batch size in Performance settings</li>
                <li>Switch to a smaller AI model (llama3.2:1b)</li>
                <li>Close other memory-intensive applications</li>
                <li>Process smaller directory chunks</li>
              </ul>
            </div>
          </div>
          
          <div className="troubleshoot-section">
            <h4>File Operation Errors</h4>
            <div className="issue-solution">
              <p><strong>Problem:</strong> "Permission denied" or file operation failures</p>
              <p><strong>Solutions:</strong></p>
              <ul>
                <li>Check file and folder permissions</li>
                <li>Ensure files aren't open in other applications</li>
                <li>Run MaxSort with appropriate permissions</li>
                <li>Verify sufficient disk space</li>
              </ul>
            </div>
          </div>
          
          <div className="troubleshoot-section">
            <h4>Getting More Help</h4>
            <p>If you continue experiencing issues:</p>
            <ul>
              <li>Check the system logs in the Activity tab</li>
              <li>Use "Report Issue" to send diagnostic information</li>
              <li>Visit our documentation and FAQ</li>
              <li>Contact support with specific error messages</li>
            </ul>
          </div>
        </div>
      ),
      relatedFeatures: ['system-monitor', 'error-handling', 'diagnostics']
    }
  ];

  // Filter content based on current context and search query
  useEffect(() => {
    let filtered = helpContent.filter(content => {
      const contextMatch = content.context.includes(currentContext) || currentContext === 'general';
      const searchMatch = searchQuery === '' || 
        content.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        content.id.toLowerCase().includes(searchQuery.toLowerCase());
      
      return contextMatch && searchMatch;
    });

    // Prioritize exact context matches
    filtered.sort((a, b) => {
      const aExactMatch = a.context.includes(currentContext);
      const bExactMatch = b.context.includes(currentContext);
      
      if (aExactMatch && !bExactMatch) return -1;
      if (!aExactMatch && bExactMatch) return 1;
      return 0;
    });

    setFilteredContent(filtered);
    
    // Auto-select first item if none selected
    if (filtered.length > 0 && !activeContent) {
      setActiveContent(filtered[0]);
    }
  }, [currentContext, searchQuery, activeContent]);

  // Handle F1 key globally for contextual help
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'F1') {
        event.preventDefault();
        // Determine context from focused element or active tab
        const focusedElement = document.activeElement;
        const context = focusedElement?.getAttribute('data-help-context') || 
                       focusedElement?.closest('[data-help-context]')?.getAttribute('data-help-context') ||
                       'general';
        
        // Auto-show help for current context
        const contextualContent = helpContent.find(content => 
          content.context.includes(context)
        );
        
        if (contextualContent) {
          setActiveContent(contextualContent);
        }
      }
      
      if (event.key === 'Escape' && isVisible) {
        onClose?.();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isVisible, onClose]);

  // Handle clicks outside to close
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (helpRef.current && !helpRef.current.contains(event.target as Node)) {
        onClose?.();
      }
    };

    if (isVisible) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isVisible, onClose]);

  if (!isVisible) {
    return null;
  }

  return (
    <div className="contextual-help-overlay">
      <div className="contextual-help" ref={helpRef}>
        <div className="help-header">
          <div className="help-title">
            <h2>Help & Documentation</h2>
            <div className="help-context-indicator">
              Context: <span className="context-name">{currentContext}</span>
            </div>
          </div>
          <button className="help-close" onClick={onClose}>
            ✕
          </button>
        </div>
        
        <div className="help-search">
          <input
            type="text"
            placeholder="Search help topics..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="help-search-input"
          />
        </div>
        
        <div className="help-body">
          <div className="help-sidebar">
            <h3>Topics</h3>
            <div className="help-topics">
              {filteredContent.map(content => (
                <button
                  key={content.id}
                  className={`help-topic ${activeContent?.id === content.id ? 'active' : ''}`}
                  onClick={() => setActiveContent(content)}
                >
                  {content.title}
                </button>
              ))}
            </div>
          </div>
          
          <div className="help-main">
            {activeContent && (
              <div className="help-article">
                <div className="article-header">
                  <h1>{activeContent.title}</h1>
                  {activeContent.shortcuts && (
                    <div className="article-shortcuts">
                      <strong>Shortcuts:</strong>
                      {activeContent.shortcuts.map(shortcut => (
                        <kbd key={shortcut}>{shortcut}</kbd>
                      ))}
                    </div>
                  )}
                </div>
                
                <div className="article-content">
                  {activeContent.content}
                </div>
                
                {activeContent.relatedFeatures && (
                  <div className="related-features">
                    <h4>Related Features:</h4>
                    <div className="related-tags">
                      {activeContent.relatedFeatures.map(feature => (
                        <span key={feature} className="related-tag">
                          {feature.replace('-', ' ')}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ContextualHelp;
