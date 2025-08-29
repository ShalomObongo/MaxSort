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

export interface SuggestionRecord {
  id?: number;
  fileId: number;
  requestId: string;
  analysisType: 'rename-suggestions' | 'classification' | 'content-summary' | 'metadata-extraction';
  suggestedValue: string;
  originalConfidence: number;
  adjustedConfidence: number;
  qualityScore: number;
  reasoning?: string;
  modelUsed: string;
  analysisDuration: number;
  modelVersion?: string;
  contentHash?: string;
  validationFlags?: string;
  rankPosition: number;
  isRecommended: boolean;
  createdAt?: number;
  updatedAt?: number;
}

export interface AnalysisSessionRecord {
  id: string;
  sessionType: 'interactive' | 'batch';
  rootPath?: string;
  analysisTypes: string;
  totalFiles: number;
  processedFiles: number;
  completedFiles: number;
  failedFiles: number;
  startedAt: number;
  completedAt?: number;
  totalDuration?: number;
  averageFileDuration?: number;
  successRate: number;
  errorSummary?: string;
  modelsUsed?: string;
  status: 'running' | 'completed' | 'cancelled' | 'error';
  errorMessage?: string;
  createdAt?: number;
  updatedAt?: number;
}

export interface ModelMetricRecord {
  id?: number;
  modelName: string;
  analysisType: string;
  totalAnalyses: number;
  successfulAnalyses: number;
  failedAnalyses: number;
  averageDuration: number;
  averageConfidence: number;
  averageQuality: number;
  peakMemoryMb: number;
  averageMemoryMb: number;
  periodStart: number;
  periodEnd?: number;
  createdAt?: number;
  updatedAt?: number;
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
      },
      {
        version: 4,
        description: 'Add rename suggestions storage tables',
        sql: `
          -- Suggestions table for storing AI-generated rename suggestions
          CREATE TABLE IF NOT EXISTS suggestions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            file_id INTEGER NOT NULL,
            request_id TEXT NOT NULL,
            analysis_type TEXT NOT NULL CHECK (analysis_type IN ('rename-suggestions', 'classification', 'content-summary', 'metadata-extraction')),
            
            -- AI response data
            suggested_value TEXT NOT NULL,        -- The suggested filename/classification/summary
            original_confidence INTEGER NOT NULL, -- AI-provided confidence (0-100)
            adjusted_confidence INTEGER NOT NULL, -- Confidence after processing (0-100)
            quality_score INTEGER NOT NULL,       -- Overall quality assessment (0-100)
            reasoning TEXT,                       -- AI reasoning explanation
            
            -- Analysis metadata
            model_used TEXT NOT NULL,             -- Ollama model name used
            analysis_duration INTEGER NOT NULL,   -- Analysis time in milliseconds
            model_version TEXT,                   -- Model version if available
            content_hash TEXT,                    -- Hash of analyzed content for deduplication
            
            -- Validation and ranking
            validation_flags TEXT,                -- JSON array of validation issues
            rank_position INTEGER DEFAULT 0,     -- Ranking among suggestions for this file
            is_recommended BOOLEAN DEFAULT FALSE, -- Whether this suggestion is recommended
            
            -- System tracking
            created_at INTEGER DEFAULT (unixepoch()),
            updated_at INTEGER DEFAULT (unixepoch()),
            
            FOREIGN KEY (file_id) REFERENCES files (id) ON DELETE CASCADE
          );

          -- Indexes for efficient querying
          CREATE INDEX IF NOT EXISTS idx_suggestions_file_id ON suggestions(file_id);
          CREATE INDEX IF NOT EXISTS idx_suggestions_request_id ON suggestions(request_id);
          CREATE INDEX IF NOT EXISTS idx_suggestions_analysis_type ON suggestions(analysis_type);
          CREATE INDEX IF NOT EXISTS idx_suggestions_confidence ON suggestions(adjusted_confidence);
          CREATE INDEX IF NOT EXISTS idx_suggestions_quality ON suggestions(quality_score);
          CREATE INDEX IF NOT EXISTS idx_suggestions_model ON suggestions(model_used);
          CREATE INDEX IF NOT EXISTS idx_suggestions_created ON suggestions(created_at);
          CREATE INDEX IF NOT EXISTS idx_suggestions_recommended ON suggestions(is_recommended);

          -- Analysis sessions table for tracking analysis requests
          CREATE TABLE IF NOT EXISTS analysis_sessions (
            id TEXT PRIMARY KEY,                  -- Request ID
            session_type TEXT NOT NULL,           -- 'interactive' or 'batch'
            root_path TEXT,                       -- Root path for batch analysis
            analysis_types TEXT NOT NULL,         -- JSON array of analysis types requested
            
            -- Progress tracking
            total_files INTEGER DEFAULT 0,
            processed_files INTEGER DEFAULT 0,
            completed_files INTEGER DEFAULT 0,
            failed_files INTEGER DEFAULT 0,
            
            -- Timing and performance
            started_at INTEGER NOT NULL,
            completed_at INTEGER,
            total_duration INTEGER,               -- Total execution time in milliseconds
            average_file_duration INTEGER,       -- Average time per file in milliseconds
            
            -- Results summary
            success_rate REAL DEFAULT 0.0,       -- Percentage of successful analyses
            error_summary TEXT,                   -- JSON array of common errors
            models_used TEXT,                     -- JSON array of models used
            
            -- Status
            status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'completed', 'cancelled', 'error')),
            error_message TEXT,
            
            created_at INTEGER DEFAULT (unixepoch()),
            updated_at INTEGER DEFAULT (unixepoch())
          );

          CREATE INDEX IF NOT EXISTS idx_analysis_sessions_status ON analysis_sessions(status);
          CREATE INDEX IF NOT EXISTS idx_analysis_sessions_type ON analysis_sessions(session_type);
          CREATE INDEX IF NOT EXISTS idx_analysis_sessions_started ON analysis_sessions(started_at);
          CREATE INDEX IF NOT EXISTS idx_analysis_sessions_completed ON analysis_sessions(completed_at);

          -- Model performance metrics table
          CREATE TABLE IF NOT EXISTS model_metrics (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            model_name TEXT NOT NULL,
            analysis_type TEXT NOT NULL,
            
            -- Performance metrics
            total_analyses INTEGER DEFAULT 0,
            successful_analyses INTEGER DEFAULT 0,
            failed_analyses INTEGER DEFAULT 0,
            average_duration INTEGER DEFAULT 0,    -- Average analysis time in milliseconds
            average_confidence REAL DEFAULT 0.0,   -- Average confidence score
            average_quality REAL DEFAULT 0.0,      -- Average quality score
            
            -- Memory usage
            peak_memory_mb INTEGER DEFAULT 0,
            average_memory_mb INTEGER DEFAULT 0,
            
            -- Tracking period
            period_start INTEGER NOT NULL,        -- Start of measurement period
            period_end INTEGER,                    -- End of measurement period
            
            created_at INTEGER DEFAULT (unixepoch()),
            updated_at INTEGER DEFAULT (unixepoch()),
            
            UNIQUE(model_name, analysis_type, period_start)
          );

          CREATE INDEX IF NOT EXISTS idx_model_metrics_model ON model_metrics(model_name);
          CREATE INDEX IF NOT EXISTS idx_model_metrics_type ON model_metrics(analysis_type);
          CREATE INDEX IF NOT EXISTS idx_model_metrics_period ON model_metrics(period_start, period_end);
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
   * Suggestion storage and retrieval methods
   */

  /**
   * Insert a suggestion record
   */
  public insertSuggestion(suggestion: Omit<SuggestionRecord, 'id' | 'createdAt' | 'updatedAt'>): number {
    const stmt = this.db.prepare(`
      INSERT INTO suggestions (
        file_id, request_id, analysis_type, suggested_value, original_confidence, 
        adjusted_confidence, quality_score, reasoning, model_used, analysis_duration,
        model_version, content_hash, validation_flags, rank_position, is_recommended
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      suggestion.fileId,
      suggestion.requestId,
      suggestion.analysisType,
      suggestion.suggestedValue,
      suggestion.originalConfidence,
      suggestion.adjustedConfidence,
      suggestion.qualityScore,
      suggestion.reasoning || null,
      suggestion.modelUsed,
      suggestion.analysisDuration,
      suggestion.modelVersion || null,
      suggestion.contentHash || null,
      suggestion.validationFlags || null,
      suggestion.rankPosition,
      suggestion.isRecommended ? 1 : 0
    );

    return result.lastInsertRowid as number;
  }

  /**
   * Get suggestions for a specific file
   */
  public getSuggestionsByFileId(fileId: number, analysisType?: string): SuggestionRecord[] {
    let sql = 'SELECT * FROM suggestions WHERE file_id = ?';
    let params: any[] = [fileId];

    if (analysisType) {
      sql += ' AND analysis_type = ?';
      params.push(analysisType);
    }

    sql += ' ORDER BY rank_position ASC, adjusted_confidence DESC';

    const stmt = this.db.prepare(sql);
    return stmt.all(...params) as SuggestionRecord[];
  }

  /**
   * Get suggestions by request ID
   */
  public getSuggestionsByRequestId(requestId: string): SuggestionRecord[] {
    const stmt = this.db.prepare(`
      SELECT s.*, f.path as file_path, f.fileName as file_name 
      FROM suggestions s
      LEFT JOIN files f ON s.file_id = f.id
      WHERE s.request_id = ?
      ORDER BY s.file_id, s.rank_position ASC
    `);
    return stmt.all(requestId) as SuggestionRecord[];
  }

  /**
   * Get top suggestions for multiple files
   */
  public getTopSuggestions(fileIds: number[], analysisType: string, limit: number = 3): SuggestionRecord[] {
    const placeholders = fileIds.map(() => '?').join(',');
    const stmt = this.db.prepare(`
      SELECT s.*, f.path as file_path, f.fileName as file_name
      FROM suggestions s
      LEFT JOIN files f ON s.file_id = f.id
      WHERE s.file_id IN (${placeholders})
        AND s.analysis_type = ?
        AND s.rank_position <= ?
      ORDER BY s.file_id, s.rank_position ASC
    `);
    
    return stmt.all(...fileIds, analysisType, limit) as SuggestionRecord[];
  }

  /**
   * Update suggestion recommendation status
   */
  public updateSuggestionRecommendation(suggestionId: number, isRecommended: boolean): void {
    const stmt = this.db.prepare(`
      UPDATE suggestions 
      SET is_recommended = ?, updated_at = unixepoch()
      WHERE id = ?
    `);
    stmt.run(isRecommended ? 1 : 0, suggestionId);
  }

  /**
   * Delete suggestions for a file
   */
  public deleteSuggestionsByFileId(fileId: number): number {
    const stmt = this.db.prepare('DELETE FROM suggestions WHERE file_id = ?');
    const result = stmt.run(fileId);
    return result.changes;
  }

  /**
   * Analysis session management
   */

  /**
   * Create analysis session record
   */
  public createAnalysisSession(session: Omit<AnalysisSessionRecord, 'createdAt' | 'updatedAt'>): void {
    const stmt = this.db.prepare(`
      INSERT INTO analysis_sessions (
        id, session_type, root_path, analysis_types, total_files, processed_files,
        completed_files, failed_files, started_at, completed_at, total_duration,
        average_file_duration, success_rate, error_summary, models_used, status, error_message
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      session.id,
      session.sessionType,
      session.rootPath || null,
      session.analysisTypes,
      session.totalFiles,
      session.processedFiles,
      session.completedFiles,
      session.failedFiles,
      session.startedAt,
      session.completedAt || null,
      session.totalDuration || null,
      session.averageFileDuration || null,
      session.successRate,
      session.errorSummary || null,
      session.modelsUsed || null,
      session.status,
      session.errorMessage || null
    );
  }

  /**
   * Update analysis session
   */
  public updateAnalysisSession(sessionId: string, updates: Partial<AnalysisSessionRecord>): void {
    const fields = Object.keys(updates).filter(key => key !== 'id').map(key => `${key} = ?`);
    if (fields.length === 0) return;

    fields.push('updated_at = unixepoch()');
    const values = Object.keys(updates)
      .filter(key => key !== 'id')
      .map(key => (updates as any)[key]);
    values.push(sessionId);

    const stmt = this.db.prepare(`UPDATE analysis_sessions SET ${fields.join(', ')} WHERE id = ?`);
    stmt.run(...values);
  }

  /**
   * Get analysis session
   */
  public getAnalysisSession(sessionId: string): AnalysisSessionRecord | undefined {
    const stmt = this.db.prepare('SELECT * FROM analysis_sessions WHERE id = ?');
    return stmt.get(sessionId) as AnalysisSessionRecord | undefined;
  }

  /**
   * Get recent analysis sessions
   */
  public getRecentAnalysisSessions(limit: number = 10): AnalysisSessionRecord[] {
    const stmt = this.db.prepare('SELECT * FROM analysis_sessions ORDER BY started_at DESC LIMIT ?');
    return stmt.all(limit) as AnalysisSessionRecord[];
  }

  /**
   * Model metrics management
   */

  /**
   * Update model performance metrics
   */
  public updateModelMetrics(metrics: Omit<ModelMetricRecord, 'id' | 'createdAt' | 'updatedAt'>): void {
    const stmt = this.db.prepare(`
      INSERT INTO model_metrics (
        model_name, analysis_type, total_analyses, successful_analyses, failed_analyses,
        average_duration, average_confidence, average_quality, peak_memory_mb,
        average_memory_mb, period_start, period_end
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(model_name, analysis_type, period_start) DO UPDATE SET
        total_analyses = excluded.total_analyses,
        successful_analyses = excluded.successful_analyses,
        failed_analyses = excluded.failed_analyses,
        average_duration = excluded.average_duration,
        average_confidence = excluded.average_confidence,
        average_quality = excluded.average_quality,
        peak_memory_mb = excluded.peak_memory_mb,
        average_memory_mb = excluded.average_memory_mb,
        period_end = excluded.period_end,
        updated_at = unixepoch()
    `);

    stmt.run(
      metrics.modelName,
      metrics.analysisType,
      metrics.totalAnalyses,
      metrics.successfulAnalyses,
      metrics.failedAnalyses,
      metrics.averageDuration,
      metrics.averageConfidence,
      metrics.averageQuality,
      metrics.peakMemoryMb,
      metrics.averageMemoryMb,
      metrics.periodStart,
      metrics.periodEnd || null
    );
  }

  /**
   * Get model metrics for analysis
   */
  public getModelMetrics(modelName?: string, analysisType?: string): ModelMetricRecord[] {
    let sql = 'SELECT * FROM model_metrics WHERE 1=1';
    const params: any[] = [];

    if (modelName) {
      sql += ' AND model_name = ?';
      params.push(modelName);
    }

    if (analysisType) {
      sql += ' AND analysis_type = ?';
      params.push(analysisType);
    }

    sql += ' ORDER BY period_start DESC';

    const stmt = this.db.prepare(sql);
    return stmt.all(...params) as ModelMetricRecord[];
  }

  /**
   * Cleanup old suggestions and metrics
   */
  public cleanupOldData(daysToKeep: number = 30): { suggestionsDeleted: number; metricsDeleted: number } {
    const cutoffTime = Math.floor(Date.now() / 1000) - (daysToKeep * 24 * 60 * 60);

    // Delete old suggestions
    const suggestionsStmt = this.db.prepare('DELETE FROM suggestions WHERE created_at < ?');
    const suggestionsResult = suggestionsStmt.run(cutoffTime);

    // Delete old metrics
    const metricsStmt = this.db.prepare('DELETE FROM model_metrics WHERE created_at < ?');
    const metricsResult = metricsStmt.run(cutoffTime);

    return {
      suggestionsDeleted: suggestionsResult.changes,
      metricsDeleted: metricsResult.changes,
    };
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
