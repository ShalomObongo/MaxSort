import React, { useState, useEffect } from 'react';
import './App.css';
import './styles/themes.css';
import AppLayout, { NavigationItem } from './components/AppLayout';
import Dashboard from './components/Dashboard';
import BatchOperationManager from './components/BatchOperationManager';
import OperationHistory from './components/OperationHistory';
import SystemHealth from './components/SystemHealth';
import Settings from './components/Settings';
import TroubleshootingInterface from './components/TroubleshootingInterface';
import ErrorBoundary from './components/ErrorBoundary';
import { NotificationProvider } from './components/UserNotificationSystem';
import { HelpProvider } from './components/ContextualHelpSystem';
import { AppStateProvider, useAppState } from './store/AppStateContext';
import { ThemeProvider, loadThemePreferences } from './contexts/ThemeContext';

// Placeholder components for unimplemented views
const PlaceholderView: React.FC<{ title: string; description: string }> = ({ title, description }) => (
  <div className="placeholder-view">
    <h2>{title}</h2>
    <p>{description}</p>
    <p>This feature will be implemented in subsequent tasks.</p>
  </div>
);

const AppContent: React.FC = () => {
  const { state, dispatch } = useAppState();

  // Navigation configuration
  const navigationItems: NavigationItem[] = [
    {
      id: 'dashboard',
      label: 'Dashboard',
      icon: '🏠',
      component: <Dashboard />
    },
    {
      id: 'analysis',
      label: 'File Analysis',
      icon: '🔍',
      component: <PlaceholderView title="File Analysis" description="Review AI-generated file suggestions and analysis results" />,
      disabled: true
    },
    {
      id: 'operations',
      label: 'Operations',
      icon: '⚡',
      component: <BatchOperationManager 
        onOperationComplete={(operation) => {
          console.log('Operation completed:', operation);
          // Could update global state here
        }}
        onOperationFailed={(operation, error) => {
          console.error('Operation failed:', operation, error);
          // Could show notification here
        }}
        onQueueUpdated={(queue) => {
          // Update system status with queue information
          dispatch({
            type: 'UPDATE_SYSTEM_STATUS',
            payload: {
              operations: {
                active: queue.activeOperations,
                pending: queue.queuedOperations,
                completed: queue.completedOperations
              }
            }
          });
        }}
      />,
      badge: state.systemStatus.operations.active > 0 ? state.systemStatus.operations.active : undefined
    },
    {
      id: 'history',
      label: 'History',
      icon: '📜',
      component: <OperationHistory />
    },
    {
      id: 'monitoring',
      label: 'System Health',
      icon: '💻',
      component: <SystemHealth />
    },
    {
      id: 'settings',
      label: 'Settings',
      icon: '⚙️',
      component: <Settings />
    },
    {
      id: 'help',
      label: 'Help',
      icon: '❓',
      component: <TroubleshootingInterface />
    }
  ];

  const handleNavigationChange = (viewId: string) => {
    dispatch({ type: 'SET_CURRENT_VIEW', payload: viewId });
  };

  const currentNavItem = navigationItems.find(item => item.id === state.currentView);
  const currentComponent = currentNavItem?.component || <Dashboard />;

  return (
    <AppLayout
      navigationItems={navigationItems}
      currentView={state.currentView}
      onNavigationChange={handleNavigationChange}
      systemStatus={state.systemStatus}
      user={{ name: 'User' }}
    >
      {currentComponent}
    </AppLayout>
  );
};

const App: React.FC = () => {
  const initialThemePreferences = loadThemePreferences();
  
  return (
    <ErrorBoundary>
      <ThemeProvider initialPreferences={initialThemePreferences}>
        <HelpProvider>
          <NotificationProvider>
            <AppStateProvider>
              <AppContent />
            </AppStateProvider>
          </NotificationProvider>
        </HelpProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
};

export default App;
