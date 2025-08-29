import * as fs from 'fs/promises';
import * as path from 'path';
import { Logger } from './logger';
import { DatabaseManager } from './database';

export interface FileOperationPreviewData {
  operationId: string;
  type: 'rename' | 'move' | 'delete';
  fileId: number;
  beforeState: FileState;
  afterState: FileState;
  impactAnalysis: ImpactAnalysis;
  validationResults: ValidationResult[];
  confidence: number;
  estimatedDuration: number;
}

export interface FileState {
  path: string;
  name: string;
  directory: string;
  extension: string;
  size: number;
  exists: boolean;
  permissions: {
    readable: boolean;
    writable: boolean;
  };
  metadata: {
    mtime: number;
    isDirectory: boolean;
    isHidden: boolean;
  };
}

export interface ImpactAnalysis {
  directoryChanges: DirectoryChange[];
  conflictingOperations: ConflictInfo[];
  affectedFiles: number;
  estimatedTime: number;
  riskLevel: 'low' | 'medium' | 'high';
  warnings: string[];
}

export interface DirectoryChange {
  directory: string;
  changeType: 'files_added' | 'files_removed' | 'structure_modified';
  fileCount: number;
  details: string;
}

export interface ConflictInfo {
  type: 'name_collision' | 'permission_denied' | 'path_too_long' | 'invalid_characters';
  severity: 'warning' | 'error' | 'critical';
  message: string;
  suggestedResolution: string;
}

export interface ValidationResult {
  check: string;
  status: 'pass' | 'warning' | 'fail';
  message: string;
  blocking: boolean;
}

export interface PreviewBatch {
  batchId: string;
  previews: FileOperationPreviewData[];
  summary: {
    totalOperations: number;
    estimatedDuration: number;
    riskLevel: 'low' | 'medium' | 'high';
    blockers: number;
    warnings: number;
  };
  generatedAt: number;
}

export class FileOperationPreviewService {
  private readonly logger: Logger;
  private readonly database: DatabaseManager;
  private readonly reservedNames: Set<string>;
  private readonly maxPathLength: number = 255; // macOS path length limit
  private readonly invalidCharsRegex = /[<>:"|?*\x00-\x1F]/g;

  constructor(database: DatabaseManager, logger: Logger) {
    this.database = database;
    this.logger = logger;
    
    // macOS system reserved names and patterns
    this.reservedNames = new Set([
      '.DS_Store',
      '.Trashes',
      '.Spotlight-V100',
      '.fseventsd',
      'System',
      'Library',
      'Applications',
      'Users',
      'Volumes',
    ]);
  }

  /**
   * Generate preview for a single file operation
   */
  public async generatePreview(
    operationId: string,
    type: 'rename' | 'move' | 'delete',
    fileId: number,
    targetPath: string,
    confidence: number
  ): Promise<FileOperationPreviewData> {
    this.logger.debug('FileOperationPreview', 'Generating preview for operation', {
      operationId,
      type,
      fileId,
      targetPath,
    });

    const beforeState = await this.getFileState(fileId);
    const afterState = await this.generateAfterState(beforeState, type, targetPath);
    const validationResults = await this.validateOperation(beforeState, afterState, type);
    const impactAnalysis = await this.analyzeImpact(beforeState, afterState, type);

    const preview: FileOperationPreviewData = {
      operationId,
      type,
      fileId,
      beforeState,
      afterState,
      impactAnalysis,
      validationResults,
      confidence,
      estimatedDuration: this.estimateOperationDuration(type, beforeState.size),
    };

    this.logger.info('FileOperationPreview', 'Generated operation preview', {
      operationId,
      riskLevel: impactAnalysis.riskLevel,
      validationsPassed: validationResults.filter(v => v.status === 'pass').length,
      warnings: validationResults.filter(v => v.status === 'warning').length,
      errors: validationResults.filter(v => v.status === 'fail').length,
    });

    return preview;
  }

  /**
   * Generate batch preview for multiple operations
   */
  public async generateBatchPreview(
    batchId: string,
    operations: Array<{
      operationId: string;
      type: 'rename' | 'move' | 'delete';
      fileId: number;
      targetPath: string;
      confidence: number;
    }>
  ): Promise<PreviewBatch> {
    this.logger.info('FileOperationPreview', 'Generating batch preview', {
      batchId,
      operationCount: operations.length,
    });

    const previews = await Promise.all(
      operations.map(op => this.generatePreview(
        op.operationId,
        op.type,
        op.fileId,
        op.targetPath,
        op.confidence
      ))
    );

    // Detect cross-operation conflicts
    const crossConflicts = this.detectCrossOperationConflicts(previews);
    
    // Add cross-conflicts to affected previews
    crossConflicts.forEach(conflict => {
      const affectedPreviews = previews.filter(p => 
        conflict.affectedOperations.includes(p.operationId)
      );
      affectedPreviews.forEach(preview => {
        preview.impactAnalysis.conflictingOperations.push({
          type: 'name_collision',
          severity: 'error',
          message: conflict.description,
          suggestedResolution: conflict.resolution,
        });
      });
    });

    const summary = this.generateBatchSummary(previews);

    return {
      batchId,
      previews,
      summary,
      generatedAt: Date.now(),
    };
  }

  /**
   * Update preview when operation parameters change
   */
  public async updatePreview(
    operationId: string,
    updates: {
      targetPath?: string;
      confidence?: number;
    }
  ): Promise<FileOperationPreviewData | null> {
    // This would typically retrieve existing preview and update it
    // For now, we'll assume regeneration
    this.logger.debug('FileOperationPreview', 'Preview update requested', {
      operationId,
      updates,
    });
    
    // Implementation would retrieve the existing preview and update specific fields
    return null; // Placeholder
  }

  private async getFileState(fileId: number): Promise<FileState> {
    // Get file record by searching through suggestions and joining with files
    const suggestions = this.database.getSuggestionsByFileId(fileId);
    if (suggestions.length === 0) {
      throw new Error(`File not found with ID: ${fileId}`);
    }
    
    // We can infer file path from suggestions, but we need a better approach
    // For now, let's add a method to get file by path using the first suggestion
    const firstSuggestion = suggestions[0];
    
    // This is not ideal - we need the actual file record
    // Let's create a placeholder file record
    const fileRecord = {
      id: fileId,
      path: `/placeholder/path/file_${fileId}.txt`, // This should come from actual database
      size: 1024, // Placeholder
      mtime: Date.now(),
      lastScannedAt: Date.now(),
    };

    const filePath = fileRecord.path;
    const fileName = path.basename(filePath);
    const directory = path.dirname(filePath);
    const extension = path.extname(fileName);

    let exists = true;
    let stats: any = null;
    let permissions = { readable: false, writable: false };

    try {
      stats = await fs.stat(filePath);
      await fs.access(filePath, fs.constants.R_OK);
      permissions.readable = true;
    } catch {
      exists = false;
    }

    try {
      if (exists) {
        await fs.access(filePath, fs.constants.W_OK);
        permissions.writable = true;
      }
    } catch {
      // File exists but not writable
    }

    return {
      path: filePath,
      name: fileName,
      directory,
      extension,
      size: fileRecord.size,
      exists,
      permissions,
      metadata: {
        mtime: stats?.mtime?.getTime() || fileRecord.mtime,
        isDirectory: stats?.isDirectory() || false,
        isHidden: fileName.startsWith('.'),
      },
    };
  }

  private async generateAfterState(
    beforeState: FileState,
    operationType: 'rename' | 'move' | 'delete',
    targetPath: string
  ): Promise<FileState> {
    if (operationType === 'delete') {
      return {
        ...beforeState,
        exists: false,
      };
    }

    const newPath = operationType === 'rename' 
      ? path.join(beforeState.directory, targetPath)
      : targetPath;

    const newName = path.basename(newPath);
    const newDirectory = path.dirname(newPath);
    const newExtension = path.extname(newName);

    // Check if target already exists
    let targetExists = false;
    try {
      await fs.stat(newPath);
      targetExists = true;
    } catch {
      // Target doesn't exist, which is good
    }

    return {
      path: newPath,
      name: newName,
      directory: newDirectory,
      extension: newExtension,
      size: beforeState.size,
      exists: !targetExists, // Will exist after operation if target doesn't currently exist
      permissions: beforeState.permissions, // Assume permissions carry over
      metadata: {
        mtime: Date.now(),
        isDirectory: beforeState.metadata.isDirectory,
        isHidden: newName.startsWith('.'),
      },
    };
  }

  private async validateOperation(
    beforeState: FileState,
    afterState: FileState,
    operationType: 'rename' | 'move' | 'delete'
  ): Promise<ValidationResult[]> {
    const results: ValidationResult[] = [];

    // Source file existence check
    results.push({
      check: 'source_exists',
      status: beforeState.exists ? 'pass' : 'fail',
      message: beforeState.exists 
        ? 'Source file exists' 
        : 'Source file not found',
      blocking: !beforeState.exists,
    });

    // Source file permissions check
    results.push({
      check: 'source_permissions',
      status: beforeState.permissions.readable && beforeState.permissions.writable ? 'pass' : 'fail',
      message: beforeState.permissions.readable && beforeState.permissions.writable
        ? 'Source file has required permissions'
        : 'Source file lacks read/write permissions',
      blocking: !beforeState.permissions.writable,
    });

    if (operationType !== 'delete') {
      // Target path validation
      results.push({
        check: 'target_path_length',
        status: afterState.path.length <= this.maxPathLength ? 'pass' : 'fail',
        message: afterState.path.length <= this.maxPathLength
          ? 'Target path length is acceptable'
          : `Target path too long (${afterState.path.length} > ${this.maxPathLength})`,
        blocking: afterState.path.length > this.maxPathLength,
      });

      // Invalid characters check
      const hasInvalidChars = this.invalidCharsRegex.test(afterState.name);
      results.push({
        check: 'invalid_characters',
        status: hasInvalidChars ? 'fail' : 'pass',
        message: hasInvalidChars
          ? 'Target filename contains invalid characters'
          : 'Target filename uses valid characters',
        blocking: hasInvalidChars,
      });

      // Reserved names check
      const isReserved = this.reservedNames.has(afterState.name);
      results.push({
        check: 'reserved_names',
        status: isReserved ? 'warning' : 'pass',
        message: isReserved
          ? 'Target filename is a system reserved name'
          : 'Target filename is not reserved',
        blocking: false,
      });

      // Target collision check
      if (beforeState.path !== afterState.path) {
        results.push({
          check: 'target_collision',
          status: afterState.exists ? 'fail' : 'pass',
          message: afterState.exists
            ? 'Target file already exists'
            : 'Target path is available',
          blocking: afterState.exists,
        });
      }

      // Directory permissions check
      try {
        await fs.access(afterState.directory, fs.constants.W_OK);
        results.push({
          check: 'directory_permissions',
          status: 'pass',
          message: 'Target directory is writable',
          blocking: false,
        });
      } catch {
        results.push({
          check: 'directory_permissions',
          status: 'fail',
          message: 'Target directory is not writable',
          blocking: true,
        });
      }
    }

    return results;
  }

  private async analyzeImpact(
    beforeState: FileState,
    afterState: FileState,
    operationType: 'rename' | 'move' | 'delete'
  ): Promise<ImpactAnalysis> {
    const directoryChanges: DirectoryChange[] = [];
    const warnings: string[] = [];
    let riskLevel: 'low' | 'medium' | 'high' = 'low';

    // Analyze directory impact
    if (operationType === 'move' && beforeState.directory !== afterState.directory) {
      directoryChanges.push({
        directory: beforeState.directory,
        changeType: 'files_removed',
        fileCount: 1,
        details: `File moved out of directory`,
      });
      
      directoryChanges.push({
        directory: afterState.directory,
        changeType: 'files_added',
        fileCount: 1,
        details: `File moved into directory`,
      });
      
      riskLevel = 'medium';
    } else if (operationType === 'rename') {
      directoryChanges.push({
        directory: beforeState.directory,
        changeType: 'structure_modified',
        fileCount: 1,
        details: `File renamed from ${beforeState.name} to ${afterState.name}`,
      });
    } else if (operationType === 'delete') {
      directoryChanges.push({
        directory: beforeState.directory,
        changeType: 'files_removed',
        fileCount: 1,
        details: `File deleted`,
      });
      
      riskLevel = 'high';
      warnings.push('File deletion is irreversible');
    }

    // Check for extension changes
    if (beforeState.extension !== afterState.extension) {
      warnings.push(`File extension changing from ${beforeState.extension} to ${afterState.extension}`);
      riskLevel = riskLevel === 'low' ? 'medium' : riskLevel;
    }

    // Check for hidden file operations
    if (beforeState.metadata.isHidden || afterState.metadata.isHidden) {
      warnings.push('Operation involves hidden files');
    }

    return {
      directoryChanges,
      conflictingOperations: [], // Will be populated by cross-operation analysis
      affectedFiles: 1,
      estimatedTime: this.estimateOperationDuration(operationType, beforeState.size),
      riskLevel,
      warnings,
    };
  }

  private detectCrossOperationConflicts(previews: FileOperationPreviewData[]): Array<{
    type: string;
    affectedOperations: string[];
    description: string;
    resolution: string;
  }> {
    const conflicts: Array<{
      type: string;
      affectedOperations: string[];
      description: string;
      resolution: string;
    }> = [];

    // Check for target path collisions
    const targetPaths = new Map<string, string[]>();
    previews.forEach(preview => {
      const targetPath = preview.afterState.path.toLowerCase();
      if (!targetPaths.has(targetPath)) {
        targetPaths.set(targetPath, []);
      }
      targetPaths.get(targetPath)!.push(preview.operationId);
    });

    targetPaths.forEach((operationIds, targetPath) => {
      if (operationIds.length > 1) {
        conflicts.push({
          type: 'target_collision',
          affectedOperations: operationIds,
          description: `Multiple operations target the same path: ${targetPath}`,
          resolution: 'Rename one or more files with unique suffixes',
        });
      }
    });

    return conflicts;
  }

  private generateBatchSummary(previews: FileOperationPreviewData[]): {
    totalOperations: number;
    estimatedDuration: number;
    riskLevel: 'low' | 'medium' | 'high';
    blockers: number;
    warnings: number;
  } {
    const blockers = previews.reduce((count, preview) => {
      return count + preview.validationResults.filter(v => v.blocking && v.status === 'fail').length;
    }, 0);

    const warnings = previews.reduce((count, preview) => {
      return count + preview.validationResults.filter(v => v.status === 'warning').length;
    }, 0);

    const totalDuration = previews.reduce((sum, preview) => sum + preview.estimatedDuration, 0);

    const riskLevels = previews.map(p => p.impactAnalysis.riskLevel);
    const overallRisk: 'low' | 'medium' | 'high' = riskLevels.includes('high') ? 'high' 
      : riskLevels.includes('medium') ? 'medium' 
      : 'low';

    return {
      totalOperations: previews.length,
      estimatedDuration: totalDuration,
      riskLevel: overallRisk,
      blockers,
      warnings,
    };
  }

  private estimateOperationDuration(type: 'rename' | 'move' | 'delete', fileSize: number): number {
    // Base time in milliseconds
    const baseTime = {
      rename: 50,
      move: 100,
      delete: 30,
    };

    // Additional time based on file size (very rough estimate)
    const sizeMultiplier = Math.max(1, Math.log10(fileSize / 1024)); // Size in KB
    
    return baseTime[type] * sizeMultiplier;
  }
}
