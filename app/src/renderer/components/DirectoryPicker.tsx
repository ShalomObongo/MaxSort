import React, { useState } from 'react';
import './DirectoryPicker.css';
import { ElectronAPI } from '../../types/electron';

// Utility function to format file sizes
const formatFileSize = (bytes: number): string => {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

interface DirectoryPickerProps {
  onDirectorySelected: (path: string) => void;
  disabled?: boolean;
}

interface FileRecord {
  id?: number;
  path: string;
  sha256?: string;
  size: number;
  mtime: number;
  lastScannedAt: number;
  relativePathFromRoot?: string;
  fileName?: string;
  fileExtension?: string;
  parentDirectory?: string;
}

interface JobRecord {
  id?: number;
  rootPath: string;
  status: 'pending' | 'scanning' | 'organizing' | 'complete' | 'error';
  createdAt: number;
  updatedAt: number;
  fileCount: number;
  errorMessage?: string;
}

const DirectoryPicker: React.FC<DirectoryPickerProps> = ({ onDirectorySelected, disabled = false }) => {
  const [selectedPath, setSelectedPath] = useState<string>('');
  const [isScanning, setIsScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState<{
    fileCount: number;
    currentFile: string;
    percent: number;
  } | null>(null);
  const [error, setError] = useState<string>('');
  const [scanResults, setScanResults] = useState<FileRecord[]>([]);
  const [showResults, setShowResults] = useState(false);

  const handleSelectDirectory = async () => {
    try {
      setError('');
      const electronAPI = window.electronAPI;
      const path = await electronAPI.selectDirectory?.();
      
      if (path) {
        // Validate the path
        if (!path.trim()) {
          setError('Invalid directory path selected');
          return;
        }
        
        setSelectedPath(path);
        onDirectorySelected(path);
      }
    } catch (err) {
      console.error('Failed to select directory:', err);
      setError('Failed to open directory selector. Please try again.');
    }
  };

  const handleStartScan = async () => {
    if (!selectedPath) {
      setError('Please select a directory first');
      return;
    }

    try {
      setError('');
      setIsScanning(true);
      setScanProgress({ fileCount: 0, currentFile: '', percent: 0 });

      const electronAPI = window.electronAPI;
      
      // Set up progress callback
      const handleScanProgressUpdate = (progress: { fileCount: number; currentFile: string; percent: number }) => {
        setScanProgress(progress);
      };

      let removeProgressListener: (() => void) | undefined;
      if (electronAPI.onScanProgress) {
        removeProgressListener = electronAPI.onScanProgress(handleScanProgressUpdate);
      }

      // Start scanning
      await electronAPI.scanDirectory?.({ rootPath: selectedPath });
      
      // Fetch scan results after completion
      const results = await electronAPI.getScanResults?.(selectedPath);
      if (results) {
        setScanResults(results);
        setShowResults(true);
      }

      setIsScanning(false);
      setScanProgress(null);
      
      // Clean up progress listener
      if (removeProgressListener) {
        removeProgressListener();
      }
    } catch (err) {
      console.error('Failed to scan directory:', err);
      setError('Failed to scan directory. Please check permissions and try again.');
      setIsScanning(false);
      setScanProgress(null);
      
      // Clean up progress listener
      window.electronAPI.removeScanProgressListener?.();
    }
  };

  return (
    <div className="directory-picker">
      <div className="picker-section">
        <h3>Select Directory to Organize</h3>
        <p>Choose a directory containing files you want to organize with AI.</p>
        
        <div className="directory-selection">
          <button
            className="select-button"
            onClick={handleSelectDirectory}
            disabled={disabled || isScanning}
          >
            📁 Choose Directory
          </button>
          
          {selectedPath && (
            <div className="selected-path">
              <strong>Selected:</strong> {selectedPath}
            </div>
          )}
        </div>

        {error && (
          <div className="error-message">
            ⚠️ {error}
          </div>
        )}
      </div>

      {selectedPath && !isScanning && (
        <div className="scan-section">
          <button
            className="scan-button"
            onClick={handleStartScan}
            disabled={disabled}
          >
            🔍 Scan Directory
          </button>
        </div>
      )}

      {isScanning && scanProgress && (
        <div className="scan-progress">
          <h4>Scanning Directory...</h4>
          <div className="progress-bar">
            <div 
              className="progress-fill" 
              style={{ width: `${scanProgress.percent}%` }}
            />
          </div>
          <div className="progress-details">
            <p>Files found: {scanProgress.fileCount}</p>
            {scanProgress.currentFile && (
              <p className="current-file">
                Processing: {scanProgress.currentFile.length > 50 
                  ? `...${scanProgress.currentFile.slice(-50)}` 
                  : scanProgress.currentFile}
              </p>
            )}
            <p>{Math.round(scanProgress.percent)}% complete</p>
          </div>
        </div>
      )}

      {showResults && scanResults.length > 0 && (
        <div className="scan-results">
          <div className="results-header">
            <h4>Scan Results</h4>
            <p>Found {scanResults.length} files in {selectedPath}</p>
            <button 
              className="toggle-results"
              onClick={() => setShowResults(!showResults)}
            >
              {showResults ? 'Hide Results' : 'Show Results'}
            </button>
          </div>
          
          <div className="results-summary">
            <div className="summary-stats">
              <div className="stat">
                <span className="stat-label">Total Files:</span>
                <span className="stat-value">{scanResults.length}</span>
              </div>
              <div className="stat">
                <span className="stat-label">Total Size:</span>
                <span className="stat-value">
                  {formatFileSize(scanResults.reduce((sum, file) => sum + file.size, 0))}
                </span>
              </div>
              <div className="stat">
                <span className="stat-label">File Types:</span>
                <span className="stat-value">
                  {new Set(scanResults.map(f => f.fileExtension).filter(Boolean)).size}
                </span>
              </div>
            </div>
          </div>

          <div className="files-list">
            <div className="list-header">
              <span>File Name</span>
              <span>Size</span>
              <span>Type</span>
              <span>Path</span>
            </div>
            <div className="files-container">
              {scanResults.slice(0, 50).map((file, index) => (
                <div key={file.id || index} className="file-item">
                  <span className="file-name" title={file.fileName}>
                    {file.fileName || 'Unknown'}
                  </span>
                  <span className="file-size">
                    {formatFileSize(file.size)}
                  </span>
                  <span className="file-type">
                    {file.fileExtension || 'N/A'}
                  </span>
                  <span className="file-path" title={file.relativePathFromRoot}>
                    {file.relativePathFromRoot && file.relativePathFromRoot.length > 40
                      ? `...${file.relativePathFromRoot.slice(-40)}`
                      : file.relativePathFromRoot || 'N/A'}
                  </span>
                </div>
              ))}
              {scanResults.length > 50 && (
                <div className="more-files">
                  <p>... and {scanResults.length - 50} more files</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default DirectoryPicker;
