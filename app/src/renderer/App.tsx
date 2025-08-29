import React from 'react';
import './App.css';
import DirectoryPicker from './components/DirectoryPicker';
import ModelSelector from './components/ModelSelector';

interface ElectronAPI {
  getVersion: () => Promise<string>;
  getPlatform: () => Promise<string>;
  getAgentStatus: () => Promise<{ status: string; agents: any[] }>;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

const App: React.FC = () => {
  const [version, setVersion] = React.useState<string>('Loading...');
  const [platform, setPlatform] = React.useState<string>('Loading...');
  const [selectedDirectory, setSelectedDirectory] = React.useState<string>('');
  const [selectedModels, setSelectedModels] = React.useState<{
    mainModel: string | null;
    subModel: string | null;
  }>({ mainModel: null, subModel: null });

  React.useEffect(() => {
    // Get app version and platform info
    const loadAppInfo = async () => {
      try {
        const appVersion = await window.electronAPI.getVersion();
        const appPlatform = await window.electronAPI.getPlatform();
        setVersion(appVersion);
        setPlatform(appPlatform);
      } catch (error) {
        console.error('Failed to load app info:', error);
        setVersion('Error');
        setPlatform('Error');
      }
    };

    loadAppInfo();
  }, []);

  const handleDirectorySelected = (path: string) => {
    setSelectedDirectory(path);
    console.log('Directory selected:', path);
  };

  const handleModelSelected = (mainModel: string | null, subModel: string | null) => {
    setSelectedModels({ mainModel, subModel });
    console.log('Models selected:', { mainModel, subModel });
  };

  return (
    <div className="App">
      <header className="App-header">
        <div className="logo">
          <h1>MaxSort</h1>
          <div className="logo-icon">📁</div>
        </div>
        <div className="welcome-content">
          <h2>AI-Powered File Organization</h2>
          <p>Organize and rename your files intelligently with AI agents</p>
          <div className="app-info">
            <p>Version: {version} | Platform: {platform}</p>
          </div>
        </div>
      </header>
      
      <main className="App-main">
        <DirectoryPicker 
          onDirectorySelected={handleDirectorySelected}
        />
        
        <ModelSelector
          onModelSelected={handleModelSelected}
        />
        
        {selectedDirectory && (selectedModels.mainModel || selectedModels.subModel) && (
          <div className="ready-status">
            <h3>🎯 Ready for AI Organization</h3>
            <div className="status-details">
              <p>✅ Directory: {selectedDirectory}</p>
              {selectedModels.mainModel && <p>✅ Main Agent: {selectedModels.mainModel}</p>}
              {selectedModels.subModel && <p>✅ Sub Agent: {selectedModels.subModel}</p>}
            </div>
          </div>
        )}
      </main>
    </div>
  );
};

export default App;
