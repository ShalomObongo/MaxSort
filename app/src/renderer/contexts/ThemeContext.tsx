import React, { createContext, useContext, useState, useEffect } from 'react';

export type Theme = 'light' | 'dark' | 'system';
export type FontSize = 'small' | 'medium' | 'large';

interface ThemePreferences {
  theme: Theme;
  fontSize: FontSize;
  compactMode: boolean;
  highContrast: boolean;
  reducedMotion: boolean;
  animationsEnabled: boolean;
  colorScheme?: {
    primary: string;
    secondary: string;
    accent: string;
    background: string;
    surface: string;
    text: string;
    textSecondary: string;
    border: string;
    success: string;
    warning: string;
    error: string;
    info: string;
  };
  customCSS?: string;
}

interface ThemeContextValue {
  preferences: ThemePreferences;
  updateTheme: (theme: Theme) => void;
  updateFontSize: (fontSize: FontSize) => void;
  toggleCompactMode: () => void;
  toggleHighContrast: () => void;
  toggleReducedMotion: () => void;
  toggleAnimations: () => void;
  updateColorScheme: (colors: Partial<ThemePreferences['colorScheme']>) => void;
  updateCustomCSS: (css: string) => void;
  resetToDefaults: () => void;
  exportTheme: () => string;
  importTheme: (themeData: string) => boolean;
}

const defaultThemePreferences: ThemePreferences = {
  theme: 'system',
  fontSize: 'medium',
  compactMode: false,
  highContrast: false,
  reducedMotion: false,
  animationsEnabled: true,
  colorScheme: {
    primary: '#007aff',
    secondary: '#5856d6',
    accent: '#ff9500',
    background: '#ffffff',
    surface: '#f8f9fa',
    text: '#1a1a1a',
    textSecondary: '#6b6b6b',
    border: '#e5e5e5',
    success: '#28a745',
    warning: '#ffc107',
    error: '#dc3545',
    info: '#17a2b8'
  }
};

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

// Export the context for testing purposes
export { ThemeContext };

interface ThemeProviderProps {
  children: React.ReactNode;
  initialPreferences?: Partial<ThemePreferences>;
}

export const ThemeProvider: React.FC<ThemeProviderProps> = ({
  children,
  initialPreferences = {}
}) => {
  const [preferences, setPreferences] = useState<ThemePreferences>({
    ...defaultThemePreferences,
    ...initialPreferences
  });

  // Apply theme to document root
  useEffect(() => {
    applyThemeToDocument(preferences);
  }, [preferences]);

  // Listen for system theme changes
  useEffect(() => {
    if (preferences.theme === 'system') {
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      const handleSystemThemeChange = () => {
        applyThemeToDocument(preferences);
      };
      
      mediaQuery.addEventListener('change', handleSystemThemeChange);
      return () => mediaQuery.removeEventListener('change', handleSystemThemeChange);
    }
  }, [preferences.theme]);

  // Listen for system accessibility preferences
  useEffect(() => {
    const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const contrastQuery = window.matchMedia('(prefers-contrast: high)');

    const handleReducedMotionChange = () => {
      if (reducedMotionQuery.matches && !preferences.reducedMotion) {
        setPreferences(prev => ({ ...prev, reducedMotion: true, animationsEnabled: false }));
      }
    };

    const handleContrastChange = () => {
      if (contrastQuery.matches && !preferences.highContrast) {
        setPreferences(prev => ({ ...prev, highContrast: true }));
      }
    };

    reducedMotionQuery.addEventListener('change', handleReducedMotionChange);
    contrastQuery.addEventListener('change', handleContrastChange);

    // Initial check
    handleReducedMotionChange();
    handleContrastChange();

    return () => {
      reducedMotionQuery.removeEventListener('change', handleReducedMotionChange);
      contrastQuery.removeEventListener('change', handleContrastChange);
    };
  }, [preferences.reducedMotion, preferences.highContrast]);

  const updateTheme = (theme: Theme) => {
    setPreferences(prev => ({ ...prev, theme }));
    
    // Save to localStorage
    localStorage.setItem('maxsort-theme', theme);
    
    // Save to electron settings if available
    if (window.electronAPI && 'settings' in window.electronAPI) {
      (window.electronAPI as any).settings?.saveUserPreferences?.({
        ui: { theme }
      }).catch(console.error);
    }
  };

  const updateFontSize = (fontSize: FontSize) => {
    setPreferences(prev => ({ ...prev, fontSize }));
    localStorage.setItem('maxsort-font-size', fontSize);
  };

  const toggleCompactMode = () => {
    setPreferences(prev => {
      const compactMode = !prev.compactMode;
      localStorage.setItem('maxsort-compact-mode', String(compactMode));
      return { ...prev, compactMode };
    });
  };

  const toggleHighContrast = () => {
    setPreferences(prev => {
      const highContrast = !prev.highContrast;
      localStorage.setItem('maxsort-high-contrast', String(highContrast));
      return { ...prev, highContrast };
    });
  };

  const toggleReducedMotion = () => {
    setPreferences(prev => {
      const reducedMotion = !prev.reducedMotion;
      const animationsEnabled = !reducedMotion;
      localStorage.setItem('maxsort-reduced-motion', String(reducedMotion));
      return { ...prev, reducedMotion, animationsEnabled };
    });
  };

  const toggleAnimations = () => {
    setPreferences(prev => {
      const animationsEnabled = !prev.animationsEnabled;
      localStorage.setItem('maxsort-animations', String(animationsEnabled));
      return { ...prev, animationsEnabled, reducedMotion: !animationsEnabled };
    });
  };

  const updateColorScheme = (colors: Partial<ThemePreferences['colorScheme']>) => {
    setPreferences(prev => ({
      ...prev,
      colorScheme: prev.colorScheme ? { ...prev.colorScheme, ...colors } : { ...defaultThemePreferences.colorScheme!, ...colors }
    }));
  };

  const updateCustomCSS = (css: string) => {
    setPreferences(prev => ({ ...prev, customCSS: css }));
    localStorage.setItem('maxsort-custom-css', css);
  };

  const resetToDefaults = () => {
    setPreferences(defaultThemePreferences);
    
    // Clear localStorage
    localStorage.removeItem('maxsort-theme');
    localStorage.removeItem('maxsort-font-size');
    localStorage.removeItem('maxsort-compact-mode');
    localStorage.removeItem('maxsort-high-contrast');
    localStorage.removeItem('maxsort-reduced-motion');
    localStorage.removeItem('maxsort-animations');
    localStorage.removeItem('maxsort-custom-css');
  };

  const exportTheme = (): string => {
    const themeExport = {
      version: '1.0',
      timestamp: new Date().toISOString(),
      preferences,
      metadata: {
        appVersion: '1.0.0', // Should come from app
        platform: navigator.platform,
        userAgent: navigator.userAgent
      }
    };
    
    return JSON.stringify(themeExport, null, 2);
  };

  const importTheme = (themeData: string): boolean => {
    try {
      const imported = JSON.parse(themeData);
      
      // Validate import data
      if (!imported.preferences || !imported.version) {
        throw new Error('Invalid theme data format');
      }

      // Merge with defaults to handle missing properties
      const newPreferences: ThemePreferences = {
        ...defaultThemePreferences,
        ...imported.preferences
      };

      setPreferences(newPreferences);
      return true;
    } catch (error) {
      console.error('Failed to import theme:', error);
      return false;
    }
  };

  const contextValue: ThemeContextValue = {
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
  };

  return (
    <ThemeContext.Provider value={contextValue}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = (): ThemeContextValue => {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};

// Helper function to apply theme to document
const applyThemeToDocument = (preferences: ThemePreferences) => {
  const root = document.documentElement;
  
  // Determine effective theme
  let effectiveTheme = preferences.theme;
  if (preferences.theme === 'system') {
    effectiveTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  // Apply theme class
  root.setAttribute('data-theme', effectiveTheme);
  
  // Apply font size
  root.setAttribute('data-font-size', preferences.fontSize);
  
  // Apply mode classes
  root.classList.toggle('compact-mode', preferences.compactMode);
  root.classList.toggle('high-contrast', preferences.highContrast);
  root.classList.toggle('reduced-motion', preferences.reducedMotion);
  root.classList.toggle('animations-disabled', !preferences.animationsEnabled);

  // Apply custom color scheme if provided
  if (preferences.colorScheme) {
    const colors = preferences.colorScheme;
    Object.entries(colors).forEach(([key, value]) => {
      if (value) {
        root.style.setProperty(`--color-${key}`, value);
      }
    });
  }

  // Apply custom CSS
  if (preferences.customCSS) {
    let customStyle = document.getElementById('maxsort-custom-css');
    if (!customStyle) {
      customStyle = document.createElement('style');
      customStyle.id = 'maxsort-custom-css';
      document.head.appendChild(customStyle);
    }
    customStyle.textContent = preferences.customCSS;
  } else {
    const existingCustomStyle = document.getElementById('maxsort-custom-css');
    if (existingCustomStyle) {
      existingCustomStyle.remove();
    }
  }
};

// Load theme preferences from localStorage on app start
export const loadThemePreferences = (): Partial<ThemePreferences> => {
  const theme = localStorage.getItem('maxsort-theme') as Theme;
  const fontSize = localStorage.getItem('maxsort-font-size') as FontSize;
  const compactMode = localStorage.getItem('maxsort-compact-mode') === 'true';
  const highContrast = localStorage.getItem('maxsort-high-contrast') === 'true';
  const reducedMotion = localStorage.getItem('maxsort-reduced-motion') === 'true';
  const animationsEnabled = localStorage.getItem('maxsort-animations') !== 'false';
  const customCSS = localStorage.getItem('maxsort-custom-css');

  return {
    ...(theme && { theme }),
    ...(fontSize && { fontSize }),
    compactMode,
    highContrast,
    reducedMotion,
    animationsEnabled,
    ...(customCSS && { customCSS })
  };
};

// Predefined theme presets
export const themePresets = {
  lightDefault: {
    ...defaultThemePreferences,
    theme: 'light' as Theme
  },
  darkDefault: {
    ...defaultThemePreferences,
    theme: 'dark' as Theme,
    colorScheme: {
      primary: '#0a84ff',
      secondary: '#5e5ce6',
      accent: '#ff9f0a',
      background: '#1e1e1e',
      surface: '#2a2a2a',
      text: '#ffffff',
      textSecondary: '#b3b3b3',
      border: '#3a3a3a',
      success: '#32d74b',
      warning: '#ff9f0a',
      error: '#ff453a',
      info: '#64d2ff'
    }
  },
  highContrast: {
    ...defaultThemePreferences,
    highContrast: true,
    colorScheme: {
      primary: '#0066cc',
      secondary: '#4a4a4a',
      accent: '#cc6600',
      background: '#ffffff',
      surface: '#f5f5f5',
      text: '#000000',
      textSecondary: '#333333',
      border: '#000000',
      success: '#006600',
      warning: '#cc6600',
      error: '#cc0000',
      info: '#0066cc'
    }
  },
  compact: {
    ...defaultThemePreferences,
    compactMode: true,
    fontSize: 'small' as FontSize
  }
} as const;
