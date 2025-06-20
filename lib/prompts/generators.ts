import { PromptTemplate, PaperTypeKey, SectionKey, GeneratedOutline, OutlineSection, OutlineConfig, CitationStyle, SectionContext, SectionConfig, GeneratedSection, SectionDraftingOptions } from './types';
// Note: PolishConfig, SectionContent temporarily commented out due to tiktoken issues
// import { PolishConfig, SectionContent } from './types';
import {
  getPromptTemplate,
  getAvailablePaperTypes,
  getAvailableSections,
  validateDepthCues
} from './loader';
import { 
  getFewShotExamples, 
  formatFewShotExamples, 
  hasFewShotExamples 
} from './few-shot-examples';
// Note: final-polish import removed to avoid tiktoken issues in outline generation
// import { performFinalPolish } from './final-polish';
import Mustache from 'mustache';
import { streamText } from 'ai';
import { ai } from '@/lib/ai/vercel-client';
import { 
  performQualityCheck, 
  createReviewEvent
} from '@/lib/utils/citation-depth-checker';
import { addCitation } from '@/lib/ai/tools/addCitation';

/**
 * Template generation options
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
 */
export function generateOutlineSystemPrompt(paperType: PaperTypeKey): string {
  const template = getPromptTemplate(paperType, 'outline');
  return template?.systemPrompt || '';
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
  const template = getPromptTemplate(paperType, 'outline');
  if (!template) return '';
  
  // Override the template with a JSON-forcing prompt
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
 * Generate literature review section prompt
 */
export function generateLiteratureReviewPrompt(
  topic: string,
  papers: string[],
  options: { fewShot?: boolean; paperType?: PaperTypeKey; localRegion?: string; expectedWords?: number; contextChunks?: string[] }
): PromptTemplate {
  const { paperType = 'literatureReview', contextChunks = [], expectedWords = 1200, localRegion, fewShot = false } = options;
  
  let systemPrompt = paperType === 'literatureReview' 
    ? "You are writing thematic sections of a literature review. Focus on synthesis rather than summary, highlighting agreements, contradictions, and methodological issues."
    : "You are writing a Literature Review section for a research article. Synthesize existing research, identify patterns and gaps, and critically evaluate methodologies.";

  // Add few-shot examples if enabled and available for high-stakes paper types
  let fewShotPrefix = '';
  if (fewShot && hasFewShotExamples(paperType, 'literatureReview')) {
    const examples = getFewShotExamples(paperType, 'literatureReview', localRegion);
    fewShotPrefix = formatFewShotExamples(examples) + '\n\n';
    systemPrompt += " Write at the same level of depth and analytical sophistication as the examples provided.";
  }

  const contextText = contextChunks.length > 0 ? `Using these context snippets: ${contextChunks.join('; ')}, ` : '';
  const localText = localRegion ? ` Emphasize ${localRegion} studies where available.` : '';
  
  let userPromptTemplate: string;
  let requiredDepthCues: string[];
  
  if (paperType === 'phdDissertation') {
    userPromptTemplate = `${fewShotPrefix}Write Chapter 2 (Literature Review) for '${topic}' ${contextText}providing exhaustive coverage and critical synthesis of findings from 50+ studies. Organize by theoretical themes, critically compare competing perspectives, critique methodological approaches, identify multiple theoretical frameworks, and develop original theoretical insights. Compare methodologies across studies.${localText} Cite with [CITE:{{paperId}}]. Conclude with theoretical model that guides your research. Write approximately ${expectedWords} words.`;
    requiredDepthCues = ["exhaustive coverage", "critical synthesis", "theoretical development", "compare", "critique", "original insights"];
  } else if (paperType === 'mastersThesis') {
    userPromptTemplate = `${fewShotPrefix}Write Chapter 2 (Literature Review) for '${topic}' ${contextText}providing comprehensive coverage through critical analysis of 20-30 papers, organize by themes, identify theoretical frameworks, compare methodologies, critique study designs, and clearly identify research gaps.${localText} Cite with [CITE:{{paperId}}]. End with gap statement that justifies your research. Write approximately ${expectedWords} words.`;
    requiredDepthCues = ["critical analysis", "theoretical framework", "compare", "critique", "gap identification", "comprehensive coverage"];
  } else if (paperType === 'capstoneProject') {
    userPromptTemplate = `${fewShotPrefix}Write the Literature Review section for '${topic}' ${contextText}focusing on 8-12 key papers that directly relate to your proposed solution. Compare methodologies and findings, use methodology comparison to highlight gaps your project will address, and cite with [CITE:{{paperId}}]. Keep it concise but comprehensive. Write approximately ${expectedWords} words.`;
    requiredDepthCues = ["compare", "gap identification", "solution relevance", "methodology comparison"];
  } else {
    userPromptTemplate = `${fewShotPrefix}Write the Literature Review section for '${topic}' ${contextText}organizing thematically. For each theme: synthesize at least 3 papers, compare findings across studies, critique methodologies, highlight agreements and conflicts, and critically evaluate methodological approaches to identify research gaps.${localText} Cite with [CITE:{{paperId}}]. Write approximately ${expectedWords} words.`;
    requiredDepthCues = ["compare", "critique", "synthesis", "methodology evaluation", "gap identification"];
  }

  return {
    systemPrompt,
    userPromptTemplate,
    requiredDepthCues,
    expectedLength: {
      words: expectedWords,
      paragraphs: Math.ceil(expectedWords / 200)
    }
  };
}

/**
 * Generate methodology section prompt
 */
export function generateMethodologyPrompt(
  topic: string,
  papers: string[],
  options: { fewShot?: boolean; paperType?: PaperTypeKey; localRegion?: string; expectedWords?: number; contextChunks?: string[]; studyDesign?: 'qualitative' | 'quantitative' | 'mixed' }
): PromptTemplate {
  const { paperType = 'researchArticle', contextChunks = [], expectedWords = 1000, localRegion, studyDesign = 'mixed', fewShot = false } = options;
  
  let systemPrompt = paperType === 'mastersThesis' || paperType === 'phdDissertation'
    ? `You are writing a comprehensive Methodology chapter for a ${paperType}. Provide detailed research design with theoretical justification and procedures that demonstrate methodological rigor.`
    : "You are writing the Methodology section of a research article. Provide sufficient detail for replication, including study design, participants, instruments, and analysis procedures.";

  // Add few-shot examples if enabled and available for high-stakes paper types
  let fewShotPrefix = '';
  if (fewShot && hasFewShotExamples(paperType, 'methodology')) {
    const examples = getFewShotExamples(paperType, 'methodology', localRegion);
    fewShotPrefix = formatFewShotExamples(examples) + '\n\n';
    systemPrompt += " Write at the same level of methodological rigor and detail as the examples provided.";
  }

  const contextText = contextChunks.length > 0 ? `Using these context snippets for technical details: ${contextChunks.join('; ')}, ` : '';
  const localText = localRegion ? ` Include ${localRegion} context considerations.` : '';
  
  const userPromptTemplate = `${fewShotPrefix}Write the Methodology section ${contextText}for a ${studyDesign} study with sufficient replication detail. Include: 1) Study design and theoretical justification, 2) Participants/sample selection with power analysis if quantitative, 3) Data collection instruments with validation details and instrument validation procedures, 4) Detailed procedures with replication detail, 5) Data analysis plan with specific statistical procedures, 6) Ethical considerations and IRB approval.${localText} Cite relevant protocols with [CITE:{{paperId}}]. Write approximately ${expectedWords} words.`;

  const requiredDepthCues = paperType === 'phdDissertation' || paperType === 'mastersThesis'
    ? ["methodological justification", "replication detail", "ethical considerations", "limitations", "theoretical grounding"]
    : ["replication detail", "statistical procedures", "ethical considerations", "instrument validation"];

  return {
    systemPrompt,
    userPromptTemplate,
    requiredDepthCues,
    expectedLength: {
      words: expectedWords,
      paragraphs: Math.ceil(expectedWords / 200)
    }
  };
}

/**
 * Generate discussion section prompt with local emphasis
 */
export function generateDiscussionPrompt(paperType: PaperTypeKey, options: TemplateOptions & { fewShot?: boolean, localRegion?: string }): PromptTemplate {
  const { topic, contextChunks = [], expectedWords = 1200, localRegion, fewShot = false } = options;
  
  let systemPrompt = "You are writing the Discussion section. Interpret results, compare with existing literature, discuss limitations, and propose theoretical explanations. Whenever you present a finding from one paper, immediately compare it with other studies and propose explanations for differences.";

  // Add few-shot examples if enabled and available for high-stakes paper types
  let fewShotPrefix = '';
  if (fewShot && hasFewShotExamples(paperType, 'discussion')) {
    const examples = getFewShotExamples(paperType, 'discussion', localRegion);
    fewShotPrefix = formatFewShotExamples(examples) + '\n\n';
    systemPrompt += " Write at the same level of critical analysis and theoretical depth as the examples provided.";
  }

  const contextText = contextChunks.length > 0 ? `Using these context snippets: ${contextChunks.join('; ')}, ` : '';
  const localText = localRegion ? ` Out of the retrieved papers, prioritize citing any that come from ${localRegion} authors or ${localRegion} journals first. If you use a paper from outside ${localRegion}, always follow up with a sentence like, 'By comparison, a ${localRegion} study by [Author, Year] found...'` : '';
  
  const userPromptTemplate = `${fewShotPrefix}Write the Discussion section for '${topic}' ${contextText}interpreting the findings and comparing with existing research. Critically evaluate and critique contradictory evidence - whenever two studies disagree, propose at least two possible explanations (methodological, geographic, sample size). Discuss realistic limitations and link findings to established theoretical frameworks.${localText} Cite with [CITE:{{paperId}}]. Identify areas for future directions and future research. Write approximately ${expectedWords} words.`;

  return {
    systemPrompt,
    userPromptTemplate,
    requiredDepthCues: ["compare", "critique", "theoretical framework", "limitations", "future directions", "contradictory evidence"],
    expectedLength: {
      words: expectedWords,
      paragraphs: Math.ceil(expectedWords / 200)
    }
  };
}

/**
 * Generate section-specific prompt based on paper type and section
 */
export function generateSectionPrompt(
  paperType: PaperTypeKey, 
  section: SectionKey, 
  options: TemplateOptions & { fewShot?: boolean }
): PromptTemplate | null {
  
  switch (section) {
    case 'literatureReview':
      return generateLiteratureReviewPrompt(options.topic, options.paperIds || [], { 
        paperType, 
        fewShot: options.fewShot,
        localRegion: options.localRegion,
        expectedWords: options.expectedWords,
        contextChunks: options.contextChunks 
      });
    
    case 'methodology':
      return generateMethodologyPrompt(options.topic, options.paperIds || [], { 
        paperType, 
        fewShot: options.fewShot,
        localRegion: options.localRegion,
        expectedWords: options.expectedWords,
        contextChunks: options.contextChunks,
        studyDesign: options.studyDesign 
      });
    
    case 'discussion':
      return generateDiscussionPrompt(paperType, options);
    
    case 'outline':
      return {
        systemPrompt: generateOutlineSystemPrompt(paperType),
        userPromptTemplate: generateOutlineUserPrompt(paperType, options.topic, options.paperIds || [], {
          citationStyle: (options.citationStyle === 'ieee' ? 'apa' : options.citationStyle),
          localRegion: options.localRegion,
          pageLength: options.pageLength ? parseInt(options.pageLength) : undefined
        }),
        requiredDepthCues: getOutlineDepthCues(paperType)
      };
    
    default:
      return null;
  }
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
 * Generate a structured outline for the specified paper type and topic
 * This is the main function that orchestrates the outline generation process
 */
export async function generateOutline(
  paperType: PaperTypeKey,
  topic: string,
  sourceIds: string[],
  config: OutlineConfig = {}
): Promise<GeneratedOutline> {
  // Validate paper type against available types
  const availableTypes = getAvailablePaperTypes();
  if (!availableTypes.includes(paperType)) {
    throw new Error(`Invalid paper type: ${paperType}. Valid types are: ${availableTypes.join(', ')}`);
  }

  // Get the outline template for this paper type
  const template = getPromptTemplate(paperType, 'outline');
  if (!template) {
    throw new Error(`No outline template found for paper type: ${paperType}`);
  }

  // Validate template has required depth cues
  const missingCues = validateDepthCues(template, template.requiredDepthCues || []);
  if (missingCues.length > 0) {
    console.warn(`Outline template for ${paperType} missing depth cues:`, missingCues);
  }

  // Prepare template variables
  const templateVars = {
    topic,
    paperCount: sourceIds.length,
    paperIds: sourceIds.join(', '),
    citationStyle: (config.citationStyle || 'apa').toUpperCase(),
    localRegion: config.localRegion || 'global',
    pageLength: config.pageLength ? `${config.pageLength}` : 'not specified'
  };

  // Render prompts using Mustache
  const systemPrompt = Mustache.render(template.systemPrompt, templateVars);
  const userPrompt = Mustache.render(template.userPromptTemplate, templateVars);

  // Use the AI SDK to generate the outline from a real model call
  const { textStream } = await streamText({
    model: ai('gpt-4o'),
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ],
    temperature: config.temperature ?? 0.2,
    maxTokens: config.maxTokens ?? 2000,
  });

  // Collect the full response text
  let outlineText = ''
  for await (const delta of textStream) {
    outlineText += delta
  }

  console.log('🔍 Raw outline response:', outlineText.substring(0, 500) + '...')

  // Parse the outline response into structured sections
  const sections = parseOutlineResponse(outlineText, paperType);
  console.log(`📋 Parsed ${sections.length} sections from outline`)

  // Calculate total estimated words
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
 * Parse outline text response into structured sections
 * This function now expects JSON response instead of descriptive text
 */
function parseOutlineResponse(outlineText: string, paperType: PaperTypeKey): OutlineSection[] {
  try {
    // Clean the response to extract just the JSON part
    let jsonText = outlineText.trim();
    
    // Remove any markdown code blocks if present
    jsonText = jsonText.replace(/```json\n?/g, '').replace(/```\n?/g, '');
    
    // Try to find JSON object boundaries if there's extra text
    const jsonStart = jsonText.indexOf('{');
    const jsonEnd = jsonText.lastIndexOf('}');
    
    if (jsonStart !== -1 && jsonEnd !== -1) {
      jsonText = jsonText.substring(jsonStart, jsonEnd + 1);
    }
    
    console.log('🔍 Attempting to parse JSON outline:', jsonText.substring(0, 200) + '...');
    
    // Parse the JSON response
    const parsedOutline = JSON.parse(jsonText);
    
    if (!parsedOutline.sections || !Array.isArray(parsedOutline.sections)) {
      throw new Error('Invalid outline structure: missing sections array');
    }
    
    // Validate and transform the sections
    const sections: OutlineSection[] = parsedOutline.sections.map((section: any) => {
      if (!section.sectionKey || !section.title) {
        throw new Error(`Invalid section: missing sectionKey or title - ${JSON.stringify(section)}`);
      }
      
      return createValidOutlineSection({
        sectionKey: section.sectionKey,
        title: section.title,
        candidatePaperIds: Array.isArray(section.candidatePaperIds) ? section.candidatePaperIds : [],
        keyPoints: Array.isArray(section.keyPoints) ? section.keyPoints : [],
        expectedWords: typeof section.expectedWords === 'number' ? section.expectedWords : 500
      });
    });
    
    console.log(`📋 Successfully parsed ${sections.length} sections from JSON outline`);
    return sections;
    
  } catch (error) {
    console.error('❌ Failed to parse JSON outline, falling back to text parsing:', error);
    console.log('🔍 Raw outline text for debugging:', outlineText);
    
    // Fallback to original text parsing logic
    return parseOutlineTextFallback(outlineText, paperType);
  }
}

/**
 * Fallback text parsing function (original logic)
 */
function parseOutlineTextFallback(outlineText: string, paperType: PaperTypeKey): OutlineSection[] {
  const sections: OutlineSection[] = [];
  const lines = outlineText.split('\n').filter(line => line.trim());
  const availableSections = getAvailableSections(paperType);
  
  let currentSection: Partial<OutlineSection> | null = null;
  
  for (const line of lines) {
    const trimmedLine = line.trim();
    
    // Skip empty lines
    if (!trimmedLine) continue;
    
    // Try to match section headers
    const sectionHeader = extractSectionHeader(trimmedLine);
    
    if (sectionHeader && !trimmedLine.toLowerCase().includes('paper id')) {
      // Save previous section if exists
      if (currentSection && currentSection.title && currentSection.sectionKey) {
        sections.push(createValidOutlineSection(currentSection));
      }
      
      // Start new section
      const sectionKey = mapTitleToSectionKey(sectionHeader.title, paperType, availableSections);
      currentSection = {
        sectionKey,
        title: sectionHeader.title,
        candidatePaperIds: [],
        keyPoints: [],
        expectedWords: sectionHeader.expectedWords
      };
    } else if (currentSection) {
      // Process content for current section
      const paperIds = extractPaperIds(trimmedLine);
      if (paperIds.length > 0) {
        currentSection.candidatePaperIds = [
          ...(currentSection.candidatePaperIds || []),
          ...paperIds
        ];
      }
      
      // Extract key points (bullet points)
      if (trimmedLine.startsWith('-') || trimmedLine.startsWith('•')) {
        const keyPoint = trimmedLine.replace(/^[-•]\s*/, '').trim();
        if (keyPoint) {
          currentSection.keyPoints = [
            ...(currentSection.keyPoints || []),
            keyPoint
          ];
        }
      }
    }
  }
  
  // Don't forget the last section
  if (currentSection && currentSection.title && currentSection.sectionKey) {
    sections.push(createValidOutlineSection(currentSection));
  }
  
  return sections;
}

/**
 * Extract section header information from a line
 */
function extractSectionHeader(line: string): { title: string; expectedWords?: number } | null {
  // Try numbered format first (1. Title)
  const numberedMatch = line.match(/^(\d+)\.\s*([^(]+?)(?:\s*\((\d+)\s*words?\))?$/i);
  if (numberedMatch) {
    return {
      title: numberedMatch[2].trim(),
      expectedWords: numberedMatch[3] ? parseInt(numberedMatch[3]) : undefined
    };
  }
  
  // Try chapter format (Chapter 1: Title)
  const chapterMatch = line.match(/^chapter\s+(\d+):\s*([^(]+?)(?:\s*\((\d+)\s*words?\))?$/i);
  if (chapterMatch) {
    return {
      title: chapterMatch[2].trim(),
      expectedWords: chapterMatch[3] ? parseInt(chapterMatch[3]) : undefined
    };
  }

  // Try markdown header format (## Title or ### Title)
  const markdownMatch = line.match(/^#{2,4}\s*([^(]+?)(?:\s*\((\d+)\s*words?\))?$/i);
  if (markdownMatch) {
    return {
      title: markdownMatch[1].trim(),
      expectedWords: markdownMatch[2] ? parseInt(markdownMatch[2]) : undefined
    };
  }

  // Try bold format (**Title**)
  const boldMatch = line.match(/^\*\*([^*]+)\*\*(?:\s*\((\d+)\s*words?\))?$/i);
  if (boldMatch) {
    return {
      title: boldMatch[1].trim(),
      expectedWords: boldMatch[2] ? parseInt(boldMatch[2]) : undefined
    };
  }

  // Try simple colon format (Title:)
  const colonMatch = line.match(/^([^:]+):(?:\s*\((\d+)\s*words?\))?$/i);
  if (colonMatch && colonMatch[1].trim().length > 3) {
    return {
      title: colonMatch[1].trim(),
      expectedWords: colonMatch[2] ? parseInt(colonMatch[2]) : undefined
    };
  }

  // Try section keywords at start of line
  const sectionKeywords = ['abstract', 'introduction', 'literature review', 'methodology', 'methods', 'results', 'discussion', 'conclusion', 'conclusions', 'background', 'analysis'];
  const lowerLine = line.toLowerCase().trim();
  
  for (const keyword of sectionKeywords) {
    if (lowerLine.startsWith(keyword) && lowerLine.length < 50) { // Avoid matching content lines
      const wordMatch = line.match(/\((\d+)\s*words?\)/i);
      return {
        title: line.replace(/\((\d+)\s*words?\)/i, '').trim(),
        expectedWords: wordMatch ? parseInt(wordMatch[1]) : undefined
      };
    }
  }
  
  return null;
}

/**
 * Map section title to appropriate section key using schema
 */
function mapTitleToSectionKey(
  title: string, 
  paperType: PaperTypeKey, 
  availableSections: SectionKey[]
): SectionKey {
  const lowerTitle = title.toLowerCase();
  
  // Create mapping based on common patterns
  const sectionMappings: Record<string, SectionKey[]> = {
    'introduction': ['introduction'],
    'abstract': ['abstract'],
    'literature review': ['literatureReview'],
    'lit review': ['literatureReview'],
    'review': ['literatureReview'],
    'method': ['methodology'],
    'methodology': ['methodology'],
    'results': ['results'],
    'findings': ['results'],
    'discussion': ['discussion'],
    'conclusion': ['conclusion'],
    'conclusions': ['conclusion'],
    'problem statement': ['introduction'],
    'background': ['introduction'],
    'theoretical framework': ['literatureReview'],
    'analysis': ['results']
  };
  
  // Find best match
  for (const [pattern, candidates] of Object.entries(sectionMappings)) {
    if (lowerTitle.includes(pattern)) {
      const match = candidates.find(candidate => availableSections.includes(candidate));
      if (match) return match;
    }
  }
  
  // Default to first available section
  return availableSections[0] || 'introduction';
}

/**
 * Extract paper IDs from text line
 */
function extractPaperIds(line: string): string[] {
  const paperIds: string[] = [];
  
  // Extract UUIDs
  const uuidMatches = line.match(/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/gi);
  if (uuidMatches) {
    paperIds.push(...uuidMatches);
  }
  
  // Extract simple paper IDs like paper-1, paper-2
  const simpleIds = line.match(/paper-\d+/gi);
  if (simpleIds) {
    paperIds.push(...simpleIds);
  }
  
  // Extract paper IDs after "Paper IDs:" pattern
  const labeledPattern = /(?:Paper\s+ID|ID|UUID)s?:\s*([a-zA-Z0-9-_,\s]+)/gi;
  let match;
  while ((match = labeledPattern.exec(line)) !== null) {
    const idList = match[1];
    if (idList) {
      const ids = idList
        .split(/[,\s]+/)
        .map((id: string) => id.trim())
        .filter((id: string) => id.length > 0 && (
          /^[a-f0-9-]{36}$/i.test(id) || // UUID format
          /^paper-\d+$/i.test(id)       // Simple format
        ));
      paperIds.push(...ids);
    }
  }
  
  // Reset regex state
  labeledPattern.lastIndex = 0;
  
  return [...new Set(paperIds)]; // Remove duplicates
}

/**
 * Create a valid OutlineSection from partial data
 */
function createValidOutlineSection(section: Partial<OutlineSection>): OutlineSection {
  return {
    sectionKey: section.sectionKey!,
    title: section.title!,
    candidatePaperIds: section.candidatePaperIds || [],
    keyPoints: section.keyPoints || [],
    expectedWords: section.expectedWords
  };
}

/**
 * TASK 4: Section Drafting Module
 * Generate a single section with focused RAG context and return structured results
 */
export async function generateSection(
  options: SectionDraftingOptions
): Promise<GeneratedSection> {
  const { paperType, topic, sectionContext, config = {} } = options;
  
  // Validate inputs
  if (!getAvailablePaperTypes().includes(paperType)) {
    throw new Error(`Invalid paper type: ${paperType}`);
  }
  
  const availableSections = getAvailableSections(paperType);
  if (!availableSections.includes(sectionContext.sectionKey)) {
    throw new Error(`Section ${sectionContext.sectionKey} not available for paper type ${paperType}`);
  }
  
  // Check if we should use the new few-shot enabled prompt generators
  let systemPrompt: string;
  let userPrompt: string;
  let requiredDepthCues: string[];
  
  // Prepare template variables used in both few-shot and regular paths
  const templateVars = {
    topic,
    sectionTitle: sectionContext.title,
    paperCount: sectionContext.candidatePaperIds.length,
    paperIds: sectionContext.candidatePaperIds.join(', '),
    contextSnippets: sectionContext.contextChunks.map((chunk, idx) => 
      `(${idx + 1}) ${chunk.content.substring(0, 200)}...`
    ).join('\n'),
    expectedWords: sectionContext.expectedWords || 600,
    keyPoints: sectionContext.keyPoints?.join('\n• ') || '',
    citationStyle: config.citationStyle || 'apa',
    localRegion: config.localRegion || 'global',
    studyDesign: config.studyDesign || 'mixed'
  };

  if (config.fewShot && (paperType === 'mastersThesis' || paperType === 'phdDissertation')) {
    // Use few-shot enabled prompt generators for high-stakes paper types
    const templateOptions = {
      topic,
      contextChunks: sectionContext.contextChunks.map(chunk => chunk.content),
      expectedWords: sectionContext.expectedWords || 600,
      localRegion: config.localRegion,
      studyDesign: config.studyDesign,
      fewShot: true
    };
    
    const fewShotTemplate = generateSectionPrompt(paperType, sectionContext.sectionKey, templateOptions);
    if (fewShotTemplate) {
      systemPrompt = fewShotTemplate.systemPrompt;
      // BUG FIX: Render the user prompt template with Mustache
      userPrompt = Mustache.render(fewShotTemplate.userPromptTemplate, templateVars);
      requiredDepthCues = fewShotTemplate.requiredDepthCues;
    } else {
      // Fallback to regular template if few-shot template generation fails
      const template = getPromptTemplate(paperType, sectionContext.sectionKey);
      if (!template) {
        throw new Error(`No template found for ${paperType}.${sectionContext.sectionKey}`);
      }
      
      systemPrompt = Mustache.render(template.systemPrompt, templateVars);
      userPrompt = Mustache.render(template.userPromptTemplate, templateVars);
      requiredDepthCues = template.requiredDepthCues;
    }
  } else {
    // Use regular template system
    const template = getPromptTemplate(paperType, sectionContext.sectionKey);
    if (!template) {
      throw new Error(`No template found for ${paperType}.${sectionContext.sectionKey}`);
    }
  
    // Render the prompts with Mustache
    systemPrompt = Mustache.render(template.systemPrompt, templateVars);
    userPrompt = Mustache.render(template.userPromptTemplate, templateVars);
    requiredDepthCues = template.requiredDepthCues;
  }
  
  let content: string;
  
  try {
    // Check if we're in test environment (Node.js without real API keys)
    const isTestEnvironment = process.env.NODE_ENV === 'test' || 
                              typeof process !== 'undefined' && process.env.VITEST;
    
    if (isTestEnvironment) {
      // Generate mock content for testing
      content = generateMockSectionContent(sectionContext, templateVars);
    } else {
      // Generate the section content using AI SDK
      const response = await streamText({
        model: ai('gpt-4o'),
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        tools: { addCitation },
        toolChoice: 'auto',
        maxSteps: 5,
        temperature: config.temperature || 0.3,
        maxTokens: config.maxTokens || 2000
      });
      
      // Collect text deltas (ignore tool events here – they persist via the tool itself)
      content = ''
      for await (const delta of response.fullStream) {
        if (delta.type === 'text-delta') content += delta.textDelta
      }
      content = content.trim()
    }
    
    if (!content) {
      throw new Error(`LLM returned empty content for section: ${sectionContext.sectionKey}`);
    }
    
    // Extract citations from the generated content
    const citations = extractCitationsFromContent(content, sectionContext.candidatePaperIds);
    
    // Calculate quality metrics using the enhanced checker
    const qualityMetrics = calculateSectionQuality(content, requiredDepthCues);
    
    // Perform enhanced quality check for Task 7
    const enhancedQualityCheck = performQualityCheck(
      content, 
      requiredDepthCues,
      1 // minCitationPerPara
    );
    
    // Emit review event if quality check fails
    if (enhancedQualityCheck.requiresReview) {
      const reviewEvent = createReviewEvent(
        sectionContext.sectionKey,
        enhancedQualityCheck,
        sectionContext.title
      );
      
      // Emit the review event if progress callback is available
      if (config.onProgress) {
        config.onProgress({
          type: 'review',
          stage: sectionContext.sectionKey,
          progress: 0, // Will be set by caller
          message: `Section quality review required: ${enhancedQualityCheck.suggestions.join(', ')}`,
          reviewData: reviewEvent
        });
      }
    }
    
    // Count words
    const wordCount = content.split(/\s+/).filter(word => word.length > 0).length;
    
    // Enforce word count from template
    if (sectionContext.expectedWords) {
      const lowerBound = sectionContext.expectedWords * 0.75;
      const upperBound = sectionContext.expectedWords * 1.5;
      if (wordCount < lowerBound || wordCount > upperBound) {
        throw new Error(`Generated section has ${wordCount} words, but expected ~${sectionContext.expectedWords}.`);
      }
    }
    
    return {
      sectionKey: sectionContext.sectionKey,
      title: sectionContext.title,
      content,
      citations,
      wordCount,
      keyPointsCovered: extractCoveredKeyPoints(content, sectionContext.keyPoints || []),
      qualityMetrics
    };
    
  } catch (error) {
    throw new Error(`Failed to generate section ${sectionContext.sectionKey}: ${error}`);
  }
}

/**
 * Generate mock section content for testing
 */
function generateMockSectionContent(
  sectionContext: SectionContext,
  templateVars: Record<string, string | number>
): string {
  const { sectionKey, title, candidatePaperIds, contextChunks, keyPoints } = sectionContext;
  
  // Base content based on section type
  const sectionContent: Record<string, string> = {
    introduction: `## ${title}

The field of ${templateVars.topic} has gained significant attention in recent years due to its importance in addressing global challenges. This section provides an overview of the current state of research and establishes the foundation for this study.

Research in this area has shown promising developments [CITE:${candidatePaperIds[0] || 'paper-1'}]. Several key studies have contributed to our understanding of the underlying mechanisms and practical applications [CITE:${candidatePaperIds[1] || 'paper-2'}].

The significance of this research cannot be overstated, particularly in the context of ${templateVars.localRegion || 'global'} perspectives. Current literature highlights both opportunities and challenges that warrant further investigation [CITE:${candidatePaperIds[2] || 'paper-3'}].`,

    literatureReview: `## ${title}

This literature review synthesizes current research on ${templateVars.topic}, examining key findings and identifying gaps in the existing knowledge base.

### Current State of Research

Recent studies have demonstrated significant progress in understanding the complexities of this field [CITE:${candidatePaperIds[0] || 'paper-1'}]. The research community has focused on several key areas, including theoretical frameworks and practical applications.

${contextChunks.map((chunk) => 
  `A notable study by researchers found that ${chunk.content.substring(0, 150)}... [CITE:${chunk.paper_id}]. This finding builds upon earlier work and provides important insights.`
).join('\n\n')}

### Critical Analysis

While the field has made substantial progress, several limitations remain. Methodological differences across studies make direct comparisons challenging [CITE:${candidatePaperIds[1] || 'paper-2'}]. Furthermore, geographic variations in research focus suggest the need for more comprehensive, globally representative studies.

### Research Gaps

The literature reveals several key gaps that this study aims to address. These include limited longitudinal data, insufficient representation of ${templateVars.localRegion || 'diverse'} populations, and the need for more robust theoretical frameworks [CITE:${candidatePaperIds[2] || 'paper-3'}].`,

    methodology: `## ${title}

This section outlines the research methodology employed in this ${templateVars.studyDesign || 'mixed-methods'} study, providing sufficient detail for replication and evaluation of the research approach.

### Research Design

The study employed a ${templateVars.studyDesign || 'mixed-methods'} approach to investigate ${templateVars.topic}. This design was chosen to capture both quantitative patterns and qualitative insights [CITE:${candidatePaperIds[0] || 'paper-1'}].

### Participants and Sampling

The research involved a carefully selected sample representative of the target population. Inclusion criteria included relevant demographic characteristics and availability for the study duration [CITE:${candidatePaperIds[1] || 'paper-2'}].

### Data Collection Procedures

Data collection followed established protocols to ensure consistency and reliability. Multiple measurement points were utilized to capture temporal variations and improve the validity of findings [CITE:${candidatePaperIds[2] || 'paper-3'}].

### Analytical Approach

The analytical strategy combined descriptive and inferential statistical methods. Qualitative data was analyzed using thematic analysis to identify key patterns and themes relevant to the research questions.`,

    results: `## ${title}

This section presents the key findings from the research, organized by primary research questions and hypotheses.

### Primary Findings

The analysis revealed several significant patterns in the data. Statistical analysis showed meaningful relationships between key variables (p < 0.05) [CITE:${candidatePaperIds[0] || 'paper-1'}].

### Quantitative Results

Descriptive statistics indicated that the majority of participants (78%) demonstrated the expected patterns. Regression analysis revealed that several factors significantly predicted outcomes [CITE:${candidatePaperIds[1] || 'paper-2'}].

### Qualitative Insights

Thematic analysis of qualitative data identified three major themes: adaptation strategies, challenges encountered, and success factors. These themes provide important context for interpreting the quantitative findings [CITE:${candidatePaperIds[2] || 'paper-3'}].`,

    discussion: `## ${title}

This section interprets the study findings in the context of existing literature and discusses their implications for theory and practice.

### Interpretation of Findings

The results align with previous research while also revealing novel insights [CITE:${candidatePaperIds[0] || 'paper-1'}]. The observed patterns suggest that current theoretical models may need refinement to account for these new discoveries.

### Comparison with Existing Literature

These findings both confirm and extend prior research. While some results align with established patterns [CITE:${candidatePaperIds[1] || 'paper-2'}], others suggest the need for reconsidering certain assumptions in the field.

### Practical Implications

The research has several important practical applications, particularly for ${templateVars.localRegion || 'global'} contexts. These findings suggest specific strategies that practitioners and policymakers should consider [CITE:${candidatePaperIds[2] || 'paper-3'}].

### Limitations

Several limitations should be considered when interpreting these results. Sample size constraints and temporal limitations may affect generalizability. Future research should address these methodological considerations.`,

    conclusion: `## ${title}

This study has contributed important insights to the field of ${templateVars.topic}, with implications for both theory and practice.

### Summary of Key Findings

The research identified several significant patterns and relationships that advance our understanding of this complex phenomenon [CITE:${candidatePaperIds[0] || 'paper-1'}]. These findings provide a foundation for future research and practical applications.

### Theoretical Contributions

This work extends existing theoretical frameworks by incorporating new empirical evidence. The findings suggest refinements to current models that could improve their explanatory power [CITE:${candidatePaperIds[1] || 'paper-2'}].

### Future Research Directions

Several promising avenues for future research emerge from this study. Longitudinal investigations and cross-cultural comparisons would enhance our understanding of the phenomena studied [CITE:${candidatePaperIds[2] || 'paper-3'}].

### Final Remarks

This research represents an important step forward in understanding ${templateVars.topic}. The findings have immediate practical applications while also opening new theoretical questions for future investigation.`,

    abstract: `## ${title}

**Background:** Research on ${templateVars.topic} has gained increasing attention due to its significance in addressing contemporary challenges.

**Objective:** This study aimed to investigate key aspects of ${templateVars.topic} with particular focus on ${templateVars.localRegion || 'global'} perspectives.

**Methods:** A ${templateVars.studyDesign || 'mixed-methods'} approach was employed, utilizing both quantitative and qualitative data collection methods [CITE:${candidatePaperIds[0] || 'paper-1'}].

**Results:** The analysis revealed significant patterns and relationships. Key findings include important insights that advance theoretical understanding and practical applications [CITE:${candidatePaperIds[1] || 'paper-2'}].

**Conclusions:** This research contributes to the field by providing new empirical evidence and theoretical insights. The findings have important implications for future research and practice [CITE:${candidatePaperIds[2] || 'paper-3'}].

**Keywords:** ${templateVars.topic}, research methodology, empirical analysis`
  };
  
  // Get base content or default
  let baseContent = sectionContent[sectionKey] || sectionContent.introduction;
  
  // Add key points if provided
  if (keyPoints && keyPoints.length > 0) {
    baseContent += `\n\n### Key Points Addressed\n\n• ${keyPoints.join('\n• ')}`;
  }
  
  return baseContent;
}

/**
 * Batch generate multiple sections for a complete paper
 */
export async function generateMultipleSections(
  paperType: PaperTypeKey,
  topic: string,
  sectionContexts: SectionContext[],
  config?: SectionConfig
): Promise<GeneratedSection[]> {
  const sections: GeneratedSection[] = [];
  
  for (const sectionContext of sectionContexts) {
    try {
      const section = await generateSection({
        paperType,
        topic,
        sectionContext,
        config
      });
      sections.push(section);
    } catch (error) {
      console.warn(`Section ${sectionContext.sectionKey} failed, retrying with higher temperature...`, error);
      try {
        const section = await generateSection({
          paperType,
          topic,
          sectionContext,
          config: { ...config, temperature: 0.6 }
        });
        sections.push(section);
      } catch (retryError) {
        console.error(`Failed to generate section ${sectionContext.sectionKey} after retry:`, retryError);
        // Continue with other sections even if one fails
      }
    }
  }
  
  return sections;
}



/**
 * Helper function to collect full response from streaming
 */
/* eslint-disable @typescript-eslint/no-unused-vars -- kept for future debug utilities */
async function collectFullResponse(response: { textStream: AsyncIterable<string> }): Promise<string> {
  let fullContent = '';
  for await (const chunk of response.textStream) {
    fullContent += chunk;
  }
  return fullContent.trim();
}
/* eslint-enable @typescript-eslint/no-unused-vars */

/**
 * Extract citations from generated content
 */
function extractCitationsFromContent(
  content: string,
  validPaperIds: string[]
): Array<{ paperId: string; citationText: string; positionStart?: number; positionEnd?: number }> {
  const citations: Array<{ paperId: string; citationText: string; positionStart?: number; positionEnd?: number }> = [];
  const citationRegex = /\[CITE:\s*([a-zA-Z0-9_-]{3,})\]/gi;
  
  let match;
  while ((match = citationRegex.exec(content)) !== null) {
    const paperId = match[1];
    
    // Only include citations for valid paper IDs
    if (validPaperIds.includes(paperId)) {
      citations.push({
        paperId,
        citationText: match[0],
        positionStart: match.index,
        positionEnd: match.index + match[0].length
      });
    }
  }
  
  return citations;
}

/**
 * Calculate quality metrics for the generated section
 */
function calculateSectionQuality(
  content: string,
  requiredDepthCues: string[]
): {
  citationDensity: number;
  depthCuesCovered: string[];
  missingDepthCues: string[];
} {
  // Calculate citation density (citations per paragraph)
  const paragraphs = content.split(/\n\s*\n/).filter(p => p.trim().length > 0);
  const citations = content.match(/\[CITE:\s*([a-zA-Z0-9_-]{3,})\]/gi) || [];
  const citationDensity = paragraphs.length > 0 ? citations.length / paragraphs.length : 0;
  
  // Check which depth cues are covered
  const contentLower = content.toLowerCase();
  const depthCuesCovered = requiredDepthCues.filter(cue => 
    contentLower.includes(cue.toLowerCase())
  );
  const missingDepthCues = requiredDepthCues.filter(cue => 
    !contentLower.includes(cue.toLowerCase())
  );
  
  return {
    citationDensity,
    depthCuesCovered,
    missingDepthCues
  };
}

/**
 * Extract which key points were covered in the content
 */
function extractCoveredKeyPoints(content: string, keyPoints: string[]): string[] {
  const contentLower = content.toLowerCase();
  return keyPoints.filter(point => {
    const pointKeywords = point.toLowerCase().split(/\s+/);
    // Check if at least 60% of keywords from the key point appear in content
    const matchedKeywords = pointKeywords.filter(keyword => 
      contentLower.includes(keyword)
    );
    return matchedKeywords.length >= pointKeywords.length * 0.6;
  });
}