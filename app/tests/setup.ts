import '@testing-library/jest-dom';
import { expect, afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import * as matchers from '@testing-library/jest-dom/matchers';

// Extend Vitest's expect with testing-library matchers
expect.extend(matchers);

// Mock Electron's app module for database tests
vi.mock('electron', () => ({
  app: {
    getPath: vi.fn((name: string) => {
      switch (name) {
        case 'userData':
          return '/tmp/maxsort-test';
        case 'logs':
          return '/tmp/maxsort-test/logs';
        default:
          return '/tmp/maxsort-test';
      }
    }),
  },
  ipcRenderer: {
    invoke: vi.fn(),
    send: vi.fn(),
    on: vi.fn(),
  },
}));

// Mock fs-extra for database operations
vi.mock('fs-extra', () => ({
  ensureDirSync: vi.fn(),
  existsSync: vi.fn(() => true),
  mkdirSync: vi.fn(),
}));

// Mock Worker to prevent unhandled messages
vi.mock('worker_threads', () => ({
  Worker: vi.fn().mockImplementation(() => ({
    postMessage: vi.fn(),
    terminate: vi.fn(),
    on: vi.fn(),
    removeListener: vi.fn(),
  })),
  isMainThread: true,
  parentPort: null,
  workerData: null,
}));

// Mock file scanner worker
vi.mock('../src/workers/file-scanner', () => ({
  scanDirectory: vi.fn(() => Promise.resolve([])),
  FileScanner: vi.fn().mockImplementation(() => ({
    scanDirectory: vi.fn(() => Promise.resolve([])),
    dispose: vi.fn(),
  })),
}));

// Global React act mock to handle React 18 concurrent rendering
vi.mock('react-dom/test-utils', () => ({
  act: (fn: any) => fn(),
}));

// Mock DOM APIs that might not be available in jsdom
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(), // deprecated
    removeListener: vi.fn(), // deprecated
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

// Clean up after each test
afterEach(() => {
  cleanup();
});
