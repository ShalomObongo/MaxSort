import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { vi } from 'vitest';
import AppLayout, { NavigationItem } from '../AppLayout';

const mockNavigationItems: NavigationItem[] = [
  {
    id: 'dashboard',
    label: 'Dashboard',
    icon: '🏠',
    component: <div>Dashboard Content</div>
  },
  {
    id: 'settings',
    label: 'Settings',
    icon: '⚙️',
    component: <div>Settings Content</div>,
    badge: '2'
  },
  {
    id: 'disabled',
    label: 'Disabled',
    icon: '❌',
    component: <div>Disabled Content</div>,
    disabled: true
  }
];

const mockSystemStatus = {
  memory: {
    used: 4000000000,
    total: 16000000000,
    percentage: 25
  },
  agents: {
    active: 2,
    total: 4,
    status: 'healthy' as const
  },
  operations: {
    active: 1,
    pending: 3,
    completed: 10
  }
};

describe('AppLayout', () => {
  const defaultProps = {
    children: <div>Test Content</div>,
    navigationItems: mockNavigationItems,
    currentView: 'dashboard',
    onNavigationChange: vi.fn()
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('renders basic layout structure', () => {
    render(<AppLayout {...defaultProps} />);
    
    expect(screen.getByText('MaxSort')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Dashboard' })).toBeInTheDocument();
    expect(screen.getByText('Test Content')).toBeInTheDocument();
  });

  test('displays navigation items correctly', () => {
    render(<AppLayout {...defaultProps} />);
    
    expect(screen.getByRole('button', { name: /Dashboard/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Settings/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Disabled/ })).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument(); // Badge
  });

  test('handles navigation changes', () => {
    const onNavigationChange = vi.fn();
    render(<AppLayout {...defaultProps} onNavigationChange={onNavigationChange} />);
    
    fireEvent.click(screen.getByRole('button', { name: /Settings/ }));
    expect(onNavigationChange).toHaveBeenCalledWith('settings');
  });

  test('does not call navigation change for disabled items', () => {
    const onNavigationChange = vi.fn();
    render(<AppLayout {...defaultProps} onNavigationChange={onNavigationChange} />);
    
    fireEvent.click(screen.getByRole('button', { name: /Disabled/ }));
    expect(onNavigationChange).not.toHaveBeenCalled();
  });

  test('toggles sidebar correctly', () => {
    render(<AppLayout {...defaultProps} />);
    
    const toggleButton = screen.getByLabelText('Collapse sidebar');
    fireEvent.click(toggleButton);
    
    expect(screen.getByLabelText('Expand sidebar')).toBeInTheDocument();
  });

  test('displays system status when provided', () => {
    render(<AppLayout {...defaultProps} systemStatus={mockSystemStatus} />);
    
    expect(screen.getByText('2/4 agents')).toBeInTheDocument();
  });

  test('shows system status dropdown on click', () => {
    render(<AppLayout {...defaultProps} systemStatus={mockSystemStatus} />);
    
    const statusIndicator = screen.getByTitle('System Status');
    fireEvent.click(statusIndicator);
    
    expect(screen.getByText('Memory')).toBeInTheDocument();
    expect(screen.getByText('Operations')).toBeInTheDocument();
  });

  test('displays user profile when provided', () => {
    const user = { name: 'John Doe', avatar: 'avatar.png' };
    render(<AppLayout {...defaultProps} user={user} />);
    
    expect(screen.getByAltText('John Doe')).toBeInTheDocument();
  });

  test('shows current view title in header', () => {
    render(<AppLayout {...defaultProps} currentView="settings" />);
    
    expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument();
  });

  test('marks active navigation item', () => {
    render(<AppLayout {...defaultProps} currentView="settings" />);
    
    const settingsButton = screen.getByRole('button', { name: /Settings/ });
    expect(settingsButton).toHaveClass('active');
  });

  test('renders status bar with system information', () => {
    render(<AppLayout {...defaultProps} systemStatus={mockSystemStatus} />);
    
    expect(screen.getByText('Ready')).toBeInTheDocument();
    expect(screen.getByText('v1.0.0')).toBeInTheDocument();
  });
});
