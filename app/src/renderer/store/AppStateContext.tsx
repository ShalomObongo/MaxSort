import React, { createContext, useContext, useReducer, ReactNode, useEffect } from 'react';

// Types for the global application state
export interface SystemStatus {
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

export interface UserPreferences {
  theme: 'light' | 'dark' | 'system';
  sidebarCollapsed: boolean;
  notifications: boolean;
  language: string;
}

export interface ApplicationState {
  // User Configuration
  selectedDirectory: string;
  selectedModels: {
    mainModel: string | null;
    subModel: string | null;
  };
  userPreferences: UserPreferences;
  
  // System Status
  systemStatus: SystemStatus;
  isOnline: boolean;
  
  // Workflow State
  currentWorkflowStep: number;
  workflowData: Record<string, any>;
  
  // Operation State
  activeOperations: any[];
  operationHistory: any[];
  
  // UI State
  currentView: string;
  sidebarCollapsed: boolean;
  notifications: any[];
  
  // Loading States
  isLoading: boolean;
  loadingMessage: string;
}

// Action types for state updates
export type AppAction =
  | { type: 'SET_DIRECTORY'; payload: string }
  | { type: 'SET_MODELS'; payload: { mainModel: string | null; subModel: string | null } }
  | { type: 'UPDATE_SYSTEM_STATUS'; payload: Partial<SystemStatus> }
  | { type: 'SET_WORKFLOW_STEP'; payload: number }
  | { type: 'UPDATE_WORKFLOW_DATA'; payload: { key: string; value: any } }
  | { type: 'SET_CURRENT_VIEW'; payload: string }
  | { type: 'TOGGLE_SIDEBAR' }
  | { type: 'SET_SIDEBAR_COLLAPSED'; payload: boolean }
  | { type: 'ADD_NOTIFICATION'; payload: any }
  | { type: 'REMOVE_NOTIFICATION'; payload: string }
  | { type: 'UPDATE_USER_PREFERENCES'; payload: Partial<UserPreferences> }
  | { type: 'SET_ONLINE_STATUS'; payload: boolean }
  | { type: 'SET_LOADING'; payload: { loading: boolean; message?: string } }
  | { type: 'ADD_OPERATION'; payload: any }
  | { type: 'UPDATE_OPERATION'; payload: { id: string; data: any } }
  | { type: 'REMOVE_OPERATION'; payload: string };

// Initial state
const initialState: ApplicationState = {
  selectedDirectory: '',
  selectedModels: {
    mainModel: null,
    subModel: null
  },
  userPreferences: {
    theme: 'system',
    sidebarCollapsed: false,
    notifications: true,
    language: 'en'
  },
  systemStatus: {
    memory: { used: 0, total: 0, percentage: 0 },
    agents: { active: 0, total: 0, status: 'healthy' },
    operations: { active: 0, pending: 0, completed: 0 }
  },
  isOnline: true,
  currentWorkflowStep: 0,
  workflowData: {},
  activeOperations: [],
  operationHistory: [],
  currentView: 'dashboard',
  sidebarCollapsed: false,
  notifications: [],
  isLoading: false,
  loadingMessage: ''
};

// Reducer function
function appReducer(state: ApplicationState, action: AppAction): ApplicationState {
  switch (action.type) {
    case 'SET_DIRECTORY':
      return {
        ...state,
        selectedDirectory: action.payload
      };
    
    case 'SET_MODELS':
      return {
        ...state,
        selectedModels: action.payload
      };
    
    case 'UPDATE_SYSTEM_STATUS':
      return {
        ...state,
        systemStatus: {
          ...state.systemStatus,
          ...action.payload
        }
      };
    
    case 'SET_WORKFLOW_STEP':
      return {
        ...state,
        currentWorkflowStep: action.payload
      };
    
    case 'UPDATE_WORKFLOW_DATA':
      return {
        ...state,
        workflowData: {
          ...state.workflowData,
          [action.payload.key]: action.payload.value
        }
      };
    
    case 'SET_CURRENT_VIEW':
      return {
        ...state,
        currentView: action.payload
      };
    
    case 'TOGGLE_SIDEBAR':
      return {
        ...state,
        sidebarCollapsed: !state.sidebarCollapsed,
        userPreferences: {
          ...state.userPreferences,
          sidebarCollapsed: !state.sidebarCollapsed
        }
      };
    
    case 'SET_SIDEBAR_COLLAPSED':
      return {
        ...state,
        sidebarCollapsed: action.payload,
        userPreferences: {
          ...state.userPreferences,
          sidebarCollapsed: action.payload
        }
      };
    
    case 'ADD_NOTIFICATION':
      return {
        ...state,
        notifications: [...state.notifications, action.payload]
      };
    
    case 'REMOVE_NOTIFICATION':
      return {
        ...state,
        notifications: state.notifications.filter(n => n.id !== action.payload)
      };
    
    case 'UPDATE_USER_PREFERENCES':
      return {
        ...state,
        userPreferences: {
          ...state.userPreferences,
          ...action.payload
        }
      };
    
    case 'SET_ONLINE_STATUS':
      return {
        ...state,
        isOnline: action.payload
      };
    
    case 'SET_LOADING':
      return {
        ...state,
        isLoading: action.payload.loading,
        loadingMessage: action.payload.message || ''
      };
    
    case 'ADD_OPERATION':
      return {
        ...state,
        activeOperations: [...state.activeOperations, action.payload]
      };
    
    case 'UPDATE_OPERATION':
      return {
        ...state,
        activeOperations: state.activeOperations.map(op => 
          op.id === action.payload.id ? { ...op, ...action.payload.data } : op
        )
      };
    
    case 'REMOVE_OPERATION':
      const removedOperation = state.activeOperations.find(op => op.id === action.payload);
      return {
        ...state,
        activeOperations: state.activeOperations.filter(op => op.id !== action.payload),
        operationHistory: removedOperation 
          ? [...state.operationHistory, { ...removedOperation, completedAt: new Date().toISOString() }]
          : state.operationHistory
      };
    
    default:
      return state;
  }
}

// Context creation
const AppStateContext = createContext<{
  state: ApplicationState;
  dispatch: React.Dispatch<AppAction>;
} | null>(null);

// Provider component
interface AppStateProviderProps {
  children: ReactNode;
}

export const AppStateProvider: React.FC<AppStateProviderProps> = ({ children }) => {
  const [state, dispatch] = useReducer(appReducer, initialState);

  // Load persisted user preferences on mount
  useEffect(() => {
    const loadUserPreferences = async () => {
      try {
        // Load from localStorage or IPC call to main process
        const savedPreferences = localStorage.getItem('userPreferences');
        if (savedPreferences) {
          const preferences = JSON.parse(savedPreferences);
          dispatch({ type: 'UPDATE_USER_PREFERENCES', payload: preferences });
        }
      } catch (error) {
        console.error('Failed to load user preferences:', error);
      }
    };

    loadUserPreferences();
  }, []);

  // Persist user preferences changes
  useEffect(() => {
    try {
      localStorage.setItem('userPreferences', JSON.stringify(state.userPreferences));
    } catch (error) {
      console.error('Failed to save user preferences:', error);
    }
  }, [state.userPreferences]);

  // System status polling (simulated - would be real IPC calls)
  useEffect(() => {
    const pollSystemStatus = () => {
      // This would be a real IPC call to get system status
      // For now, simulate with realistic data
      const mockStatus: SystemStatus = {
        memory: {
          used: Math.random() * 8000000000, // Random used memory up to 8GB
          total: 16000000000, // 16GB total
          percentage: Math.random() * 60 + 20 // 20-80% usage
        },
        agents: {
          active: Math.floor(Math.random() * 3),
          total: 4,
          status: Math.random() > 0.8 ? 'warning' : 'healthy'
        },
        operations: {
          active: state.activeOperations.length,
          pending: Math.floor(Math.random() * 5),
          completed: state.operationHistory.length
        }
      };

      dispatch({ type: 'UPDATE_SYSTEM_STATUS', payload: mockStatus });
    };

    // Poll every 5 seconds
    const interval = setInterval(pollSystemStatus, 5000);
    
    // Initial poll
    pollSystemStatus();

    return () => clearInterval(interval);
  }, [state.activeOperations.length, state.operationHistory.length]);

  return (
    <AppStateContext.Provider value={{ state, dispatch }}>
      {children}
    </AppStateContext.Provider>
  );
};

// Custom hook to use the app state
export const useAppState = () => {
  const context = useContext(AppStateContext);
  if (!context) {
    throw new Error('useAppState must be used within an AppStateProvider');
  }
  return context;
};

// Custom hooks for specific state slices
export const useSystemStatus = () => {
  const { state } = useAppState();
  return state.systemStatus;
};

export const useWorkflowState = () => {
  const { state, dispatch } = useAppState();
  return {
    currentStep: state.currentWorkflowStep,
    workflowData: state.workflowData,
    setWorkflowStep: (step: number) => dispatch({ type: 'SET_WORKFLOW_STEP', payload: step }),
    updateWorkflowData: (key: string, value: any) => 
      dispatch({ type: 'UPDATE_WORKFLOW_DATA', payload: { key, value } })
  };
};

export const useUserPreferences = () => {
  const { state, dispatch } = useAppState();
  return {
    preferences: state.userPreferences,
    updatePreferences: (updates: Partial<UserPreferences>) =>
      dispatch({ type: 'UPDATE_USER_PREFERENCES', payload: updates })
  };
};

export const useNotifications = () => {
  const { state, dispatch } = useAppState();
  return {
    notifications: state.notifications,
    addNotification: (notification: any) => dispatch({ type: 'ADD_NOTIFICATION', payload: notification }),
    removeNotification: (id: string) => dispatch({ type: 'REMOVE_NOTIFICATION', payload: id })
  };
};
