/**
 * Tests for confidence threshold configuration system
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  ConfidenceThresholdConfig,
  CONFIDENCE_PROFILES,
  CONFIDENCE_CONFIG_CONSTANTS,
  ConfidenceThresholdValidator,
  createDefaultConfidenceThresholdConfig,
  generateSampleFilteringPreview,
  SuggestionCategory,
} from '../src/lib/confidence-threshold-config';

describe('ConfidenceThresholdConfig', () => {
  describe('CONFIDENCE_PROFILES', () => {
    test('should have all required profiles', () => {
      expect(CONFIDENCE_PROFILES.conservative).toBeDefined();
      expect(CONFIDENCE_PROFILES.balanced).toBeDefined();
      expect(CONFIDENCE_PROFILES.aggressive).toBeDefined();
      expect(CONFIDENCE_PROFILES.custom).toBeDefined();
    });

    test('should have correct threshold values', () => {
      expect(CONFIDENCE_PROFILES.conservative.threshold).toBe(0.90);
      expect(CONFIDENCE_PROFILES.balanced.threshold).toBe(0.80);
      expect(CONFIDENCE_PROFILES.aggressive.threshold).toBe(0.70);
    });

    test('should mark only custom profile as custom', () => {
      expect(CONFIDENCE_PROFILES.conservative.isCustom).toBe(false);
      expect(CONFIDENCE_PROFILES.balanced.isCustom).toBe(false);
      expect(CONFIDENCE_PROFILES.aggressive.isCustom).toBe(false);
      expect(CONFIDENCE_PROFILES.custom.isCustom).toBe(true);
    });
  });

  describe('ConfidenceThresholdValidator', () => {
    test('should validate threshold within range', () => {
      const result = ConfidenceThresholdValidator.validateThreshold(0.8);
      expect(result.isValid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    test('should reject threshold below minimum', () => {
      const result = ConfidenceThresholdValidator.validateThreshold(0.05);
      expect(result.isValid).toBe(false);
      expect(result.error).toContain('at least 10%');
    });

    test('should reject threshold above maximum', () => {
      const result = ConfidenceThresholdValidator.validateThreshold(1.5);
      expect(result.isValid).toBe(false);
      expect(result.error).toContain('cannot exceed 100%');
    });

    test('should reject non-numeric values', () => {
      const result = ConfidenceThresholdValidator.validateThreshold('invalid' as any);
      expect(result.isValid).toBe(false);
      expect(result.error).toContain('must be a number');
    });

    test('should reject NaN values', () => {
      const result = ConfidenceThresholdValidator.validateThreshold(NaN);
      expect(result.isValid).toBe(false);
      expect(result.error).toContain('cannot be NaN');
    });

    test('should validate configuration with predefined profile', () => {
      const config: Partial<ConfidenceThresholdConfig> = {
        profile: CONFIDENCE_PROFILES.balanced,
      };
      
      const result = ConfidenceThresholdValidator.validateConfig(config);
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    test('should validate configuration with custom profile and valid threshold', () => {
      const config: Partial<ConfidenceThresholdConfig> = {
        profile: CONFIDENCE_PROFILES.custom,
        customThreshold: 0.85,
      };
      
      const result = ConfidenceThresholdValidator.validateConfig(config);
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    test('should reject configuration with custom profile and invalid threshold', () => {
      const config: Partial<ConfidenceThresholdConfig> = {
        profile: CONFIDENCE_PROFILES.custom,
        customThreshold: 1.5,
      };
      
      const result = ConfidenceThresholdValidator.validateConfig(config);
      expect(result.isValid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('cannot exceed');
    });

    test('should get effective threshold for predefined profiles', () => {
      const config: ConfidenceThresholdConfig = {
        profile: CONFIDENCE_PROFILES.balanced,
        autoApprove: true,
        enableBatchMode: true,
        enableManualOverride: true,
        enableStatistics: true,
      };
      
      const effectiveThreshold = ConfidenceThresholdValidator.getEffectiveThreshold(config);
      expect(effectiveThreshold).toBe(0.80);
    });

    test('should get effective threshold for custom profile', () => {
      const config: ConfidenceThresholdConfig = {
        profile: CONFIDENCE_PROFILES.custom,
        customThreshold: 0.75,
        autoApprove: true,
        enableBatchMode: true,
        enableManualOverride: true,
        enableStatistics: true,
      };
      
      const effectiveThreshold = ConfidenceThresholdValidator.getEffectiveThreshold(config);
      expect(effectiveThreshold).toBe(0.75);
    });
  });

  describe('createDefaultConfidenceThresholdConfig', () => {
    test('should create valid default configuration', () => {
      const config = createDefaultConfidenceThresholdConfig();
      
      expect(config.profile).toBe(CONFIDENCE_PROFILES.balanced);
      expect(config.autoApprove).toBe(true);
      expect(config.enableBatchMode).toBe(true);
      expect(config.enableManualOverride).toBe(true);
      expect(config.enableStatistics).toBe(true);
      expect(config.customThreshold).toBeUndefined();
      
      const validation = ConfidenceThresholdValidator.validateConfig(config);
      expect(validation.isValid).toBe(true);
    });
  });

  describe('generateSampleFilteringPreview', () => {
    test('should generate preview with expected structure', () => {
      const preview = generateSampleFilteringPreview(0.80);
      
      expect(preview.sampleSuggestions).toBeDefined();
      expect(Array.isArray(preview.sampleSuggestions)).toBe(true);
      expect(preview.sampleSuggestions.length).toBeGreaterThan(0);
      expect(preview.statistics).toBeDefined();
    });

    test('should categorize suggestions correctly with 80% threshold', () => {
      const preview = generateSampleFilteringPreview(0.80);
      
      const autoApproved = preview.sampleSuggestions.filter(s => s.category === SuggestionCategory.AUTO_APPROVE);
      const manualReview = preview.sampleSuggestions.filter(s => s.category === SuggestionCategory.MANUAL_REVIEW);
      const rejected = preview.sampleSuggestions.filter(s => s.category === SuggestionCategory.REJECT);
      
      // Verify that high confidence suggestions are auto-approved
      autoApproved.forEach(suggestion => {
        expect(suggestion.confidence).toBeGreaterThanOrEqual(0.80);
      });
      
      // Verify that low confidence suggestions are rejected
      rejected.forEach(suggestion => {
        expect(suggestion.confidence).toBeLessThan(CONFIDENCE_CONFIG_CONSTANTS.MIN_MANUAL_REVIEW_THRESHOLD);
      });
      
      // Verify that medium confidence suggestions are in manual review
      manualReview.forEach(suggestion => {
        expect(suggestion.confidence).toBeGreaterThanOrEqual(CONFIDENCE_CONFIG_CONSTANTS.MIN_MANUAL_REVIEW_THRESHOLD);
        expect(suggestion.confidence).toBeLessThan(0.80);
      });
    });

    test('should categorize suggestions correctly with 90% threshold', () => {
      const preview = generateSampleFilteringPreview(0.90);
      
      const autoApproved = preview.sampleSuggestions.filter(s => s.category === SuggestionCategory.AUTO_APPROVE);
      
      // With higher threshold, fewer should be auto-approved
      autoApproved.forEach(suggestion => {
        expect(suggestion.confidence).toBeGreaterThanOrEqual(0.90);
      });
    });

    test('should calculate statistics correctly', () => {
      const preview = generateSampleFilteringPreview(0.80);
      
      const stats = preview.statistics;
      expect(stats.totalSuggestions).toBe(preview.sampleSuggestions.length);
      expect(stats.autoApproved + stats.manualReview + stats.rejected).toBe(stats.totalSuggestions);
      expect(stats.averageConfidence).toBeGreaterThan(0);
      expect(stats.averageConfidence).toBeLessThanOrEqual(1);
      expect(stats.filteringEffectiveness).toBeGreaterThanOrEqual(0);
      expect(stats.filteringEffectiveness).toBeLessThanOrEqual(100);
      expect(Array.isArray(stats.confidenceDistribution)).toBe(true);
    });

    test('should have different statistics for different thresholds', () => {
      const preview80 = generateSampleFilteringPreview(0.80);
      const preview90 = generateSampleFilteringPreview(0.90);
      
      // Higher threshold should result in fewer auto-approved suggestions
      expect(preview90.statistics.autoApproved).toBeLessThanOrEqual(preview80.statistics.autoApproved);
      expect(preview90.statistics.manualReview).toBeGreaterThanOrEqual(preview80.statistics.manualReview);
    });
  });

  describe('SuggestionCategory enum', () => {
    test('should have expected category values', () => {
      expect(SuggestionCategory.AUTO_APPROVE).toBe('auto-approve');
      expect(SuggestionCategory.MANUAL_REVIEW).toBe('manual-review');
      expect(SuggestionCategory.REJECT).toBe('reject');
    });
  });

  describe('CONFIDENCE_CONFIG_CONSTANTS', () => {
    test('should have valid constant values', () => {
      expect(CONFIDENCE_CONFIG_CONSTANTS.MIN_THRESHOLD).toBe(0.1);
      expect(CONFIDENCE_CONFIG_CONSTANTS.MAX_THRESHOLD).toBe(1.0);
      expect(CONFIDENCE_CONFIG_CONSTANTS.DEFAULT_PROFILE).toBe('balanced');
      expect(CONFIDENCE_CONFIG_CONSTANTS.MIN_MANUAL_REVIEW_THRESHOLD).toBe(0.3);
      expect(CONFIDENCE_CONFIG_CONSTANTS.THRESHOLD_STEP).toBe(0.05);
    });

    test('should have logical relationships between constants', () => {
      expect(CONFIDENCE_CONFIG_CONSTANTS.MIN_THRESHOLD).toBeLessThan(CONFIDENCE_CONFIG_CONSTANTS.MAX_THRESHOLD);
      expect(CONFIDENCE_CONFIG_CONSTANTS.MIN_MANUAL_REVIEW_THRESHOLD).toBeGreaterThan(CONFIDENCE_CONFIG_CONSTANTS.MIN_THRESHOLD);
      expect(CONFIDENCE_CONFIG_CONSTANTS.MIN_MANUAL_REVIEW_THRESHOLD).toBeLessThan(CONFIDENCE_CONFIG_CONSTANTS.MAX_THRESHOLD);
    });
  });
});
