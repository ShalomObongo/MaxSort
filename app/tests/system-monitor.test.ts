import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SystemMonitor, type SystemHealth } from '../src/lib/system-monitor';
import { spawn } from 'child_process';
import { EventEmitter } from 'events';

// Mock child_process spawn
vi.mock('child_process');

describe('SystemMonitor', () => {
  let systemMonitor: SystemMonitor;

  beforeEach(() => {
    vi.clearAllMocks();
    systemMonitor = new SystemMonitor({
      pollingInterval: 100,      // Faster polling for tests
      stressPollingInterval: 50, // Faster stress polling
      memoryPressureThreshold: 0.8,
      cpuLoadThreshold: 2.0,
      osReservedMemory: 1024 * 1024 * 1024, // 1GB for tests
      smoothingWindowSize: 3,
    });
  });

  afterEach(() => {
    systemMonitor.stop();
  });

  describe('Configuration', () => {
    it('should initialize with default configuration', () => {
      const defaultMonitor = new SystemMonitor();
      const config = defaultMonitor.getConfig();
      
      expect(config.pollingInterval).toBe(1000);
      expect(config.stressPollingInterval).toBe(500);
      expect(config.memoryPressureThreshold).toBe(0.8);
      expect(config.cpuLoadThreshold).toBe(2.0);
      expect(config.osReservedMemory).toBe(2 * 1024 * 1024 * 1024);
      expect(config.smoothingWindowSize).toBe(5);
      
      defaultMonitor.stop();
    });

    it('should accept custom configuration', () => {
      const config = systemMonitor.getConfig();
      
      expect(config.pollingInterval).toBe(100);
      expect(config.stressPollingInterval).toBe(50);
      expect(config.osReservedMemory).toBe(1024 * 1024 * 1024);
      expect(config.smoothingWindowSize).toBe(3);
    });

    it('should update configuration at runtime', () => {
      const newConfig = {
        pollingInterval: 2000,
        memoryPressureThreshold: 0.9,
      };

      systemMonitor.updateConfig(newConfig);
      
      const updatedConfig = systemMonitor.getConfig();
      expect(updatedConfig.pollingInterval).toBe(2000);
      expect(updatedConfig.memoryPressureThreshold).toBe(0.9);
      // Other values should remain unchanged
      expect(updatedConfig.stressPollingInterval).toBe(50);
    });
  });

  describe('Memory Monitoring', () => {
    it('should parse vm_stat output correctly', async () => {
      // Mock vm_stat output
      const vmStatOutput = `
Mach Virtual Memory Statistics: (page size of 4096 bytes)
Pages free:                               500000.
Pages active:                            1000000.
Pages inactive:                           300000.
Pages speculative:                        100000.
Pages throttled:                               0.
Pages wired down:                         200000.
Pages purgeable:                           50000.
"Translation faults":                    5000000.
Pages copy-on-write:                      150000.
Pages zero-filled:                       2000000.
Pages reactivated:                        100000.
Pages purged:                              25000.
File-backed pages:                        800000.
Anonymous pages:                          600000.
Pages stored in compressor:               400000.
Pages occupied by compressor:              80000.
Decompressions:                           200000.
Compressions:                             300000.
Pageins:                                  500000.
Pageouts:                                  75000.
Swapins:                                   10000.
Swapouts:                                   5000.
`;

      // Mock spawn for vm_stat
      const mockVmStat = new EventEmitter() as any;
      mockVmStat.stdout = new EventEmitter();
      mockVmStat.kill = vi.fn();
      
      vi.mocked(spawn).mockImplementation((command) => {
        if (command === 'vm_stat') {
          // Simulate vm_stat output
          setTimeout(() => {
            mockVmStat.stdout.emit('data', vmStatOutput);
            mockVmStat.emit('close', 0);
          }, 10);
          return mockVmStat;
        }
        return mockVmStat;
      });

      // Mock sysctl for total memory (16GB)
      const mockSysctl = new EventEmitter() as any;
      mockSysctl.stdout = new EventEmitter();
      
      vi.mocked(spawn).mockImplementation((command, args) => {
        if (command === 'sysctl' && args?.[1] === 'hw.memsize') {
          setTimeout(() => {
            mockSysctl.stdout.emit('data', '17179869184'); // 16GB in bytes
            mockSysctl.emit('close', 0);
          }, 10);
          return mockSysctl;
        } else if (command === 'vm_stat') {
          setTimeout(() => {
            mockVmStat.stdout.emit('data', vmStatOutput);
            mockVmStat.emit('close', 0);
          }, 10);
          return mockVmStat;
        }
        return mockVmStat;
      });

      const health = await systemMonitor.getCurrentHealth();
      
      expect(health.memory).toBeDefined();
      expect(health.memory.freeMemory).toBeGreaterThan(0);
      expect(health.memory.usedMemory).toBeGreaterThan(0);
      expect(health.memory.memoryPressure).toBeGreaterThanOrEqual(0);
      expect(health.memory.memoryPressure).toBeLessThanOrEqual(1);
      expect(health.memory.availableForAgents).toBeGreaterThanOrEqual(0);
    });

    it('should handle vm_stat errors gracefully', async () => {
      // Mock spawn to return error
      const mockVmStat = new EventEmitter() as any;
      vi.mocked(spawn).mockImplementation(() => {
        setTimeout(() => {
          mockVmStat.emit('error', new Error('Command not found'));
        }, 10);
        return mockVmStat;
      });

      await expect(systemMonitor.getCurrentHealth()).rejects.toThrow();
    });

    it('should calculate available agent memory correctly', async () => {
      const mockVmStat = new EventEmitter() as any;
      mockVmStat.stdout = new EventEmitter();
      
      // Mock abundant free memory
      const vmStatOutput = `
Pages free:                              2000000.
Pages inactive:                          1000000.
Pages speculative:                        500000.
`;

      vi.mocked(spawn).mockImplementation(() => {
        setTimeout(() => {
          mockVmStat.stdout.emit('data', vmStatOutput);
          mockVmStat.emit('close', 0);
        }, 10);
        return mockVmStat;
      });

      const availableMemory = await systemMonitor.getAvailableAgentMemory();
      
      // Should be free memory minus OS reserve
      expect(availableMemory).toBeGreaterThan(0);
    });
  });

  describe('CPU Monitoring', () => {
    it('should parse uptime output correctly', async () => {
      const uptimeOutput = ' 14:30  up 1 day,  2:45, 3 users, load averages: 1.52 1.43 1.41';

      const mockUptime = new EventEmitter() as any;
      mockUptime.stdout = new EventEmitter();
      
      // Mock vm_stat first, then uptime
      const mockVmStat = new EventEmitter() as any;
      mockVmStat.stdout = new EventEmitter();

      vi.mocked(spawn).mockImplementation((command) => {
        if (command === 'uptime') {
          setTimeout(() => {
            mockUptime.stdout.emit('data', uptimeOutput);
            mockUptime.emit('close', 0);
          }, 10);
          return mockUptime;
        } else if (command === 'vm_stat') {
          setTimeout(() => {
            mockVmStat.stdout.emit('data', 'Pages free: 1000000.\n');
            mockVmStat.emit('close', 0);
          }, 10);
          return mockVmStat;
        }
        return mockUptime;
      });

      const health = await systemMonitor.getCurrentHealth();
      
      expect(health.cpu).toBeDefined();
      expect(health.cpu.loadAverage1m).toBeCloseTo(1.52);
      expect(health.cpu.loadAverage5m).toBeCloseTo(1.43);
      expect(health.cpu.loadAverage15m).toBeCloseTo(1.41);
      expect(health.cpu.cpuUsage).toBeGreaterThanOrEqual(0);
      expect(health.cpu.cpuUsage).toBeLessThanOrEqual(200); // Can exceed 100% on multi-core
    });

    it('should handle uptime errors gracefully', async () => {
      const mockUptime = new EventEmitter() as any;
      const mockVmStat = new EventEmitter() as any;
      mockVmStat.stdout = new EventEmitter();

      vi.mocked(spawn).mockImplementation((command) => {
        if (command === 'uptime') {
          setTimeout(() => {
            mockUptime.emit('error', new Error('Command failed'));
          }, 10);
          return mockUptime;
        } else if (command === 'vm_stat') {
          setTimeout(() => {
            mockVmStat.stdout.emit('data', 'Pages free: 1000000.\n');
            mockVmStat.emit('close', 0);
          }, 10);
          return mockVmStat;
        }
        return mockUptime;
      });

      await expect(systemMonitor.getCurrentHealth()).rejects.toThrow();
    });
  });

  describe('Stress Detection', () => {
    it('should detect system stress based on memory pressure', async () => {
      // Mock high memory pressure scenario
      const vmStatOutput = 'Pages free: 100000.\n'; // Very low free pages
      const uptimeOutput = 'load averages: 0.5 0.4 0.3'; // Low CPU load

      const mockProcess = new EventEmitter() as any;
      mockProcess.stdout = new EventEmitter();

      vi.mocked(spawn).mockImplementation((command) => {
        setTimeout(() => {
          if (command === 'vm_stat') {
            mockProcess.stdout.emit('data', vmStatOutput);
          } else if (command === 'uptime') {
            mockProcess.stdout.emit('data', uptimeOutput);
          }
          mockProcess.emit('close', 0);
        }, 10);
        return mockProcess;
      });

      const health = await systemMonitor.getCurrentHealth();
      
      expect(health.memory.memoryPressure).toBeGreaterThan(0.8); // High pressure
      expect(health.isUnderStress).toBe(true);
    });

    it('should detect system stress based on CPU load', async () => {
      // Mock high CPU load scenario
      const vmStatOutput = 'Pages free: 2000000.\n'; // Plenty of free memory
      const uptimeOutput = 'load averages: 3.5 3.0 2.8'; // High CPU load

      const mockProcess = new EventEmitter() as any;
      mockProcess.stdout = new EventEmitter();

      vi.mocked(spawn).mockImplementation((command) => {
        setTimeout(() => {
          if (command === 'vm_stat') {
            mockProcess.stdout.emit('data', vmStatOutput);
          } else if (command === 'uptime') {
            mockProcess.stdout.emit('data', uptimeOutput);
          }
          mockProcess.emit('close', 0);
        }, 10);
        return mockProcess;
      });

      const health = await systemMonitor.getCurrentHealth();
      
      expect(health.cpu.loadAverage1m).toBeGreaterThan(2.0); // High load
      expect(health.isUnderStress).toBe(true);
    });
  });

  describe('Event Handling', () => {
    it('should emit health updates during monitoring', async () => {
      const mockProcess = new EventEmitter() as any;
      mockProcess.stdout = new EventEmitter();

      vi.mocked(spawn).mockImplementation(() => {
        setTimeout(() => {
          mockProcess.stdout.emit('data', 'Pages free: 1000000.\nload averages: 1.0 1.0 1.0');
          mockProcess.emit('close', 0);
        }, 10);
        return mockProcess;
      });

      return new Promise<void>((resolve) => {
        systemMonitor.on('health-update', (health: SystemHealth) => {
          expect(health).toHaveProperty('timestamp');
          expect(health).toHaveProperty('memory');
          expect(health).toHaveProperty('cpu');
          expect(health).toHaveProperty('isUnderStress');
          resolve();
        });

        systemMonitor.start();
      });
    });

    it('should emit monitoring errors', async () => {
      const mockProcess = new EventEmitter() as any;

      vi.mocked(spawn).mockImplementation(() => {
        setTimeout(() => {
          mockProcess.emit('error', new Error('Monitoring failed'));
        }, 10);
        return mockProcess;
      });

      return new Promise<void>((resolve) => {
        systemMonitor.on('monitoring-error', (error: Error) => {
          expect(error).toBeInstanceOf(Error);
          expect(error.message).toContain('failed');
          resolve();
        });

        systemMonitor.start();
      });
    });

    it('should emit configuration updates', () => {
      return new Promise<void>((resolve) => {
        systemMonitor.on('config-updated', (config) => {
          expect(config.pollingInterval).toBe(5000);
          resolve();
        });

        systemMonitor.updateConfig({ pollingInterval: 5000 });
      });
    });
  });

  describe('Lifecycle Management', () => {
    it('should start and stop monitoring correctly', async () => {
      expect(systemMonitor['isRunning']).toBe(false);
      
      systemMonitor.start();
      expect(systemMonitor['isRunning']).toBe(true);
      
      systemMonitor.stop();
      expect(systemMonitor['isRunning']).toBe(false);
    });

    it('should handle multiple start calls gracefully', () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      
      systemMonitor.start();
      systemMonitor.start(); // Second start should warn
      
      expect(consoleSpy).toHaveBeenCalledWith('SystemMonitor is already running');
      
      consoleSpy.mockRestore();
    });

    it('should clean up resources on destroy', () => {
      systemMonitor.start();
      
      const stopSpy = vi.spyOn(systemMonitor, 'stop');
      const removeListenersSpy = vi.spyOn(systemMonitor, 'removeAllListeners');
      
      systemMonitor.destroy();
      
      expect(stopSpy).toHaveBeenCalled();
      expect(removeListenersSpy).toHaveBeenCalled();
    });
  });
});
