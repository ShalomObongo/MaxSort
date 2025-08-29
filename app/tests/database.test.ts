import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Mock Electron app module for testing
vi.mock('electron', () => ({
  app: {
    getPath: vi.fn((name: string) => {
      if (name === 'userData') {
        return path.join(os.tmpdir(), 'maxsort-test-' + Math.random().toString(36).substring(7));
      }
      return '/tmp';
    })
  }
}));

describe('DatabaseManager', () => {
  let db: any;
  let testDbPath: string;
  let DatabaseManager: any;
  let getDatabase: any;

  beforeEach(async () => {
    // Import after mocking
    const dbModule = await import('../src/lib/database');
    DatabaseManager = dbModule.DatabaseManager;
    getDatabase = dbModule.getDatabase;

    // Create test directory  
    const testDir = path.join(os.tmpdir(), 'maxsort-test-' + Math.random().toString(36).substring(7));
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
    }
    testDbPath = path.join(testDir, 'maxsort.db');
    
    // Clean up any existing test database
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }

    db = new DatabaseManager();
    await db.initialize();
  });

  afterEach(() => {
    if (db && typeof db.close === 'function') {
      db.close();
    }
    
    // Clean up test database
    if (fs.existsSync(testDbPath)) {
      try {
        fs.unlinkSync(testDbPath);
      } catch (error) {
        console.warn('Failed to clean up test database:', error);
      }
    }
  });

  describe('File Operations', () => {
    it('should insert and retrieve file records', () => {
      const fileData = {
        path: '/test/file.txt',
        size: 1024,
        mtime: Math.floor(Date.now() / 1000),
        lastScannedAt: Math.floor(Date.now() / 1000),
        fileName: 'file.txt',
        fileExtension: '.txt',
        parentDirectory: '/test',
        relativePathFromRoot: 'file.txt'
      };

      const id = db.upsertFile(fileData);
      expect(id).toBeDefined();

      const retrieved = db.getFileByPath('/test/file.txt');
      expect(retrieved).toBeDefined();
      expect(retrieved?.path).toBe(fileData.path);
      expect(retrieved?.size).toBe(fileData.size);
      expect(retrieved?.fileName).toBe(fileData.fileName);
    });

    it('should update existing file records on upsert', () => {
      const fileData = {
        path: '/test/file.txt',
        size: 1024,
        mtime: Math.floor(Date.now() / 1000),
        lastScannedAt: Math.floor(Date.now() / 1000),
        fileName: 'file.txt',
        fileExtension: '.txt',
        parentDirectory: '/test'
      };

      // Insert initial record
      db.upsertFile(fileData);
      
      // Update with new data
      const updatedData = {
        ...fileData,
        size: 2048,
        sha256: 'abc123def456'
      };
      
      db.upsertFile(updatedData);
      
      const retrieved = db.getFileByPath('/test/file.txt');
      expect(retrieved?.size).toBe(2048);
      expect(retrieved?.sha256).toBe('abc123def456');
    });

    it('should retrieve files by root path', () => {
      const files = [
        {
          path: '/test/dir1/file1.txt',
          size: 100,
          mtime: Math.floor(Date.now() / 1000),
          lastScannedAt: Math.floor(Date.now() / 1000),
          parentDirectory: '/test/dir1'
        },
        {
          path: '/test/dir2/file2.txt',
          size: 200,
          mtime: Math.floor(Date.now() / 1000),
          lastScannedAt: Math.floor(Date.now() / 1000),
          parentDirectory: '/test/dir2'
        },
        {
          path: '/other/file3.txt',
          size: 300,
          mtime: Math.floor(Date.now() / 1000),
          lastScannedAt: Math.floor(Date.now() / 1000),
          parentDirectory: '/other'
        }
      ];

      files.forEach(file => db.upsertFile(file));

      const testFiles = db.getFilesByRootPath('/test');
      expect(testFiles).toHaveLength(2);
      expect(testFiles.every(f => f.parentDirectory?.startsWith('/test'))).toBe(true);
    });

    it('should cleanup missing files', () => {
      const files = [
        {
          path: '/test/file1.txt',
          size: 100,
          mtime: Math.floor(Date.now() / 1000),
          lastScannedAt: Math.floor(Date.now() / 1000),
          parentDirectory: '/test'
        },
        {
          path: '/test/file2.txt',
          size: 200,
          mtime: Math.floor(Date.now() / 1000),
          lastScannedAt: Math.floor(Date.now() / 1000),
          parentDirectory: '/test'
        }
      ];

      files.forEach(file => db.upsertFile(file));

      // Simulate that only file1.txt still exists
      const cleanedCount = db.cleanupMissingFiles('/test', ['/test/file1.txt']);
      expect(cleanedCount).toBe(1);

      const remainingFiles = db.getFilesByRootPath('/test');
      expect(remainingFiles).toHaveLength(1);
      expect(remainingFiles[0].path).toBe('/test/file1.txt');
    });
  });

  describe('Settings Operations', () => {
    it('should store and retrieve settings', () => {
      db.setSetting('testKey', 'testValue');
      
      const value = db.getSetting('testKey');
      expect(value).toBe('testValue');
    });

    it('should update existing settings', () => {
      db.setSetting('testKey', 'initialValue');
      db.setSetting('testKey', 'updatedValue');
      
      const value = db.getSetting('testKey');
      expect(value).toBe('updatedValue');
    });

    it('should return undefined for non-existent settings', () => {
      const value = db.getSetting('nonExistentKey');
      expect(value).toBeUndefined();
    });
  });

  describe('Job Operations', () => {
    it('should create and retrieve job records', () => {
      const jobData = {
        rootPath: '/test',
        status: 'pending' as const,
        fileCount: 0,
        createdAt: Math.floor(Date.now() / 1000),
        updatedAt: Math.floor(Date.now() / 1000)
      };

      const jobId = db.createJob(jobData);
      expect(jobId).toBeDefined();

      const job = db.getJob(jobId);
      expect(job).toBeDefined();
      expect(job?.rootPath).toBe(jobData.rootPath);
      expect(job?.status).toBe(jobData.status);
    });

    it('should update job records', () => {
      const jobData = {
        rootPath: '/test',
        status: 'pending' as const,
        fileCount: 0,
        createdAt: Math.floor(Date.now() / 1000),
        updatedAt: Math.floor(Date.now() / 1000)
      };

      const jobId = db.createJob(jobData);
      
      db.updateJob(jobId, {
        status: 'complete',
        fileCount: 100
      });

      const job = db.getJob(jobId);
      expect(job?.status).toBe('complete');
      expect(job?.fileCount).toBe(100);
    });

    it('should retrieve recent jobs', () => {
      const jobs = [
        {
          rootPath: '/test1',
          status: 'complete' as const,
          fileCount: 10,
          createdAt: Math.floor(Date.now() / 1000) - 3600, // 1 hour ago
          updatedAt: Math.floor(Date.now() / 1000) - 3600
        },
        {
          rootPath: '/test2',
          status: 'pending' as const,
          fileCount: 0,
          createdAt: Math.floor(Date.now() / 1000), // now
          updatedAt: Math.floor(Date.now() / 1000)
        }
      ];

      jobs.forEach(job => db.createJob(job));

      const recentJobs = db.getRecentJobs(5);
      expect(recentJobs).toHaveLength(2);
      // Should be ordered by createdAt DESC, so most recent first
      expect(recentJobs[0].rootPath).toBe('/test2');
      expect(recentJobs[1].rootPath).toBe('/test1');
    });
  });

  describe('Statistics', () => {
    it('should return correct file statistics', () => {
      const files = [
        {
          path: '/test/file1.txt',
          size: 100,
          mtime: Math.floor(Date.now() / 1000),
          lastScannedAt: Math.floor(Date.now() / 1000),
          parentDirectory: '/test'
        },
        {
          path: '/test/file2.txt',
          size: 200,
          mtime: Math.floor(Date.now() / 1000),
          lastScannedAt: Math.floor(Date.now() / 1000),
          parentDirectory: '/test'
        }
      ];

      files.forEach(file => db.upsertFile(file));

      const stats = db.getStats();
      expect(stats.totalFiles).toBe(2);
      expect(stats.totalSize).toBe(300);
      expect(stats.lastScanDate).toBeGreaterThan(0);
    });

    it('should return zero stats for empty database', () => {
      const stats = db.getStats();
      expect(stats.totalFiles).toBe(0);
      expect(stats.totalSize).toBe(0);
      expect(stats.lastScanDate).toBeNull();
    });
  });
});
