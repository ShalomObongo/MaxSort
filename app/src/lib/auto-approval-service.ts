/**
 * Auto-approval service for confidence-based suggestion filtering
 * Integrates with SuggestionFilter and BatchOperationManager
 */

import { EventEmitter } from 'events';
import { logger, AnalysisError, AnalysisErrorType } from './logger';
import { SuggestionFilter, SuggestionFilteringResult } from './suggestion-filter';
import { BatchOperationManager, BatchOperation } from './batch-operation-manager';
import { ProcessedSuggestion } from './confidence-scorer';
import { 
  ConfidenceThresholdConfig, 
  FilteredSuggestion, 
  SuggestionCategory,
  ConfidenceStatistics 
} from './confidence-threshold-config';

/**
 * Auto-approval queue entry
 */
export interface AutoApprovalQueueEntry {
  id: string;
  filteredSuggestion: FilteredSuggestion;
  fileMetadata: {
    fileId: number;
    originalPath: string;
    targetPath: string;
    fileType: string;
    size: number;
  };
  queuedAt: number;
  priority: 'high' | 'medium' | 'low';
  safetyChecksCompleted: boolean;
}

/**
 * Auto-approval processing result
 */
export interface AutoApprovalProcessingResult {
  totalProcessed: number;
  autoApprovedCount: number;
  queuedCount: number;
  rejectedCount: number;
  batchId?: string;
  processingDuration: number;
  statistics: ConfidenceStatistics;
}

/**
 * Auto-approval configuration
 */
export interface AutoApprovalConfig {
  maxQueueSize: number;
  maxAutoApprovalsPerBatch: number;
  batchProcessingIntervalMs: number;
  enableSafetyChecks: boolean;
  requireMinimumConfidence: number; // Additional safety threshold
  enableAuditLogging: boolean;
  dangerousPathPatterns: string[]; // Custom dangerous path patterns
}

/**
 * Auto-approval events
 */
export interface AutoApprovalEvents {
  'suggestion-auto-approved': { entry: AutoApprovalQueueEntry; batchId: string };
  'suggestion-queued': { entry: AutoApprovalQueueEntry };
  'suggestion-rejected': { suggestion: ProcessedSuggestion; reason: string };
  'batch-created': { batchId: string; operationCount: number };
  'batch-completed': { batchId: string; result: any };
  'safety-check-failed': { entry: AutoApprovalQueueEntry; reason: string };
  'queue-full': { rejectedCount: number };
}

/**
 * Core auto-approval service
 */
export class AutoApprovalService extends EventEmitter {
  private readonly config: AutoApprovalConfig;
  private readonly suggestionFilter: SuggestionFilter;
  private readonly batchOperationManager: BatchOperationManager;
  private readonly autoApprovalQueue: Map<string, AutoApprovalQueueEntry> = new Map();
  private processingTimer: NodeJS.Timeout | null = null;
  private isProcessing = false;

  private static readonly DEFAULT_CONFIG: AutoApprovalConfig = {
    maxQueueSize: 100,
    maxAutoApprovalsPerBatch: 25,
    batchProcessingIntervalMs: 2000, // 2 seconds
    enableSafetyChecks: true,
    requireMinimumConfidence: 0.85, // Additional 85% confidence requirement for auto-approval
    enableAuditLogging: true,
    dangerousPathPatterns: [
      '/System/**',
      '/usr/bin/**',
      '/Library/**',
      '*.app/**',
      '**/node_modules/**',
      '**/.git/**',
      '*.config.*',
      '*.env*',
      'package.json',
      'package-lock.json'
    ],
  };

  // Dangerous file operations that should never be auto-approved
  private static readonly NEVER_AUTO_APPROVE_OPERATIONS = [
    'delete', // Never auto-approve deletions
  ];

  constructor(
    suggestionFilter: SuggestionFilter,
    batchOperationManager: BatchOperationManager,
    config: Partial<AutoApprovalConfig> = {}
  ) {
    super();

    this.suggestionFilter = suggestionFilter;
    this.batchOperationManager = batchOperationManager;
    this.config = { ...AutoApprovalService.DEFAULT_CONFIG, ...config };

    this.startProcessingTimer();
    
    logger.info('AutoApprovalService', 'Auto-approval service initialized', {
      maxQueueSize: this.config.maxQueueSize,
      maxAutoApprovalsPerBatch: this.config.maxAutoApprovalsPerBatch,
      processingInterval: this.config.batchProcessingIntervalMs,
      safetyChecksEnabled: this.config.enableSafetyChecks
    });
  }

  /**
   * Process suggestions through auto-approval pipeline
   */
  public async processSuggestions(
    suggestions: ProcessedSuggestion[],
    fileMetadataMap: Map<string, any>
  ): Promise<AutoApprovalProcessingResult> {
    const timerId = logger.startPerformanceTimer('AutoApprovalService.processSuggestions');
    const startTime = Date.now();

    logger.info('AutoApprovalService', `Processing ${suggestions.length} suggestions for auto-approval`, {
      currentQueueSize: this.autoApprovalQueue.size,
      maxQueueSize: this.config.maxQueueSize
    });

    try {
      // Filter suggestions using the confidence-based filter
      const filteringResult = await this.suggestionFilter.filterSuggestions(suggestions, {
        enableSafetyChecks: this.config.enableSafetyChecks,
        maxAutoApproveCount: this.config.maxAutoApprovalsPerBatch,
        includeReasoning: true,
      });

      let autoApprovedCount = 0;
      let queuedCount = 0;
      let rejectedCount = 0;

      // Process each filtered suggestion
      for (const filteredSuggestion of filteringResult.filteredSuggestions) {
        const metadata = fileMetadataMap.get(filteredSuggestion.originalSuggestion.value);
        
        if (!metadata) {
          logger.warn('AutoApprovalService', 'No metadata found for suggestion', {
            suggestion: filteredSuggestion.originalSuggestion.value
          });
          rejectedCount++;
          continue;
        }

        if (filteredSuggestion.category === SuggestionCategory.AUTO_APPROVE) {
          const result = await this.processAutoApprovedSuggestion(filteredSuggestion, metadata);
          if (result === 'queued') {
            queuedCount++;
          } else if (result === 'approved') {
            autoApprovedCount++;
          } else {
            rejectedCount++;
          }
        } else {
          // Not auto-approved - emit event for manual processing
          this.emit('suggestion-rejected', { 
            suggestion: filteredSuggestion.originalSuggestion, 
            reason: filteredSuggestion.reason 
          });
          rejectedCount++;
        }
      }

      const processingDuration = Date.now() - startTime;

      // Trigger immediate batch processing if queue is full
      if (this.shouldTriggerImmediateProcessing()) {
        await this.processQueuedOperations();
      }

      const result: AutoApprovalProcessingResult = {
        totalProcessed: suggestions.length,
        autoApprovedCount,
        queuedCount,
        rejectedCount,
        processingDuration,
        statistics: filteringResult.statistics,
      };

      logger.info('AutoApprovalService', 'Completed suggestion processing', {
        ...result,
        queueSize: this.autoApprovalQueue.size
      });

      return result;

    } catch (error) {
      const analysisError = new AnalysisError(
        AnalysisErrorType.VALIDATION_ERROR,
        `Failed to process suggestions for auto-approval: ${(error as Error).message}`,
        {
          stage: 'auto-approval-processing',
          recoverable: true,
          cause: error as Error
        }
      );

      logger.error('AutoApprovalService', 'Critical error during suggestion processing', analysisError, {
        suggestionsCount: suggestions.length,
        queueSize: this.autoApprovalQueue.size
      });

      throw analysisError;
    } finally {
      logger.endPerformanceTimer(timerId, 'AutoApprovalService', 'processSuggestions');
    }
  }

  /**
   * Get current auto-approval queue status
   */
  public getQueueStatus(): {
    queueSize: number;
    maxQueueSize: number;
    queuedEntries: AutoApprovalQueueEntry[];
    isProcessing: boolean;
  } {
    return {
      queueSize: this.autoApprovalQueue.size,
      maxQueueSize: this.config.maxQueueSize,
      queuedEntries: Array.from(this.autoApprovalQueue.values()),
      isProcessing: this.isProcessing,
    };
  }

  /**
   * Update auto-approval configuration
   */
  public updateConfig(updates: Partial<AutoApprovalConfig>): void {
    Object.assign(this.config, updates);
    
    logger.info('AutoApprovalService', 'Configuration updated', updates);
    
    // Restart processing timer if interval changed
    if (updates.batchProcessingIntervalMs !== undefined) {
      this.stopProcessingTimer();
      this.startProcessingTimer();
    }
  }

  /**
   * Force immediate processing of queued operations
   */
  public async forceProcessQueue(): Promise<string | null> {
    return await this.processQueuedOperations();
  }

  /**
   * Clear the auto-approval queue
   */
  public clearQueue(): number {
    const clearedCount = this.autoApprovalQueue.size;
    this.autoApprovalQueue.clear();
    
    logger.info('AutoAprovalService', 'Queue cleared', { clearedCount });
    return clearedCount;
  }

  /**
   * Shutdown the auto-approval service
   */
  public shutdown(): void {
    this.stopProcessingTimer();
    this.clearQueue();
    this.removeAllListeners();
    
    logger.info('AutoApprovalService', 'Service shutdown completed');
  }

  /**
   * Process an auto-approved suggestion
   */
  private async processAutoApprovedSuggestion(
    filteredSuggestion: FilteredSuggestion,
    metadata: any
  ): Promise<'queued' | 'approved' | 'rejected'> {
    // Additional safety checks beyond the SuggestionFilter
    const additionalSafetyResult = this.performAdditionalSafetyChecks(filteredSuggestion, metadata);
    
    if (!additionalSafetyResult.isSafe) {
      logger.warn('AutoApprovalService', 'Rejecting suggestion due to additional safety checks', {
        suggestion: filteredSuggestion.originalSuggestion.value,
        reason: additionalSafetyResult.reason,
        originalPath: metadata.originalPath
      });

      this.emit('safety-check-failed', { 
        entry: this.createQueueEntry(filteredSuggestion, metadata),
        reason: additionalSafetyResult.reason 
      });

      return 'rejected';
    }

    // Check if queue has space
    if (this.autoApprovalQueue.size >= this.config.maxQueueSize) {
      logger.warn('AutoApprovalService', 'Auto-approval queue is full, rejecting suggestion', {
        suggestion: filteredSuggestion.originalSuggestion.value,
        queueSize: this.autoApprovalQueue.size,
        maxQueueSize: this.config.maxQueueSize
      });

      this.emit('queue-full', { rejectedCount: 1 });
      return 'rejected';
    }

    // Create queue entry
    const queueEntry = this.createQueueEntry(filteredSuggestion, metadata);
    queueEntry.safetyChecksCompleted = true;

    // Add to queue
    this.autoApprovalQueue.set(queueEntry.id, queueEntry);

    this.emit('suggestion-queued', { entry: queueEntry });

    if (this.config.enableAuditLogging) {
      logger.info('AutoApprovalService', 'Suggestion queued for auto-approval', {
        queueEntryId: queueEntry.id,
        suggestion: filteredSuggestion.originalSuggestion.value,
        confidence: filteredSuggestion.originalSuggestion.adjustedConfidence,
        originalPath: metadata.originalPath,
        targetPath: metadata.targetPath,
        priority: queueEntry.priority
      });
    }

    return 'queued';
  }

  /**
   * Perform additional safety checks beyond SuggestionFilter
   */
  private performAdditionalSafetyChecks(
    filteredSuggestion: FilteredSuggestion,
    metadata: any
  ): { isSafe: boolean; reason?: string } {
    const suggestion = filteredSuggestion.originalSuggestion;
    const { originalPath, targetPath, fileType } = metadata;

    // Check minimum confidence requirement
    const confidencePercent = suggestion.adjustedConfidence / 100;
    if (confidencePercent < this.config.requireMinimumConfidence) {
      return {
        isSafe: false,
        reason: `Confidence ${Math.round(confidencePercent * 100)}% below required ${Math.round(this.config.requireMinimumConfidence * 100)}%`
      };
    }

    // Check for dangerous operations
    if (AutoApprovalService.NEVER_AUTO_APPROVE_OPERATIONS.includes(metadata.operationType)) {
      return {
        isSafe: false,
        reason: `Operation type '${metadata.operationType}' is never auto-approved`
      };
    }

    // Check against dangerous path patterns
    for (const pattern of this.config.dangerousPathPatterns) {
      // Convert glob pattern to regex - escape special characters properly
      const regexPattern = pattern
        .replace(/\*\*/g, '___DOUBLESTAR___')  // Temporarily replace **
        .replace(/\*/g, '[^/]*')               // Replace single * with [^/]*
        .replace(/___DOUBLESTAR___/g, '.*')    // Replace ** with .*
        .replace(/\./g, '\\.')                 // Escape dots
        .replace(/\//g, '\\/')                 // Escape forward slashes
        .replace(/\(/g, '\\(')                 // Escape parentheses
        .replace(/\)/g, '\\)');                // Escape parentheses
      
      try {
        const regex = new RegExp(regexPattern, 'i');
        if (regex.test(originalPath) || regex.test(targetPath)) {
          return {
            isSafe: false,
            reason: `Path matches dangerous pattern: ${pattern}`
          };
        }
      } catch (regexError) {
        // If regex is invalid, log warning and skip this pattern
        logger.warn('AutoApprovalService', 'Invalid dangerous path pattern', {
          pattern,
          regexPattern,
          error: (regexError as Error).message
        });
      }
    }

    // Check for system directories (additional check)
    const systemPaths = ['/System', '/usr', '/Library', '/Applications'];
    if (systemPaths.some(sysPath => originalPath.startsWith(sysPath) || targetPath.startsWith(sysPath))) {
      return {
        isSafe: false,
        reason: 'Operation involves system directories'
      };
    }

    // Check for configuration files
    const configExtensions = ['.config', '.conf', '.cfg', '.ini', '.env', '.plist'];
    if (configExtensions.some(ext => originalPath.endsWith(ext) || targetPath.endsWith(ext))) {
      return {
        isSafe: false,
        reason: 'Operation involves configuration files'
      };
    }

    return { isSafe: true };
  }

  /**
   * Create queue entry from filtered suggestion and metadata
   */
  private createQueueEntry(
    filteredSuggestion: FilteredSuggestion,
    metadata: any
  ): AutoApprovalQueueEntry {
    const priority = this.determinePriority(filteredSuggestion);

    return {
      id: this.generateQueueEntryId(),
      filteredSuggestion,
      fileMetadata: {
        fileId: metadata.fileId,
        originalPath: metadata.originalPath,
        targetPath: metadata.targetPath,
        fileType: metadata.fileType,
        size: metadata.size,
      },
      queuedAt: Date.now(),
      priority,
      safetyChecksCompleted: false,
    };
  }

  /**
   * Determine priority for queue entry
   */
  private determinePriority(filteredSuggestion: FilteredSuggestion): 'high' | 'medium' | 'low' {
    const confidence = filteredSuggestion.originalSuggestion.adjustedConfidence;
    
    if (confidence >= 95) {
      return 'high';
    } else if (confidence >= 85) {
      return 'medium';
    } else {
      return 'low';
    }
  }

  /**
   * Check if immediate processing should be triggered
   */
  private shouldTriggerImmediateProcessing(): boolean {
    return (
      this.autoApprovalQueue.size >= this.config.maxAutoApprovalsPerBatch ||
      this.autoApprovalQueue.size >= this.config.maxQueueSize * 0.8 // 80% of max queue size
    );
  }

  /**
   * Process queued operations by creating batch
   */
  private async processQueuedOperations(): Promise<string | null> {
    if (this.isProcessing || this.autoApprovalQueue.size === 0) {
      return null;
    }

    this.isProcessing = true;
    const timerId = logger.startPerformanceTimer('AutoApprovalService.processQueuedOperations');

    try {
      // Get operations to process (up to max batch size)
      const entriesToProcess = Array.from(this.autoApprovalQueue.values())
        .slice(0, this.config.maxAutoApprovalsPerBatch);

      if (entriesToProcess.length === 0) {
        return null;
      }

      // Convert to batch operations
      const batchOperations: Omit<BatchOperation, 'id' | 'status' | 'createdAt'>[] = 
        entriesToProcess.map(entry => ({
          type: 'rename', // Auto-approvals are typically rename operations
          fileId: entry.fileMetadata.fileId,
          originalPath: entry.fileMetadata.originalPath,
          targetPath: entry.fileMetadata.targetPath,
          confidence: entry.filteredSuggestion.originalSuggestion.adjustedConfidence,
          priority: entry.priority,
        }));

      // Add operations to batch manager
      const operationIds = batchOperations.map(op => this.batchOperationManager.addOperation(op));
      
      // Create batch
      const batchId = this.batchOperationManager.createBatch(operationIds, 'background');

      // Remove processed entries from queue
      entriesToProcess.forEach(entry => {
        this.autoApprovalQueue.delete(entry.id);
        this.emit('suggestion-auto-approved', { entry, batchId });
      });

      this.emit('batch-created', { batchId, operationCount: entriesToProcess.length });

      logger.info('AutoApprovalService', 'Created auto-approval batch', {
        batchId,
        operationCount: entriesToProcess.length,
        remainingQueueSize: this.autoApprovalQueue.size
      });

      return batchId;

    } catch (error) {
      logger.error('AutoApprovalService', 'Failed to process queued operations', error as Error, {
        queueSize: this.autoApprovalQueue.size
      });
      return null;
    } finally {
      this.isProcessing = false;
      logger.endPerformanceTimer(timerId, 'AutoApprovalService', 'processQueuedOperations');
    }
  }

  /**
   * Start automatic processing timer
   */
  private startProcessingTimer(): void {
    this.processingTimer = setInterval(async () => {
      await this.processQueuedOperations();
    }, this.config.batchProcessingIntervalMs);
  }

  /**
   * Stop automatic processing timer
   */
  private stopProcessingTimer(): void {
    if (this.processingTimer) {
      clearInterval(this.processingTimer);
      this.processingTimer = null;
    }
  }

  /**
   * Generate unique queue entry ID
   */
  private generateQueueEntryId(): string {
    return `auto-approval-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
}

/**
 * Factory function to create AutoApprovalService
 */
export function createAutoApprovalService(
  suggestionFilter: SuggestionFilter,
  batchOperationManager: BatchOperationManager,
  config?: Partial<AutoApprovalConfig>
): AutoApprovalService {
  return new AutoApprovalService(suggestionFilter, batchOperationManager, config);
}
