import { logger } from '../lib/logger';

// Validation schemas
export interface ValidationSchema {
  type: 'string' | 'number' | 'boolean' | 'object' | 'array' | 'any';
  required?: boolean;
  minLength?: number;
  maxLength?: number;
  min?: number;
  max?: number;
  pattern?: RegExp;
  properties?: { [key: string]: ValidationSchema };
  items?: ValidationSchema;
  enum?: any[];
  custom?: (value: any) => boolean | string;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  sanitizedData?: any;
}

export interface IPCErrorContext {
  channel: string;
  data: any;
  timestamp: number;
  errorType: 'validation' | 'execution' | 'timeout' | 'network' | 'unknown';
  retryable: boolean;
  userFriendlyMessage: string;
}

// Error recovery strategies
export enum RecoveryStrategy {
  RETRY = 'retry',
  FALLBACK = 'fallback',
  SKIP = 'skip',
  PROMPT_USER = 'prompt-user',
  CACHE_OFFLINE = 'cache-offline'
}

export interface RecoveryAction {
  strategy: RecoveryStrategy;
  maxRetries?: number;
  retryDelay?: number;
  fallbackHandler?: () => any;
  promptOptions?: {
    title: string;
    message: string;
    buttons: string[];
  };
}

export class DataValidationManager {
  private static instance: DataValidationManager | null = null;
  private schemas: Map<string, ValidationSchema> = new Map();
  private errorHandlers: Map<string, (error: IPCErrorContext) => RecoveryAction> = new Map();
  private retryCounters: Map<string, number> = new Map();

  private constructor() {
    this.setupDefaultSchemas();
    this.setupDefaultErrorHandlers();
  }

  public static getInstance(): DataValidationManager {
    if (!DataValidationManager.instance) {
      DataValidationManager.instance = new DataValidationManager();
    }
    return DataValidationManager.instance;
  }

  // Schema registration
  public registerSchema(channel: string, schema: ValidationSchema): void {
    this.schemas.set(channel, schema);
    logger.debug('DataValidator', `Schema registered for channel: ${channel}`);
  }

  public registerErrorHandler(channel: string, handler: (error: IPCErrorContext) => RecoveryAction): void {
    this.errorHandlers.set(channel, handler);
    logger.debug('DataValidator', `Error handler registered for channel: ${channel}`);
  }

  // Data validation
  public validateData(channel: string, data: any): ValidationResult {
    const schema = this.schemas.get(channel);
    if (!schema) {
      return { valid: true, errors: [], sanitizedData: data };
    }

    try {
      const result = this.validateValue(data, schema, channel);
      
      if (!result.valid) {
        logger.warn('DataValidator', `Validation failed for channel ${channel}`, {
          errors: result.errors,
          data: this.sanitizeForLogging(data)
        });
      }

      return result;
    } catch (error) {
      logger.error('DataValidator', `Validation error for channel ${channel}`, error as Error);
      return {
        valid: false,
        errors: [`Validation exception: ${(error as Error).message}`]
      };
    }
  }

  private validateValue(value: any, schema: ValidationSchema, path: string): ValidationResult {
    const errors: string[] = [];
    let sanitizedValue = value;

    // Required check
    if (schema.required && (value === null || value === undefined)) {
      errors.push(`${path} is required`);
      return { valid: false, errors };
    }

    // Skip validation if value is null/undefined and not required
    if (value === null || value === undefined) {
      return { valid: true, errors: [], sanitizedData: value };
    }

    // Type validation
    if (schema.type !== 'any') {
      const actualType = this.getValueType(value);
      if (actualType !== schema.type) {
        errors.push(`${path} expected ${schema.type}, got ${actualType}`);
      }
    }

    // Type-specific validation
    switch (schema.type) {
      case 'string':
        const stringResult = this.validateString(value, schema, path);
        errors.push(...stringResult.errors);
        sanitizedValue = stringResult.sanitizedData ?? sanitizedValue;
        break;

      case 'number':
        const numberResult = this.validateNumber(value, schema, path);
        errors.push(...numberResult.errors);
        sanitizedValue = numberResult.sanitizedData ?? sanitizedValue;
        break;

      case 'object':
        const objectResult = this.validateObject(value, schema, path);
        errors.push(...objectResult.errors);
        sanitizedValue = objectResult.sanitizedData ?? sanitizedValue;
        break;

      case 'array':
        const arrayResult = this.validateArray(value, schema, path);
        errors.push(...arrayResult.errors);
        sanitizedValue = arrayResult.sanitizedData ?? sanitizedValue;
        break;
    }

    // Enum validation
    if (schema.enum && !schema.enum.includes(value)) {
      errors.push(`${path} must be one of: ${schema.enum.join(', ')}`);
    }

    // Custom validation
    if (schema.custom) {
      const customResult = schema.custom(value);
      if (customResult !== true) {
        errors.push(typeof customResult === 'string' ? customResult : `${path} failed custom validation`);
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      sanitizedData: errors.length === 0 ? sanitizedValue : undefined
    };
  }

  private validateString(value: any, schema: ValidationSchema, path: string): ValidationResult {
    const errors: string[] = [];
    
    if (typeof value !== 'string') {
      return { valid: false, errors };
    }

    if (schema.minLength && value.length < schema.minLength) {
      errors.push(`${path} must be at least ${schema.minLength} characters`);
    }

    if (schema.maxLength && value.length > schema.maxLength) {
      errors.push(`${path} must be at most ${schema.maxLength} characters`);
    }

    if (schema.pattern && !schema.pattern.test(value)) {
      errors.push(`${path} does not match required pattern`);
    }

    // Sanitize string (trim whitespace, escape HTML)
    let sanitized = value.trim();
    sanitized = sanitized.replace(/[<>&"']/g, (char) => {
      const entityMap: { [key: string]: string } = {
        '<': '&lt;',
        '>': '&gt;',
        '&': '&amp;',
        '"': '&quot;',
        "'": '&#x27;'
      };
      return entityMap[char] || char;
    });

    return {
      valid: errors.length === 0,
      errors,
      sanitizedData: sanitized
    };
  }

  private validateNumber(value: any, schema: ValidationSchema, path: string): ValidationResult {
    const errors: string[] = [];
    
    if (typeof value !== 'number' || isNaN(value)) {
      return { valid: false, errors };
    }

    if (schema.min !== undefined && value < schema.min) {
      errors.push(`${path} must be at least ${schema.min}`);
    }

    if (schema.max !== undefined && value > schema.max) {
      errors.push(`${path} must be at most ${schema.max}`);
    }

    return {
      valid: errors.length === 0,
      errors,
      sanitizedData: value
    };
  }

  private validateObject(value: any, schema: ValidationSchema, path: string): ValidationResult {
    const errors: string[] = [];
    const sanitizedObject: any = {};
    
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return { valid: false, errors };
    }

    if (schema.properties) {
      for (const [key, propSchema] of Object.entries(schema.properties)) {
        const propPath = `${path}.${key}`;
        const propResult = this.validateValue(value[key], propSchema, propPath);
        
        errors.push(...propResult.errors);
        
        if (propResult.valid && propResult.sanitizedData !== undefined) {
          sanitizedObject[key] = propResult.sanitizedData;
        } else if (value[key] !== undefined) {
          sanitizedObject[key] = value[key];
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      sanitizedData: sanitizedObject
    };
  }

  private validateArray(value: any, schema: ValidationSchema, path: string): ValidationResult {
    const errors: string[] = [];
    const sanitizedArray: any[] = [];
    
    if (!Array.isArray(value)) {
      return { valid: false, errors };
    }

    if (schema.minLength && value.length < schema.minLength) {
      errors.push(`${path} must have at least ${schema.minLength} items`);
    }

    if (schema.maxLength && value.length > schema.maxLength) {
      errors.push(`${path} must have at most ${schema.maxLength} items`);
    }

    if (schema.items) {
      value.forEach((item, index) => {
        const itemPath = `${path}[${index}]`;
        const itemResult = this.validateValue(item, schema.items!, itemPath);
        
        errors.push(...itemResult.errors);
        
        if (itemResult.valid && itemResult.sanitizedData !== undefined) {
          sanitizedArray.push(itemResult.sanitizedData);
        } else {
          sanitizedArray.push(item);
        }
      });
    }

    return {
      valid: errors.length === 0,
      errors,
      sanitizedData: sanitizedArray
    };
  }

  private getValueType(value: any): string {
    if (value === null) return 'null';
    if (Array.isArray(value)) return 'array';
    return typeof value;
  }

  // Error handling and recovery
  public handleIPCError(error: Error, channel: string, data: any): RecoveryAction {
    const errorContext: IPCErrorContext = {
      channel,
      data: this.sanitizeForLogging(data),
      timestamp: Date.now(),
      errorType: this.categorizeError(error),
      retryable: this.isRetryableError(error),
      userFriendlyMessage: this.generateUserFriendlyMessage(error, channel)
    };

    logger.error('DataValidator', `IPC error in channel ${channel}`, error, errorContext);

    // Get custom error handler
    const customHandler = this.errorHandlers.get(channel);
    if (customHandler) {
      try {
        return customHandler(errorContext);
      } catch (handlerError) {
        logger.error('DataValidator', `Error handler failed for channel ${channel}`, handlerError as Error);
      }
    }

    // Default error handling
    return this.getDefaultRecoveryAction(errorContext);
  }

  private categorizeError(error: Error): IPCErrorContext['errorType'] {
    const message = error.message.toLowerCase();
    
    if (message.includes('validation') || message.includes('invalid')) {
      return 'validation';
    }
    if (message.includes('timeout')) {
      return 'timeout';
    }
    if (message.includes('network') || message.includes('connection')) {
      return 'network';
    }
    if (message.includes('execute') || message.includes('handler')) {
      return 'execution';
    }
    
    return 'unknown';
  }

  private isRetryableError(error: Error): boolean {
    const retryablePatterns = [
      /timeout/i,
      /network/i,
      /connection/i,
      /temporary/i,
      /busy/i
    ];

    return retryablePatterns.some(pattern => pattern.test(error.message));
  }

  private generateUserFriendlyMessage(error: Error, channel: string): string {
    const errorType = this.categorizeError(error);
    
    switch (errorType) {
      case 'validation':
        return 'The provided data is invalid. Please check your input and try again.';
      case 'timeout':
        return 'The operation timed out. Please try again later.';
      case 'network':
        return 'Network connection issues detected. Please check your connection and try again.';
      case 'execution':
        return 'An error occurred while processing your request. Please try again.';
      default:
        return 'An unexpected error occurred. Please try again or contact support.';
    }
  }

  private getDefaultRecoveryAction(errorContext: IPCErrorContext): RecoveryAction {
    const retryKey = `${errorContext.channel}_${errorContext.timestamp}`;
    const currentRetries = this.retryCounters.get(retryKey) || 0;

    switch (errorContext.errorType) {
      case 'timeout':
      case 'network':
        if (currentRetries < 3) {
          this.retryCounters.set(retryKey, currentRetries + 1);
          return {
            strategy: RecoveryStrategy.RETRY,
            maxRetries: 3,
            retryDelay: Math.min(1000 * Math.pow(2, currentRetries), 10000)
          };
        }
        return {
          strategy: RecoveryStrategy.CACHE_OFFLINE,
          promptOptions: {
            title: 'Connection Issues',
            message: 'Unable to complete the operation due to connection issues. Would you like to retry when connection is restored?',
            buttons: ['Retry Later', 'Cancel']
          }
        };

      case 'validation':
        return {
          strategy: RecoveryStrategy.PROMPT_USER,
          promptOptions: {
            title: 'Invalid Data',
            message: errorContext.userFriendlyMessage,
            buttons: ['OK']
          }
        };

      case 'execution':
        if (currentRetries < 2) {
          this.retryCounters.set(retryKey, currentRetries + 1);
          return {
            strategy: RecoveryStrategy.RETRY,
            maxRetries: 2,
            retryDelay: 2000
          };
        }
        return {
          strategy: RecoveryStrategy.PROMPT_USER,
          promptOptions: {
            title: 'Operation Failed',
            message: 'The operation could not be completed. Would you like to try again?',
            buttons: ['Retry', 'Cancel']
          }
        };

      default:
        return {
          strategy: RecoveryStrategy.SKIP
        };
    }
  }

  // Utility methods
  private sanitizeForLogging(data: any): any {
    if (typeof data !== 'object' || data === null) {
      return data;
    }

    const sanitized: any = {};
    for (const [key, value] of Object.entries(data)) {
      // Redact sensitive fields
      if (this.isSensitiveField(key)) {
        sanitized[key] = '[REDACTED]';
      } else if (typeof value === 'object') {
        sanitized[key] = this.sanitizeForLogging(value);
      } else {
        sanitized[key] = value;
      }
    }

    return sanitized;
  }

  private isSensitiveField(fieldName: string): boolean {
    const sensitivePatterns = [
      /password/i,
      /token/i,
      /secret/i,
      /key/i,
      /auth/i,
      /credential/i
    ];

    return sensitivePatterns.some(pattern => pattern.test(fieldName));
  }

  // Default schemas setup
  private setupDefaultSchemas(): void {
    // UI state schemas
    this.registerSchema('ui:updateState', {
      type: 'object',
      required: true,
      properties: {
        activeTab: { type: 'string', enum: ['dashboard', 'analysis', 'settings', 'history'] },
        selectedDirectory: { type: 'string' },
        selectedModel: { type: 'string' },
        analysisInProgress: { type: 'boolean' },
        currentJobId: { type: 'string' }
      }
    });

    // Analysis schemas
    this.registerSchema('suggestions:getAnalysisResults', {
      type: 'object',
      properties: {
        fileId: { type: 'number', required: true, min: 1 },
        analysisType: { 
          type: 'string', 
          enum: ['rename-suggestions', 'classification', 'content-summary', 'metadata-extraction']
        }
      }
    });

    // Event streaming schemas
    this.registerSchema('events:getHistory', {
      type: 'object',
      properties: {
        type: { type: 'string' },
        source: { type: 'string' },
        since: { type: 'number', min: 0 },
        limit: { type: 'number', min: 1, max: 1000 }
      }
    });

    // Offline operation schemas
    this.registerSchema('offline:queueOperation', {
      type: 'object',
      required: true,
      properties: {
        type: { 
          type: 'string', 
          required: true,
          enum: ['analysis', 'batch-operation', 'settings-update', 'state-sync'] 
        },
        payload: { type: 'any', required: true },
        maxRetries: { type: 'number', min: 0, max: 10 },
        priority: { 
          type: 'string', 
          enum: ['low', 'medium', 'high', 'critical'] 
        },
        dependencies: { 
          type: 'array', 
          items: { type: 'string' } 
        }
      }
    });
  }

  private setupDefaultErrorHandlers(): void {
    // Analysis error handler
    this.registerErrorHandler('suggestions:getAnalysisResults', (error) => {
      if (error.errorType === 'network') {
        return {
          strategy: RecoveryStrategy.CACHE_OFFLINE,
          promptOptions: {
            title: 'Analysis Unavailable',
            message: 'Analysis services are currently unavailable. The operation will be retried when connection is restored.',
            buttons: ['OK']
          }
        };
      }
      return this.getDefaultRecoveryAction(error);
    });

    // Event streaming error handler
    this.registerErrorHandler('events:subscribe', (error) => {
      return {
        strategy: RecoveryStrategy.RETRY,
        maxRetries: 5,
        retryDelay: 1000
      };
    });
  }
}

// Export singleton instance
export const dataValidator = DataValidationManager.getInstance();
