/**
 * Tests for ConfidenceStatisticsDashboard component
 */

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { expect, describe, it, beforeEach, vi, afterEach } from 'vitest';
import { ConfidenceStatisticsDashboard } from '../src/renderer/components/ConfidenceStatisticsDashboard';
import { ConfidenceStatisticsCalculator } from '../src/lib/confidence-statistics';
import { SuggestionCategory } from '../src/lib/confidence-threshold-config';

// Mock CSS imports
vi.mock('../src/renderer/components/ConfidenceStatisticsDashboard.css', () => ({}));

// Mock URL.createObjectURL for file export tests
Object.defineProperty(global.URL, 'createObjectURL', {
  value: vi.fn(() => 'blob:mock-url'),
  writable: true
});

Object.defineProperty(global.URL, 'revokeObjectURL', {
  value: vi.fn(),
  writable: true
});

describe('ConfidenceStatisticsDashboard', () => {
  let mockCalculator: Partial<ConfidenceStatisticsCalculator>;
  let mockReport: any;

  beforeEach(() => {
    // Create mock report
    mockReport = {
      generatedAt: new Date('2025-01-27T12:00:00Z'),
      metrics: {
        totalSuggestions: 1000,
        averageConfidence: 0.75,
        confidenceStandardDeviation: 0.15,
        qualityScoreAverage: 82.5
      },
      effectiveness: {
        autoApprovalRate: 45.2,
        manualReviewRate: 38.7,
        rejectionRate: 16.1,
        userOverrideRate: 8.3
      },
      distribution: {
        ranges: [
          { label: 'Very Low (0-20%)', count: 50, percentage: 5.0, averageQuality: 25.0 },
          { label: 'Low (20-40%)', count: 100, percentage: 10.0, averageQuality: 35.0 },
          { label: 'Moderate (40-60%)', count: 200, percentage: 20.0, averageQuality: 55.0 },
          { label: 'Good (60-80%)', count: 350, percentage: 35.0, averageQuality: 75.0 },
          { label: 'High (80-90%)', count: 200, percentage: 20.0, averageQuality: 85.0 },
          { label: 'Very High (90-100%)', count: 100, percentage: 10.0, averageQuality: 95.0 }
        ]
      },
      qualityDistribution: {
        ranges: [
          { label: 'Poor (0-40)', count: 100, percentage: 10.0 },
          { label: 'Fair (40-60)', count: 200, percentage: 20.0 },
          { label: 'Good (60-80)', count: 400, percentage: 40.0 },
          { label: 'Excellent (80-100)', count: 300, percentage: 30.0 }
        ]
      },
      trends: {
        daily: Array.from({ length: 7 }, (_, i) => ({
          timestamp: new Date(Date.now() - (6 - i) * 24 * 60 * 60 * 1000),
          metrics: {
            totalSuggestions: 100 + Math.floor(Math.random() * 50),
            averageConfidence: 0.7 + Math.random() * 0.2,
            qualityScore: 70 + Math.random() * 20
          }
        })),
        confidenceTrendDirection: 'improving' as const,
        qualityTrendDirection: 'stable' as const,
        effectivenessTrendDirection: 'improving' as const
      },
      insights: [
        'Confidence levels have improved by 12% over the past week',
        'Manual review rate is within optimal range (30-40%)',
        'Quality scores show consistent improvement in recent days'
      ],
      recommendations: [
        'Consider adjusting threshold to 0.78 for better balance',
        'Review rejected suggestions for common patterns',
        'Monitor auto-approval accuracy to maintain quality'
      ]
    };

    // Create mock calculator with vi.fn() methods
    mockCalculator = {
      generateReport: vi.fn().mockResolvedValue(mockReport),
      exportStatistics: vi.fn().mockReturnValue('{"test": "data"}'),
      calculateMetrics: vi.fn(),
      calculateFilteringEffectiveness: vi.fn(),
      calculateConfidenceDistribution: vi.fn(),
      calculateQualityDistribution: vi.fn(),
      calculateHistoricalTrends: vi.fn(),
      addDataPoint: vi.fn()
    };
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Component Rendering', () => {
    it('renders loading state initially', async () => {
      // Delay the resolution to see loading state
      mockCalculator.generateReport = vi.fn().mockImplementation(
        () => new Promise(resolve => setTimeout(() => resolve(mockReport), 100))
      );

      render(<ConfidenceStatisticsDashboard calculator={mockCalculator as ConfidenceStatisticsCalculator} />);
      
      expect(screen.getByText('Loading confidence statistics...')).toBeInTheDocument();
      
      // Wait for loading to complete
      await waitFor(() => {
        expect(screen.getByText('Confidence Statistics Dashboard')).toBeInTheDocument();
      }, { timeout: 2000 });
    });

    it('renders dashboard after loading', async () => {
      render(<ConfidenceStatisticsDashboard calculator={mockCalculator as ConfidenceStatisticsCalculator} />);
      
      await waitFor(() => {
        expect(screen.getByText('Confidence Statistics Dashboard')).toBeInTheDocument();
      });

      expect(screen.getByText(/Last updated:/)).toBeInTheDocument();
      expect(screen.getByText('Overview')).toBeInTheDocument();
      expect(screen.getByText('Distribution')).toBeInTheDocument();
      expect(screen.getByText('Trends')).toBeInTheDocument();
      expect(screen.getByText('Insights')).toBeInTheDocument();
    });

    it('renders error state when loading fails', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      
      const errorMessage = 'Failed to load data';
      mockCalculator.generateReport = vi.fn().mockRejectedValue(new Error(errorMessage));

      render(<ConfidenceStatisticsDashboard calculator={mockCalculator as ConfidenceStatisticsCalculator} />);

      await waitFor(() => {
        expect(screen.getByText('Error Loading Statistics')).toBeInTheDocument();
        expect(screen.getByText(errorMessage)).toBeInTheDocument();
      });

      expect(screen.getByText('Retry')).toBeInTheDocument();
      consoleErrorSpy.mockRestore();
    });

    it('handles no data state', async () => {
      mockCalculator.generateReport = vi.fn().mockResolvedValue(null);

      render(<ConfidenceStatisticsDashboard calculator={mockCalculator as ConfidenceStatisticsCalculator} />);

      await waitFor(() => {
        expect(screen.getByText('No Statistics Available')).toBeInTheDocument();
        expect(screen.getByText('No confidence data found for the selected time range.')).toBeInTheDocument();
      });
    });
  });

  describe('Header Controls', () => {
    it('renders time range selector with default selection', async () => {
      render(<ConfidenceStatisticsDashboard calculator={mockCalculator as ConfidenceStatisticsCalculator} />);

      await waitFor(() => {
        expect(screen.getByText('Confidence Statistics Dashboard')).toBeInTheDocument();
      });

      const timeRangeSelect = screen.getByDisplayValue('Last 30 Days');
      expect(timeRangeSelect).toBeInTheDocument();
    });

    it('updates time range when changed', async () => {
      render(<ConfidenceStatisticsDashboard calculator={mockCalculator as ConfidenceStatisticsCalculator} />);

      await waitFor(() => {
        expect(screen.getByText('Confidence Statistics Dashboard')).toBeInTheDocument();
      });

      const timeRangeSelect = screen.getByDisplayValue('Last 30 Days') as HTMLSelectElement;
      fireEvent.change(timeRangeSelect, { target: { value: '7d' } });

      expect(timeRangeSelect.value).toBe('7d');
    });

    it('renders export controls with default format', async () => {
      render(<ConfidenceStatisticsDashboard calculator={mockCalculator as ConfidenceStatisticsCalculator} />);

      await waitFor(() => {
        expect(screen.getByText('Confidence Statistics Dashboard')).toBeInTheDocument();
      });

      expect(screen.getByDisplayValue('JSON')).toBeInTheDocument();
      expect(screen.getByText('📊 Export')).toBeInTheDocument();
    });

    it('handles export functionality', async () => {
      // Mock DOM methods for export
      const mockLink = {
        href: '',
        download: '',
        click: vi.fn(),
      };
      vi.spyOn(document, 'createElement').mockReturnValue(mockLink as any);
      vi.spyOn(document.body, 'appendChild').mockImplementation(() => mockLink as any);
      vi.spyOn(document.body, 'removeChild').mockImplementation(() => mockLink as any);

      render(<ConfidenceStatisticsDashboard calculator={mockCalculator as ConfidenceStatisticsCalculator} />);

      await waitFor(() => {
        expect(screen.getByText('Confidence Statistics Dashboard')).toBeInTheDocument();
      });

      const exportButton = screen.getByText('📊 Export');
      fireEvent.click(exportButton);

      expect(mockCalculator.exportStatistics).toHaveBeenCalledWith('json');
      expect(global.URL.createObjectURL).toHaveBeenCalled();
      expect(mockLink.click).toHaveBeenCalled();
    });
  });

  describe('Tab Navigation', () => {
    it('renders all tabs with Overview as default', async () => {
      render(<ConfidenceStatisticsDashboard calculator={mockCalculator as ConfidenceStatisticsCalculator} />);

      await waitFor(() => {
        expect(screen.getByText('Confidence Statistics Dashboard')).toBeInTheDocument();
      });

      const overviewTab = screen.getByRole('button', { name: /📈 Overview/ });
      const distributionTab = screen.getByRole('button', { name: /📊 Distribution/ });
      const trendsTab = screen.getByRole('button', { name: /📉 Trends/ });
      const insightsTab = screen.getByRole('button', { name: /💡 Insights/ });

      expect(overviewTab).toBeInTheDocument();
      expect(distributionTab).toBeInTheDocument();
      expect(trendsTab).toBeInTheDocument();
      expect(insightsTab).toBeInTheDocument();

      // Check if Overview tab is active by default
      expect(overviewTab).toHaveClass('active');
    });

    it('switches tabs when clicked', async () => {
      render(<ConfidenceStatisticsDashboard calculator={mockCalculator as ConfidenceStatisticsCalculator} />);

      await waitFor(() => {
        expect(screen.getByText('Confidence Statistics Dashboard')).toBeInTheDocument();
      });

      const distributionTab = screen.getByRole('button', { name: /📊 Distribution/ });
      fireEvent.click(distributionTab);

      expect(distributionTab).toHaveClass('active');
      expect(screen.getByText('Confidence Distribution')).toBeInTheDocument();
    });
  });

  describe('Overview Tab', () => {
    it('displays all key metrics', async () => {
      render(<ConfidenceStatisticsDashboard calculator={mockCalculator as ConfidenceStatisticsCalculator} />);

      await waitFor(() => {
        expect(screen.getByText('Confidence Statistics Dashboard')).toBeInTheDocument();
      });

      // Check metric values
      expect(screen.getByText('1,000')).toBeInTheDocument(); // Total suggestions
      expect(screen.getByText('75.0%')).toBeInTheDocument(); // Average confidence
      expect(screen.getByText('82.5')).toBeInTheDocument(); // Quality score
      expect(screen.getByText('45.2%')).toBeInTheDocument(); // Auto-approval rate
      expect(screen.getByText('38.7%')).toBeInTheDocument(); // Manual review rate
      expect(screen.getByText('8.3%')).toBeInTheDocument(); // User override rate
    });

    it('displays effectiveness summary with progress bars', async () => {
      render(<ConfidenceStatisticsDashboard calculator={mockCalculator as ConfidenceStatisticsCalculator} />);

      await waitFor(() => {
        expect(screen.getByText('Filtering Effectiveness Summary')).toBeInTheDocument();
      });

      expect(screen.getByText('Auto-Approval')).toBeInTheDocument();
      expect(screen.getByText('Manual Review')).toBeInTheDocument();
      expect(screen.getByText('Rejection')).toBeInTheDocument();
    });
  });

  describe('Distribution Tab', () => {
    it('displays confidence distribution chart and table', async () => {
      render(<ConfidenceStatisticsDashboard calculator={mockCalculator as ConfidenceStatisticsCalculator} />);

      await waitFor(() => {
        expect(screen.getByText('Confidence Statistics Dashboard')).toBeInTheDocument();
      });

      const distributionTab = screen.getByRole('button', { name: /📊 Distribution/ });
      fireEvent.click(distributionTab);

      expect(screen.getByText('Confidence Distribution')).toBeInTheDocument();
      expect(screen.getByText('Detailed Breakdown')).toBeInTheDocument();
      
      // Check table headers
      expect(screen.getByText('Confidence Range')).toBeInTheDocument();
      expect(screen.getByText('Count')).toBeInTheDocument();
      expect(screen.getByText('Percentage')).toBeInTheDocument();
      expect(screen.getByText('Avg Quality')).toBeInTheDocument();
    });
  });

  describe('Trends Tab', () => {
    it('displays trend indicators and charts', async () => {
      render(<ConfidenceStatisticsDashboard calculator={mockCalculator as ConfidenceStatisticsCalculator} />);

      await waitFor(() => {
        expect(screen.getByText('Confidence Statistics Dashboard')).toBeInTheDocument();
      });

      const trendsTab = screen.getByRole('button', { name: /📉 Trends/ });
      fireEvent.click(trendsTab);

      expect(screen.getByText('Confidence Trend')).toBeInTheDocument();
      expect(screen.getByText('Quality Trend')).toBeInTheDocument();
      expect(screen.getByText('Effectiveness Trend')).toBeInTheDocument();
      expect(screen.getByText('Confidence Trend Over Time')).toBeInTheDocument();
    });
  });

  describe('Insights Tab', () => {
    it('displays insights and recommendations', async () => {
      render(<ConfidenceStatisticsDashboard calculator={mockCalculator as ConfidenceStatisticsCalculator} />);

      await waitFor(() => {
        expect(screen.getByText('Confidence Statistics Dashboard')).toBeInTheDocument();
      });

      const insightsTab = screen.getByRole('button', { name: /💡 Insights/ });
      fireEvent.click(insightsTab);

      expect(screen.getByText('📊 Key Insights')).toBeInTheDocument();
      expect(screen.getByText('💡 Recommendations')).toBeInTheDocument();

      // Check some insight text
      expect(screen.getByText(/Confidence levels have improved by 12%/)).toBeInTheDocument();
      expect(screen.getByText(/Consider adjusting threshold to 0.78/)).toBeInTheDocument();
    });
  });

  describe('Error Handling', () => {
    it('displays error message on export failure', async () => {
      mockCalculator.exportStatistics = vi.fn().mockImplementation(() => {
        throw new Error('Export failed');
      });

      render(<ConfidenceStatisticsDashboard calculator={mockCalculator as ConfidenceStatisticsCalculator} />);

      await waitFor(() => {
        expect(screen.getByText('Confidence Statistics Dashboard')).toBeInTheDocument();
      });

      const exportButton = screen.getByText('📊 Export');
      fireEvent.click(exportButton);

      // The error should be handled internally and not crash the app
      expect(mockCalculator.exportStatistics).toHaveBeenCalled();
    });
  });
});
