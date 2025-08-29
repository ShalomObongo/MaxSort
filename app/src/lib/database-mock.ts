// Mock database for development when better-sqlite3 has native module issues
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

class MockDatabaseManager {
  private files: Map<string, FileRecord> = new Map();
  private settings: Map<string, string> = new Map();
  private jobs: JobRecord[] = [];
  private isInitialized: boolean = false;

  public async initialize(): Promise<void> {
    this.isInitialized = true;
    
    // Initialize default settings
    if (!this.settings.has('ollama_main_model')) {
      this.settings.set('ollama_main_model', '');
    }
    if (!this.settings.has('ollama_sub_model')) {
      this.settings.set('ollama_sub_model', '');
    }
    if (!this.settings.has('ollama_endpoint')) {
      this.settings.set('ollama_endpoint', 'http://localhost:11434');
    }
    if (!this.settings.has('model_memory_estimates')) {
      this.settings.set('model_memory_estimates', '{}');
    }
    
    console.log('Mock Database initialized for development');
  }

  public upsertFile(fileData: FileRecord): number {
    const id = fileData.id || Date.now();
    const fileWithId = { ...fileData, id };
    this.files.set(fileData.path, fileWithId);
    return id;
  }

  public getFilesByRootPath(rootPath: string): FileRecord[] {
    return Array.from(this.files.values())
      .filter(file => file.parentDirectory?.startsWith(rootPath));
  }

  public getFileByPath(filePath: string): FileRecord | undefined {
    return this.files.get(filePath);
  }

  public cleanupMissingFiles(rootPath: string, existingPaths: string[]): number {
    const toDelete: string[] = [];
    this.files.forEach((file, path) => {
      if (file.parentDirectory?.startsWith(rootPath) && !existingPaths.includes(path)) {
        toDelete.push(path);
      }
    });
    
    toDelete.forEach(path => this.files.delete(path));
    return toDelete.length;
  }

  public getSetting(key: string): string | undefined {
    return this.settings.get(key);
  }

  public setSetting(key: string, value: string): void {
    this.settings.set(key, value);
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
    this.setSetting('ollama_main_model', mainModel || '');
    this.setSetting('ollama_sub_model', subModel || '');
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

  public createJob(jobData: Omit<JobRecord, 'id'>): number {
    const id = Date.now();
    const job = { ...jobData, id };
    this.jobs.push(job);
    return id;
  }

  public updateJob(id: number, updates: Partial<JobRecord>): void {
    const jobIndex = this.jobs.findIndex(j => j.id === id);
    if (jobIndex !== -1) {
      this.jobs[jobIndex] = { ...this.jobs[jobIndex], ...updates };
    }
  }

  public getJob(id: number): JobRecord | undefined {
    return this.jobs.find(j => j.id === id);
  }

  public getRecentJobs(limit: number = 10): JobRecord[] {
    return this.jobs
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit);
  }

  public getStats(): { totalFiles: number; totalSize: number; lastScanDate: number | null } {
    const files = Array.from(this.files.values());
    return {
      totalFiles: files.length,
      totalSize: files.reduce((sum, file) => sum + file.size, 0),
      lastScanDate: files.length > 0 ? Math.max(...files.map(f => f.lastScannedAt)) : null
    };
  }

  public close(): void {
    console.log('Mock Database connection closed');
  }

  public transaction<T>(fn: (db: any) => T): T {
    return fn(this);
  }
}

// Singleton instance
let dbInstance: MockDatabaseManager | null = null;

export function getDatabase(): MockDatabaseManager {
  if (!dbInstance) {
    dbInstance = new MockDatabaseManager();
  }
  return dbInstance;
}

export { MockDatabaseManager as DatabaseManager };
