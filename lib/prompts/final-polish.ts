/**
 * Enhanced Final Polish System for Academic Documents
 * Production-ready with schema validation, real tokenizer, and robust processing
 * 
 * IMPROVEMENTS:
 * - JSON schema validation with Zod
 * - Real tokenizer for accurate token counting  
 * - Strongly typed progress callbacks
 * - Better improvement parsing with multiple section handling
 * - DRY streaming vs batch logic
 */

import { z } from 'zod';
import { get_encoding } from '@dqbd/tiktoken';
import { generateText } from 'ai';
import { ai } from '@/lib/ai/vercel-client';
import { PaperTypeKey, CitationStyle, ImprovementType, SectionContent } from './types';
import polishInstructionsData from './polish-instructions.json';

// Schema validation for polish instructions
const PolishInstructionsSchema = z.object({
  polishInstructions: z.record(z.object({
    systemPrompt: z.string().min(10),
    requirements: z.array(z.string().min(1)),
    focusAreas: z.array(z.string().min(1)),
    qualityThresholds: z.object({
      minWordCount: z.number().optional(),
      minCitationDensity: z.number().optional(),
      requiredSections: z.array(z.string()).optional()
    })
  }))
});

// Strongly typed progress event
export interface PolishProgress {
  stage: 'analyzing' | 'polishing' | 'validating' | 'retrying';
  progress: number; // 0-100
  message: string;
  currentChunk?: number;
  totalChunks?: number;
  retryAttempt?: number;
  maxRetries?: number;
}

export interface PolishConfig {
  paperType: PaperTypeKey;
  topic: string;
  citationStyle: CitationStyle;
  localRegion?: string;
  targetWordCount?: number;
  temperature?: number;
  maxTokens?: number;
  chunkSections?: boolean;
  enableRetry?: boolean;
  maxRetries?: number;
  onProgress?: (progress: PolishProgress) => void;
}

export interface PolishedDocument {
  content: string;
  wordCount: number;
  sectionsProcessed: number;
  improvementsApplied: ImprovementType[];
  qualityScore: number;
  chunksProcessed?: number;
  processingTime?: number;
  retryAttempts?: number;
}

export interface PolishValidation {
  isValid: boolean;
  issues: string[];
  score: number;
  requiredImprovements?: ImprovementType[];
}

export interface PolishInstructions {
  systemPrompt: string;
  requirements: string[];
  focusAreas: string[];
  qualityThresholds: {
    minWordCount?: number;
    minCitationDensity?: number;
    requiredSections?: string[];
  };
}

// Token counting configuration
const CHUNK_SIZE_TOKENS = 6000;
const CHUNK_OVERLAP_TOKENS = 500;
const MAX_OUTPUT_TOKENS = 2000;

// Initialize tokenizer (cached)
let tokenizer: ReturnType<typeof get_encoding> | null = null;
function getTokenizer() {
  if (!tokenizer) {
    tokenizer = get_encoding('cl100k_base'); // GPT-4 tokenizer
  }
  return tokenizer;
}

// Validated polish instructions (cached)
let validatedInstructions: Record<string, PolishInstructions> | null = null;

/**
 * Validate and cache polish instructions on first access
 */
function getValidatedInstructions(): Record<string, PolishInstructions> {
  if (validatedInstructions !== null) {
    return validatedInstructions;
  }

  try {
    const validation = PolishInstructionsSchema.parse(polishInstructionsData);
    validatedInstructions = validation.polishInstructions as Record<string, PolishInstructions>;
    return validatedInstructions;
  } catch (error) {
    if (error instanceof z.ZodError) {
      const errorMessages = error.errors.map(err => 
        `${err.path.join('.')}: ${err.message}`
      ).join('; ');
      throw new Error(`Polish instructions validation failed: ${errorMessages}`);
    }
    throw new Error(`Failed to load polish instructions: ${error}`);
  }
}

/**
 * Accurate token counting using real tokenizer
 */
function countTokens(text: string): number {
  try {
    const encoder = getTokenizer();
    return encoder.encode(text).length;
  } catch (error) {
    console.warn('Tokenizer failed, falling back to estimation:', error);
    // Fallback to word-based estimation
    return Math.ceil(text.split(/\s+/).length * 0.75);
  }
}

/**
 * Get polish instructions for a specific paper type with validation
 */
function getPolishInstructions(paperType: PaperTypeKey): PolishInstructions {
  const instructions = getValidatedInstructions();
  const polishData = instructions[paperType];
  if (!polishData) {
    throw new Error(`No polish instructions found for paper type: ${paperType}`);
  }
  return polishData;
}

/**
 * Enhanced chunking strategy using real token counts
 */
function chunkContent(sections: SectionContent[]): Array<{
  content: string;
  sectionIndices: number[];
  tokenCount: number;
}> {
  const chunks: Array<{
    content: string;
    sectionIndices: number[];
    tokenCount: number;
  }> = [];

  let currentChunk = '';
  let currentSectionIndices: number[] = [];
  let currentTokenCount = 0;

  for (let i = 0; i < sections.length; i++) {
    const section = sections[i];
    const sectionText = `## ${section.title}\n\n${section.content}\n\n`;
    const sectionTokens = countTokens(sectionText);

    // If adding this section would exceed chunk size, finalize current chunk
    if (currentTokenCount + sectionTokens > CHUNK_SIZE_TOKENS && currentChunk.length > 0) {
      chunks.push({
        content: currentChunk.trim(),
        sectionIndices: [...currentSectionIndices],
        tokenCount: currentTokenCount
      });

      // Start new chunk with overlap from previous chunk
      const overlapText = getChunkOverlap(currentChunk);
      currentChunk = overlapText + sectionText;
      currentSectionIndices = [i];
      currentTokenCount = countTokens(currentChunk);
    } else {
      currentChunk += sectionText;
      currentSectionIndices.push(i);
      currentTokenCount += sectionTokens;
    }
  }

  // Don't forget the last chunk
  if (currentChunk.length > 0) {
    chunks.push({
      content: currentChunk.trim(),
      sectionIndices: currentSectionIndices,
      tokenCount: currentTokenCount
    });
  }

  return chunks;
}

/**
 * Extract overlap text for smooth chunk transitions
 */
function getChunkOverlap(text: string): string {
  const lines = text.split('\n');
  const overlapLines = lines.slice(-10); // Last 10 lines for context
  const overlapText = overlapLines.join('\n');
  
  // Ensure we don't exceed overlap token limit
  const overlapTokens = countTokens(overlapText);
  if (overlapTokens <= CHUNK_OVERLAP_TOKENS) {
    return overlapText + '\n\n';
  }
  
  // Truncate if too long
  const words = overlapText.split(' ');
  const targetWords = Math.floor(CHUNK_OVERLAP_TOKENS * 1.33); // Approximate word count
  return words.slice(-targetWords).join(' ') + '\n\n';
}

/**
 * Common prompt building logic (DRY principle)
 */
function buildPolishPrompts(
  content: string,
  config: PolishConfig,
  instructions: PolishInstructions,
  retryImprovements?: ImprovementType[]
): { systemPrompt: string; userPrompt: string } {
  const localContext = config.localRegion 
    ? ` If relevant, give special attention to research from ${config.localRegion}` 
    : '';

  let systemPrompt = instructions.systemPrompt + localContext;
  
  if (retryImprovements && retryImprovements.length > 0) {
    systemPrompt += ` Focus specifically on these improvements: ${retryImprovements.join(', ')}.`;
  }

  const userPrompt = retryImprovements 
    ? `Please apply these specific improvements to the academic document: ${retryImprovements.join(', ')}.\n\n${content}\n\nAt the end, list improvements in format:\nIMPROVEMENTS_APPLIED: improvement1; improvement2; improvement3`
    : `Polish this academic document for ${config.paperType} in ${config.citationStyle} style:\n\n${content}\n\nAt the end, list improvements in format:\nIMPROVEMENTS_APPLIED: improvement1; improvement2; improvement3`;

  return { systemPrompt, userPrompt };
}

/**
 * Enhanced improvement parsing with multiple section handling
 */
function parseImprovements(content: string): ImprovementType[] {
  // Find all IMPROVEMENTS_APPLIED sections (handle multiple occurrences)
  const improvementSections = content.match(/IMPROVEMENTS_APPLIED:\s*([^\n]+)/gi);
  
  if (!improvementSections || improvementSections.length === 0) {
    return [];
  }

  const allImprovements = new Set<ImprovementType>();
  
  for (const section of improvementSections) {
    // Extract improvements from this section
    const improvementsText = section.replace(/IMPROVEMENTS_APPLIED:\s*/i, '');
    const improvements = improvementsText
      .split(/[;,]/)
      .map(imp => imp.trim().toLowerCase())
      .filter(imp => imp.length > 0)
      .map(imp => {
        // Map to valid ImprovementType enums
        if (imp.includes('transition')) return 'transitions';
        if (imp.includes('citation')) return 'citations';
        if (imp.includes('depth')) return 'depth';
        if (imp.includes('coherence')) return 'coherence';
        if (imp.includes('consistency')) return 'consistency';
        if (imp.includes('integration')) return 'integration';
        if (imp.includes('enhancement') || imp.includes('quality')) return 'enhancement';
        return 'enhancement'; // Default fallback
      }) as ImprovementType[];
    
    improvements.forEach(imp => allImprovements.add(imp));
  }

  return Array.from(allImprovements);
}

/**
 * Clean polished content by removing improvement markers
 */
function cleanPolishedContent(content: string): string {
  // Remove all IMPROVEMENTS_APPLIED sections while preserving content
  return content.replace(/\n\s*IMPROVEMENTS_APPLIED:\s*[^\n]+/gi, '').trim();
}

/**
 * Main polish function with enhanced error handling and progress reporting
 */
export async function performFinalPolish(
  sections: SectionContent[],
  config: PolishConfig
): Promise<PolishedDocument> {
  const startTime = Date.now();
  const maxRetries = config.maxRetries || 2;
  let retryAttempts = 0;

  try {
    // Validate inputs
    if (!sections || sections.length === 0) {
      throw new Error('No sections provided for polishing');
    }

    const instructions = getPolishInstructions(config.paperType);
    
    config.onProgress?.({
      stage: 'analyzing',
      progress: 10,
      message: 'Analyzing document structure and preparing for polish...'
    });

    // Determine processing strategy
    const useChunking = config.chunkSections || sections.length > 3 || 
                       sections.reduce((total, s) => total + countTokens(s.content), 0) > CHUNK_SIZE_TOKENS;

    let polishedContent: string;
    let chunksProcessed = 0;
    let improvementsApplied: ImprovementType[] = [];

    if (useChunking) {
      // Process in chunks
      const chunks = chunkContent(sections);
      chunksProcessed = chunks.length;
      const polishedChunks: string[] = [];

      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        
        config.onProgress?.({
          stage: 'polishing',
          progress: 20 + (i / chunks.length) * 50,
          message: `Polishing chunk ${i + 1} of ${chunks.length}...`,
          currentChunk: i + 1,
          totalChunks: chunks.length
        });

        const { systemPrompt, userPrompt } = buildPolishPrompts(
          chunk.content, 
          config, 
          instructions
        );

        const response = await generateText({
          model: ai('gpt-4o'),
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ],
          temperature: config.temperature || 0.3,
          maxTokens: config.maxTokens || MAX_OUTPUT_TOKENS
        });

        const chunkImprovements = parseImprovements(response.text);
        improvementsApplied.push(...chunkImprovements);
        polishedChunks.push(cleanPolishedContent(response.text));
      }

      polishedContent = polishedChunks.join('\n\n');
    } else {
      // Process as single document
      const combinedContent = sections
        .map(section => `## ${section.title}\n\n${section.content}`)
        .join('\n\n');

      config.onProgress?.({
        stage: 'polishing',
        progress: 40,
        message: 'Polishing complete document...'
      });

      const { systemPrompt, userPrompt } = buildPolishPrompts(
        combinedContent, 
        config, 
        instructions
      );

      const response = await generateText({
        model: ai('gpt-4o'),
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: config.temperature || 0.3,
        maxTokens: config.maxTokens || MAX_OUTPUT_TOKENS
      });

      improvementsApplied = parseImprovements(response.text);
      polishedContent = cleanPolishedContent(response.text);
      chunksProcessed = 1;
    }

    // Quality validation with retry logic
    config.onProgress?.({
      stage: 'validating',
      progress: 80,
      message: 'Validating polish quality...'
    });

    const polishedDoc: PolishedDocument = {
      content: polishedContent,
      wordCount: polishedContent.split(/\s+/).length,
      sectionsProcessed: sections.length,
      improvementsApplied: [...new Set(improvementsApplied)], // Remove duplicates
      qualityScore: 0,
      chunksProcessed,
      processingTime: Date.now() - startTime,
      retryAttempts
    };

    const validation = validatePolishQuality(polishedDoc, config.paperType);
    polishedDoc.qualityScore = validation.score;

    // Retry logic for quality improvement
    if (config.enableRetry && !validation.isValid && retryAttempts < maxRetries && validation.requiredImprovements) {
      retryAttempts++;
      
      config.onProgress?.({
        stage: 'retrying',
        progress: 85,
        message: `Applying targeted improvements (attempt ${retryAttempts}/${maxRetries})...`,
        retryAttempt: retryAttempts,
        maxRetries
      });

      // Retry with specific improvements
      const { systemPrompt, userPrompt } = buildPolishPrompts(
        polishedContent,
        config,
        instructions,
        validation.requiredImprovements
      );

      const retryResponse = await generateText({
        model: ai('gpt-4o'),
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.2, // Lower temperature for retry
        maxTokens: config.maxTokens || MAX_OUTPUT_TOKENS
      });

      const retryImprovements = parseImprovements(retryResponse.text);
      polishedDoc.content = cleanPolishedContent(retryResponse.text);
      polishedDoc.improvementsApplied.push(...retryImprovements);
      polishedDoc.retryAttempts = retryAttempts;
      
      // Re-validate
      const finalValidation = validatePolishQuality(polishedDoc, config.paperType);
      polishedDoc.qualityScore = finalValidation.score;
    }

    config.onProgress?.({
      stage: 'validating',
      progress: 100,
      message: 'Polish complete!'
    });

    return polishedDoc;

  } catch (error) {
    console.error('Polish failed:', error);
    
    // Return graceful fallback
    const fallbackContent = sections
      .map(section => `## ${section.title}\n\n${section.content}`)
      .join('\n\n');

    return {
      content: fallbackContent,
      wordCount: fallbackContent.split(/\s+/).length,
      sectionsProcessed: sections.length,
      improvementsApplied: [],
      qualityScore: 0,
      chunksProcessed: 0,
      processingTime: Date.now() - startTime,
      retryAttempts
    };
  }
}

/**
 * Enhanced quality validation with paper-type-specific thresholds
 */
export function validatePolishQuality(
  polished: PolishedDocument, 
  paperType: PaperTypeKey
): PolishValidation {
  const instructions = getPolishInstructions(paperType);
  const thresholds = instructions.qualityThresholds;
  
  const issues: string[] = [];
  const requiredImprovements: ImprovementType[] = [];
  let score = 100; // Start with perfect score and deduct

  // Word count validation
  if (thresholds.minWordCount && polished.wordCount < thresholds.minWordCount) {
    issues.push(`Document too short: ${polished.wordCount} words (minimum: ${thresholds.minWordCount})`);
    requiredImprovements.push('enhancement');
    score -= 20;
  }

  // Citation density check
  const citationCount = (polished.content.match(/\[CITE:/g) || []).length;
  const paragraphCount = polished.content.split(/\n\s*\n/).length;
  const citationDensity = paragraphCount > 0 ? citationCount / paragraphCount : 0;
  
  if (thresholds.minCitationDensity && citationDensity < thresholds.minCitationDensity) {
    issues.push(`Low citation density: ${citationDensity.toFixed(2)} per paragraph (minimum: ${thresholds.minCitationDensity})`);
    requiredImprovements.push('citations');
    score -= 15;
  }

  // Section structure validation
  if (thresholds.requiredSections) {
    const missingMandatorySections = thresholds.requiredSections.filter(
      section => !polished.content.toLowerCase().includes(section.toLowerCase())
    );
    if (missingMandatorySections.length > 0) {
      issues.push(`Missing required sections: ${missingMandatorySections.join(', ')}`);
      requiredImprovements.push('consistency');
      score -= 10 * missingMandatorySections.length;
    }
  }

  // Improvement application validation
  if (polished.improvementsApplied.length === 0) {
    issues.push('No improvements were applied during polish');
    requiredImprovements.push('enhancement');
    score -= 25;
  }

  // Depth and quality indicators
  const depthCues = ['compare', 'critique', 'analyze', 'evaluate', 'synthesize'];
  const depthCueCount = depthCues.reduce(
    (count, cue) => count + (polished.content.toLowerCase().match(new RegExp(cue, 'g')) || []).length,
    0
  );
  
  if (depthCueCount < 3) {
    issues.push('Document lacks analytical depth cues');
    requiredImprovements.push('depth');
    score -= 15;
  }

  return {
    isValid: issues.length === 0,
    issues,
    score: Math.max(0, score),
    requiredImprovements: requiredImprovements.length > 0 ? [...new Set(requiredImprovements)] : undefined
  };
}

/**
 * Legacy function for backward compatibility (deprecated)
 */
export function analyzePotentialImprovements(sections: SectionContent[]): ImprovementType[] {
  console.warn('analyzePotentialImprovements is deprecated, use validatePolishQuality instead');
  
  const improvements: ImprovementType[] = [];
  
  const combinedContent = sections.map(s => s.content).join(' ');
  const citationCount = (combinedContent.match(/\[CITE:/g) || []).length;
  const paragraphCount = combinedContent.split(/\n\s*\n/).length;
  
  if (citationCount < paragraphCount * 0.5) {
    improvements.push('citations');
  }
  
  if (sections.length > 1) {
    improvements.push('transitions');
  }
  
  return improvements;
} 