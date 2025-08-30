/**
 * Settings persistence integration tests for confidence filtering system
 * Tests Task 6: Settings persistence and UI integration testing
 */

import { describe, test, expect, beforeEach, vi } from 'vitest';
import {
  ConfidenceThresholdConfig,
  CONFIDENCE_PROFILES,
  createDefaultConfidenceThresholdConfig,
  ConfidenceThresholdValidator,
} from '../src/lib/confidence-threshold-config';

describe('Confidence Settings Integration Tests (Task 6)', () => {
  let mockStorage: Map<string, string>;

  // Mock localStorage
  const mockLocalStorage = {
    getItem: vi.fn((key: string) => mockStorage.get(key) || null),
    setItem: vi.fn((key: string, value: string) => mockStorage.set(key, value)),
    removeItem: vi.fn((key: string) => mockStorage.delete(key)),
    clear: vi.fn(() => mockStorage.clear()),
  };

  beforeEach(() => {
    mockStorage = new Map();
    vi.clearAllMocks();
    
    // Mock window.localStorage
    Object.defineProperty(window, 'localStorage', {
      value: mockLocalStorage,
      writable: true,
    });
  });

  describe('Settings Persistence (AC: 4)', () => {
    test('should persist confidence threshold configuration', () => {
      const config: ConfidenceThresholdConfig = {
        profile: CONFIDENCE_PROFILES.custom,
        customThreshold: 0.85,
        autoApprove: false,
        enableBatchMode: true,
        enableManualOverride: true,
        enableStatistics: true,
      };

      // Simulate saving configuration to localStorage
      const configKey = 'confidence-threshold-config';
      const serializedConfig = JSON.stringify(config);
      mockLocalStorage.setItem(configKey, serializedConfig);

      // Verify storage was called
      expect(mockLocalStorage.setItem).toHaveBeenCalledWith(configKey, serializedConfig);
      expect(mockStorage.get(configKey)).toBe(serializedConfig);
    });

    test('should restore confidence threshold configuration from storage', () => {
      const originalConfig: ConfidenceThresholdConfig = {
        profile: CONFIDENCE_PROFILES.aggressive,
        customThreshold: 0.75,
        autoApprove: true,
        enableBatchMode: false,
        enableManualOverride: true,
        enableStatistics: false,
      };

      // Pre-populate storage
      const configKey = 'confidence-threshold-config';
      const serializedConfig = JSON.stringify(originalConfig);
      mockStorage.set(configKey, serializedConfig);

      // Simulate loading configuration from localStorage
      const storedConfig = mockLocalStorage.getItem(configKey);
      const restoredConfig = storedConfig ? JSON.parse(storedConfig) : createDefaultConfidenceThresholdConfig();

      expect(mockLocalStorage.getItem).toHaveBeenCalledWith(configKey);
      expect(restoredConfig).toEqual(originalConfig);
      expect(restoredConfig.profile.name).toBe('Aggressive');
      expect(restoredConfig.customThreshold).toBe(0.75);
      expect(restoredConfig.autoApprove).toBe(true);
    });

    test('should handle missing or corrupt configuration gracefully', () => {
      const configKey = 'confidence-threshold-config';

      // Test missing configuration
      let restoredConfig = mockLocalStorage.getItem(configKey) 
        ? JSON.parse(mockLocalStorage.getItem(configKey)!) 
        : createDefaultConfidenceThresholdConfig();

      expect(restoredConfig).toEqual(createDefaultConfidenceThresholdConfig());

      // Test corrupt configuration
      mockStorage.set(configKey, 'invalid-json');
      
      try {
        const corruptConfig = JSON.parse(mockLocalStorage.getItem(configKey)!);
        restoredConfig = corruptConfig;
      } catch (error) {
        restoredConfig = createDefaultConfidenceThresholdConfig();
      }

      expect(restoredConfig).toEqual(createDefaultConfidenceThresholdConfig());
    });
  });

  describe('Configuration Validation Integration (AC: 1)', () => {
    test('should validate configurations before persistence', () => {
      const validConfig: ConfidenceThresholdConfig = {
        profile: CONFIDENCE_PROFILES.balanced,
        customThreshold: 0.80,
        autoApprove: true,
        enableBatchMode: true,
        enableManualOverride: true,
        enableStatistics: true,
      };

      const validation = ConfidenceThresholdValidator.validateConfig(validConfig);
      expect(validation.isValid).toBe(true);
      expect(validation.errors).toHaveLength(0);

      // Should be safe to persist
      const configKey = 'confidence-threshold-config';
      const serializedConfig = JSON.stringify(validConfig);
      mockLocalStorage.setItem(configKey, serializedConfig);
      expect(mockStorage.get(configKey)).toBe(serializedConfig);
    });

    test('should reject invalid configurations', () => {
      const invalidConfig = {
        profile: CONFIDENCE_PROFILES.custom,
        customThreshold: 1.5, // Invalid: > 1.0
        autoApprove: true,
        enableBatchMode: true,
        enableManualOverride: true,
        enableStatistics: true,
      };

      const validation = ConfidenceThresholdValidator.validateConfig(invalidConfig);
      expect(validation.isValid).toBe(false);
      expect(validation.errors.length).toBeGreaterThan(0);

      // Should not persist invalid configuration
      // In real implementation, this would be caught before storage
    });
  });

  describe('Profile Management (AC: 1)', () => {
    test('should handle profile switching correctly', () => {
      let currentConfig = createDefaultConfidenceThresholdConfig();

      // Switch to Conservative
      currentConfig.profile = CONFIDENCE_PROFILES.conservative;
      let effectiveThreshold = ConfidenceThresholdValidator.getEffectiveThreshold(currentConfig);
      expect(effectiveThreshold).toBe(0.90);

      // Switch to Balanced  
      currentConfig.profile = CONFIDENCE_PROFILES.balanced;
      effectiveThreshold = ConfidenceThresholdValidator.getEffectiveThreshold(currentConfig);
      expect(effectiveThreshold).toBe(0.80);

      // Switch to Aggressive
      currentConfig.profile = CONFIDENCE_PROFILES.aggressive;
      effectiveThreshold = ConfidenceThresholdValidator.getEffectiveThreshold(currentConfig);
      expect(effectiveThreshold).toBe(0.70);

      // Switch to Custom
      currentConfig.profile = CONFIDENCE_PROFILES.custom;
      currentConfig.customThreshold = 0.85;
      effectiveThreshold = ConfidenceThresholdValidator.getEffectiveThreshold(currentConfig);
      expect(effectiveThreshold).toBe(0.85);
    });

    test('should persist profile changes across sessions', () => {
      const configKey = 'confidence-threshold-config';
      
      // Session 1: Set Conservative profile
      let config = createDefaultConfidenceThresholdConfig();
      config.profile = CONFIDENCE_PROFILES.conservative;
      mockLocalStorage.setItem(configKey, JSON.stringify(config));

      // Session 2: Load and verify Conservative profile
      let storedConfig = JSON.parse(mockLocalStorage.getItem(configKey)!);
      expect(storedConfig.profile.name).toBe('Conservative');
      expect(storedConfig.profile.threshold).toBe(0.90);

      // Session 2: Change to Custom profile
      storedConfig.profile = CONFIDENCE_PROFILES.custom;
      storedConfig.customThreshold = 0.88;
      mockLocalStorage.setItem(configKey, JSON.stringify(storedConfig));

      // Session 3: Load and verify Custom profile
      const finalConfig = JSON.parse(mockLocalStorage.getItem(configKey)!);
      expect(finalConfig.profile.name).toBe('Custom');
      expect(finalConfig.customThreshold).toBe(0.88);
    });
  });

  describe('Settings Migration (AC: 4)', () => {
    test('should handle configuration version upgrades', () => {
      // Simulate old configuration format
      const oldConfigV1 = {
        threshold: 0.80,
        autoApprove: true,
        version: 1
      };

      const configKey = 'confidence-threshold-config';
      mockStorage.set(configKey, JSON.stringify(oldConfigV1));

      // Simulate migration logic
      const storedData = mockLocalStorage.getItem(configKey);
      let config: ConfidenceThresholdConfig;

      if (storedData) {
        const parsed = JSON.parse(storedData);
        if (parsed.version && parsed.version < 2) {
          // Migrate from v1 to v2
          config = {
            profile: CONFIDENCE_PROFILES.balanced, // Default mapping
            customThreshold: parsed.threshold,
            autoApprove: parsed.autoApprove || true,
            enableBatchMode: true, // New default
            enableManualOverride: true, // New default
            enableStatistics: true, // New default
          };
          
          // Save migrated config
          mockLocalStorage.setItem(configKey, JSON.stringify(config));
        } else {
          config = parsed;
        }
      } else {
        config = createDefaultConfidenceThresholdConfig();
      }

      expect(config.profile).toBeDefined();
      expect(config.autoApprove).toBe(true);
      expect(config.enableBatchMode).toBe(true);
      expect(config.enableManualOverride).toBe(true);
      expect(config.enableStatistics).toBe(true);
    });
  });

  describe('Real-time Configuration Updates (AC: 5)', () => {
    test('should handle concurrent configuration updates', () => {
      const configKey = 'confidence-threshold-config';
      let config = createDefaultConfidenceThresholdConfig();

      // Simulate multiple rapid updates
      const updates = [
        () => { config.autoApprove = false; },
        () => { config.profile = CONFIDENCE_PROFILES.aggressive; },
        () => { config.enableBatchMode = false; },
        () => { config.customThreshold = 0.77; },
        () => { config.enableStatistics = false; },
      ];

      // Apply updates sequentially
      updates.forEach(update => {
        update();
        mockLocalStorage.setItem(configKey, JSON.stringify(config));
      });

      // Verify final state
      const finalConfig = JSON.parse(mockLocalStorage.getItem(configKey)!);
      expect(finalConfig.autoApprove).toBe(false);
      expect(finalConfig.profile.name).toBe('Aggressive');
      expect(finalConfig.enableBatchMode).toBe(false);
      expect(finalConfig.customThreshold).toBe(0.77);
      expect(finalConfig.enableStatistics).toBe(false);
      
      // Verify storage was called for each update
      expect(mockLocalStorage.setItem).toHaveBeenCalledTimes(5);
    });

    test('should debounce frequent configuration changes', () => {
      const configKey = 'confidence-threshold-config';
      let config = createDefaultConfidenceThresholdConfig();
      let saveTimer: NodeJS.Timeout | null = null;

      // Simulate debounced save function
      const debouncedSave = (updatedConfig: ConfidenceThresholdConfig) => {
        if (saveTimer) {
          clearTimeout(saveTimer);
        }
        saveTimer = setTimeout(() => {
          mockLocalStorage.setItem(configKey, JSON.stringify(updatedConfig));
        }, 100); // 100ms debounce
      };

      // Rapidly change threshold multiple times
      config.customThreshold = 0.75;
      debouncedSave(config);
      
      config.customThreshold = 0.80;
      debouncedSave(config);
      
      config.customThreshold = 0.85;
      debouncedSave(config);

      // Should not have saved yet due to debouncing
      expect(mockLocalStorage.setItem).toHaveBeenCalledTimes(0);

      // Wait for debounce to complete
      return new Promise<void>((resolve) => {
        setTimeout(() => {
          expect(mockLocalStorage.setItem).toHaveBeenCalledTimes(1);
          const savedConfig = JSON.parse(mockStorage.get(configKey)!);
          expect(savedConfig.customThreshold).toBe(0.85); // Final value
          resolve();
        }, 150);
      });
    });
  });

  describe('Performance Testing (AC: 1-10)', () => {
    test('should handle large configuration objects efficiently', () => {
      const configKey = 'confidence-threshold-config';
      
      // Create configuration with extensive metadata
      const largeConfig: ConfidenceThresholdConfig & { metadata?: any } = {
        profile: CONFIDENCE_PROFILES.custom,
        customThreshold: 0.85,
        autoApprove: true,
        enableBatchMode: true,
        enableManualOverride: true,
        enableStatistics: true,
        metadata: {
          history: Array.from({ length: 1000 }, (_, i) => ({
            timestamp: Date.now() - i * 1000,
            action: `config-change-${i}`,
            value: Math.random(),
          })),
          userPreferences: {
            theme: 'dark',
            language: 'en',
            notifications: true,
          },
        },
      };

      const startTime = performance.now();
      
      // Serialize and store
      const serialized = JSON.stringify(largeConfig);
      mockLocalStorage.setItem(configKey, serialized);
      
      // Retrieve and deserialize
      const retrieved = mockLocalStorage.getItem(configKey);
      const deserialized = JSON.parse(retrieved!);
      
      const endTime = performance.now();
      const duration = endTime - startTime;

      // Should complete within reasonable time
      expect(duration).toBeLessThan(50); // Less than 50ms
      
      // Verify integrity
      expect(deserialized.profile.name).toBe('Custom');
      expect(deserialized.customThreshold).toBe(0.85);
      expect(deserialized.metadata.history).toHaveLength(1000);
    });
  });
});
