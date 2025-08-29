import * as path from 'path';
import * as fs from 'fs/promises';
import { Logger } from './logger';
import { DatabaseManager } from './database';

export interface ValidationResult {
  isValid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
}

export interface ValidationError {
  code: string;
  message: string;
  severity: 'critical' | 'error' | 'warning';
  affectedPaths: string[];
  resolution?: string;
}

export interface ValidationWarning {
  code: string;
  message: string;
  affectedPaths: string[];
  recommendation: string;
}

export interface FileOperation {
  id: string;
  type: 'rename' | 'move' | 'delete';
  sourcePath: string;
  targetPath: string;
  fileId: number;
}

export interface ValidationOptions {
  allowSystemFiles?: boolean;
  allowHiddenFiles?: boolean;
  checkDiskSpace?: boolean;
  validatePermissions?: boolean;
  checkConflicts?: boolean;
  maxDepth?: number;
}

export class OperationValidator {
  private logger: Logger;
  private database: DatabaseManager;
  
  // System file patterns to protect
  private readonly SYSTEM_FILE_PATTERNS = [
    /^\/System\//,
    /^\/Library\/System/,
    /^\/usr\/bin/,
    /^\/usr\/sbin/,
    /^\/bin/,
    /^\/sbin/,
    /\.app\/Contents/,
    /\/node_modules\//,
    /\.git\//,
    /\.DS_Store$/,
    /Thumbs\.db$/,
    /desktop\.ini$/
  ];

  // Dangerous directory patterns
  private readonly DANGEROUS_DIRECTORIES = [
    /^\/System/,
    /^\/Library\/System/,
    /^\/usr/,
    /^\/bin/,
    /^\/sbin/,
    /^\/etc/,
    /^\/var\/system/,
    /^\/Applications/,
    /\/\.Trash/,
    /\/\.Spotlight-V100/,
    /\/\.DocumentRevisions-V100/,
    /\/\.fseventsd/
  ];

  // Reserved filenames that should not be used
  private readonly RESERVED_NAMES = [
    'CON', 'PRN', 'AUX', 'NUL',
    'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9',
    'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9'
  ];

  constructor(database: DatabaseManager, logger: Logger) {
    this.database = database;
    this.logger = logger;
  }

  /**
   * Validate a single file operation
   */
  async validateOperation(
    operation: FileOperation, 
    options: ValidationOptions = {}
  ): Promise<ValidationResult> {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];

    try {
      // Basic path validation
      await this.validatePaths(operation, errors, warnings);
      
      // System file protection
      if (!options.allowSystemFiles) {
        this.validateSystemFiles(operation, errors, warnings);
      }
      
      // Hidden file validation
      if (!options.allowHiddenFiles) {
        this.validateHiddenFiles(operation, errors, warnings);
      }
      
      // Permission validation
      if (options.validatePermissions !== false) {
        await this.validatePermissions(operation, errors, warnings);
      }
      
      // Reserved name validation
      this.validateReservedNames(operation, errors, warnings);
      
      // Character validation
      this.validateCharacters(operation, errors, warnings);
      
      // Path length validation
      this.validatePathLengths(operation, errors, warnings);

    } catch (error) {
      errors.push({
        code: 'VALIDATION_ERROR',
        message: `Validation failed: ${error instanceof Error ? error.message : String(error)}`,
        severity: 'critical',
        affectedPaths: [operation.sourcePath, operation.targetPath]
      });
    }

    return {
      isValid: errors.filter(e => e.severity === 'critical' || e.severity === 'error').length === 0,
      errors,
      warnings
    };
  }

  /**
   * Validate a batch of operations for conflicts and dependencies
   */
  async validateBatch(
    operations: FileOperation[],
    options: ValidationOptions = {}
  ): Promise<ValidationResult> {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];

    try {
      // Validate individual operations
      for (const operation of operations) {
        const result = await this.validateOperation(operation, options);
        errors.push(...result.errors);
        warnings.push(...result.warnings);
      }

      // Check for conflicts between operations
      if (options.checkConflicts !== false) {
        this.validateOperationConflicts(operations, errors, warnings);
      }

      // Check operation dependencies and ordering
      this.validateOperationDependencies(operations, errors, warnings);

      // Validate disk space if requested
      if (options.checkDiskSpace) {
        await this.validateDiskSpace(operations, errors, warnings);
      }

    } catch (error) {
      errors.push({
        code: 'BATCH_VALIDATION_ERROR',
        message: `Batch validation failed: ${error instanceof Error ? error.message : String(error)}`,
        severity: 'critical',
        affectedPaths: operations.map(op => op.sourcePath)
      });
    }

    return {
      isValid: errors.filter(e => e.severity === 'critical' || e.severity === 'error').length === 0,
      errors,
      warnings
    };
  }

  /**
   * Validate basic path structure and existence
   */
  private async validatePaths(
    operation: FileOperation,
    errors: ValidationError[],
    warnings: ValidationWarning[]
  ): Promise<void> {
    // Check if source exists
    try {
      const sourceStats = await fs.stat(operation.sourcePath);
      if (!sourceStats.isFile()) {
        errors.push({
          code: 'SOURCE_NOT_FILE',
          message: 'Source path is not a file',
          severity: 'error',
          affectedPaths: [operation.sourcePath],
          resolution: 'Ensure the source path points to a valid file'
        });
      }
    } catch (error) {
      errors.push({
        code: 'SOURCE_NOT_FOUND',
        message: 'Source file does not exist',
        severity: 'error',
        affectedPaths: [operation.sourcePath],
        resolution: 'Verify the source file path is correct'
      });
    }

    // Check if target path is valid
    const targetDir = path.dirname(operation.targetPath);
    try {
      const targetDirStats = await fs.stat(targetDir);
      if (!targetDirStats.isDirectory()) {
        errors.push({
          code: 'TARGET_DIR_NOT_DIRECTORY',
          message: 'Target directory is not a directory',
          severity: 'error',
          affectedPaths: [targetDir],
          resolution: 'Ensure the target directory exists and is a valid directory'
        });
      }
    } catch (error) {
      warnings.push({
        code: 'TARGET_DIR_NOT_FOUND',
        message: 'Target directory does not exist (will be created)',
        affectedPaths: [targetDir],
        recommendation: 'Directory will be created automatically during operation'
      });
    }

    // Check if target already exists
    try {
      await fs.stat(operation.targetPath);
      warnings.push({
        code: 'TARGET_EXISTS',
        message: 'Target file already exists and will be overwritten',
        affectedPaths: [operation.targetPath],
        recommendation: 'Consider using a different filename or backing up the existing file'
      });
    } catch (error) {
      // Target doesn't exist - this is good
    }

    // Validate path structure
    if (operation.sourcePath === operation.targetPath) {
      warnings.push({
        code: 'SAME_SOURCE_TARGET',
        message: 'Source and target paths are identical',
        affectedPaths: [operation.sourcePath],
        recommendation: 'No operation needed as paths are the same'
      });
    }
  }

  /**
   * Validate against system file patterns
   */
  private validateSystemFiles(
    operation: FileOperation,
    errors: ValidationError[],
    warnings: ValidationWarning[]
  ): void {
    const checkPath = (filePath: string, pathType: 'source' | 'target') => {
      for (const pattern of this.SYSTEM_FILE_PATTERNS) {
        if (pattern.test(filePath)) {
          errors.push({
            code: 'SYSTEM_FILE_OPERATION',
            message: `Operation on system file detected (${pathType}: ${filePath})`,
            severity: 'critical',
            affectedPaths: [filePath],
            resolution: 'System files should not be modified for safety reasons'
          });
          return;
        }
      }

      for (const pattern of this.DANGEROUS_DIRECTORIES) {
        if (pattern.test(path.dirname(filePath))) {
          warnings.push({
            code: 'DANGEROUS_DIRECTORY',
            message: `Operation in potentially dangerous directory (${pathType}: ${path.dirname(filePath)})`,
            affectedPaths: [filePath],
            recommendation: 'Exercise caution when operating on system directories'
          });
          return;
        }
      }
    };

    checkPath(operation.sourcePath, 'source');
    checkPath(operation.targetPath, 'target');
  }

  /**
   * Validate hidden file operations
   */
  private validateHiddenFiles(
    operation: FileOperation,
    errors: ValidationError[],
    warnings: ValidationWarning[]
  ): void {
    const isHidden = (filePath: string) => path.basename(filePath).startsWith('.');

    if (isHidden(operation.sourcePath)) {
      warnings.push({
        code: 'HIDDEN_FILE_SOURCE',
        message: 'Operating on hidden file',
        affectedPaths: [operation.sourcePath],
        recommendation: 'Hidden files may be system-related; proceed with caution'
      });
    }

    if (isHidden(operation.targetPath)) {
      warnings.push({
        code: 'HIDDEN_FILE_TARGET',
        message: 'Creating hidden file',
        affectedPaths: [operation.targetPath],
        recommendation: 'Creating hidden files may affect system behavior'
      });
    }
  }

  /**
   * Validate file permissions
   */
  private async validatePermissions(
    operation: FileOperation,
    errors: ValidationError[],
    warnings: ValidationWarning[]
  ): Promise<void> {
    try {
      // Check source permissions
      await fs.access(operation.sourcePath, fs.constants.R_OK);
    } catch (error) {
      errors.push({
        code: 'SOURCE_NO_READ_PERMISSION',
        message: 'No read permission for source file',
        severity: 'error',
        affectedPaths: [operation.sourcePath],
        resolution: 'Grant read permission to the source file'
      });
    }

    try {
      // Check if we can write to the source directory (for rename/move operations)
      const sourceDir = path.dirname(operation.sourcePath);
      await fs.access(sourceDir, fs.constants.W_OK);
    } catch (error) {
      errors.push({
        code: 'SOURCE_DIR_NO_WRITE_PERMISSION',
        message: 'No write permission for source directory',
        severity: 'error',
        affectedPaths: [path.dirname(operation.sourcePath)],
        resolution: 'Grant write permission to the source directory'
      });
    }

    try {
      // Check target directory permissions
      const targetDir = path.dirname(operation.targetPath);
      await fs.access(targetDir, fs.constants.W_OK);
    } catch (error) {
      errors.push({
        code: 'TARGET_DIR_NO_WRITE_PERMISSION',
        message: 'No write permission for target directory',
        severity: 'error',
        affectedPaths: [path.dirname(operation.targetPath)],
        resolution: 'Grant write permission to the target directory'
      });
    }
  }

  /**
   * Validate against reserved filenames
   */
  private validateReservedNames(
    operation: FileOperation,
    errors: ValidationError[],
    warnings: ValidationWarning[]
  ): void {
    const targetName = path.basename(operation.targetPath, path.extname(operation.targetPath));
    
    if (this.RESERVED_NAMES.includes(targetName.toUpperCase())) {
      errors.push({
        code: 'RESERVED_FILENAME',
        message: `Target filename "${targetName}" is a reserved system name`,
        severity: 'error',
        affectedPaths: [operation.targetPath],
        resolution: 'Use a different filename that is not reserved by the system'
      });
    }
  }

  /**
   * Validate filename characters
   */
  private validateCharacters(
    operation: FileOperation,
    errors: ValidationError[],
    warnings: ValidationWarning[]
  ): void {
    const targetName = path.basename(operation.targetPath);
    
    // Invalid characters for most filesystems
    const invalidChars = /[<>:"|?*\x00-\x1f]/;
    if (invalidChars.test(targetName)) {
      errors.push({
        code: 'INVALID_CHARACTERS',
        message: 'Target filename contains invalid characters',
        severity: 'error',
        affectedPaths: [operation.targetPath],
        resolution: 'Remove invalid characters: < > : " | ? * and control characters'
      });
    }

    // Check for leading/trailing spaces or dots
    if (targetName.startsWith(' ') || targetName.endsWith(' ') || 
        targetName.startsWith('.') || targetName.endsWith('.')) {
      warnings.push({
        code: 'PROBLEMATIC_CHARACTERS',
        message: 'Target filename has leading/trailing spaces or dots',
        affectedPaths: [operation.targetPath],
        recommendation: 'Consider removing leading/trailing spaces or dots for better compatibility'
      });
    }
  }

  /**
   * Validate path lengths
   */
  private validatePathLengths(
    operation: FileOperation,
    errors: ValidationError[],
    warnings: ValidationWarning[]
  ): void {
    const MAX_PATH_LENGTH = 260; // Windows limitation
    const MAX_FILENAME_LENGTH = 255;

    if (operation.targetPath.length > MAX_PATH_LENGTH) {
      errors.push({
        code: 'PATH_TOO_LONG',
        message: `Target path exceeds maximum length (${operation.targetPath.length} > ${MAX_PATH_LENGTH})`,
        severity: 'error',
        affectedPaths: [operation.targetPath],
        resolution: 'Use a shorter path or filename'
      });
    }

    const targetName = path.basename(operation.targetPath);
    if (targetName.length > MAX_FILENAME_LENGTH) {
      errors.push({
        code: 'FILENAME_TOO_LONG',
        message: `Target filename exceeds maximum length (${targetName.length} > ${MAX_FILENAME_LENGTH})`,
        severity: 'error',
        affectedPaths: [operation.targetPath],
        resolution: 'Use a shorter filename'
      });
    }
  }

  /**
   * Check for conflicts between operations in a batch
   */
  private validateOperationConflicts(
    operations: FileOperation[],
    errors: ValidationError[],
    warnings: ValidationWarning[]
  ): void {
    const targetPaths = new Map<string, FileOperation[]>();
    const sourcePaths = new Set<string>();

    // Group operations by target path
    for (const operation of operations) {
      const normalizedTarget = path.resolve(operation.targetPath);
      if (!targetPaths.has(normalizedTarget)) {
        targetPaths.set(normalizedTarget, []);
      }
      targetPaths.get(normalizedTarget)!.push(operation);
      sourcePaths.add(path.resolve(operation.sourcePath));
    }

    // Check for multiple operations targeting the same file
    for (const [targetPath, ops] of targetPaths) {
      if (ops.length > 1) {
        errors.push({
          code: 'TARGET_CONFLICT',
          message: `Multiple operations target the same file: ${targetPath}`,
          severity: 'error',
          affectedPaths: ops.map(op => op.sourcePath),
          resolution: 'Resolve conflicts by using different target names or removing duplicate operations'
        });
      }
    }

    // Check for operations where source becomes target of another operation
    for (const operation of operations) {
      const normalizedSource = path.resolve(operation.sourcePath);
      if (targetPaths.has(normalizedSource)) {
        const conflictingOps = targetPaths.get(normalizedSource)!;
        warnings.push({
          code: 'SOURCE_TARGET_CHAIN',
          message: `Operation source becomes target of another operation: ${normalizedSource}`,
          affectedPaths: [operation.sourcePath, ...conflictingOps.map(op => op.sourcePath)],
          recommendation: 'Verify operation order to ensure correct file transformations'
        });
      }
    }
  }

  /**
   * Validate operation dependencies and ordering
   */
  private validateOperationDependencies(
    operations: FileOperation[],
    errors: ValidationError[],
    warnings: ValidationWarning[]
  ): void {
    // Check for circular dependencies
    const dependencies = new Map<string, Set<string>>();
    
    for (const operation of operations) {
      const sourceDir = path.dirname(operation.sourcePath);
      const targetDir = path.dirname(operation.targetPath);
      
      if (!dependencies.has(operation.id)) {
        dependencies.set(operation.id, new Set());
      }
      
      // If target directory is a subdirectory of source, it depends on the source operation
      for (const otherOp of operations) {
        if (otherOp.id !== operation.id) {
          const otherTargetDir = path.dirname(otherOp.targetPath);
          if (sourceDir.startsWith(otherTargetDir)) {
            dependencies.get(operation.id)!.add(otherOp.id);
          }
        }
      }
    }

    // Detect circular dependencies using DFS
    const visited = new Set<string>();
    const recursionStack = new Set<string>();

    const hasCycle = (nodeId: string): boolean => {
      visited.add(nodeId);
      recursionStack.add(nodeId);

      const deps = dependencies.get(nodeId) || new Set();
      for (const depId of deps) {
        if (!visited.has(depId)) {
          if (hasCycle(depId)) {
            return true;
          }
        } else if (recursionStack.has(depId)) {
          return true;
        }
      }

      recursionStack.delete(nodeId);
      return false;
    };

    for (const operation of operations) {
      if (!visited.has(operation.id)) {
        if (hasCycle(operation.id)) {
          errors.push({
            code: 'CIRCULAR_DEPENDENCY',
            message: 'Circular dependency detected in operation order',
            severity: 'error',
            affectedPaths: operations.map(op => op.sourcePath),
            resolution: 'Reorder operations to resolve circular dependencies'
          });
          break;
        }
      }
    }
  }

  /**
   * Validate available disk space
   */
  private async validateDiskSpace(
    operations: FileOperation[],
    errors: ValidationError[],
    warnings: ValidationWarning[]
  ): Promise<void> {
    try {
      const totalSizeNeeded = await this.calculateTotalSize(operations);
      
      // Get available disk space for the first target directory
      if (operations.length > 0) {
        const firstTargetDir = path.dirname(operations[0].targetPath);
        
        // Use statvfs if available (Node.js 18+), otherwise skip the check
        try {
          const { spawn } = await import('child_process');
          const { promisify } = await import('util');
          const exec = promisify(spawn);
          
          // Use df command on Unix systems to get disk space
          const result = await new Promise<number>((resolve, reject) => {
            const dfProcess = spawn('df', ['-k', firstTargetDir]);
            let output = '';
            
            dfProcess.stdout.on('data', (data) => {
              output += data.toString();
            });
            
            dfProcess.on('close', (code) => {
              if (code === 0) {
                const lines = output.trim().split('\n');
                if (lines.length >= 2) {
                  const columns = lines[1].split(/\s+/);
                  const availableKB = parseInt(columns[3], 10);
                  if (!isNaN(availableKB)) {
                    resolve(availableKB * 1024); // Convert to bytes
                  } else {
                    reject(new Error('Could not parse disk space'));
                  }
                } else {
                  reject(new Error('Unexpected df output'));
                }
              } else {
                reject(new Error(`df command failed with code ${code}`));
              }
            });

            dfProcess.on('error', reject);
          });

          const availableSpace = result;
          const bufferSpace = totalSizeNeeded * 1.1; // 10% buffer
          
          if (availableSpace < bufferSpace) {
            errors.push({
              code: 'INSUFFICIENT_DISK_SPACE',
              message: `Insufficient disk space. Need: ${Math.round(bufferSpace / 1024 / 1024)}MB, Available: ${Math.round(availableSpace / 1024 / 1024)}MB`,
              severity: 'error',
              affectedPaths: [firstTargetDir],
              resolution: 'Free up disk space or choose a different target location'
            });
          } else if (availableSpace < totalSizeNeeded * 2) {
            warnings.push({
              code: 'LOW_DISK_SPACE',
              message: 'Low disk space detected',
              affectedPaths: [firstTargetDir],
              recommendation: 'Consider freeing up additional disk space for safety'
            });
          }
        } catch (error) {
          // Fallback: skip disk space check if df command fails
          warnings.push({
            code: 'DISK_SPACE_CHECK_FAILED',
            message: 'Unable to check available disk space',
            affectedPaths: [firstTargetDir],
            recommendation: 'Manually verify sufficient disk space is available'
          });
        }
      }
    } catch (error) {
      warnings.push({
        code: 'DISK_SPACE_CHECK_FAILED',
        message: 'Unable to check available disk space',
        affectedPaths: [],
        recommendation: 'Manually verify sufficient disk space is available'
      });
    }
  }

  /**
   * Calculate total size needed for operations
   */
  private async calculateTotalSize(operations: FileOperation[]): Promise<number> {
    let totalSize = 0;
    
    for (const operation of operations) {
      try {
        const stats = await fs.stat(operation.sourcePath);
        totalSize += stats.size;
      } catch (error) {
        // Skip files that can't be accessed
      }
    }
    
    return totalSize;
  }

  /**
   * Generate detailed validation report
   */
  generateValidationReport(result: ValidationResult): string {
    const lines: string[] = [];
    
    lines.push('=== OPERATION VALIDATION REPORT ===\n');
    
    if (result.isValid) {
      lines.push('✅ VALIDATION PASSED\n');
    } else {
      lines.push('❌ VALIDATION FAILED\n');
    }

    if (result.errors.length > 0) {
      lines.push('🚨 ERRORS:');
      result.errors.forEach((error, index) => {
        lines.push(`${index + 1}. [${error.code}] ${error.message}`);
        lines.push(`   Severity: ${error.severity}`);
        lines.push(`   Affected: ${error.affectedPaths.join(', ')}`);
        if (error.resolution) {
          lines.push(`   Resolution: ${error.resolution}`);
        }
        lines.push('');
      });
    }

    if (result.warnings.length > 0) {
      lines.push('⚠️ WARNINGS:');
      result.warnings.forEach((warning, index) => {
        lines.push(`${index + 1}. [${warning.code}] ${warning.message}`);
        lines.push(`   Affected: ${warning.affectedPaths.join(', ')}`);
        lines.push(`   Recommendation: ${warning.recommendation}`);
        lines.push('');
      });
    }

    if (result.errors.length === 0 && result.warnings.length === 0) {
      lines.push('✨ No issues found!');
    }

    return lines.join('\n');
  }
}
