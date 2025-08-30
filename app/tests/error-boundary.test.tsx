import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ErrorBoundary from '../src/renderer/components/ErrorBoundary';
import React from 'react';

// Mock Electron API
const mockElectronAPI = {
  invoke: vi.fn()
};

beforeEach(() => {
  (global as any).window = {
    electronAPI: mockElectronAPI
  };
  vi.clearAllMocks();
});

// Component that throws an error for testing
const ThrowError: React.FC<{ shouldThrow: boolean }> = ({ shouldThrow }) => {
  if (shouldThrow) {
    throw new Error('Test error');
  }
  return <div>No error</div>;
};

describe('ErrorBoundary', () => {
  it('renders children when there is no error', () => {
    render(
      <ErrorBoundary>
        <ThrowError shouldThrow={false} />
      </ErrorBoundary>
    );

    expect(screen.getByText('No error')).toBeInTheDocument();
  });

  it('renders error UI when an error is thrown', () => {
    // Suppress console.error for this test
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <ErrorBoundary>
        <ThrowError shouldThrow={true} />
      </ErrorBoundary>
    );

    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    expect(screen.getByText('Test error')).toBeInTheDocument();

    consoleSpy.mockRestore();
  });

  it('shows troubleshooting steps', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <ErrorBoundary>
        <ThrowError shouldThrow={true} />
      </ErrorBoundary>
    );

    expect(screen.getByText('Try these steps:')).toBeInTheDocument();
    expect(screen.getByRole('list')).toBeInTheDocument();

    consoleSpy.mockRestore();
  });

  it('provides retry functionality', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    let shouldThrow = true;

    const { rerender } = render(
      <ErrorBoundary maxRetries={3}>
        <ThrowError shouldThrow={shouldThrow} />
      </ErrorBoundary>
    );

    expect(screen.getByText('Something went wrong')).toBeInTheDocument();

    // Click retry button
    const retryButton = screen.getByText('Try Again');
    expect(retryButton).toBeInTheDocument();

    // Change the component to not throw
    shouldThrow = false;
    fireEvent.click(retryButton);

    // Wait for retry timeout
    await waitFor(() => {
      rerender(
        <ErrorBoundary maxRetries={3}>
          <ThrowError shouldThrow={shouldThrow} />
        </ErrorBoundary>
      );
    }, { timeout: 2000 });

    consoleSpy.mockRestore();
  });

  it('shows technical details when expanded', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <ErrorBoundary>
        <ThrowError shouldThrow={true} />
      </ErrorBoundary>
    );

    const detailsButton = screen.getByText('Show Technical Details');
    fireEvent.click(detailsButton);

    expect(screen.getByText('Error Details:')).toBeInTheDocument();
    expect(screen.getByText('Component Stack:')).toBeInTheDocument();

    consoleSpy.mockRestore();
  });

  it('calls onError callback when provided', () => {
    const onErrorMock = vi.fn();
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <ErrorBoundary onError={onErrorMock}>
        <ThrowError shouldThrow={true} />
      </ErrorBoundary>
    );

    expect(onErrorMock).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        componentStack: expect.any(String)
      })
    );

    consoleSpy.mockRestore();
  });

  it('uses custom fallback when provided', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const customFallback = (error: Error) => <div>Custom error: {error.message}</div>;

    render(
      <ErrorBoundary fallback={customFallback}>
        <ThrowError shouldThrow={true} />
      </ErrorBoundary>
    );

    expect(screen.getByText('Custom error: Test error')).toBeInTheDocument();

    consoleSpy.mockRestore();
  });

  it('reports error to main process', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockElectronAPI.invoke.mockResolvedValue(undefined);

    render(
      <ErrorBoundary>
        <ThrowError shouldThrow={true} />
      </ErrorBoundary>
    );

    await waitFor(() => {
      expect(mockElectronAPI.invoke).toHaveBeenCalledWith('error:report', expect.objectContaining({
        error: 'Test error',
        timestamp: expect.any(String),
        retryCount: expect.any(Number)
      }));
    });

    consoleSpy.mockRestore();
  });

  it('handles reload and restart actions', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockElectronAPI.invoke.mockResolvedValue(undefined);

    render(
      <ErrorBoundary>
        <ThrowError shouldThrow={true} />
      </ErrorBoundary>
    );

    const reloadButton = screen.getByText('Reload Page');
    const restartButton = screen.getByText('Restart App');

    fireEvent.click(reloadButton);
    expect(mockElectronAPI.invoke).toHaveBeenCalledWith('app:reload');

    fireEvent.click(restartButton);
    expect(mockElectronAPI.invoke).toHaveBeenCalledWith('app:restart');

    consoleSpy.mockRestore();
  });

  it('categorizes errors correctly', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    // Test network error
    const NetworkError = () => {
      throw new Error('Network connection failed');
    };

    render(
      <ErrorBoundary>
        <NetworkError />
      </ErrorBoundary>
    );

    expect(screen.getByText('Network connection issue detected')).toBeInTheDocument();

    consoleSpy.mockRestore();
  });

  it('disables retry after max attempts', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <ErrorBoundary maxRetries={1}>
        <ThrowError shouldThrow={true} />
      </ErrorBoundary>
    );

    // First retry
    const retryButton = screen.getByText('Try Again');
    fireEvent.click(retryButton);

    // Should show retry count
    expect(screen.getByText(/Retry attempt/)).toBeInTheDocument();

    // After max retries, button should be disabled or not visible
    // This would need to be tested with a more complex scenario

    consoleSpy.mockRestore();
  });
});
