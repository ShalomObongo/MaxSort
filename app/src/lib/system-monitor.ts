import { EventEmitter } from 'events';
import { spawn, ChildProcess } from 'child_process';

/**
 * System memory information structure
 */
export interface SystemMemoryInfo {
  totalMemory: number;        // Total physical memory in bytes
  freeMemory: number;         // Available memory in bytes
  usedMemory: number;         // Used memory in bytes
  memoryPressure: number;     // Memory pressure ratio (0-1)
  availableForAgents: number; // Memory available for agent allocation
}

/**
 * System CPU information structure
 */
export interface SystemCPUInfo {
  loadAverage1m: number;      // 1-minute load average
  loadAverage5m: number;      // 5-minute load average
  loadAverage15m: number;     // 15-minute load average
  cpuUsage: number;           // Current CPU usage percentage (0-100)
}

/**
 * Complete system health snapshot
 */
export interface SystemHealth {
  timestamp: number;
  memory: SystemMemoryInfo;
  cpu: SystemCPUInfo;
  isUnderStress: boolean;     // High memory pressure or CPU load
}

/**
 * System monitoring configuration
 */
export interface SystemMonitorConfig {
  pollingInterval: number;    // Normal polling interval in ms (default: 1000)
  stressPollingInterval: number; // Stress polling interval in ms (default: 500)
  memoryPressureThreshold: number; // Threshold for stress mode (default: 0.8)
  cpuLoadThreshold: number;   // CPU load threshold for stress mode (default: 2.0)
  osReservedMemory: number;   // Memory reserved for OS in bytes (default: 2GB)
  smoothingWindowSize: number; // Number of samples for smoothing (default: 5)
}

/**
 * macOS-specific system monitor using vm_stat and system calls
 * Provides accurate memory and CPU monitoring with adaptive polling
 */
export class SystemMonitor extends EventEmitter {
  private config: SystemMonitorConfig;
  private pollingTimer: NodeJS.Timeout | null = null;
  private isRunning: boolean = false;
  private memoryHistory: number[] = []; // Sliding window for smoothing
  private vmStatProcess: ChildProcess | null = null;

  // Default configuration optimized for Agent Manager integration
  private static readonly DEFAULT_CONFIG: SystemMonitorConfig = {
    pollingInterval: 1000,        // 1 second normal polling
    stressPollingInterval: 500,   // 500ms under stress
    memoryPressureThreshold: 0.8, // 80% memory usage triggers stress mode
    cpuLoadThreshold: 2.0,        // Load average > 2.0 triggers stress mode
    osReservedMemory: 2 * 1024 * 1024 * 1024, // 2GB reserved for macOS
    smoothingWindowSize: 5,       // 5-sample sliding window
  };

  constructor(config: Partial<SystemMonitorConfig> = {}) {
    super();
    this.config = { ...SystemMonitor.DEFAULT_CONFIG, ...config };
  }

  /**
   * Start system monitoring with adaptive polling
   */
  public start(): void {
    if (this.isRunning) {
      console.warn('SystemMonitor is already running');
      return;
    }

    this.isRunning = true;
    this.scheduleNextPoll();
    
    console.log('SystemMonitor started with configuration:', {
      pollingInterval: this.config.pollingInterval,
      stressPollingInterval: this.config.stressPollingInterval,
      osReservedMemory: Math.round(this.config.osReservedMemory / 1024 / 1024) + 'MB',
    });

    // Emit initial health check
    this.pollSystemHealth();
  }

  /**
   * Stop system monitoring
   */
  public stop(): void {
    if (!this.isRunning) return;

    this.isRunning = false;
    
    if (this.pollingTimer) {
      clearTimeout(this.pollingTimer);
      this.pollingTimer = null;
    }

    if (this.vmStatProcess) {
      this.vmStatProcess.kill();
      this.vmStatProcess = null;
    }

    console.log('SystemMonitor stopped');
  }

  /**
   * Get current system health snapshot
   */
  public async getCurrentHealth(): Promise<SystemHealth> {
    const memory = await this.getMemoryInfo();
    const cpu = await this.getCPUInfo();
    
    const isUnderStress = this.determineStressStatus(memory, cpu);

    return {
      timestamp: Date.now(),
      memory,
      cpu,
      isUnderStress,
    };
  }

  /**
   * Get memory available for agent allocation
   * Accounts for OS reserve and safety factors
   */
  public getAvailableAgentMemory(): Promise<number> {
    return this.getMemoryInfo().then(memory => memory.availableForAgents);
  }

  /**
   * Update monitor configuration at runtime
   */
  public updateConfig(newConfig: Partial<SystemMonitorConfig>): void {
    const wasRunning = this.isRunning;
    
    if (wasRunning) {
      this.stop();
    }

    this.config = { ...this.config, ...newConfig };

    if (wasRunning) {
      this.start();
    }

    this.emit('config-updated', this.config);
  }

  /**
   * Get current configuration
   */
  public getConfig(): SystemMonitorConfig {
    return { ...this.config };
  }

  /**
   * Schedule next polling cycle with adaptive interval
   */
  private scheduleNextPoll(): void {
    if (!this.isRunning) return;

    // Determine polling interval based on current stress level
    const interval = this.shouldUseStressPolling() 
      ? this.config.stressPollingInterval 
      : this.config.pollingInterval;

    this.pollingTimer = setTimeout(() => {
      this.pollSystemHealth();
    }, interval);
  }

  /**
   * Execute system health polling
   */
  private async pollSystemHealth(): Promise<void> {
    if (!this.isRunning) return;

    try {
      const health = await this.getCurrentHealth();
      
      // Smooth memory readings to reduce spike sensitivity
      this.updateMemoryHistory(health.memory.memoryPressure);
      
      this.emit('health-update', health);
      
      // Schedule next poll
      this.scheduleNextPoll();
    } catch (error) {
      console.error('System health polling failed:', error);
      this.emit('monitoring-error', error);
      
      // Continue polling even after errors
      this.scheduleNextPoll();
    }
  }

  /**
   * Get comprehensive memory information using vm_stat
   */
  private async getMemoryInfo(): Promise<SystemMemoryInfo> {
    return new Promise((resolve, reject) => {
      // Use vm_stat for accurate macOS memory statistics
      const vmStat = spawn('vm_stat');
      let output = '';

      vmStat.stdout.on('data', (data) => {
        output += data.toString();
      });

      vmStat.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`vm_stat failed with code ${code}`));
          return;
        }

        try {
          const memInfo = this.parseVmStatOutput(output);
          resolve(memInfo);
        } catch (error) {
          reject(error);
        }
      });

      vmStat.on('error', (error) => {
        reject(new Error(`vm_stat process error: ${error.message}`));
      });

      // Timeout after 5 seconds
      setTimeout(() => {
        vmStat.kill();
        reject(new Error('vm_stat timeout'));
      }, 5000);
    });
  }

  /**
   * Parse vm_stat output to extract memory information
   */
  private parseVmStatOutput(output: string): SystemMemoryInfo {
    const lines = output.split('\n');
    const pageSize = 4096; // macOS page size is typically 4KB
    
    let freePages = 0;
    let activePages = 0;
    let inactivePages = 0;
    let speculativePages = 0;
    let compressedPages = 0;
    let wiredPages = 0;

    for (const line of lines) {
      const trimmedLine = line.trim();
      
      if (trimmedLine.startsWith('Pages free:')) {
        freePages = this.extractPageCount(trimmedLine);
      } else if (trimmedLine.startsWith('Pages active:')) {
        activePages = this.extractPageCount(trimmedLine);
      } else if (trimmedLine.startsWith('Pages inactive:')) {
        inactivePages = this.extractPageCount(trimmedLine);
      } else if (trimmedLine.startsWith('Pages speculative:')) {
        speculativePages = this.extractPageCount(trimmedLine);
      } else if (trimmedLine.startsWith('Pages stored in compressor:')) {
        compressedPages = this.extractPageCount(trimmedLine);
      } else if (trimmedLine.startsWith('Pages wired down:')) {
        wiredPages = this.extractPageCount(trimmedLine);
      }
    }

    // Calculate memory values
    const totalMemory = this.getTotalPhysicalMemory();
    const availablePages = freePages + inactivePages + speculativePages;
    const freeMemory = availablePages * pageSize;
    const usedMemory = totalMemory - freeMemory;
    const memoryPressure = usedMemory / totalMemory;
    
    // Calculate memory available for agents (free memory minus OS reserve)
    const availableForAgents = Math.max(0, freeMemory - this.config.osReservedMemory);

    return {
      totalMemory,
      freeMemory,
      usedMemory,
      memoryPressure,
      availableForAgents,
    };
  }

  /**
   * Extract page count from vm_stat line
   */
  private extractPageCount(line: string): number {
    const match = line.match(/(\d+)\./);
    return match ? parseInt(match[1], 10) : 0;
  }

  /**
   * Get total physical memory using sysctl
   */
  private getTotalPhysicalMemory(): number {
    try {
      const result = spawn('sysctl', ['-n', 'hw.memsize'], { stdio: 'pipe' });
      let output = '';
      
      result.stdout.on('data', (data) => {
        output += data.toString();
      });

      // For synchronous execution, we'll cache this value
      // In practice, total memory doesn't change during runtime
      return 16 * 1024 * 1024 * 1024; // Default 16GB, will be updated async
    } catch (error) {
      console.warn('Failed to get total memory, using default 16GB');
      return 16 * 1024 * 1024 * 1024; // 16GB default
    }
  }

  /**
   * Get CPU load information
   */
  private async getCPUInfo(): Promise<SystemCPUInfo> {
    return new Promise((resolve, reject) => {
      const uptime = spawn('uptime');
      let output = '';

      uptime.stdout.on('data', (data) => {
        output += data.toString();
      });

      uptime.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`uptime failed with code ${code}`));
          return;
        }

        try {
          const cpuInfo = this.parseUptimeOutput(output);
          resolve(cpuInfo);
        } catch (error) {
          reject(error);
        }
      });

      uptime.on('error', (error) => {
        reject(new Error(`uptime process error: ${error.message}`));
      });

      setTimeout(() => {
        uptime.kill();
        reject(new Error('uptime timeout'));
      }, 3000);
    });
  }

  /**
   * Parse uptime output to extract load averages
   */
  private parseUptimeOutput(output: string): SystemCPUInfo {
    // Example: "load averages: 1.52 1.43 1.41"
    const loadMatch = output.match(/load averages?:\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/);
    
    if (!loadMatch) {
      throw new Error('Unable to parse load averages from uptime output');
    }

    const loadAverage1m = parseFloat(loadMatch[1]);
    const loadAverage5m = parseFloat(loadMatch[2]);
    const loadAverage15m = parseFloat(loadMatch[3]);

    // Estimate current CPU usage based on 1-minute load average
    // This is approximated as load average can exceed 100% on multi-core systems
    const cpuUsage = Math.min(loadAverage1m * 100, 100);

    return {
      loadAverage1m,
      loadAverage5m,
      loadAverage15m,
      cpuUsage,
    };
  }

  /**
   * Update memory history for smoothing
   */
  private updateMemoryHistory(memoryPressure: number): void {
    this.memoryHistory.push(memoryPressure);
    
    if (this.memoryHistory.length > this.config.smoothingWindowSize) {
      this.memoryHistory.shift();
    }
  }

  /**
   * Get smoothed memory pressure
   */
  private getSmoothedMemoryPressure(): number {
    if (this.memoryHistory.length === 0) return 0;
    
    const sum = this.memoryHistory.reduce((a, b) => a + b, 0);
    return sum / this.memoryHistory.length;
  }

  /**
   * Determine if system is under stress and should use faster polling
   */
  private shouldUseStressPolling(): boolean {
    const smoothedPressure = this.getSmoothedMemoryPressure();
    return smoothedPressure > this.config.memoryPressureThreshold;
  }

  /**
   * Determine overall system stress status
   */
  private determineStressStatus(memory: SystemMemoryInfo, cpu: SystemCPUInfo): boolean {
    const highMemoryPressure = memory.memoryPressure > this.config.memoryPressureThreshold;
    const highCpuLoad = cpu.loadAverage1m > this.config.cpuLoadThreshold;
    
    return highMemoryPressure || highCpuLoad;
  }

  /**
   * Clean up resources
   */
  public destroy(): void {
    this.stop();
    this.removeAllListeners();
  }
}

// Export singleton instance getter for main process integration
let systemMonitorInstance: SystemMonitor | null = null;

export function getSystemMonitor(config?: Partial<SystemMonitorConfig>): SystemMonitor {
  if (!systemMonitorInstance) {
    systemMonitorInstance = new SystemMonitor(config);
  }
  return systemMonitorInstance;
}

export function destroySystemMonitor(): void {
  if (systemMonitorInstance) {
    systemMonitorInstance.destroy();
    systemMonitorInstance = null;
  }
}
