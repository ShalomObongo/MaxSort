import React, { useState, useEffect, useCallback } from 'react';
import { useAppState } from '../store/AppStateContext';
import ThemeCustomizer from './ThemeCustomizer';
import { ManualReviewQueueUI } from './ManualReviewQueueUI';
import { ManualReviewQueue, ManualReviewQueueConfig } from '../../lib/manual-review-queue';
import { 
  ConfidenceThresholdConfig, 
  CONFIDENCE_PROFILES, 
  CONFIDENCE_CONFIG_CONSTANTS,
  ConfidenceThresholdValidator,
  createDefaultConfidenceThresholdConfig,
  generateSampleFilteringPreview,
  SuggestionCategory
} from '../../lib/confidence-threshold-config';
import './Settings.css';

interface UserProfile {
  id: string;
  name: string;
  email?: string;
  createdAt: string;
  lastActiveAt: string;
  preferences: UserPreferences;
}

interface UserPreferences {
  // Model Configuration
  preferredModel: string;
  modelSettings: {
    temperature: number;
    maxTokens: number;
    timeout: number;
  };
  
  // Performance Settings
  performance: {
    maxConcurrentOperations: number;
    memoryLimit: number;
    processingPriority: 'low' | 'normal' | 'high';
    enableBackgroundProcessing: boolean;
  };
  
  // UI Preferences
  ui: {
    theme: 'light' | 'dark' | 'system';
    compactMode: boolean;
    showConfidenceIndicators: boolean;
    autoExpandDetails: boolean;
    animationsEnabled: boolean;
  };
  
  // Workflow Settings
  workflow: {
    autoApproveHighConfidence: boolean;
    confidenceThreshold: number;
    requireConfirmation: boolean;
    enableBatchMode: boolean;
    defaultBatchSize: number;
    confidenceThresholdConfig: ConfidenceThresholdConfig;
  };
  
  // Notification Settings
  notifications: {
    showDesktopNotifications: boolean;
    playSound: boolean;
    notifyOnCompletion: boolean;
    notifyOnErrors: boolean;
    quietHours: {
      enabled: boolean;
      start: string;
      end: string;
    };
  };
  
  // Accessibility
  accessibility: {
    highContrast: boolean;
    fontSize: 'small' | 'medium' | 'large';
    reducedMotion: boolean;
    keyboardNavigation: boolean;
  };
  
  // Advanced Settings
  advanced: {
    enableLogging: boolean;
    logLevel: 'error' | 'warn' | 'info' | 'debug';
    enableAnalytics: boolean;
    autoSaveInterval: number;
    backupSettings: boolean;
  };
}

interface SettingsExportData {
  version: string;
  exportDate: string;
  userProfile: UserProfile;
  systemInfo: {
    appVersion: string;
    platform: string;
    nodeVersion: string;
  };
}

export const Settings: React.FC = () => {
  const { state } = useAppState();
  const [activeTab, setActiveTab] = useState<string>('model');
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [preferences, setPreferences] = useState<UserPreferences | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [importingSettings, setImportingSettings] = useState(false);
  const [exportingSettings, setExportingSettings] = useState(false);
  const [availableModels, setAvailableModels] = useState<Array<{
    id: string;
    name: string;
    description: string;
    parameters: number;
    size: string;
    performance: 'low' | 'medium' | 'high';
  }>>([]);
  const [unsavedChanges, setUnsavedChanges] = useState(false);
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});
  
  // Confidence threshold configuration state
  const [confidencePreview, setConfidencePreview] = useState<{
    sampleSuggestions: Array<{
      filename: string;
      confidence: number;
      category: SuggestionCategory;
    }>;
    statistics: any;
  } | null>(null);

  // Manual review queue state
  const [manualReviewQueue, setManualReviewQueue] = useState<ManualReviewQueue | null>(null);
  const [reviewQueueConfig, setReviewQueueConfig] = useState<ManualReviewQueueConfig>(
    ManualReviewQueue.getDefaultConfig()
  );

  // Load user profile and preferences on mount
  useEffect(() => {
    loadUserSettings();
    loadAvailableModels();
  }, []);

  // Initialize manual review queue
  useEffect(() => {
    const queue = new ManualReviewQueue(reviewQueueConfig);
    setManualReviewQueue(queue);
  }, [reviewQueueConfig]);

  const loadUserSettings = async () => {
    try {
      setLoading(true);
      const profile = await window.electronAPI.settings?.getUserProfile();
      const userPrefs = await window.electronAPI.settings?.getUserPreferences();
      
      setUserProfile(profile);
      setPreferences(userPrefs);
    } catch (error) {
      console.error('Failed to load user settings:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadAvailableModels = async () => {
    try {
      const models = await window.electronAPI.settings?.getAvailableModels();
      setAvailableModels(models || []);
    } catch (error) {
      console.error('Failed to load available models:', error);
    }
  };

  const handlePreferenceChange = useCallback((
    section: keyof UserPreferences,
    key: string,
    value: any
  ) => {
    if (!preferences) return;

    const sectionData = preferences[section];
    if (typeof sectionData === 'object' && sectionData !== null) {
      const newPreferences = {
        ...preferences,
        [section]: {
          ...sectionData,
          [key]: value
        }
      };

      setPreferences(newPreferences);
      setUnsavedChanges(true);

      // Validate the change
      validateSetting(section, key, value);
      
      // Update confidence preview if threshold config changed
      if (section === 'workflow' && key === 'confidenceThresholdConfig') {
        updateConfidencePreview(value);
      }
    }
  }, [preferences]);

  const updateConfidencePreview = useCallback((config: ConfidenceThresholdConfig) => {
    const effectiveThreshold = ConfidenceThresholdValidator.getEffectiveThreshold(config);
    const preview = generateSampleFilteringPreview(effectiveThreshold);
    setConfidencePreview(preview);
  }, []);

  const handleConfidenceProfileChange = useCallback((profileKey: string) => {
    if (!preferences) return;
    
    const profile = CONFIDENCE_PROFILES[profileKey];
    const newConfig: ConfidenceThresholdConfig = {
      ...preferences.workflow.confidenceThresholdConfig,
      profile,
      customThreshold: profile.isCustom ? preferences.workflow.confidenceThresholdConfig?.customThreshold || 0.80 : undefined,
    };
    
    handlePreferenceChange('workflow', 'confidenceThresholdConfig', newConfig);
  }, [preferences, handlePreferenceChange]);

  const handleCustomThresholdChange = useCallback((threshold: number) => {
    if (!preferences) return;
    
    const newConfig: ConfidenceThresholdConfig = {
      ...preferences.workflow.confidenceThresholdConfig,
      customThreshold: threshold,
    };
    
    handlePreferenceChange('workflow', 'confidenceThresholdConfig', newConfig);
  }, [preferences, handlePreferenceChange]);

  // Initialize confidence preview when preferences load
  useEffect(() => {
    if (preferences?.workflow.confidenceThresholdConfig) {
      updateConfidencePreview(preferences.workflow.confidenceThresholdConfig);
    } else if (preferences) {
      // Initialize with default config if not present
      const defaultConfig = createDefaultConfidenceThresholdConfig();
      updateConfidencePreview(defaultConfig);
    }
  }, [preferences, updateConfidencePreview]);

  const validateSetting = (section: keyof UserPreferences, key: string, value: any) => {
    const errors = { ...validationErrors };
    const errorKey = `${section}.${key}`;

    // Clear existing error
    delete errors[errorKey];

    // Validation rules
    if (section === 'performance') {
      if (key === 'maxConcurrentOperations' && (value < 1 || value > 10)) {
        errors[errorKey] = 'Concurrent operations must be between 1 and 10';
      }
      if (key === 'memoryLimit' && (value < 512 || value > 8192)) {
        errors[errorKey] = 'Memory limit must be between 512MB and 8GB';
      }
    }

    if (section === 'workflow') {
      if (key === 'confidenceThreshold' && (value < 0.1 || value > 1.0)) {
        errors[errorKey] = 'Confidence threshold must be between 0.1 and 1.0';
      }
      if (key === 'defaultBatchSize' && (value < 1 || value > 1000)) {
        errors[errorKey] = 'Batch size must be between 1 and 1000';
      }
      if (key === 'confidenceThresholdConfig' && value) {
        const validation = ConfidenceThresholdValidator.validateConfig(value);
        if (!validation.isValid) {
          errors[errorKey] = validation.errors.join(', ');
        }
      }
    }

    if (section === 'modelSettings') {
      if (key === 'temperature' && (value < 0 || value > 2)) {
        errors[errorKey] = 'Temperature must be between 0 and 2';
      }
      if (key === 'maxTokens' && (value < 100 || value > 10000)) {
        errors[errorKey] = 'Max tokens must be between 100 and 10,000';
      }
      if (key === 'timeout' && (value < 5 || value > 300)) {
        errors[errorKey] = 'Timeout must be between 5 and 300 seconds';
      }
    }

    setValidationErrors(errors);
  };

  const saveSettings = async () => {
    if (!preferences || !userProfile) return;

    // Check for validation errors
    if (Object.keys(validationErrors).length > 0) {
      return;
    }

    try {
      setSaving(true);
      await window.electronAPI.settings?.saveUserPreferences(preferences);
      await window.electronAPI.settings?.updateUserProfile({
        ...userProfile,
        preferences,
        lastActiveAt: new Date().toISOString()
      });
      
      setUnsavedChanges(false);
    } catch (error) {
      console.error('Failed to save settings:', error);
    } finally {
      setSaving(false);
    }
  };

  const resetToDefaults = async () => {
    if (!confirm('Are you sure you want to reset all settings to their default values? This action cannot be undone.')) {
      return;
    }

    try {
      const defaultPrefs = await window.electronAPI.settings?.getDefaultPreferences();
      setPreferences(defaultPrefs);
      setUnsavedChanges(true);
      setValidationErrors({});
    } catch (error) {
      console.error('Failed to reset settings:', error);
    }
  };

  const exportSettings = async () => {
    if (!preferences || !userProfile) return;

    try {
      setExportingSettings(true);
      const systemInfo = await window.electronAPI.system?.getSystemInfo();
      
      const exportData: SettingsExportData = {
        version: '1.0',
        exportDate: new Date().toISOString(),
        userProfile,
        systemInfo
      };

      const result = await window.electronAPI.settings?.exportSettings(exportData);
      if (result?.success) {
        // Show success message
        console.log('Settings exported successfully to:', result.filePath);
      }
    } catch (error) {
      console.error('Failed to export settings:', error);
    } finally {
      setExportingSettings(false);
    }
  };

  const importSettings = async () => {
    try {
      setImportingSettings(true);
      const result = await window.electronAPI.settings?.importSettings();
      
      if (result?.success && result.data) {
        const importedData = result.data as SettingsExportData;
        setPreferences(importedData.userProfile.preferences);
        setUnsavedChanges(true);
        setValidationErrors({});
      }
    } catch (error) {
      console.error('Failed to import settings:', error);
    } finally {
      setImportingSettings(false);
    }
  };

  const renderModelConfigTab = () => (
    <div className="settings-tab-content">
      <div className="settings-section">
        <h3>Model Selection</h3>
        <div className="form-group">
          <label htmlFor="preferredModel">Preferred Model</label>
          <select
            id="preferredModel"
            value={preferences?.preferredModel || ''}
            onChange={(e) => handlePreferenceChange('modelSettings', 'preferredModel', e.target.value)}
            className="form-control"
          >
            <option value="">Select a model</option>
            {availableModels.map(model => (
              <option key={model.id} value={model.id}>
                {model.name} - {model.size} ({model.performance} performance)
              </option>
            ))}
          </select>
        </div>

        <div className="form-group">
          <label htmlFor="temperature">Temperature</label>
          <div className="slider-group">
            <input
              type="range"
              id="temperature"
              min="0"
              max="2"
              step="0.1"
              value={preferences?.modelSettings.temperature || 0.7}
              onChange={(e) => handlePreferenceChange('modelSettings', 'temperature', parseFloat(e.target.value))}
              className="form-slider"
            />
            <span className="slider-value">{preferences?.modelSettings.temperature || 0.7}</span>
          </div>
          <small className="form-help">Controls randomness in model responses (0 = deterministic, 2 = very random)</small>
          {validationErrors['modelSettings.temperature'] && (
            <div className="error-message">{validationErrors['modelSettings.temperature']}</div>
          )}
        </div>

        <div className="form-group">
          <label htmlFor="maxTokens">Max Tokens</label>
          <input
            type="number"
            id="maxTokens"
            value={preferences?.modelSettings.maxTokens || 4000}
            onChange={(e) => handlePreferenceChange('modelSettings', 'maxTokens', parseInt(e.target.value))}
            className="form-control"
            min="100"
            max="10000"
          />
          <small className="form-help">Maximum number of tokens in model responses</small>
          {validationErrors['modelSettings.maxTokens'] && (
            <div className="error-message">{validationErrors['modelSettings.maxTokens']}</div>
          )}
        </div>

        <div className="form-group">
          <label htmlFor="timeout">Timeout (seconds)</label>
          <input
            type="number"
            id="timeout"
            value={preferences?.modelSettings.timeout || 30}
            onChange={(e) => handlePreferenceChange('modelSettings', 'timeout', parseInt(e.target.value))}
            className="form-control"
            min="5"
            max="300"
          />
          <small className="form-help">Maximum time to wait for model responses</small>
          {validationErrors['modelSettings.timeout'] && (
            <div className="error-message">{validationErrors['modelSettings.timeout']}</div>
          )}
        </div>
      </div>
    </div>
  );

  const renderPerformanceTab = () => (
    <div className="settings-tab-content">
      <div className="settings-section">
        <h3>Performance Settings</h3>
        <div className="form-group">
          <label htmlFor="maxConcurrentOperations">Max Concurrent Operations</label>
          <input
            type="number"
            id="maxConcurrentOperations"
            value={preferences?.performance.maxConcurrentOperations || 3}
            onChange={(e) => handlePreferenceChange('performance', 'maxConcurrentOperations', parseInt(e.target.value))}
            className="form-control"
            min="1"
            max="10"
          />
          <small className="form-help">Number of file operations that can run simultaneously</small>
          {validationErrors['performance.maxConcurrentOperations'] && (
            <div className="error-message">{validationErrors['performance.maxConcurrentOperations']}</div>
          )}
        </div>

        <div className="form-group">
          <label htmlFor="memoryLimit">Memory Limit (MB)</label>
          <input
            type="number"
            id="memoryLimit"
            value={preferences?.performance.memoryLimit || 2048}
            onChange={(e) => handlePreferenceChange('performance', 'memoryLimit', parseInt(e.target.value))}
            className="form-control"
            min="512"
            max="8192"
          />
          <small className="form-help">Maximum memory usage for the application</small>
          {validationErrors['performance.memoryLimit'] && (
            <div className="error-message">{validationErrors['performance.memoryLimit']}</div>
          )}
        </div>

        <div className="form-group">
          <label htmlFor="processingPriority">Processing Priority</label>
          <select
            id="processingPriority"
            value={preferences?.performance.processingPriority || 'normal'}
            onChange={(e) => handlePreferenceChange('performance', 'processingPriority', e.target.value)}
            className="form-control"
          >
            <option value="low">Low</option>
            <option value="normal">Normal</option>
            <option value="high">High</option>
          </select>
          <small className="form-help">System priority for file processing operations</small>
        </div>

        <div className="form-group">
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={preferences?.performance.enableBackgroundProcessing || false}
              onChange={(e) => handlePreferenceChange('performance', 'enableBackgroundProcessing', e.target.checked)}
            />
            Enable Background Processing
          </label>
          <small className="form-help">Continue processing when the application is minimized</small>
        </div>
      </div>
    </div>
  );

  const renderAppearanceTab = () => (
    <div className="settings-tab-content">
      <div className="settings-section">
        <h3>Theme & Appearance</h3>
        <div className="form-group">
          <label htmlFor="theme">Theme</label>
          <select
            id="theme"
            value={preferences?.ui.theme || 'system'}
            onChange={(e) => handlePreferenceChange('ui', 'theme', e.target.value)}
            className="form-control"
          >
            <option value="light">Light</option>
            <option value="dark">Dark</option>
            <option value="system">System</option>
          </select>
          <small className="form-help">Choose your preferred color theme</small>
        </div>

        <div className="form-group">
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={preferences?.ui.compactMode || false}
              onChange={(e) => handlePreferenceChange('ui', 'compactMode', e.target.checked)}
            />
            Compact Mode
          </label>
          <small className="form-help">Use a more compact layout to show more information</small>
        </div>

        <div className="form-group">
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={preferences?.ui.showConfidenceIndicators || true}
              onChange={(e) => handlePreferenceChange('ui', 'showConfidenceIndicators', e.target.checked)}
            />
            Show Confidence Indicators
          </label>
          <small className="form-help">Display confidence scores for AI suggestions</small>
        </div>

        <div className="form-group">
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={preferences?.ui.autoExpandDetails || false}
              onChange={(e) => handlePreferenceChange('ui', 'autoExpandDetails', e.target.checked)}
            />
            Auto-expand Details
          </label>
          <small className="form-help">Automatically expand detailed information sections</small>
        </div>

        <div className="form-group">
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={preferences?.ui.animationsEnabled || true}
              onChange={(e) => handlePreferenceChange('ui', 'animationsEnabled', e.target.checked)}
            />
            Enable Animations
          </label>
          <small className="form-help">Use animations and transitions in the interface</small>
        </div>
      </div>

      <div className="settings-section">
        <h3>Accessibility</h3>
        <div className="form-group">
          <label htmlFor="fontSize">Font Size</label>
          <select
            id="fontSize"
            value={preferences?.accessibility.fontSize || 'medium'}
            onChange={(e) => handlePreferenceChange('accessibility', 'fontSize', e.target.value)}
            className="form-control"
          >
            <option value="small">Small</option>
            <option value="medium">Medium</option>
            <option value="large">Large</option>
          </select>
        </div>

        <div className="form-group">
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={preferences?.accessibility.highContrast || false}
              onChange={(e) => handlePreferenceChange('accessibility', 'highContrast', e.target.checked)}
            />
            High Contrast Mode
          </label>
        </div>

        <div className="form-group">
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={preferences?.accessibility.reducedMotion || false}
              onChange={(e) => handlePreferenceChange('accessibility', 'reducedMotion', e.target.checked)}
            />
            Reduced Motion
          </label>
        </div>

        <div className="form-group">
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={preferences?.accessibility.keyboardNavigation || true}
              onChange={(e) => handlePreferenceChange('accessibility', 'keyboardNavigation', e.target.checked)}
            />
            Enhanced Keyboard Navigation
          </label>
        </div>
      </div>
    </div>
  );

  const renderWorkflowTab = () => {
    const confidenceConfig = preferences?.workflow.confidenceThresholdConfig || createDefaultConfidenceThresholdConfig();
    const effectiveThreshold = ConfidenceThresholdValidator.getEffectiveThreshold(confidenceConfig);
    
    return (
      <div className="settings-tab-content">
        <div className="settings-section">
          <h3>Confidence-Based Filtering</h3>
          <p className="section-description">
            Control how AI suggestions are automatically filtered and approved based on confidence scores.
          </p>
          
          <div className="form-group">
            <label htmlFor="confidenceProfile">Confidence Profile</label>
            <select
              id="confidenceProfile"
              value={Object.keys(CONFIDENCE_PROFILES).find(key => 
                CONFIDENCE_PROFILES[key].name === confidenceConfig.profile.name
              ) || 'balanced'}
              onChange={(e) => handleConfidenceProfileChange(e.target.value)}
              className="form-control"
            >
              {Object.entries(CONFIDENCE_PROFILES).map(([key, profile]) => (
                <option key={key} value={key}>
                  {profile.name} ({Math.round(profile.threshold * 100)}%)
                </option>
              ))}
            </select>
            <small className="form-help">{confidenceConfig.profile.description}</small>
          </div>

          {confidenceConfig.profile.isCustom && (
            <div className="form-group">
              <label htmlFor="customConfidenceThreshold">Custom Threshold</label>
              <div className="slider-group">
                <input
                  type="range"
                  id="customConfidenceThreshold"
                  min={CONFIDENCE_CONFIG_CONSTANTS.MIN_THRESHOLD}
                  max={CONFIDENCE_CONFIG_CONSTANTS.MAX_THRESHOLD}
                  step={CONFIDENCE_CONFIG_CONSTANTS.THRESHOLD_STEP}
                  value={confidenceConfig.customThreshold || 0.80}
                  onChange={(e) => handleCustomThresholdChange(parseFloat(e.target.value))}
                  className="form-slider"
                />
                <span className="slider-value">
                  {Math.round((confidenceConfig.customThreshold || 0.80) * 100)}%
                </span>
              </div>
              <small className="form-help">
                Suggestions with confidence at or above this threshold will be auto-approved
              </small>
            </div>
          )}

          <div className="form-group">
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={confidenceConfig.autoApprove}
                onChange={(e) => handlePreferenceChange('workflow', 'confidenceThresholdConfig', {
                  ...confidenceConfig,
                  autoApprove: e.target.checked
                })}
              />
              Enable Auto-Approval
            </label>
            <small className="form-help">Automatically queue high-confidence suggestions for batch execution</small>
          </div>

          <div className="form-group">
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={confidenceConfig.enableManualOverride}
                onChange={(e) => handlePreferenceChange('workflow', 'confidenceThresholdConfig', {
                  ...confidenceConfig,
                  enableManualOverride: e.target.checked
                })}
              />
              Enable Manual Override
            </label>
            <small className="form-help">Allow manual promotion or demotion of suggestions regardless of confidence</small>
          </div>

          <div className="form-group">
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={confidenceConfig.enableStatistics}
                onChange={(e) => handlePreferenceChange('workflow', 'confidenceThresholdConfig', {
                  ...confidenceConfig,
                  enableStatistics: e.target.checked
                })}
              />
              Enable Statistics Tracking
            </label>
            <small className="form-help">Track confidence filtering effectiveness and suggestion quality metrics</small>
          </div>

          {confidencePreview && (
            <div className="confidence-preview">
              <h4>Filtering Preview</h4>
              <div className="preview-stats">
                <div className="stat-item">
                  <span className="stat-label">Auto-Approved:</span>
                  <span className="stat-value stat-auto-approve">
                    {confidencePreview.statistics.autoApproved} ({Math.round((confidencePreview.statistics.autoApproved / confidencePreview.statistics.totalSuggestions) * 100)}%)
                  </span>
                </div>
                <div className="stat-item">
                  <span className="stat-label">Manual Review:</span>
                  <span className="stat-value stat-manual-review">
                    {confidencePreview.statistics.manualReview} ({Math.round((confidencePreview.statistics.manualReview / confidencePreview.statistics.totalSuggestions) * 100)}%)
                  </span>
                </div>
                <div className="stat-item">
                  <span className="stat-label">Rejected:</span>
                  <span className="stat-value stat-rejected">
                    {confidencePreview.statistics.rejected} ({Math.round((confidencePreview.statistics.rejected / confidencePreview.statistics.totalSuggestions) * 100)}%)
                  </span>
                </div>
                <div className="stat-item">
                  <span className="stat-label">Efficiency:</span>
                  <span className="stat-value">
                    {confidencePreview.statistics.filteringEffectiveness}%
                  </span>
                </div>
              </div>
              
              <div className="preview-suggestions">
                <h5>Sample Filtering Results (Threshold: {Math.round(effectiveThreshold * 100)}%)</h5>
                <div className="suggestions-list">
                  {confidencePreview.sampleSuggestions.slice(0, 5).map((suggestion, index) => (
                    <div key={index} className={`suggestion-preview suggestion-${suggestion.category}`}>
                      <div className="suggestion-filename">{suggestion.filename}</div>
                      <div className="suggestion-confidence">{Math.round(suggestion.confidence * 100)}%</div>
                      <div className="suggestion-category">
                        {suggestion.category === SuggestionCategory.AUTO_APPROVE && '✅ Auto'}
                        {suggestion.category === SuggestionCategory.MANUAL_REVIEW && '👁️ Review'}
                        {suggestion.category === SuggestionCategory.REJECT && '❌ Reject'}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="settings-section">
          <h3>Legacy Automation Settings</h3>
          <div className="form-group">
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={preferences?.workflow.autoApproveHighConfidence || false}
                onChange={(e) => handlePreferenceChange('workflow', 'autoApproveHighConfidence', e.target.checked)}
              />
              Auto-approve High Confidence Suggestions (Legacy)
            </label>
            <small className="form-help">Legacy setting - use Confidence Profile above for better control</small>
          </div>

          <div className="form-group">
            <label htmlFor="confidenceThreshold">Confidence Threshold (Legacy)</label>
            <div className="slider-group">
              <input
                type="range"
                id="confidenceThreshold"
                min="0.1"
                max="1.0"
                step="0.05"
                value={preferences?.workflow.confidenceThreshold || 0.8}
                onChange={(e) => handlePreferenceChange('workflow', 'confidenceThreshold', parseFloat(e.target.value))}
                className="form-slider"
              />
              <span className="slider-value">{((preferences?.workflow.confidenceThreshold || 0.8) * 100).toFixed(0)}%</span>
            </div>
            <small className="form-help">Legacy setting - use Confidence Profile above for better control</small>
            {validationErrors['workflow.confidenceThreshold'] && (
              <div className="error-message">{validationErrors['workflow.confidenceThreshold']}</div>
            )}
          </div>

          <div className="form-group">
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={preferences?.workflow.requireConfirmation || true}
                onChange={(e) => handlePreferenceChange('workflow', 'requireConfirmation', e.target.checked)}
              />
              Require Confirmation for Batch Operations
            </label>
            <small className="form-help">Show confirmation dialog before executing batch operations</small>
          </div>

          <div className="form-group">
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={preferences?.workflow.enableBatchMode || true}
                onChange={(e) => handlePreferenceChange('workflow', 'enableBatchMode', e.target.checked)}
              />
              Enable Batch Mode
            </label>
            <small className="form-help">Allow processing multiple files simultaneously</small>
          </div>

          <div className="form-group">
            <label htmlFor="defaultBatchSize">Default Batch Size</label>
            <input
              type="number"
              id="defaultBatchSize"
              value={preferences?.workflow.defaultBatchSize || 50}
              onChange={(e) => handlePreferenceChange('workflow', 'defaultBatchSize', parseInt(e.target.value))}
              className="form-control"
              min="1"
              max="1000"
            />
            <small className="form-help">Default number of files to process in each batch</small>
            {validationErrors['workflow.defaultBatchSize'] && (
              <div className="error-message">{validationErrors['workflow.defaultBatchSize']}</div>
            )}
          </div>
        </div>
      </div>
    );
  };

  const renderManualReviewTab = () => {
    const handleQueueConfigChange = (key: keyof ManualReviewQueueConfig, value: any) => {
      const newConfig = { ...reviewQueueConfig, [key]: value };
      setReviewQueueConfig(newConfig);
    };

    return (
      <div className="settings-tab-content">
        <div className="settings-section">
          <h3>Manual Review Queue Configuration</h3>
          <p>Configure how the manual review queue operates for confidence-filtered suggestions.</p>
          
          <div className="form-group">
            <label htmlFor="maxQueueSize">Maximum Queue Size</label>
            <input
              id="maxQueueSize"
              type="number"
              value={reviewQueueConfig.maxQueueSize}
              onChange={(e) => handleQueueConfigChange('maxQueueSize', parseInt(e.target.value))}
              className="form-control"
              min="10"
              max="10000"
            />
            <small className="form-help">Maximum number of items that can be queued for manual review</small>
          </div>

          <div className="form-group">
            <label htmlFor="batchSize">Default Batch Size</label>
            <input
              id="batchSize"
              type="number"
              value={reviewQueueConfig.batchSize}
              onChange={(e) => handleQueueConfigChange('batchSize', parseInt(e.target.value))}
              className="form-control"
              min="1"
              max="500"
            />
            <small className="form-help">Number of items to display per batch in review interface</small>
          </div>

          <div className="form-group">
            <label htmlFor="priorityThreshold">Priority Threshold</label>
            <input
              id="priorityThreshold"
              type="range"
              value={reviewQueueConfig.priorityThreshold}
              onChange={(e) => handleQueueConfigChange('priorityThreshold', parseFloat(e.target.value))}
              className="form-range"
              min="0"
              max="1"
              step="0.05"
            />
            <div className="range-labels">
              <span>Low Priority</span>
              <span className="current-value">{Math.round(reviewQueueConfig.priorityThreshold * 100)}%</span>
              <span>High Priority</span>
            </div>
            <small className="form-help">Confidence threshold above which suggestions get higher review priority</small>
          </div>

          <div className="form-group">
            <label htmlFor="autoCleanupDays">Auto Cleanup (Days)</label>
            <input
              id="autoCleanupDays"
              type="number"
              value={reviewQueueConfig.autoCleanupDays}
              onChange={(e) => handleQueueConfigChange('autoCleanupDays', parseInt(e.target.value))}
              className="form-control"
              min="1"
              max="365"
            />
            <small className="form-help">Number of days after which reviewed items are automatically cleaned up</small>
          </div>
        </div>

        <div className="settings-section">
          <h3>Manual Review Interface</h3>
          {manualReviewQueue ? (
            <ManualReviewQueueUI 
              queue={manualReviewQueue}
              onProcessDecision={(entryId, decision, reason) => {
                console.log('Processed decision:', { entryId, decision, reason });
                // TODO: Handle decision processing - could trigger batch operations
              }}
              onBatchReview={(decisions) => {
                console.log('Batch review processed:', decisions);
                // TODO: Handle batch review - could trigger batch operations
              }}
            />
          ) : (
            <div className="loading-placeholder">
              <p>Initializing manual review queue...</p>
            </div>
          )}
        </div>

        <div className="settings-section">
          <h3>Review Workflow Tips</h3>
          <div className="info-panel">
            <h4>🔍 Review Process</h4>
            <ul>
              <li><strong>Single Review:</strong> Click "Review" on any item to open detailed review modal</li>
              <li><strong>Batch Mode:</strong> Enable batch mode to review multiple items simultaneously</li>
              <li><strong>Filtering:</strong> Use filters to focus on specific confidence ranges or operation types</li>
              <li><strong>Priority Sorting:</strong> Items are sorted by priority based on confidence scores</li>
            </ul>
          </div>
          
          <div className="info-panel">
            <h4>⚙️ Decision Guidelines</h4>
            <ul>
              <li><strong>Approve:</strong> When AI suggestion is accurate and safe to execute</li>
              <li><strong>Reject:</strong> When suggestion is incorrect or potentially harmful</li>
              <li><strong>Override:</strong> Manual overrides are tracked for audit purposes</li>
              <li><strong>Batch Processing:</strong> Approved decisions are queued for batch execution</li>
            </ul>
          </div>

          <div className="info-panel">
            <h4>📊 Queue Management</h4>
            <ul>
              <li><strong>Auto Cleanup:</strong> Old reviewed items are automatically removed</li>
              <li><strong>Size Limits:</strong> Queue size is managed to prevent memory issues</li>
              <li><strong>Statistics:</strong> Track review efficiency and confidence distributions</li>
              <li><strong>Export:</strong> Review decisions can be exported for analysis</li>
            </ul>
          </div>
        </div>
      </div>
    );
  };

  const renderNotificationsTab = () => (
    <div className="settings-tab-content">
      <div className="settings-section">
        <h3>Notification Preferences</h3>
        <div className="form-group">
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={preferences?.notifications.showDesktopNotifications || true}
              onChange={(e) => handlePreferenceChange('notifications', 'showDesktopNotifications', e.target.checked)}
            />
            Show Desktop Notifications
          </label>
        </div>

        <div className="form-group">
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={preferences?.notifications.playSound || false}
              onChange={(e) => handlePreferenceChange('notifications', 'playSound', e.target.checked)}
            />
            Play Sound for Notifications
          </label>
        </div>

        <div className="form-group">
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={preferences?.notifications.notifyOnCompletion || true}
              onChange={(e) => handlePreferenceChange('notifications', 'notifyOnCompletion', e.target.checked)}
            />
            Notify on Operation Completion
          </label>
        </div>

        <div className="form-group">
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={preferences?.notifications.notifyOnErrors || true}
              onChange={(e) => handlePreferenceChange('notifications', 'notifyOnErrors', e.target.checked)}
            />
            Notify on Errors
          </label>
        </div>

        <div className="form-group">
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={preferences?.notifications.quietHours.enabled || false}
              onChange={(e) => handlePreferenceChange('notifications', 'quietHours', {
                ...preferences?.notifications.quietHours,
                enabled: e.target.checked
              })}
            />
            Enable Quiet Hours
          </label>
        </div>

        {preferences?.notifications.quietHours.enabled && (
          <div className="form-group-row">
            <div className="form-group">
              <label htmlFor="quietHoursStart">Start Time</label>
              <input
                type="time"
                id="quietHoursStart"
                value={preferences?.notifications.quietHours.start || '22:00'}
                onChange={(e) => handlePreferenceChange('notifications', 'quietHours', {
                  ...preferences.notifications.quietHours,
                  start: e.target.value
                })}
                className="form-control"
              />
            </div>
            <div className="form-group">
              <label htmlFor="quietHoursEnd">End Time</label>
              <input
                type="time"
                id="quietHoursEnd"
                value={preferences?.notifications.quietHours.end || '08:00'}
                onChange={(e) => handlePreferenceChange('notifications', 'quietHours', {
                  ...preferences.notifications.quietHours,
                  end: e.target.value
                })}
                className="form-control"
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );

  const renderAdvancedTab = () => (
    <div className="settings-tab-content">
      <div className="settings-section">
        <h3>Logging & Diagnostics</h3>
        <div className="form-group">
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={preferences?.advanced.enableLogging || true}
              onChange={(e) => handlePreferenceChange('advanced', 'enableLogging', e.target.checked)}
            />
            Enable Application Logging
          </label>
        </div>

        <div className="form-group">
          <label htmlFor="logLevel">Log Level</label>
          <select
            id="logLevel"
            value={preferences?.advanced.logLevel || 'info'}
            onChange={(e) => handlePreferenceChange('advanced', 'logLevel', e.target.value)}
            className="form-control"
            disabled={!preferences?.advanced.enableLogging}
          >
            <option value="error">Error</option>
            <option value="warn">Warning</option>
            <option value="info">Information</option>
            <option value="debug">Debug</option>
          </select>
        </div>

        <div className="form-group">
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={preferences?.advanced.enableAnalytics || false}
              onChange={(e) => handlePreferenceChange('advanced', 'enableAnalytics', e.target.checked)}
            />
            Enable Anonymous Usage Analytics
          </label>
          <small className="form-help">Help improve the application by sharing anonymous usage data</small>
        </div>
      </div>

      <div className="settings-section">
        <h3>Data Management</h3>
        <div className="form-group">
          <label htmlFor="autoSaveInterval">Auto-save Interval (minutes)</label>
          <input
            type="number"
            id="autoSaveInterval"
            value={preferences?.advanced.autoSaveInterval || 5}
            onChange={(e) => handlePreferenceChange('advanced', 'autoSaveInterval', parseInt(e.target.value))}
            className="form-control"
            min="1"
            max="60"
          />
        </div>

        <div className="form-group">
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={preferences?.advanced.backupSettings || true}
              onChange={(e) => handlePreferenceChange('advanced', 'backupSettings', e.target.checked)}
            />
            Automatic Settings Backup
          </label>
        </div>
      </div>
    </div>
  );

  const renderProfileTab = () => (
    <div className="settings-tab-content">
      <div className="settings-section">
        <h3>User Profile</h3>
        {userProfile && (
          <>
            <div className="profile-info">
              <div className="profile-field">
                <label>User ID</label>
                <span className="profile-value">{userProfile.id}</span>
              </div>
              <div className="profile-field">
                <label>Name</label>
                <span className="profile-value">{userProfile.name}</span>
              </div>
              {userProfile.email && (
                <div className="profile-field">
                  <label>Email</label>
                  <span className="profile-value">{userProfile.email}</span>
                </div>
              )}
              <div className="profile-field">
                <label>Created</label>
                <span className="profile-value">{new Date(userProfile.createdAt).toLocaleDateString()}</span>
              </div>
              <div className="profile-field">
                <label>Last Active</label>
                <span className="profile-value">{new Date(userProfile.lastActiveAt).toLocaleString()}</span>
              </div>
            </div>
          </>
        )}
      </div>

      <div className="settings-section">
        <h3>Settings Management</h3>
        <div className="settings-actions">
          <button
            onClick={exportSettings}
            disabled={exportingSettings}
            className="btn btn-secondary"
          >
            {exportingSettings ? 'Exporting...' : 'Export Settings'}
          </button>
          <button
            onClick={importSettings}
            disabled={importingSettings}
            className="btn btn-secondary"
          >
            {importingSettings ? 'Importing...' : 'Import Settings'}
          </button>
          <button
            onClick={resetToDefaults}
            className="btn btn-warning"
          >
            Reset to Defaults
          </button>
        </div>
      </div>
    </div>
  );

  if (loading) {
    return (
      <div className="settings-container">
        <div className="loading-spinner">Loading settings...</div>
      </div>
    );
  }

  const tabs = [
    { id: 'model', label: 'Model Config', icon: '🤖' },
    { id: 'performance', label: 'Performance', icon: '⚡' },
    { id: 'appearance', label: 'Appearance', icon: '🎨' },
    { id: 'theme', label: 'Theme', icon: '🌈' },
    { id: 'workflow', label: 'Workflow', icon: '⚙️' },
    { id: 'manual-review', label: 'Manual Review', icon: '👁️' },
    { id: 'notifications', label: 'Notifications', icon: '🔔' },
    { id: 'advanced', label: 'Advanced', icon: '🔧' },
    { id: 'profile', label: 'Profile', icon: '👤' }
  ];

  return (
    <div className="settings-container">
      <div className="settings-header">
        <h2>Settings</h2>
        {unsavedChanges && (
          <div className="unsaved-changes-indicator">
            <span>Unsaved changes</span>
          </div>
        )}
      </div>

      <div className="settings-content">
        <div className="settings-sidebar">
          <div className="settings-tabs">
            {tabs.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`settings-tab ${activeTab === tab.id ? 'active' : ''}`}
              >
                <span className="tab-icon">{tab.icon}</span>
                <span className="tab-label">{tab.label}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="settings-main">
          {activeTab === 'model' && renderModelConfigTab()}
          {activeTab === 'performance' && renderPerformanceTab()}
          {activeTab === 'appearance' && renderAppearanceTab()}
          {activeTab === 'theme' && <ThemeCustomizer />}
          {activeTab === 'workflow' && renderWorkflowTab()}
          {activeTab === 'manual-review' && renderManualReviewTab()}
          {activeTab === 'notifications' && renderNotificationsTab()}
          {activeTab === 'advanced' && renderAdvancedTab()}
          {activeTab === 'profile' && renderProfileTab()}
        </div>
      </div>

      <div className="settings-footer">
        <div className="settings-actions">
          <button
            onClick={() => window.location.reload()}
            className="btn btn-secondary"
            disabled={saving}
          >
            Cancel
          </button>
          <button
            onClick={saveSettings}
            disabled={saving || Object.keys(validationErrors).length > 0}
            className="btn btn-primary"
          >
            {saving ? 'Saving...' : 'Save Settings'}
          </button>
        </div>
        {Object.keys(validationErrors).length > 0 && (
          <div className="validation-summary">
            <span>Please fix validation errors before saving</span>
          </div>
        )}
      </div>
    </div>
  );
};

export default Settings;
