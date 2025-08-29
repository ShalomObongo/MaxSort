import { Worker, isMainThread, parentPort, workerData } from 'worker_threads';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';

// Types for worker communication
interface ScanOptions {
  rootPath: string;
  include?: string[];
  exclude?: string[];
}

interface FileMetadata {
  id?: number;
  path: string;
  sha256?: string;
  size: number;
  mtime: number;
  lastScannedAt: number;
  relativePathFromRoot: string;
  fileName: string;
  fileExtension: string;
  parentDirectory: string;
}

interface ProgressUpdate {
  fileCount: number;
  currentFile: string;
  percent: number;
  phase: 'scanning' | 'hashing' | 'complete';
}

interface WorkerMessage {
  type: 'progress' | 'file' | 'error' | 'complete';
  data: ProgressUpdate | FileMetadata | Error | null;
}

// Default patterns to exclude during scanning
const DEFAULT_EXCLUDE_PATTERNS = [
  '.DS_Store',
  'Thumbs.db',
  '.git',
  '.svn',
  'node_modules',
  '.cache',
  '.tmp',
  '.temp',
  '__pycache__',
  '*.tmp',
  '*.temp',
  '*.log'
];

// File extensions to include by default (if include patterns are not specified)
const DEFAULT_INCLUDE_EXTENSIONS = [
  '.txt', '.md', '.doc', '.docx', '.pdf', '.rtf',
  '.jpg', '.jpeg', '.png', '.gif', '.bmp', '.svg', '.webp',
  '.mp4', '.avi', '.mov', '.mkv', '.wmv', '.flv', '.mp3', '.wav', '.flac',
  '.zip', '.rar', '.7z', '.tar', '.gz',
  '.js', '.ts', '.html', '.css', '.json', '.xml'
];

class FileScanner {
  private options: ScanOptions;
  private fileCount: number = 0;
  private processedCount: number = 0;
  private totalFiles: number = 0;
  private excludePatterns: RegExp[];
  private includePatterns?: RegExp[];

  constructor(options: ScanOptions) {
    this.options = options;
    
    // Compile exclude patterns
    const excludes = [...DEFAULT_EXCLUDE_PATTERNS, ...(options.exclude || [])];
    this.excludePatterns = excludes.map(pattern => 
      new RegExp(pattern.replace(/\*/g, '.*'), 'i')
    );

    // Compile include patterns if specified
    if (options.include && options.include.length > 0) {
      this.includePatterns = options.include.map(pattern =>
        new RegExp(pattern.replace(/\*/g, '.*'), 'i')
      );
    }
  }

  private shouldExclude(filePath: string): boolean {
    const fileName = path.basename(filePath);
    const relativePath = path.relative(this.options.rootPath, filePath);
    
    // Check exclude patterns
    for (const pattern of this.excludePatterns) {
      if (pattern.test(fileName) || pattern.test(relativePath)) {
        return true;
      }
    }

    // Check include patterns if specified
    if (this.includePatterns) {
      let shouldInclude = false;
      for (const pattern of this.includePatterns) {
        if (pattern.test(fileName) || pattern.test(relativePath)) {
          shouldInclude = true;
          break;
        }
      }
      if (!shouldInclude) return true;
    } else {
      // Default: only include files with recognized extensions
      const ext = path.extname(filePath).toLowerCase();
      if (ext && !DEFAULT_INCLUDE_EXTENSIONS.includes(ext)) {
        return true;
      }
    }

    return false;
  }

  private async calculateFileHash(filePath: string): Promise<string | undefined> {
    try {
      const fileBuffer = await fs.readFile(filePath);
      if (fileBuffer.length === 0) return undefined;
      
      // Only calculate hash for files smaller than 50MB to avoid memory issues
      if (fileBuffer.length > 50 * 1024 * 1024) {
        return undefined;
      }

      return crypto.createHash('sha256').update(fileBuffer).digest('hex');
    } catch (error) {
      console.warn(`Failed to calculate hash for ${filePath}:`, error);
      return undefined;
    }
  }

  private async extractFileMetadata(filePath: string): Promise<FileMetadata | null> {
    try {
      const stats = await fs.stat(filePath);
      
      if (!stats.isFile()) {
        return null;
      }

      const fileName = path.basename(filePath);
      const fileExtension = path.extname(filePath);
      const parentDirectory = path.dirname(filePath);
      const relativePathFromRoot = path.relative(this.options.rootPath, filePath);

      // Calculate hash for small files only during initial scan
      let sha256: string | undefined;
      if (stats.size < 10 * 1024 * 1024) { // Only hash files < 10MB during scan
        sha256 = await this.calculateFileHash(filePath);
      }

      return {
        path: filePath,
        sha256,
        size: stats.size,
        mtime: Math.floor(stats.mtime.getTime() / 1000),
        lastScannedAt: Math.floor(Date.now() / 1000),
        relativePathFromRoot,
        fileName,
        fileExtension,
        parentDirectory
      };
    } catch (error) {
      console.error(`Failed to extract metadata for ${filePath}:`, error);
      return null;
    }
  }

  private sendProgress(phase: 'scanning' | 'hashing' | 'complete' = 'scanning') {
    if (!parentPort) return;

    const percent = this.totalFiles > 0 
      ? Math.floor((this.processedCount / this.totalFiles) * 100)
      : 0;

    const message: WorkerMessage = {
      type: 'progress',
      data: {
        fileCount: this.fileCount,
        currentFile: '',
        percent,
        phase
      }
    };

    parentPort.postMessage(message);
  }

  private async walkDirectory(dirPath: string): Promise<string[]> {
    const filePaths: string[] = [];
    
    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);
        
        if (this.shouldExclude(fullPath)) {
          continue;
        }

        if (entry.isDirectory()) {
          // Recursively scan subdirectories
          try {
            const subFiles = await this.walkDirectory(fullPath);
            filePaths.push(...subFiles);
          } catch (error) {
            console.warn(`Failed to scan directory ${fullPath}:`, error);
            // Continue scanning other directories
          }
        } else if (entry.isFile()) {
          filePaths.push(fullPath);
        }
      }
    } catch (error) {
      console.error(`Failed to read directory ${dirPath}:`, error);
      if (parentPort) {
        const message: WorkerMessage = {
          type: 'error',
          data: new Error(`Failed to read directory: ${error}`)
        };
        parentPort.postMessage(message);
      }
    }

    return filePaths;
  }

  async scan(): Promise<void> {
    if (!parentPort) {
      throw new Error('Worker not properly initialized');
    }

    try {
      // Phase 1: Walk directory tree and collect all file paths
      this.sendProgress('scanning');
      console.log('Starting directory walk...');
      
      const allFilePaths = await this.walkDirectory(this.options.rootPath);
      this.totalFiles = allFilePaths.length;
      
      console.log(`Found ${this.totalFiles} files to process`);

      // Phase 2: Extract metadata for each file
      this.sendProgress('hashing');
      
      for (const filePath of allFilePaths) {
        try {
          const metadata = await this.extractFileMetadata(filePath);
          
          if (metadata) {
            this.fileCount++;
            
            // Send file metadata
            const message: WorkerMessage = {
              type: 'file',
              data: metadata
            };
            parentPort.postMessage(message);

            // Update progress
            this.processedCount++;
            if (this.processedCount % 10 === 0) { // Update progress every 10 files
              this.sendProgress('hashing');
            }
          }
          
          this.processedCount++;
          
        } catch (error) {
          console.error(`Failed to process file ${filePath}:`, error);
          // Continue processing other files
        }
      }

      // Phase 3: Complete
      this.sendProgress('complete');
      
      const message: WorkerMessage = {
        type: 'complete',
        data: null
      };
      parentPort.postMessage(message);

      console.log(`Scan completed: ${this.fileCount} files processed`);

    } catch (error) {
      console.error('Scanner error:', error);
      if (parentPort) {
        const message: WorkerMessage = {
          type: 'error',
          data: error instanceof Error ? error : new Error(String(error))
        };
        parentPort.postMessage(message);
      }
    }
  }
}

// Worker thread execution - only run in actual worker context
if (!isMainThread && parentPort && workerData && process.env.NODE_ENV !== 'test') {
  const scanner = new FileScanner(workerData as ScanOptions);
  scanner.scan().catch(error => {
    console.error('Worker scan error:', error);
    if (parentPort) {
      parentPort.postMessage({
        type: 'error',
        data: error instanceof Error ? error : new Error(String(error))
      });
    }
  });
}

// Export for use by main process
export { FileScanner, type ScanOptions, type FileMetadata, type WorkerMessage, type ProgressUpdate };

// Main thread utility to create scanner worker
export function createScannerWorker(options: ScanOptions): Worker {
  return new Worker(__filename, {
    workerData: options
  });
}
