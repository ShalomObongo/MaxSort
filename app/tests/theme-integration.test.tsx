import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { ThemeProvider, ThemeContext } from '../src/renderer/contexts/ThemeContext';
import ThemeCustomizer from '../src/renderer/components/ThemeCustomizer';
import Settings from '../src/renderer/components/Settings';
import { AppStateProvider } from '../src/renderer/store/AppStateContext';

// Mock Electron API
const mockElectronAPI = {
  getVersion: vi.fn().mockResolvedValue('1.0.0'),
  getPlatform: vi.fn().mockResolvedValue('darwin'),
  getAgentStatus: vi.fn().mockResolvedValue({ status: 'idle', agents: [] }),
  invoke: vi.fn().mockImplementation((channel: string, data?: any) => {
    if (channel === 'get-system-info') {
      return Promise.resolve({
        platform: 'darwin',
        arch: 'x64',
        version: '1.0.0',
        nodeVersion: '20.0.0'
      });
    }
    if (channel === 'get-app-settings') {
      return Promise.resolve({});
    }
    if (channel === 'save-app-settings') {
      return Promise.resolve();
    }
    return Promise.resolve({});
  }),
  on: vi.fn(),
  off: vi.fn()
};

// Mock window.electronAPI
Object.defineProperty(window, 'electronAPI', {
  value: mockElectronAPI,
  writable: true
});

// Mock localStorage
const mockLocalStorage = {
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn()
};

Object.defineProperty(window, 'localStorage', {
  value: mockLocalStorage,
  writable: true
});

// Test wrapper component
const TestWrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  return (
    <AppStateProvider>
      <ThemeProvider>
        {children}
      </ThemeProvider>
    </AppStateProvider>
  );
};

describe('Theme Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLocalStorage.getItem.mockReturnValue(null);
  });

  describe('ThemeProvider', () => {
    it('should provide theme context to children', () => {
        const TestComponent = () => {
        const context = React.useContext(ThemeContext);
        return (
          <div>
            <span data-testid="current-theme">{context?.preferences.theme}</span>
            <span data-testid="theme-loaded">{context ? 'loaded' : 'not-loaded'}</span>
          </div>
        );
      };

      render(
        <TestWrapper>
          <TestComponent />
        </TestWrapper>
      );

      expect(screen.getByTestId('theme-loaded')).toHaveTextContent('loaded');
      expect(screen.getByTestId('current-theme')).toHaveTextContent('system');
    });

    it('should apply theme classes to document', async () => {
      render(
        <TestWrapper>
          <div>Test content</div>
        </TestWrapper>
      );

      await waitFor(() => {
        expect(document.documentElement.classList).toContain('theme-light');
      });
    });

    it('should load saved theme preferences', () => {
      mockLocalStorage.getItem.mockImplementation((key) => {
        if (key === 'maxsort-theme-preferences') {
          return JSON.stringify({
            theme: 'dark',
            fontSize: 'medium',
            compactMode: false,
            highContrast: false,
            reducedMotion: false,
            animationsEnabled: true,
            colorScheme: { primary: '#ff0000' }
          });
        }
        return null;
      });

      const TestComponent = () => {
        const context = React.useContext(ThemeContext);
        return <span data-testid="theme">{context?.preferences.theme}</span>;
      };

      render(
        <TestWrapper>
          <TestComponent />
        </TestWrapper>
      );

      expect(screen.getByTestId('theme')).toHaveTextContent('dark');
    });
  });

  describe('ThemeCustomizer Component', () => {
    it('should render theme customizer interface', () => {
      render(
        <TestWrapper>
          <ThemeCustomizer />
        </TestWrapper>
      );

      expect(screen.getByText('Theme Customization')).toBeInTheDocument();
      expect(screen.getByText('Theme Presets')).toBeInTheDocument();
      expect(screen.getByText('Color Customization')).toBeInTheDocument();
    });

    it('should display theme presets', () => {
      render(
        <TestWrapper>
          <ThemeCustomizer />
        </TestWrapper>
      );

      expect(screen.getByText('Light')).toBeInTheDocument();
      expect(screen.getByText('Dark')).toBeInTheDocument();
      expect(screen.getByText('High Contrast')).toBeInTheDocument();
    });

    it('should allow theme switching', async () => {
      const TestComponent = () => {
        const context = React.useContext(ThemeContext);
        return (
          <div>
            <ThemeCustomizer />
            <span data-testid="current-theme">{context?.preferences.theme}</span>
          </div>
        );
      };

      render(
        <TestWrapper>
          <TestComponent />
        </TestWrapper>
      );

      const darkThemeButton = screen.getByRole('button', { name: /dark/i });
      fireEvent.click(darkThemeButton);

        await waitFor(() => {
        expect(screen.getByTestId('current-theme')).toHaveTextContent('dark');
      });
    });

    it('should show color picker for custom colors', () => {
      render(
        <TestWrapper>
          <ThemeCustomizer />
        </TestWrapper>
      );

      expect(screen.getByText('Primary Color')).toBeInTheDocument();
      expect(screen.getByText('Secondary Color')).toBeInTheDocument();
      expect(screen.getByText('Accent Color')).toBeInTheDocument();
    });

    it('should export and import theme configurations', async () => {
      render(
        <TestWrapper>
          <ThemeCustomizer />
        </TestWrapper>
      );

      const exportButton = screen.getByRole('button', { name: /export theme/i });
      expect(exportButton).toBeInTheDocument();

      const importButton = screen.getByRole('button', { name: /import theme/i });
      expect(importButton).toBeInTheDocument();
    });
  });

  describe('Settings Integration', () => {
    it('should render settings with theme tab', () => {
      render(
        <TestWrapper>
          <Settings />
        </TestWrapper>
      );

      expect(screen.getByText('Theme')).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: /theme/i })).toBeInTheDocument();
    });

    it('should display theme customizer in theme tab', async () => {
      render(
        <TestWrapper>
          <Settings />
        </TestWrapper>
      );

      const themeTab = screen.getByRole('tab', { name: /theme/i });
      fireEvent.click(themeTab);

      await waitFor(() => {
        expect(screen.getByText('Theme Customization')).toBeInTheDocument();
      });
    });

    it('should maintain theme settings across tab switches', async () => {
      const TestComponent = () => {
        const context = React.useContext(ThemeContext);
        return (
          <div>
            <Settings />
            <span data-testid="theme-state">{context?.preferences.theme}</span>
          </div>
        );
      };

      render(
        <TestWrapper>
          <TestComponent />
        </TestWrapper>
      );

      // Switch to theme tab
      const themeTab = screen.getByRole('tab', { name: /theme/i });
      fireEvent.click(themeTab);

      // Wait for theme customizer to load
      await waitFor(() => {
        expect(screen.getByText('Theme Customization')).toBeInTheDocument();
      });

      // Change theme
      const darkButton = screen.getByRole('button', { name: /dark/i });
      fireEvent.click(darkButton);

      // Switch to another tab
      const modelTab = screen.getByRole('tab', { name: /model config/i });
      fireEvent.click(modelTab);

      // Switch back to theme tab
      fireEvent.click(themeTab);

      // Theme should still be dark
      await waitFor(() => {
        expect(screen.getByTestId('theme-state')).toHaveTextContent('dark');
      });
    });
  });

  describe('CSS Variables Integration', () => {
    it('should apply CSS variables to document', async () => {
      render(
        <TestWrapper>
          <div>Test</div>
        </TestWrapper>
      );

      await waitFor(() => {
        const root = document.documentElement;
        const primaryColor = getComputedStyle(root).getPropertyValue('--color-primary');
        expect(primaryColor).toBeTruthy();
      });
    });

    it('should update CSS variables when theme changes', async () => {
      const TestComponent = () => {
        const { updateTheme } = React.useContext(ThemeContext)!;
        
        return (
          <div>
            <button onClick={() => updateTheme('dark')}>Switch to Dark</button>
          </div>
        );
      };

      render(
        <TestWrapper>
          <TestComponent />
        </TestWrapper>
      );

      const switchButton = screen.getByRole('button', { name: /switch to dark/i });
      fireEvent.click(switchButton);

      await waitFor(() => {
        expect(document.documentElement.classList).toContain('theme-dark');
      });
    });
  });

  describe('Responsive Design', () => {
    it('should apply responsive classes', () => {
      render(
        <TestWrapper>
          <ThemeCustomizer />
        </TestWrapper>
      );

      const customizer = screen.getByTestId('theme-customizer');
      expect(customizer).toHaveClass('theme-customizer');
    });

    it('should handle mobile viewport', () => {
      // Mock mobile viewport
      Object.defineProperty(window, 'innerWidth', {
        writable: true,
        configurable: true,
        value: 375,
      });

      render(
        <TestWrapper>
          <ThemeCustomizer />
        </TestWrapper>
      );

      // Should still render properly on mobile
      expect(screen.getByText('Theme Customization')).toBeInTheDocument();
    });
  });

  describe('Accessibility', () => {
    it('should have proper ARIA labels', () => {
      render(
        <TestWrapper>
          <ThemeCustomizer />
        </TestWrapper>
      );

      expect(screen.getByRole('main')).toHaveAttribute('aria-label', 'Theme Customization');
    });

    it('should support keyboard navigation', () => {
      render(
        <TestWrapper>
          <ThemeCustomizer />
        </TestWrapper>
      );

      const lightButton = screen.getByRole('button', { name: /light/i });
      expect(lightButton).toHaveAttribute('tabindex', '0');
    });

    it('should announce theme changes', async () => {
      render(
        <TestWrapper>
          <ThemeCustomizer />
        </TestWrapper>
      );

      const darkButton = screen.getByRole('button', { name: /dark/i });
      fireEvent.click(darkButton);

      await waitFor(() => {
        const announcement = screen.getByRole('status');
        expect(announcement).toHaveTextContent(/theme changed to dark/i);
      });
    });
  });

  describe('Error Handling', () => {
    it('should handle localStorage errors gracefully', () => {
      mockLocalStorage.getItem.mockImplementation(() => {
        throw new Error('Storage error');
      });

      expect(() => {
        render(
          <TestWrapper>
            <div>Test</div>
          </TestWrapper>
        );
      }).not.toThrow();
    });

    it('should fallback to default theme on invalid saved theme', () => {
      mockLocalStorage.getItem.mockReturnValue('invalid-json');

      const TestComponent = () => {
        const context = React.useContext(ThemeContext);
        return <span data-testid="theme">{context?.preferences.theme}</span>;
      };

      render(
        <TestWrapper>
          <TestComponent />
        </TestWrapper>
      );

      expect(screen.getByTestId('theme')).toHaveTextContent('system');
    });
  });
});
