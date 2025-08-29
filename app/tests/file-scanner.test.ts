import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { FileScanner } from '../src/workers/file-scanner';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

describe('FileScanner', () => {
  let testDir: string;
  let scanner: FileScanner;

  beforeEach(async () => {
    // Create temporary test directory
    testDir = path.join(os.tmpdir(), 'maxsort-scanner-test-' + Date.now());
    await fs.mkdir(testDir, { recursive: true });

    // Create test files and directories
    const testStructure = [
      'file1.txt',
      'file2.pdf',
      'image.jpg',
      'document.docx',
      'hidden/.DS_Store',
      'hidden/real-file.txt',
      'subdir/nested-file.md',
      'subdir/deep/very-nested.json',
      'temp.tmp',
      '.gitignore'
    ];

    for (const filePath of testStructure) {
      const fullPath = path.join(testDir, filePath);
      const dir = path.dirname(fullPath);
      
      // Create directory if it doesn't exist
      if (dir !== testDir) {
        await fs.mkdir(dir, { recursive: true });
      }
      
      // Create file with some content
      const content = `Test content for ${path.basename(filePath)}`;
      await fs.writeFile(fullPath, content);
    }

    // Initialize scanner with test directory
    scanner = new FileScanner({
      rootPath: testDir,
      exclude: ['.DS_Store', '*.tmp']
    });
  });

  afterEach(async () => {
    // Clean up test directory
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch (error) {
      console.warn('Failed to clean up test directory:', error);
    }
  });

  describe('File Filtering', () => {
    it('should exclude files based on patterns', () => {
      const testFiles = [
        '/test/.DS_Store',
        '/test/file.tmp',
        '/test/valid.txt',
        '/test/node_modules/package.json',
        '/test/.git/config'
      ];

      // Access the private method through type assertion for testing
      const scannerAny = scanner as any;
      
      expect(scannerAny.shouldExclude('/test/.DS_Store')).toBe(true);
      expect(scannerAny.shouldExclude('/test/file.tmp')).toBe(true);
      expect(scannerAny.shouldExclude('/test/valid.txt')).toBe(false);
      expect(scannerAny.shouldExclude('/test/node_modules/package.json')).toBe(true);
      expect(scannerAny.shouldExclude('/test/.git/config')).toBe(true);
    });

    it('should include files with recognized extensions by default', () => {
      const scannerAny = scanner as any;
      
      expect(scannerAny.shouldExclude('/test/document.pdf')).toBe(false);
      expect(scannerAny.shouldExclude('/test/image.jpg')).toBe(false);
      expect(scannerAny.shouldExclude('/test/script.js')).toBe(false);
      expect(scannerAny.shouldExclude('/test/unknown.xyz')).toBe(true);
    });
  });

  describe('Metadata Extraction', () => {
    it('should extract file metadata correctly', async () => {
      const testFilePath = path.join(testDir, 'file1.txt');
      const scannerAny = scanner as any;
      
      const metadata = await scannerAny.extractFileMetadata(testFilePath);
      
      expect(metadata).toBeDefined();
      expect(metadata.path).toBe(testFilePath);
      expect(metadata.fileName).toBe('file1.txt');
      expect(metadata.fileExtension).toBe('.txt');
      expect(metadata.parentDirectory).toBe(testDir);
      expect(metadata.size).toBeGreaterThan(0);
      expect(metadata.mtime).toBeGreaterThan(0);
      expect(metadata.lastScannedAt).toBeGreaterThan(0);
      expect(metadata.relativePathFromRoot).toBe('file1.txt');
    });

    it('should return null for non-existent files', async () => {
      const nonExistentPath = path.join(testDir, 'non-existent.txt');
      const scannerAny = scanner as any;
      
      const metadata = await scannerAny.extractFileMetadata(nonExistentPath);
      expect(metadata).toBeNull();
    });

    it('should handle files without extensions', async () => {
      const noExtFilePath = path.join(testDir, 'no-extension-file');
      await fs.writeFile(noExtFilePath, 'content');
      
      const scannerAny = scanner as any;
      const metadata = await scannerAny.extractFileMetadata(noExtFilePath);
      
      expect(metadata).toBeDefined();
      expect(metadata.fileName).toBe('no-extension-file');
      expect(metadata.fileExtension).toBe('');
    });
  });

  describe('Directory Walking', () => {
    it('should discover all non-excluded files recursively', async () => {
      const scannerAny = scanner as any;
      const filePaths = await scannerAny.walkDirectory(testDir);
      
      // Should find files but exclude .DS_Store and .tmp files
      expect(filePaths.length).toBeGreaterThan(0);
      
      // Check that excluded files are not present
      const dsStoreFiles = filePaths.filter(p => p.includes('.DS_Store'));
      const tmpFiles = filePaths.filter(p => p.endsWith('.tmp'));
      
      expect(dsStoreFiles).toHaveLength(0);
      expect(tmpFiles).toHaveLength(0);
      
      // Check that some expected files are present
      const txtFiles = filePaths.filter(p => p.endsWith('.txt') && !p.includes('.DS_Store'));
      const pdfFiles = filePaths.filter(p => p.endsWith('.pdf'));
      
      expect(txtFiles.length).toBeGreaterThan(0);
      expect(pdfFiles.length).toBeGreaterThan(0);
    });

    it('should handle nested directories correctly', async () => {
      const scannerAny = scanner as any;
      const filePaths = await scannerAny.walkDirectory(testDir);
      
      const nestedFiles = filePaths.filter(p => p.includes('subdir'));
      expect(nestedFiles.length).toBeGreaterThan(0);
      
      const deepNestedFiles = filePaths.filter(p => p.includes('deep'));
      expect(deepNestedFiles.length).toBeGreaterThan(0);
    });

    it('should handle permission errors gracefully', async () => {
      // Create a directory with restricted permissions (if possible)
      const restrictedDir = path.join(testDir, 'restricted');
      await fs.mkdir(restrictedDir);
      
      // On Unix-like systems, try to restrict permissions
      if (process.platform !== 'win32') {
        try {
          await fs.chmod(restrictedDir, 0o000);
        } catch (error) {
          // Skip this test if we can't change permissions
          return;
        }
      }
      
      const scannerAny = scanner as any;
      
      // Should not throw, but handle gracefully
      await expect(scannerAny.walkDirectory(testDir)).resolves.toBeDefined();
      
      // Restore permissions for cleanup
      if (process.platform !== 'win32') {
        try {
          await fs.chmod(restrictedDir, 0o755);
        } catch (error) {
          // Ignore cleanup errors
        }
      }
    });
  });

  describe('Hash Calculation', () => {
    it('should calculate SHA256 hash for small files', async () => {
      const testContent = 'Hello, World!';
      const testFilePath = path.join(testDir, 'hash-test.txt');
      await fs.writeFile(testFilePath, testContent);
      
      const scannerAny = scanner as any;
      const hash = await scannerAny.calculateFileHash(testFilePath);
      
      expect(hash).toBeDefined();
      expect(typeof hash).toBe('string');
      expect(hash).toHaveLength(64); // SHA256 hex string length
    });

    it('should return undefined for empty files', async () => {
      const emptyFilePath = path.join(testDir, 'empty.txt');
      await fs.writeFile(emptyFilePath, '');
      
      const scannerAny = scanner as any;
      const hash = await scannerAny.calculateFileHash(emptyFilePath);
      
      expect(hash).toBeUndefined();
    });

    it('should return undefined for very large files', async () => {
      const largeContent = 'x'.repeat(60 * 1024 * 1024); // 60MB
      const largeFilePath = path.join(testDir, 'large.txt');
      await fs.writeFile(largeFilePath, largeContent);
      
      const scannerAny = scanner as any;
      const hash = await scannerAny.calculateFileHash(largeFilePath);
      
      expect(hash).toBeUndefined();
    });
  });
});
