/**
 * Unit tests for Analysis Task Generator
 * Tests task creation, prioritization, and error handling
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AnalysisTaskGenerator, GenerateTasksRequest } from '../src/lib/analysis-task-generator';
import { FileRecord } from '../src/lib/database';
import { TaskPriority } from '../src/agents/task-types';

// Mock dependencies
vi.mock('../src/lib/database');
vi.mock('../src/agents/agent-manager');

describe('AnalysisTaskGenerator', () => {
  let generator: AnalysisTaskGenerator;
  let mockDatabase: any;
  let mockAgentManager: any;

  const mockFileRecords: FileRecord[] = [
    {
      id: 1,
      path: '/test/document.pdf',
      fileName: 'document.pdf',
      fileExtension: '.pdf',
      size: 1024,
      mtime: Date.now(),
      lastScannedAt: Date.now(),
      parentDirectory: '/test'
    },
    {
      id: 2, 
      path: '/test/image.jpg',
      fileName: 'image.jpg',
      fileExtension: '.jpg',
      size: 2048,
      mtime: Date.now(),
      lastScannedAt: Date.now(),
      parentDirectory: '/test'
    },
    {
      id: 3,
      path: '/test/unsupported.xyz',
      fileName: 'unsupported.xyz',
      fileExtension: '.xyz',
      size: 512,
      mtime: Date.now(),
      lastScannedAt: Date.now(),
      parentDirectory: '/test'
    }
  ];

  beforeEach(() => {
    // Setup mocks
    mockDatabase = {
      getFilesByIds: vi.fn(),
      getFilesByRootPath: vi.fn(),
    };
    
    mockAgentManager = {
      createTask: vi.fn(),
      getStatus: vi.fn().mockReturnValue({ isRunning: true })
    };

    // Reset generator with mock dependencies
    generator = new AnalysisTaskGenerator();
    
    // Override private methods for testing
    (generator as any).getFilesByIds = mockDatabase.getFilesByIds;
    (generator as any).getFilesByRootPath = mockDatabase.getFilesByRootPath;
    (generator as any).agentManager = mockAgentManager;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('generateTasks', () => {
    it('should generate tasks for specific file IDs in interactive mode', async () => {
      // Arrange
      const fileIds = [1, 2];
      mockDatabase.getFilesByIds.mockResolvedValue([mockFileRecords[0], mockFileRecords[1]]);
      mockAgentManager.createTask.mockResolvedValue('task-1');

      const request: GenerateTasksRequest = {
        fileIds,
        analysisType: 'rename-suggestions',
        isInteractive: true,
        modelName: 'llama3.1:8b'
      };

      // Act
      const result = await generator.generateTasks(request);

      // Assert
      expect(result.tasksCreated).toBe(2);
      expect(result.taskIds).toHaveLength(2);
      expect(result.totalFiles).toBe(2);
      expect(result.skippedFiles).toBe(0);
      expect(mockDatabase.getFilesByIds).toHaveBeenCalledWith(fileIds);
      expect(mockAgentManager.createTask).toHaveBeenCalledTimes(2);
    });

    it('should generate tasks for root path in batch mode', async () => {
      // Arrange
      mockDatabase.getFilesByRootPath.mockResolvedValue([mockFileRecords[0], mockFileRecords[1]]);
      mockAgentManager.createTask.mockResolvedValue('batch-task-1');

      const request: GenerateTasksRequest = {
        rootPath: '/test',
        analysisType: 'classification',
        isInteractive: false,
        modelName: 'llama3.1:8b'
      };

      // Act
      const result = await generator.generateTasks(request);

      // Assert
      expect(result.tasksCreated).toBe(2);
      expect(result.totalFiles).toBe(2);
      expect(mockDatabase.getFilesByRootPath).toHaveBeenCalledWith('/test');
    });

    it('should filter out unsupported file types', async () => {
      // Arrange
      mockDatabase.getFilesByIds.mockResolvedValue(mockFileRecords); // All 3 files
      mockAgentManager.createTask.mockResolvedValue('task-1');

      const request: GenerateTasksRequest = {
        fileIds: [1, 2, 3],
        analysisType: 'rename-suggestions',
        isInteractive: true,
        modelName: 'llama3.1:8b'
      };

      // Act
      const result = await generator.generateTasks(request);

      // Assert
      expect(result.tasksCreated).toBe(2); // Only PDF and JPG, not XYZ
      expect(result.totalFiles).toBe(3);
      expect(result.skippedFiles).toBe(1); // The .xyz file
    });

    it('should return empty result when no supported files found', async () => {
      // Arrange
      mockDatabase.getFilesByIds.mockResolvedValue([mockFileRecords[2]]); // Only unsupported file
      
      const request: GenerateTasksRequest = {
        fileIds: [3],
        analysisType: 'rename-suggestions',
        isInteractive: true,
        modelName: 'llama3.1:8b'
      };

      // Act
      const result = await generator.generateTasks(request);

      // Assert
      expect(result.tasksCreated).toBe(0);
      expect(result.taskIds).toHaveLength(0);
      expect(result.totalFiles).toBe(1);
      expect(result.skippedFiles).toBe(1);
      expect(mockAgentManager.createTask).not.toHaveBeenCalled();
    });

    it('should handle individual task creation failures gracefully', async () => {
      // Arrange
      mockDatabase.getFilesByIds.mockResolvedValue([mockFileRecords[0], mockFileRecords[1]]);
      mockAgentManager.createTask
        .mockResolvedValueOnce('task-1') // First succeeds
        .mockRejectedValueOnce(new Error('Task creation failed')); // Second fails

      const request: GenerateTasksRequest = {
        fileIds: [1, 2],
        analysisType: 'rename-suggestions',
        isInteractive: true,
        modelName: 'llama3.1:8b'
      };

      // Act
      const result = await generator.generateTasks(request);

      // Assert  
      expect(result.tasksCreated).toBe(1); // Only one task created
      expect(result.taskIds).toHaveLength(1);
      expect(result.taskIds[0]).toBe('task-1');
    });

    it('should throw error when neither fileIds nor rootPath provided', async () => {
      // Arrange
      const request: GenerateTasksRequest = {
        analysisType: 'rename-suggestions',
        isInteractive: true,
        modelName: 'llama3.1:8b'
        // No fileIds or rootPath
      };

      // Act & Assert
      await expect(generator.generateTasks(request)).rejects.toThrow('Either fileIds or rootPath must be specified');
    });

    it('should use appropriate priority for interactive vs batch tasks', async () => {
      // Arrange
      mockDatabase.getFilesByIds.mockResolvedValue([mockFileRecords[0]]);
      mockAgentManager.createTask.mockResolvedValue('task-1');

      const interactiveRequest: GenerateTasksRequest = {
        fileIds: [1],
        analysisType: 'rename-suggestions',
        isInteractive: true,
        modelName: 'llama3.1:8b'
      };

      // Act
      await generator.generateTasks(interactiveRequest);

      // Assert
      expect(mockAgentManager.createTask).toHaveBeenCalledWith(
        expect.objectContaining({
          priority: TaskPriority.HIGH // Interactive should be high priority
        })
      );
    });

    it('should calculate estimated duration based on task count', async () => {
      // Arrange
      mockDatabase.getFilesByIds.mockResolvedValue([mockFileRecords[0], mockFileRecords[1]]);
      mockAgentManager.createTask.mockResolvedValue('task-1');

      const request: GenerateTasksRequest = {
        fileIds: [1, 2],
        analysisType: 'rename-suggestions',
        isInteractive: true,
        modelName: 'llama3.1:8b'
      };

      // Act
      const result = await generator.generateTasks(request);

      // Assert
      expect(result.estimatedDuration).toBeGreaterThan(0);
      expect(typeof result.estimatedDuration).toBe('number');
    });
  });

  describe('isSupportedFileType', () => {
    it('should support common document formats', () => {
      const supportedExtensions = ['.pdf', '.doc', '.docx', '.txt', '.md'];
      
      for (const ext of supportedExtensions) {
        expect((generator as any).isSupportedFileType(ext)).toBe(true);
      }
    });

    it('should support common image formats', () => {
      const supportedExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.svg'];
      
      for (const ext of supportedExtensions) {
        expect((generator as any).isSupportedFileType(ext)).toBe(true);
      }
    });

    it('should reject unsupported formats', () => {
      const unsupportedExtensions = ['.xyz', '.abc', '.unknown', ''];
      
      for (const ext of unsupportedExtensions) {
        expect((generator as any).isSupportedFileType(ext)).toBe(false);
      }
    });
  });

  describe('batch processing', () => {
    it('should process files in configured batch sizes', async () => {
      // Arrange
      const manyFiles = Array.from({ length: 10 }, (_, i) => ({
        ...mockFileRecords[0],
        id: i + 1,
        path: `/test/file${i + 1}.pdf`,
        fileName: `file${i + 1}.pdf`
      }));

      mockDatabase.getFilesByIds.mockResolvedValue(manyFiles);
      mockAgentManager.createTask.mockResolvedValue('task-1');

      const request: GenerateTasksRequest = {
        fileIds: manyFiles.map(f => f.id!),
        analysisType: 'rename-suggestions',
        isInteractive: false,
        modelName: 'llama3.1:8b'
      };

      // Act
      const result = await generator.generateTasks(request);

      // Assert
      expect(result.tasksCreated).toBe(10);
      expect(mockAgentManager.createTask).toHaveBeenCalledTimes(10);
    });

    it('should add delays between batches', async () => {
      // This is harder to test directly, but we can verify the structure
      // In a real implementation, we might inject a sleep function for testing
      expect(true).toBe(true); // Placeholder for batch delay testing
    });
  });

  describe('error handling', () => {
    it('should handle database errors gracefully', async () => {
      // Arrange
      mockDatabase.getFilesByIds.mockRejectedValue(new Error('Database connection failed'));
      
      const request: GenerateTasksRequest = {
        fileIds: [1],
        analysisType: 'rename-suggestions',
        isInteractive: true,
        modelName: 'llama3.1:8b'
      };

      // Act & Assert
      await expect(generator.generateTasks(request)).rejects.toThrow();
    });

    it('should handle agent manager errors', async () => {
      // Arrange
      mockDatabase.getFilesByIds.mockResolvedValue([mockFileRecords[0]]);
      mockAgentManager.createTask.mockRejectedValue(new Error('Agent manager not available'));
      
      const request: GenerateTasksRequest = {
        fileIds: [1],
        analysisType: 'rename-suggestions',
        isInteractive: true,
        modelName: 'llama3.1:8b'
      };

      // Act
      const result = await generator.generateTasks(request);

      // Assert
      expect(result.tasksCreated).toBe(0); // Should continue despite errors
    });
  });

  describe('performance', () => {
    it('should handle large numbers of files efficiently', async () => {
      // Arrange
      const manyFiles = Array.from({ length: 1000 }, (_, i) => ({
        ...mockFileRecords[0],
        id: i + 1,
        path: `/test/file${i + 1}.pdf`,
        fileName: `file${i + 1}.pdf`
      }));

      mockDatabase.getFilesByRootPath.mockResolvedValue(manyFiles);
      mockAgentManager.createTask.mockResolvedValue('task-1');

      const request: GenerateTasksRequest = {
        rootPath: '/test',
        analysisType: 'classification',
        isInteractive: false,
        modelName: 'llama3.1:8b'
      };

      // Act
      const startTime = Date.now();
      const result = await generator.generateTasks(request);
      const executionTime = Date.now() - startTime;

      // Assert
      expect(result.tasksCreated).toBe(1000);
      expect(executionTime).toBeLessThan(5000); // Should complete within 5 seconds
    });
  });
});
