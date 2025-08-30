import React, { useState, useCallback } from 'react';
import { useTheme, themePresets, Theme, FontSize } from '../contexts/ThemeContext';
import './ThemeCustomizer.css';

interface ColorPickerProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  description?: string;
}

const ColorPicker: React.FC<ColorPickerProps> = ({ label, value, onChange, description }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [tempValue, setTempValue] = useState(value);

  const presetColors = [
    '#007aff', '#5856d6', '#ff9500', '#28a745', '#ffc107', '#dc3545', '#17a2b8',
    '#0a84ff', '#5e5ce6', '#ff9f0a', '#32d74b', '#ff9f0a', '#ff453a', '#64d2ff',
    '#000000', '#333333', '#666666', '#999999', '#cccccc', '#ffffff'
  ];

  const handleApply = () => {
    onChange(tempValue);
    setIsOpen(false);
  };

  return (
    <div className="color-picker">
      <div className="color-picker-label">
        <label>{label}</label>
        {description && <small>{description}</small>}
      </div>
      <div className="color-picker-input">
        <button
          type="button"
          className="color-preview"
          style={{ backgroundColor: value }}
          onClick={() => setIsOpen(!isOpen)}
          aria-label={`Current color: ${value}. Click to change.`}
        >
          <span className="color-value">{value}</span>
        </button>
        {isOpen && (
          <div className="color-picker-dropdown">
            <div className="color-picker-header">
              <input
                type="color"
                value={tempValue}
                onChange={(e) => setTempValue(e.target.value)}
                className="color-input"
              />
              <input
                type="text"
                value={tempValue}
                onChange={(e) => setTempValue(e.target.value)}
                className="color-text-input"
                placeholder="#000000"
                pattern="^#[0-9A-Fa-f]{6}$"
              />
            </div>
            <div className="color-presets">
              {presetColors.map((color) => (
                <button
                  key={color}
                  type="button"
                  className={`color-preset ${tempValue === color ? 'active' : ''}`}
                  style={{ backgroundColor: color }}
                  onClick={() => setTempValue(color)}
                  aria-label={`Preset color: ${color}`}
                />
              ))}
            </div>
            <div className="color-picker-actions">
              <button type="button" onClick={() => setIsOpen(false)} className="btn btn-secondary">
                Cancel
              </button>
              <button type="button" onClick={handleApply} className="btn btn-primary">
                Apply
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

interface ThemePresetCardProps {
  name: string;
  description: string;
  preset: any;
  isActive: boolean;
  onSelect: () => void;
}

const ThemePresetCard: React.FC<ThemePresetCardProps> = ({
  name,
  description,
  preset,
  isActive,
  onSelect
}) => {
  const colorScheme = preset.colorScheme || themePresets.lightDefault.colorScheme;

  return (
    <div className={`theme-preset-card ${isActive ? 'active' : ''}`} onClick={onSelect}>
      <div className="theme-preset-preview">
        <div className="theme-preview-header" style={{ backgroundColor: colorScheme.surface }}>
          <div className="theme-preview-title" style={{ color: colorScheme.text }}>
            Preview
          </div>
          <div className="theme-preview-controls">
            <div className="theme-preview-button" style={{ backgroundColor: colorScheme.primary }} />
            <div className="theme-preview-button" style={{ backgroundColor: colorScheme.secondary }} />
          </div>
        </div>
        <div className="theme-preview-content" style={{ backgroundColor: colorScheme.background }}>
          <div className="theme-preview-text" style={{ color: colorScheme.text }}>
            Sample text
          </div>
          <div className="theme-preview-text-secondary" style={{ color: colorScheme.textSecondary }}>
            Secondary text
          </div>
          <div className="theme-preview-accent" style={{ backgroundColor: colorScheme.accent }} />
        </div>
      </div>
      <div className="theme-preset-info">
        <h4>{name}</h4>
        <p>{description}</p>
        {isActive && <div className="active-indicator">Currently Active</div>}
      </div>
    </div>
  );
};

export const ThemeCustomizer: React.FC = () => {
  const {
    preferences,
    updateTheme,
    updateFontSize,
    toggleCompactMode,
    toggleHighContrast,
    toggleReducedMotion,
    toggleAnimations,
    updateColorScheme,
    updateCustomCSS,
    resetToDefaults,
    exportTheme,
    importTheme
  } = useTheme();

  const [activeTab, setActiveTab] = useState<'presets' | 'colors' | 'typography' | 'layout' | 'advanced'>('presets');
  const [customCSS, setCustomCSS] = useState(preferences.customCSS || '');
  const [importData, setImportData] = useState('');
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [showExportDialog, setShowExportDialog] = useState(false);
  const [exportedData, setExportedData] = useState('');

  const handleExportTheme = useCallback(() => {
    const exported = exportTheme();
    setExportedData(exported);
    setShowExportDialog(true);
  }, [exportTheme]);

  const handleImportTheme = useCallback(() => {
    const success = importTheme(importData);
    if (success) {
      setShowImportDialog(false);
      setImportData('');
    } else {
      alert('Failed to import theme. Please check the data format.');
    }
  }, [importTheme, importData]);

  const handleColorChange = useCallback((colorKey: string, value: string) => {
    updateColorScheme({ [colorKey]: value });
  }, [updateColorScheme]);

  const handleApplyCustomCSS = useCallback(() => {
    updateCustomCSS(customCSS);
  }, [updateCustomCSS, customCSS]);

  const applyPreset = useCallback((presetName: keyof typeof themePresets) => {
    const preset = themePresets[presetName];
    updateTheme(preset.theme);
    if (preset.fontSize) updateFontSize(preset.fontSize);
    if (preset.compactMode !== undefined) {
      if (preset.compactMode !== preferences.compactMode) toggleCompactMode();
    }
    if (preset.highContrast !== undefined) {
      if (preset.highContrast !== preferences.highContrast) toggleHighContrast();
    }
    if (preset.colorScheme) {
      updateColorScheme(preset.colorScheme);
    }
  }, [updateTheme, updateFontSize, toggleCompactMode, toggleHighContrast, updateColorScheme, preferences]);

  const renderPresetsTab = () => (
    <div className="theme-tab-content">
      <div className="theme-presets-grid">
        {Object.entries(themePresets).map(([key, preset]) => (
          <ThemePresetCard
            key={key}
            name={key.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase())}
            description={getPresetDescription(key as keyof typeof themePresets)}
            preset={preset}
            isActive={isPresetActive(key as keyof typeof themePresets)}
            onSelect={() => applyPreset(key as keyof typeof themePresets)}
          />
        ))}
      </div>
      
      <div className="theme-actions">
        <button onClick={handleExportTheme} className="btn btn-secondary">
          Export Current Theme
        </button>
        <button onClick={() => setShowImportDialog(true)} className="btn btn-secondary">
          Import Theme
        </button>
        <button onClick={resetToDefaults} className="btn btn-outline">
          Reset to Defaults
        </button>
      </div>
    </div>
  );

  const renderColorsTab = () => (
    <div className="theme-tab-content">
      <div className="color-section">
        <h3>Primary Colors</h3>
        <div className="color-grid">
          <ColorPicker
            label="Primary"
            value={preferences.colorScheme?.primary || '#007aff'}
            onChange={(value) => handleColorChange('primary', value)}
            description="Main brand color used for buttons and links"
          />
          <ColorPicker
            label="Secondary"
            value={preferences.colorScheme?.secondary || '#5856d6'}
            onChange={(value) => handleColorChange('secondary', value)}
            description="Secondary accent color"
          />
          <ColorPicker
            label="Accent"
            value={preferences.colorScheme?.accent || '#ff9500'}
            onChange={(value) => handleColorChange('accent', value)}
            description="Highlight and emphasis color"
          />
        </div>
      </div>

      <div className="color-section">
        <h3>Background Colors</h3>
        <div className="color-grid">
          <ColorPicker
            label="Background"
            value={preferences.colorScheme?.background || '#ffffff'}
            onChange={(value) => handleColorChange('background', value)}
            description="Main background color"
          />
          <ColorPicker
            label="Surface"
            value={preferences.colorScheme?.surface || '#f8f9fa'}
            onChange={(value) => handleColorChange('surface', value)}
            description="Card and panel background"
          />
        </div>
      </div>

      <div className="color-section">
        <h3>Text Colors</h3>
        <div className="color-grid">
          <ColorPicker
            label="Text"
            value={preferences.colorScheme?.text || '#1a1a1a'}
            onChange={(value) => handleColorChange('text', value)}
            description="Primary text color"
          />
          <ColorPicker
            label="Secondary Text"
            value={preferences.colorScheme?.textSecondary || '#6b6b6b'}
            onChange={(value) => handleColorChange('textSecondary', value)}
            description="Secondary and muted text"
          />
          <ColorPicker
            label="Border"
            value={preferences.colorScheme?.border || '#e5e5e5'}
            onChange={(value) => handleColorChange('border', value)}
            description="Border and divider color"
          />
        </div>
      </div>

      <div className="color-section">
        <h3>Status Colors</h3>
        <div className="color-grid">
          <ColorPicker
            label="Success"
            value={preferences.colorScheme?.success || '#28a745'}
            onChange={(value) => handleColorChange('success', value)}
            description="Success states and positive actions"
          />
          <ColorPicker
            label="Warning"
            value={preferences.colorScheme?.warning || '#ffc107'}
            onChange={(value) => handleColorChange('warning', value)}
            description="Warning states and caution"
          />
          <ColorPicker
            label="Error"
            value={preferences.colorScheme?.error || '#dc3545'}
            onChange={(value) => handleColorChange('error', value)}
            description="Error states and destructive actions"
          />
          <ColorPicker
            label="Info"
            value={preferences.colorScheme?.info || '#17a2b8'}
            onChange={(value) => handleColorChange('info', value)}
            description="Informational states and neutral actions"
          />
        </div>
      </div>
    </div>
  );

  const renderTypographyTab = () => (
    <div className="theme-tab-content">
      <div className="typography-section">
        <h3>Font Settings</h3>
        <div className="form-group">
          <label htmlFor="fontSize">Font Size</label>
          <select
            id="fontSize"
            value={preferences.fontSize}
            onChange={(e) => updateFontSize(e.target.value as FontSize)}
            className="form-control"
          >
            <option value="small">Small (14px base)</option>
            <option value="medium">Medium (16px base)</option>
            <option value="large">Large (18px base)</option>
          </select>
          <small>Adjust the base font size for all text in the application</small>
        </div>
      </div>

      <div className="typography-preview">
        <h3>Typography Preview</h3>
        <div className="typography-sample">
          <h1>Heading 1</h1>
          <h2>Heading 2</h2>
          <h3>Heading 3</h3>
          <h4>Heading 4</h4>
          <p>This is a paragraph with <strong>bold text</strong> and <em>italic text</em>.</p>
          <p className="text-secondary">This is secondary text used for descriptions and labels.</p>
          <small>This is small text used for captions and footnotes.</small>
        </div>
      </div>
    </div>
  );

  const renderLayoutTab = () => (
    <div className="theme-tab-content">
      <div className="layout-section">
        <h3>Layout Options</h3>
        <div className="layout-controls">
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={preferences.compactMode}
              onChange={toggleCompactMode}
            />
            Compact Mode
            <small>Use smaller spacing and padding throughout the interface</small>
          </label>

          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={preferences.animationsEnabled}
              onChange={toggleAnimations}
            />
            Enable Animations
            <small>Use smooth transitions and animations in the interface</small>
          </label>

          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={preferences.reducedMotion}
              onChange={toggleReducedMotion}
            />
            Reduced Motion
            <small>Minimize animations for users who prefer less motion</small>
          </label>
        </div>
      </div>

      <div className="accessibility-section">
        <h3>Accessibility</h3>
        <div className="accessibility-controls">
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={preferences.highContrast}
              onChange={toggleHighContrast}
            />
            High Contrast Mode
            <small>Increase contrast for better visibility</small>
          </label>
        </div>
      </div>
    </div>
  );

  const renderAdvancedTab = () => (
    <div className="theme-tab-content">
      <div className="advanced-section">
        <h3>Custom CSS</h3>
        <div className="custom-css-editor">
          <textarea
            value={customCSS}
            onChange={(e) => setCustomCSS(e.target.value)}
            placeholder="/* Add your custom CSS here */
.my-custom-class {
  color: #ff0000;
}"
            className="css-textarea"
            rows={15}
          />
          <div className="css-actions">
            <button onClick={handleApplyCustomCSS} className="btn btn-primary">
              Apply Custom CSS
            </button>
            <button onClick={() => setCustomCSS('')} className="btn btn-secondary">
              Clear
            </button>
          </div>
        </div>
        <small>
          Add custom CSS to further customize the appearance. Changes will be applied immediately.
          Be careful with custom CSS as it may interfere with application functionality.
        </small>
      </div>

      <div className="theme-data-section">
        <h3>Theme Management</h3>
        <div className="theme-data-actions">
          <button onClick={handleExportTheme} className="btn btn-secondary">
            Export Theme Data
          </button>
          <button onClick={() => setShowImportDialog(true)} className="btn btn-secondary">
            Import Theme Data
          </button>
          <button onClick={resetToDefaults} className="btn btn-outline">
            Reset All Settings
          </button>
        </div>
      </div>
    </div>
  );

  const isPresetActive = (presetName: keyof typeof themePresets): boolean => {
    const preset = themePresets[presetName];
    return (
      preferences.theme === preset.theme &&
      preferences.compactMode === (preset.compactMode || false) &&
      preferences.highContrast === (preset.highContrast || false)
    );
  };

  const getPresetDescription = (presetName: keyof typeof themePresets): string => {
    const descriptions = {
      lightDefault: 'Clean light theme with standard spacing',
      darkDefault: 'Dark theme optimized for low-light environments',
      highContrast: 'High contrast theme for better accessibility',
      compact: 'Compact layout with smaller spacing and elements'
    };
    return descriptions[presetName] || 'Custom theme preset';
  };

  const tabs = [
    { id: 'presets', label: 'Presets', icon: '🎨' },
    { id: 'colors', label: 'Colors', icon: '🌈' },
    { id: 'typography', label: 'Typography', icon: '📝' },
    { id: 'layout', label: 'Layout', icon: '📐' },
    { id: 'advanced', label: 'Advanced', icon: '⚙️' }
  ] as const;

  return (
    <div className="theme-customizer">
      <div className="theme-customizer-header">
        <h2>Theme Customization</h2>
        <div className="current-theme-info">
          <span>Current: {preferences.theme} theme</span>
          {preferences.compactMode && <span className="theme-modifier">Compact</span>}
          {preferences.highContrast && <span className="theme-modifier">High Contrast</span>}
        </div>
      </div>

      <div className="theme-customizer-content">
        <div className="theme-tabs">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`theme-tab ${activeTab === tab.id ? 'active' : ''}`}
            >
              <span className="tab-icon">{tab.icon}</span>
              <span className="tab-label">{tab.label}</span>
            </button>
          ))}
        </div>

        <div className="theme-tab-container">
          {activeTab === 'presets' && renderPresetsTab()}
          {activeTab === 'colors' && renderColorsTab()}
          {activeTab === 'typography' && renderTypographyTab()}
          {activeTab === 'layout' && renderLayoutTab()}
          {activeTab === 'advanced' && renderAdvancedTab()}
        </div>
      </div>

      {/* Export Dialog */}
      {showExportDialog && (
        <div className="modal-overlay" onClick={() => setShowExportDialog(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Export Theme</h3>
              <button onClick={() => setShowExportDialog(false)} className="modal-close">×</button>
            </div>
            <div className="modal-body">
              <p>Copy the theme data below to share or backup your custom theme:</p>
              <textarea
                value={exportedData}
                readOnly
                className="export-textarea"
                rows={10}
              />
            </div>
            <div className="modal-footer">
              <button
                onClick={() => navigator.clipboard.writeText(exportedData)}
                className="btn btn-primary"
              >
                Copy to Clipboard
              </button>
              <button onClick={() => setShowExportDialog(false)} className="btn btn-secondary">
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Import Dialog */}
      {showImportDialog && (
        <div className="modal-overlay" onClick={() => setShowImportDialog(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Import Theme</h3>
              <button onClick={() => setShowImportDialog(false)} className="modal-close">×</button>
            </div>
            <div className="modal-body">
              <p>Paste the theme data below to import a custom theme:</p>
              <textarea
                value={importData}
                onChange={(e) => setImportData(e.target.value)}
                placeholder="Paste theme JSON data here..."
                className="import-textarea"
                rows={10}
              />
            </div>
            <div className="modal-footer">
              <button onClick={handleImportTheme} className="btn btn-primary">
                Import Theme
              </button>
              <button onClick={() => setShowImportDialog(false)} className="btn btn-secondary">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ThemeCustomizer;
