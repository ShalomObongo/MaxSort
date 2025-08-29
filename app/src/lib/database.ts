import Database from 'better-sqlite3';
import * as path from 'path';
import * as fs from 'fs';
import { app } from 'electron';

export interface FileRecord {
  id?: number;
  path: string;
  sha256?: string;
  size: number;
  mtime: number;
  lastScannedAt: number;
  relativePathFromRoot?: string;
  fileName?: string;
  fileExtension?: string;
  parentDirectory?: string;
}

export interface SettingRecord {
  key: string;
  value: string;
}

export interface JobRecord {
  id?: number;
  rootPath: string;
  status: 'pending' | 'scanning' | 'organizing' | 'complete' | 'error';
  createdAt: number;
  updatedAt: number;
  fileCount: number;
  errorMessage?: string;
}

class DatabaseManager {
  private db: Database.Database;
  private isInitialized: boolean = false;

  constructor() {
    // Create database in user data directory
    const userDataPath = app.getPath('userData');
    const dbPath = path.join(userDataPath, 'maxsort.db');
    
    // Ensure directory exists
    if (!fs.existsSync(userDataPath)) {
      fs.mkdirSync(userDataPath, { recursive: true });
    }

    // Initialize database with WAL mode for better concurrent access
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.db.pragma('cache_size = 1000');
    this.db.pragma('temp_store = memory');
    
    console.log(`Database initialized at: ${dbPath}`);
  }

  /**
   * Initialize database schema and run migrations
   */
  public async initialize(): Promise<void> {
    if (this.isInitialized) return;

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
    } catch (error) {
      console.error('Database initialization failed:', error);
      throw error;
    }
  }

  private getCurrentSchemaVersion(): number {
    try {
      const result = this.db.prepare('SELECT MAX(version) as version FROM schema_version').get() as { version: number } | undefined;
      return result?.version || 0;
    } catch {
      return 0;
    }
  }

  private async applyMigrations(currentVersion: number): Promise<void> {
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
      },
      {
        version: 2,
        description: 'Add Ollama model preferences',
        sql: `
          -- Insert default Ollama settings if they don't exist
          INSERT OR IGNORE INTO settings (key, value) VALUES
            ('ollama_main_model', ''),
            ('ollama_sub_model', ''),
            ('ollama_endpoint', 'http://localhost:11434'),
            ('model_memory_estimates', '{}');
        `
      },
      {
        version: 3,
        description: 'Add agent task tracking tables',
        sql: `
          -- Agent tasks table for task lifecycle tracking
          CREATE TABLE IF NOT EXISTS agent_tasks (
            id TEXT PRIMARY KEY,
            type TEXT NOT NULL,
            state TEXT NOT NULL CHECK (state IN ('queued', 'running', 'completed', 'failed', 'cancelled', 'timeout')),
            priority INTEGER NOT NULL,
            model_name TEXT,
            file_path TEXT,
            timeout_ms INTEGER NOT NULL,
            retry_count INTEGER DEFAULT 0,
            max_retries INTEGER NOT NULL,
            estimated_memory_mb INTEGER DEFAULT 0,
            created_at INTEGER NOT NULL,
            started_at INTEGER,
            completed_at INTEGER,
            execution_time_ms INTEGER,
            error_message TEXT,
            result_data TEXT, -- JSON string for task results
            metadata TEXT -- JSON string for additional metadata
          );

          CREATE INDEX IF NOT EXISTS idx_agent_tasks_state ON agent_tasks(state);
          CREATE INDEX IF NOT EXISTS idx_agent_tasks_priority ON agent_tasks(priority);
          CREATE INDEX IF NOT EXISTS idx_agent_tasks_type ON agent_tasks(type);
          CREATE INDEX IF NOT EXISTS idx_agent_tasks_created ON agent_tasks(created_at);
        `
      }
    ];

    for (const migration of migrations) {
      if (migration.version > currentVersion) {
        console.log(`Applying migration ${migration.version}: ${migration.description}`);
        
        try {
          this.db.exec(migration.sql);
          
          // Record migration
          this.db.prepare('INSERT INTO schema_version (version, applied_at) VALUES (?, ?)').run(
            migration.version,
            Math.floor(Date.now() / 1000)
          );
          
          console.log(`Migration ${migration.version} applied successfully`);
        } catch (error) {
          console.error(`Migration ${migration.version} failed:`, error);
          throw error;
        }
      }
    }
  }

  /**
   * Insert or update a file record
   */
  public upsertFile(fileData: FileRecord): number {
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

    const result = stmt.run(
      fileData.path,
      fileData.sha256 || null,
      fileData.size,
      fileData.mtime,
      fileData.lastScannedAt,
      fileData.relativePathFromRoot || null,
      fileData.fileName || null,
      fileData.fileExtension || null,
      fileData.parentDirectory || null
    );

    return result.lastInsertRowid as number;
  }

  /**
   * Get all files for a specific root path
   */
  public getFilesByRootPath(rootPath: string): FileRecord[] {
    const stmt = this.db.prepare(`
      SELECT * FROM files 
      WHERE parentDirectory LIKE ? 
      ORDER BY fileName ASC
    `);
    return stmt.all(`${rootPath}%`) as FileRecord[];
  }

  /**
   * Get file by exact path
   */
  public getFileByPath(filePath: string): FileRecord | undefined {
    const stmt = this.db.prepare('SELECT * FROM files WHERE path = ?');
    return stmt.get(filePath) as FileRecord | undefined;
  }

  /**
   * Delete files that are no longer found in the file system
   */
  public cleanupMissingFiles(rootPath: string, existingPaths: string[]): number {
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
  public getSetting(key: string): string | undefined {
    const stmt = this.db.prepare('SELECT value FROM settings WHERE key = ?');
    const result = stmt.get(key) as { value: string } | undefined;
    return result?.value;
  }

  public setSetting(key: string, value: string): void {
    const stmt = this.db.prepare(`
      INSERT INTO settings (key, value, updated_at) VALUES (?, ?, unixepoch())
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = unixepoch()
    `);
    stmt.run(key, value);
  }

  /**
   * Model preference operations
   */
  public getModelPreferences(): { mainModel: string | null; subModel: string | null; endpoint: string } {
    const mainModel = this.getSetting('ollama_main_model') || null;
    const subModel = this.getSetting('ollama_sub_model') || null;
    const endpoint = this.getSetting('ollama_endpoint') || 'http://localhost:11434';
    
    return {
      mainModel: mainModel === '' ? null : mainModel,
      subModel: subModel === '' ? null : subModel,
      endpoint
    };
  }

  public setModelPreferences(mainModel: string | null, subModel: string | null): void {
    // Use transaction to ensure atomic updates
    this.transaction(() => {
      this.setSetting('ollama_main_model', mainModel || '');
      this.setSetting('ollama_sub_model', subModel || '');
    });
  }

  public getModelMemoryEstimates(): Record<string, number> {
    try {
      const estimatesJson = this.getSetting('model_memory_estimates') || '{}';
      return JSON.parse(estimatesJson);
    } catch (error) {
      console.error('Failed to parse model memory estimates:', error);
      return {};
    }
  }

  public setModelMemoryEstimates(estimates: Record<string, number>): void {
    this.setSetting('model_memory_estimates', JSON.stringify(estimates));
  }

  /**
   * Job operations
   */
  public createJob(jobData: Omit<JobRecord, 'id'>): number {
    const stmt = this.db.prepare(`
      INSERT INTO jobs (rootPath, status, fileCount, errorMessage, createdAt, updatedAt) 
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    
    const now = Math.floor(Date.now() / 1000);
    const result = stmt.run(
      jobData.rootPath,
      jobData.status,
      jobData.fileCount,
      jobData.errorMessage || null,
      jobData.createdAt || now,
      jobData.updatedAt || now
    );

    return result.lastInsertRowid as number;
  }

  public updateJob(id: number, updates: Partial<JobRecord>): void {
    const fields = Object.keys(updates).filter(key => key !== 'id').map(key => `${key} = ?`);
    if (fields.length === 0) return;

    fields.push('updatedAt = ?');
    const values = Object.keys(updates)
      .filter(key => key !== 'id')
      .map(key => (updates as any)[key]);
    values.push(Math.floor(Date.now() / 1000));

    const stmt = this.db.prepare(`UPDATE jobs SET ${fields.join(', ')} WHERE id = ?`);
    stmt.run(...values, id);
  }

  public getJob(id: number): JobRecord | undefined {
    const stmt = this.db.prepare('SELECT * FROM jobs WHERE id = ?');
    return stmt.get(id) as JobRecord | undefined;
  }

  public getRecentJobs(limit: number = 10): JobRecord[] {
    const stmt = this.db.prepare('SELECT * FROM jobs ORDER BY createdAt DESC LIMIT ?');
    return stmt.all(limit) as JobRecord[];
  }

  /**
   * Database statistics
   */
  public getStats(): { totalFiles: number; totalSize: number; lastScanDate: number | null } {
    const fileStats = this.db.prepare(`
      SELECT 
        COUNT(*) as totalFiles,
        COALESCE(SUM(size), 0) as totalSize,
        MAX(lastScannedAt) as lastScanDate
      FROM files
    `).get() as { totalFiles: number; totalSize: number; lastScanDate: number | null };

    return fileStats;
  }

  /**
   * Cleanup and close database
   */
  public close(): void {
    if (this.db) {
      this.db.close();
      console.log('Database connection closed');
    }
  }

  /**
   * Execute a transaction
   */
  public transaction<T>(fn: (db: Database.Database) => T): T {
    const transaction = this.db.transaction(fn);
    return transaction(this.db);
  }
}

// Singleton instance
let dbInstance: DatabaseManager | null = null;

export function getDatabase(): DatabaseManager {
  if (!dbInstance) {
    dbInstance = new DatabaseManager();
  }
  return dbInstance;
}

export { DatabaseManager };
