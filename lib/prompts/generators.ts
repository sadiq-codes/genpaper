import { PromptTemplate, PaperTypeKey, SectionKey, GeneratedOutline, OutlineSection, OutlineConfig, SectionContext, SectionConfig, GeneratedSection, SectionDraftingOptions } from './types';
import { buildUnifiedPrompt, SectionContext as UnifiedContext } from './unified/prompt-builder';
import { generateWithUnifiedTemplate } from '@/lib/generation/unified-generator';
import { streamText } from 'ai';
import { ai } from '@/lib/ai/vercel-client';
import { 
  performQualityCheck, 
  createReviewEvent
} from '@/lib/utils/citation-depth-checker';
import { addCitation } from '@/lib/ai/tools/addCitation';

/**
 * UNIFIED PROMPT SYSTEM
 * This file now uses the unified template approach instead of hard-coded prompts
 * All section-specific logic is handled through contextual data
 */

/**
 * Template generation options (kept for backward compatibility)
 */
export interface TemplateOptions {
  topic: string;
  paperIds?: string[];
  paperCount?: number;
  citationStyle?: 'apa' | 'mla' | 'chicago' | 'ieee';
  localRegion?: string;
  pageLength?: string;
  sectionTitle?: string;
  contextChunks?: string[];
  expectedWords?: number;
  studyDesign?: 'qualitative' | 'quantitative' | 'mixed';
  fewShot?: boolean;
}

/**
 * Generate system prompt for outline creation
 * Uses unified approach with specific outline context
 */
export function generateOutlineSystemPrompt(paperType: PaperTypeKey): string {
  return `You are an expert academic writer creating a structured outline for a ${paperType}. 

Your task is to respond with NOTHING BUT a single, valid JSON object that follows the exact structure requested in the user prompt. Do not include any explanatory text, markdown formatting, or anything before or after the JSON object.

The JSON object must contain:
1. A "paperType" field with the paper type
2. A "topic" field with the research topic
3. A "sections" array with detailed section objects

Each section object must include:
- "sectionKey": A valid section key (like "introduction", "literatureReview", "methodology", etc.)
- "title": A descriptive section title
- "expectedWords": A reasonable word count for the section
- "candidatePaperIds": An array of paper IDs relevant to this section
- "keyPoints": An array of key points or objectives for this section

Ensure the sections follow the appropriate structure for a ${paperType} and distribute the provided paper IDs appropriately across sections based on their relevance.`;
}

/**
 * Generate user prompt for outline creation
 */
export function generateOutlineUserPrompt(
  paperType: PaperTypeKey, 
  topic: string, 
  sourceIds: string[], 
  config: OutlineConfig = {}
): string {
  const jsonPrompt = `
Based on the topic '${topic}' and the provided ${sourceIds.length} papers, generate a structured plan for a '${paperType}'.

Respond with NOTHING BUT a single, valid JSON object. Do not include any explanatory text, markdown formatting, or anything before or after the JSON object.

The JSON object must follow this exact structure:
{
  "paperType": "${paperType}",
  "topic": "${topic}",
  "sections": [
    {
      "sectionKey": "introduction",
      "title": "Introduction",
      "expectedWords": 800,
      "candidatePaperIds": [${sourceIds.map(id => `"${id}"`).join(', ')}],
      "keyPoints": [
        "Establish background and significance of ${topic}",
        "Clearly state the research problem and objectives"
      ]
    },
    {
      "sectionKey": "literatureReview",
      "title": "Literature Review",
      "expectedWords": 1500,
      "candidatePaperIds": [${sourceIds.map(id => `"${id}"`).join(', ')}],
      "keyPoints": [
        "Synthesize existing research on ${topic}",
        "Identify gaps and contradictions in current knowledge"
      ]
    },
    {
      "sectionKey": "methodology",
      "title": "Methodology",
      "expectedWords": 1000,
      "candidatePaperIds": [${sourceIds.map(id => `"${id}"`).join(', ')}],
      "keyPoints": [
        "Describe research design and approach",
        "Detail data collection and analysis methods"
      ]
    },
    {
      "sectionKey": "results",
      "title": "Results",
      "expectedWords": 1200,
      "candidatePaperIds": [${sourceIds.map(id => `"${id}"`).join(', ')}],
      "keyPoints": [
        "Present key findings objectively",
        "Include relevant data and statistical analyses"
      ]
    },
    {
      "sectionKey": "discussion",
      "title": "Discussion",
      "expectedWords": 1500,
      "candidatePaperIds": [${sourceIds.map(id => `"${id}"`).join(', ')}],
      "keyPoints": [
        "Interpret results in context of existing literature",
        "Discuss limitations and implications"
      ]
    },
    {
      "sectionKey": "conclusion",
      "title": "Conclusion",
      "expectedWords": 500,
      "candidatePaperIds": [${sourceIds.map(id => `"${id}"`).join(', ')}],
      "keyPoints": [
        "Summarize key contributions and findings",
        "Suggest future research directions"
      ]
    }
  ]
}

Ensure the 'sectionKey' values match valid keys like 'introduction', 'literatureReview', 'methodology', 'results', 'discussion', 'conclusion'. Distribute the paper IDs appropriately across sections based on their relevance to each section's content needs.`;

  return jsonPrompt;
}

/**
 * DEPRECATED: Legacy prompt functions replaced by unified system
 * These functions now use the unified template under the hood for backward compatibility
 */

export function generateLiteratureReviewPrompt(
  topic: string,
  papers: string[],
  options: { fewShot?: boolean; paperType?: PaperTypeKey; localRegion?: string; expectedWords?: number; contextChunks?: string[] }
): PromptTemplate {
  console.warn('generateLiteratureReviewPrompt is deprecated. Use unified template system instead.');
  
  // Return a compatibility object that matches the old interface
  return {
    systemPrompt: "You are drafting a scholarly paper. Adopt academic tone and follow APA style.",
    userPromptTemplate: `Write the Literature Review section for '${topic}'. Target: ${options.expectedWords || 1200} words.`,
    requiredDepthCues: ["synthesis", "critical analysis", "gap identification"],
    expectedLength: {
      words: options.expectedWords || 1200,
      paragraphs: Math.ceil((options.expectedWords || 1200) / 200)
    }
  };
}

export function generateMethodologyPrompt(
  topic: string,
  papers: string[],
  options: { fewShot?: boolean; paperType?: PaperTypeKey; localRegion?: string; expectedWords?: number; contextChunks?: string[]; studyDesign?: 'qualitative' | 'quantitative' | 'mixed' }
): PromptTemplate {
  console.warn('generateMethodologyPrompt is deprecated. Use unified template system instead.');
  
  return {
    systemPrompt: "You are drafting a scholarly paper. Adopt academic tone and follow APA style.",
    userPromptTemplate: `Write the Methodology section for '${topic}'. Target: ${options.expectedWords || 1000} words.`,
    requiredDepthCues: ["replication detail", "ethical considerations", "methodological justification"],
    expectedLength: {
      words: options.expectedWords || 1000,
      paragraphs: Math.ceil((options.expectedWords || 1000) / 200)
    }
  };
}

export function generateDiscussionPrompt(paperType: PaperTypeKey, options: TemplateOptions & { fewShot?: boolean, localRegion?: string }): PromptTemplate {
  console.warn('generateDiscussionPrompt is deprecated. Use unified template system instead.');
  
  return {
    systemPrompt: "You are drafting a scholarly paper. Adopt academic tone and follow APA style.",
    userPromptTemplate: `Write the Discussion section for '${options.topic}'. Target: ${options.expectedWords || 1200} words.`,
    requiredDepthCues: ["interpretation", "comparison", "limitations", "future directions"],
    expectedLength: {
      words: options.expectedWords || 1200,
      paragraphs: Math.ceil((options.expectedWords || 1200) / 200)
    }
  };
}

/**
 * Generate section-specific prompt using unified template
 */
export function generateSectionPrompt(
  paperType: PaperTypeKey, 
  section: SectionKey, 
  options: TemplateOptions & { fewShot?: boolean }
): PromptTemplate | null {
  console.warn('generateSectionPrompt is deprecated. Use unified template system instead.');
  
  // For outline, use the specialized outline prompts
  if (section === 'outline') {
    return {
      systemPrompt: generateOutlineSystemPrompt(paperType),
      userPromptTemplate: generateOutlineUserPrompt(paperType, options.topic, options.paperIds || [], {
        citationStyle: options.citationStyle,
        localRegion: options.localRegion,
        pageLength: options.pageLength
      }),
      requiredDepthCues: getOutlineDepthCues(paperType)
    };
  }
  
  // For all other sections, return compatibility object
  return {
    systemPrompt: "You are drafting a scholarly paper. Adopt academic tone and follow APA style.",
    userPromptTemplate: `Write the ${section} section for '${options.topic}'. Target: ${options.expectedWords || 1000} words.`,
    requiredDepthCues: getDepthCuesForSection(section),
    expectedLength: {
      words: options.expectedWords || 1000,
      paragraphs: Math.ceil((options.expectedWords || 1000) / 200)
    }
  };
}

/**
 * Get depth cues for outline generation
 */
function getOutlineDepthCues(paperType: PaperTypeKey): string[] {
  switch (paperType) {
    case 'researchArticle':
      return ["methodology replication", "statistical findings", "research gap identification", "theoretical framework"];
    case 'literatureReview':
      return ["thematic organization", "critical synthesis", "gap identification", "future directions"];
    case 'capstoneProject':
      return ["problem identification", "solution justification", "local relevance", "implementation feasibility"];
    case 'mastersThesis':
      return ["comprehensive coverage", "theoretical framework", "research gap identification", "methodology justification"];
    case 'phdDissertation':
      return ["theoretical advancement", "original contribution", "exhaustive coverage", "research significance"];
    default:
      return ["structure", "organization", "clarity"];
  }
}

/**
 * Get depth cues for specific sections
 */
function getDepthCuesForSection(section: SectionKey): string[] {
  switch (section) {
    case 'literatureReview':
      return ["synthesis", "critical analysis", "gap identification", "methodology comparison"];
    case 'methodology':
      return ["replication detail", "ethical considerations", "instrument validation", "statistical procedures"];
    case 'results':
      return ["statistical precision", "objective reporting", "data visualization"];
    case 'discussion':
      return ["interpretation", "comparison", "limitations", "future directions", "theoretical implications"];
    case 'introduction':
      return ["background", "significance", "research objectives", "hypothesis"];
    case 'conclusion':
      return ["summary", "contributions", "implications", "future research"];
    default:
      return ["clarity", "coherence", "evidence support"];
  }
}

/**
 * Generate a structured outline (kept for compatibility)
 */
export async function generateOutline(
  paperType: PaperTypeKey,
  topic: string,
  sourceIds: string[],
  config: OutlineConfig = {}
): Promise<GeneratedOutline> {
  // Use existing outline generation logic as it's already well-structured
  const systemPrompt = generateOutlineSystemPrompt(paperType);
  const userPrompt = generateOutlineUserPrompt(paperType, topic, sourceIds, config);

  const { textStream } = await streamText({
    model: ai('gpt-4o'),
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ],
    temperature: config.temperature ?? 0.2,
    maxTokens: config.maxTokens ?? 2000,
  });

  let outlineText = ''
  for await (const delta of textStream) {
    outlineText += delta
  }

  const sections = parseOutlineResponse(outlineText, paperType);
  const totalEstimatedWords = sections.reduce((total, section) => 
    total + (section.expectedWords || 0), 0
  );

  return {
    paperType,
    topic,
    sections,
    totalEstimatedWords,    
    localRegion: config.localRegion
  };
}

/**
 * NEW: Generate section using unified template system
 */
export async function generateSection(
  options: SectionDraftingOptions
): Promise<GeneratedSection> {
  const { paperType, topic, sectionContext, config = {} } = options;
  
  // Convert to unified context format
  const unifiedContext: UnifiedContext = {
    projectId: `project-${Date.now()}`, // Would need actual project ID
    sectionId: `section-${Date.now()}`,
    paperType,
    sectionKey: sectionContext.sectionKey,
    availablePapers: sectionContext.candidatePaperIds,
    contextChunks: sectionContext.contextChunks
  };
  
  // Use unified generator
  const result = await generateWithUnifiedTemplate({
    context: unifiedContext,
    options: {
      targetWords: sectionContext.expectedWords || 1000,
      forceRewrite: false
    },
    enableReflection: config.fewShot || false,
    enableDriftDetection: true
  });
  
  // Convert result to legacy format
  const wordCount = result.wordCount;
  const qualityMetrics = {
    citationDensity: result.citations.length / Math.max(1, Math.floor(wordCount / 200)),
    depthCuesCovered: getDepthCuesForSection(sectionContext.sectionKey),
    missingDepthCues: []
  };
  
  // Perform quality check if needed
  const requiredDepthCues = getDepthCuesForSection(sectionContext.sectionKey);
  const enhancedQualityCheck = performQualityCheck(
    result.content, 
    requiredDepthCues,
    1 // minCitationPerPara
  );
  
  if (enhancedQualityCheck.requiresReview && config.onProgress) {
    const reviewEvent = createReviewEvent(
      sectionContext.sectionKey,
      enhancedQualityCheck,
      sectionContext.title
    );
    
    config.onProgress({
      type: 'review',
      stage: sectionContext.sectionKey,
      progress: 0,
      message: `Section quality review required: ${enhancedQualityCheck.suggestions.join(', ')}`,
      reviewData: reviewEvent
    });
  }
  
  return {
    sectionKey: sectionContext.sectionKey,
    title: sectionContext.title,
    content: result.content,
    citations: result.citations,
    wordCount: result.wordCount,
    keyPointsCovered: extractCoveredKeyPoints(result.content, sectionContext.keyPoints || []),
    qualityMetrics
  };
}

/**
 * Helper functions (kept for compatibility)
 */

function parseOutlineResponse(outlineText: string, paperType: PaperTypeKey): OutlineSection[] {
  try {
    let jsonText = outlineText.trim();
    jsonText = jsonText.replace(/```json\n?/g, '').replace(/```\n?/g, '');
    
    const jsonStart = jsonText.indexOf('{');
    const jsonEnd = jsonText.lastIndexOf('}');
    
    if (jsonStart !== -1 && jsonEnd !== -1) {
      jsonText = jsonText.substring(jsonStart, jsonEnd + 1);
    }
    
    const parsedOutline = JSON.parse(jsonText);
    
    if (!parsedOutline.sections || !Array.isArray(parsedOutline.sections)) {
      throw new Error('Invalid outline structure: missing sections array');
    }
    
    const sections: OutlineSection[] = parsedOutline.sections.map((section: any) => {
      if (!section.sectionKey || !section.title) {
        throw new Error(`Invalid section: missing sectionKey or title - ${JSON.stringify(section)}`);
      }
      
      return {
        sectionKey: section.sectionKey,
        title: section.title,
        candidatePaperIds: Array.isArray(section.candidatePaperIds) ? section.candidatePaperIds : [],
        keyPoints: Array.isArray(section.keyPoints) ? section.keyPoints : [],
        expectedWords: typeof section.expectedWords === 'number' ? section.expectedWords : 500
      };
    });
    
    return sections;
    
  } catch (error) {
    console.error('Failed to parse JSON outline:', error);
    return [];
  }
}

function extractCoveredKeyPoints(content: string, keyPoints: string[]): string[] {
  const contentLower = content.toLowerCase();
  return keyPoints.filter(point => {
    const pointKeywords = point.toLowerCase().split(/\s+/);
    const matchedKeywords = pointKeywords.filter(keyword => 
      contentLower.includes(keyword)
    );
    return matchedKeywords.length >= pointKeywords.length * 0.6;
  });
}

/**
 * Export the unified approach for new code
 */
export { buildUnifiedPrompt } from './unified/prompt-builder';
export { generateWithUnifiedTemplate } from '@/lib/generation/unified-generator';