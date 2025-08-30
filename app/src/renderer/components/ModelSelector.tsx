import React, { useState, useEffect } from 'react';
import './ModelSelector.css';
import { ElectronAPI } from '../../types/electron';

// Ollama model types (matching the backend types)
interface OllamaModel {
  name: string;
  digest: string;
  size: number;
  modified_at: string;
  details?: {
    format: string;
    family: string;
    families: string[] | null;
    parameter_size: string;
    quantization_level: string;
  };
}

interface OllamaHealth {
  status: 'healthy' | 'unhealthy' | 'unknown';
  message?: string;
  models_available: boolean;
  model_count: number;
}

interface ModelMemoryEstimate {
  modelName: string;
  estimatedMemory: number;
  safetyFactor: number;
}

interface ModelSelectorProps {
  onModelSelected: (mainModel: string | null, subModel: string | null) => void;
  disabled?: boolean;
}

// Utility function to format memory sizes
const formatMemorySize = (bytes: number): string => {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
};

// Utility function to get model family icon
const getModelFamilyIcon = (model: OllamaModel): string => {
  const family = model.details?.family?.toLowerCase() || model.name.toLowerCase();
  
  if (family.includes('llama')) return '🦙';
  if (family.includes('code')) return '💻';
  if (family.includes('mistral')) return '🌪️';
  if (family.includes('gemma')) return '💎';
  if (family.includes('phi')) return '🔄';
  if (family.includes('neural')) return '🧠';
  
  return '🤖';
};

const ModelSelector: React.FC<ModelSelectorProps> = ({ onModelSelected, disabled = false }) => {
  const [health, setHealth] = useState<OllamaHealth>({ status: 'unknown', models_available: false, model_count: 0 });
  const [models, setModels] = useState<OllamaModel[]>([]);
  const [memoryEstimates, setMemoryEstimates] = useState<Record<string, number>>({});
  const [selectedMainModel, setSelectedMainModel] = useState<string | null>(null);
  const [selectedSubModel, setSelectedSubModel] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string>('');
  const [validationStatus, setValidationStatus] = useState<Record<string, 'validating' | 'valid' | 'invalid'>>({});

  // Load initial data and preferences
  useEffect(() => {
    loadModelData();
    setupHealthMonitoring();
  }, []);

  const loadModelData = async () => {
    try {
      setIsLoading(true);
      setError('');
      
      const electronAPI = window.electronAPI;
      
      // Get health status first
      const healthStatus = await electronAPI.getOllamaHealth();
      setHealth(healthStatus);
      
      if (healthStatus.status !== 'healthy') {
        setError(healthStatus.message || 'Ollama is not available');
        setIsLoading(false);
        return;
      }

      // Get available models
      const availableModels = await electronAPI.getAvailableModels();
      setModels(availableModels);

      // Get memory estimates for all models
      const estimates: Record<string, number> = {};
      for (const model of availableModels) {
        try {
          const estimate = await electronAPI.getModelMemoryEstimate(model);
          estimates[model.name] = estimate.estimatedMemory;
        } catch (err) {
          console.warn(`Failed to get memory estimate for ${model.name}:`, err);
          estimates[model.name] = model.size * 1.5; // Fallback estimate
        }
      }
      setMemoryEstimates(estimates);

      // Load saved preferences
      const preferences = await electronAPI.getModelPreferences();
      setSelectedMainModel(preferences.mainModel);
      setSelectedSubModel(preferences.subModel);

      setIsLoading(false);
    } catch (err) {
      console.error('Failed to load model data:', err);
      setError('Failed to connect to Ollama. Please ensure Ollama is running.');
      setIsLoading(false);
    }
  };

  const setupHealthMonitoring = () => {
    const electronAPI = window.electronAPI;
    
    // Set up health monitoring
    if (electronAPI.onOllamaHealthUpdate) {
      const cleanup = electronAPI.onOllamaHealthUpdate((healthUpdate) => {
        setHealth(healthUpdate);
        
        if (healthUpdate.status === 'unhealthy') {
          setError(healthUpdate.message || 'Ollama connection lost');
        } else if (healthUpdate.status === 'healthy' && error) {
          // Clear error if we're healthy again
          setError('');
          loadModelData(); // Reload models
        }
      });

      return cleanup;
    }
  };

  const validateAndSelectModel = async (modelName: string, type: 'main' | 'sub') => {
    try {
      setValidationStatus(prev => ({ ...prev, [modelName]: 'validating' }));
      
      const electronAPI = window.electronAPI;
      const isValid = await electronAPI.validateModel?.(modelName);
      
      if (isValid) {
        setValidationStatus(prev => ({ ...prev, [modelName]: 'valid' }));
        
        if (type === 'main') {
          setSelectedMainModel(modelName);
        } else {
          setSelectedSubModel(modelName);
        }
        
        // Save preferences
        const mainModel = type === 'main' ? modelName : selectedMainModel;
        const subModel = type === 'sub' ? modelName : selectedSubModel;
        
        await electronAPI.saveModelPreferences(mainModel, subModel);
        onModelSelected(mainModel, subModel);
      } else {
        setValidationStatus(prev => ({ ...prev, [modelName]: 'invalid' }));
        setError(`Model ${modelName} is not available or invalid`);
      }
    } catch (err) {
      console.error(`Failed to validate model ${modelName}:`, err);
      setValidationStatus(prev => ({ ...prev, [modelName]: 'invalid' }));
      setError(`Failed to validate model ${modelName}`);
    }
  };

  const handleRefresh = () => {
    loadModelData();
  };

  if (isLoading) {
    return (
      <div className="model-selector loading">
        <div className="loading-spinner">⟳</div>
        <p>Loading Ollama models...</p>
      </div>
    );
  }

  if (health.status === 'unhealthy') {
    return (
      <div className="model-selector error-state">
        <div className="error-content">
          <div className="error-icon">🚫</div>
          <h3>Ollama Not Available</h3>
          <p>{error || 'Unable to connect to Ollama daemon'}</p>
          
          <div className="troubleshooting">
            <h4>Troubleshooting:</h4>
            <ul>
              <li>Make sure Ollama is installed and running</li>
              <li>Check that Ollama is listening on <code>localhost:11434</code></li>
              <li>Try running <code>ollama serve</code> in your terminal</li>
              <li>Ensure no firewall is blocking the connection</li>
            </ul>
          </div>
          
          <button className="retry-button" onClick={handleRefresh}>
            🔄 Retry Connection
          </button>
        </div>
      </div>
    );
  }

  if (models.length === 0) {
    return (
      <div className="model-selector no-models">
        <div className="no-models-content">
          <div className="status-icon">📦</div>
          <h3>No Models Available</h3>
          <p>Ollama is running, but no models are installed.</p>
          
          <div className="getting-started">
            <h4>Get Started:</h4>
            <ol>
              <li>Open your terminal</li>
              <li>Run <code>ollama pull llama2</code> to download a model</li>
              <li>Or try <code>ollama pull codellama</code> for code tasks</li>
              <li>Click "Refresh" once download is complete</li>
            </ol>
          </div>
          
          <button className="refresh-button" onClick={handleRefresh}>
            🔄 Refresh Models
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="model-selector">
      <div className="selector-header">
        <h3>Configure AI Models</h3>
        <div className="health-status">
          <span className={`health-indicator ${health.status}`}>
            {health.status === 'healthy' ? '🟢' : '🟡'}
          </span>
          <span>Ollama: {health.status}</span>
          <span className="model-count">({health.model_count} models)</span>
          <button className="refresh-button" onClick={handleRefresh} disabled={disabled}>
            🔄
          </button>
        </div>
      </div>

      {error && (
        <div className="error-message">
          ⚠️ {error}
        </div>
      )}

      <div className="model-sections">
        {/* Main Agent Model Selection */}
        <div className="model-section">
          <h4>Main Agent Model</h4>
          <p className="section-description">
            Primary model for file analysis and decision making. Larger models provide better accuracy.
          </p>
          
          <div className="model-grid">
            {models.map((model) => (
              <div
                key={model.name}
                className={`model-card ${selectedMainModel === model.name ? 'selected' : ''} ${
                  validationStatus[model.name] === 'validating' ? 'validating' : ''
                } ${validationStatus[model.name] === 'invalid' ? 'invalid' : ''}`}
                onClick={() => !disabled && validateAndSelectModel(model.name, 'main')}
              >
                <div className="model-header">
                  <span className="model-icon">{getModelFamilyIcon(model)}</span>
                  <span className="model-name">{model.name}</span>
                  {validationStatus[model.name] === 'validating' && <span className="validation-spinner">⟳</span>}
                  {validationStatus[model.name] === 'valid' && <span className="validation-check">✓</span>}
                  {validationStatus[model.name] === 'invalid' && <span className="validation-error">✗</span>}
                </div>
                
                <div className="model-details">
                  {model.details?.parameter_size && (
                    <div className="detail-item">
                      <span className="detail-label">Size:</span>
                      <span className="detail-value">{model.details.parameter_size}</span>
                    </div>
                  )}
                  <div className="detail-item">
                    <span className="detail-label">Memory:</span>
                    <span className="detail-value">
                      {formatMemorySize(memoryEstimates[model.name] || model.size)}
                    </span>
                  </div>
                  {model.details?.quantization_level && (
                    <div className="detail-item">
                      <span className="detail-label">Quant:</span>
                      <span className="detail-value">{model.details.quantization_level}</span>
                    </div>
                  )}
                </div>
                
                {selectedMainModel === model.name && (
                  <div className="selected-indicator">
                    <span>✓ Main Agent</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Sub-Agent Model Selection */}
        <div className="model-section">
          <h4>Sub-Agent Model</h4>
          <p className="section-description">
            Secondary model for specialized tasks and parallel processing. Can be the same as main model.
          </p>
          
          <div className="model-grid">
            {models.map((model) => (
              <div
                key={model.name}
                className={`model-card ${selectedSubModel === model.name ? 'selected' : ''} ${
                  validationStatus[model.name] === 'validating' ? 'validating' : ''
                } ${validationStatus[model.name] === 'invalid' ? 'invalid' : ''}`}
                onClick={() => !disabled && validateAndSelectModel(model.name, 'sub')}
              >
                <div className="model-header">
                  <span className="model-icon">{getModelFamilyIcon(model)}</span>
                  <span className="model-name">{model.name}</span>
                  {validationStatus[model.name] === 'validating' && <span className="validation-spinner">⟳</span>}
                  {validationStatus[model.name] === 'valid' && <span className="validation-check">✓</span>}
                  {validationStatus[model.name] === 'invalid' && <span className="validation-error">✗</span>}
                </div>
                
                <div className="model-details">
                  {model.details?.parameter_size && (
                    <div className="detail-item">
                      <span className="detail-label">Size:</span>
                      <span className="detail-value">{model.details.parameter_size}</span>
                    </div>
                  )}
                  <div className="detail-item">
                    <span className="detail-label">Memory:</span>
                    <span className="detail-value">
                      {formatMemorySize(memoryEstimates[model.name] || model.size)}
                    </span>
                  </div>
                  {model.details?.quantization_level && (
                    <div className="detail-item">
                      <span className="detail-label">Quant:</span>
                      <span className="detail-value">{model.details.quantization_level}</span>
                    </div>
                  )}
                </div>
                
                {selectedSubModel === model.name && (
                  <div className="selected-indicator">
                    <span>✓ Sub Agent</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Selection Summary */}
      {(selectedMainModel || selectedSubModel) && (
        <div className="selection-summary">
          <h4>Current Selection</h4>
          <div className="summary-cards">
            {selectedMainModel && (
              <div className="summary-card main">
                <span className="card-label">Main Agent:</span>
                <span className="card-model">{selectedMainModel}</span>
                <span className="card-memory">
                  ({formatMemorySize(memoryEstimates[selectedMainModel] || 0)})
                </span>
              </div>
            )}
            {selectedSubModel && (
              <div className="summary-card sub">
                <span className="card-label">Sub Agent:</span>
                <span className="card-model">{selectedSubModel}</span>
                <span className="card-memory">
                  ({formatMemorySize(memoryEstimates[selectedSubModel] || 0)})
                </span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default ModelSelector;
