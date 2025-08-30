import React, { useState, useEffect, useRef } from 'react';
import './FeatureDiscovery.css';

interface Feature {
  id: string;
  title: string;
  description: string;
  targetSelector: string;
  position: 'top' | 'bottom' | 'left' | 'right';
  category: 'new' | 'updated' | 'tip';
  priority: number;
  conditions?: {
    path?: string;
    userAction?: string;
    timeDelay?: number;
  };
}

interface FeatureDiscoveryProps {
  onFeatureCompleted?: (featureId: string) => void;
  onAllFeaturesCompleted?: () => void;
}

const FeatureDiscovery: React.FC<FeatureDiscoveryProps> = ({
  onFeatureCompleted,
  onAllFeaturesCompleted
}) => {
  const [currentFeature, setCurrentFeature] = useState<Feature | null>(null);
  const [discoveredFeatures, setDiscoveredFeatures] = useState<Set<string>>(new Set());
  const [isVisible, setIsVisible] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const [shouldShow, setShouldShow] = useState(false);
  const tooltipRef = useRef<HTMLDivElement>(null);

  // Feature definitions
  const features: Feature[] = [
    {
      id: 'theme-customizer',
      title: 'New: Theme Customization',
      description: 'Customize colors, typography, and appearance to make MaxSort truly yours. Access it through Settings → Theme.',
      targetSelector: '[data-feature="theme-tab"]',
      position: 'bottom',
      category: 'new',
      priority: 1,
      conditions: {
        path: '/settings',
        timeDelay: 2000
      }
    },
    {
      id: 'batch-operations',
      title: 'Enhanced: Batch Processing',
      description: 'Process thousands of files efficiently with improved batch operations and real-time progress tracking.',
      targetSelector: '[data-feature="batch-operations"]',
      position: 'right',
      category: 'updated',
      priority: 2,
      conditions: {
        userAction: 'directory-selected'
      }
    },
    {
      id: 'system-health',
      title: 'New: System Monitoring',
      description: 'Keep track of your system\'s performance with real-time monitoring and optimization recommendations.',
      targetSelector: '[data-feature="system-health"]',
      position: 'left',
      category: 'new',
      priority: 3
    },
    {
      id: 'contextual-help',
      title: 'Enhanced: Smart Help System',
      description: 'Get contextual help and guidance based on what you\'re doing. Press F1 or click the help icon anytime.',
      targetSelector: '[data-feature="help-system"]',
      position: 'bottom',
      category: 'updated',
      priority: 4,
      conditions: {
        timeDelay: 5000
      }
    },
    {
      id: 'undo-redo',
      title: 'Tip: Comprehensive Undo System',
      description: 'All operations are reversible! Use Cmd+Z to undo any file operation, or access the full history in the History tab.',
      targetSelector: '[data-feature="history-tab"]',
      position: 'top',
      category: 'tip',
      priority: 5,
      conditions: {
        userAction: 'first-operation-completed'
      }
    },
    {
      id: 'keyboard-shortcuts',
      title: 'Tip: Keyboard Shortcuts',
      description: 'Speed up your workflow with keyboard shortcuts: Cmd+O (Open Directory), Cmd+R (Run Analysis), Cmd+S (Settings).',
      targetSelector: 'body',
      position: 'bottom',
      category: 'tip',
      priority: 6,
      conditions: {
        timeDelay: 30000
      }
    },
    {
      id: 'confidence-scores',
      title: 'Understanding Confidence Scores',
      description: 'Green (90-100%): Highly confident suggestions. Yellow (70-89%): Good suggestions that might need review. Red (<70%): Requires manual verification.',
      targetSelector: '[data-feature="confidence-indicator"]',
      position: 'right',
      category: 'tip',
      priority: 7,
      conditions: {
        userAction: 'analysis-results-shown'
      }
    },
    {
      id: 'performance-tuning',
      title: 'New: Performance Controls',
      description: 'Adjust memory limits, processing priority, and concurrency settings to optimize MaxSort for your system.',
      targetSelector: '[data-feature="performance-tab"]',
      position: 'left',
      category: 'new',
      priority: 8,
      conditions: {
        path: '/settings',
        userAction: 'performance-tab-clicked'
      }
    }
  ];

  useEffect(() => {
    // Load discovered features from localStorage
    const saved = localStorage.getItem('maxsort-discovered-features');
    if (saved) {
      try {
        setDiscoveredFeatures(new Set(JSON.parse(saved)));
      } catch (error) {
        console.error('Failed to load discovered features:', error);
      }
    }

    // Check if user has disabled feature discovery
    const disabled = localStorage.getItem('maxsort-feature-discovery-disabled');
    setShouldShow(!disabled);
  }, []);

  useEffect(() => {
    if (!shouldShow) return;

    const checkFeatureConditions = () => {
      const undiscoveredFeatures = features
        .filter(feature => !discoveredFeatures.has(feature.id))
        .sort((a, b) => a.priority - b.priority);

      for (const feature of undiscoveredFeatures) {
        if (shouldShowFeature(feature)) {
          showFeature(feature);
          break;
        }
      }
    };

    // Check conditions periodically
    const interval = setInterval(checkFeatureConditions, 1000);

    // Check immediately
    checkFeatureConditions();

    return () => clearInterval(interval);
  }, [discoveredFeatures, shouldShow]);

  const shouldShowFeature = (feature: Feature): boolean => {
    const target = document.querySelector(feature.targetSelector);
    if (!target) return false;

    const conditions = feature.conditions;
    if (!conditions) return true;

    // Check path condition
    if (conditions.path && !window.location.pathname.includes(conditions.path)) {
      return false;
    }

    // Check time delay condition
    if (conditions.timeDelay) {
      const appStartTime = localStorage.getItem('maxsort-app-start-time');
      if (!appStartTime || Date.now() - parseInt(appStartTime) < conditions.timeDelay) {
        return false;
      }
    }

    // Check user action condition
    if (conditions.userAction) {
      const actionCompleted = localStorage.getItem(`maxsort-action-${conditions.userAction}`);
      if (!actionCompleted) return false;
    }

    return true;
  };

  const showFeature = (feature: Feature) => {
    const target = document.querySelector(feature.targetSelector);
    if (!target) return;

    // Calculate position
    const rect = target.getBoundingClientRect();
    const tooltipRect = tooltipRef.current?.getBoundingClientRect();
    const windowWidth = window.innerWidth;
    const windowHeight = window.innerHeight;
    
    let top = 0;
    let left = 0;

    switch (feature.position) {
      case 'top':
        top = rect.top - (tooltipRect?.height || 100) - 12;
        left = rect.left + rect.width / 2 - (tooltipRect?.width || 200) / 2;
        break;
      case 'bottom':
        top = rect.bottom + 12;
        left = rect.left + rect.width / 2 - (tooltipRect?.width || 200) / 2;
        break;
      case 'left':
        top = rect.top + rect.height / 2 - (tooltipRect?.height || 50) / 2;
        left = rect.left - (tooltipRect?.width || 250) - 12;
        break;
      case 'right':
        top = rect.top + rect.height / 2 - (tooltipRect?.height || 50) / 2;
        left = rect.right + 12;
        break;
    }

    // Keep tooltip within viewport
    if (left < 12) left = 12;
    if (left + (tooltipRect?.width || 250) > windowWidth - 12) {
      left = windowWidth - (tooltipRect?.width || 250) - 12;
    }
    if (top < 12) top = 12;
    if (top + (tooltipRect?.height || 100) > windowHeight - 12) {
      top = windowHeight - (tooltipRect?.height || 100) - 12;
    }

    setPosition({ top, left });
    setCurrentFeature(feature);
    setIsVisible(true);

    // Add highlight to target element
    target.classList.add('feature-highlight');

    // Auto-hide after 10 seconds unless it's a critical feature
    if (feature.category === 'tip') {
      setTimeout(() => {
        if (currentFeature?.id === feature.id) {
          handleDismiss();
        }
      }, 10000);
    }
  };

  const handleDismiss = () => {
    if (currentFeature) {
      const target = document.querySelector(currentFeature.targetSelector);
      if (target) {
        target.classList.remove('feature-highlight');
      }

      markFeatureAsDiscovered(currentFeature.id);
      setIsVisible(false);
      setCurrentFeature(null);
      
      onFeatureCompleted?.(currentFeature.id);
    }
  };

  const markFeatureAsDiscovered = (featureId: string) => {
    const newDiscovered = new Set([...discoveredFeatures, featureId]);
    setDiscoveredFeatures(newDiscovered);
    
    // Save to localStorage
    localStorage.setItem('maxsort-discovered-features', JSON.stringify([...newDiscovered]));

    // Check if all features are discovered
    if (newDiscovered.size >= features.length) {
      onAllFeaturesCompleted?.();
    }
  };

  const handleDisableFeatureDiscovery = () => {
    localStorage.setItem('maxsort-feature-discovery-disabled', 'true');
    setShouldShow(false);
    handleDismiss();
  };

  const getCategoryIcon = (category: Feature['category']) => {
    switch (category) {
      case 'new': return '✨';
      case 'updated': return '🔄';
      case 'tip': return '💡';
      default: return '📌';
    }
  };

  const getCategoryColor = (category: Feature['category']) => {
    switch (category) {
      case 'new': return '#4CAF50';
      case 'updated': return '#2196F3';
      case 'tip': return '#FF9800';
      default: return '#9E9E9E';
    }
  };

  if (!isVisible || !currentFeature) return null;

  return (
    <>
      {/* Backdrop */}
      <div className="feature-discovery-backdrop" />
      
      {/* Tooltip */}
      <div
        ref={tooltipRef}
        className={`feature-discovery-tooltip ${currentFeature.category}`}
        style={{
          top: position.top,
          left: position.left,
          position: 'fixed',
          zIndex: 10001
        }}
      >
        <div className="tooltip-header">
          <div className="tooltip-badge" style={{ backgroundColor: getCategoryColor(currentFeature.category) }}>
            <span className="tooltip-badge-icon">{getCategoryIcon(currentFeature.category)}</span>
            <span className="tooltip-badge-text">{currentFeature.category.toUpperCase()}</span>
          </div>
          <button className="tooltip-close" onClick={handleDismiss} title="Dismiss">
            ×
          </button>
        </div>
        
        <div className="tooltip-content">
          <h3 className="tooltip-title">{currentFeature.title}</h3>
          <p className="tooltip-description">{currentFeature.description}</p>
        </div>
        
        <div className="tooltip-actions">
          <button className="btn btn-text" onClick={handleDismiss}>
            Got it
          </button>
          <button className="btn btn-text tooltip-disable" onClick={handleDisableFeatureDiscovery}>
            Don't show tips
          </button>
        </div>
        
        {/* Arrow */}
        <div className={`tooltip-arrow tooltip-arrow-${currentFeature.position}`} />
      </div>
    </>
  );
};

// Hook for triggering user actions
export const useFeatureDiscovery = () => {
  const triggerAction = (action: string) => {
    localStorage.setItem(`maxsort-action-${action}`, Date.now().toString());
  };

  const setAppStartTime = () => {
    localStorage.setItem('maxsort-app-start-time', Date.now().toString());
  };

  return {
    triggerAction,
    setAppStartTime
  };
};

// HOC for adding feature discovery data attributes
export const withFeatureDiscovery = <P extends object>(
  Component: React.ComponentType<P>,
  featureId: string
) => {
  return React.forwardRef<any, P>((props, ref) => {
    const enhancedProps = {
      ...props,
      'data-feature': featureId
    } as P & { 'data-feature': string };
    
    return <Component {...enhancedProps} ref={ref} />;
  });
};

export default FeatureDiscovery;
