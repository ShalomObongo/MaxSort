/**
 * Tests for SuggestionFilter service
 */

import { describe, test, expect, beforeEach, vi } from 'vitest';
import { 
  SuggestionFilter, 
  createSuggestionFilter, 
  getSuggestionFilter, 
  destroySuggestionFilter 
} from '../src/lib/suggestion-filter';
import { ProcessedSuggestion } from '../src/lib/confidence-scorer';
import { 
  ConfidenceThresholdConfig,
  CONFIDENCE_PROFILES,
  SuggestionCategory,
  createDefaultConfidenceThresholdConfig
} from '../src/lib/confidence-threshold-config';

// Mock the logger
vi.mock('../src/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    startPerformanceTimer: vi.fn(() => 'timer-id'),
    endPerformanceTimer: vi.fn(),
  },
  AnalysisError: class AnalysisError extends Error {
    constructor(type: string, message: string, context?: any) {
      super(message);
      this.name = 'AnalysisError';
    }
  },
  AnalysisErrorType: {
    VALIDATION_ERROR: 'validation_error',
  }
}));

describe('SuggestionFilter', () => {
  let filter: SuggestionFilter;
  let config: ConfidenceThresholdConfig;
  let sampleSuggestions: ProcessedSuggestion[];

  beforeEach(() => {
    destroySuggestionFilter();
    config = createDefaultConfidenceThresholdConfig();
    filter = new SuggestionFilter(config);
    
    sampleSuggestions = [
      {
        value: 'high_confidence_file.pdf',
        confidence: 95,
        originalConfidence: 95,
        adjustedConfidence: 95,
        qualityScore: 90,
        validationFlags: ['good-pattern-lowercase-with-separators'],
        isRecommended: true,
        rank: 1
      },
      {
        value: 'medium_confidence_file.docx',
        confidence: 75,
        originalConfidence: 75,
        adjustedConfidence: 75,
        qualityScore: 70,
        validationFlags: ['consistent-case'],
        isRecommended: false,
        rank: 2
      },
      {
        value: 'low_confidence_file.tmp',
        confidence: 25,
        originalConfidence: 25,
        adjustedConfidence: 25,
        qualityScore: 30,
        validationFlags: ['contains-generic-terms'],
        isRecommended: false,
        rank: 3
      }
    ];
  });

  describe('constructor and configuration', () => {
    test('should create filter with valid configuration', () => {
      const filter = new SuggestionFilter(config);
      expect(filter.getConfig()).toEqual(config);
    });

    test('should reject invalid configuration', () => {
      const invalidConfig = {
        ...config,
        profile: CONFIDENCE_PROFILES.custom,
        customThreshold: 1.5 // Invalid threshold for custom profile
      };
      
      expect(() => new SuggestionFilter(invalidConfig)).toThrow();
    });

    test('should update configuration', () => {
      const newConfig = {
        ...config,
        profile: CONFIDENCE_PROFILES.aggressive
      };
      
      filter.updateConfig(newConfig);
      expect(filter.getConfig().profile).toBe(CONFIDENCE_PROFILES.aggressive);
    });
  });

  describe('filterSuggestions', () => {
    test('should filter suggestions with default balanced profile', async () => {
      const result = await filter.filterSuggestions(sampleSuggestions);
      
      expect(result.filteredSuggestions).toHaveLength(3);
      expect(result.totalProcessed).toBe(3);
      expect(typeof result.filteringDuration).toBe('number');
      expect(result.filteringDuration).toBeGreaterThanOrEqual(0);
      
      // High confidence should be auto-approved (95% >= 80%)
      const highConf = result.filteredSuggestions.find(fs => 
        fs.originalSuggestion.value === 'high_confidence_file.pdf'
      );
      expect(highConf?.category).toBe(SuggestionCategory.AUTO_APPROVE);
      
      // Medium confidence should require manual review (75% < 80% but >= 30%)
      const mediumConf = result.filteredSuggestions.find(fs => 
        fs.originalSuggestion.value === 'medium_confidence_file.docx'
      );
      expect(mediumConf?.category).toBe(SuggestionCategory.MANUAL_REVIEW);
      
      // Low confidence should be rejected (25% < 30%)
      const lowConf = result.filteredSuggestions.find(fs => 
        fs.originalSuggestion.value === 'low_confidence_file.tmp'
      );
      expect(lowConf?.category).toBe(SuggestionCategory.REJECT);
    });

    test('should handle conservative profile correctly', async () => {
      const conservativeConfig = {
        ...config,
        profile: CONFIDENCE_PROFILES.conservative
      };
      filter.updateConfig(conservativeConfig);
      
      const result = await filter.filterSuggestions(sampleSuggestions);
      
      // Only 95% confidence should be auto-approved with 90% threshold
      const autoApproved = result.filteredSuggestions.filter(fs => 
        fs.category === SuggestionCategory.AUTO_APPROVE
      );
      expect(autoApproved).toHaveLength(1);
      expect(autoApproved[0].originalSuggestion.adjustedConfidence).toBe(95);
      
      // 75% confidence should go to manual review
      const manualReview = result.filteredSuggestions.filter(fs => 
        fs.category === SuggestionCategory.MANUAL_REVIEW
      );
      expect(manualReview).toHaveLength(1);
      expect(manualReview[0].originalSuggestion.adjustedConfidence).toBe(75);
    });

    test('should handle aggressive profile correctly', async () => {
      const aggressiveConfig = {
        ...config,
        profile: CONFIDENCE_PROFILES.aggressive
      };
      filter.updateConfig(aggressiveConfig);
      
      const result = await filter.filterSuggestions(sampleSuggestions);
      
      // Both 95% and 75% should be auto-approved with 70% threshold
      const autoApproved = result.filteredSuggestions.filter(fs => 
        fs.category === SuggestionCategory.AUTO_APPROVE
      );
      expect(autoApproved).toHaveLength(2);
    });

    test('should handle custom threshold', async () => {
      const customConfig = {
        ...config,
        profile: CONFIDENCE_PROFILES.custom,
        customThreshold: 0.85
      };
      filter.updateConfig(customConfig);
      
      const result = await filter.filterSuggestions(sampleSuggestions);
      
      // Only 95% should be auto-approved with 85% custom threshold
      const autoApproved = result.filteredSuggestions.filter(fs => 
        fs.category === SuggestionCategory.AUTO_APPROVE
      );
      expect(autoApproved).toHaveLength(1);
      expect(autoApproved[0].originalSuggestion.adjustedConfidence).toBe(95);
    });

    test('should handle disabled auto-approve', async () => {
      const noAutoConfig = {
        ...config,
        autoApprove: false
      };
      filter.updateConfig(noAutoConfig);
      
      const result = await filter.filterSuggestions(sampleSuggestions);
      
      // No suggestions should be auto-approved
      const autoApproved = result.filteredSuggestions.filter(fs => 
        fs.category === SuggestionCategory.AUTO_APPROVE
      );
      expect(autoApproved).toHaveLength(0);
      
      // High and medium confidence should go to manual review
      const manualReview = result.filteredSuggestions.filter(fs => 
        fs.category === SuggestionCategory.MANUAL_REVIEW
      );
      expect(manualReview).toHaveLength(2);
    });

    test('should calculate correct statistics', async () => {
      const result = await filter.filterSuggestions(sampleSuggestions);
      
      expect(result.statistics.totalSuggestions).toBe(3);
      expect(result.statistics.autoApproved).toBe(1);
      expect(result.statistics.manualReview).toBe(1);
      expect(result.statistics.rejected).toBe(1);
      expect(result.statistics.averageConfidence).toBeCloseTo(0.65, 1); // (95+75+25)/3/100
      expect(result.statistics.filteringEffectiveness).toBe(67); // (1+1)/3 * 100
      expect(result.statistics.confidenceDistribution).toHaveLength(3); // Different buckets
    });

    test('should handle empty suggestions array', async () => {
      const result = await filter.filterSuggestions([]);
      
      expect(result.filteredSuggestions).toHaveLength(0);
      expect(result.totalProcessed).toBe(0);
      expect(result.statistics.totalSuggestions).toBe(0);
    });

    test('should filter out invalid suggestions', async () => {
      const invalidSuggestions: ProcessedSuggestion[] = [
        ...sampleSuggestions,
        {
          value: '', // Empty value
          confidence: 80,
          originalConfidence: 80,
          adjustedConfidence: 80,
          qualityScore: 70,
          validationFlags: [],
          isRecommended: false,
          rank: 4
        },
        {
          value: 'valid_file.txt',
          confidence: 80,
          originalConfidence: 80,
          adjustedConfidence: -10, // Invalid confidence
          qualityScore: 70,
          validationFlags: [],
          isRecommended: false,
          rank: 5
        }
      ];
      
      const result = await filter.filterSuggestions(invalidSuggestions);
      
      // Should only process the 3 valid suggestions
      expect(result.totalProcessed).toBe(3);
      expect(result.filteredSuggestions).toHaveLength(3);
    });
  });

  describe('filterSingleSuggestion', () => {
    test('should filter single high confidence suggestion', () => {
      const result = filter.filterSingleSuggestion(sampleSuggestions[0]);
      
      expect(result.category).toBe(SuggestionCategory.AUTO_APPROVE);
      expect(result.reason).toContain('High confidence');
      expect(result.canOverride).toBe(true);
    });

    test('should filter single low confidence suggestion', () => {
      const result = filter.filterSingleSuggestion(sampleSuggestions[2]);
      
      expect(result.category).toBe(SuggestionCategory.REJECT);
      expect(result.reason).toContain('Low confidence');
      expect(result.canOverride).toBe(false); // Rejected suggestions cannot be overridden
    });

    test('should apply safety checks', () => {
      const dangerousSuggestion: ProcessedSuggestion = {
        value: '/System/important_system_file.cfg',
        confidence: 95,
        originalConfidence: 95,
        adjustedConfidence: 95,
        qualityScore: 90,
        validationFlags: [],
        isRecommended: true,
        rank: 1
      };
      
      const result = filter.filterSingleSuggestion(dangerousSuggestion, true);
      
      // Should be downgraded to manual review due to system file path
      expect(result.category).toBe(SuggestionCategory.MANUAL_REVIEW);
      expect(result.reason).toContain('Safety concern');
    });

    test('should skip safety checks when disabled', () => {
      const dangerousSuggestion: ProcessedSuggestion = {
        value: '/System/important_system_file.cfg',
        confidence: 95,
        originalConfidence: 95,
        adjustedConfidence: 95,
        qualityScore: 90,
        validationFlags: [],
        isRecommended: true,
        rank: 1
      };
      
      const result = filter.filterSingleSuggestion(dangerousSuggestion, false);
      
      // Should remain auto-approved when safety checks are disabled
      expect(result.category).toBe(SuggestionCategory.AUTO_APPROVE);
    });
  });

  describe('batch options', () => {
    test('should apply maxAutoApproveCount limit', async () => {
      const highConfidenceSuggestions = Array(5).fill(null).map((_, i) => ({
        value: `high_confidence_file_${i}.pdf`,
        confidence: 95,
        originalConfidence: 95,
        adjustedConfidence: 95,
        qualityScore: 90,
        validationFlags: [],
        isRecommended: true,
        rank: i + 1
      }));
      
      const result = await filter.filterSuggestions(highConfidenceSuggestions, {
        maxAutoApproveCount: 2
      });
      
      const autoApproved = result.filteredSuggestions.filter(fs => 
        fs.category === SuggestionCategory.AUTO_APPROVE
      );
      expect(autoApproved).toHaveLength(2);
      
      const manualReview = result.filteredSuggestions.filter(fs => 
        fs.category === SuggestionCategory.MANUAL_REVIEW
      );
      expect(manualReview).toHaveLength(3);
    });

    test('should preserve original order when requested', async () => {
      const result = await filter.filterSuggestions(sampleSuggestions, {
        preserveOriginalOrder: true
      });
      
      // Check that the order matches the input
      expect(result.filteredSuggestions[0].originalSuggestion.value).toBe('high_confidence_file.pdf');
      expect(result.filteredSuggestions[1].originalSuggestion.value).toBe('medium_confidence_file.docx');
      expect(result.filteredSuggestions[2].originalSuggestion.value).toBe('low_confidence_file.tmp');
    });
  });

  describe('factory functions', () => {
    test('should create filter with factory', () => {
      const filter = createSuggestionFilter(config);
      expect(filter.getConfig()).toEqual(config);
    });

    test('should manage singleton instance', () => {
      destroySuggestionFilter();
      
      const filter1 = getSuggestionFilter(config);
      const filter2 = getSuggestionFilter();
      
      expect(filter1).toBe(filter2);
    });

    test('should throw when accessing uninitialized singleton', () => {
      destroySuggestionFilter();
      
      expect(() => getSuggestionFilter()).toThrow();
    });
  });
});
