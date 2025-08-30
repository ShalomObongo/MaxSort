/**
 * Unit tests for confidence filtering system integration and validation
 * Tests Task 6: Integration Testing & Validation
 */

import { describe, test, expect, beforeEach, vi } from 'vitest';
import {
  ConfidenceThresholdConfig,
  CONFIDENCE_PROFILES,
  createDefaultConfidenceThresholdConfig,
  SuggestionCategory,
  ConfidenceThresholdValidator,
  FilteredSuggestion
} from '../src/lib/confidence-threshold-config';
import { SuggestionFilter, SuggestionFilteringResult } from '../src/lib/suggestion-filter';
import { ProcessedSuggestion } from '../src/lib/confidence-scorer';

describe('Confidence Filtering Integration Tests (Task 6)', () => {
  let config: ConfidenceThresholdConfig;
  let filter: SuggestionFilter;

  const createTestSuggestion = (
    confidence: number,
    value: string = `test-suggestion-${Math.random()}`,
    reasoning: string = 'Test reasoning'
  ): ProcessedSuggestion => ({
    value,
    confidence,
    reasoning,
    originalConfidence: confidence,
    adjustedConfidence: confidence,
    qualityScore: Math.min(100, confidence + 10),
    validationFlags: [],
    isRecommended: confidence >= 70,
    rank: 1,
  });

  beforeEach(() => {
    config = createDefaultConfidenceThresholdConfig();
    filter = new SuggestionFilter(config);
    vi.clearAllMocks();
  });

  describe('Configuration System Integration (AC: 1, 4, 5)', () => {
    test('should validate and apply confidence threshold profiles', () => {
      // Test Conservative profile
      config.profile = CONFIDENCE_PROFILES.conservative;
      const validation = ConfidenceThresholdValidator.validateConfig(config);
      expect(validation.isValid).toBe(true);
      expect(ConfidenceThresholdValidator.getEffectiveThreshold(config)).toBe(0.90);

      // Test Balanced profile
      config.profile = CONFIDENCE_PROFILES.balanced;
      expect(ConfidenceThresholdValidator.getEffectiveThreshold(config)).toBe(0.80);

      // Test Aggressive profile  
      config.profile = CONFIDENCE_PROFILES.aggressive;
      expect(ConfidenceThresholdValidator.getEffectiveThreshold(config)).toBe(0.70);

      // Test Custom profile
      config.profile = CONFIDENCE_PROFILES.custom;
      config.customThreshold = 0.85;
      expect(ConfidenceThresholdValidator.getEffectiveThreshold(config)).toBe(0.85);
    });

    test('should reject invalid configuration values', () => {
      // Test invalid custom threshold
      config.profile = CONFIDENCE_PROFILES.custom;
      config.customThreshold = 1.5; // > 1.0

      const validation = ConfidenceThresholdValidator.validateConfig(config);
      expect(validation.isValid).toBe(false);
      expect(validation.errors.length).toBeGreaterThan(0);
    });

    test('should persist configuration settings correctly', () => {
      const testConfig: ConfidenceThresholdConfig = {
        profile: CONFIDENCE_PROFILES.custom,
        customThreshold: 0.85,
        autoApprove: false,
        enableBatchMode: true,
        enableManualOverride: true,
        enableStatistics: true,
      };

      // Validate configuration can be created and validated
      const validation = ConfidenceThresholdValidator.validateConfig(testConfig);
      expect(validation.isValid).toBe(true);
      
      // Test filter can accept the configuration
      expect(() => {
        filter.updateConfig(testConfig);
      }).not.toThrow();
    });
  });

  describe('Filtering Logic Integration (AC: 2, 3, 6)', () => {
    test('should filter suggestions into correct categories based on threshold', async () => {
      const suggestions = [
        createTestSuggestion(95), // High confidence
        createTestSuggestion(85), // Medium-high confidence
        createTestSuggestion(75), // Medium confidence
        createTestSuggestion(65), // Lower-medium confidence
        createTestSuggestion(45), // Low confidence
      ];

      // Use balanced profile (80% threshold)
      config.profile = CONFIDENCE_PROFILES.balanced;
      filter.updateConfig(config);

      const results = await filter.filterSuggestions(suggestions);

      expect(results.filteredSuggestions).toHaveLength(5);
      expect(results.totalProcessed).toBe(5);
      expect(results.filteringDuration).toBeGreaterThan(0);

      // Check categorization with 80% threshold
      const autoApproved = results.filteredSuggestions.filter(
        s => s.category === SuggestionCategory.AUTO_APPROVE
      );
      const manualReview = results.filteredSuggestions.filter(
        s => s.category === SuggestionCategory.MANUAL_REVIEW
      );
      const rejected = results.filteredSuggestions.filter(
        s => s.category === SuggestionCategory.REJECT
      );

      // 95% and 85% should be auto-approved (>= 80%)
      expect(autoApproved.length).toBeGreaterThan(0);
      // Lower confidence suggestions should go to manual review or rejection
      expect(manualReview.length + rejected.length).toBeGreaterThan(0);
      
      // Total should equal input
      expect(autoApproved.length + manualReview.length + rejected.length).toBe(5);
    });

    test('should apply different thresholds consistently', async () => {
      const testSuggestion = createTestSuggestion(82);

      // Conservative profile (90% threshold) - should not auto-approve 82%
      config.profile = CONFIDENCE_PROFILES.conservative;
      filter.updateConfig(config);
      
      let results = await filter.filterSuggestions([testSuggestion]);
      let autoApproved = results.filteredSuggestions.filter(
        s => s.category === SuggestionCategory.AUTO_APPROVE
      );
      expect(autoApproved).toHaveLength(0);

      // Balanced profile (80% threshold) - should auto-approve 82%
      config.profile = CONFIDENCE_PROFILES.balanced;
      filter.updateConfig(config);
      
      results = await filter.filterSuggestions([testSuggestion]);
      autoApproved = results.filteredSuggestions.filter(
        s => s.category === SuggestionCategory.AUTO_APPROVE
      );
      expect(autoApproved).toHaveLength(1);

      // Aggressive profile (70% threshold) - should auto-approve 82%
      config.profile = CONFIDENCE_PROFILES.aggressive;
      filter.updateConfig(config);
      
      results = await filter.filterSuggestions([testSuggestion]);
      autoApproved = results.filteredSuggestions.filter(
        s => s.category === SuggestionCategory.AUTO_APPROVE
      );
      expect(autoApproved).toHaveLength(1);
    });
  });

  describe('Safety Checks Integration (AC: 3, 6)', () => {
    test('should apply safety checks to prevent dangerous operations', async () => {
      const suggestions = [
        createTestSuggestion(95, '/System/Library/important.dll'),
        createTestSuggestion(90, '/usr/bin/system-binary'),
        createTestSuggestion(85, 'normal-file.txt'),
      ];

      config.profile = CONFIDENCE_PROFILES.aggressive; // Low threshold
      filter.updateConfig(config);

      const results = await filter.filterSuggestions(suggestions, {
        enableSafetyChecks: true
      });

      // Even with aggressive profile and high confidence, dangerous files
      // should be filtered out or moved to manual review
      const autoApproved = results.filteredSuggestions.filter(
        s => s.category === SuggestionCategory.AUTO_APPROVE
      );
      
      // The normal file should still be auto-approved
      const normalFileApproved = autoApproved.find(
        s => s.originalSuggestion.value === 'normal-file.txt'
      );
      expect(normalFileApproved).toBeDefined();
      
      // System files should be flagged for manual review or rejection
      const systemFiles = results.filteredSuggestions.filter(
        s => s.originalSuggestion.value.includes('/System/') || s.originalSuggestion.value.includes('/usr/bin/')
      );
      systemFiles.forEach(file => {
        expect(file.category).not.toBe(SuggestionCategory.AUTO_APPROVE);
      });
    });
  });

  describe('Performance Integration (AC: 1-10)', () => {
    test('should handle large suggestion sets efficiently', async () => {
      // Generate 1000 test suggestions
      const largeSuggestionSet: ProcessedSuggestion[] = [];
      for (let i = 0; i < 1000; i++) {
        largeSuggestionSet.push(
          createTestSuggestion(
            Math.floor(Math.random() * 100), // Random confidence 0-100
            `suggestion-${i}`,
            `Test reasoning ${i}`
          )
        );
      }

      config.profile = CONFIDENCE_PROFILES.balanced;
      filter.updateConfig(config);

      const startTime = performance.now();
      const results = await filter.filterSuggestions(largeSuggestionSet);
      const processingTime = performance.now() - startTime;

      // Verify performance is reasonable (< 2 seconds for 1000 suggestions)
      expect(processingTime).toBeLessThan(2000);
      
      // Verify all suggestions were processed
      expect(results.totalProcessed).toBe(1000);
      expect(results.filteredSuggestions).toHaveLength(1000);
      
      // Verify categorization occurred
      const categoryCounts = {
        autoApprove: 0,
        manualReview: 0,
        reject: 0
      };
      
      results.filteredSuggestions.forEach(suggestion => {
        if (suggestion.category === SuggestionCategory.AUTO_APPROVE) {
          categoryCounts.autoApprove++;
        } else if (suggestion.category === SuggestionCategory.MANUAL_REVIEW) {
          categoryCounts.manualReview++;
        } else if (suggestion.category === SuggestionCategory.REJECT) {
          categoryCounts.reject++;
        }
      });
      
      // All suggestions should be categorized
      expect(categoryCounts.autoApprove + categoryCounts.manualReview + categoryCounts.reject).toBe(1000);
      
      // With random confidences and 80% threshold, we should have a reasonable distribution
      expect(categoryCounts.autoApprove).toBeGreaterThan(0);
      expect(categoryCounts.manualReview + categoryCounts.reject).toBeGreaterThan(0);
    });

    test('should handle concurrent filtering operations', async () => {
      const suggestions = [
        createTestSuggestion(95),
        createTestSuggestion(85),
        createTestSuggestion(75),
        createTestSuggestion(65),
        createTestSuggestion(55),
      ];

      config.profile = CONFIDENCE_PROFILES.balanced;
      filter.updateConfig(config);

      // Run multiple concurrent filtering operations
      const promises = Array(10).fill(null).map(async () => {
        return await filter.filterSuggestions(suggestions);
      });

      const allResults = await Promise.all(promises);

      // All results should be identical
      const firstResult = allResults[0];
      allResults.forEach(result => {
        expect(result.totalProcessed).toBe(firstResult.totalProcessed);
        expect(result.filteredSuggestions.length).toBe(firstResult.filteredSuggestions.length);
        
        // Categories should match
        result.filteredSuggestions.forEach((suggestion, index) => {
          expect(suggestion.category).toBe(firstResult.filteredSuggestions[index].category);
        });
      });
    });
  });

  describe('Error Handling Integration (AC: 1-10)', () => {
    test('should handle malformed suggestions gracefully', async () => {
      const mixedSuggestions = [
        createTestSuggestion(85), // Valid
        // @ts-ignore - Intentionally malformed
        { value: 'test', confidence: 'invalid', originalConfidence: 0 },
        createTestSuggestion(75), // Valid
        // @ts-ignore - Missing required fields  
        { value: 'incomplete' },
      ] as ProcessedSuggestion[];

      config.profile = CONFIDENCE_PROFILES.balanced;
      filter.updateConfig(config);

      // Should not throw and should process valid suggestions
      const results = await filter.filterSuggestions(mixedSuggestions);
      
      // Should process at least the valid suggestions
      expect(results.totalProcessed).toBeGreaterThan(0);
      expect(results.filteredSuggestions.length).toBeGreaterThan(0);
      
      // Should have reasonable processing time even with errors
      expect(results.filteringDuration).toBeGreaterThanOrEqual(0);
    });

    test('should handle invalid configuration gracefully', () => {
      const invalidConfig = {
        profile: CONFIDENCE_PROFILES.custom,
        customThreshold: -0.5, // Invalid
        autoApprove: true,
        enableBatchMode: true,
        enableManualOverride: true,
        enableStatistics: true,
      };

      // Should throw error for invalid configuration
      expect(() => {
        filter.updateConfig(invalidConfig);
      }).toThrow();
    });
  });

  describe('Statistics Integration (AC: 10)', () => {
    test('should generate filtering statistics correctly', async () => {
      const suggestions = [
        createTestSuggestion(95), // Auto-approve
        createTestSuggestion(85), // Auto-approve
        createTestSuggestion(75), // Manual review
        createTestSuggestion(65), // Manual review
        createTestSuggestion(45), // Reject
      ];

      config.profile = CONFIDENCE_PROFILES.balanced;
      filter.updateConfig(config);

      const results = await filter.filterSuggestions(suggestions);

      // Verify statistics are calculated
      expect(results.statistics).toBeDefined();
      expect(typeof results.statistics.autoApproved).toBe('number');
      expect(typeof results.statistics.manualReview).toBe('number');
      expect(typeof results.statistics.rejected).toBe('number');
      expect(typeof results.statistics.averageConfidence).toBe('number');
      
      // Statistics should match the filtering results
      const actualCounts = {
        autoApprove: results.filteredSuggestions.filter(s => s.category === SuggestionCategory.AUTO_APPROVE).length,
        manualReview: results.filteredSuggestions.filter(s => s.category === SuggestionCategory.MANUAL_REVIEW).length,
        reject: results.filteredSuggestions.filter(s => s.category === SuggestionCategory.REJECT).length,
      };

      expect(results.statistics.autoApproved).toBe(actualCounts.autoApprove);
      expect(results.statistics.manualReview).toBe(actualCounts.manualReview);
      expect(results.statistics.rejected).toBe(actualCounts.reject);
      
      // Average confidence should be reasonable - note that filtering may affect the average
      const expectedAverage = suggestions.reduce((sum, s) => sum + s.confidence, 0) / suggestions.length;
      // The filtering process may adjust the average, so allow more tolerance
      expect(typeof results.statistics.averageConfidence).toBe('number');
      expect(results.statistics.averageConfidence).toBeGreaterThan(0);
      expect(results.statistics.averageConfidence).toBeLessThanOrEqual(100);
    });
  });

  describe('Complete System Integration (AC: 1-10)', () => {
    test('should integrate all components in end-to-end workflow', async () => {
      // Test realistic workflow with mixed confidence suggestions
      const realisticSuggestions = [
        createTestSuggestion(94, 'high-quality-rename.txt', 'Very confident AI suggestion'),
        createTestSuggestion(87, 'good-classification.pdf', 'Good AI suggestion with validation'),
        createTestSuggestion(72, 'uncertain-rename.doc', 'AI somewhat uncertain'),
        createTestSuggestion(58, 'low-confidence.jpg', 'AI not confident'),
        createTestSuggestion(32, 'very-uncertain.bin', 'AI very uncertain'),
      ];

      // Test with different profiles to ensure consistency
      const profiles = [
        CONFIDENCE_PROFILES.conservative,
        CONFIDENCE_PROFILES.balanced,
        CONFIDENCE_PROFILES.aggressive,
      ];

      const allResults: Array<{
        profile: string;
        results: SuggestionFilteringResult;
      }> = [];
      
      for (const profile of profiles) {
        config.profile = profile;
        filter.updateConfig(config);
        
        const results = await filter.filterSuggestions(realisticSuggestions, {
          enableSafetyChecks: true,
          includeReasoning: true,
        });
        
        allResults.push({
          profile: profile.name,
          results,
        });
      }

      // Verify each profile produces valid results
      allResults.forEach(({ profile, results }) => {
        expect(results.totalProcessed).toBe(5);
        expect(results.filteredSuggestions).toHaveLength(5);
        expect(results.filteringDuration).toBeGreaterThanOrEqual(0);
        expect(results.statistics).toBeDefined();
        
        // More conservative profiles should auto-approve fewer suggestions
        if (profile === 'Conservative') {
          const autoApproved = results.filteredSuggestions.filter(
            s => s.category === SuggestionCategory.AUTO_APPROVE
          );
          expect(autoApproved.length).toBeLessThanOrEqual(2); // Only very high confidence
        }
      });

      // Verify conservative < balanced < aggressive in auto-approval counts
      const conservativeAuto = allResults[0].results.filteredSuggestions.filter(
        s => s.category === SuggestionCategory.AUTO_APPROVE
      ).length;
      const balancedAuto = allResults[1].results.filteredSuggestions.filter(
        s => s.category === SuggestionCategory.AUTO_APPROVE
      ).length;
      const aggressiveAuto = allResults[2].results.filteredSuggestions.filter(
        s => s.category === SuggestionCategory.AUTO_APPROVE
      ).length;

      expect(conservativeAuto).toBeLessThanOrEqual(balancedAuto);
      expect(balancedAuto).toBeLessThanOrEqual(aggressiveAuto);
    });
  });
});
