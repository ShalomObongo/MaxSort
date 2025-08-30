import React, { useState, useEffect, useMemo } from 'react';
import { 
    ConfidenceStatisticsCalculator,
    StatisticsReport,
    ConfidenceMetrics,
    FilteringEffectiveness,
    ConfidenceDistribution,
    HistoricalTrends
} from '../../lib/confidence-statistics';
import { SuggestionCategory } from '../../lib/confidence-threshold-config';
import './ConfidenceStatisticsDashboard.css';

interface ConfidenceStatisticsDashboardProps {
    calculator: ConfidenceStatisticsCalculator;
    refreshInterval?: number; // Auto-refresh interval in milliseconds
}

interface ChartData {
    labels: string[];
    values: number[];
    colors?: string[];
}

export const ConfidenceStatisticsDashboard: React.FC<ConfidenceStatisticsDashboardProps> = ({ 
    calculator, 
    refreshInterval = 60000 // Default 1 minute
}) => {
    const [report, setReport] = useState<StatisticsReport | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [selectedTimeRange, setSelectedTimeRange] = useState<'7d' | '30d' | '90d'>('30d');
    const [activeTab, setActiveTab] = useState<'overview' | 'distribution' | 'trends' | 'insights'>('overview');
    const [exportFormat, setExportFormat] = useState<'json' | 'csv'>('json');

    // Auto-refresh effect
    useEffect(() => {
        const loadReport = async () => {
            try {
                setLoading(true);
                setError(null);
                
                // For now, generate sample data for demonstration
                // In a real implementation, this would fetch actual suggestion data from the calculator
                const sampleReport = await generateSampleReport(calculator);
                setReport(sampleReport);
            } catch (err) {
                setError(err instanceof Error ? err.message : 'Failed to load statistics');
                console.error('Failed to load confidence statistics:', err);
            } finally {
                setLoading(false);
            }
        };

        loadReport();
        
        if (refreshInterval > 0) {
            const interval = setInterval(loadReport, refreshInterval);
            return () => clearInterval(interval);
        }
    }, [calculator, refreshInterval, selectedTimeRange]);

    // Memoized chart data
    const distributionChartData = useMemo((): ChartData => {
        if (!report?.distribution?.ranges) return { labels: [], values: [] };
        
        return {
            labels: report.distribution.ranges.map(r => r.label),
            values: report.distribution.ranges.map(r => r.percentage),
            colors: [
                '#ef4444', // Very Low - Red
                '#f97316', // Low - Orange  
                '#eab308', // Moderate - Yellow
                '#22c55e', // Good - Green
                '#06b6d4', // High - Cyan
                '#8b5cf6'  // Very High - Purple
            ]
        };
    }, [report]);

    const trendChartData = useMemo((): ChartData => {
        if (!report?.trends?.daily) return { labels: [], values: [] };
        
        return {
            labels: report.trends.daily.map(d => 
                d.timestamp.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
            ),
            values: report.trends.daily.map(d => d.metrics.averageConfidence * 100)
        };
    }, [report]);

    const handleExport = () => {
        if (!calculator) return;
        
        try {
            const exportData = calculator.exportStatistics(exportFormat);
            const blob = new Blob([exportData], { 
                type: exportFormat === 'json' ? 'application/json' : 'text/csv' 
            });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = `confidence-statistics-${new Date().toISOString().split('T')[0]}.${exportFormat}`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);
        } catch (err) {
            setError('Failed to export statistics');
            console.error('Export error:', err);
        }
    };

    if (loading) {
        return (
            <div className="statistics-dashboard loading">
                <div className="loading-spinner">
                    <div className="spinner"></div>
                    <p>Loading confidence statistics...</p>
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="statistics-dashboard error">
                <div className="error-message">
                    <h3>Error Loading Statistics</h3>
                    <p>{error}</p>
                    <button onClick={() => window.location.reload()}>Retry</button>
                </div>
            </div>
        );
    }

    if (!report) {
        return (
            <div className="statistics-dashboard no-data">
                <div className="no-data-message">
                    <h3>No Statistics Available</h3>
                    <p>No confidence data found for the selected time range.</p>
                </div>
            </div>
        );
    }

    return (
        <div className="statistics-dashboard">
            {/* Header */}
            <div className="dashboard-header">
                <div className="header-content">
                    <h2>Confidence Statistics Dashboard</h2>
                    <p className="last-updated">
                        Last updated: {report?.generatedAt ? report.generatedAt.toLocaleString() : 'Loading...'}
                    </p>
                </div>
                
                <div className="header-controls">
                    <div className="time-range-selector">
                        <label>Time Range:</label>
                        <select 
                            value={selectedTimeRange} 
                            onChange={(e) => setSelectedTimeRange(e.target.value as any)}
                        >
                            <option value="7d">Last 7 Days</option>
                            <option value="30d">Last 30 Days</option>
                            <option value="90d">Last 90 Days</option>
                        </select>
                    </div>
                    
                    <div className="export-controls">
                        <select 
                            value={exportFormat} 
                            onChange={(e) => setExportFormat(e.target.value as any)}
                        >
                            <option value="json">JSON</option>
                            <option value="csv">CSV</option>
                        </select>
                        <button onClick={handleExport} className="export-btn">
                            📊 Export
                        </button>
                    </div>
                </div>
            </div>

            {/* Tab Navigation */}
            <div className="tab-navigation">
                {[
                    { id: 'overview', label: 'Overview', icon: '📈' },
                    { id: 'distribution', label: 'Distribution', icon: '📊' },
                    { id: 'trends', label: 'Trends', icon: '📉' },
                    { id: 'insights', label: 'Insights', icon: '💡' }
                ].map(tab => (
                    <button
                        key={tab.id}
                        className={`tab-btn ${activeTab === tab.id ? 'active' : ''}`}
                        onClick={() => setActiveTab(tab.id as any)}
                    >
                        <span className="tab-icon">{tab.icon}</span>
                        <span className="tab-label">{tab.label}</span>
                    </button>
                ))}
            </div>

            {/* Tab Content */}
            <div className="dashboard-content">
                {activeTab === 'overview' && (
                    <OverviewTab 
                        metrics={report?.metrics} 
                        effectiveness={report?.effectiveness} 
                    />
                )}
                
                {activeTab === 'distribution' && (
                    <DistributionTab 
                        distribution={report?.distribution}
                        qualityDistribution={report?.qualityDistribution}
                        chartData={distributionChartData}
                    />
                )}
                
                {activeTab === 'trends' && (
                    <TrendsTab 
                        trends={report?.trends}
                        chartData={trendChartData}
                    />
                )}
                
                {activeTab === 'insights' && (
                    <InsightsTab 
                        insights={report?.insights}
                        recommendations={report?.recommendations}
                    />
                )}
            </div>
        </div>
    );
};

// Overview Tab Component
const OverviewTab: React.FC<{
    metrics?: ConfidenceMetrics;
    effectiveness?: FilteringEffectiveness;
}> = ({ metrics, effectiveness }) => {
    if (!metrics || !effectiveness) {
        return (
            <div className="overview-tab loading">
                <p>Loading overview data...</p>
            </div>
        );
    }
    
    return (
        <div className="overview-tab">
            <div className="metrics-grid">
                <div className="metric-card">
                    <div className="metric-header">
                        <h3>Total Suggestions</h3>
                        <span className="metric-icon">📝</span>
                    </div>
                    <div className="metric-value">{metrics.totalSuggestions.toLocaleString()}</div>
                    <div className="metric-subtitle">Processed suggestions</div>
                </div>

            <div className="metric-card">
                <div className="metric-header">
                    <h3>Average Confidence</h3>
                    <span className="metric-icon">🎯</span>
                </div>
                <div className="metric-value">{(metrics.averageConfidence * 100).toFixed(1)}%</div>
                <div className="metric-subtitle">
                    σ = {(metrics.confidenceStandardDeviation * 100).toFixed(1)}%
                </div>
            </div>

            <div className="metric-card">
                <div className="metric-header">
                    <h3>Quality Score</h3>
                    <span className="metric-icon">⭐</span>
                </div>
                <div className="metric-value">{metrics.qualityScoreAverage.toFixed(1)}</div>
                <div className="metric-subtitle">Out of 100</div>
            </div>

            <div className="metric-card">
                <div className="metric-header">
                    <h3>Auto-Approval Rate</h3>
                    <span className="metric-icon">⚡</span>
                </div>
                <div className="metric-value">{effectiveness.autoApprovalRate.toFixed(1)}%</div>
                <div className="metric-subtitle">Processed automatically</div>
            </div>

            <div className="metric-card">
                <div className="metric-header">
                    <h3>Manual Review Rate</h3>
                    <span className="metric-icon">👁️</span>
                </div>
                <div className="metric-value">{effectiveness.manualReviewRate.toFixed(1)}%</div>
                <div className="metric-subtitle">Requires human review</div>
            </div>

            <div className="metric-card">
                <div className="metric-header">
                    <h3>User Override Rate</h3>
                    <span className="metric-icon">🔄</span>
                </div>
                <div className="metric-value">{effectiveness.userOverrideRate.toFixed(1)}%</div>
                <div className="metric-subtitle">AI decisions changed</div>
            </div>
        </div>

        <div className="effectiveness-summary">
            <h3>Filtering Effectiveness Summary</h3>
            <div className="effectiveness-bars">
                <div className="effectiveness-bar">
                    <div className="bar-label">Auto-Approval</div>
                    <div className="bar-container">
                        <div 
                            className="bar-fill auto-approve" 
                            style={{ width: `${effectiveness.autoApprovalRate}%` }}
                        ></div>
                    </div>
                    <div className="bar-value">{effectiveness.autoApprovalRate.toFixed(1)}%</div>
                </div>
                
                <div className="effectiveness-bar">
                    <div className="bar-label">Manual Review</div>
                    <div className="bar-container">
                        <div 
                            className="bar-fill manual-review" 
                            style={{ width: `${effectiveness.manualReviewRate}%` }}
                        ></div>
                    </div>
                    <div className="bar-value">{effectiveness.manualReviewRate.toFixed(1)}%</div>
                </div>
                
                <div className="effectiveness-bar">
                    <div className="bar-label">Rejection</div>
                    <div className="bar-container">
                        <div 
                            className="bar-fill reject" 
                            style={{ width: `${effectiveness.rejectionRate}%` }}
                        ></div>
                    </div>
                    <div className="bar-value">{effectiveness.rejectionRate.toFixed(1)}%</div>
                </div>
            </div>
        </div>
    </div>
    );
};

// Distribution Tab Component  
const DistributionTab: React.FC<{
    distribution?: ConfidenceDistribution;
    qualityDistribution?: any;
    chartData: ChartData;
}> = ({ distribution, chartData }) => {
    if (!distribution) {
        return (
            <div className="distribution-tab loading">
                <p>Loading distribution data...</p>
            </div>
        );
    }
    
    return (
        <div className="distribution-tab">
        <div className="chart-section">
            <h3>Confidence Distribution</h3>
            <div className="chart-container">
                <SimpleBarChart data={chartData} />
            </div>
        </div>

        <div className="distribution-table">
            <h3>Detailed Breakdown</h3>
            <table>
                <thead>
                    <tr>
                        <th>Confidence Range</th>
                        <th>Count</th>
                        <th>Percentage</th>
                        <th>Avg Quality</th>
                    </tr>
                </thead>
                <tbody>
                    {distribution.ranges.map((range, index) => (
                        <tr key={index}>
                            <td>{range.label}</td>
                            <td>{range.count}</td>
                            <td>{range.percentage.toFixed(1)}%</td>
                            <td>{range.averageQuality.toFixed(1)}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    </div>
    );
};

// Trends Tab Component
const TrendsTab: React.FC<{
    trends?: HistoricalTrends;
    chartData: ChartData;
}> = ({ trends, chartData }) => {
    if (!trends) {
        return (
            <div className="trends-tab loading">
                <p>Loading trends data...</p>
            </div>
        );
    }
    
    return (
        <div className="trends-tab">
        <div className="trend-indicators">
            <div className="trend-indicator">
                <div className="trend-label">Confidence Trend</div>
                <div className={`trend-direction ${trends.confidenceTrendDirection}`}>
                    {getTrendIcon(trends.confidenceTrendDirection)} {trends.confidenceTrendDirection}
                </div>
            </div>
            
            <div className="trend-indicator">
                <div className="trend-label">Quality Trend</div>
                <div className={`trend-direction ${trends.qualityTrendDirection}`}>
                    {getTrendIcon(trends.qualityTrendDirection)} {trends.qualityTrendDirection}
                </div>
            </div>
            
            <div className="trend-indicator">
                <div className="trend-label">Effectiveness Trend</div>
                <div className={`trend-direction ${trends.effectivenessTrendDirection}`}>
                    {getTrendIcon(trends.effectivenessTrendDirection)} {trends.effectivenessTrendDirection}
                </div>
            </div>
        </div>

        <div className="chart-section">
            <h3>Confidence Trend Over Time</h3>
            <div className="chart-container">
                <SimpleLineChart data={chartData} />
            </div>
        </div>
    </div>
    );
};

// Insights Tab Component
const InsightsTab: React.FC<{
    insights?: string[];
    recommendations?: string[];
}> = ({ insights, recommendations }) => {
    if (!insights || !recommendations) {
        return (
            <div className="insights-tab loading">
                <p>Loading insights data...</p>
            </div>
        );
    }
    
    return (
        <div className="insights-tab">
        <div className="insights-section">
            <h3>📊 Key Insights</h3>
            <div className="insights-list">
                {insights.map((insight, index) => (
                    <div key={index} className="insight-item">
                        <p>{insight}</p>
                    </div>
                ))}
            </div>
        </div>

        <div className="recommendations-section">
            <h3>💡 Recommendations</h3>
            <div className="recommendations-list">
                {recommendations.map((recommendation, index) => (
                    <div key={index} className="recommendation-item">
                        <p>{recommendation}</p>
                    </div>
                ))}
            </div>
        </div>
    </div>
    );
};

// Simple Chart Components
const SimpleBarChart: React.FC<{ data: ChartData }> = ({ data }) => (
    <div className="simple-bar-chart">
        {data.labels.map((label, index) => (
            <div key={index} className="bar-item">
                <div className="bar-label-small">{label}</div>
                <div className="bar-visual">
                    <div 
                        className="bar-fill-simple" 
                        style={{ 
                            height: `${(data.values[index] / Math.max(...data.values)) * 100}%`,
                            backgroundColor: data.colors?.[index] || '#3b82f6'
                        }}
                    ></div>
                </div>
                <div className="bar-value-small">{data.values[index].toFixed(1)}%</div>
            </div>
        ))}
    </div>
);

const SimpleLineChart: React.FC<{ data: ChartData }> = ({ data }) => (
    <div className="simple-line-chart">
        <div className="line-chart-container">
            <svg viewBox="0 0 400 200" className="line-chart-svg">
                {/* Generate simple line chart path */}
                <polyline
                    fill="none"
                    stroke="#3b82f6"
                    strokeWidth="2"
                    points={data.values.map((value, index) => 
                        `${(index / (data.values.length - 1)) * 380 + 10},${190 - (value / 100) * 180}`
                    ).join(' ')}
                />
                {/* Data points */}
                {data.values.map((value, index) => (
                    <circle
                        key={index}
                        cx={(index / (data.values.length - 1)) * 380 + 10}
                        cy={190 - (value / 100) * 180}
                        r="3"
                        fill="#3b82f6"
                    />
                ))}
            </svg>
        </div>
        <div className="chart-labels">
            {data.labels.map((label, index) => (
                <span key={index} className="chart-label">{label}</span>
            ))}
        </div>
    </div>
);

// Helper Functions
const getTrendIcon = (direction: 'improving' | 'declining' | 'stable'): string => {
    switch (direction) {
        case 'improving': return '📈';
        case 'declining': return '📉';
        case 'stable': return '➡️';
        default: return '➡️';
    }
};

async function generateSampleReport(calculator: ConfidenceStatisticsCalculator): Promise<StatisticsReport> {
    // Generate sample data for demonstration
    const sampleSuggestions = Array.from({ length: 100 }, (_, i) => ({
        value: `suggestion-${i}`,
        confidence: Math.random(),
        reasoning: `Sample reasoning ${i}`,
        originalConfidence: Math.random(),
        adjustedConfidence: Math.random(),
        qualityScore: Math.random() * 100,
        validationFlags: [],
        isRecommended: Math.random() > 0.3,
        rank: i + 1
    }));

    const sampleFilteredSuggestions = sampleSuggestions.map(s => {
        const rand = Math.random();
        return {
            originalSuggestion: s,
            category: rand > 0.7 ? SuggestionCategory.AUTO_APPROVE : 
                     rand > 0.5 ? SuggestionCategory.MANUAL_REVIEW : SuggestionCategory.REJECT,
            reason: 'Sample categorization',
            canOverride: true
        };
    });

    return await calculator.generateReport(sampleSuggestions, sampleFilteredSuggestions);
}

export default ConfidenceStatisticsDashboard;
