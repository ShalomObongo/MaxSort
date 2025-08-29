/**
 * AI prompt templates for file analysis tasks
 * Provides specialized prompts for different file types and analysis requirements
 */

/**
 * File type categories for prompt selection
 */
export type FileTypeCategory = 
  | 'document'      // Text documents, PDFs, Office files
  | 'image'         // Photos, graphics, diagrams
  | 'media'         // Audio, video files
  | 'code'          // Source code files
  | 'data'          // JSON, XML, CSV, databases
  | 'archive'       // ZIP, RAR, compressed files
  | 'generic'       // Unknown or unsupported types

/**
 * Analysis types supported by prompts
 */
export type AnalysisType = 
  | 'rename-suggestions'  // Generate better filename suggestions
  | 'classification'      // Classify file type and category
  | 'content-summary'     // Summarize file content and purpose
  | 'metadata-extraction' // Extract key metadata and properties

/**
 * File context information for prompt generation
 */
export interface FileContext {
  fileName: string;
  fileExtension: string;
  filePath: string;
  fileSize: number;
  parentDirectory: string;
  relativePathFromRoot?: string;
  mimeType?: string;
  createdAt?: number;
  modifiedAt?: number;
}

/**
 * Prompt generation options
 */
export interface PromptOptions {
  includeFileContent?: boolean;    // Whether to include file content in prompt
  contentPreviewLength?: number;   // Max characters of content to include
  temperature?: number;            // AI temperature setting (0-1)
  maxTokens?: number;             // Maximum response tokens
  responseFormat: 'json' | 'text'; // Expected response format
  customInstructions?: string;     // Additional custom instructions
}

/**
 * Core prompt template manager for file analysis tasks
 */
export class PromptTemplateManager {
  private static readonly FILE_SIZE_CATEGORIES = {
    small: 1024 * 1024,       // < 1MB
    medium: 10 * 1024 * 1024, // < 10MB
    large: 50 * 1024 * 1024,  // < 50MB
    // > 50MB = very large
  };

  /**
   * Generate analysis prompt for a specific file and analysis type
   */
  public static generatePrompt(
    context: FileContext,
    analysisType: AnalysisType,
    options: PromptOptions = { responseFormat: 'json' }
  ): string {
    const fileCategory = this.categorizeFile(context);
    const sizeCategory = this.categorizeFileSize(context.fileSize);
    
    switch (analysisType) {
      case 'rename-suggestions':
        return this.generateRenameSuggestionsPrompt(context, fileCategory, sizeCategory, options);
      
      case 'classification':
        return this.generateClassificationPrompt(context, fileCategory, sizeCategory, options);
      
      case 'content-summary':
        return this.generateContentSummaryPrompt(context, fileCategory, sizeCategory, options);
      
      case 'metadata-extraction':
        return this.generateMetadataExtractionPrompt(context, fileCategory, sizeCategory, options);
      
      default:
        throw new Error(`Unsupported analysis type: ${analysisType}`);
    }
  }

  /**
   * Generate rename suggestions prompt
   */
  private static generateRenameSuggestionsPrompt(
    context: FileContext,
    fileCategory: FileTypeCategory,
    sizeCategory: string,
    options: PromptOptions
  ): string {
    const fileSizeKB = Math.round(context.fileSize / 1024);
    const baseContext = this.buildBaseFileContext(context);
    
    // Category-specific naming guidelines
    const categoryGuidelines = this.getCategoryNamingGuidelines(fileCategory);
    
    const prompt = `You are an expert file organizer helping users create better, more descriptive filenames.

${baseContext}

TASK: Suggest 3 improved filenames that are more descriptive and meaningful than the current name.

REQUIREMENTS:
${categoryGuidelines}
- Keep the original file extension: ${context.fileExtension}
- Use clear, descriptive language
- Follow filesystem naming conventions (no special characters: / \\ : * ? " < > |)
- Maximum filename length: 100 characters
- Use hyphens or underscores for word separation
- Avoid generic terms like "file", "document", "untitled"

CONTEXT CLUES TO CONSIDER:
- File location: ${context.parentDirectory}
- File size: ${fileSizeKB}KB (${sizeCategory})
- Current name pattern: ${context.fileName}
${context.relativePathFromRoot ? `- Path structure: ${context.relativePathFromRoot}` : ''}

${options.customInstructions || ''}

${options.responseFormat === 'json' ? this.getJsonResponseFormat('rename') : this.getTextResponseFormat('rename')}`;

    return prompt;
  }

  /**
   * Generate classification prompt
   */
  private static generateClassificationPrompt(
    context: FileContext,
    fileCategory: FileTypeCategory,
    sizeCategory: string,
    options: PromptOptions
  ): string {
    const baseContext = this.buildBaseFileContext(context);
    
    const prompt = `You are an expert file classifier helping organize digital files into logical categories.

${baseContext}

TASK: Classify this file into appropriate organizational categories.

CLASSIFICATION DIMENSIONS:
1. PRIMARY CATEGORY: Main file purpose/type
2. CONTENT TYPE: Specific content description  
3. ORGANIZATIONAL TAGS: Relevant organizational labels
4. PRIORITY LEVEL: Importance/urgency assessment
5. USAGE CONTEXT: How this file is typically used

AVAILABLE PRIMARY CATEGORIES:
- documents: Text files, PDFs, presentations, reports
- media: Images, videos, audio files
- code: Source code, scripts, configuration files
- data: Databases, spreadsheets, structured data
- archives: Compressed files, backups
- resources: Assets, templates, references
- personal: Individual documents, photos
- work: Professional documents, projects
- system: Configuration, logs, temporary files

${options.customInstructions || ''}

${options.responseFormat === 'json' ? this.getJsonResponseFormat('classification') : this.getTextResponseFormat('classification')}`;

    return prompt;
  }

  /**
   * Generate content summary prompt
   */
  private static generateContentSummaryPrompt(
    context: FileContext,
    fileCategory: FileTypeCategory,
    sizeCategory: string,
    options: PromptOptions
  ): string {
    const baseContext = this.buildBaseFileContext(context);
    
    // File type specific analysis instructions
    const typeSpecificInstructions = this.getTypeSpecificInstructions(fileCategory);
    
    const prompt = `You are an expert content analyst helping users understand their files.

${baseContext}

TASK: Provide a comprehensive summary of this file's content and purpose.

ANALYSIS FOCUS:
${typeSpecificInstructions}

SUMMARY REQUIREMENTS:
- Identify the file's primary purpose and use case
- Highlight key characteristics or notable features
- Assess content complexity and scope
- Suggest organizational placement or categorization
- Note any special properties or requirements

CONTENT ASSESSMENT FACTORS:
- File type: ${fileCategory}
- File size: ${sizeCategory}
- Location context: ${context.parentDirectory}
- Naming patterns: ${context.fileName}

${options.customInstructions || ''}

${options.responseFormat === 'json' ? this.getJsonResponseFormat('summary') : this.getTextResponseFormat('summary')}`;

    return prompt;
  }

  /**
   * Generate metadata extraction prompt
   */
  private static generateMetadataExtractionPrompt(
    context: FileContext,
    fileCategory: FileTypeCategory,
    sizeCategory: string,
    options: PromptOptions
  ): string {
    const baseContext = this.buildBaseFileContext(context);
    
    const prompt = `You are an expert metadata extractor analyzing file properties and characteristics.

${baseContext}

TASK: Extract and analyze key metadata and properties from this file.

EXTRACTION TARGETS:
- Technical properties (format, compression, quality)
- Content properties (subject, keywords, themes)
- Organizational properties (category, tags, relationships)
- Temporal properties (creation context, version, age)
- Usage properties (access patterns, dependencies, requirements)

METADATA CATEGORIES:
- Core: Essential file identification data
- Content: Subject matter and content analysis
- Technical: Format specifications and requirements
- Contextual: Usage and organizational information

${options.customInstructions || ''}

${options.responseFormat === 'json' ? this.getJsonResponseFormat('metadata') : this.getTextResponseFormat('metadata')}`;

    return prompt;
  }

  /**
   * Build base file context string
   */
  private static buildBaseFileContext(context: FileContext): string {
    const fileSizeKB = Math.round(context.fileSize / 1024);
    
    return `FILE INFORMATION:
- Current Name: ${context.fileName}
- Extension: ${context.fileExtension || 'none'}
- Size: ${fileSizeKB}KB
- Location: ${context.parentDirectory}
${context.relativePathFromRoot ? `- Relative Path: ${context.relativePathFromRoot}` : ''}
${context.mimeType ? `- MIME Type: ${context.mimeType}` : ''}
${context.createdAt ? `- Created: ${new Date(context.createdAt).toLocaleDateString()}` : ''}
${context.modifiedAt ? `- Modified: ${new Date(context.modifiedAt).toLocaleDateString()}` : ''}`;
  }

  /**
   * Categorize file by type
   */
  private static categorizeFile(context: FileContext): FileTypeCategory {
    const ext = (context.fileExtension || '').toLowerCase();
    
    // Document extensions
    if (['.txt', '.md', '.doc', '.docx', '.pdf', '.rtf', '.odt', '.pages'].includes(ext)) {
      return 'document';
    }
    
    // Image extensions
    if (['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.svg', '.webp', '.tiff', '.ico'].includes(ext)) {
      return 'image';
    }
    
    // Media extensions
    if (['.mp4', '.avi', '.mov', '.mkv', '.wmv', '.mp3', '.wav', '.flac', '.m4a'].includes(ext)) {
      return 'media';
    }
    
    // Code extensions
    if (['.js', '.ts', '.py', '.java', '.cpp', '.c', '.cs', '.php', '.rb', '.go', '.html', '.css'].includes(ext)) {
      return 'code';
    }
    
    // Data extensions
    if (['.json', '.xml', '.csv', '.yaml', '.yml', '.sql', '.db', '.sqlite'].includes(ext)) {
      return 'data';
    }
    
    // Archive extensions
    if (['.zip', '.rar', '.7z', '.tar', '.gz', '.bz2'].includes(ext)) {
      return 'archive';
    }
    
    return 'generic';
  }

  /**
   * Categorize file by size
   */
  private static categorizeFileSize(size: number): string {
    if (size < this.FILE_SIZE_CATEGORIES.small) {
      return 'small';
    } else if (size < this.FILE_SIZE_CATEGORIES.medium) {
      return 'medium';
    } else if (size < this.FILE_SIZE_CATEGORIES.large) {
      return 'large';
    } else {
      return 'very large';
    }
  }

  /**
   * Get category-specific naming guidelines
   */
  private static getCategoryNamingGuidelines(category: FileTypeCategory): string {
    switch (category) {
      case 'document':
        return `- Use descriptive titles that indicate content or purpose
- Include document type, subject, or project name
- Consider date format: YYYY-MM-DD for chronological files
- Example patterns: "project-proposal-2024", "meeting-notes-team-planning"`;
        
      case 'image':
        return `- Include subject, event, or content description
- Consider location, date, or context
- Use descriptive terms for visual content
- Example patterns: "sunset-beach-vacation-2024", "logo-design-final-version"`;
        
      case 'media':
        return `- Include title, artist, or content description
- Consider episode numbers, season, or sequence
- Include quality indicators if relevant
- Example patterns: "podcast-episode-012-interview", "demo-video-product-launch"`;
        
      case 'code':
        return `- Use clear module, component, or feature names
- Include purpose or functionality description
- Follow code naming conventions
- Example patterns: "user-authentication-service", "data-migration-script"`;
        
      case 'data':
        return `- Specify data type, source, or purpose
- Include date ranges or versions
- Use clear field or content indicators
- Example patterns: "customer-export-2024-q1", "config-production-database"`;
        
      case 'archive':
        return `- Describe archive contents and purpose
- Include date or version information
- Specify backup type or source
- Example patterns: "project-backup-2024-12-15", "assets-archive-website-v2"`;
        
      default:
        return `- Use descriptive, meaningful names
- Include context, purpose, or content type
- Avoid generic or vague terms
- Make names searchable and intuitive`;
    }
  }

  /**
   * Get type-specific analysis instructions
   */
  private static getTypeSpecificInstructions(category: FileTypeCategory): string {
    switch (category) {
      case 'document':
        return `- Identify document type (report, presentation, notes, etc.)
- Assess content complexity and target audience
- Note formatting, structure, and key topics
- Consider document purpose and usage context`;
        
      case 'image':
        return `- Analyze visual content and subject matter
- Identify image type (photo, graphic, diagram, etc.)
- Assess quality, resolution, and technical properties
- Consider visual style and artistic elements`;
        
      case 'media':
        return `- Identify media type and content genre
- Assess quality, duration, and technical specifications
- Note audio/video characteristics
- Consider entertainment, educational, or professional context`;
        
      case 'code':
        return `- Identify programming language and purpose
- Assess code complexity and functionality
- Note architectural patterns or frameworks
- Consider development stage and usage context`;
        
      case 'data':
        return `- Identify data format and structure
- Assess data complexity and relationships
- Note schema, fields, or data types
- Consider data source and intended usage`;
        
      case 'archive':
        return `- Analyze archive type and compression
- Estimate contents and purpose
- Note archive structure and organization
- Consider backup, distribution, or storage context`;
        
      default:
        return `- Analyze file characteristics and properties
- Identify likely purpose and usage patterns
- Assess complexity and requirements
- Consider organizational and contextual factors`;
    }
  }

  /**
   * Get JSON response format template
   */
  private static getJsonResponseFormat(type: string): string {
    switch (type) {
      case 'rename':
        return `RESPONSE FORMAT (JSON):
{
  "suggestions": [
    {
      "filename": "suggested-filename-1.ext",
      "confidence": 85,
      "reasoning": "Explanation of why this name is better"
    },
    {
      "filename": "suggested-filename-2.ext", 
      "confidence": 75,
      "reasoning": "Explanation of why this name is better"
    },
    {
      "filename": "suggested-filename-3.ext",
      "confidence": 65,
      "reasoning": "Explanation of why this name is better"
    }
  ],
  "originalName": "current-filename.ext",
  "analysisNotes": "Overall insights about filename improvements",
  "namingPattern": "Description of recommended naming pattern"
}`;
        
      case 'classification':
        return `RESPONSE FORMAT (JSON):
{
  "primaryCategory": "documents|media|code|data|archives|resources|personal|work|system",
  "contentType": "Specific description of file content",
  "organizationalTags": ["tag1", "tag2", "tag3"],
  "priority": "high|medium|low",
  "usageContext": "How this file is typically used",
  "confidence": 85,
  "reasoning": "Explanation of classification decisions",
  "recommendedLocation": "Suggested organizational placement"
}`;
        
      case 'summary':
        return `RESPONSE FORMAT (JSON):
{
  "summary": "Concise description of file content and purpose",
  "primaryPurpose": "Main use case or function",
  "keyCharacteristics": ["feature1", "feature2", "feature3"],
  "contentComplexity": "simple|moderate|complex|very complex",
  "technicalRequirements": "Any special requirements or dependencies",
  "confidence": 80,
  "reasoning": "Basis for analysis and assessment",
  "recommendedActions": ["action1", "action2"]
}`;
        
      case 'metadata':
        return `RESPONSE FORMAT (JSON):
{
  "coreMetadata": {
    "title": "Descriptive title",
    "type": "Specific file type",
    "format": "Technical format details"
  },
  "contentMetadata": {
    "subject": "Primary subject matter",
    "keywords": ["keyword1", "keyword2", "keyword3"],
    "themes": ["theme1", "theme2"]
  },
  "technicalMetadata": {
    "specifications": "Technical specs and requirements",
    "quality": "Quality assessment",
    "compatibility": "Compatibility information"
  },
  "contextualMetadata": {
    "purpose": "Intended purpose or use case",
    "audience": "Target audience or user group",
    "relationships": "Related files or dependencies"
  },
  "confidence": 85,
  "reasoning": "Explanation of metadata extraction decisions"
}`;
        
      default:
        return `RESPONSE FORMAT (JSON):
{
  "result": "Analysis result data",
  "confidence": 80,
  "reasoning": "Explanation of analysis"
}`;
    }
  }

  /**
   * Get text response format template
   */
  private static getTextResponseFormat(type: string): string {
    return `RESPONSE FORMAT (Plain Text):
Provide a clear, structured response with:
1. Main findings or results
2. Supporting reasoning and analysis
3. Confidence level (0-100)
4. Additional insights or recommendations

Keep response concise but comprehensive.`;
  }

  /**
   * Validate prompt safety and content
   */
  public static validatePrompt(prompt: string): { isValid: boolean; issues: string[] } {
    const issues: string[] = [];
    
    // Check for potential prompt injection patterns
    const injectionPatterns = [
      /ignore\s+previous\s+instructions/i,
      /forget\s+everything/i,
      /new\s+instructions/i,
      /role\s*[:=]\s*(?:admin|root|system)/i,
      /execute\s+(?:code|script|command)/i,
    ];
    
    for (const pattern of injectionPatterns) {
      if (pattern.test(prompt)) {
        issues.push('Potential prompt injection detected');
        break;
      }
    }
    
    // Check prompt length
    if (prompt.length > 10000) {
      issues.push('Prompt exceeds maximum length (10,000 characters)');
    }
    
    if (prompt.length < 50) {
      issues.push('Prompt is too short to be effective');
    }
    
    // Check for required response format
    if (!prompt.includes('RESPONSE FORMAT') && !prompt.includes('JSON')) {
      issues.push('Prompt missing response format specification');
    }
    
    return {
      isValid: issues.length === 0,
      issues,
    };
  }
}

/**
 * Utility functions for prompt template management
 */
export class PromptUtils {
  /**
   * Sanitize file paths and names for prompt inclusion
   */
  public static sanitizeForPrompt(text: string): string {
    return text
      .replace(/[<>]/g, '') // Remove angle brackets
      .replace(/\n{3,}/g, '\n\n') // Collapse multiple newlines
      .trim();
  }

  /**
   * Truncate content to fit within prompt limits
   */
  public static truncateContent(content: string, maxLength: number): string {
    if (content.length <= maxLength) {
      return content;
    }
    
    const truncated = content.substring(0, maxLength - 3);
    return truncated + '...';
  }

  /**
   * Extract file content preview safely
   */
  public static extractContentPreview(filePath: string, maxLength: number = 500): Promise<string> {
    // This would implement secure file content reading
    // For now, return a placeholder
    return Promise.resolve(`[Content preview for ${filePath} - ${maxLength} chars max]`);
  }

  /**
   * Build context-aware prompt with file system safety
   */
  public static buildSafePrompt(basePrompt: string, context: FileContext): string {
    // Sanitize all context values
    const safeContext: FileContext = {
      ...context,
      fileName: this.sanitizeForPrompt(context.fileName),
      filePath: this.sanitizeForPrompt(context.filePath),
      parentDirectory: this.sanitizeForPrompt(context.parentDirectory),
      relativePathFromRoot: context.relativePathFromRoot 
        ? this.sanitizeForPrompt(context.relativePathFromRoot) 
        : undefined,
    };
    
    // Replace context placeholders in prompt
    return basePrompt
      .replace(/\{\{fileName\}\}/g, safeContext.fileName)
      .replace(/\{\{filePath\}\}/g, safeContext.filePath)
      .replace(/\{\{fileExtension\}\}/g, safeContext.fileExtension || '')
      .replace(/\{\{parentDirectory\}\}/g, safeContext.parentDirectory)
      .replace(/\{\{relativePathFromRoot\}\}/g, safeContext.relativePathFromRoot || '');
  }
}

// Export singleton instance for consistent prompt generation
export const promptTemplateManager = new PromptTemplateManager();
