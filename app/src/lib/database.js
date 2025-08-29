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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DatabaseManager = void 0;
exports.getDatabase = getDatabase;
const better_sqlite3_1 = __importDefault(require("better-sqlite3"));
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const electron_1 = require("electron");
class DatabaseManager {
    constructor() {
        this.isInitialized = false;
        // Create database in user data directory
        const userDataPath = electron_1.app.getPath('userData');
        const dbPath = path.join(userDataPath, 'maxsort.db');
        // Ensure directory exists
        if (!fs.existsSync(userDataPath)) {
            fs.mkdirSync(userDataPath, { recursive: true });
        }
        // Initialize database with WAL mode for better concurrent access
        this.db = new better_sqlite3_1.default(dbPath);
        this.db.pragma('journal_mode = WAL');
        this.db.pragma('synchronous = NORMAL');
        this.db.pragma('cache_size = 1000');
        this.db.pragma('temp_store = memory');
        console.log(`Database initialized at: ${dbPath}`);
    }
    /**
     * Initialize database schema and run migrations
     */
    async initialize() {
        if (this.isInitialized)
            return;
        try {
            // Create schema version table
            this.db.exec(`
        CREATE TABLE IF NOT EXISTS schema_version (
          version INTEGER PRIMARY KEY,
          applied_at INTEGER NOT NULL
        );
      `);
            // Check current schema version
            const currentVersion = this.getCurrentSchemaVersion();
            console.log(`Current schema version: ${currentVersion}`);
            // Apply migrations
            await this.applyMigrations(currentVersion);
            this.isInitialized = true;
            console.log('Database initialization complete');
        }
        catch (error) {
            console.error('Database initialization failed:', error);
            throw error;
        }
    }
    getCurrentSchemaVersion() {
        try {
            const result = this.db.prepare('SELECT MAX(version) as version FROM schema_version').get();
            return result?.version || 0;
        }
        catch {
            return 0;
        }
    }
    async applyMigrations(currentVersion) {
        const migrations = [
            {
                version: 1,
                description: 'Create initial tables',
                sql: `
          -- Files table for storing file metadata
          CREATE TABLE IF NOT EXISTS files (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            path TEXT UNIQUE NOT NULL,
            sha256 TEXT,
            size INTEGER NOT NULL,
            mtime INTEGER NOT NULL,
            lastScannedAt INTEGER NOT NULL,
            relativePathFromRoot TEXT,
            fileName TEXT,
            fileExtension TEXT,
            parentDirectory TEXT,
            created_at INTEGER DEFAULT (unixepoch()),
            updated_at INTEGER DEFAULT (unixepoch())
          );

          -- Index for faster lookups
          CREATE INDEX IF NOT EXISTS idx_files_path ON files(path);
          CREATE INDEX IF NOT EXISTS idx_files_sha256 ON files(sha256);
          CREATE INDEX IF NOT EXISTS idx_files_extension ON files(fileExtension);
          CREATE INDEX IF NOT EXISTS idx_files_parent ON files(parentDirectory);

          -- Settings table for application configuration
          CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            created_at INTEGER DEFAULT (unixepoch()),
            updated_at INTEGER DEFAULT (unixepoch())
          );

          -- Jobs table for tracking scan/organize operations
          CREATE TABLE IF NOT EXISTS jobs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            rootPath TEXT NOT NULL,
            status TEXT NOT NULL CHECK (status IN ('pending', 'scanning', 'organizing', 'complete', 'error')),
            fileCount INTEGER DEFAULT 0,
            errorMessage TEXT,
            createdAt INTEGER DEFAULT (unixepoch()),
            updatedAt INTEGER DEFAULT (unixepoch())
          );

          CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
          CREATE INDEX IF NOT EXISTS idx_jobs_root_path ON jobs(rootPath);
        `
            }
        ];
        for (const migration of migrations) {
            if (migration.version > currentVersion) {
                console.log(`Applying migration ${migration.version}: ${migration.description}`);
                try {
                    this.db.exec(migration.sql);
                    // Record migration
                    this.db.prepare('INSERT INTO schema_version (version, applied_at) VALUES (?, ?)').run(migration.version, Math.floor(Date.now() / 1000));
                    console.log(`Migration ${migration.version} applied successfully`);
                }
                catch (error) {
                    console.error(`Migration ${migration.version} failed:`, error);
                    throw error;
                }
            }
        }
    }
    /**
     * Insert or update a file record
     */
    upsertFile(fileData) {
        const stmt = this.db.prepare(`
      INSERT INTO files (
        path, sha256, size, mtime, lastScannedAt, relativePathFromRoot, 
        fileName, fileExtension, parentDirectory, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch())
      ON CONFLICT(path) DO UPDATE SET
        sha256 = excluded.sha256,
        size = excluded.size,
        mtime = excluded.mtime,
        lastScannedAt = excluded.lastScannedAt,
        relativePathFromRoot = excluded.relativePathFromRoot,
        fileName = excluded.fileName,
        fileExtension = excluded.fileExtension,
        parentDirectory = excluded.parentDirectory,
        updated_at = unixepoch()
    `);
        const result = stmt.run(fileData.path, fileData.sha256 || null, fileData.size, fileData.mtime, fileData.lastScannedAt, fileData.relativePathFromRoot || null, fileData.fileName || null, fileData.fileExtension || null, fileData.parentDirectory || null);
        return result.lastInsertRowid;
    }
    /**
     * Get all files for a specific root path
     */
    getFilesByRootPath(rootPath) {
        const stmt = this.db.prepare(`
      SELECT * FROM files 
      WHERE parentDirectory LIKE ? 
      ORDER BY fileName ASC
    `);
        return stmt.all(`${rootPath}%`);
    }
    /**
     * Get file by exact path
     */
    getFileByPath(filePath) {
        const stmt = this.db.prepare('SELECT * FROM files WHERE path = ?');
        return stmt.get(filePath);
    }
    /**
     * Delete files that are no longer found in the file system
     */
    cleanupMissingFiles(rootPath, existingPaths) {
        if (existingPaths.length === 0) {
            // If no existing paths, clean up all files under this root
            const stmt = this.db.prepare('DELETE FROM files WHERE parentDirectory LIKE ?');
            const result = stmt.run(`${rootPath}%`);
            return result.changes;
        }
        // Create placeholders for IN clause
        const placeholders = existingPaths.map(() => '?').join(',');
        const stmt = this.db.prepare(`
      DELETE FROM files 
      WHERE parentDirectory LIKE ? 
      AND path NOT IN (${placeholders})
    `);
        const result = stmt.run(rootPath + '%', ...existingPaths);
        return result.changes;
    }
    /**
     * Settings operations
     */
    getSetting(key) {
        const stmt = this.db.prepare('SELECT value FROM settings WHERE key = ?');
        const result = stmt.get(key);
        return result?.value;
    }
    setSetting(key, value) {
        const stmt = this.db.prepare(`
      INSERT INTO settings (key, value, updated_at) VALUES (?, ?, unixepoch())
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = unixepoch()
    `);
        stmt.run(key, value);
    }
    /**
     * Job operations
     */
    createJob(jobData) {
        const stmt = this.db.prepare(`
      INSERT INTO jobs (rootPath, status, fileCount, errorMessage, createdAt, updatedAt) 
      VALUES (?, ?, ?, ?, ?, ?)
    `);
        const now = Math.floor(Date.now() / 1000);
        const result = stmt.run(jobData.rootPath, jobData.status, jobData.fileCount, jobData.errorMessage || null, jobData.createdAt || now, jobData.updatedAt || now);
        return result.lastInsertRowid;
    }
    updateJob(id, updates) {
        const fields = Object.keys(updates).filter(key => key !== 'id').map(key => `${key} = ?`);
        if (fields.length === 0)
            return;
        fields.push('updatedAt = ?');
        const values = Object.keys(updates)
            .filter(key => key !== 'id')
            .map(key => updates[key]);
        values.push(Math.floor(Date.now() / 1000));
        const stmt = this.db.prepare(`UPDATE jobs SET ${fields.join(', ')} WHERE id = ?`);
        stmt.run(...values, id);
    }
    getJob(id) {
        const stmt = this.db.prepare('SELECT * FROM jobs WHERE id = ?');
        return stmt.get(id);
    }
    getRecentJobs(limit = 10) {
        const stmt = this.db.prepare('SELECT * FROM jobs ORDER BY createdAt DESC LIMIT ?');
        return stmt.all(limit);
    }
    /**
     * Database statistics
     */
    getStats() {
        const fileStats = this.db.prepare(`
      SELECT 
        COUNT(*) as totalFiles,
        COALESCE(SUM(size), 0) as totalSize,
        MAX(lastScannedAt) as lastScanDate
      FROM files
    `).get();
        return fileStats;
    }
    /**
     * Cleanup and close database
     */
    close() {
        if (this.db) {
            this.db.close();
            console.log('Database connection closed');
        }
    }
    /**
     * Execute a transaction
     */
    transaction(fn) {
        const transaction = this.db.transaction(fn);
        return transaction(this.db);
    }
}
exports.DatabaseManager = DatabaseManager;
// Singleton instance
let dbInstance = null;
function getDatabase() {
    if (!dbInstance) {
        dbInstance = new DatabaseManager();
    }
    return dbInstance;
}
