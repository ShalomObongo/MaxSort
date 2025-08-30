/**
 * Confidence Statistics and Reporting System
 * 
 * Provides comprehensive metrics calculation, aggregation, and trend analysis
 * for confidence-based suggestion filtering effectiveness.
 */

import { logger } from './logger';
import { ProcessedSuggestion } from './confidence-scorer';
import { FilteredSuggestion, SuggestionCategory } from './confidence-threshold-config';

export interface ConfidenceMetrics {
    totalSuggestions: number;
    averageConfidence: number;
    medianConfidence: number;
    confidenceStandardDeviation: number;
    qualityScoreAverage: number;
    recommendationRate: number; // Percentage of suggestions marked as recommended
}

export interface FilteringEffectiveness {
    autoApprovalRate: number;
    manualReviewRate: number;
    rejectionRate: number;
    filteringAccuracy: number; // Based on user feedback if available
    timeToDecision: number; // Average time from suggestion to decision (ms)
    userOverrideRate: number; // How often users override AI categorization
}

export interface ConfidenceDistribution {
    ranges: Array<{
        label: string;
        min: number;
        max: number;
        count: number;
        percentage: number;
        averageQuality: number;
    }>;
    histogram: Array<{
        bucket: number; // 0.0-0.1, 0.1-0.2, etc.
        count: number;
        percentage: number;
    }>;
}

export interface QualityDistribution {
    byConfidenceRange: Array<{
        confidenceRange: string;
        averageQuality: number;
        qualityStandardDeviation: number;
        sampleSize: number;
    }>;
    byCategory: Map<SuggestionCategory, {
        averageQuality: number;
        count: number;
        qualityRange: { min: number; max: number; };
    }>;
}

export interface TrendData {
    timestamp: Date;
    metrics: ConfidenceMetrics;
    effectiveness: FilteringEffectiveness;
    sampleSize: number;
}

export interface HistoricalTrends {
    daily: TrendData[];
    weekly: TrendData[];
    monthly: TrendData[];
    confidenceTrendDirection: 'improving' | 'declining' | 'stable';
    qualityTrendDirection: 'improving' | 'declining' | 'stable';
    effectivenessTrendDirection: 'improving' | 'declining' | 'stable';
}

export interface StatisticsReport {
    generatedAt: Date;
    timeRange: {
        start: Date;
        end: Date;
    };
    metrics: ConfidenceMetrics;
    effectiveness: FilteringEffectiveness;
    distribution: ConfidenceDistribution;
    qualityDistribution: QualityDistribution;
    trends: HistoricalTrends;
    insights: string[];
    recommendations: string[];
}

/**
 * Core confidence statistics calculator and aggregator
 */
export class ConfidenceStatisticsCalculator {
    private historicalData: TrendData[] = [];
    private category: string = 'ConfidenceStatistics';

    constructor() {
        this.loadHistoricalData();
    }

    /**
     * Calculate comprehensive metrics from suggestion data
     */
    calculateMetrics(suggestions: ProcessedSuggestion[]): ConfidenceMetrics {
        if (suggestions.length === 0) {
            return this.getEmptyMetrics();
        }

        const confidences = suggestions.map(s => s.adjustedConfidence);
        const qualityScores = suggestions.map(s => s.qualityScore);
        const recommended = suggestions.filter(s => s.isRecommended);

        // Calculate basic statistics
        const totalSuggestions = suggestions.length;
        const averageConfidence = confidences.reduce((sum, c) => sum + c, 0) / totalSuggestions;
        const medianConfidence = this.calculateMedian(confidences);
        const confidenceStandardDeviation = this.calculateStandardDeviation(confidences, averageConfidence);
        const qualityScoreAverage = qualityScores.reduce((sum, q) => sum + q, 0) / totalSuggestions;
        const recommendationRate = (recommended.length / totalSuggestions) * 100;

        return {
            totalSuggestions,
            averageConfidence,
            medianConfidence,
            confidenceStandardDeviation,
            qualityScoreAverage,
            recommendationRate
        };
    }

    /**
     * Calculate filtering effectiveness metrics
     */
    calculateFilteringEffectiveness(
        filteredSuggestions: FilteredSuggestion[],
        userDecisions?: Array<{
            suggestionId: string;
            userDecision: 'approve' | 'reject';
            aiCategory: SuggestionCategory;
            decisionTime: number;
        }>
    ): FilteringEffectiveness {
        if (filteredSuggestions.length === 0) {
            return this.getEmptyEffectiveness();
        }

        const total = filteredSuggestions.length;
        const autoApproved = filteredSuggestions.filter(s => s.category === SuggestionCategory.AUTO_APPROVE).length;
        const manualReview = filteredSuggestions.filter(s => s.category === SuggestionCategory.MANUAL_REVIEW).length;
        const rejected = filteredSuggestions.filter(s => s.category === SuggestionCategory.REJECT).length;

        const autoApprovalRate = (autoApproved / total) * 100;
        const manualReviewRate = (manualReview / total) * 100;
        const rejectionRate = (rejected / total) * 100;

        let filteringAccuracy = 0;
        let timeToDecision = 0;
        let userOverrideRate = 0;

        if (userDecisions && userDecisions.length > 0) {
            // Calculate accuracy based on user agreement with AI categorization
            const agreements = userDecisions.filter(d => {
                const aiWantedApproval = d.aiCategory === SuggestionCategory.AUTO_APPROVE;
                const userApproved = d.userDecision === 'approve';
                return aiWantedApproval === userApproved;
            });
            filteringAccuracy = (agreements.length / userDecisions.length) * 100;

            // Calculate average time to decision
            timeToDecision = userDecisions.reduce((sum, d) => sum + d.decisionTime, 0) / userDecisions.length;

            // Calculate override rate (when user decision differs from AI category)
            const overrides = userDecisions.filter(d => {
                const aiWantedApproval = d.aiCategory === SuggestionCategory.AUTO_APPROVE;
                const userApproved = d.userDecision === 'approve';
                return aiWantedApproval !== userApproved;
            });
            userOverrideRate = (overrides.length / userDecisions.length) * 100;
        }

        return {
            autoApprovalRate,
            manualReviewRate,
            rejectionRate,
            filteringAccuracy,
            timeToDecision,
            userOverrideRate
        };
    }

    /**
     * Generate confidence distribution analysis
     */
    calculateConfidenceDistribution(suggestions: ProcessedSuggestion[]): ConfidenceDistribution {
        if (suggestions.length === 0) {
            return { ranges: [], histogram: [] };
        }

        // Define confidence ranges
        const ranges = [
            { label: 'Very Low (0-20%)', min: 0.0, max: 0.2 },
            { label: 'Low (20-40%)', min: 0.2, max: 0.4 },
            { label: 'Moderate (40-60%)', min: 0.4, max: 0.6 },
            { label: 'Good (60-80%)', min: 0.6, max: 0.8 },
            { label: 'High (80-90%)', min: 0.8, max: 0.9 },
            { label: 'Very High (90-100%)', min: 0.9, max: 1.0 }
        ];

        const total = suggestions.length;
        const distribution = ranges.map(range => {
            const inRange = suggestions.filter(s => 
                s.adjustedConfidence >= range.min && s.adjustedConfidence < range.max
            );
            const count = inRange.length;
            const percentage = (count / total) * 100;
            const averageQuality = count > 0 
                ? inRange.reduce((sum, s) => sum + s.qualityScore, 0) / count 
                : 0;

            return {
                label: range.label,
                min: range.min,
                max: range.max,
                count,
                percentage,
                averageQuality
            };
        });

        // Create histogram with 10 buckets (0.0-0.1, 0.1-0.2, etc.)
        const histogram = Array.from({ length: 10 }, (_, i) => {
            const bucketMin = i * 0.1;
            const bucketMax = (i + 1) * 0.1;
            const inBucket = suggestions.filter(s => 
                s.adjustedConfidence >= bucketMin && 
                (i === 9 ? s.adjustedConfidence <= bucketMax : s.adjustedConfidence < bucketMax)
            ).length;
            
            return {
                bucket: i,
                count: inBucket,
                percentage: (inBucket / total) * 100
            };
        });

        return { ranges: distribution, histogram };
    }

    /**
     * Analyze quality distribution across confidence ranges and categories
     */
    calculateQualityDistribution(
        suggestions: ProcessedSuggestion[],
        filteredSuggestions?: FilteredSuggestion[]
    ): QualityDistribution {
        const byConfidenceRange = [
            { range: '0-50%', min: 0.0, max: 0.5 },
            { range: '50-70%', min: 0.5, max: 0.7 },
            { range: '70-85%', min: 0.7, max: 0.85 },
            { range: '85-95%', min: 0.85, max: 0.95 },
            { range: '95-100%', min: 0.95, max: 1.0 }
        ].map(range => {
            const inRange = suggestions.filter(s => 
                s.adjustedConfidence >= range.min && s.adjustedConfidence < range.max
            );
            const qualities = inRange.map(s => s.qualityScore);
            const averageQuality = qualities.length > 0 
                ? qualities.reduce((sum, q) => sum + q, 0) / qualities.length 
                : 0;
            const qualityStandardDeviation = this.calculateStandardDeviation(qualities, averageQuality);

            return {
                confidenceRange: range.range,
                averageQuality,
                qualityStandardDeviation,
                sampleSize: inRange.length
            };
        });

        // Quality by category
        const byCategory = new Map<SuggestionCategory, any>();
        if (filteredSuggestions) {
            Object.values(SuggestionCategory).forEach(category => {
                const inCategory = filteredSuggestions.filter(fs => fs.category === category);
                const qualities = inCategory.map(fs => 
                    (fs.originalSuggestion as ProcessedSuggestion).qualityScore
                );
                
                if (qualities.length > 0) {
                    const averageQuality = qualities.reduce((sum, q) => sum + q, 0) / qualities.length;
                    const min = Math.min(...qualities);
                    const max = Math.max(...qualities);
                    
                    byCategory.set(category, {
                        averageQuality,
                        count: qualities.length,
                        qualityRange: { min, max }
                    });
                }
            });
        }

        return { byConfidenceRange, byCategory };
    }

    /**
     * Analyze historical trends and patterns
     */
    calculateHistoricalTrends(days: number = 30): HistoricalTrends {
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - days);
        
        const recentData = this.historicalData.filter(d => d.timestamp >= cutoffDate);
        
        if (recentData.length < 2) {
            return this.getEmptyTrends();
        }

        // Sort by timestamp
        recentData.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

        // Aggregate data by time periods
        const daily = this.aggregateByPeriod(recentData, 'daily');
        const weekly = this.aggregateByPeriod(recentData, 'weekly');
        const monthly = this.aggregateByPeriod(recentData, 'monthly');

        // Calculate trend directions
        const confidenceTrendDirection = this.calculateTrendDirection(
            recentData.map(d => d.metrics.averageConfidence)
        );
        const qualityTrendDirection = this.calculateTrendDirection(
            recentData.map(d => d.metrics.qualityScoreAverage)
        );
        const effectivenessTrendDirection = this.calculateTrendDirection(
            recentData.map(d => d.effectiveness.autoApprovalRate)
        );

        return {
            daily,
            weekly,
            monthly,
            confidenceTrendDirection,
            qualityTrendDirection,
            effectivenessTrendDirection
        };
    }

    /**
     * Generate comprehensive statistics report
     */
    generateReport(
        suggestions: ProcessedSuggestion[],
        filteredSuggestions: FilteredSuggestion[],
        userDecisions?: Array<{
            suggestionId: string;
            userDecision: 'approve' | 'reject';
            aiCategory: SuggestionCategory;
            decisionTime: number;
        }>,
        timeRange?: { start: Date; end: Date; }
    ): StatisticsReport {
        const generatedAt = new Date();
        const reportTimeRange = timeRange || {
            start: new Date(Date.now() - (30 * 24 * 60 * 60 * 1000)), // 30 days ago
            end: generatedAt
        };

        const metrics = this.calculateMetrics(suggestions);
        const effectiveness = this.calculateFilteringEffectiveness(filteredSuggestions, userDecisions);
        const distribution = this.calculateConfidenceDistribution(suggestions);
        const qualityDistribution = this.calculateQualityDistribution(suggestions, filteredSuggestions);
        const trends = this.calculateHistoricalTrends();

        // Generate insights and recommendations
        const insights = this.generateInsights(metrics, effectiveness, distribution);
        const recommendations = this.generateRecommendations(metrics, effectiveness, trends);

        const report: StatisticsReport = {
            generatedAt,
            timeRange: reportTimeRange,
            metrics,
            effectiveness,
            distribution,
            qualityDistribution,
            trends,
            insights,
            recommendations
        };

        // Store this data point for historical tracking
        this.addDataPoint({
            timestamp: generatedAt,
            metrics,
            effectiveness,
            sampleSize: suggestions.length
        });

        logger.info(this.category, 'Generated confidence statistics report', {
            sampleSize: suggestions.length,
            averageConfidence: metrics.averageConfidence,
            autoApprovalRate: effectiveness.autoApprovalRate
        });

        return report;
    }

    /**
     * Add a data point to historical tracking
     */
    addDataPoint(data: TrendData): void {
        this.historicalData.push(data);
        
        // Keep only last 365 days of data
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - 365);
        this.historicalData = this.historicalData.filter(d => d.timestamp >= cutoffDate);
        
        // Persist to storage
        this.saveHistoricalData();
    }

    /**
     * Export statistics for external analysis
     */
    exportStatistics(format: 'json' | 'csv' = 'json'): string {
        const exportData = {
            exportedAt: new Date().toISOString(),
            historicalData: this.historicalData,
            summary: {
                totalDataPoints: this.historicalData.length,
                dateRange: this.historicalData.length > 0 ? {
                    start: Math.min(...this.historicalData.map(d => d.timestamp.getTime())),
                    end: Math.max(...this.historicalData.map(d => d.timestamp.getTime()))
                } : null
            }
        };

        if (format === 'json') {
            return JSON.stringify(exportData, null, 2);
        } else {
            return this.convertToCSV(exportData);
        }
    }

    // Private helper methods

    private getEmptyMetrics(): ConfidenceMetrics {
        return {
            totalSuggestions: 0,
            averageConfidence: 0,
            medianConfidence: 0,
            confidenceStandardDeviation: 0,
            qualityScoreAverage: 0,
            recommendationRate: 0
        };
    }

    private getEmptyEffectiveness(): FilteringEffectiveness {
        return {
            autoApprovalRate: 0,
            manualReviewRate: 0,
            rejectionRate: 0,
            filteringAccuracy: 0,
            timeToDecision: 0,
            userOverrideRate: 0
        };
    }

    private getEmptyTrends(): HistoricalTrends {
        return {
            daily: [],
            weekly: [],
            monthly: [],
            confidenceTrendDirection: 'stable',
            qualityTrendDirection: 'stable',
            effectivenessTrendDirection: 'stable'
        };
    }

    private calculateMedian(values: number[]): number {
        const sorted = [...values].sort((a, b) => a - b);
        const mid = Math.floor(sorted.length / 2);
        return sorted.length % 2 === 0 
            ? (sorted[mid - 1] + sorted[mid]) / 2 
            : sorted[mid];
    }

    private calculateStandardDeviation(values: number[], mean: number): number {
        if (values.length === 0) return 0;
        const variance = values.reduce((sum, value) => sum + Math.pow(value - mean, 2), 0) / values.length;
        return Math.sqrt(variance);
    }

    private calculateTrendDirection(values: number[]): 'improving' | 'declining' | 'stable' {
        if (values.length < 2) return 'stable';
        
        const firstHalf = values.slice(0, Math.floor(values.length / 2));
        const secondHalf = values.slice(Math.floor(values.length / 2));
        
        const firstAvg = firstHalf.reduce((sum, v) => sum + v, 0) / firstHalf.length;
        const secondAvg = secondHalf.reduce((sum, v) => sum + v, 0) / secondHalf.length;
        
        const change = ((secondAvg - firstAvg) / firstAvg) * 100;
        
        if (change > 2) return 'improving';
        if (change < -2) return 'declining';
        return 'stable';
    }

    private aggregateByPeriod(data: TrendData[], period: 'daily' | 'weekly' | 'monthly'): TrendData[] {
        // Simplified aggregation - in real implementation would group by actual time periods
        return data; // For now, return daily data as-is
    }

    private generateInsights(
        metrics: ConfidenceMetrics,
        effectiveness: FilteringEffectiveness,
        distribution: ConfidenceDistribution
    ): string[] {
        const insights: string[] = [];

        // Confidence insights
        if (metrics.averageConfidence > 0.8) {
            insights.push('✅ High average confidence (>80%) indicates reliable AI suggestions');
        } else if (metrics.averageConfidence < 0.6) {
            insights.push('⚠️ Low average confidence (<60%) may require model tuning or additional context');
        }

        // Distribution insights
        const highConfidenceSuggestions = distribution.ranges
            .filter(r => r.min >= 0.8)
            .reduce((sum, r) => sum + r.count, 0);
        const highConfidencePercentage = (highConfidenceSuggestions / metrics.totalSuggestions) * 100;
        
        if (highConfidencePercentage > 50) {
            insights.push(`🎯 ${highConfidencePercentage.toFixed(1)}% of suggestions have high confidence (>80%)`);
        }

        // Effectiveness insights
        if (effectiveness.autoApprovalRate > 40) {
            insights.push(`⚡ High auto-approval rate (${effectiveness.autoApprovalRate.toFixed(1)}%) enables efficient processing`);
        }
        if (effectiveness.userOverrideRate > 20) {
            insights.push(`🔄 High override rate (${effectiveness.userOverrideRate.toFixed(1)}%) suggests threshold adjustment needed`);
        }

        return insights;
    }

    private generateRecommendations(
        metrics: ConfidenceMetrics,
        effectiveness: FilteringEffectiveness,
        trends: HistoricalTrends
    ): string[] {
        const recommendations: string[] = [];

        // Confidence-based recommendations
        if (metrics.averageConfidence < 0.7) {
            recommendations.push('Consider increasing confidence threshold for auto-approval to improve safety');
        }
        if (effectiveness.manualReviewRate > 60) {
            recommendations.push('High manual review rate - consider lowering confidence thresholds or improving AI model');
        }

        // Trend-based recommendations
        if (trends.confidenceTrendDirection === 'declining') {
            recommendations.push('Declining confidence trend detected - review AI model performance and training data');
        }
        if (trends.effectivenessTrendDirection === 'improving') {
            recommendations.push('Improving effectiveness trend - current settings are working well');
        }

        // Quality recommendations
        if (metrics.qualityScoreAverage < 70) {
            recommendations.push('Low quality scores indicate need for improved suggestion validation');
        }

        return recommendations;
    }

    private loadHistoricalData(): void {
        try {
            // In a real implementation, this would load from persistent storage
            // For now, initialize with empty array
            this.historicalData = [];
        } catch (error) {
            logger.error(this.category, 'Failed to load historical data', error instanceof Error ? error : undefined);
            this.historicalData = [];
        }
    }

    private saveHistoricalData(): void {
        try {
            // In a real implementation, this would save to persistent storage
            logger.debug(this.category, 'Historical data saved', {
                dataPoints: this.historicalData.length
            });
        } catch (error) {
            logger.error(this.category, 'Failed to save historical data', error instanceof Error ? error : undefined);
        }
    }

    private convertToCSV(data: any): string {
        // Simplified CSV conversion - would need more robust implementation
        const headers = ['timestamp', 'averageConfidence', 'qualityScoreAverage', 'autoApprovalRate', 'sampleSize'];
        const rows = data.historicalData.map((d: TrendData) => [
            d.timestamp.toISOString(),
            d.metrics.averageConfidence,
            d.metrics.qualityScoreAverage,
            d.effectiveness.autoApprovalRate,
            d.sampleSize
        ]);
        
        return [headers.join(','), ...rows.map((row: string[]) => row.join(','))].join('\n');
    }
}

// Export singleton instance
export const confidenceStatisticsCalculator = new ConfidenceStatisticsCalculator();
