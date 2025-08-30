/**
 * Confidence threshold configuration system for AI suggestion filtering
 */

export interface ConfidenceThresholdConfig {
  profile: ConfidenceProfile;
  customThreshold?: number; // Only used when profile is 'custom'
  autoApprove: boolean;
  enableBatchMode: boolean;
  enableManualOverride: boolean;
  enableStatistics: boolean;
}

export interface ConfidenceProfile {
  name: string;
  threshold: number; // 0.0 to 1.0
  description: string;
  isCustom: boolean;
}

/**
 * Predefined confidence profiles
 */
export const CONFIDENCE_PROFILES: Record<string, ConfidenceProfile> = {
  conservative: {
    name: 'Conservative',
    threshold: 0.90,
    description: 'Only highest confidence suggestions (90%+) are auto-approved. Maximum safety.',
    isCustom: false,
  },
  balanced: {
    name: 'Balanced',
    threshold: 0.80,
    description: 'Good confidence suggestions (80%+) are auto-approved. Balanced efficiency and safety.',
    isCustom: false,
  },
  aggressive: {
    name: 'Aggressive',
    threshold: 0.70,
    description: 'Moderate confidence suggestions (70%+) are auto-approved. Maximum efficiency.',
    isCustom: false,
  },
  custom: {
    name: 'Custom',
    threshold: 0.80, // Default, overridden by customThreshold
    description: 'User-defined threshold between 10% and 100%.',
    isCustom: true,
  },
};

/**
 * Suggestion processing categories based on confidence thresholds
 */
export enum SuggestionCategory {
  AUTO_APPROVE = 'auto-approve',
  MANUAL_REVIEW = 'manual-review', 
  REJECT = 'reject',
}

/**
 * Filtered suggestion with category assignment
 */
export interface FilteredSuggestion {
  originalSuggestion: any; // ProcessedSuggestion from ConfidenceScorer
  category: SuggestionCategory;
  reason: string; // Explanation for the categorization
  canOverride: boolean; // Whether user can manually override the category
}

/**
 * Confidence filtering statistics
 */
export interface ConfidenceStatistics {
  totalSuggestions: number;
  autoApproved: number;
  manualReview: number;
  rejected: number;
  averageConfidence: number;
  filteringEffectiveness: number; // Percentage of suggestions that don't need manual review
  confidenceDistribution: {
    range: string; // e.g., "80-90%"
    count: number;
  }[];
}

/**
 * Configuration defaults and validation constants
 */
export const CONFIDENCE_CONFIG_CONSTANTS = {
  MIN_THRESHOLD: 0.1, // 10%
  MAX_THRESHOLD: 1.0, // 100%
  DEFAULT_PROFILE: 'balanced',
  MIN_MANUAL_REVIEW_THRESHOLD: 0.3, // Below 30% automatically rejected
  DEFAULT_AUTO_APPROVE: true,
  DEFAULT_BATCH_MODE: true,
  DEFAULT_MANUAL_OVERRIDE: true,
  DEFAULT_STATISTICS: true,
  THRESHOLD_STEP: 0.05, // 5% increments for UI sliders
} as const;

/**
 * Validation utility for confidence threshold values
 */
export class ConfidenceThresholdValidator {
  static validateThreshold(threshold: number): { isValid: boolean; error?: string } {
    if (typeof threshold !== 'number') {
      return { isValid: false, error: 'Threshold must be a number' };
    }
    
    if (isNaN(threshold)) {
      return { isValid: false, error: 'Threshold cannot be NaN' };
    }
    
    if (threshold < CONFIDENCE_CONFIG_CONSTANTS.MIN_THRESHOLD) {
      return { 
        isValid: false, 
        error: `Threshold must be at least ${CONFIDENCE_CONFIG_CONSTANTS.MIN_THRESHOLD * 100}%` 
      };
    }
    
    if (threshold > CONFIDENCE_CONFIG_CONSTANTS.MAX_THRESHOLD) {
      return { 
        isValid: false, 
        error: `Threshold cannot exceed ${CONFIDENCE_CONFIG_CONSTANTS.MAX_THRESHOLD * 100}%` 
      };
    }
    
    return { isValid: true };
  }
  
  static validateConfig(config: Partial<ConfidenceThresholdConfig>): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];
    
    if (config.profile) {
      if (config.profile.isCustom && config.customThreshold !== undefined) {
        const thresholdValidation = this.validateThreshold(config.customThreshold);
        if (!thresholdValidation.isValid && thresholdValidation.error) {
          errors.push(thresholdValidation.error);
        }
      } else if (!config.profile.isCustom) {
        const thresholdValidation = this.validateThreshold(config.profile.threshold);
        if (!thresholdValidation.isValid && thresholdValidation.error) {
          errors.push(thresholdValidation.error);
        }
      }
    }
    
    return { isValid: errors.length === 0, errors };
  }
  
  static getEffectiveThreshold(config: ConfidenceThresholdConfig): number {
    if (config.profile.isCustom && config.customThreshold !== undefined) {
      return config.customThreshold;
    }
    return config.profile.threshold;
  }
}

/**
 * Default configuration factory
 */
export function createDefaultConfidenceThresholdConfig(): ConfidenceThresholdConfig {
  return {
    profile: CONFIDENCE_PROFILES[CONFIDENCE_CONFIG_CONSTANTS.DEFAULT_PROFILE],
    autoApprove: CONFIDENCE_CONFIG_CONSTANTS.DEFAULT_AUTO_APPROVE,
    enableBatchMode: CONFIDENCE_CONFIG_CONSTANTS.DEFAULT_BATCH_MODE,
    enableManualOverride: CONFIDENCE_CONFIG_CONSTANTS.DEFAULT_MANUAL_OVERRIDE,
    enableStatistics: CONFIDENCE_CONFIG_CONSTANTS.DEFAULT_STATISTICS,
  };
}

/**
 * Sample data generator for UI previews
 */
export function generateSampleFilteringPreview(threshold: number): {
  sampleSuggestions: Array<{
    filename: string;
    confidence: number;
    category: SuggestionCategory;
  }>;
  statistics: ConfidenceStatistics;
} {
  // Generate sample suggestions with varying confidence levels
  const sampleSuggestions = [
    { filename: 'Project_Report_Final.pdf', confidence: 0.95, category: SuggestionCategory.AUTO_APPROVE },
    { filename: 'meeting_notes_2025_08_30.md', confidence: 0.88, category: SuggestionCategory.AUTO_APPROVE },
    { filename: 'budget_analysis_q3.xlsx', confidence: 0.82, category: SuggestionCategory.AUTO_APPROVE },
    { filename: 'team_photo_summer.jpg', confidence: 0.75, category: SuggestionCategory.MANUAL_REVIEW },
    { filename: 'draft_presentation.pptx', confidence: 0.68, category: SuggestionCategory.MANUAL_REVIEW },
    { filename: 'temp_file_backup.tmp', confidence: 0.45, category: SuggestionCategory.MANUAL_REVIEW },
    { filename: 'untitled_document.txt', confidence: 0.25, category: SuggestionCategory.REJECT },
    { filename: 'file_copy.dat', confidence: 0.18, category: SuggestionCategory.REJECT },
  ];

  // Categorize based on threshold
  const categorizedSuggestions = sampleSuggestions.map(suggestion => ({
    ...suggestion,
    category: categorizeByThreshold(suggestion.confidence, threshold),
  }));

  // Calculate statistics
  const stats = calculateStatisticsFromSamples(categorizedSuggestions);

  return {
    sampleSuggestions: categorizedSuggestions,
    statistics: stats,
  };
}

/**
 * Helper function to categorize suggestions by threshold
 */
function categorizeByThreshold(confidence: number, threshold: number): SuggestionCategory {
  if (confidence >= threshold) {
    return SuggestionCategory.AUTO_APPROVE;
  } else if (confidence >= CONFIDENCE_CONFIG_CONSTANTS.MIN_MANUAL_REVIEW_THRESHOLD) {
    return SuggestionCategory.MANUAL_REVIEW;
  } else {
    return SuggestionCategory.REJECT;
  }
}

/**
 * Helper function to calculate statistics from sample data
 */
function calculateStatisticsFromSamples(suggestions: Array<{ confidence: number; category: SuggestionCategory }>): ConfidenceStatistics {
  const total = suggestions.length;
  const autoApproved = suggestions.filter(s => s.category === SuggestionCategory.AUTO_APPROVE).length;
  const manualReview = suggestions.filter(s => s.category === SuggestionCategory.MANUAL_REVIEW).length;
  const rejected = suggestions.filter(s => s.category === SuggestionCategory.REJECT).length;
  
  const averageConfidence = suggestions.reduce((sum, s) => sum + s.confidence, 0) / total;
  const filteringEffectiveness = ((autoApproved + rejected) / total) * 100;
  
  // Create confidence distribution buckets
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
  
  suggestions.forEach(s => {
    const confidencePercent = s.confidence * 100;
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
  
  return {
    totalSuggestions: total,
    autoApproved,
    manualReview,
    rejected,
    averageConfidence: Math.round(averageConfidence * 100) / 100,
    filteringEffectiveness: Math.round(filteringEffectiveness),
    confidenceDistribution: buckets.filter(b => b.count > 0),
  };
}
