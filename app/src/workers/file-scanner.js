"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.FileScanner = void 0;
exports.createScannerWorker = createScannerWorker;
const worker_threads_1 = require("worker_threads");
const fs = __importStar(require("fs/promises"));
const path = __importStar(require("path"));
const crypto = __importStar(require("crypto"));
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
    constructor(options) {
        this.fileCount = 0;
        this.processedCount = 0;
        this.totalFiles = 0;
        this.options = options;
        // Compile exclude patterns
        const excludes = [...DEFAULT_EXCLUDE_PATTERNS, ...(options.exclude || [])];
        this.excludePatterns = excludes.map(pattern => new RegExp(pattern.replace(/\*/g, '.*'), 'i'));
        // Compile include patterns if specified
        if (options.include && options.include.length > 0) {
            this.includePatterns = options.include.map(pattern => new RegExp(pattern.replace(/\*/g, '.*'), 'i'));
        }
    }
    shouldExclude(filePath) {
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
            if (!shouldInclude)
                return true;
        }
        else {
            // Default: only include files with recognized extensions
            const ext = path.extname(filePath).toLowerCase();
            if (ext && !DEFAULT_INCLUDE_EXTENSIONS.includes(ext)) {
                return true;
            }
        }
        return false;
    }
    async calculateFileHash(filePath) {
        try {
            const fileBuffer = await fs.readFile(filePath);
            if (fileBuffer.length === 0)
                return undefined;
            // Only calculate hash for files smaller than 50MB to avoid memory issues
            if (fileBuffer.length > 50 * 1024 * 1024) {
                return undefined;
            }
            return crypto.createHash('sha256').update(fileBuffer).digest('hex');
        }
        catch (error) {
            console.warn(`Failed to calculate hash for ${filePath}:`, error);
            return undefined;
        }
    }
    async extractFileMetadata(filePath) {
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
            let sha256;
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
        }
        catch (error) {
            console.error(`Failed to extract metadata for ${filePath}:`, error);
            return null;
        }
    }
    sendProgress(phase = 'scanning') {
        if (!worker_threads_1.parentPort)
            return;
        const percent = this.totalFiles > 0
            ? Math.floor((this.processedCount / this.totalFiles) * 100)
            : 0;
        const message = {
            type: 'progress',
            data: {
                fileCount: this.fileCount,
                currentFile: '',
                percent,
                phase
            }
        };
        worker_threads_1.parentPort.postMessage(message);
    }
    async walkDirectory(dirPath) {
        const filePaths = [];
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
                    }
                    catch (error) {
                        console.warn(`Failed to scan directory ${fullPath}:`, error);
                        // Continue scanning other directories
                    }
                }
                else if (entry.isFile()) {
                    filePaths.push(fullPath);
                }
            }
        }
        catch (error) {
            console.error(`Failed to read directory ${dirPath}:`, error);
            if (worker_threads_1.parentPort) {
                const message = {
                    type: 'error',
                    data: new Error(`Failed to read directory: ${error}`)
                };
                worker_threads_1.parentPort.postMessage(message);
            }
        }
        return filePaths;
    }
    async scan() {
        if (!worker_threads_1.parentPort) {
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
                        const message = {
                            type: 'file',
                            data: metadata
                        };
                        worker_threads_1.parentPort.postMessage(message);
                        // Update progress
                        this.processedCount++;
                        if (this.processedCount % 10 === 0) { // Update progress every 10 files
                            this.sendProgress('hashing');
                        }
                    }
                    this.processedCount++;
                }
                catch (error) {
                    console.error(`Failed to process file ${filePath}:`, error);
                    // Continue processing other files
                }
            }
            // Phase 3: Complete
            this.sendProgress('complete');
            const message = {
                type: 'complete',
                data: null
            };
            worker_threads_1.parentPort.postMessage(message);
            console.log(`Scan completed: ${this.fileCount} files processed`);
        }
        catch (error) {
            console.error('Scanner error:', error);
            if (worker_threads_1.parentPort) {
                const message = {
                    type: 'error',
                    data: error instanceof Error ? error : new Error(String(error))
                };
                worker_threads_1.parentPort.postMessage(message);
            }
        }
    }
}
exports.FileScanner = FileScanner;
// Worker thread execution
if (!worker_threads_1.isMainThread && worker_threads_1.parentPort && worker_threads_1.workerData) {
    const scanner = new FileScanner(worker_threads_1.workerData);
    scanner.scan().catch(error => {
        console.error('Worker scan error:', error);
        if (worker_threads_1.parentPort) {
            worker_threads_1.parentPort.postMessage({
                type: 'error',
                data: error instanceof Error ? error : new Error(String(error))
            });
        }
    });
}
// Main thread utility to create scanner worker
function createScannerWorker(options) {
    return new worker_threads_1.Worker(__filename, {
        workerData: options
    });
}
