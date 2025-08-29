/**
 * Confidence scoring and suggestion processing for AI analysis results
 */

import path from 'path';
import { logger, AnalysisError, AnalysisErrorType } from './logger';

export interface SuggestionItem {
  value: string;                  // The suggested content (filename, classification, etc.)
  confidence: number;            // AI-provided confidence (0-100)
  reasoning?: string;            // AI-provided reasoning
  originalConfidence: number;    // Original confidence before adjustment
}

export interface ProcessedSuggestion extends SuggestionItem {
  adjustedConfidence: number;    // Confidence after validation and adjustment
  qualityScore: number;          // Overall quality assessment (0-100)
  validationFlags: string[];     // Issues found during validation
  isRecommended: boolean;        // Whether this suggestion is recommended for use
  rank: number;                  // Ranking among all suggestions for this item
}

export interface SuggestionMetrics {
  totalSuggestions: number;
  validSuggestions: number;
  highQualitySuggestions: number;  // Quality score >= 80
  averageConfidence: number;
  averageQualityScore: number;
  commonIssues: string[];
}

/**
 * Configuration for confidence scoring algorithm
 */
export interface ConfidenceScoringConfig {
  // Weight factors for confidence adjustment
  aiConsistencyWeight: number;      // Weight for AI response consistency (0-1)
  metadataAlignmentWeight: number;  // Weight for metadata alignment (0-1)
  structuralPatternWeight: number;  // Weight for structural patterns (0-1)
  conventionComplianceWeight: number; // Weight for naming conventions (0-1)
  
  // Thresholds
  minAcceptableConfidence: number;  // Minimum confidence for acceptance
  highQualityThreshold: number;     // Threshold for high-quality suggestions
  autoAcceptThreshold: number;      // Threshold for auto-acceptance
  
  // Validation settings
  enableStrictValidation: boolean;  // Enable strict validation checks
  penalizeGenericTerms: boolean;    // Reduce confidence for generic terms
  rewardSpecificity: boolean;       // Increase confidence for specific terms
}

/**
 * Core confidence scoring and suggestion processing service
 */
export class ConfidenceScorer {
  private config: ConfidenceScoringConfig;

  private static readonly DEFAULT_CONFIG: ConfidenceScoringConfig = {
    aiConsistencyWeight: 0.3,
    metadataAlignmentWeight: 0.25,
    structuralPatternWeight: 0.25,
    conventionComplianceWeight: 0.2,
    minAcceptableConfidence: 30,
    highQualityThreshold: 80,
    autoAcceptThreshold: 90,
    enableStrictValidation: true,
    penalizeGenericTerms: true,
    rewardSpecificity: true,
  };

  // Generic terms that should reduce confidence
  private static readonly GENERIC_TERMS = new Set([
    'file', 'document', 'image', 'photo', 'video', 'audio',
    'untitled', 'new', 'copy', 'temp', 'temporary', 'test',
    'data', 'stuff', 'misc', 'other', 'unknown', 'item',
    'thing', 'content', 'attachment', 'download'
  ]);

  // Filename patterns that indicate good structure
  private static readonly GOOD_PATTERNS = [
    /^\d{4}-\d{2}-\d{2}/, // Date prefix (YYYY-MM-DD)
    /^[a-z][a-z0-9-_]*$/, // Lowercase with separators
    /^[A-Z][a-zA-Z0-9]*$/, // PascalCase
    /^[a-z][a-zA-Z0-9]*$/, // camelCase
  ];

  // Filename patterns that indicate poor structure
  private static readonly BAD_PATTERNS = [
    /\s+/, // Contains spaces
    /[<>:"/\\|?*]/, // Contains invalid characters
    /\.{2,}/, // Multiple consecutive dots
    /^\./, // Starts with dot (except for hidden files)
    /\.$/, // Ends with dot
    /-{2,}|_{2,}/, // Multiple consecutive separators
    /^-|^_/, // Starts with separator
    /-$|_$/, // Ends with separator
  ];

  constructor(config: Partial<ConfidenceScoringConfig> = {}) {
    this.config = { ...ConfidenceScorer.DEFAULT_CONFIG, ...config };
  }

  /**
   * Process and score filename suggestions
   */
  public processFilenameSuggestions(
    suggestions: SuggestionItem[],
    originalFilename: string,
    fileMetadata: {
      extension: string;
      size: number;
      path: string;
      parentDirectory: string;
    }
  ): ProcessedSuggestion[] {
    const timerId = logger.startPerformanceTimer('ConfidenceScorer.processFilenameSuggestions');
    
    logger.info('ConfidenceScorer', `Processing ${suggestions.length} filename suggestions`, {
      originalFilename,
      fileExtension: fileMetadata.extension,
      suggestionsCount: suggestions.length,
      avgConfidence: suggestions.reduce((sum, s) => sum + s.confidence, 0) / suggestions.length
    });
    
    try {
      if (suggestions.length === 0) {
        logger.warn('ConfidenceScorer', 'No suggestions provided for processing', {
          originalFilename,
          filePath: fileMetadata.path
        });
        return [];
      }
      
      // Validate suggestions before processing
      const validSuggestions = suggestions.filter(suggestion => {
        if (!suggestion.value || suggestion.value.trim().length === 0) {
          logger.warn('ConfidenceScorer', 'Empty suggestion filtered out', {
            originalFilename,
            suggestion: suggestion.value
          });
          return false;
        }
        if (suggestion.confidence < 0 || suggestion.confidence > 100) {
          logger.warn('ConfidenceScorer', 'Invalid confidence score filtered out', {
            originalFilename,
            suggestion: suggestion.value,
            confidence: suggestion.confidence
          });
          return false;
        }
        return true;
      });
      
      if (validSuggestions.length !== suggestions.length) {
        logger.info('ConfidenceScorer', `Filtered out ${suggestions.length - validSuggestions.length} invalid suggestions`, {
          originalFilename,
          originalCount: suggestions.length,
          validCount: validSuggestions.length
        });
      }
      
      const processedSuggestions = validSuggestions.map((suggestion, index) => {
        try {
          return this.processSingleFilenameSuggestion(
            suggestion,
            originalFilename,
            fileMetadata,
            index
          );
        } catch (error) {
          logger.error('ConfidenceScorer', `Failed to process individual suggestion`, error as Error, {
            originalFilename,
            suggestion: suggestion.value,
            index
          });
          
          // Return a fallback suggestion with low confidence
          return {
            value: suggestion.value,
            confidence: 0,
            originalConfidence: suggestion.confidence,
            reasoning: `Processing failed: ${(error as Error).message}`,
            adjustedConfidence: 0,
            qualityScore: 0,
            validationFlags: ['processing-error'],
            isRecommended: false,
            rank: index + 1000 // Push to end
          };
        }
      });

      // Rank suggestions by quality score
      const rankedSuggestions = this.rankSuggestions(processedSuggestions);
      
      // Limit results to a reasonable number for performance
      const maxResults = 5;
      const limitedSuggestions = rankedSuggestions.slice(0, maxResults);
      
      logger.info('ConfidenceScorer', `Successfully processed filename suggestions`, {
        originalFilename,
        processedCount: rankedSuggestions.length,
        returnedCount: limitedSuggestions.length,
        topConfidence: limitedSuggestions[0]?.confidence || 0,
        avgQualityScore: limitedSuggestions.reduce((sum, s) => sum + s.qualityScore, 0) / limitedSuggestions.length
      });
      
      return limitedSuggestions;
      
    } catch (error) {
      const analysisError = new AnalysisError(
        AnalysisErrorType.VALIDATION_ERROR,
        `Failed to process filename suggestions: ${(error as Error).message}`,
        {
          fileName: originalFilename,
          stage: 'suggestion-processing',
          recoverable: true,
          cause: error as Error
        }
      );
      
      logger.error('ConfidenceScorer', 'Critical error processing filename suggestions', analysisError, {
        originalFilename,
        suggestionsCount: suggestions.length,
        fileMetadata
      });
      
      throw analysisError;
    } finally {
      logger.endPerformanceTimer(timerId, 'ConfidenceScorer', 'processFilenameSuggestions');
    }
  }

  /**
   * Process and score classification suggestions
   */
  public processClassificationSuggestions(
    suggestions: SuggestionItem[],
    fileMetadata: {
      extension: string;
      size: number;
      path: string;
      mimeType?: string;
    }
  ): ProcessedSuggestion[] {
    const processedSuggestions = suggestions.map((suggestion, index) => {
      return this.processSingleClassificationSuggestion(
        suggestion,
        fileMetadata,
        index
      );
    });

    return this.rankSuggestions(processedSuggestions);
  }

  /**
   * Process and score content summary suggestions  
   */
  public processContentSuggestions(
    suggestions: SuggestionItem[],
    fileMetadata: {
      extension: string;
      size: number;
      path: string;
    }
  ): ProcessedSuggestion[] {
    const processedSuggestions = suggestions.map((suggestion, index) => {
      return this.processSingleContentSuggestion(
        suggestion,
        fileMetadata,
        index
      );
    });

    return this.rankSuggestions(processedSuggestions);
  }

  /**
   * Process a single filename suggestion
   */
  private processSingleFilenameSuggestion(
    suggestion: SuggestionItem,
    originalFilename: string,
    fileMetadata: any,
    index: number
  ): ProcessedSuggestion {
    const validationFlags: string[] = [];
    let adjustedConfidence = suggestion.confidence;
    
    // Validate filename structure
    const structureScore = this.validateFilenameStructure(suggestion.value, validationFlags);
    
    // Check metadata alignment
    const alignmentScore = this.checkMetadataAlignment(suggestion.value, fileMetadata, validationFlags);
    
    // Check AI consistency
    const consistencyScore = this.checkAIConsistency(suggestion, validationFlags);
    
    // Check naming conventions
    const conventionScore = this.checkNamingConventions(suggestion.value, fileMetadata, validationFlags);
    
    // Calculate weighted confidence adjustment
    const weightedScore = 
      (structureScore * this.config.structuralPatternWeight) +
      (alignmentScore * this.config.metadataAlignmentWeight) +
      (consistencyScore * this.config.aiConsistencyWeight) +
      (conventionScore * this.config.conventionComplianceWeight);
    
    // Apply adjustment to original confidence
    adjustedConfidence = Math.min(100, Math.max(0, suggestion.confidence * (weightedScore / 100)));
    
    // Apply generic term penalty
    if (this.config.penalizeGenericTerms && this.containsGenericTerms(suggestion.value)) {
      adjustedConfidence *= 0.8;
      validationFlags.push('contains-generic-terms');
    }
    
    // Apply specificity reward
    if (this.config.rewardSpecificity && this.hasSpecificTerms(suggestion.value, originalFilename)) {
      adjustedConfidence = Math.min(100, adjustedConfidence * 1.1);
      validationFlags.push('specific-terminology');
    }
    
    // Calculate overall quality score
    const qualityScore = this.calculateQualityScore(
      adjustedConfidence,
      structureScore,
      alignmentScore,
      validationFlags
    );
    
    const processed: ProcessedSuggestion = {
      ...suggestion,
      originalConfidence: suggestion.confidence,
      adjustedConfidence: Math.round(adjustedConfidence),
      qualityScore: Math.round(qualityScore),
      validationFlags,
      isRecommended: qualityScore >= this.config.highQualityThreshold,
      rank: index + 1, // Will be re-ranked later
    };

    return processed;
  }

  /**
   * Process a single classification suggestion
   */
  private processSingleClassificationSuggestion(
    suggestion: SuggestionItem,
    fileMetadata: any,
    index: number
  ): ProcessedSuggestion {
    const validationFlags: string[] = [];
    let adjustedConfidence = suggestion.confidence;
    
    // Validate classification against file extension
    const extensionAlignment = this.validateClassificationExtension(
      suggestion.value,
      fileMetadata.extension,
      validationFlags
    );
    
    // Check classification specificity
    const specificityScore = this.checkClassificationSpecificity(suggestion.value, validationFlags);
    
    // Adjust confidence based on validation
    adjustedConfidence = suggestion.confidence * (extensionAlignment / 100) * (specificityScore / 100);
    
    const qualityScore = this.calculateQualityScore(
      adjustedConfidence,
      extensionAlignment,
      specificityScore,
      validationFlags
    );
    
    return {
      ...suggestion,
      originalConfidence: suggestion.confidence,
      adjustedConfidence: Math.round(adjustedConfidence),
      qualityScore: Math.round(qualityScore),
      validationFlags,
      isRecommended: qualityScore >= this.config.highQualityThreshold,
      rank: index + 1,
    };
  }

  /**
   * Process a single content suggestion
   */
  private processSingleContentSuggestion(
    suggestion: SuggestionItem,
    fileMetadata: any,
    index: number
  ): ProcessedSuggestion {
    const validationFlags: string[] = [];
    let adjustedConfidence = suggestion.confidence;
    
    // Check content relevance
    const relevanceScore = this.checkContentRelevance(suggestion.value, fileMetadata, validationFlags);
    
    // Check summary quality
    const qualityCheck = this.checkSummaryQuality(suggestion.value, validationFlags);
    
    adjustedConfidence = suggestion.confidence * (relevanceScore / 100) * (qualityCheck / 100);
    
    const qualityScore = this.calculateQualityScore(
      adjustedConfidence,
      relevanceScore,
      qualityCheck,
      validationFlags
    );
    
    return {
      ...suggestion,
      originalConfidence: suggestion.confidence,
      adjustedConfidence: Math.round(adjustedConfidence),
      qualityScore: Math.round(qualityScore),
      validationFlags,
      isRecommended: qualityScore >= this.config.highQualityThreshold,
      rank: index + 1,
    };
  }

  /**
   * Validate filename structure and patterns
   */
  private validateFilenameStructure(filename: string, flags: string[]): number {
    let score = 100;
    
    // Check for bad patterns
    for (const pattern of ConfidenceScorer.BAD_PATTERNS) {
      if (pattern.test(filename)) {
        score -= 20;
        const patternName = this.getPatternName(pattern);
        flags.push(`bad-pattern-${patternName}`);
        
        // Additional penalty for really problematic patterns
        if (pattern.source.includes('<>:"/\\\\|?*')) {
          score -= 10; // Extra penalty for filesystem-unsafe chars
        }
      }
    }
    
    // Check for good patterns
    let hasGoodPattern = false;
    for (const pattern of ConfidenceScorer.GOOD_PATTERNS) {
      if (pattern.test(filename)) {
        hasGoodPattern = true;
        const patternName = this.getPatternName(pattern);
        flags.push(`good-pattern-${patternName}`);
        break;
      }
    }
    
    if (!hasGoodPattern) {
      score -= 15; // Increased penalty for lack of good patterns
      flags.push('no-good-pattern');
    }
    
    // Check length
    if (filename.length < 3) {
      score -= 40; // Increased penalty
      flags.push('too-short');
    } else if (filename.length > 100) {
      score -= 25; // Increased penalty
      flags.push('too-long');
    }
    
    // Check for proper extension handling
    const parts = filename.split('.');
    if (parts.length < 2) {
      score -= 30;
      flags.push('missing-extension');
    } else if (parts.length > 3) {
      score -= 10;
      flags.push('too-many-dots');
    }
    
    return Math.max(0, score);
  }

  /**
   * Get human-readable name for regex pattern
   */
  private getPatternName(pattern: RegExp): string {
    const source = pattern.source;
    if (source.includes('\\s+')) return 'spaces';
    if (source.includes('[<>:"/\\\\|?*]')) return 'invalid-chars';
    if (source.includes('\\.{2,}')) return 'multiple-dots';
    if (source.includes('^-|^_')) return 'starts-with-separator';
    if (source.includes('-$|_$')) return 'ends-with-separator';
    if (source.includes('^[a-z][a-z0-9-_]*$')) return 'lowercase-with-separators';
    if (source.includes('^\\d{4}-\\d{2}-\\d{2}')) return 'date-prefix';
    return source.substring(0, 10);
  }

  /**
   * Check metadata alignment
   */
  private checkMetadataAlignment(filename: string, metadata: any, flags: string[]): number {
    let score = 100;
    
    // Check if extension is preserved
    if (!filename.endsWith(metadata.extension)) {
      score -= 50;
      flags.push('missing-extension');
    }
    
    // Check path context alignment
    if (metadata.parentDirectory) {
      const dirName = metadata.parentDirectory.split('/').pop()?.toLowerCase();
      const filenameLower = filename.toLowerCase();
      
      // Simple check for directory name in filename
      if (dirName && dirName !== 'downloads' && dirName !== 'desktop') {
        if (filenameLower.includes(dirName) || dirName.includes(filenameLower.split('.')[0])) {
          score += 10;
          flags.push('directory-alignment');
        }
      }
    }
    
    return Math.min(100, Math.max(0, score));
  }

  /**
   * Check AI consistency factors
   */
  private checkAIConsistency(suggestion: SuggestionItem, flags: string[]): number {
    let score = 100;
    
    // Check if reasoning supports the suggestion
    if (suggestion.reasoning) {
      const reasoningLower = suggestion.reasoning.toLowerCase();
      const suggestionLower = suggestion.value.toLowerCase();
      
      // Simple keyword alignment check
      const suggestionWords = suggestionLower.split(/[-_\s]+/).filter(w => w.length > 2);
      const reasoningWords = reasoningLower.split(/\s+/);
      
      const alignedWords = suggestionWords.filter(word => 
        reasoningWords.some(reasonWord => reasonWord.includes(word))
      );
      
      const alignmentRatio = alignedWords.length / suggestionWords.length;
      if (alignmentRatio < 0.3) {
        score -= 20;
        flags.push('reasoning-mismatch');
      } else if (alignmentRatio > 0.7) {
        score += 10;
        flags.push('strong-reasoning-alignment');
      }
    }
    
    return Math.max(0, score);
  }

  /**
   * Check naming convention compliance
   */
  private checkNamingConventions(filename: string, metadata: any, flags: string[]): number {
    let score = 100;
    
    // Check for consistent separator usage
    const hasHyphens = filename.includes('-');
    const hasUnderscores = filename.includes('_');
    
    if (hasHyphens && hasUnderscores) {
      score -= 10;
      flags.push('mixed-separators');
    }
    
    // Check case consistency
    const nameWithoutExt = filename.replace(/\.[^.]*$/, '');
    const isAllLower = nameWithoutExt === nameWithoutExt.toLowerCase();
    const isAllUpper = nameWithoutExt === nameWithoutExt.toUpperCase();
    const isPascal = /^[A-Z][a-zA-Z0-9]*$/.test(nameWithoutExt);
    const isCamel = /^[a-z][a-zA-Z0-9]*$/.test(nameWithoutExt);
    
    if (!isAllLower && !isAllUpper && !isPascal && !isCamel) {
      score -= 15;
      flags.push('inconsistent-case');
    } else {
      flags.push('consistent-case');
    }
    
    return Math.max(0, score);
  }

  /**
   * Check if filename contains generic terms
   */
  private containsGenericTerms(filename: string): boolean {
    const words = filename.toLowerCase().split(/[-_\s.]+/);
    return words.some(word => ConfidenceScorer.GENERIC_TERMS.has(word));
  }

  /**
   * Check if filename has specific, descriptive terms
   */
  private hasSpecificTerms(filename: string, originalFilename: string): boolean {
    const newWords = filename.toLowerCase().split(/[-_\s.]+/);
    const originalWords = originalFilename.toLowerCase().split(/[-_\s.]+/);
    
    // Count new descriptive words (length > 3, not generic)
    const newDescriptiveWords = newWords.filter(word => 
      word.length > 3 && 
      !ConfidenceScorer.GENERIC_TERMS.has(word) &&
      !originalWords.includes(word)
    );
    
    return newDescriptiveWords.length >= 2;
  }

  /**
   * Validate classification against file extension
   */
  private validateClassificationExtension(classification: string, extension: string, flags: string[]): number {
    const ext = extension.toLowerCase();
    const classLower = classification.toLowerCase();
    
    // Define extension mappings
    const extensionMappings = {
      'document': ['.txt', '.md', '.doc', '.docx', '.pdf', '.rtf'],
      'image': ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.svg'],
      'media': ['.mp4', '.avi', '.mov', '.mp3', '.wav'],
      'code': ['.js', '.ts', '.py', '.java', '.cpp', '.html'],
      'data': ['.json', '.xml', '.csv', '.yaml', '.sql'],
      'archive': ['.zip', '.rar', '.7z', '.tar'],
    };
    
    for (const [category, extensions] of Object.entries(extensionMappings)) {
      if (classLower.includes(category) && extensions.includes(ext)) {
        flags.push('extension-aligned');
        return 100;
      }
    }
    
    // Partial alignment check
    if (classLower.includes('file') || classLower.includes('document')) {
      flags.push('generic-classification');
      return 60;
    }
    
    flags.push('extension-misaligned');
    return 30;
  }

  /**
   * Check classification specificity
   */
  private checkClassificationSpecificity(classification: string, flags: string[]): number {
    const words = classification.toLowerCase().split(/\s+/);
    
    if (words.some(word => ConfidenceScorer.GENERIC_TERMS.has(word))) {
      flags.push('generic-classification');
      return 60;
    }
    
    if (words.length > 3) {
      flags.push('detailed-classification');
      return 100;
    }
    
    if (words.length >= 2) {
      flags.push('specific-classification');
      return 90;
    }
    
    flags.push('vague-classification');
    return 70;
  }

  /**
   * Check content relevance
   */
  private checkContentRelevance(content: string, metadata: any, flags: string[]): number {
    // Simple heuristic - longer, more detailed content is generally better
    if (content.length < 20) {
      flags.push('too-brief');
      return 40;
    }
    
    if (content.length > 500) {
      flags.push('very-detailed');
      return 100;
    }
    
    if (content.length > 100) {
      flags.push('detailed');
      return 90;
    }
    
    flags.push('adequate-detail');
    return 75;
  }

  /**
   * Check summary quality
   */
  private checkSummaryQuality(summary: string, flags: string[]): number {
    let score = 100;
    
    // Check for complete sentences
    const sentences = summary.split(/[.!?]+/).filter(s => s.trim());
    if (sentences.length < 1) {
      score -= 30;
      flags.push('no-complete-sentences');
    }
    
    // Check for specific terminology
    const words = summary.toLowerCase().split(/\s+/);
    const specificWords = words.filter(word => 
      word.length > 4 && 
      !ConfidenceScorer.GENERIC_TERMS.has(word)
    );
    
    if (specificWords.length / words.length > 0.3) {
      score += 10;
      flags.push('specific-terminology');
    }
    
    return Math.max(0, score);
  }

  /**
   * Calculate overall quality score - overloaded for different parameter combinations
   */
  private calculateQualityScore(
    adjustedConfidence: number,
    structureScore: number,
    alignmentScore: number,
    validationFlags: string[]
  ): number;
  private calculateQualityScore(
    adjustedConfidence: number,
    score1: number,
    score2: number,
    validationFlags: string[]
  ): number;
  private calculateQualityScore(
    adjustedConfidence: number,
    score1: number,
    score2: number,
    validationFlags: string[]
  ): number {
    const scores = [adjustedConfidence, score1, score2];
    
    // Apply penalties based on validation flags
    let penalty = 0;
    validationFlags.forEach(flag => {
      if (flag.startsWith('bad-') || flag.includes('missing-') || flag.includes('error')) {
        penalty += 5;
      }
    });
    
    const average = scores.reduce((sum, score) => sum + score, 0) / scores.length;
    const finalScore = Math.max(0, average - penalty);
    
    return Math.min(100, finalScore);
  }

  /**
   * Rank suggestions by quality score and confidence
   */
  private rankSuggestions(suggestions: ProcessedSuggestion[]): ProcessedSuggestion[] {
    // Sort by quality score first, then by adjusted confidence
    const ranked = suggestions.sort((a, b) => {
      if (b.qualityScore !== a.qualityScore) {
        return b.qualityScore - a.qualityScore;
      }
      return b.adjustedConfidence - a.adjustedConfidence;
    });
    
    // Update rank numbers
    ranked.forEach((suggestion, index) => {
      suggestion.rank = index + 1;
    });
    
    return ranked;
  }

  /**
   * Deduplicate suggestions
   */
  public deduplicateSuggestions(suggestions: ProcessedSuggestion[]): ProcessedSuggestion[] {
    const seen = new Set<string>();
    const deduplicated: ProcessedSuggestion[] = [];
    
    for (const suggestion of suggestions) {
      const normalized = suggestion.value.toLowerCase().trim();
      
      if (!seen.has(normalized)) {
        seen.add(normalized);
        deduplicated.push(suggestion);
      }
    }
    
    return deduplicated;
  }

  /**
   * Calculate metrics for a set of suggestions
   */
  public calculateMetrics(suggestions: ProcessedSuggestion[]): SuggestionMetrics {
    const validSuggestions = suggestions.filter(s => 
      s.adjustedConfidence >= this.config.minAcceptableConfidence
    );
    
    const highQualitySuggestions = suggestions.filter(s => 
      s.qualityScore >= this.config.highQualityThreshold
    );
    
    const avgConfidence = suggestions.length > 0
      ? suggestions.reduce((sum, s) => sum + s.adjustedConfidence, 0) / suggestions.length
      : 0;
    
    const avgQuality = suggestions.length > 0
      ? suggestions.reduce((sum, s) => sum + s.qualityScore, 0) / suggestions.length
      : 0;
    
    // Get most common validation flags
    const flagCounts = new Map<string, number>();
    suggestions.forEach(s => {
      s.validationFlags.forEach(flag => {
        flagCounts.set(flag, (flagCounts.get(flag) || 0) + 1);
      });
    });
    
    const commonIssues = Array.from(flagCounts.entries())
      .filter(([flag, count]) => count >= 2 && flag.includes('bad-') || flag.includes('missing-') || flag.includes('error'))
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([flag, _]) => flag);
    
    return {
      totalSuggestions: suggestions.length,
      validSuggestions: validSuggestions.length,
      highQualitySuggestions: highQualitySuggestions.length,
      averageConfidence: Math.round(avgConfidence),
      averageQualityScore: Math.round(avgQuality),
      commonIssues,
    };
  }

  /**
   * Get configuration
   */
  public getConfig(): ConfidenceScoringConfig {
    return { ...this.config };
  }

  /**
   * Update configuration
   */
  public updateConfig(updates: Partial<ConfidenceScoringConfig>): void {
    this.config = { ...this.config, ...updates };
  }
}

// Singleton instance
let scorerInstance: ConfidenceScorer | null = null;

export function getConfidenceScorer(config?: Partial<ConfidenceScoringConfig>): ConfidenceScorer {
  if (!scorerInstance) {
    scorerInstance = new ConfidenceScorer(config);
  }
  return scorerInstance;
}

export function destroyConfidenceScorer(): void {
  scorerInstance = null;
}
