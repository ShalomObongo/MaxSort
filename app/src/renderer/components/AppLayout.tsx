import React, { useState, ReactNode } from 'react';
import './AppLayout.css';

export interface NavigationItem {
  id: string;
  label: string;
  icon: string;
  component: ReactNode;
  badge?: string | number;
  disabled?: boolean;
}

interface SystemStatus {
  memory: {
    used: number;
    total: number;
    percentage: number;
  };
  agents: {
    active: number;
    total: number;
    status: 'healthy' | 'warning' | 'error';
  };
  operations: {
    active: number;
    pending: number;
    completed: number;
  };
}

interface AppLayoutProps {
  children: ReactNode;
  navigationItems: NavigationItem[];
  currentView: string;
  onNavigationChange: (viewId: string) => void;
  systemStatus?: SystemStatus;
  user?: {
    name?: string;
    avatar?: string;
  };
}

const AppLayout: React.FC<AppLayoutProps> = ({
  children,
  navigationItems,
  currentView,
  onNavigationChange,
  systemStatus,
  user
}) => {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [showSystemDetails, setShowSystemDetails] = useState(false);

  const getStatusColor = (status?: 'healthy' | 'warning' | 'error') => {
    switch (status) {
      case 'healthy': return '#10B981';
      case 'warning': return '#F59E0B';
      case 'error': return '#EF4444';
      default: return '#6B7280';
    }
  };

  const formatMemory = (bytes: number): string => {
    const gb = bytes / (1024 * 1024 * 1024);
    return `${gb.toFixed(1)}GB`;
  };

  return (
    <div className="app-layout">
      {/* Top Navigation Bar */}
      <header className="app-header">
        <div className="header-left">
          <button 
            className="sidebar-toggle"
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {sidebarCollapsed ? '☰' : '✕'}
          </button>
          <div className="app-brand">
            <span className="brand-icon">📁</span>
            <span className="brand-text">MaxSort</span>
          </div>
        </div>

        <div className="header-center">
          <h1 className="current-view-title">
            {navigationItems.find(item => item.id === currentView)?.label || 'Dashboard'}
          </h1>
        </div>

        <div className="header-right">
          {systemStatus && (
            <div 
              className="system-status-indicator"
              onClick={() => setShowSystemDetails(!showSystemDetails)}
              title="System Status"
            >
              <div className="status-dot-container">
                <div 
                  className="status-dot"
                  style={{ backgroundColor: getStatusColor(systemStatus.agents.status) }}
                />
                <div className="status-summary">
                  {systemStatus.agents.active}/{systemStatus.agents.total} agents
                </div>
              </div>
              
              {showSystemDetails && (
                <div className="system-status-dropdown">
                  <div className="status-section">
                    <div className="status-title">Memory</div>
                    <div className="status-value">
                      {formatMemory(systemStatus.memory.used)} / {formatMemory(systemStatus.memory.total)}
                      <div className="memory-bar">
                        <div 
                          className="memory-fill"
                          style={{ width: `${systemStatus.memory.percentage}%` }}
                        />
                      </div>
                    </div>
                  </div>
                  
                  <div className="status-section">
                    <div className="status-title">Operations</div>
                    <div className="status-grid">
                      <div>Active: {systemStatus.operations.active}</div>
                      <div>Pending: {systemStatus.operations.pending}</div>
                      <div>Completed: {systemStatus.operations.completed}</div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {user && (
            <div className="user-profile">
              {user.avatar ? (
                <img src={user.avatar} alt={user.name} className="user-avatar" />
              ) : (
                <div className="user-avatar-placeholder">
                  {user.name?.charAt(0) || '👤'}
                </div>
              )}
            </div>
          )}
        </div>
      </header>

      <div className="app-body">
        {/* Sidebar Navigation */}
        <aside className={`app-sidebar ${sidebarCollapsed ? 'collapsed' : ''}`}>
          <nav className="sidebar-nav">
            {navigationItems.map((item) => (
              <button
                key={item.id}
                className={`nav-item ${item.id === currentView ? 'active' : ''} ${item.disabled ? 'disabled' : ''}`}
                onClick={() => !item.disabled && onNavigationChange(item.id)}
                disabled={item.disabled}
                title={sidebarCollapsed ? item.label : undefined}
              >
                <span className="nav-icon">{item.icon}</span>
                {!sidebarCollapsed && (
                  <>
                    <span className="nav-label">{item.label}</span>
                    {item.badge && (
                      <span className="nav-badge">{item.badge}</span>
                    )}
                  </>
                )}
              </button>
            ))}
          </nav>
        </aside>

        {/* Main Content Area */}
        <main className="app-main">
          <div className="main-content">
            {children}
          </div>
        </main>
      </div>

      {/* Status Bar */}
      <footer className="app-footer">
        <div className="footer-left">
          <div className="status-item">
            <span className="status-label">Status:</span>
            <span className="status-value">
              {systemStatus?.agents.status === 'healthy' ? 'Ready' : 
               systemStatus?.agents.status === 'warning' ? 'Warning' : 
               systemStatus?.agents.status === 'error' ? 'Error' : 'Unknown'}
            </span>
          </div>
          
          {systemStatus && systemStatus.operations.active > 0 && (
            <div className="status-item">
              <span className="status-label">Active Operations:</span>
              <span className="status-value">{systemStatus.operations.active}</span>
            </div>
          )}
        </div>

        <div className="footer-center">
          {/* Placeholder for center status items */}
        </div>

        <div className="footer-right">
          <div className="status-item">
            <span className="status-label">v1.0.0</span>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default AppLayout;
