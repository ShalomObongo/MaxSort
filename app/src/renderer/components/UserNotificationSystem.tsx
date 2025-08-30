import React, { useState, useEffect, useCallback, createContext, useContext } from 'react';
import './UserNotificationSystem.css';

export type NotificationType = 'success' | 'warning' | 'error' | 'info' | 'loading';

export interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  duration?: number; // in milliseconds, 0 for persistent
  actions?: NotificationAction[];
  timestamp: Date;
  persistent?: boolean;
  dismissible?: boolean;
  progress?: number; // 0-100 for progress notifications
  details?: string;
  onDismiss?: () => void;
}

export interface NotificationAction {
  label: string;
  action: () => void | Promise<void>;
  variant?: 'primary' | 'secondary' | 'danger';
  loading?: boolean;
}

interface NotificationContextType {
  notifications: Notification[];
  addNotification: (notification: Omit<Notification, 'id' | 'timestamp'>) => string;
  removeNotification: (id: string) => void;
  updateNotification: (id: string, updates: Partial<Notification>) => void;
  clearAll: () => void;
  clearType: (type: NotificationType) => void;
}

const NotificationContext = createContext<NotificationContextType | null>(null);

export const useNotifications = () => {
  const context = useContext(NotificationContext);
  if (!context) {
    throw new Error('useNotifications must be used within a NotificationProvider');
  }
  return context;
};

interface NotificationProviderProps {
  children: React.ReactNode;
  maxNotifications?: number;
  defaultDuration?: number;
}

export const NotificationProvider: React.FC<NotificationProviderProps> = ({
  children,
  maxNotifications = 10,
  defaultDuration = 5000
}) => {
  const [notifications, setNotifications] = useState<Notification[]>([]);

  const addNotification = useCallback((
    notification: Omit<Notification, 'id' | 'timestamp'>
  ): string => {
    const id = `notification-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const newNotification: Notification = {
      ...notification,
      id,
      timestamp: new Date(),
      duration: notification.duration ?? (notification.persistent ? 0 : defaultDuration),
      dismissible: notification.dismissible ?? true
    };

    setNotifications(prev => {
      const updated = [newNotification, ...prev];
      // Keep only the most recent notifications
      return updated.slice(0, maxNotifications);
    });

    return id;
  }, [maxNotifications, defaultDuration]);

  const removeNotification = useCallback((id: string) => {
    setNotifications(prev => prev.filter(n => n.id !== id));
  }, []);

  const updateNotification = useCallback((id: string, updates: Partial<Notification>) => {
    setNotifications(prev => prev.map(n => 
      n.id === id ? { ...n, ...updates } : n
    ));
  }, []);

  const clearAll = useCallback(() => {
    setNotifications([]);
  }, []);

  const clearType = useCallback((type: NotificationType) => {
    setNotifications(prev => prev.filter(n => n.type !== type));
  }, []);

  // Auto-dismiss notifications with duration
  useEffect(() => {
    const timers = notifications
      .filter(n => n.duration && n.duration > 0)
      .map(notification => {
        return setTimeout(() => {
          removeNotification(notification.id);
          notification.onDismiss?.();
        }, notification.duration);
      });

    return () => {
      timers.forEach(clearTimeout);
    };
  }, [notifications, removeNotification]);

  const contextValue: NotificationContextType = {
    notifications,
    addNotification,
    removeNotification,
    updateNotification,
    clearAll,
    clearType
  };

  return (
    <NotificationContext.Provider value={contextValue}>
      {children}
      <NotificationContainer />
    </NotificationContext.Provider>
  );
};

const NotificationContainer: React.FC = () => {
  const { notifications } = useNotifications();

  return (
    <div className="notification-container">
      {notifications.map(notification => (
        <NotificationItem
          key={notification.id}
          notification={notification}
        />
      ))}
    </div>
  );
};

interface NotificationItemProps {
  notification: Notification;
}

const NotificationItem: React.FC<NotificationItemProps> = ({ notification }) => {
  const { removeNotification, updateNotification } = useNotifications();
  const [isVisible, setIsVisible] = useState(false);
  const [isLeaving, setIsLeaving] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  useEffect(() => {
    // Trigger entrance animation
    const timer = setTimeout(() => setIsVisible(true), 50);
    return () => clearTimeout(timer);
  }, []);

  const handleDismiss = () => {
    if (!notification.dismissible) return;
    
    setIsLeaving(true);
    setTimeout(() => {
      removeNotification(notification.id);
      notification.onDismiss?.();
    }, 300);
  };

  const handleAction = async (action: NotificationAction, index: number) => {
    const actionKey = `${notification.id}-${index}`;
    setActionLoading(actionKey);

    try {
      await action.action();
    } catch (error) {
      console.error('Notification action error:', error);
    } finally {
      setActionLoading(null);
    }
  };

  const getIcon = () => {
    switch (notification.type) {
      case 'success':
        return '✅';
      case 'error':
        return '❌';
      case 'warning':
        return '⚠️';
      case 'info':
        return 'ℹ️';
      case 'loading':
        return (
          <div className="loading-spinner">
            <div className="spinner-icon"></div>
          </div>
        );
      default:
        return '';
    }
  };

  const formatTime = (timestamp: Date) => {
    const now = new Date();
    const diff = now.getTime() - timestamp.getTime();
    
    if (diff < 60000) return 'Just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return timestamp.toLocaleDateString();
  };

  return (
    <div 
      className={`notification-item notification-${notification.type} ${
        isVisible ? 'notification-visible' : ''
      } ${isLeaving ? 'notification-leaving' : ''}`}
      role="alert"
      aria-live="polite"
    >
      <div className="notification-content">
        <div className="notification-header">
          <div className="notification-icon">
            {getIcon()}
          </div>
          <div className="notification-text">
            <div className="notification-title">{notification.title}</div>
            <div className="notification-message">{notification.message}</div>
            {notification.details && (
              <details className="notification-details">
                <summary>Show details</summary>
                <div className="notification-details-content">
                  {notification.details}
                </div>
              </details>
            )}
          </div>
          <div className="notification-meta">
            <span className="notification-time">
              {formatTime(notification.timestamp)}
            </span>
            {notification.dismissible && (
              <button
                className="notification-close"
                onClick={handleDismiss}
                aria-label="Dismiss notification"
              >
                ×
              </button>
            )}
          </div>
        </div>

        {notification.progress !== undefined && (
          <div className="notification-progress">
            <div className="progress-bar">
              <div 
                className="progress-fill"
                style={{ width: `${Math.max(0, Math.min(100, notification.progress))}%` }}
              />
            </div>
            <span className="progress-text">
              {Math.round(notification.progress)}%
            </span>
          </div>
        )}

        {notification.actions && notification.actions.length > 0 && (
          <div className="notification-actions">
            {notification.actions.map((action, index) => (
              <button
                key={index}
                className={`notification-action notification-action-${action.variant || 'secondary'}`}
                onClick={() => handleAction(action, index)}
                disabled={actionLoading === `${notification.id}-${index}`}
              >
                {actionLoading === `${notification.id}-${index}` ? (
                  <>
                    <div className="action-spinner"></div>
                    Loading...
                  </>
                ) : (
                  action.label
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

// Hook for common notification patterns
export const useNotificationHelpers = () => {
  const { addNotification, updateNotification } = useNotifications();

  const showSuccess = useCallback((title: string, message: string, options?: Partial<Notification>) => {
    return addNotification({
      type: 'success',
      title,
      message,
      ...options
    });
  }, [addNotification]);

  const showError = useCallback((title: string, message: string, options?: Partial<Notification>) => {
    return addNotification({
      type: 'error',
      title,
      message,
      persistent: true,
      ...options
    });
  }, [addNotification]);

  const showWarning = useCallback((title: string, message: string, options?: Partial<Notification>) => {
    return addNotification({
      type: 'warning',
      title,
      message,
      ...options
    });
  }, [addNotification]);

  const showInfo = useCallback((title: string, message: string, options?: Partial<Notification>) => {
    return addNotification({
      type: 'info',
      title,
      message,
      ...options
    });
  }, [addNotification]);

  const showLoading = useCallback((title: string, message: string, options?: Partial<Notification>) => {
    return addNotification({
      type: 'loading',
      title,
      message,
      persistent: true,
      dismissible: false,
      ...options
    });
  }, [addNotification]);

  const showProgress = useCallback((
    title: string, 
    message: string, 
    progress: number,
    options?: Partial<Notification>
  ) => {
    return addNotification({
      type: 'loading',
      title,
      message,
      progress,
      persistent: true,
      dismissible: false,
      ...options
    });
  }, [addNotification]);

  const updateProgress = useCallback((id: string, progress: number, message?: string) => {
    updateNotification(id, { 
      progress,
      ...(message && { message })
    });
  }, [updateNotification]);

  const confirmAction = useCallback((
    title: string,
    message: string,
    onConfirm: () => void | Promise<void>,
    options?: {
      confirmLabel?: string;
      cancelLabel?: string;
      variant?: 'danger' | 'primary';
    }
  ) => {
    const { confirmLabel = 'Confirm', cancelLabel = 'Cancel', variant = 'primary' } = options || {};

    return addNotification({
      type: 'warning',
      title,
      message,
      persistent: true,
      actions: [
        {
          label: confirmLabel,
          action: onConfirm,
          variant: variant
        },
        {
          label: cancelLabel,
          action: () => {}, // Will auto-dismiss
          variant: 'secondary'
        }
      ]
    });
  }, [addNotification]);

  return {
    showSuccess,
    showError,
    showWarning,
    showInfo,
    showLoading,
    showProgress,
    updateProgress,
    confirmAction
  };
};

export default NotificationProvider;
