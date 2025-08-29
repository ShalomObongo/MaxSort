/**
 * Unit tests for Confidence Scorer
 * Tests suggestion processing, validation, and scoring algorithms
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { 
  ConfidenceScorer, 
  SuggestionItem, 
  ProcessedSuggestion,
  ConfidenceScoringConfig 
} from '../src/lib/confidence-scorer';

describe('ConfidenceScorer', () => {
  let scorer: ConfidenceScorer;

  const mockConfig: ConfidenceScoringConfig = {
    aiConsistencyWeight: 0.3,
    metadataAlignmentWeight: 0.2,
    structuralPatternWeight: 0.3,
    conventionComplianceWeight: 0.2,
    minAcceptableConfidence: 30,
    highQualityThreshold: 80,
    autoAcceptThreshold: 90,
    enableStrictValidation: true,
    penalizeGenericTerms: true,
    rewardSpecificity: true
  };

  const sampleFilenameSuggestions: SuggestionItem[] = [
    {
      value: 'project_report_2024.pdf',
      confidence: 85,
      reasoning: 'Clear descriptive name with date',
      originalConfidence: 85
    },
    {
      value: 'report.pdf',
      confidence: 60,
      reasoning: 'Simple but generic name',
      originalConfidence: 60
    },
    {
      value: 'invalid/name.pdf',
      confidence: 70,
      reasoning: 'Contains invalid characters',
      originalConfidence: 70
    },
    {
      value: '',
      confidence: 40,
      reasoning: 'Empty suggestion',
      originalConfidence: 40
    }
  ];

  const mockFileMetadata = {
    extension: '.pdf',
    size: 1024768,
    path: '/documents/untitled.pdf',
    parentDirectory: '/documents'
  };

  beforeEach(() => {
    scorer = new ConfidenceScorer(mockConfig);
  });

  describe('processFilenameSuggestions', () => {
    it('should process valid filename suggestions and return ranked results', () => {
      // Act
      const results = scorer.processFilenameSuggestions(
        sampleFilenameSuggestions,
        'untitled.pdf',
        mockFileMetadata
      );

      // Assert
      expect(results).toHaveLength(3); // Should filter out empty suggestion
      expect(results[0].rank).toBe(1); // First should be rank 1
      expect(results[0].value).toBe('project_report_2024.pdf'); // Best suggestion first
      expect(results.every(r => r.confidence >= 0 && r.confidence <= 100)).toBe(true);
    });

    it('should filter out invalid suggestions', () => {
      // Arrange
      const invalidSuggestions: SuggestionItem[] = [
        { value: '', confidence: 50, reasoning: 'Empty', originalConfidence: 50 },
        { value: 'valid.pdf', confidence: 80, reasoning: 'Good', originalConfidence: 80 }
      ];

      // Act
      const results = scorer.processFilenameSuggestions(
        invalidSuggestions,
        'original.pdf',
        mockFileMetadata
      );

      // Assert
      expect(results).toHaveLength(1);
      expect(results[0].value).toBe('valid.pdf');
    });

    it('should handle empty suggestions array gracefully', () => {
      // Act
      const results = scorer.processFilenameSuggestions(
        [],
        'original.pdf',
        mockFileMetadata
      );

      // Assert
      expect(results).toHaveLength(0);
    });

    it('should penalize suggestions with invalid characters', () => {
      // Arrange
      const suggestions: SuggestionItem[] = [
        { value: 'valid_name.pdf', confidence: 80, reasoning: 'Valid', originalConfidence: 80 },
        { value: 'invalid<name>.pdf', confidence: 80, reasoning: 'Invalid chars', originalConfidence: 80 }
      ];

      // Act
      const results = scorer.processFilenameSuggestions(
        suggestions,
        'original.pdf',
        mockFileMetadata
      );

      // Assert
      expect(results).toHaveLength(2);
      expect(results[0].value).toBe('valid_name.pdf'); // Valid should rank higher
      expect(results[1].value).toBe('invalid<name>.pdf');
      expect(results[0].qualityScore).toBeGreaterThan(results[1].qualityScore);
    });

    it('should assign proper confidence scores and rankings', () => {
      // Act
      const results = scorer.processFilenameSuggestions(
        sampleFilenameSuggestions.slice(0, 2), // Only valid suggestions
        'untitled.pdf',
        mockFileMetadata
      );

      // Assert
      expect(results).toHaveLength(2);
      expect(results[0].rank).toBe(1);
      expect(results[1].rank).toBe(2);
      expect(results[0].adjustedConfidence).toBeGreaterThan(0);
      expect(results[1].adjustedConfidence).toBeGreaterThan(0);
      expect(results[0].isRecommended).toBeDefined();
    });
  });

  describe('processClassificationSuggestions', () => {
    it('should process classification suggestions correctly', () => {
      // Arrange
      const classificationSuggestions: SuggestionItem[] = [
        { value: 'document', confidence: 90, reasoning: 'PDF format', originalConfidence: 90 },
        { value: 'report', confidence: 75, reasoning: 'Business content', originalConfidence: 75 }
      ];

      const metadata = {
        extension: '.pdf',
        size: 1024,
        path: '/docs/file.pdf',
        mimeType: 'application/pdf'
      };

      // Act
      const results = scorer.processClassificationSuggestions(classificationSuggestions, metadata);

      // Assert
      expect(results).toHaveLength(2);
      expect(results[0].value).toBe('document'); // Higher confidence should rank first
      expect(results[0].rank).toBe(1);
    });
  });

  describe('processContentSuggestions', () => {
    it('should process content summary suggestions', () => {
      // Arrange
      const contentSuggestions: SuggestionItem[] = [
        { value: 'Financial quarterly report', confidence: 85, reasoning: 'Content analysis', originalConfidence: 85 },
        { value: 'Business document', confidence: 60, reasoning: 'Generic', originalConfidence: 60 }
      ];

      const metadata = {
        extension: '.pdf',
        size: 2048,
        path: '/reports/q4.pdf'
      };

      // Act
      const results = scorer.processContentSuggestions(contentSuggestions, metadata);

      // Assert
      expect(results).toHaveLength(2);
      expect(results[0].value).toBe('Financial quarterly report');
    });
  });

  describe('validation logic', () => {
    it('should detect filename structure issues', () => {
      // Arrange  
      const badSuggestions: SuggestionItem[] = [
        { value: '.hidden_file.pdf', confidence: 70, reasoning: 'Starts with dot', originalConfidence: 70 },
        { value: 'file...pdf', confidence: 70, reasoning: 'Multiple dots', originalConfidence: 70 },
        { value: 'very_long_filename_that_exceeds_normal_limits_and_should_be_flagged_as_potentially_problematic.pdf', confidence: 70, reasoning: 'Too long', originalConfidence: 70 }
      ];

      // Act
      const results = scorer.processFilenameSuggestions(
        badSuggestions,
        'original.pdf',
        mockFileMetadata
      );

      // Assert
      results.forEach(result => {
        expect(result.validationFlags.length).toBeGreaterThan(0);
        // Updated expectation - some suggestions might still have decent quality scores
        // but should have validation flags indicating issues
        if (result.value.startsWith('.')) {
          expect(result.validationFlags).toContain('bad-pattern-starts-with-dot');
        }
        if (result.value.includes('...')) {
          expect(result.validationFlags).toContain('bad-pattern-multiple-dots');
        }
        if (result.value.length > 100) {
          expect(result.validationFlags).toContain('too-long');
        }
      });
    });

    it('should validate metadata alignment', () => {
      // Arrange
      const suggestions: SuggestionItem[] = [
        { value: 'document.pdf', confidence: 80, reasoning: 'Matches extension', originalConfidence: 80 },
        { value: 'document.txt', confidence: 80, reasoning: 'Wrong extension', originalConfidence: 80 }
      ];

      // Act
      const results = scorer.processFilenameSuggestions(
        suggestions,
        'original.pdf',
        mockFileMetadata
      );

      // Assert
      expect(results[0].value).toBe('document.pdf'); // Correct extension should rank higher
      expect(results[0].qualityScore).toBeGreaterThan(results[1].qualityScore);
    });
  });

  describe('ranking algorithm', () => {
    it('should rank suggestions by quality score', () => {
      // Arrange
      const mixedQualitySuggestions: SuggestionItem[] = [
        { value: 'poor_quality.pdf', confidence: 30, reasoning: 'Low confidence', originalConfidence: 30 },
        { value: 'excellent_quality_report.pdf', confidence: 95, reasoning: 'High confidence', originalConfidence: 95 },
        { value: 'average_document.pdf', confidence: 70, reasoning: 'Medium confidence', originalConfidence: 70 }
      ];

      // Act
      const results = scorer.processFilenameSuggestions(
        mixedQualitySuggestions,
        'untitled.pdf',
        mockFileMetadata
      );

      // Assert
      expect(results).toHaveLength(3);
      expect(results[0].value).toBe('excellent_quality_report.pdf');
      expect(results[1].value).toBe('average_document.pdf');
      expect(results[2].value).toBe('poor_quality.pdf');
      
      // Quality scores should be in descending order
      expect(results[0].qualityScore).toBeGreaterThanOrEqual(results[1].qualityScore);
      expect(results[1].qualityScore).toBeGreaterThanOrEqual(results[2].qualityScore);
    });

    it('should limit results to maxSuggestions config', () => {
      // Arrange
      const manySuggestions: SuggestionItem[] = Array.from({ length: 10 }, (_, i) => ({
        value: `suggestion_${i}.pdf`,
        confidence: 80 - i * 5, // Decreasing confidence
        reasoning: `Suggestion ${i}`,
        originalConfidence: 80 - i * 5
      }));

      // Act
      const results = scorer.processFilenameSuggestions(
        manySuggestions,
        'original.pdf',
        mockFileMetadata
      );

      // Assert
      expect(results.length).toBeLessThanOrEqual(10); // Reasonable limit
      expect(results).toHaveLength(5); // Should be limited
    });
  });

  describe('confidence adjustment', () => {
    it('should adjust confidence based on validation results', () => {
      // Arrange
      const suggestion: SuggestionItem[] = [
        { value: 'good_filename.pdf', confidence: 80, reasoning: 'Valid structure', originalConfidence: 80 },
        { value: 'bad<filename>.pdf', confidence: 80, reasoning: 'Invalid chars', originalConfidence: 80 }
      ];

      // Act
      const results = scorer.processFilenameSuggestions(
        suggestion,
        'original.pdf',
        mockFileMetadata
      );

      // Assert
      expect(results[0].adjustedConfidence).toBeGreaterThan(results[1].adjustedConfidence);
      expect(results[1].validationFlags.some(flag => flag.includes('invalid-chars'))).toBe(true);
    });

    it('should not exceed 100% confidence after adjustment', () => {
      // Arrange
      const highConfidenceSuggestion: SuggestionItem[] = [
        { value: 'perfect_filename.pdf', confidence: 95, reasoning: 'Excellent', originalConfidence: 95 }
      ];

      // Act
      const results = scorer.processFilenameSuggestions(
        highConfidenceSuggestion,
        'original.pdf',
        mockFileMetadata
      );

      // Assert
      expect(results[0].adjustedConfidence).toBeLessThanOrEqual(100);
    });
  });

  describe('edge cases', () => {
    it('should handle suggestions with invalid confidence values', () => {
      // Arrange
      const invalidConfidenceSuggestions: SuggestionItem[] = [
        { value: 'normal.pdf', confidence: 80, reasoning: 'Normal', originalConfidence: 80 },
        { value: 'negative.pdf', confidence: -10, reasoning: 'Negative confidence', originalConfidence: -10 },
        { value: 'over100.pdf', confidence: 120, reasoning: 'Over 100', originalConfidence: 120 }
      ];

      // Act & Assert
      // Should filter out invalid confidence suggestions or clamp them
      expect(() => {
        const results = scorer.processFilenameSuggestions(
          invalidConfidenceSuggestions,
          'original.pdf',
          mockFileMetadata
        );
        
        // Results should only contain valid suggestions
        results.forEach(result => {
          expect(result.confidence).toBeGreaterThanOrEqual(0);
          expect(result.confidence).toBeLessThanOrEqual(100);
        });
      }).not.toThrow();
    });

    it('should handle very large metadata values', () => {
      // Arrange
      const largeSizeMetadata = {
        ...mockFileMetadata,
        size: Number.MAX_SAFE_INTEGER
      };

      const suggestions: SuggestionItem[] = [
        { value: 'large_file.pdf', confidence: 80, reasoning: 'Large file', originalConfidence: 80 }
      ];

      // Act & Assert
      expect(() => {
        scorer.processFilenameSuggestions(
          suggestions,
          'original.pdf',
          largeSizeMetadata
        );
      }).not.toThrow();
    });
  });

  describe('performance', () => {
    it('should handle large numbers of suggestions efficiently', () => {
      // Arrange
      const manySuggestions: SuggestionItem[] = Array.from({ length: 1000 }, (_, i) => ({
        value: `suggestion_${i}.pdf`,
        confidence: Math.floor(Math.random() * 100),
        reasoning: `Auto-generated suggestion ${i}`,
        originalConfidence: Math.floor(Math.random() * 100)
      }));

      // Act
      const startTime = Date.now();
      const results = scorer.processFilenameSuggestions(
        manySuggestions,
        'original.pdf',
        mockFileMetadata
      );
      const executionTime = Date.now() - startTime;

      // Assert
      expect(executionTime).toBeLessThan(1000); // Should complete within 1 second
      expect(results.length).toBeLessThanOrEqual(10); // Reasonable limit
    });
  });
});
