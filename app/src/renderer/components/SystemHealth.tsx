import React, { useState, useEffect, useMemo } from 'react';
import './SystemHealth.css';

// Type definitions for system health data
interface AgentStatus {
  id: string;
  name: string;
  type: 'file-analysis' | 'batch-operation' | 'system-monitor' | 'ollama-client';
  status: 'running' | 'idle' | 'stopped' | 'error' | 'starting' | 'stopping';
  health: 'healthy' | 'warning' | 'critical' | 'unknown';
  lastHeartbeat: string;
  memoryUsage: number; // MB
  cpuUsage: number; // percentage
  tasksActive: number;
  tasksCompleted: number;
  tasksFailed: number;
  uptime: number; // seconds
  version: string;
  configuration?: Record<string, any>;
  error?: string;
}

interface SystemMetrics {
  totalMemory: number; // MB
  usedMemory: number; // MB
  availableMemory: number; // MB
  cpuUsage: number; // percentage
  diskUsage: number; // percentage
  networkActivity: {
    bytesIn: number;
    bytesOut: number;
  };
  processCount: number;
  threadCount: number;
  timestamp: string;
}

interface PerformanceData {
  timestamp: string;
  memory: number;
  cpu: number;
  operations: number;
  errors: number;
}

interface SystemHealthData {
  agents: AgentStatus[];
  systemMetrics: SystemMetrics;
  performanceHistory: PerformanceData[];
  alerts: SystemAlert[];
  recommendations: SystemRecommendation[];
}

interface SystemAlert {
  id: string;
  level: 'info' | 'warning' | 'error' | 'critical';
  title: string;
  description: string;
  timestamp: string;
  acknowledged: boolean;
  category: 'performance' | 'resource' | 'agent' | 'system';
  actionRequired?: boolean;
}

interface SystemRecommendation {
  id: string;
  type: 'performance' | 'configuration' | 'maintenance' | 'upgrade';
  title: string;
  description: string;
  impact: 'low' | 'medium' | 'high';
  effort: 'low' | 'medium' | 'high';
  priority: number;
  actionable: boolean;
  estimatedBenefit: string;
}

interface AgentControlAction {
  action: 'start' | 'stop' | 'restart' | 'configure' | 'reset';
  agentId: string;
  configuration?: Record<string, any>;
}

const SystemHealth: React.FC = () => {
  const [healthData, setHealthData] = useState<SystemHealthData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshInterval, setRefreshInterval] = useState(5000); // 5 seconds default
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const [showConfigModal, setShowConfigModal] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [viewMode, setViewMode] = useState<'overview' | 'agents' | 'metrics' | 'alerts'>('overview');
  const [timeRange, setTimeRange] = useState<'1h' | '6h' | '24h' | '7d'>('1h');
  const [alertFilter, setAlertFilter] = useState<'all' | 'unacknowledged' | 'critical'>('unacknowledged');

  // Load system health data
  const loadHealthData = async () => {
    try {
      setError(null);
      const response = await window.electronAPI.invoke('system:getHealthStatus', {
        includeHistory: true,
        timeRange,
        includeRecommendations: true
      });
      setHealthData(response);
    } catch (err) {
      console.error('Error loading system health:', err);
      setError(err instanceof Error ? err.message : 'Failed to load system health data');
    } finally {
      setLoading(false);
    }
  };

  // Agent control actions
  const handleAgentAction = async (action: AgentControlAction) => {
    try {
      const response = await window.electronAPI.invoke('system:controlAgent', action);
      if (response.success) {
        // Refresh data after successful action
        await loadHealthData();
        // Show success notification
        console.log(`Agent ${action.action} successful:`, response.message);
      } else {
        throw new Error(response.error || `Failed to ${action.action} agent`);
      }
    } catch (err) {
      console.error(`Error ${action.action} agent:`, err);
      setError(err instanceof Error ? err.message : `Failed to ${action.action} agent`);
    }
  };

  // Acknowledge alert
  const acknowledgeAlert = async (alertId: string) => {
    try {
      await window.electronAPI.invoke('system:acknowledgeAlert', { alertId });
      await loadHealthData();
    } catch (err) {
      console.error('Error acknowledging alert:', err);
    }
  };

  // Apply recommendation
  const applyRecommendation = async (recommendationId: string) => {
    try {
      const response = await window.electronAPI.invoke('system:applyRecommendation', { recommendationId });
      if (response.success) {
        await loadHealthData();
        console.log('Recommendation applied successfully:', response.message);
      } else {
        throw new Error(response.error || 'Failed to apply recommendation');
      }
    } catch (err) {
      console.error('Error applying recommendation:', err);
      setError(err instanceof Error ? err.message : 'Failed to apply recommendation');
    }
  };

  // Export health data
  const exportHealthData = async () => {
    try {
      const response = await window.electronAPI.invoke('system:exportHealthData', {
        format: 'json',
        timeRange,
        includeHistory: true,
        includeAlerts: true,
        includeRecommendations: true
      });
      console.log('Health data exported:', response.filePath);
    } catch (err) {
      console.error('Error exporting health data:', err);
      setError(err instanceof Error ? err.message : 'Failed to export health data');
    }
  };

  // Real-time updates
  useEffect(() => {
    let intervalId: NodeJS.Timeout;

    if (autoRefresh && refreshInterval > 0) {
      intervalId = setInterval(loadHealthData, refreshInterval);
    }

    return () => {
      if (intervalId) {
        clearInterval(intervalId);
      }
    };
  }, [autoRefresh, refreshInterval, timeRange]);

  // Subscribe to real-time health updates
  useEffect(() => {
    let unsubscribeHealthUpdate: (() => void) | undefined;
    let unsubscribeAgentStatusChange: (() => void) | undefined;
    let unsubscribeSystemAlert: (() => void) | undefined;

    if (window.electronAPI.on) {
      unsubscribeHealthUpdate = window.electronAPI.on('health-update', (data: Partial<SystemHealthData>) => {
        setHealthData(prev => prev ? { ...prev, ...data } : null);
      });

      unsubscribeAgentStatusChange = window.electronAPI.on('agent-status-change', (agentUpdate: AgentStatus) => {
        setHealthData(prev => {
          if (!prev) return null;
          const updatedAgents = prev.agents.map(agent => 
            agent.id === agentUpdate.id ? agentUpdate : agent
          );
          return { ...prev, agents: updatedAgents };
        });
      });

      unsubscribeSystemAlert = window.electronAPI.on('system-alert', (alert: SystemAlert) => {
        setHealthData(prev => {
          if (!prev) return null;
          return { ...prev, alerts: [alert, ...prev.alerts] };
        });
      });
    }

    // Initial load
    loadHealthData();

    return () => {
      unsubscribeHealthUpdate?.();
      unsubscribeAgentStatusChange?.();
      unsubscribeSystemAlert?.();
    };
  }, []);

  // Computed values
  const systemOverview = useMemo(() => {
    if (!healthData) return null;

    const { agents, systemMetrics, alerts } = healthData;
    
    return {
      totalAgents: agents.length,
      runningAgents: agents.filter(a => a.status === 'running').length,
      healthyAgents: agents.filter(a => a.health === 'healthy').length,
      criticalAlerts: alerts.filter(a => a.level === 'critical' && !a.acknowledged).length,
      warningAlerts: alerts.filter(a => a.level === 'warning' && !a.acknowledged).length,
      memoryUsage: (systemMetrics.usedMemory / systemMetrics.totalMemory) * 100,
      cpuUsage: systemMetrics.cpuUsage,
      overallHealth: agents.every(a => a.health === 'healthy') ? 'healthy' : 
                     agents.some(a => a.health === 'critical') ? 'critical' : 'warning'
    };
  }, [healthData]);

  const filteredAlerts = useMemo(() => {
    if (!healthData) return [];
    
    let filtered = healthData.alerts;
    
    switch (alertFilter) {
      case 'unacknowledged':
        filtered = filtered.filter(alert => !alert.acknowledged);
        break;
      case 'critical':
        filtered = filtered.filter(alert => alert.level === 'critical');
        break;
      default:
        break;
    }
    
    return filtered.sort((a, b) => {
      // Sort by level (critical first), then by timestamp
      const levelOrder = { critical: 0, error: 1, warning: 2, info: 3 };
      const levelDiff = levelOrder[a.level] - levelOrder[b.level];
      if (levelDiff !== 0) return levelDiff;
      return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
    });
  }, [healthData, alertFilter]);

  const formatUptime = (seconds: number): string => {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    
    if (days > 0) return `${days}d ${hours}h ${minutes}m`;
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
  };

  const formatMemory = (mb: number): string => {
    if (mb >= 1024) {
      return `${(mb / 1024).toFixed(1)} GB`;
    }
    return `${mb.toFixed(0)} MB`;
  };

  const getStatusIcon = (status: AgentStatus['status']): string => {
    switch (status) {
      case 'running': return '▶️';
      case 'idle': return '⏸️';
      case 'stopped': return '⏹️';
      case 'error': return '❌';
      case 'starting': return '🔄';
      case 'stopping': return '⏹️';
      default: return '❓';
    }
  };

  const getHealthIcon = (health: AgentStatus['health']): string => {
    switch (health) {
      case 'healthy': return '✅';
      case 'warning': return '⚠️';
      case 'critical': return '🔴';
      default: return '❓';
    }
  };

  const getAlertIcon = (level: SystemAlert['level']): string => {
    switch (level) {
      case 'critical': return '🚨';
      case 'error': return '❌';
      case 'warning': return '⚠️';
      case 'info': return 'ℹ️';
      default: return '📋';
    }
  };

  if (loading) {
    return (
      <div className="system-health loading">
        <div className="loading-spinner" data-testid="loading-spinner"></div>
        <p>Loading system health data...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="system-health error">
        <div className="error-content">
          <h3>Error Loading System Health</h3>
          <p>{error}</p>
          <button 
            onClick={() => {
              setError(null);
              setLoading(true);
              loadHealthData();
            }}
            className="retry-button"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!healthData || !systemOverview) {
    return (
      <div className="system-health empty">
        <div className="empty-state">
          <div className="empty-icon">📊</div>
          <h3>No Health Data Available</h3>
          <p>System health monitoring is not available at this time.</p>
          <button onClick={() => loadHealthData()} className="retry-button">
            Refresh
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="system-health">
      {/* Header */}
      <div className="health-header">
        <div className="header-title">
          <h2>System Health Dashboard</h2>
          <div className="system-status">
            <span className={`status-indicator ${systemOverview.overallHealth}`}>
              {getHealthIcon(systemOverview.overallHealth as AgentStatus['health'])}
            </span>
            <span className="status-text">
              System {systemOverview.overallHealth.toUpperCase()}
            </span>
          </div>
        </div>
        <div className="header-controls">
          <div className="view-selector">
            <button 
              className={viewMode === 'overview' ? 'active' : ''}
              onClick={() => setViewMode('overview')}
            >
              Overview
            </button>
            <button 
              className={viewMode === 'agents' ? 'active' : ''}
              onClick={() => setViewMode('agents')}
            >
              Agents ({systemOverview.runningAgents}/{systemOverview.totalAgents})
            </button>
            <button 
              className={viewMode === 'metrics' ? 'active' : ''}
              onClick={() => setViewMode('metrics')}
            >
              Metrics
            </button>
            <button 
              className={viewMode === 'alerts' ? 'active' : ''}
              onClick={() => setViewMode('alerts')}
            >
              Alerts ({systemOverview.criticalAlerts + systemOverview.warningAlerts})
            </button>
          </div>
          <div className="refresh-controls">
            <label className="auto-refresh">
              <input
                type="checkbox"
                checked={autoRefresh}
                onChange={(e) => setAutoRefresh(e.target.checked)}
              />
              Auto-refresh
            </label>
            {autoRefresh && (
              <select
                value={refreshInterval}
                onChange={(e) => setRefreshInterval(Number(e.target.value))}
                className="refresh-interval"
              >
                <option value={1000}>1s</option>
                <option value={5000}>5s</option>
                <option value={10000}>10s</option>
                <option value={30000}>30s</option>
                <option value={60000}>1m</option>
              </select>
            )}
            <button onClick={loadHealthData} className="refresh-button">
              🔄 Refresh
            </button>
            <button onClick={exportHealthData} className="export-button">
              📥 Export
            </button>
          </div>
        </div>
      </div>

      {/* Overview */}
      {viewMode === 'overview' && (
        <div className="overview-section">
          <div className="metrics-grid">
            <div className="metric-card">
              <div className="metric-header">
                <h3>System Resources</h3>
                <span className="metric-icon">💻</span>
              </div>
              <div className="metric-values">
                <div className="metric-item">
                  <span className="metric-label">Memory Usage</span>
                  <div className="metric-bar">
                    <div 
                      className="metric-fill"
                      style={{ width: `${systemOverview.memoryUsage}%` }}
                    ></div>
                  </div>
                  <span className="metric-value">
                    {systemOverview.memoryUsage.toFixed(1)}%
                  </span>
                </div>
                <div className="metric-item">
                  <span className="metric-label">CPU Usage</span>
                  <div className="metric-bar">
                    <div 
                      className="metric-fill cpu"
                      style={{ width: `${systemOverview.cpuUsage}%` }}
                    ></div>
                  </div>
                  <span className="metric-value">
                    {systemOverview.cpuUsage.toFixed(1)}%
                  </span>
                </div>
                <div className="metric-details">
                  <div className="detail-item">
                    <span>Total Memory:</span>
                    <span>{formatMemory(healthData.systemMetrics.totalMemory)}</span>
                  </div>
                  <div className="detail-item">
                    <span>Available:</span>
                    <span>{formatMemory(healthData.systemMetrics.availableMemory)}</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="metric-card">
              <div className="metric-header">
                <h3>Agent Status</h3>
                <span className="metric-icon">🤖</span>
              </div>
              <div className="agent-summary">
                <div className="agent-stats">
                  <div className="stat-item">
                    <span className="stat-value">{systemOverview.runningAgents}</span>
                    <span className="stat-label">Running</span>
                  </div>
                  <div className="stat-item">
                    <span className="stat-value">{systemOverview.healthyAgents}</span>
                    <span className="stat-label">Healthy</span>
                  </div>
                  <div className="stat-item">
                    <span className="stat-value">{systemOverview.totalAgents}</span>
                    <span className="stat-label">Total</span>
                  </div>
                </div>
                <div className="agent-health-breakdown">
                  {healthData.agents.map(agent => (
                    <div key={agent.id} className="agent-mini">
                      <span className="agent-name">{agent.name}</span>
                      <span className="agent-status">
                        {getStatusIcon(agent.status)}
                        {getHealthIcon(agent.health)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="metric-card">
              <div className="metric-header">
                <h3>Alert Summary</h3>
                <span className="metric-icon">🚨</span>
              </div>
              <div className="alert-summary">
                <div className="alert-stats">
                  <div className="alert-stat critical">
                    <span className="alert-count">{systemOverview.criticalAlerts}</span>
                    <span className="alert-level">Critical</span>
                  </div>
                  <div className="alert-stat warning">
                    <span className="alert-count">{systemOverview.warningAlerts}</span>
                    <span className="alert-level">Warning</span>
                  </div>
                </div>
                {systemOverview.criticalAlerts > 0 && (
                  <div className="critical-alerts">
                    {filteredAlerts
                      .filter(alert => alert.level === 'critical')
                      .slice(0, 3)
                      .map(alert => (
                      <div key={alert.id} className="alert-preview critical">
                        <span className="alert-title">{alert.title}</span>
                        <button 
                          onClick={() => acknowledgeAlert(alert.id)}
                          className="acknowledge-btn"
                        >
                          Acknowledge
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          {healthData.recommendations.length > 0 && (
            <div className="recommendations-section">
              <h3>System Recommendations</h3>
              <div className="recommendations-list">
                {healthData.recommendations
                  .sort((a, b) => b.priority - a.priority)
                  .slice(0, 5)
                  .map(rec => (
                  <div key={rec.id} className={`recommendation ${rec.type}`}>
                    <div className="recommendation-header">
                      <h4>{rec.title}</h4>
                      <div className="recommendation-meta">
                        <span className={`impact ${rec.impact}`}>
                          Impact: {rec.impact.toUpperCase()}
                        </span>
                        <span className={`effort ${rec.effort}`}>
                          Effort: {rec.effort.toUpperCase()}
                        </span>
                      </div>
                    </div>
                    <p className="recommendation-description">{rec.description}</p>
                    <div className="recommendation-actions">
                      <span className="estimated-benefit">{rec.estimatedBenefit}</span>
                      {rec.actionable && (
                        <button 
                          onClick={() => applyRecommendation(rec.id)}
                          className="apply-recommendation"
                        >
                          Apply
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Agents View */}
      {viewMode === 'agents' && (
        <div className="agents-section">
          <div className="agents-grid">
            {healthData.agents.map(agent => (
              <div key={agent.id} className={`agent-card ${agent.status} ${agent.health}`}>
                <div className="agent-header">
                  <div className="agent-info">
                    <h3>{agent.name}</h3>
                    <span className="agent-type">{agent.type}</span>
                  </div>
                  <div className="agent-status-indicators">
                    <span className="status-badge">{getStatusIcon(agent.status)} {agent.status}</span>
                    <span className="health-badge">{getHealthIcon(agent.health)} {agent.health}</span>
                  </div>
                </div>
                
                <div className="agent-metrics">
                  <div className="metric-row">
                    <span>Memory:</span>
                    <span>{formatMemory(agent.memoryUsage)}</span>
                  </div>
                  <div className="metric-row">
                    <span>CPU:</span>
                    <span>{agent.cpuUsage.toFixed(1)}%</span>
                  </div>
                  <div className="metric-row">
                    <span>Uptime:</span>
                    <span>{formatUptime(agent.uptime)}</span>
                  </div>
                  <div className="metric-row">
                    <span>Active Tasks:</span>
                    <span>{agent.tasksActive}</span>
                  </div>
                </div>

                <div className="agent-stats">
                  <div className="stat-group">
                    <span className="stat-label">Completed</span>
                    <span className="stat-value completed">{agent.tasksCompleted}</span>
                  </div>
                  <div className="stat-group">
                    <span className="stat-label">Failed</span>
                    <span className="stat-value failed">{agent.tasksFailed}</span>
                  </div>
                </div>

                {agent.error && (
                  <div className="agent-error">
                    <span className="error-label">Error:</span>
                    <span className="error-message">{agent.error}</span>
                  </div>
                )}

                <div className="agent-actions">
                  <button
                    onClick={() => handleAgentAction({ action: 'start', agentId: agent.id })}
                    disabled={agent.status === 'running' || agent.status === 'starting'}
                    className="action-btn start"
                  >
                    ▶️ Start
                  </button>
                  <button
                    onClick={() => handleAgentAction({ action: 'stop', agentId: agent.id })}
                    disabled={agent.status === 'stopped' || agent.status === 'stopping'}
                    className="action-btn stop"
                  >
                    ⏹️ Stop
                  </button>
                  <button
                    onClick={() => handleAgentAction({ action: 'restart', agentId: agent.id })}
                    disabled={agent.status === 'starting' || agent.status === 'stopping'}
                    className="action-btn restart"
                  >
                    🔄 Restart
                  </button>
                  <button
                    onClick={() => {
                      setSelectedAgent(agent.id);
                      setShowConfigModal(true);
                    }}
                    className="action-btn configure"
                  >
                    ⚙️ Configure
                  </button>
                </div>
                
                <div className="agent-details">
                  <div className="detail-item">
                    <span>Version:</span>
                    <span>{agent.version}</span>
                  </div>
                  <div className="detail-item">
                    <span>Last Heartbeat:</span>
                    <span>{new Date(agent.lastHeartbeat).toLocaleTimeString()}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Metrics View */}
      {viewMode === 'metrics' && (
        <div className="metrics-section">
          <div className="time-range-selector">
            <label>Time Range:</label>
            <select value={timeRange} onChange={(e) => setTimeRange(e.target.value as any)}>
              <option value="1h">Last Hour</option>
              <option value="6h">Last 6 Hours</option>
              <option value="24h">Last 24 Hours</option>
              <option value="7d">Last 7 Days</option>
            </select>
          </div>

          <div className="performance-charts">
            <div className="chart-container">
              <h3>System Performance Over Time</h3>
              <div className="chart-placeholder">
                <p>Performance chart would be rendered here with actual charting library</p>
                <div className="mock-chart">
                  {healthData.performanceHistory.slice(0, 10).map((point, index) => (
                    <div key={index} className="chart-point">
                      <div className="point-time">{new Date(point.timestamp).toLocaleTimeString()}</div>
                      <div className="point-metrics">
                        <span>CPU: {point.cpu.toFixed(1)}%</span>
                        <span>Memory: {formatMemory(point.memory)}</span>
                        <span>Ops: {point.operations}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="detailed-metrics">
              <div className="current-metrics">
                <h3>Current System Metrics</h3>
                <div className="metrics-grid">
                  <div className="metric-detail">
                    <label>Total Memory:</label>
                    <span>{formatMemory(healthData.systemMetrics.totalMemory)}</span>
                  </div>
                  <div className="metric-detail">
                    <label>Used Memory:</label>
                    <span>{formatMemory(healthData.systemMetrics.usedMemory)}</span>
                  </div>
                  <div className="metric-detail">
                    <label>Available Memory:</label>
                    <span>{formatMemory(healthData.systemMetrics.availableMemory)}</span>
                  </div>
                  <div className="metric-detail">
                    <label>CPU Usage:</label>
                    <span>{healthData.systemMetrics.cpuUsage.toFixed(1)}%</span>
                  </div>
                  <div className="metric-detail">
                    <label>Disk Usage:</label>
                    <span>{healthData.systemMetrics.diskUsage.toFixed(1)}%</span>
                  </div>
                  <div className="metric-detail">
                    <label>Process Count:</label>
                    <span>{healthData.systemMetrics.processCount}</span>
                  </div>
                  <div className="metric-detail">
                    <label>Thread Count:</label>
                    <span>{healthData.systemMetrics.threadCount}</span>
                  </div>
                  <div className="metric-detail">
                    <label>Network In:</label>
                    <span>{(healthData.systemMetrics.networkActivity.bytesIn / 1024 / 1024).toFixed(2)} MB</span>
                  </div>
                  <div className="metric-detail">
                    <label>Network Out:</label>
                    <span>{(healthData.systemMetrics.networkActivity.bytesOut / 1024 / 1024).toFixed(2)} MB</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Alerts View */}
      {viewMode === 'alerts' && (
        <div className="alerts-section">
          <div className="alerts-controls">
            <div className="alert-filters">
              <label>Filter:</label>
              <select 
                value={alertFilter} 
                onChange={(e) => setAlertFilter(e.target.value as any)}
              >
                <option value="all">All Alerts</option>
                <option value="unacknowledged">Unacknowledged</option>
                <option value="critical">Critical Only</option>
              </select>
            </div>
            <div className="alert-actions">
              <button 
                onClick={() => {
                  filteredAlerts
                    .filter(alert => !alert.acknowledged)
                    .forEach(alert => acknowledgeAlert(alert.id));
                }}
                className="bulk-acknowledge"
              >
                Acknowledge All
              </button>
            </div>
          </div>

          <div className="alerts-list">
            {filteredAlerts.length === 0 ? (
              <div className="no-alerts">
                <div className="empty-icon">✅</div>
                <h3>No Alerts</h3>
                <p>
                  {alertFilter === 'all' 
                    ? 'No system alerts at this time.' 
                    : `No ${alertFilter} alerts found.`}
                </p>
              </div>
            ) : (
              filteredAlerts.map(alert => (
                <div key={alert.id} className={`alert-item ${alert.level} ${alert.acknowledged ? 'acknowledged' : ''}`}>
                  <div className="alert-header">
                    <span className="alert-icon">{getAlertIcon(alert.level)}</span>
                    <div className="alert-title-section">
                      <h4>{alert.title}</h4>
                      <div className="alert-meta">
                        <span className="alert-category">{alert.category}</span>
                        <span className="alert-time">
                          {new Date(alert.timestamp).toLocaleString()}
                        </span>
                        <span className={`alert-level ${alert.level}`}>
                          {alert.level.toUpperCase()}
                        </span>
                      </div>
                    </div>
                    <div className="alert-actions">
                      {!alert.acknowledged && (
                        <button 
                          onClick={() => acknowledgeAlert(alert.id)}
                          className="acknowledge-button"
                        >
                          Acknowledge
                        </button>
                      )}
                      {alert.acknowledged && (
                        <span className="acknowledged-badge">✅ Acknowledged</span>
                      )}
                    </div>
                  </div>
                  <div className="alert-description">
                    <p>{alert.description}</p>
                    {alert.actionRequired && (
                      <div className="action-required">
                        <span className="action-indicator">⚠️ Action Required</span>
                      </div>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* Configuration Modal */}
      {showConfigModal && selectedAgent && (
        <div className="modal-overlay">
          <div className="config-modal">
            <div className="modal-header">
              <h3>Configure Agent</h3>
              <button 
                onClick={() => setShowConfigModal(false)}
                className="close-button"
              >
                ✕
              </button>
            </div>
            <div className="modal-content">
              <div className="agent-config">
                <h4>{healthData.agents.find(a => a.id === selectedAgent)?.name}</h4>
                <p>Agent configuration interface would be implemented here based on agent type and current configuration.</p>
                <div className="config-placeholder">
                  <p>Configuration options:</p>
                  <ul>
                    <li>Memory limits</li>
                    <li>Concurrency settings</li>
                    <li>Retry policies</li>
                    <li>Timeout values</li>
                    <li>Logging levels</li>
                  </ul>
                </div>
              </div>
            </div>
            <div className="modal-actions">
              <button 
                onClick={() => setShowConfigModal(false)}
                className="cancel-button"
              >
                Cancel
              </button>
              <button 
                onClick={() => {
                  // Apply configuration changes
                  console.log('Applying configuration for agent:', selectedAgent);
                  setShowConfigModal(false);
                }}
                className="save-button"
              >
                Save Configuration
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SystemHealth;
