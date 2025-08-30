import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { HelpProvider, useHelp, Tooltip, withHelp } from '../src/renderer/components/ContextualHelpSystem';
import React from 'react';

// Test component that uses help context
const TestHelpComponent: React.FC = () => {
  const { showHelp, hideHelp, toggleHelpMode, isHelpModeActive } = useHelp();

  return (
    <div>
      <div data-testid="help-mode-status">{isHelpModeActive ? 'active' : 'inactive'}</div>
      <button onClick={() => showHelp('test-item')}>Show Help</button>
      <button onClick={hideHelp}>Hide Help</button>
      <button onClick={toggleHelpMode}>Toggle Help Mode</button>
    </div>
  );
};

const TestWithProvider: React.FC = () => (
  <HelpProvider>
    <TestHelpComponent />
  </HelpProvider>
);

// Test component for tooltip
const TooltipTestComponent: React.FC = () => (
  <HelpProvider>
    <Tooltip content="Test tooltip content" position="top">
      <button>Hover me</button>
    </Tooltip>
  </HelpProvider>
);

// Test component with help HOC
const BasicComponent: React.FC = () => <div>Basic Component</div>;
const ComponentWithHelp = withHelp('directory-picker')(BasicComponent);

describe('ContextualHelpSystem', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('provides help context', () => {
    render(<TestWithProvider />);
    
    expect(screen.getByTestId('help-mode-status')).toHaveTextContent('inactive');
    expect(screen.getByText('Show Help')).toBeInTheDocument();
    expect(screen.getByText('Toggle Help Mode')).toBeInTheDocument();
  });

  it('toggles help mode', () => {
    render(<TestWithProvider />);
    
    expect(screen.getByTestId('help-mode-status')).toHaveTextContent('inactive');
    
    fireEvent.click(screen.getByText('Toggle Help Mode'));
    
    expect(screen.getByTestId('help-mode-status')).toHaveTextContent('active');
  });

  it('shows help panel when requested', () => {
    render(<TestWithProvider />);
    
    fireEvent.click(screen.getByText('Show Help'));
    
    expect(screen.getByText('Help & Documentation')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Search help topics...')).toBeInTheDocument();
  });

  it('hides help panel', () => {
    render(<TestWithProvider />);
    
    fireEvent.click(screen.getByText('Show Help'));
    expect(screen.getByText('Help & Documentation')).toBeInTheDocument();
    
    fireEvent.click(screen.getByText('Hide Help'));
    expect(screen.queryByText('Help & Documentation')).not.toBeInTheDocument();
  });

  it('closes help panel with X button', () => {
    render(<TestWithProvider />);
    
    fireEvent.click(screen.getByText('Show Help'));
    expect(screen.getByText('Help & Documentation')).toBeInTheDocument();
    
    const closeButton = screen.getByText('×');
    fireEvent.click(closeButton);
    
    expect(screen.queryByText('Help & Documentation')).not.toBeInTheDocument();
  });

  it('displays help categories', () => {
    render(<TestWithProvider />);
    
    fireEvent.click(screen.getByText('Show Help'));
    
    expect(screen.getByText('All Topics')).toBeInTheDocument();
    expect(screen.getByText('Getting Started')).toBeInTheDocument();
    expect(screen.getByText('Advanced Features')).toBeInTheDocument();
    expect(screen.getByText('Troubleshooting')).toBeInTheDocument();
    expect(screen.getByText('Tips & Tricks')).toBeInTheDocument();
  });

  it('filters help items by category', () => {
    render(<TestWithProvider />);
    
    fireEvent.click(screen.getByText('Show Help'));
    
    // Click on Getting Started category
    fireEvent.click(screen.getByText('Getting Started'));
    
    // Should show basic category items
    expect(screen.getByText('Selecting Directories')).toBeInTheDocument();
    expect(screen.getByText('File Analysis Results')).toBeInTheDocument();
  });

  it('searches help items', () => {
    render(<TestWithProvider />);
    
    fireEvent.click(screen.getByText('Show Help'));
    
    const searchInput = screen.getByPlaceholderText('Search help topics...');
    fireEvent.change(searchInput, { target: { value: 'ollama' } });
    
    expect(screen.getByText('Setting up Ollama')).toBeInTheDocument();
  });

  it('shows help item details', () => {
    render(<TestWithProvider />);
    
    fireEvent.click(screen.getByText('Show Help'));
    fireEvent.click(screen.getByText('Selecting Directories'));
    
    expect(screen.getByText('← Back to Help')).toBeInTheDocument();
    expect(screen.getByText('Step-by-step Instructions')).toBeInTheDocument();
    expect(screen.getByText('Click the "Select Directory" button')).toBeInTheDocument();
  });

  it('navigates back from help detail', () => {
    render(<TestWithProvider />);
    
    fireEvent.click(screen.getByText('Show Help'));
    fireEvent.click(screen.getByText('Selecting Directories'));
    
    expect(screen.getByText('← Back to Help')).toBeInTheDocument();
    
    fireEvent.click(screen.getByText('← Back to Help'));
    
    expect(screen.getByText('Choose a guide to resolve common issues')).toBeInTheDocument();
  });

  it('shows related topics', () => {
    render(<TestWithProvider />);
    
    fireEvent.click(screen.getByText('Show Help'));
    fireEvent.click(screen.getByText('Batch File Operations'));
    
    expect(screen.getByText('Related Topics')).toBeInTheDocument();
    // Related topics should be clickable
    const relatedButtons = screen.getAllByRole('button').filter(
      button => button.textContent?.includes('File Analysis') || 
                button.textContent?.includes('Operation Preview')
    );
    expect(relatedButtons.length).toBeGreaterThan(0);
  });

  it('displays video badge for items with videos', () => {
    render(<TestWithProvider />);
    
    fireEvent.click(screen.getByText('Show Help'));
    fireEvent.click(screen.getByText('Setting up Ollama'));
    
    expect(screen.getByText('📹 Video Tutorial')).toBeInTheDocument();
    expect(screen.getByText('Watch Video')).toBeInTheDocument();
  });

  it('shows warnings in help items', () => {
    render(<TestWithProvider />);
    
    fireEvent.click(screen.getByText('Show Help'));
    fireEvent.click(screen.getByText('Database Corruption Issues'));
    
    expect(screen.getByText('⚠️ Important Warnings')).toBeInTheDocument();
  });

  describe('Tooltip', () => {
    it('renders tooltip trigger', () => {
      render(<TooltipTestComponent />);
      
      expect(screen.getByText('Hover me')).toBeInTheDocument();
    });

    it('shows tooltip on hover', async () => {
      render(<TooltipTestComponent />);
      
      const trigger = screen.getByText('Hover me');
      fireEvent.mouseEnter(trigger);
      
      await waitFor(() => {
        expect(screen.getByText('Test tooltip content')).toBeInTheDocument();
      }, { timeout: 1000 });
    });

    it('hides tooltip on mouse leave', async () => {
      render(<TooltipTestComponent />);
      
      const trigger = screen.getByText('Hover me');
      fireEvent.mouseEnter(trigger);
      
      await waitFor(() => {
        expect(screen.getByText('Test tooltip content')).toBeInTheDocument();
      });
      
      fireEvent.mouseLeave(trigger);
      
      await waitFor(() => {
        expect(screen.queryByText('Test tooltip content')).not.toBeInTheDocument();
      });
    });

    it('shows tooltip on click trigger', () => {
      render(
        <HelpProvider>
          <Tooltip content="Click tooltip" trigger="click">
            <button>Click me</button>
          </Tooltip>
        </HelpProvider>
      );
      
      const trigger = screen.getByText('Click me');
      fireEvent.click(trigger);
      
      expect(screen.getByText('Click tooltip')).toBeInTheDocument();
    });
  });

  describe('withHelp HOC', () => {
    it('wraps component with help functionality', () => {
      render(
        <HelpProvider>
          <ComponentWithHelp />
        </HelpProvider>
      );
      
      expect(screen.getByText('Basic Component')).toBeInTheDocument();
      
      // Should have help wrapper class
      const wrapper = document.querySelector('.help-enabled-component');
      expect(wrapper).toBeInTheDocument();
    });

    it('shows help on click in help mode', () => {
      render(
        <HelpProvider>
          <TestHelpComponent />
          <ComponentWithHelp />
        </HelpProvider>
      );
      
      // Enable help mode
      fireEvent.click(screen.getByText('Toggle Help Mode'));
      
      // Click on component
      const component = screen.getByText('Basic Component');
      fireEvent.click(component);
      
      // Should open help panel
      expect(screen.getByText('Help & Documentation')).toBeInTheDocument();
    });
  });

  describe('Keyboard shortcuts', () => {
    it('opens help with F1 key', () => {
      render(<TestWithProvider />);
      
      fireEvent.keyDown(document, { key: 'F1' });
      
      expect(screen.getByText('Help & Documentation')).toBeInTheDocument();
    });

    it('closes help with Escape key', () => {
      render(<TestWithProvider />);
      
      fireEvent.click(screen.getByText('Show Help'));
      expect(screen.getByText('Help & Documentation')).toBeInTheDocument();
      
      fireEvent.keyDown(document, { key: 'Escape' });
      
      expect(screen.queryByText('Help & Documentation')).not.toBeInTheDocument();
    });
  });

  it('shows help mode indicator when active', () => {
    render(<TestWithProvider />);
    
    fireEvent.click(screen.getByText('Toggle Help Mode'));
    
    expect(screen.getByText('Help Mode Active - Click on elements for help')).toBeInTheDocument();
    expect(screen.getByText('Exit Help Mode')).toBeInTheDocument();
  });

  it('exits help mode from indicator', () => {
    render(<TestWithProvider />);
    
    fireEvent.click(screen.getByText('Toggle Help Mode'));
    expect(screen.getByText('Help Mode Active - Click on elements for help')).toBeInTheDocument();
    
    fireEvent.click(screen.getByText('Exit Help Mode'));
    expect(screen.queryByText('Help Mode Active - Click on elements for help')).not.toBeInTheDocument();
  });

  it('displays category icons correctly', () => {
    render(<TestWithProvider />);
    
    fireEvent.click(screen.getByText('Show Help'));
    
    // Should show emoji icons for different categories
    const icons = ['📚', '🔧', '🔍', '💡'];
    icons.forEach(icon => {
      expect(document.body.innerHTML).toContain(icon);
    });
  });
});
