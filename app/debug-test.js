// Simple debug script to test the component behavior
import { render, screen } from '@testing-library/react';
import OperationHistory from './src/renderer/components/OperationHistory';

// Mock window.electronAPI
const mockElectronAPI = {
  invoke: vi.fn().mockResolvedValue({
    success: true,
    operations: [],
    stats: { total: 0, completed: 0, failed: 0, cancelled: 0, partiallyCompleted: 0 }
  }),
  on: vi.fn(),
  removeAllListeners: vi.fn()
};

Object.defineProperty(window, 'electronAPI', {
  value: mockElectronAPI,
  writable: true
});

console.log('Testing component render...');
const { container } = render(<OperationHistory />);
console.log('Component HTML:', container.innerHTML);
