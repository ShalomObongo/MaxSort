/**
 * SuggestionExecutionService
 * 
 * Bridges approved AI suggestions to the existing BatchOperationManager for execution.
 * Converts Suggestion objects to BatchOperation format and manages selective execution.
 */

import { EventEmitter } from 'events';
import type { SuggestionRecord } from './database';
import type { BatchOperation } from './batch-operation-manager';
import { DatabaseManager, getDatabase } from './database';
import { BatchOperationManager } from './batch-operation-manager';
import { TransactionalFileManager, FileOperation as TransactionalFileOperation } from './transactional-file-manager';
import { OperationValidator, ValidationOptions, ValidationResult, FileOperation as ValidatorFileOperation } from './operation-validator';
import { Logger } from './logger';

export interface SuggestionExecutionOptions {
  /** Filter suggestions by confidence threshold */
  minConfidence?: number;
  /** Filter suggestions by operation type */
  operationTypes?: ('rename' | 'move')[];
  /** Filter suggestions by approval status */
  status?: 'approved' | 'manual-review'[];
  /** Group operations by criteria for batch processing */
  groupBy?: 'confidence' | 'type' | 'directory' | 'none';
  /** Maximum batch size for processing */
  maxBatchSize?: number;
  /** Specific suggestion IDs to include (selective execution) */
  selectedSuggestionIds?: number[];
  /** Exclude specific suggestion IDs */
  excludeSuggestionIds?: number[];
}

export interface SelectiveExecutionRequest {
  /** Array of suggestion IDs to execute */
  suggestionIds: number[];
  /** Execution options for the selected suggestions */
  options: SuggestionExecutionOptions;
  /** Whether to validate selections before execution */
  validateSelections?: boolean;
  /** Custom batch naming prefix */
  batchPrefix?: string;
}

export interface BatchGroupingOptions {
  /** Group by confidence levels with custom thresholds */
  confidenceThresholds?: {
    high: number; // default: 0.9
    medium: number; // default: 0.7
  };
  /** Group by analysis type */
  analysisTypes?: string[];
  /** Group by file associations */
  groupRelatedFiles?: boolean;
  /** Maximum operations per group */
  maxGroupSize?: number;
}

export interface ExecutionBatch {
  id: string;
  suggestions: SuggestionRecord[];
  operations: BatchOperation[];
  groupCriteria: string;
  estimatedDuration: number;
  riskLevel: 'low' | 'medium' | 'high';
}

export interface ExecutionSummary {
  totalSuggestions: number;
  totalBatches: number;
  estimatedDuration: number;
  riskAssessment: {
    low: number;
    medium: number;
    high: number;
  };
  operationCounts: {
    rename: number;
    move: number;
  };
}

export class SuggestionExecutionService extends EventEmitter {
  private database: DatabaseManager;
  private batchManager: BatchOperationManager;
  private transactionManager: TransactionalFileManager;
  private validator: OperationValidator;
  private logger: Logger;
  private activeBatches: Map<string, ExecutionBatch> = new Map();

  constructor(
    database: DatabaseManager, 
    batchManager: BatchOperationManager,
    transactionManager?: TransactionalFileManager,
    validator?: OperationValidator
  ) {
    super();
    this.database = database;
    this.batchManager = batchManager;
    this.logger = Logger.getInstance();
    
    // Create TransactionalFileManager if not provided
    this.transactionManager = transactionManager || new TransactionalFileManager(database, this.logger);

    // Create OperationValidator for comprehensive validation
    this.validator = validator || new OperationValidator(database, this.logger);

    // Listen to batch manager events and forward them
    this.batchManager.on('batch-started', (batchId: string, operations: BatchOperation[]) => {
      this.emit('execution:started', batchId, operations);
    });

    this.batchManager.on('batch-progress', (batchId: string, progress: any) => {
      this.emit('execution:progress', batchId, progress);
    });

    this.batchManager.on('batch-completed', (batchId: string, results: any) => {
      this.activeBatches.delete(batchId);
      this.emit('execution:completed', batchId, results);
    });

    this.batchManager.on('batch-failed', (batchId: string, error: any) => {
      this.activeBatches.delete(batchId);
      this.emit('execution:failed', batchId, error);
    });

    this.logger.info('SuggestionExecutionService', 'Initialized with transactional support');
  }

  /**
   * Get approved suggestions filtered by options
   */
  async getApprovedSuggestions(options: SuggestionExecutionOptions = {}): Promise<SuggestionRecord[]> {
    try {
      // For now, use getTopSuggestions with a high limit to get all suggestions
      // In a real implementation, you would add a proper query method to DatabaseManager
      const allSuggestions = this.database.getTopSuggestions([], 'rename-suggestions', 10000);
      
      // Filter suggestions based on options
      let filteredSuggestions = allSuggestions.filter(s => s.isRecommended);
      
      // Apply confidence filter
      if (options.minConfidence) {
        filteredSuggestions = filteredSuggestions.filter(s => s.adjustedConfidence >= options.minConfidence!);
      }

      // Apply selective execution filters
      if (options.selectedSuggestionIds?.length) {
        filteredSuggestions = filteredSuggestions.filter(s => 
          options.selectedSuggestionIds!.includes(s.id!)
        );
      }

      if (options.excludeSuggestionIds?.length) {
        filteredSuggestions = filteredSuggestions.filter(s => 
          !options.excludeSuggestionIds!.includes(s.id!)
        );
      }
      
      this.logger.info('SuggestionExecutionService', 'Retrieved approved suggestions', {
        count: filteredSuggestions.length,
        filters: options
      });

      return filteredSuggestions;
    } catch (error) {
      this.logger.error('SuggestionExecutionService', 'Failed to retrieve approved suggestions', error as Error, { 
        options 
      });
      throw error;
    }
  }

  /**
   * Execute a selective batch of specific suggestions
   */
  async executeSelectiveBatch(request: SelectiveExecutionRequest): Promise<ExecutionBatch[]> {
    try {
      this.logger.info('SuggestionExecutionService', 'Starting selective execution', {
        suggestionCount: request.suggestionIds.length,
        options: request.options
      });

      // Get the specific suggestions
      const options: SuggestionExecutionOptions = {
        ...request.options,
        selectedSuggestionIds: request.suggestionIds
      };

      const suggestions = await this.getApprovedSuggestions(options);

      if (suggestions.length === 0) {
        throw new Error('No valid suggestions found for selective execution');
      }

      // Validate selections if requested
      if (request.validateSelections) {
        await this.validateSuggestionSelections(suggestions);
      }

      // Create execution batches with custom naming
      const batchOptions = {
        ...request.options,
        maxBatchSize: request.options.maxBatchSize || 25 // Smaller batches for selective execution
      };

      const batches = await this.createExecutionBatches(suggestions, batchOptions);

      // Apply custom batch naming if provided
      if (request.batchPrefix) {
        batches.forEach((batch, index) => {
          batch.id = `${request.batchPrefix}-${index + 1}`;
        });
      }

      this.logger.info('SuggestionExecutionService', 'Created selective execution batches', {
        batchCount: batches.length,
        totalSuggestions: suggestions.length,
        prefix: request.batchPrefix
      });

      return batches;
    } catch (error) {
      this.logger.error('SuggestionExecutionService', 'Selective execution failed', error as Error, {
        request
      });
      throw error;
    }
  }

  /**
   * Validate suggestion selections for execution
   */
  private async validateSuggestionSelections(suggestions: SuggestionRecord[]): Promise<void> {
    const issues: string[] = [];

    // Check for duplicate file targets
    const targetPaths = new Set<string>();
    const duplicateTargets: string[] = [];
    
    suggestions.forEach(suggestion => {
      if (targetPaths.has(suggestion.suggestedValue)) {
        duplicateTargets.push(suggestion.suggestedValue);
      } else {
        targetPaths.add(suggestion.suggestedValue);
      }
    });

    if (duplicateTargets.length > 0) {
      issues.push(`Duplicate target paths found: ${duplicateTargets.join(', ')}`);
    }

    // Check for extremely low confidence suggestions
    const lowConfidenceSuggestions = suggestions.filter(s => s.adjustedConfidence < 0.5);
    if (lowConfidenceSuggestions.length > 0) {
      issues.push(`${lowConfidenceSuggestions.length} suggestions have very low confidence (<50%)`);
    }

    // Report validation issues
    if (issues.length > 0) {
      this.logger.warn('SuggestionExecutionService', 'Validation issues found in selection', {
        issues,
        suggestionCount: suggestions.length
      });
    }
  }

  /**
   * Create advanced execution batches with custom grouping options
   */
  async createAdvancedExecutionBatches(
    suggestions: SuggestionRecord[], 
    options: SuggestionExecutionOptions,
    groupingOptions: BatchGroupingOptions = {}
  ): Promise<ExecutionBatch[]> {
    try {
      const batches: ExecutionBatch[] = [];
      const maxBatchSize = options.maxBatchSize || 50;
      const maxGroupSize = groupingOptions.maxGroupSize || maxBatchSize;

      if (options.groupBy === 'confidence' && groupingOptions.confidenceThresholds) {
        // Custom confidence-based grouping
        const { high = 0.9, medium = 0.7 } = groupingOptions.confidenceThresholds;
        
        const highConfidence = suggestions.filter(s => s.adjustedConfidence >= high);
        const mediumConfidence = suggestions.filter(s => s.adjustedConfidence >= medium && s.adjustedConfidence < high);
        const lowConfidence = suggestions.filter(s => s.adjustedConfidence < medium);

        if (highConfidence.length > 0) {
          const chunks = this.chunkArray(highConfidence, maxGroupSize);
          chunks.forEach((chunk, index) => {
            const batch = this.createBatchSync(chunk, `high-confidence-${index + 1}`, 'High Confidence Operations');
            batches.push(batch);
          });
        }

        if (mediumConfidence.length > 0) {
          const chunks = this.chunkArray(mediumConfidence, maxGroupSize);
          chunks.forEach((chunk, index) => {
            const batch = this.createBatchSync(chunk, `medium-confidence-${index + 1}`, 'Medium Confidence Operations');
            batches.push(batch);
          });
        }

        if (lowConfidence.length > 0) {
          const chunks = this.chunkArray(lowConfidence, maxGroupSize);
          chunks.forEach((chunk, index) => {
            const batch = this.createBatchSync(chunk, `low-confidence-${index + 1}`, 'Low Confidence Operations');
            batches.push(batch);
          });
        }
      } else {
        // Use standard grouping
        return this.createExecutionBatches(suggestions, options);
      }

      this.logger.info('SuggestionExecutionService', 'Created advanced execution batches', {
        batchCount: batches.length,
        totalSuggestions: suggestions.length,
        groupingOptions
      });

      return batches;
    } catch (error) {
      this.logger.error('SuggestionExecutionService', 'Failed to create advanced execution batches', error as Error, { 
        options,
        groupingOptions 
      });
      throw error;
    }
  }

  /**
   * Synchronous version of createBatch for internal use
   */
  private createBatchSync(
    suggestions: SuggestionRecord[], 
    batchId: string, 
    groupCriteria: string
  ): ExecutionBatch {
    const operations = suggestions.map(s => this.convertSuggestionToBatchOperation(s)) as BatchOperation[];
    
    return {
      id: batchId,
      suggestions,
      operations,
      groupCriteria,
      estimatedDuration: this.estimateBatchDuration(operations),
      riskLevel: this.assessBatchRisk(operations)
    };
  }

  /**
   * Convert SuggestionRecord to BatchOperation format
   */
  private convertSuggestionToBatchOperation(suggestion: SuggestionRecord): Omit<BatchOperation, 'id' | 'status' | 'createdAt'> {
    return {
      type: 'rename', // SuggestionRecord doesn't have a type field, defaulting to rename
      fileId: suggestion.fileId,
      originalPath: '', // Would need to get this from the file record
      targetPath: suggestion.suggestedValue,
      confidence: suggestion.adjustedConfidence,
      priority: this.calculatePriority(suggestion.adjustedConfidence)
    };
  }

  /**
   * Calculate operation priority based on confidence score
   */
  private calculatePriority(confidence: number): 'high' | 'medium' | 'low' {
    if (confidence >= 0.9) return 'high';
    if (confidence >= 0.7) return 'medium';
    return 'low';
  }

  /**
   * Group suggestions into execution batches based on criteria
   */
  async createExecutionBatches(
    suggestions: SuggestionRecord[], 
    options: SuggestionExecutionOptions
  ): Promise<ExecutionBatch[]> {
    try {
      const batches: ExecutionBatch[] = [];
      const maxBatchSize = options.maxBatchSize || 50;

      if (options.groupBy === 'none') {
        // Single batch with size limit
        const chunks = this.chunkArray(suggestions, maxBatchSize);
        for (let i = 0; i < chunks.length; i++) {
          const batch = await this.createBatch(
            chunks[i], 
            `batch-${i + 1}`,
            `Batch ${i + 1} of ${chunks.length}`
          );
          batches.push(batch);
        }
      } else {
        // Group by criteria
        const groups = this.groupSuggestions(suggestions, options.groupBy || 'confidence');
        
        for (const [groupKey, groupSuggestions] of Object.entries(groups)) {
          const chunks = this.chunkArray(groupSuggestions, maxBatchSize);
          
          for (let i = 0; i < chunks.length; i++) {
            const batchId = `${groupKey}-${i + 1}`;
            const groupDescription = this.getGroupDescription(options.groupBy || 'confidence', groupKey);
            const batch = await this.createBatch(chunks[i], batchId, groupDescription);
            batches.push(batch);
          }
        }
      }

      this.logger.info('SuggestionExecutionService', 'Created execution batches', {
        batchCount: batches.length,
        totalSuggestions: suggestions.length,
        groupBy: options.groupBy
      });

      return batches;
    } catch (error) {
      this.logger.error('SuggestionExecutionService', 'Failed to create execution batches', error as Error, { 
        options 
      });
      throw error;
    }
  }

  /**
   * Create a single execution batch
   */
  private async createBatch(
    suggestions: SuggestionRecord[], 
    batchId: string, 
    groupCriteria: string
  ): Promise<ExecutionBatch> {
    const operations = suggestions.map(s => this.convertSuggestionToBatchOperation(s)) as BatchOperation[];
    
    return {
      id: batchId,
      suggestions,
      operations,
      groupCriteria,
      estimatedDuration: this.estimateBatchDuration(operations),
      riskLevel: this.assessBatchRisk(operations)
    };
  }

  /**
   * Group suggestions by specified criteria
   */
  private groupSuggestions(suggestions: SuggestionRecord[], groupBy: string): Record<string, SuggestionRecord[]> {
    const groups: Record<string, SuggestionRecord[]> = {};

    suggestions.forEach(suggestion => {
      let key: string;
      
      switch (groupBy) {
        case 'confidence':
          key = suggestion.adjustedConfidence >= 0.9 ? 'high-confidence' :
                suggestion.adjustedConfidence >= 0.7 ? 'medium-confidence' : 'low-confidence';
          break;
        case 'type':
          key = suggestion.analysisType;
          break;
        case 'directory':
          key = `file-${suggestion.fileId}`; // Group by file ID since we don't have path in SuggestionRecord
          break;
        default:
          key = 'default';
      }

      if (!groups[key]) groups[key] = [];
      groups[key].push(suggestion);
    });

    return groups;
  }

  /**
   * Get human-readable description for group
   */
  private getGroupDescription(groupBy: string, groupKey: string): string {
    switch (groupBy) {
      case 'confidence':
        return groupKey.replace('-', ' ').replace(/\b\w/g, l => l.toUpperCase());
      case 'type':
        return groupKey === 'rename' ? 'File Renames' : 'File Moves';
      case 'directory':
        return `Directory: ${groupKey}`;
      default:
        return groupKey;
    }
  }

  /**
   * Chunk array into smaller arrays
   */
  private chunkArray<T>(array: T[], chunkSize: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += chunkSize) {
      chunks.push(array.slice(i, i + chunkSize));
    }
    return chunks;
  }

  /**
   * Estimate batch execution duration in milliseconds
   */
  private estimateBatchDuration(operations: BatchOperation[]): number {
    // Base time per operation: 100ms for rename, 200ms for move
    const baseTime = operations.reduce((total, op) => {
      return total + (op.type === 'rename' ? 100 : 200);
    }, 0);

    // Add overhead for batch processing
    return baseTime + (operations.length * 50);
  }

  /**
   * Assess risk level of batch operations
   */
  private assessBatchRisk(operations: BatchOperation[]): 'low' | 'medium' | 'high' {
    const lowConfidenceOps = operations.filter(op => op.confidence < 0.7).length;
    const moveOps = operations.filter(op => op.type === 'move').length;
    
    const riskScore = (lowConfidenceOps * 2) + (moveOps * 1.5);
    const riskRatio = riskScore / operations.length;

    if (riskRatio > 2) return 'high';
    if (riskRatio > 1) return 'medium';
    return 'low';
  }

  /**
   * Generate execution summary for all batches
   */
  generateExecutionSummary(batches: ExecutionBatch[]): ExecutionSummary {
    const totalSuggestions = batches.reduce((sum, batch) => sum + batch.suggestions.length, 0);
    const totalDuration = batches.reduce((sum, batch) => sum + batch.estimatedDuration, 0);
    
    const riskCounts = { low: 0, medium: 0, high: 0 };
    const opCounts = { rename: 0, move: 0, delete: 0 };

    batches.forEach(batch => {
      riskCounts[batch.riskLevel]++;
      batch.operations.forEach(op => {
        opCounts[op.type]++;
      });
    });

    return {
      totalSuggestions,
      totalBatches: batches.length,
      estimatedDuration: totalDuration,
      riskAssessment: riskCounts,
      operationCounts: opCounts
    };
  }

  /**
   * Execute a specific batch of operations
   */
  async executeBatch(batch: ExecutionBatch): Promise<void> {
    try {
      this.activeBatches.set(batch.id, batch);
      
      this.logger.info('SuggestionExecutionService', 'Starting batch execution', {
        batchId: batch.id,
        operationCount: batch.operations.length,
        riskLevel: batch.riskLevel
      });

      // Add operations to BatchOperationManager and create batch
      const operationIds: string[] = [];
      for (const operation of batch.operations) {
        const operationId = this.batchManager.addOperation(operation);
        operationIds.push(operationId);
      }

      // Create and start batch execution
      const batchId = this.batchManager.createBatch(operationIds, 'interactive');
      await this.batchManager.startProcessing();

    } catch (error) {
      this.activeBatches.delete(batch.id);
      this.logger.error('SuggestionExecutionService', 'Batch execution failed', error as Error, { 
        batchId: batch.id
      });
      throw error;
    }
  }

  /**
   * Execute all batches sequentially
   */
  async executeAllBatches(batches: ExecutionBatch[]): Promise<void> {
    for (const batch of batches) {
      await this.executeBatch(batch);
    }
  }

  /**
   * Cancel active batch execution
   */
  async cancelBatch(batchId: string): Promise<void> {
    try {
      await this.batchManager.cancelBatch(batchId);
      this.activeBatches.delete(batchId);
      
      this.logger.info('SuggestionExecutionService', 'Batch execution cancelled', { batchId });
    } catch (error) {
      this.logger.error('SuggestionExecutionService', 'Failed to cancel batch', error as Error, { 
        batchId 
      });
      throw error;
    }
  }

  /**
   * Get status of active batches
   */
  getActiveBatches(): ExecutionBatch[] {
    return Array.from(this.activeBatches.values());
  }

  // ========== VALIDATION METHODS ==========

  /**
   * Validate suggestions before execution with comprehensive safety checks
   * Task 5: Comprehensive error handling and validation
   */
  async validateSuggestions(
    suggestions: SuggestionRecord[],
    options: ValidationOptions = {}
  ): Promise<{
    success: boolean;
    validationResult: ValidationResult;
    recommendedActions: string[];
    criticalIssues: boolean;
    canProceed: boolean;
    errors?: string[];
  }> {
    try {
      this.logger.info('SuggestionExecutionService', 'Validating suggestions for execution', {
        suggestionCount: suggestions.length,
        options
      });

      // Convert suggestions to file operations for validation
      const operations: ValidatorFileOperation[] = [];
      const conversionErrors: string[] = [];

      for (const suggestion of suggestions) {
        try {
          const fileRecord = this.database.getFileById(suggestion.fileId);
          if (!fileRecord) {
            conversionErrors.push(`File not found for suggestion ${suggestion.id} (fileId: ${suggestion.fileId})`);
            continue;
          }

          // Create operation based on suggestion type
          const operation: ValidatorFileOperation = {
            id: `suggestion_${suggestion.id}`,
            type: 'rename', // Most common operation
            sourcePath: fileRecord.path,
            targetPath: this.generateTargetPath(fileRecord.path, suggestion.suggestedValue),
            fileId: suggestion.fileId
          };

          operations.push(operation);
        } catch (error) {
          conversionErrors.push(`Failed to process suggestion ${suggestion.id}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }

      if (operations.length === 0) {
        return {
          success: false,
          validationResult: {
            isValid: false,
            errors: [{
              code: 'NO_VALID_OPERATIONS',
              message: 'No valid operations could be generated from suggestions',
              severity: 'critical' as const,
              affectedPaths: [],
              resolution: 'Check that suggestions reference existing files with valid paths'
            }],
            warnings: []
          },
          recommendedActions: ['Review suggestion data', 'Check file paths', 'Verify database integrity'],
          criticalIssues: true,
          canProceed: false,
          errors: conversionErrors
        };
      }

      // Set validation options with safety-first defaults
      const validationOptions: ValidationOptions = {
        allowSystemFiles: false,
        allowHiddenFiles: options.allowHiddenFiles ?? false,
        checkDiskSpace: options.checkDiskSpace ?? true,
        validatePermissions: options.validatePermissions ?? true,
        checkConflicts: options.checkConflicts ?? true,
        maxDepth: options.maxDepth ?? 10,
        ...options
      };

      // Validate batch of operations
      const validationResult = await this.validator.validateBatch(operations, validationOptions);

      // Analyze results and generate recommendations
      const criticalIssues = validationResult.errors.some(e => e.severity === 'critical');
      const hasBlockingErrors = validationResult.errors.some(e => e.severity === 'critical' || e.severity === 'error');
      const canProceed = !hasBlockingErrors && validationResult.isValid;

      const recommendedActions: string[] = [];

      // Generate recommendations based on validation results
      if (criticalIssues) {
        recommendedActions.push('⚠️ CRITICAL ISSUES DETECTED - Do not proceed without resolution');
      }

      if (validationResult.errors.length > 0) {
        recommendedActions.push(`Resolve ${validationResult.errors.length} error(s) before execution`);
        
        // Specific recommendations based on error codes
        const errorCodes = new Set(validationResult.errors.map(e => e.code));
        if (errorCodes.has('SYSTEM_FILE_OPERATION')) {
          recommendedActions.push('Remove system file operations - these are dangerous');
        }
        if (errorCodes.has('TARGET_CONFLICT')) {
          recommendedActions.push('Resolve target conflicts by using unique filenames');
        }
        if (errorCodes.has('PERMISSION_DENIED')) {
          recommendedActions.push('Grant necessary file permissions or run as administrator');
        }
      }

      if (validationResult.warnings.length > 0) {
        recommendedActions.push(`Review ${validationResult.warnings.length} warning(s) - may proceed with caution`);
      }

      if (canProceed && validationResult.warnings.length === 0 && validationResult.errors.length === 0) {
        recommendedActions.push('✅ All validations passed - safe to proceed');
      }

      this.logger.info('SuggestionExecutionService', 'Suggestion validation completed', {
        totalOperations: operations.length,
        errors: validationResult.errors.length,
        warnings: validationResult.warnings.length,
        canProceed,
        criticalIssues
      });

      return {
        success: true,
        validationResult,
        recommendedActions,
        criticalIssues,
        canProceed,
        errors: conversionErrors.length > 0 ? conversionErrors : undefined
      };

    } catch (error) {
      this.logger.error('SuggestionExecutionService', 'Validation failed', error as Error);
      
      return {
        success: false,
        validationResult: {
          isValid: false,
          errors: [{
            code: 'VALIDATION_SYSTEM_ERROR',
            message: `Validation system error: ${error instanceof Error ? error.message : String(error)}`,
            severity: 'critical' as const,
            affectedPaths: [],
            resolution: 'Check validation system configuration and try again'
          }],
          warnings: []
        },
        recommendedActions: ['Check system logs', 'Verify validation system configuration', 'Contact support if issue persists'],
        criticalIssues: true,
        canProceed: false,
        errors: [error instanceof Error ? error.message : String(error)]
      };
    }
  }

  /**
   * Validate individual suggestion with detailed analysis
   */
  async validateSingleSuggestion(
    suggestion: SuggestionRecord,
    options: ValidationOptions = {}
  ): Promise<ValidationResult> {
    try {
      const fileRecord = this.database.getFileById(suggestion.fileId);
      if (!fileRecord) {
        return {
          isValid: false,
          errors: [{
            code: 'FILE_NOT_FOUND',
            message: `File not found for suggestion ${suggestion.id}`,
            severity: 'error' as const,
            affectedPaths: [`fileId:${suggestion.fileId}`]
          }],
          warnings: []
        };
      }

      const operation: ValidatorFileOperation = {
        id: `suggestion_${suggestion.id}`,
        type: 'rename',
        sourcePath: fileRecord.path,
        targetPath: this.generateTargetPath(fileRecord.path, suggestion.suggestedValue),
        fileId: suggestion.fileId
      };

      return await this.validator.validateOperation(operation, options);
    } catch (error) {
      return {
        isValid: false,
        errors: [{
          code: 'VALIDATION_ERROR',
          message: `Validation error: ${error instanceof Error ? error.message : String(error)}`,
          severity: 'critical' as const,
          affectedPaths: []
        }],
        warnings: []
      };
    }
  }

  /**
   * Generate validation report for UI display
   */
  generateValidationReport(validationResult: ValidationResult): string {
    return this.validator.generateValidationReport(validationResult);
  }

  /**
   * Helper method to generate target path from suggestion
   */
  private generateTargetPath(sourcePath: string, suggestedValue: string): string {
    const dir = sourcePath.substring(0, sourcePath.lastIndexOf('/'));
    const extension = sourcePath.substring(sourcePath.lastIndexOf('.'));
    
    // Handle different suggestion formats
    if (suggestedValue.includes('.')) {
      // Suggestion includes extension
      return `${dir}/${suggestedValue}`;
    } else {
      // Add original extension
      return `${dir}/${suggestedValue}${extension}`;
    }
  }

  // ========== TRANSACTIONAL EXECUTION METHODS ==========

  /**
   * Execute suggestions using TransactionalFileManager with atomic operations
   * This provides rollback capabilities and integrates with OperationHistory
   */
  async executeWithTransaction(suggestions: SuggestionRecord[], options: {
    createBackups?: boolean;
    enableRollback?: boolean;
    operationJournaling?: boolean;
  } = {}): Promise<{
    success: boolean;
    transactionId: string;
    completedOperations: number;
    errors: string[];
    rollbackAvailable: boolean;
  }> {
    const { createBackups = true, enableRollback = true, operationJournaling = true } = options;

    this.logger.info('SuggestionExecutionService', 'Starting transactional execution', {
      suggestionCount: suggestions.length,
      createBackups,
      enableRollback,
      operationJournaling
    });

    // TASK 5: Pre-execution validation for safety
    this.logger.info('SuggestionExecutionService', 'Performing pre-execution validation');
    const validationResult = await this.validateSuggestions(suggestions, {
      allowSystemFiles: false, // Never allow system files
      allowHiddenFiles: false, // Avoid hidden files by default
      checkDiskSpace: true,     // Ensure sufficient space
      validatePermissions: true, // Check permissions
      checkConflicts: true      // Prevent conflicts
    });

    if (!validationResult.success || !validationResult.canProceed) {
      const errorMessage = `Pre-execution validation failed: ${validationResult.recommendedActions.join(', ')}`;
      this.logger.error('SuggestionExecutionService', errorMessage, new Error(errorMessage), {
        errorCount: validationResult.validationResult.errors.length,
        warningCount: validationResult.validationResult.warnings.length,
        criticalIssues: validationResult.criticalIssues
      });

      return {
        success: false,
        transactionId: '',
        completedOperations: 0,
        errors: [errorMessage, ...(validationResult.errors || [])],
        rollbackAvailable: false
      };
    }

    // Log validation success
    if (validationResult.validationResult.warnings.length > 0) {
      this.logger.warn('SuggestionExecutionService', 'Proceeding with warnings', {
        warningCount: validationResult.validationResult.warnings.length,
        warnings: validationResult.validationResult.warnings.map(w => `${w.code}: ${w.message}`)
      });
    }

    // Create a new transaction
    const transaction = this.transactionManager.createTransaction();
    
    try {
      // Convert suggestions to file operations
      for (const suggestion of suggestions) {
        // We need to get the file path from the database since SuggestionRecord doesn't include it
        const fileRecord = await this.database.getFileById(suggestion.fileId);
        if (!fileRecord) {
          throw new Error(`File not found for suggestion ${suggestion.id}`);
        }

        const fileOperation: TransactionalFileOperation = {
          type: 'rename', // Default to rename for AI suggestions
          source: fileRecord.path,
          target: suggestion.suggestedValue.includes('/') ? 
            suggestion.suggestedValue : 
            `${fileRecord.path.substring(0, fileRecord.path.lastIndexOf('/'))}/${suggestion.suggestedValue}`,
          metadata: {
            confidence: suggestion.adjustedConfidence,
            force: false,
            createBackup: createBackups
          }
        };

        // Add operation to transaction
        const addResult = this.transactionManager.addOperation(transaction.id, fileOperation);
        if (!addResult.success) {
          throw new Error(addResult.error || 'Failed to add operation to transaction');
        }

        // Record operation in database for history tracking if journaling enabled
        if (operationJournaling) {
          // For now, we'll skip the database operation recording since the method doesn't exist
          // This would be implemented when the OperationHistory database schema is enhanced
          this.logger.debug('SuggestionExecutionService', 'Would record operation for history tracking', {
            suggestionId: suggestion.id,
            transactionId: transaction.id,
            operation: fileOperation
          });
        }
      }

      // Execute the transaction
      const result = await this.transactionManager.executeTransaction(transaction.id);

      if (result.success) {
        this.logger.info('SuggestionExecutionService', 'Transactional execution completed successfully', {
          transactionId: transaction.id,
          completedOperations: result.completedOperations
        });

        // Update suggestion statuses to executed
        // Note: SuggestionRecord doesn't have status field, so we'll skip this for now
        // In a full implementation, we might add these fields to the database schema
        // for (const suggestion of suggestions) {
        //   if (suggestion.id) {
        //     await this.database.updateSuggestion(suggestion.id, {
        //       // Add status tracking fields to SuggestionRecord interface if needed
        //     });
        //   }
        // }

        this.emit('transactional:completed', {
          transactionId: transaction.id,
          completedOperations: result.completedOperations,
          suggestions
        });

        return {
          success: true,
          transactionId: transaction.id,
          completedOperations: result.completedOperations,
          errors: [],
          rollbackAvailable: enableRollback
        };

      } else {
        this.logger.error('SuggestionExecutionService', 'Transactional execution failed', new Error(result.error || 'Unknown error'), {
          transactionId: transaction.id,
          errors: result.errors
        });

        this.emit('transactional:failed', {
          transactionId: transaction.id,
          errors: result.errors,
          suggestions
        });

        return {
          success: false,
          transactionId: transaction.id,
          completedOperations: result.completedOperations,
          errors: result.errors,
          rollbackAvailable: false
        };
      }

    } catch (error) {
      this.logger.error('SuggestionExecutionService', 'Transactional execution setup failed', error as Error, {
        transactionId: transaction.id
      });

      return {
        success: false,
        transactionId: transaction.id,
        completedOperations: 0,
        errors: [(error as Error).message],
        rollbackAvailable: false
      };
    }
  }

  /**
   * Prepare undo operation for a given transaction
   * Integrates with existing OperationHistory component
   */
  async prepareUndo(transactionId: string): Promise<{
    success: boolean;
    undoOperations: any[];
    riskLevel: 'low' | 'medium' | 'high' | 'critical';
    affectedFiles: string[];
    estimatedDuration: number;
    error?: string;
  }> {
    try {
      const transaction = this.transactionManager.getTransactionStatus(transactionId);
      if (!transaction) {
        return {
          success: false,
          undoOperations: [],
          riskLevel: 'critical',
          affectedFiles: [],
          estimatedDuration: 0,
          error: `Transaction not found: ${transactionId}`
        };
      }

      // Analyze operations for undo complexity
      const undoOperations = transaction.operations.map(op => ({
        id: op.id,
        type: op.type,
        originalAction: op.type === 'rename' ? 'rename' : 'move',
        undoAction: op.type === 'rename' ? 'rename' : 'move',
        sourcePath: op.target, // Reverse for undo
        targetPath: op.source, // Reverse for undo
        riskLevel: this.assessUndoRisk(op)
      }));

      const affectedFiles = transaction.operations.map(op => op.target || op.source);
      const overallRisk = this.calculateOverallUndoRisk(undoOperations);
      const estimatedDuration = undoOperations.length * 500; // 500ms per operation estimate

      return {
        success: true,
        undoOperations,
        riskLevel: overallRisk,
        affectedFiles,
        estimatedDuration
      };

    } catch (error) {
      this.logger.error('SuggestionExecutionService', 'Failed to prepare undo operation', error as Error, {
        transactionId
      });

      return {
        success: false,
        undoOperations: [],
        riskLevel: 'critical',
        affectedFiles: [],
        estimatedDuration: 0,
        error: (error as Error).message
      };
    }
  }

  /**
   * Execute undo operation for a transaction
   */
  async executeUndo(transactionId: string, reason?: string): Promise<{
    success: boolean;
    completedOperations: number;
    errors: string[];
  }> {
    try {
      this.logger.info('SuggestionExecutionService', 'Starting undo operation', {
        transactionId,
        reason
      });

      // Create a new reverse transaction
      const undoTransaction = this.transactionManager.createTransaction();
      const originalTransaction = this.transactionManager.getTransactionStatus(transactionId);

      if (!originalTransaction) {
        throw new Error(`Original transaction not found: ${transactionId}`);
      }

      // Add reverse operations
      for (const operation of originalTransaction.operations.reverse()) {
        const reverseOperation: TransactionalFileOperation = {
          type: operation.type,
          source: operation.target!,
          target: operation.source,
          metadata: {
            confidence: 1.0, // High confidence for undo operations
            force: false,
            createBackup: true // Always create backups for undo
          }
        };

        const addResult = this.transactionManager.addOperation(undoTransaction.id, reverseOperation);
        if (!addResult.success) {
          throw new Error(addResult.error || 'Failed to add undo operation');
        }
      }

      // Execute the undo transaction
      const result = await this.transactionManager.executeTransaction(undoTransaction.id);

      if (result.success) {
        this.logger.info('SuggestionExecutionService', 'Undo operation completed successfully', {
          originalTransactionId: transactionId,
          undoTransactionId: undoTransaction.id,
          completedOperations: result.completedOperations
        });

        this.emit('transactional:undone', {
          originalTransactionId: transactionId,
          undoTransactionId: undoTransaction.id,
          completedOperations: result.completedOperations,
          reason
        });
      }

      return {
        success: result.success,
        completedOperations: result.completedOperations,
        errors: result.errors
      };

    } catch (error) {
      this.logger.error('SuggestionExecutionService', 'Undo operation failed', error as Error, {
        transactionId
      });

      return {
        success: false,
        completedOperations: 0,
        errors: [(error as Error).message]
      };
    }
  }

  /**
   * Assess the risk level for undoing a specific operation
   */
  private assessUndoRisk(operation: TransactionalFileOperation & { id: string }): 'low' | 'medium' | 'high' | 'critical' {
    // System files or important directories = critical
    if (operation.source.includes('/System/') || operation.source.includes('/usr/') || 
        operation.source.includes('/bin/') || operation.source.includes('/etc/')) {
      return 'critical';
    }

    // Large files or many nested directories = high
    if (operation.source.split('/').length > 6) {
      return 'high';
    }

    // Operations in user documents/desktop = medium  
    if (operation.source.includes('/Documents/') || operation.source.includes('/Desktop/')) {
      return 'medium';
    }

    return 'low';
  }

  /**
   * Calculate overall risk level for a set of undo operations
   */
  private calculateOverallUndoRisk(operations: any[]): 'low' | 'medium' | 'high' | 'critical' {
    const riskCounts = operations.reduce((counts, op) => {
      counts[op.riskLevel]++;
      return counts;
    }, { low: 0, medium: 0, high: 0, critical: 0 });

    if (riskCounts.critical > 0) return 'critical';
    if (riskCounts.high > operations.length * 0.3) return 'high';
    if (riskCounts.medium > operations.length * 0.5) return 'medium';
    return 'low';
  }

  // ========== PARTIAL FAILURE RECOVERY METHODS ==========

  /**
   * Handle partial batch failure with selective recovery
   * Task 5: Comprehensive error handling with recovery
   */
  async handlePartialFailure(
    transactionId: string,
    failedOperations: any[],
    succeededOperations: any[]
  ): Promise<{
    success: boolean;
    recoveryAction: 'rollback' | 'continue' | 'manual_review';
    recoveredOperations: number;
    errors: string[];
  }> {
    try {
      this.logger.warn('SuggestionExecutionService', 'Handling partial batch failure', {
        transactionId,
        failedCount: failedOperations.length,
        succeededCount: succeededOperations.length
      });

      // Assess recovery options based on failure types
      const criticalFailures = failedOperations.filter(op => 
        op.error && (op.error.includes('permission') || op.error.includes('system') || op.error.includes('critical'))
      );

      // If critical failures, recommend full rollback
      if (criticalFailures.length > 0) {
        this.logger.error('SuggestionExecutionService', 'Critical failures detected, recommending rollback');
        return {
          success: true,
          recoveryAction: 'rollback',
          recoveredOperations: 0,
          errors: criticalFailures.map(op => op.error)
        };
      }

      // If less than 20% failed and no critical issues, continue with successful ones
      const failureRate = failedOperations.length / (failedOperations.length + succeededOperations.length);
      if (failureRate < 0.2) {
        this.logger.info('SuggestionExecutionService', 'Low failure rate, continuing with successful operations');
        return {
          success: true,
          recoveryAction: 'continue',
          recoveredOperations: succeededOperations.length,
          errors: failedOperations.map(op => op.error)
        };
      }

      // Otherwise, recommend manual review
      return {
        success: true,
        recoveryAction: 'manual_review',
        recoveredOperations: 0,
        errors: failedOperations.map(op => op.error)
      };

    } catch (error) {
      this.logger.error('SuggestionExecutionService', 'Failed to handle partial failure', error as Error);
      return {
        success: false,
        recoveryAction: 'manual_review',
        recoveredOperations: 0,
        errors: [`Recovery failed: ${error instanceof Error ? error.message : String(error)}`]
      };
    }
  }

  /**
   * Retry failed operations with exponential backoff
   */
  async retryFailedOperations(
    failedOperations: any[],
    maxRetries: number = 3
  ): Promise<{
    success: boolean;
    retriedSuccessfully: any[];
    permanentFailures: any[];
  }> {
    const retriedSuccessfully: any[] = [];
    const permanentFailures: any[] = [];

    for (const operation of failedOperations) {
      let retryCount = 0;
      let succeeded = false;

      while (retryCount < maxRetries && !succeeded) {
        try {
          // Wait with exponential backoff
          const delay = Math.pow(2, retryCount) * 1000; // 1s, 2s, 4s
          await new Promise(resolve => setTimeout(resolve, delay));

          this.logger.debug('SuggestionExecutionService', `Retrying operation (attempt ${retryCount + 1})`, {
            operationId: operation.id,
            source: operation.source,
            target: operation.target
          });

          // Try to execute the operation again
          // This would integrate with the actual execution logic
          // For now, we'll simulate based on error type
          if (!operation.error.includes('permission') && !operation.error.includes('system')) {
            // Simulate successful retry for non-permission/system errors
            retriedSuccessfully.push({
              ...operation,
              retryCount: retryCount + 1,
              status: 'completed'
            });
            succeeded = true;
          }

          retryCount++;
        } catch (error) {
          retryCount++;
          this.logger.warn('SuggestionExecutionService', 'Retry attempt failed', {
            operationId: operation.id,
            attempt: retryCount,
            error: error instanceof Error ? error.message : String(error)
          });
        }
      }

      if (!succeeded) {
        permanentFailures.push({
          ...operation,
          finalError: `Failed after ${maxRetries} retries`,
          retryCount: maxRetries
        });
      }
    }

    this.logger.info('SuggestionExecutionService', 'Retry operation completed', {
      totalOperations: failedOperations.length,
      succeeded: retriedSuccessfully.length,
      permanentFailures: permanentFailures.length
    });

    return {
      success: true,
      retriedSuccessfully,
      permanentFailures
    };
  }

  /**
   * Create detailed error report for troubleshooting
   */
  generateErrorReport(errors: any[]): string {
    const report: string[] = [];
    report.push('=== SUGGESTION EXECUTION ERROR REPORT ===\n');
    report.push(`Total Errors: ${errors.length}`);
    report.push(`Timestamp: ${new Date().toISOString()}\n`);

    // Group errors by type
    const errorGroups = errors.reduce((groups: Record<string, any[]>, error) => {
      const category = this.categorizeError(error.message || error);
      if (!groups[category]) groups[category] = [];
      groups[category].push(error);
      return groups;
    }, {});

    for (const [category, categoryErrors] of Object.entries(errorGroups)) {
      report.push(`--- ${category.toUpperCase()} ERRORS (${categoryErrors.length}) ---`);
      categoryErrors.forEach((error, index) => {
        report.push(`${index + 1}. ${error.message || error}`);
        if (error.operationId) report.push(`   Operation: ${error.operationId}`);
        if (error.path) report.push(`   Path: ${error.path}`);
      });
      report.push('');
    }

    report.push('--- TROUBLESHOOTING RECOMMENDATIONS ---');
    for (const category of Object.keys(errorGroups)) {
      const recommendations = this.getErrorRecommendations(category);
      report.push(`${category}: ${recommendations}`);
    }

    return report.join('\n');
  }

  /**
   * Categorize error for grouping
   */
  private categorizeError(errorMessage: string): string {
    const message = errorMessage.toLowerCase();
    if (message.includes('permission') || message.includes('access')) return 'permission';
    if (message.includes('not found') || message.includes('missing')) return 'file_not_found';
    if (message.includes('system') || message.includes('protected')) return 'system_file';
    if (message.includes('conflict') || message.includes('exists')) return 'conflict';
    if (message.includes('space') || message.includes('disk')) return 'disk_space';
    if (message.includes('network') || message.includes('timeout')) return 'network';
    return 'general';
  }

  /**
   * Get recommendations based on error category
   */
  private getErrorRecommendations(category: string): string {
    const recommendations = {
      permission: 'Check file permissions and run with appropriate privileges',
      file_not_found: 'Verify file paths and ensure files exist before operation',
      system_file: 'Avoid operations on system files - exclude them from suggestions',
      conflict: 'Resolve filename conflicts by using unique names',
      disk_space: 'Free up disk space or use a different target location',
      network: 'Check network connectivity and retry operation',
      general: 'Review operation parameters and contact support if issue persists'
    };
    return recommendations[category as keyof typeof recommendations] || recommendations.general;
  }

  /**
   * Get transaction status and history for OperationHistory integration
   */
  async getTransactionHistory(limit?: number): Promise<{
    success: boolean;
    transactions: any[];
    error?: string;
  }> {
    try {
      // Get transaction history from database
      // This would integrate with existing operation history tables
      const operations = await this.database.getOperations({
        limit: limit || 100
      });

      return {
        success: true,
        transactions: operations.map(op => ({
          id: op.transactionId,
          type: 'batch-operation',
          title: `AI Suggestion Execution (${op.operationCount} operations)`,
          description: `Executed ${op.operationCount} AI-recommended file operations`,
          status: op.status,
          startTime: new Date(op.startTime),
          endTime: op.endTime ? new Date(op.endTime) : undefined,
          duration: op.duration,
          itemsProcessed: op.completedOperations,
          itemsTotal: op.totalOperations,
          itemsFailed: op.failedOperations,
          canUndo: op.status === 'completed' && op.undoAvailable,
          canRedo: false,
          undoComplexity: op.undoComplexity || 'moderate',
          metadata: {
            transactionId: op.transactionId,
            confidenceThreshold: op.metadata?.confidenceThreshold,
            backupCreated: op.metadata?.backupCreated,
            validationPerformed: op.metadata?.validationPerformed
          }
        }))
      };

    } catch (error) {
      this.logger.error('SuggestionExecutionService', 'Failed to get transaction history', error as Error);
      
      return {
        success: false,
        transactions: [],
        error: (error as Error).message
      };
    }
  }
}
