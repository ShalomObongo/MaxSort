import React, { Component, ReactNode } from 'react';
import './ErrorBoundary.css';

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: React.ErrorInfo | null;
  isRestarting: boolean;
  retryCount: number;
  showDetails: boolean;
}

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: (error: Error, retryCount: number, onRetry: () => void) => ReactNode;
  onError?: (error: Error, errorInfo: React.ErrorInfo) => void;
  maxRetries?: number;
}

interface ErrorReport {
  error: string;
  stack?: string;
  componentStack: string;
  timestamp: string;
  userAgent: string;
  url: string;
  retryCount: number;
  systemInfo?: {
    memory: string;
    platform: string;
    version: string;
  };
}

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  private retryTimeoutId: number | null = null;
  private readonly maxRetries: number;

  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.maxRetries = props.maxRetries || 3;
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
      isRestarting: false,
      retryCount: 0,
      showDetails: false
    };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return {
      hasError: true,
      error
    };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    this.setState({
      error,
      errorInfo,
      retryCount: this.state.retryCount + 1
    });

    // Call custom error handler if provided
    if (this.props.onError) {
      this.props.onError(error, errorInfo);
    }

    // Log error for debugging
    console.error('ErrorBoundary caught an error:', error, errorInfo);

    // Report error to main process for logging
    this.reportError(error, errorInfo);
  }

  componentWillUnmount(): void {
    if (this.retryTimeoutId) {
      clearTimeout(this.retryTimeoutId);
    }
  }

  private reportError = async (error: Error, errorInfo: React.ErrorInfo): Promise<void> => {
    try {
      const errorReport: ErrorReport = {
        error: error.message,
        stack: error.stack,
        componentStack: errorInfo.componentStack || '',
        timestamp: new Date().toISOString(),
        userAgent: navigator.userAgent,
        url: window.location.href,
        retryCount: this.state.retryCount
      };

      // Get system info if available
      if (window.electronAPI?.invoke) {
        try {
          const systemInfo = await window.electronAPI.invoke('system:getInfo');
          errorReport.systemInfo = systemInfo;
        } catch (e) {
          console.warn('Failed to get system info for error report:', e);
        }
      }

      // Send error report to main process
      if (window.electronAPI?.invoke) {
        await window.electronAPI.invoke('error:report', errorReport);
      }
    } catch (reportError) {
      console.error('Failed to report error:', reportError);
    }
  };

  private handleRetry = (): void => {
    if (this.state.retryCount >= this.maxRetries) {
      return;
    }

    this.setState({
      isRestarting: true
    });

    // Add delay before retry to prevent rapid error loops
    this.retryTimeoutId = window.setTimeout(() => {
      this.setState({
        hasError: false,
        error: null,
        errorInfo: null,
        isRestarting: false,
        showDetails: false
      });
    }, 1000);
  };

  private handleReload = (): void => {
    if (window.electronAPI?.invoke) {
      window.electronAPI.invoke('app:reload');
    } else {
      window.location.reload();
    }
  };

  private handleRestart = (): void => {
    if (window.electronAPI?.invoke) {
      window.electronAPI.invoke('app:restart');
    }
  };

  private handleShowDetails = (): void => {
    this.setState({ showDetails: !this.state.showDetails });
  };

  private handleSendFeedback = async (): Promise<void> => {
    if (!this.state.error || !this.state.errorInfo) return;

    try {
      const errorReport: ErrorReport = {
        error: this.state.error.message,
        stack: this.state.error.stack,
        componentStack: this.state.errorInfo.componentStack || '',
        timestamp: new Date().toISOString(),
        userAgent: navigator.userAgent,
        url: window.location.href,
        retryCount: this.state.retryCount
      };

      if (window.electronAPI?.invoke) {
        await window.electronAPI.invoke('feedback:sendErrorReport', errorReport);
        // Show success message or toast
        console.log('Error report sent successfully');
      }
    } catch (error) {
      console.error('Failed to send feedback:', error);
    }
  };

  private getErrorCategory = (error: Error): 'network' | 'permission' | 'system' | 'unknown' => {
    const message = error.message.toLowerCase();
    const stack = error.stack?.toLowerCase() || '';

    if (message.includes('network') || message.includes('fetch') || message.includes('connection')) {
      return 'network';
    }
    if (message.includes('permission') || message.includes('denied') || message.includes('unauthorized')) {
      return 'permission';
    }
    if (message.includes('memory') || message.includes('system') || stack.includes('electron')) {
      return 'system';
    }
    return 'unknown';
  };

  private getTroubleshootingSteps = (category: string): string[] => {
    switch (category) {
      case 'network':
        return [
          'Check your internet connection',
          'Verify proxy settings if applicable',
          'Try refreshing the page',
          'Contact your network administrator if the issue persists'
        ];
      case 'permission':
        return [
          'Check file and folder permissions',
          'Run the application as administrator if needed',
          'Verify disk space availability',
          'Check antivirus software settings'
        ];
      case 'system':
        return [
          'Close other applications to free up memory',
          'Restart the application',
          'Update the application to the latest version',
          'Restart your computer if the issue persists'
        ];
      default:
        return [
          'Try refreshing the page',
          'Restart the application',
          'Check for application updates',
          'Contact support if the issue continues'
        ];
    }
  };

  render(): ReactNode {
    if (this.state.hasError && this.state.error) {
      // Use custom fallback if provided
      if (this.props.fallback) {
        return this.props.fallback(this.state.error, this.state.retryCount, this.handleRetry);
      }

      const category = this.getErrorCategory(this.state.error);
      const troubleshootingSteps = this.getTroubleshootingSteps(category);
      const canRetry = this.state.retryCount < this.maxRetries;

      return (
        <div className="error-boundary">
          <div className="error-boundary-content">
            <div className="error-header">
              <div className="error-icon">⚠️</div>
              <div className="error-title">
                <h2>Something went wrong</h2>
                <p className="error-subtitle">
                  {category === 'network' && 'Network connection issue detected'}
                  {category === 'permission' && 'Permission or access issue detected'}
                  {category === 'system' && 'System resource issue detected'}
                  {category === 'unknown' && 'An unexpected error occurred'}
                </p>
              </div>
            </div>

            <div className="error-message">
              <p>{this.state.error.message}</p>
              {this.state.retryCount > 1 && (
                <p className="retry-info">
                  Retry attempt {this.state.retryCount} of {this.maxRetries}
                </p>
              )}
            </div>

            <div className="troubleshooting-section">
              <h3>Try these steps:</h3>
              <ol className="troubleshooting-steps">
                {troubleshootingSteps.map((step, index) => (
                  <li key={index}>{step}</li>
                ))}
              </ol>
            </div>

            <div className="error-actions">
              {canRetry && !this.state.isRestarting && (
                <button
                  className="retry-button primary"
                  onClick={this.handleRetry}
                  disabled={this.state.isRestarting}
                >
                  Try Again
                </button>
              )}

              {this.state.isRestarting && (
                <div className="restarting-indicator">
                  <div className="spinner"></div>
                  <span>Restarting...</span>
                </div>
              )}

              <button
                className="reload-button secondary"
                onClick={this.handleReload}
              >
                Reload Page
              </button>

              <button
                className="restart-button secondary"
                onClick={this.handleRestart}
              >
                Restart App
              </button>
            </div>

            <div className="error-details-section">
              <button
                className="details-toggle"
                onClick={this.handleShowDetails}
              >
                {this.state.showDetails ? 'Hide' : 'Show'} Technical Details
              </button>

              {this.state.showDetails && (
                <div className="error-details">
                  <div className="error-info">
                    <h4>Error Details:</h4>
                    <pre className="error-stack">
                      {this.state.error.stack}
                    </pre>
                  </div>

                  {this.state.errorInfo && (
                    <div className="component-info">
                      <h4>Component Stack:</h4>
                      <pre className="component-stack">
                        {this.state.errorInfo.componentStack}
                      </pre>
                    </div>
                  )}

                  <div className="system-info">
                    <h4>System Information:</h4>
                    <ul>
                      <li>Timestamp: {new Date().toLocaleString()}</li>
                      <li>User Agent: {navigator.userAgent}</li>
                      <li>URL: {window.location.href}</li>
                      <li>Retry Count: {this.state.retryCount}</li>
                    </ul>
                  </div>
                </div>
              )}
            </div>

            <div className="error-feedback">
              <button
                className="feedback-button tertiary"
                onClick={this.handleSendFeedback}
              >
                Send Error Report
              </button>
              <p className="feedback-note">
                Help us improve by sending an anonymous error report
              </p>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
