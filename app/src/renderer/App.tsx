import React from 'react';
import './App.css';

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

  return (
    <div className="App">
      <header className="App-header">
        <div className="logo">
          <h1>MaxSort</h1>
          <div className="logo-icon">📁</div>
        </div>
        <div className="welcome-content">
          <h2>Hello MaxSort</h2>
          <p>AI-powered file organization for macOS</p>
          <div className="app-info">
            <p>Version: {version}</p>
            <p>Platform: {platform}</p>
          </div>
          <div className="getting-started">
            <p>Welcome to your new MaxSort application!</p>
            <p>This is the foundation for your AI-powered file organization system.</p>
          </div>
        </div>
      </header>
    </div>
  );
};

export default App;
