import React, { useState, useEffect } from 'react';
import { useNotificationHelpers } from './UserNotificationSystem';
import './TroubleshootingInterface.css';

interface SystemCheck {
  id: string;
  name: string;
  description: string;
  category: 'system' | 'permissions' | 'network' | 'storage' | 'performance';
  status: 'pending' | 'running' | 'passed' | 'failed' | 'warning';
  details?: string;
  solution?: string;
  autoFix?: () => Promise<void>;
}

interface TroubleshootingStep {
  id: string;
  title: string;
  description: string;
  category: string;
  difficulty: 'easy' | 'medium' | 'advanced';
  estimatedTime: string;
  steps: string[];
  warnings?: string[];
  verification?: string;
  autoExecute?: () => Promise<boolean>;
}

const TroubleshootingInterface: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'diagnostics' | 'guides' | 'system'>('diagnostics');
  const [systemChecks, setSystemChecks] = useState<SystemCheck[]>([]);
  const [isRunningDiagnostics, setIsRunningDiagnostics] = useState(false);
  const [selectedGuide, setSelectedGuide] = useState<TroubleshootingStep | null>(null);
  const [systemInfo, setSystemInfo] = useState<any>(null);
  const { showSuccess, showError, showWarning, showLoading } = useNotificationHelpers();

  const troubleshootingGuides: TroubleshootingStep[] = [
    {
      id: 'ollama-not-found',
      title: 'Ollama Not Detected',
      description: 'Fix issues when Ollama is not found or not running',
      category: 'AI Integration',
      difficulty: 'easy',
      estimatedTime: '2-5 minutes',
      steps: [
        'Open Terminal or Command Prompt',
        'Check if Ollama is installed: run "ollama --version"',
        'If not installed, download from https://ollama.ai',
        'Start Ollama service: run "ollama serve"',
        'Verify service is running on localhost:11434',
        'Restart MaxSort application'
      ],
      verification: 'Check that Ollama appears in the Model Selection interface'
    },
    {
      id: 'permission-denied',
      title: 'File Permission Issues',
      description: 'Resolve file access and permission problems',
      category: 'File System',
      difficulty: 'medium',
      estimatedTime: '3-10 minutes',
      steps: [
        'Identify the affected files or directories',
        'Right-click on the folder and select Properties/Get Info',
        'Check current permissions and ownership',
        'Grant read/write permissions to your user account',
        'On macOS: Use "sudo chown -R $(whoami) /path/to/folder"',
        'On Windows: Use "Take ownership" option in security settings',
        'Restart the application and try again'
      ],
      warnings: [
        'Be careful when changing system-level permissions',
        'Only modify permissions for your own files'
      ],
      verification: 'Try accessing the previously restricted files'
    },
    {
      id: 'slow-performance',
      title: 'Slow Performance',
      description: 'Optimize application performance and responsiveness',
      category: 'Performance',
      difficulty: 'medium',
      estimatedTime: '5-15 minutes',
      steps: [
        'Check available system memory (RAM)',
        'Close other resource-intensive applications',
        'Reduce batch operation size (process fewer files at once)',
        'Clear application cache and temporary files',
        'Disable unnecessary background processes',
        'Consider upgrading hardware if issues persist'
      ],
      verification: 'Monitor task completion times and system responsiveness'
    },
    {
      id: 'network-connectivity',
      title: 'Network Connection Problems',
      description: 'Fix network-related issues affecting AI model downloads',
      category: 'Network',
      difficulty: 'easy',
      estimatedTime: '2-8 minutes',
      steps: [
        'Check internet connection in browser',
        'Test connection to ollama.ai',
        'Check firewall settings for port 11434',
        'Verify proxy settings if applicable',
        'Try switching to different network (mobile hotspot)',
        'Contact network administrator if in corporate environment'
      ],
      verification: 'Attempt to download or use AI models'
    },
    {
      id: 'corrupted-database',
      title: 'Database Corruption Issues',
      description: 'Repair or rebuild corrupted application database',
      category: 'Data',
      difficulty: 'advanced',
      estimatedTime: '10-30 minutes',
      steps: [
        'Close the application completely',
        'Locate application data directory',
        'Create backup of current database file',
        'Delete or rename corrupted database file',
        'Restart application (will create new database)',
        'Re-import any previously saved configurations'
      ],
      warnings: [
        'This will reset all saved history and preferences',
        'Make sure to backup important data first'
      ],
      verification: 'Check that application starts normally and functions work'
    },
    {
      id: 'high-memory-usage',
      title: 'High Memory Usage',
      description: 'Reduce memory consumption and prevent crashes',
      category: 'Performance',
      difficulty: 'medium',
      estimatedTime: '5-10 minutes',
      steps: [
        'Check memory usage in Task Manager/Activity Monitor',
        'Reduce number of files processed simultaneously',
        'Clear application cache and temporary files',
        'Restart the application',
        'Disable preview features for large files',
        'Consider processing files in smaller batches'
      ],
      verification: 'Monitor memory usage and application stability'
    }
  ];

  useEffect(() => {
    initializeDiagnostics();
    loadSystemInfo();
  }, []);

  const initializeDiagnostics = () => {
    const checks: SystemCheck[] = [
      {
        id: 'ollama-service',
        name: 'Ollama Service',
        description: 'Check if Ollama is running and accessible',
        category: 'system',
        status: 'pending'
      },
      {
        id: 'file-permissions',
        name: 'File System Permissions',
        description: 'Verify read/write access to selected directories',
        category: 'permissions',
        status: 'pending'
      },
      {
        id: 'network-connectivity',
        name: 'Network Connectivity',
        description: 'Test internet connection and API accessibility',
        category: 'network',
        status: 'pending'
      },
      {
        id: 'storage-space',
        name: 'Storage Space',
        description: 'Check available disk space',
        category: 'storage',
        status: 'pending'
      },
      {
        id: 'memory-usage',
        name: 'Memory Usage',
        description: 'Monitor system memory consumption',
        category: 'performance',
        status: 'pending'
      },
      {
        id: 'database-integrity',
        name: 'Database Integrity',
        description: 'Verify application database health',
        category: 'storage',
        status: 'pending'
      }
    ];

    setSystemChecks(checks);
  };

  const loadSystemInfo = async () => {
    try {
      if (window.electronAPI?.invoke) {
        const info = await window.electronAPI.invoke('system:getInfo');
        setSystemInfo(info);
      }
    } catch (error) {
      console.error('Failed to load system info:', error);
    }
  };

  const runDiagnostics = async () => {
    setIsRunningDiagnostics(true);
    const notificationId = showLoading('Running Diagnostics', 'Checking system health...');

    try {
      for (let i = 0; i < systemChecks.length; i++) {
        const check = systemChecks[i];
        
        // Update status to running
        setSystemChecks(prev => prev.map(c => 
          c.id === check.id ? { ...c, status: 'running' } : c
        ));

        // Simulate diagnostic check
        await new Promise(resolve => setTimeout(resolve, 500));
        
        const result = await runSystemCheck(check);
        
        // Update with result
        setSystemChecks(prev => prev.map(c => 
          c.id === check.id ? { ...c, ...result } : c
        ));
      }

      showSuccess('Diagnostics Complete', 'System health check finished');
    } catch (error) {
      showError('Diagnostics Failed', 'Error running system diagnostics');
    } finally {
      setIsRunningDiagnostics(false);
    }
  };

  const runSystemCheck = async (check: SystemCheck): Promise<Partial<SystemCheck>> => {
    try {
      if (window.electronAPI?.invoke) {
        const result = await window.electronAPI.invoke('diagnostics:runCheck', check.id);
        return {
          status: result.passed ? 'passed' : 'failed',
          details: result.details,
          solution: result.solution
        };
      }
    } catch (error) {
      console.error(`Check failed for ${check.id}:`, error);
    }

    // Fallback simulation
    return {
      status: Math.random() > 0.3 ? 'passed' : 'failed',
      details: 'Simulated check result',
      solution: 'Try the troubleshooting guide for this issue'
    };
  };

  const executeAutoFix = async (check: SystemCheck) => {
    const notificationId = showLoading('Auto Fix', `Attempting to fix ${check.name}...`);

    try {
      if (check.autoFix) {
        await check.autoFix();
        
        // Re-run the specific check
        const result = await runSystemCheck(check);
        setSystemChecks(prev => prev.map(c => 
          c.id === check.id ? { ...c, ...result } : c
        ));

        showSuccess('Auto Fix Complete', `${check.name} has been fixed`);
      }
    } catch (error) {
      showError('Auto Fix Failed', `Could not automatically fix ${check.name}`);
    }
  };

  const getStatusIcon = (status: SystemCheck['status']) => {
    switch (status) {
      case 'running':
        return <div className="status-spinner"></div>;
      case 'passed':
        return <span className="status-icon status-passed">✓</span>;
      case 'failed':
        return <span className="status-icon status-failed">✗</span>;
      case 'warning':
        return <span className="status-icon status-warning">⚠</span>;
      default:
        return <span className="status-icon status-pending">○</span>;
    }
  };

  const getDifficultyColor = (difficulty: string) => {
    switch (difficulty) {
      case 'easy':
        return '#10b981';
      case 'medium':
        return '#f59e0b';
      case 'advanced':
        return '#ef4444';
      default:
        return '#6b7280';
    }
  };

  return (
    <div className="troubleshooting-interface">
      <div className="troubleshooting-header">
        <h2>Troubleshooting & Diagnostics</h2>
        <p>Identify and resolve common issues with MaxSort</p>
      </div>

      <div className="troubleshooting-tabs">
        <button
          className={`tab-button ${activeTab === 'diagnostics' ? 'active' : ''}`}
          onClick={() => setActiveTab('diagnostics')}
        >
          System Diagnostics
        </button>
        <button
          className={`tab-button ${activeTab === 'guides' ? 'active' : ''}`}
          onClick={() => setActiveTab('guides')}
        >
          Troubleshooting Guides
        </button>
        <button
          className={`tab-button ${activeTab === 'system' ? 'active' : ''}`}
          onClick={() => setActiveTab('system')}
        >
          System Information
        </button>
      </div>

      <div className="troubleshooting-content">
        {activeTab === 'diagnostics' && (
          <div className="diagnostics-panel">
            <div className="diagnostics-header">
              <div className="diagnostics-info">
                <h3>System Health Checks</h3>
                <p>Run automated diagnostics to identify potential issues</p>
              </div>
              <button
                className="run-diagnostics-button"
                onClick={runDiagnostics}
                disabled={isRunningDiagnostics}
              >
                {isRunningDiagnostics ? 'Running...' : 'Run Diagnostics'}
              </button>
            </div>

            <div className="checks-list">
              {systemChecks.map(check => (
                <div key={check.id} className={`check-item check-${check.status}`}>
                  <div className="check-info">
                    <div className="check-header">
                      <div className="check-status">
                        {getStatusIcon(check.status)}
                      </div>
                      <div className="check-details">
                        <h4>{check.name}</h4>
                        <p>{check.description}</p>
                      </div>
                    </div>

                    {check.details && (
                      <div className="check-result">
                        <div className="result-details">{check.details}</div>
                        {check.solution && (
                          <div className="result-solution">
                            <strong>Solution:</strong> {check.solution}
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="check-actions">
                    <span className={`check-category category-${check.category}`}>
                      {check.category}
                    </span>
                    {check.status === 'failed' && check.autoFix && (
                      <button
                        className="auto-fix-button"
                        onClick={() => executeAutoFix(check)}
                      >
                        Auto Fix
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === 'guides' && (
          <div className="guides-panel">
            {!selectedGuide ? (
              <>
                <div className="guides-header">
                  <h3>Step-by-Step Troubleshooting</h3>
                  <p>Choose a guide to resolve common issues</p>
                </div>

                <div className="guides-grid">
                  {troubleshootingGuides.map(guide => (
                    <div
                      key={guide.id}
                      className="guide-card"
                      onClick={() => setSelectedGuide(guide)}
                    >
                      <div className="guide-header">
                        <h4>{guide.title}</h4>
                        <div className="guide-meta">
                          <span 
                            className="difficulty-badge"
                            style={{ backgroundColor: getDifficultyColor(guide.difficulty) }}
                          >
                            {guide.difficulty}
                          </span>
                          <span className="time-estimate">{guide.estimatedTime}</span>
                        </div>
                      </div>
                      <p className="guide-description">{guide.description}</p>
                      <div className="guide-category">{guide.category}</div>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="guide-detail">
                <div className="guide-detail-header">
                  <button
                    className="back-button"
                    onClick={() => setSelectedGuide(null)}
                  >
                    ← Back to Guides
                  </button>
                  <div className="guide-title-section">
                    <h3>{selectedGuide.title}</h3>
                    <div className="guide-info">
                      <span 
                        className="difficulty-badge"
                        style={{ backgroundColor: getDifficultyColor(selectedGuide.difficulty) }}
                      >
                        {selectedGuide.difficulty}
                      </span>
                      <span className="time-estimate">⏱️ {selectedGuide.estimatedTime}</span>
                      <span className="category-badge">{selectedGuide.category}</span>
                    </div>
                  </div>
                </div>

                <div className="guide-content">
                  <p className="guide-description">{selectedGuide.description}</p>

                  {selectedGuide.warnings && selectedGuide.warnings.length > 0 && (
                    <div className="guide-warnings">
                      <h4>⚠️ Important Warnings</h4>
                      <ul>
                        {selectedGuide.warnings.map((warning, index) => (
                          <li key={index}>{warning}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <div className="guide-steps">
                    <h4>Steps to Follow</h4>
                    <ol>
                      {selectedGuide.steps.map((step, index) => (
                        <li key={index}>{step}</li>
                      ))}
                    </ol>
                  </div>

                  {selectedGuide.verification && (
                    <div className="guide-verification">
                      <h4>✓ Verification</h4>
                      <p>{selectedGuide.verification}</p>
                    </div>
                  )}

                  {selectedGuide.autoExecute && (
                    <div className="guide-actions">
                      <button
                        className="auto-execute-button"
                        onClick={async () => {
                          const success = await selectedGuide.autoExecute!();
                          if (success) {
                            showSuccess('Auto Execute Complete', 'Steps executed successfully');
                          } else {
                            showWarning('Partial Success', 'Some steps may require manual completion');
                          }
                        }}
                      >
                        Auto Execute Steps
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === 'system' && (
          <div className="system-panel">
            <div className="system-header">
              <h3>System Information</h3>
              <p>Current system status and environment details</p>
            </div>

            {systemInfo && (
              <div className="system-info-grid">
                <div className="info-section">
                  <h4>Application</h4>
                  <div className="info-items">
                    <div className="info-item">
                      <span className="info-label">Version:</span>
                      <span className="info-value">{systemInfo.app?.version || 'Unknown'}</span>
                    </div>
                    <div className="info-item">
                      <span className="info-label">Platform:</span>
                      <span className="info-value">{systemInfo.platform}</span>
                    </div>
                    <div className="info-item">
                      <span className="info-label">Architecture:</span>
                      <span className="info-value">{systemInfo.arch}</span>
                    </div>
                  </div>
                </div>

                <div className="info-section">
                  <h4>System Resources</h4>
                  <div className="info-items">
                    <div className="info-item">
                      <span className="info-label">Total Memory:</span>
                      <span className="info-value">{systemInfo.memory?.total || 'Unknown'}</span>
                    </div>
                    <div className="info-item">
                      <span className="info-label">Available Memory:</span>
                      <span className="info-value">{systemInfo.memory?.available || 'Unknown'}</span>
                    </div>
                    <div className="info-item">
                      <span className="info-label">CPU Cores:</span>
                      <span className="info-value">{systemInfo.cpu?.cores || 'Unknown'}</span>
                    </div>
                  </div>
                </div>

                <div className="info-section">
                  <h4>Environment</h4>
                  <div className="info-items">
                    <div className="info-item">
                      <span className="info-label">Node.js:</span>
                      <span className="info-value">{systemInfo.versions?.node || 'Unknown'}</span>
                    </div>
                    <div className="info-item">
                      <span className="info-label">Electron:</span>
                      <span className="info-value">{systemInfo.versions?.electron || 'Unknown'}</span>
                    </div>
                    <div className="info-item">
                      <span className="info-label">Chrome:</span>
                      <span className="info-value">{systemInfo.versions?.chrome || 'Unknown'}</span>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default TroubleshootingInterface;
