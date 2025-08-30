/**
 * Confidence-based suggestion filtering service
 * Integrates with ConfidenceScorer to apply threshold-based filtering
 */

import { logger, AnalysisError, AnalysisErrorType } from './logger';
import { ProcessedSuggestion, getConfidenceScorer } from './confidence-scorer';
import { 
  ConfidenceThresholdConfig, 
  SuggestionCategory, 
  FilteredSuggestion,
  ConfidenceStatistics,
  ConfidenceThresholdValidator,
  CONFIDENCE_CONFIG_CONSTANTS
} from './confidence-threshold-config';

/**
 * Interface for filtering results
 */
export interface SuggestionFilteringResult {
  filteredSuggestions: FilteredSuggestion[];
  statistics: ConfidenceStatistics;
  totalProcessed: number;
  filteringDuration: number; // milliseconds
}

/**
 * Interface for batch filtering options
 */
export interface BatchFilteringOptions {
  preserveOriginalOrder: boolean;
  includeReasoning: boolean;
  enableSafetyChecks: boolean;
  maxAutoApproveCount?: number; // Limit auto-approved suggestions per batch
}

/**
 * Safety check result for dangerous operations
 */
interface SafetyCheckResult {
  isSafe: boolean;
  reason?: string;
  riskLevel: 'low' | 'medium' | 'high';
}

/**
 * Core suggestion filtering service
 */
export class SuggestionFilter {
  private config!: ConfidenceThresholdConfig;
  private readonly defaultBatchOptions: BatchFilteringOptions = {
    preserveOriginalOrder: false,
    includeReasoning: true,
    enableSafetyChecks: true,
    maxAutoApproveCount: undefined,
  };

  // Dangerous file patterns that should not be auto-approved
  private static readonly DANGEROUS_PATTERNS = [
    /^\/System\//i,                    // macOS system files
    /^\/usr\/bin\//i,                  // Unix system binaries
    /^\/Library\//i,                   // macOS Library
    /\.app\//i,                        // macOS applications
    /\.framework\//i,                  // macOS frameworks
    /node_modules/i,                   // Node.js dependencies
    /\.git\//i,                        // Git repository files
    /\.env/i,                          // Environment files
    /config/i,                         // Configuration files
    /package\.json$/i,                 // Package configuration
    /\.(exe|dll|sys|bat|cmd|sh)$/i,    // Executable files
  ];

  // File types that require extra caution
  private static readonly CAUTION_PATTERNS = [
    /\.(js|ts|py|php|rb|java|cpp|c)$/i, // Source code files
    /\.(sql|db|sqlite)$/i,              // Database files
    /\.(key|pem|crt|cert)$/i,           // Security certificates
    /\.(zip|rar|tar|7z)$/i,             // Archive files
  ];

  constructor(config: ConfidenceThresholdConfig) {
    this.updateConfig(config);
  }

  /**
   * Update filtering configuration
   */
  public updateConfig(config: ConfidenceThresholdConfig): void {
    const validation = ConfidenceThresholdValidator.validateConfig(config);
    if (!validation.isValid) {
      throw new AnalysisError(
        AnalysisErrorType.VALIDATION_ERROR,
        `Invalid confidence threshold configuration: ${validation.errors.join(', ')}`,
        { recoverable: false }
      );
    }
    this.config = config;
  }

  /**
   * Filter a batch of processed suggestions based on confidence thresholds
   */
  public async filterSuggestions(
    suggestions: ProcessedSuggestion[],
    options: Partial<BatchFilteringOptions> = {}
  ): Promise<SuggestionFilteringResult> {
    const timerId = logger.startPerformanceTimer('SuggestionFilter.filterSuggestions');
    const startTime = Date.now();
    
    logger.info('SuggestionFilter', `Filtering ${suggestions.length} suggestions`, {
      configProfile: this.config.profile.name,
      effectiveThreshold: ConfidenceThresholdValidator.getEffectiveThreshold(this.config),
      autoApproveEnabled: this.config.autoApprove,
      optionsProvided: Object.keys(options).length
    });

    try {
      const mergedOptions = { ...this.defaultBatchOptions, ...options };
      
      if (suggestions.length === 0) {
        logger.warn('SuggestionFilter', 'No suggestions provided for filtering');
        return {
          filteredSuggestions: [],
          statistics: this.createEmptyStatistics(),
          totalProcessed: 0,
          filteringDuration: 0,
        };
      }

      // Validate input suggestions
      const validatedSuggestions = this.validateSuggestions(suggestions);
      
      if (validatedSuggestions.length !== suggestions.length) {
        logger.info('SuggestionFilter', `Filtered out ${suggestions.length - validatedSuggestions.length} invalid suggestions`, {
          originalCount: suggestions.length,
          validCount: validatedSuggestions.length
        });
      }

      // Apply confidence-based filtering
      const filteredSuggestions = await this.applyCategoryFiltering(validatedSuggestions, mergedOptions);
      
      // Apply safety checks if enabled
      if (mergedOptions.enableSafetyChecks) {
        await this.applySafetyChecks(filteredSuggestions);
      }
      
      // Apply auto-approve limits if specified
      if (mergedOptions.maxAutoApproveCount) {
        this.applyAutoApproveLimits(filteredSuggestions, mergedOptions.maxAutoApproveCount);
      }

      // Preserve original order if requested
      if (mergedOptions.preserveOriginalOrder) {
        this.preserveOriginalOrder(filteredSuggestions, suggestions);
      }

      // Calculate statistics
      const statistics = this.calculateStatistics(filteredSuggestions);
      
      const filteringDuration = Date.now() - startTime;
      
      logger.info('SuggestionFilter', `Successfully filtered suggestions`, {
        totalProcessed: validatedSuggestions.length,
        autoApproved: statistics.autoApproved,
        manualReview: statistics.manualReview,
        rejected: statistics.rejected,
        filteringDuration,
        averageConfidence: statistics.averageConfidence
      });

      return {
        filteredSuggestions,
        statistics,
        totalProcessed: validatedSuggestions.length,
        filteringDuration,
      };

    } catch (error) {
      const analysisError = new AnalysisError(
        AnalysisErrorType.VALIDATION_ERROR,
        `Failed to filter suggestions: ${(error as Error).message}`,
        {
          stage: 'suggestion-filtering',
          recoverable: true,
          cause: error as Error
        }
      );
      
      logger.error('SuggestionFilter', 'Critical error during suggestion filtering', analysisError, {
        suggestionsCount: suggestions.length,
        configProfile: this.config.profile.name
      });
      
      throw analysisError;
    } finally {
      logger.endPerformanceTimer(timerId, 'SuggestionFilter', 'filterSuggestions');
    }
  }

  /**
   * Filter a single suggestion (useful for real-time filtering)
   */
  public filterSingleSuggestion(
    suggestion: ProcessedSuggestion,
    enableSafetyChecks: boolean = true
  ): FilteredSuggestion {
    const category = this.categorizeSuggestion(suggestion);
    const safetyCheck = enableSafetyChecks ? this.performSafetyCheck(suggestion) : { isSafe: true, riskLevel: 'low' as const };
    
    // Override to reject if safety check fails
    const finalCategory = !safetyCheck.isSafe && category === SuggestionCategory.AUTO_APPROVE 
      ? SuggestionCategory.MANUAL_REVIEW 
      : category;
    
    const reason = this.generateCategorizationReason(suggestion, finalCategory, safetyCheck);
    
    return {
      originalSuggestion: suggestion,
      category: finalCategory,
      reason,
      canOverride: this.config.enableManualOverride && finalCategory !== SuggestionCategory.REJECT,
    };
  }

  /**
   * Get current filtering configuration
   */
  public getConfig(): ConfidenceThresholdConfig {
    return { ...this.config };
  }

  /**
   * Validate suggestions before processing
   */
  private validateSuggestions(suggestions: ProcessedSuggestion[]): ProcessedSuggestion[] {
    return suggestions.filter(suggestion => {
      // Basic validation
      if (!suggestion.value || suggestion.value.trim().length === 0) {
        logger.warn('SuggestionFilter', 'Skipping suggestion with empty value', { suggestion });
        return false;
      }
      
      if (typeof suggestion.adjustedConfidence !== 'number' || 
          suggestion.adjustedConfidence < 0 || 
          suggestion.adjustedConfidence > 100) {
        logger.warn('SuggestionFilter', 'Skipping suggestion with invalid confidence', { 
          suggestion: suggestion.value,
          confidence: suggestion.adjustedConfidence 
        });
        return false;
      }
      
      return true;
    });
  }

  /**
   * Apply confidence-based categorization to suggestions
   */
  private async applyCategoryFiltering(
    suggestions: ProcessedSuggestion[],
    options: BatchFilteringOptions
  ): Promise<FilteredSuggestion[]> {
    return suggestions.map(suggestion => {
      const category = this.categorizeSuggestion(suggestion);
      const reason = options.includeReasoning 
        ? this.generateCategorizationReason(suggestion, category)
        : '';
      
      return {
        originalSuggestion: suggestion,
        category,
        reason,
        canOverride: this.config.enableManualOverride && category !== SuggestionCategory.REJECT,
      };
    });
  }

  /**
   * Categorize a single suggestion based on confidence threshold
   */
  private categorizeSuggestion(suggestion: ProcessedSuggestion): SuggestionCategory {
    if (!this.config.autoApprove) {
      // If auto-approve is disabled, everything goes to manual review except rejected items
      const confidencePercent = suggestion.adjustedConfidence / 100;
      return confidencePercent >= CONFIDENCE_CONFIG_CONSTANTS.MIN_MANUAL_REVIEW_THRESHOLD
        ? SuggestionCategory.MANUAL_REVIEW
        : SuggestionCategory.REJECT;
    }

    const effectiveThreshold = ConfidenceThresholdValidator.getEffectiveThreshold(this.config);
    const confidencePercent = suggestion.adjustedConfidence / 100;

    if (confidencePercent >= effectiveThreshold) {
      return SuggestionCategory.AUTO_APPROVE;
    } else if (confidencePercent >= CONFIDENCE_CONFIG_CONSTANTS.MIN_MANUAL_REVIEW_THRESHOLD) {
      return SuggestionCategory.MANUAL_REVIEW;
    } else {
      return SuggestionCategory.REJECT;
    }
  }

  /**
   * Generate human-readable reason for categorization
   */
  private generateCategorizationReason(
    suggestion: ProcessedSuggestion,
    category: SuggestionCategory,
    safetyCheck?: SafetyCheckResult
  ): string {
    const confidence = Math.round(suggestion.adjustedConfidence);
    const effectiveThreshold = Math.round(ConfidenceThresholdValidator.getEffectiveThreshold(this.config) * 100);
    
    switch (category) {
      case SuggestionCategory.AUTO_APPROVE:
        let reason = `High confidence (${confidence}% ≥ ${effectiveThreshold}%)`;
        if (safetyCheck && safetyCheck.riskLevel === 'medium') {
          reason += ', passed safety checks';
        }
        return reason;
        
      case SuggestionCategory.MANUAL_REVIEW:
        if (!this.config.autoApprove) {
          return `Auto-approval disabled, requires manual review (${confidence}%)`;
        }
        if (safetyCheck && !safetyCheck.isSafe) {
          return `Safety concern: ${safetyCheck.reason} (${confidence}%)`;
        }
        return `Medium confidence (${confidence}% < ${effectiveThreshold}%), requires review`;
        
      case SuggestionCategory.REJECT:
        const minReviewThreshold = Math.round(CONFIDENCE_CONFIG_CONSTANTS.MIN_MANUAL_REVIEW_THRESHOLD * 100);
        return `Low confidence (${confidence}% < ${minReviewThreshold}%), automatically rejected`;
        
      default:
        return 'Unknown categorization';
    }
  }

  /**
   * Apply safety checks to filtered suggestions
   */
  private async applySafetyChecks(filteredSuggestions: FilteredSuggestion[]): Promise<void> {
    const autoApprovedSuggestions = filteredSuggestions.filter(fs => 
      fs.category === SuggestionCategory.AUTO_APPROVE
    );
    
    for (const filteredSuggestion of autoApprovedSuggestions) {
      const safetyCheck = this.performSafetyCheck(filteredSuggestion.originalSuggestion);
      
      if (!safetyCheck.isSafe) {
        // Downgrade to manual review
        filteredSuggestion.category = SuggestionCategory.MANUAL_REVIEW;
        filteredSuggestion.reason = this.generateCategorizationReason(
          filteredSuggestion.originalSuggestion,
          SuggestionCategory.MANUAL_REVIEW,
          safetyCheck
        );
        
        logger.info('SuggestionFilter', 'Downgraded auto-approved suggestion due to safety concerns', {
          suggestion: filteredSuggestion.originalSuggestion.value,
          safetyReason: safetyCheck.reason,
          riskLevel: safetyCheck.riskLevel
        });
      }
    }
  }

  /**
   * Perform safety check on a suggestion
   */
  private performSafetyCheck(suggestion: ProcessedSuggestion): SafetyCheckResult {
    const value = suggestion.value.toLowerCase();
    const originalFilePath = (suggestion as any).originalFilePath || '';
    
    // Check for dangerous patterns
    for (const pattern of SuggestionFilter.DANGEROUS_PATTERNS) {
      if (pattern.test(value) || pattern.test(originalFilePath)) {
        return {
          isSafe: false,
          reason: 'Contains system or critical file patterns',
          riskLevel: 'high',
        };
      }
    }
    
    // Check for caution patterns
    for (const pattern of SuggestionFilter.CAUTION_PATTERNS) {
      if (pattern.test(value)) {
        return {
          isSafe: true, // Not blocking, but flagged
          reason: 'Contains potentially sensitive file type',
          riskLevel: 'medium',
        };
      }
    }
    
    // Check for validation flags indicating problems
    const problematicFlags = suggestion.validationFlags.filter(flag => 
      flag.includes('bad-') || flag.includes('error') || flag.includes('invalid')
    );
    
    if (problematicFlags.length > 2) {
      return {
        isSafe: false,
        reason: `Multiple validation issues: ${problematicFlags.slice(0, 2).join(', ')}`,
        riskLevel: 'medium',
      };
    }
    
    return {
      isSafe: true,
      riskLevel: 'low',
    };
  }

  /**
   * Apply limits to auto-approved suggestions
   */
  private applyAutoApproveLimits(filteredSuggestions: FilteredSuggestion[], maxCount: number): void {
    const autoApprovedSuggestions = filteredSuggestions.filter(fs => 
      fs.category === SuggestionCategory.AUTO_APPROVE
    );
    
    if (autoApprovedSuggestions.length > maxCount) {
      // Sort by confidence and keep only the top N
      autoApprovedSuggestions
        .sort((a, b) => b.originalSuggestion.adjustedConfidence - a.originalSuggestion.adjustedConfidence)
        .slice(maxCount)
        .forEach(fs => {
          fs.category = SuggestionCategory.MANUAL_REVIEW;
          fs.reason = `Exceeded auto-approve limit (${maxCount}), moved to manual review`;
        });
      
      logger.info('SuggestionFilter', `Applied auto-approve limit, downgraded ${autoApprovedSuggestions.length - maxCount} suggestions`, {
        limit: maxCount,
        originalAutoApproved: autoApprovedSuggestions.length
      });
    }
  }

  /**
   * Preserve original order of suggestions
   */
  private preserveOriginalOrder(
    filteredSuggestions: FilteredSuggestion[],
    originalSuggestions: ProcessedSuggestion[]
  ): void {
    const orderMap = new Map();
    originalSuggestions.forEach((suggestion, index) => {
      orderMap.set(suggestion, index);
    });
    
    filteredSuggestions.sort((a, b) => {
      const indexA = orderMap.get(a.originalSuggestion) ?? 0;
      const indexB = orderMap.get(b.originalSuggestion) ?? 0;
      return indexA - indexB;
    });
  }

  /**
   * Calculate statistics for filtered suggestions
   */
  private calculateStatistics(filteredSuggestions: FilteredSuggestion[]): ConfidenceStatistics {
    const total = filteredSuggestions.length;
    
    if (total === 0) {
      return this.createEmptyStatistics();
    }
    
    const autoApproved = filteredSuggestions.filter(fs => fs.category === SuggestionCategory.AUTO_APPROVE).length;
    const manualReview = filteredSuggestions.filter(fs => fs.category === SuggestionCategory.MANUAL_REVIEW).length;
    const rejected = filteredSuggestions.filter(fs => fs.category === SuggestionCategory.REJECT).length;
    
    const totalConfidence = filteredSuggestions.reduce((sum, fs) => 
      sum + (fs.originalSuggestion.adjustedConfidence / 100), 0
    );
    const averageConfidence = totalConfidence / total;
    
    // Calculate filtering effectiveness (percentage not needing manual review)
    const filteringEffectiveness = ((autoApproved + rejected) / total) * 100;
    
    // Create confidence distribution buckets
    const confidenceDistribution = this.createConfidenceDistribution(filteredSuggestions);
    
    return {
      totalSuggestions: total,
      autoApproved,
      manualReview,
      rejected,
      averageConfidence: Math.round(averageConfidence * 100) / 100,
      filteringEffectiveness: Math.round(filteringEffectiveness),
      confidenceDistribution,
    };
  }

  /**
   * Create confidence distribution buckets
   */
  private createConfidenceDistribution(filteredSuggestions: FilteredSuggestion[]) {
    const buckets = [
      { range: '90-100%', count: 0 },
      { range: '80-89%', count: 0 },
      { range: '70-79%', count: 0 },
      { range: '60-69%', count: 0 },
      { range: '50-59%', count: 0 },
      { range: '40-49%', count: 0 },
      { range: '30-39%', count: 0 },
      { range: '20-29%', count: 0 },
      { range: '10-19%', count: 0 },
      { range: '0-9%', count: 0 },
    ];
    
    filteredSuggestions.forEach(fs => {
      const confidencePercent = fs.originalSuggestion.adjustedConfidence;
      if (confidencePercent >= 90) buckets[0].count++;
      else if (confidencePercent >= 80) buckets[1].count++;
      else if (confidencePercent >= 70) buckets[2].count++;
      else if (confidencePercent >= 60) buckets[3].count++;
      else if (confidencePercent >= 50) buckets[4].count++;
      else if (confidencePercent >= 40) buckets[5].count++;
      else if (confidencePercent >= 30) buckets[6].count++;
      else if (confidencePercent >= 20) buckets[7].count++;
      else if (confidencePercent >= 10) buckets[8].count++;
      else buckets[9].count++;
    });
    
    return buckets.filter(bucket => bucket.count > 0);
  }

  /**
   * Create empty statistics object
   */
  private createEmptyStatistics(): ConfidenceStatistics {
    return {
      totalSuggestions: 0,
      autoApproved: 0,
      manualReview: 0,
      rejected: 0,
      averageConfidence: 0,
      filteringEffectiveness: 0,
      confidenceDistribution: [],
    };
  }
}

/**
 * Factory function to create SuggestionFilter with default configuration
 */
export function createSuggestionFilter(config: ConfidenceThresholdConfig): SuggestionFilter {
  return new SuggestionFilter(config);
}

/**
 * Singleton instance management
 */
let filterInstance: SuggestionFilter | null = null;

export function getSuggestionFilter(config?: ConfidenceThresholdConfig): SuggestionFilter {
  if (!filterInstance && config) {
    filterInstance = new SuggestionFilter(config);
  } else if (filterInstance && config) {
    filterInstance.updateConfig(config);
  }
  
  if (!filterInstance) {
    throw new AnalysisError(
      AnalysisErrorType.VALIDATION_ERROR,
      'SuggestionFilter not initialized. Provide configuration on first call.',
      { stage: 'initialization', recoverable: false }
    );
  }
  
  return filterInstance;
}

export function destroySuggestionFilter(): void {
  filterInstance = null;
}
