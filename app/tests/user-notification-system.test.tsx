import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { NotificationProvider, useNotifications, useNotificationHelpers } from '../src/renderer/components/UserNotificationSystem';
import React from 'react';

// Test component that uses notifications
const TestNotificationComponent: React.FC = () => {
  const { notifications, addNotification, clearAll } = useNotifications();
  const { showSuccess, showError, showWarning, showInfo } = useNotificationHelpers();

  return (
    <div>
      <div data-testid="notification-count">{notifications.length}</div>
      <button 
        onClick={() => addNotification({
          type: 'info',
          title: 'Test Notification',
          message: 'Test message'
        })}
      >
        Add Notification
      </button>
      <button onClick={() => showSuccess('Success', 'Success message')}>
        Show Success
      </button>
      <button onClick={() => showError('Error', 'Error message')}>
        Show Error
      </button>
      <button onClick={() => showWarning('Warning', 'Warning message')}>
        Show Warning
      </button>
      <button onClick={() => showInfo('Info', 'Info message')}>
        Show Info
      </button>
      <button onClick={clearAll}>Clear All</button>
    </div>
  );
};

const TestWithProvider: React.FC = () => (
  <NotificationProvider>
    <TestNotificationComponent />
  </NotificationProvider>
);

describe('UserNotificationSystem', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('provides notification context', () => {
    render(<TestWithProvider />);
    
    expect(screen.getByTestId('notification-count')).toHaveTextContent('0');
    expect(screen.getByText('Add Notification')).toBeInTheDocument();
  });

  it('adds notifications', () => {
    render(<TestWithProvider />);

    fireEvent.click(screen.getByText('Add Notification'));
    
    expect(screen.getByTestId('notification-count')).toHaveTextContent('1');
    expect(screen.getByText('Test Notification')).toBeInTheDocument();
    expect(screen.getByText('Test message')).toBeInTheDocument();
  });

  it('shows different notification types', () => {
    render(<TestWithProvider />);

    fireEvent.click(screen.getByText('Show Success'));
    fireEvent.click(screen.getByText('Show Error'));
    fireEvent.click(screen.getByText('Show Warning'));
    fireEvent.click(screen.getByText('Show Info'));

    expect(screen.getByText('Success')).toBeInTheDocument();
    expect(screen.getByText('Error')).toBeInTheDocument();
    expect(screen.getByText('Warning')).toBeInTheDocument();
    expect(screen.getByText('Info')).toBeInTheDocument();
    
    expect(screen.getByTestId('notification-count')).toHaveTextContent('4');
  });

  it('displays notification icons correctly', () => {
    render(<TestWithProvider />);

    fireEvent.click(screen.getByText('Show Success'));
    fireEvent.click(screen.getByText('Show Error'));

    // Check for success and error icons
    const notifications = document.querySelectorAll('.notification-item');
    expect(notifications).toHaveLength(2);
  });

  it('auto-dismisses notifications with duration', async () => {
    render(
      <NotificationProvider defaultDuration={100}>
        <TestNotificationComponent />
      </NotificationProvider>
    );

    fireEvent.click(screen.getByText('Show Success'));
    expect(screen.getByTestId('notification-count')).toHaveTextContent('1');

    // Wait for auto-dismiss
    await waitFor(() => {
      expect(screen.getByTestId('notification-count')).toHaveTextContent('0');
    }, { timeout: 500 });
  });

  it('allows manual dismissal of notifications', () => {
    render(<TestWithProvider />);

    fireEvent.click(screen.getByText('Show Success'));
    expect(screen.getByText('Success')).toBeInTheDocument();

    const dismissButton = screen.getByLabelText('Dismiss notification');
    fireEvent.click(dismissButton);

    expect(screen.queryByText('Success')).not.toBeInTheDocument();
    expect(screen.getByTestId('notification-count')).toHaveTextContent('0');
  });

  it('clears all notifications', () => {
    render(<TestWithProvider />);

    fireEvent.click(screen.getByText('Show Success'));
    fireEvent.click(screen.getByText('Show Error'));
    
    expect(screen.getByTestId('notification-count')).toHaveTextContent('2');

    fireEvent.click(screen.getByText('Clear All'));
    
    expect(screen.getByTestId('notification-count')).toHaveTextContent('0');
  });

  it('handles notification actions', async () => {
    const actionMock = vi.fn();
    
    const TestWithActions: React.FC = () => {
      const { addNotification } = useNotifications();

      React.useEffect(() => {
        addNotification({
          type: 'warning',
          title: 'Action Test',
          message: 'Test with actions',
          actions: [
            {
              label: 'Test Action',
              action: actionMock,
              variant: 'primary'
            }
          ]
        });
      }, []);

      return <div />;
    };

    render(
      <NotificationProvider>
        <TestWithActions />
      </NotificationProvider>
    );

    const actionButton = screen.getByText('Test Action');
    fireEvent.click(actionButton);

    await waitFor(() => {
      expect(actionMock).toHaveBeenCalled();
    });
  });

  it('shows progress notifications', () => {
    const TestWithProgress: React.FC = () => {
      const { addNotification } = useNotifications();

      React.useEffect(() => {
        addNotification({
          type: 'loading',
          title: 'Loading',
          message: 'Progress test',
          progress: 50
        });
      }, []);

      return <div />;
    };

    render(
      <NotificationProvider>
        <TestWithProgress />
      </NotificationProvider>
    );

    expect(screen.getByText('Loading')).toBeInTheDocument();
    expect(screen.getByText('50%')).toBeInTheDocument();
    
    // Check for progress bar
    const progressBar = document.querySelector('.progress-fill');
    expect(progressBar).toHaveStyle('width: 50%');
  });

  it('formats timestamps correctly', () => {
    render(<TestWithProvider />);

    fireEvent.click(screen.getByText('Show Success'));
    
    // Should show "Just now" for recent notifications
    expect(screen.getByText('Just now')).toBeInTheDocument();
  });

  it('limits max notifications', () => {
    render(
      <NotificationProvider maxNotifications={2}>
        <TestNotificationComponent />
      </NotificationProvider>
    );

    // Add 3 notifications
    fireEvent.click(screen.getByText('Show Success'));
    fireEvent.click(screen.getByText('Show Error'));
    fireEvent.click(screen.getByText('Show Warning'));

    // Should only show 2 (most recent)
    expect(screen.getByTestId('notification-count')).toHaveTextContent('2');
    expect(screen.queryByText('Success')).not.toBeInTheDocument(); // First one removed
    expect(screen.getByText('Error')).toBeInTheDocument();
    expect(screen.getByText('Warning')).toBeInTheDocument();
  });

  it('handles notification details expansion', () => {
    const TestWithDetails: React.FC = () => {
      const { addNotification } = useNotifications();

      React.useEffect(() => {
        addNotification({
          type: 'error',
          title: 'Detailed Error',
          message: 'Error with details',
          details: 'Stack trace information here'
        });
      }, []);

      return <div />;
    };

    render(
      <NotificationProvider>
        <TestWithDetails />
      </NotificationProvider>
    );

    const detailsButton = screen.getByText('Show details');
    fireEvent.click(detailsButton);

    expect(screen.getByText('Stack trace information here')).toBeInTheDocument();
  });

  it('prevents dismissal of non-dismissible notifications', () => {
    const TestNonDismissible: React.FC = () => {
      const { addNotification } = useNotifications();

      React.useEffect(() => {
        addNotification({
          type: 'loading',
          title: 'Loading',
          message: 'Cannot dismiss',
          dismissible: false,
          persistent: true
        });
      }, []);

      return <div />;
    };

    render(
      <NotificationProvider>
        <TestNonDismissible />
      </NotificationProvider>
    );

    // Should not have dismiss button
    expect(screen.queryByLabelText('Dismiss notification')).not.toBeInTheDocument();
  });
});
