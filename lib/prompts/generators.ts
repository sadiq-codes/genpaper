import { PromptTemplate, PaperTypeKey, SectionKey, GeneratedOutline, OutlineSection, OutlineConfig, CitationStyle } from './types';
import {
  getPromptTemplate,
  getAvailablePaperTypes,
  getAvailableSections,
  validateDepthCues
} from './loader';
import Mustache from 'mustache';

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
  
  const templateVars = {
    topic,
    paperCount: sourceIds.length,
    paperIds: sourceIds.join(', '),
    citationStyle: (config.citationStyle || 'apa').toUpperCase(),
    localRegion: config.localRegion || 'global',
    pageLength: config.pageLength ? `${config.pageLength}` : 'not specified'
  };
  
  return Mustache.render(template.userPromptTemplate, templateVars);
}

/**
 * Generate literature review section prompt
 */
export function generateLiteratureReviewPrompt(paperType: PaperTypeKey, options: TemplateOptions): PromptTemplate {
  const { topic, contextChunks = [], expectedWords = 1200, localRegion } = options;
  
  const systemPrompt = paperType === 'literatureReview' 
    ? "You are writing thematic sections of a literature review. Focus on synthesis rather than summary, highlighting agreements, contradictions, and methodological issues."
    : "You are writing a Literature Review section for a research article. Synthesize existing research, identify patterns and gaps, and critically evaluate methodologies.";

  const contextText = contextChunks.length > 0 ? `Using these context snippets: ${contextChunks.join('; ')}, ` : '';
  const localText = localRegion ? ` Emphasize ${localRegion} studies where available.` : '';
  
  let userPromptTemplate: string;
  let requiredDepthCues: string[];
  
  if (paperType === 'dissertation') {
    userPromptTemplate = `Write Chapter 2 (Literature Review) for '${topic}' ${contextText}providing exhaustive coverage and critical synthesis of findings from 50+ studies. Organize by theoretical themes, critically compare competing perspectives, critique methodological approaches, identify multiple theoretical frameworks, and develop original theoretical insights. Compare methodologies across studies.${localText} Cite with [CITE:{{paperId}}]. Conclude with theoretical model that guides your research. Write approximately ${expectedWords} words.`;
    requiredDepthCues = ["exhaustive coverage", "critical synthesis", "theoretical development", "compare", "critique", "original insights"];
  } else if (paperType === 'mastersThesis') {
    userPromptTemplate = `Write Chapter 2 (Literature Review) for '${topic}' ${contextText}providing comprehensive coverage through critical analysis of 20-30 papers, organize by themes, identify theoretical frameworks, compare methodologies, critique study designs, and clearly identify research gaps.${localText} Cite with [CITE:{{paperId}}]. End with gap statement that justifies your research. Write approximately ${expectedWords} words.`;
    requiredDepthCues = ["critical analysis", "theoretical framework", "compare", "critique", "gap identification", "comprehensive coverage"];
  } else if (paperType === 'capstoneProject') {
    userPromptTemplate = `Write the Literature Review section for '${topic}' ${contextText}focusing on 8-12 key papers that directly relate to your proposed solution. Compare methodologies and findings, use methodology comparison to highlight gaps your project will address, and cite with [CITE:{{paperId}}]. Keep it concise but comprehensive. Write approximately ${expectedWords} words.`;
    requiredDepthCues = ["compare", "gap identification", "solution relevance", "methodology comparison"];
  } else {
    userPromptTemplate = `Write the Literature Review section for '${topic}' ${contextText}organizing thematically. For each theme: synthesize at least 3 papers, compare findings across studies, critique methodologies, highlight agreements and conflicts, and critically evaluate methodological approaches to identify research gaps.${localText} Cite with [CITE:{{paperId}}]. Write approximately ${expectedWords} words.`;
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
export function generateMethodologyPrompt(paperType: PaperTypeKey, options: TemplateOptions): PromptTemplate {
  const { contextChunks = [], expectedWords = 1000, localRegion, studyDesign = 'mixed' } = options;
  
  const systemPrompt = paperType === 'mastersThesis' || paperType === 'dissertation'
    ? `You are writing a comprehensive Methodology chapter for a ${paperType}. Provide detailed research design with theoretical justification and procedures that demonstrate methodological rigor.`
    : "You are writing the Methodology section of a research article. Provide sufficient detail for replication, including study design, participants, instruments, and analysis procedures.";

  const contextText = contextChunks.length > 0 ? `Using these context snippets for technical details: ${contextChunks.join('; ')}, ` : '';
  const localText = localRegion ? ` Include ${localRegion} context considerations.` : '';
  
  const userPromptTemplate = `Write the Methodology section ${contextText}for a ${studyDesign} study with sufficient replication detail. Include: 1) Study design and theoretical justification, 2) Participants/sample selection with power analysis if quantitative, 3) Data collection instruments with validation details and instrument validation procedures, 4) Detailed procedures with replication detail, 5) Data analysis plan with specific statistical procedures, 6) Ethical considerations and IRB approval.${localText} Cite relevant protocols with [CITE:{{paperId}}]. Write approximately ${expectedWords} words.`;

  const requiredDepthCues = paperType === 'dissertation' || paperType === 'mastersThesis'
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
export function generateDiscussionPrompt(paperType: PaperTypeKey, options: TemplateOptions): PromptTemplate {
  const { topic, contextChunks = [], expectedWords = 1200, localRegion } = options;
  
  const systemPrompt = "You are writing the Discussion section. Interpret results, compare with existing literature, discuss limitations, and propose theoretical explanations. Whenever you present a finding from one paper, immediately compare it with other studies and propose explanations for differences.";

  const contextText = contextChunks.length > 0 ? `Using these context snippets: ${contextChunks.join('; ')}, ` : '';
  const localText = localRegion ? ` Out of the retrieved papers, prioritize citing any that come from ${localRegion} authors or ${localRegion} journals first. If you use a paper from outside ${localRegion}, always follow up with a sentence like, 'By comparison, a ${localRegion} study by [Author, Year] found...'` : '';
  
  const userPromptTemplate = `Write the Discussion section for '${topic}' ${contextText}interpreting the findings and comparing with existing research. Critically evaluate and critique contradictory evidence - whenever two studies disagree, propose at least two possible explanations (methodological, geographic, sample size). Discuss realistic limitations and link findings to established theoretical frameworks.${localText} Cite with [CITE:{{paperId}}]. Identify areas for future directions and future research. Write approximately ${expectedWords} words.`;

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
  options: TemplateOptions
): PromptTemplate | null {
  
  switch (section) {
    case 'literatureReview':
      return generateLiteratureReviewPrompt(paperType, options);
    
    case 'methodology':
      return generateMethodologyPrompt(paperType, options);
    
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
    case 'dissertation':
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

  // Render prompts using Mustache (for future AI SDK integration)
  Mustache.render(template.systemPrompt, templateVars);
  Mustache.render(template.userPromptTemplate, templateVars);

  // TODO: In real implementation, this would call the AI SDK
  // For now, simulate with mock response
  const outlineText = generateMockOutlineResponse(paperType);

  // Parse the outline response into structured sections
  const sections = parseOutlineResponse(outlineText, paperType);

  // Calculate total estimated words
  const totalEstimatedWords = sections.reduce((total, section) => 
    total + (section.expectedWords || 0), 0
  );

  return {
    paperType,
    topic,
    sections,
    totalEstimatedWords,
    citationStyle: (config.citationStyle || 'apa') as CitationStyle,
    localRegion: config.localRegion
  };
}

/**
 * Parse outline text response into structured sections
 * This function extracts section information from the AI-generated outline text
 */
function parseOutlineResponse(outlineText: string, paperType: PaperTypeKey): OutlineSection[] {
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
 * Generate mock outline response for testing different paper types
 * In production, this would be replaced with actual AI SDK calls
 */
function generateMockOutlineResponse(paperType: PaperTypeKey): string {
  // This would be loaded from separate mock files in testing
  const responses = {
    researchArticle: `
1. Abstract (150 words)
Paper IDs: paper-1, paper-2

2. Introduction (800 words)
Paper IDs: paper-1, paper-2, paper-3
- Research question and objectives
- Study significance and scope

3. Literature Review (1200 words)
Paper IDs: paper-1, paper-2, paper-3, paper-4, paper-5
- Current state of research
- Research gaps identified

4. Methodology (1000 words)
Paper IDs: paper-3, paper-4
- Research design and approach
- Data collection procedures

5. Results (1500 words)
Paper IDs: paper-2, paper-3
- Statistical findings
- Key outcomes

6. Discussion (1300 words)
Paper IDs: paper-1, paper-2, paper-3, paper-4, paper-5
- Interpretation of results
- Theoretical implications

7. Conclusion (600 words)
Paper IDs: paper-1, paper-2
- Summary of findings
- Future research directions
    `.trim(),

    literatureReview: `
1. Introduction (400 words)
Paper IDs: paper-1, paper-2
- Scope and purpose of review
- Significance of topic

2. Theme 1: Prevalence Studies (1000 words)
Paper IDs: paper-1, paper-2, paper-3
- Regional variation analysis
- Methodological comparison

3. Theme 2: Risk Factors (1000 words)
Paper IDs: paper-2, paper-4, paper-5
- Environmental factors
- Behavioral determinants

4. Theme 3: Intervention Strategies (1000 words)
Paper IDs: paper-3, paper-4, paper-6
- Prevention approaches
- Treatment effectiveness

5. Gaps and Future Directions (600 words)
Paper IDs: paper-1, paper-5, paper-6
- Research limitations identified
- Priority areas for investigation

6. Conclusion (400 words)
Paper IDs: paper-1, paper-2, paper-6
- Synthesis of key findings
- Implications for practice
    `.trim(),

    capstoneProject: `
1. Problem Statement (500 words)
Paper IDs: paper-1, paper-2
- Problem definition and scope
- Local context and significance

2. Literature Review (800 words)
Paper IDs: paper-1, paper-2, paper-3, paper-4
- Existing solutions analysis
- Gap identification

3. Proposed Solution (600 words)
Paper IDs: paper-2, paper-3
- Solution overview
- Technical approach

4. Implementation Plan (700 words)
Paper IDs: paper-3, paper-4
- Development phases
- Resource requirements

5. Expected Outcomes (400 words)
Paper IDs: paper-1, paper-4
- Success metrics
- Impact assessment

6. Timeline (300 words)
Paper IDs: paper-4
- Project milestones
- Deliverable schedule
    `.trim(),

    mastersThesis: `
Chapter 1: Introduction (1500 words)
Paper IDs: paper-1, paper-2, paper-3
- Research context and background
- Problem statement and objectives

Chapter 2: Literature Review (2500 words)
Paper IDs: paper-1, paper-2, paper-3, paper-4, paper-5, paper-6
- Theoretical framework development
- Comprehensive analysis of existing research

Chapter 3: Methodology (2000 words)
Paper IDs: paper-3, paper-4, paper-5
- Research design justification
- Data collection and analysis procedures

Chapter 4: Results (1800 words)
Paper IDs: paper-2, paper-3, paper-4
- Findings presentation
- Statistical analysis results

Chapter 5: Discussion (2000 words)
Paper IDs: paper-1, paper-2, paper-4, paper-5, paper-6
- Results interpretation
- Theoretical implications

Chapter 6: Conclusions (800 words)
Paper IDs: paper-1, paper-5, paper-6
- Research contributions
- Recommendations for future work
    `.trim(),

    dissertation: `
Chapter 1: Introduction (3000 words)
Paper IDs: paper-1, paper-2, paper-3, paper-4
- Comprehensive research context
- Original contribution statement

Chapter 2: Literature Review (5000 words)
Paper IDs: paper-1, paper-2, paper-3, paper-4, paper-5, paper-6, paper-7, paper-8
- Exhaustive theoretical coverage
- Multiple framework integration

Chapter 3: Theoretical Framework (2500 words)
Paper IDs: paper-2, paper-3, paper-5, paper-7
- Conceptual model development
- Theoretical propositions

Chapter 4: Methodology (3000 words)
Paper IDs: paper-4, paper-5, paper-6
- Detailed research design
- Methodological innovations

Chapter 5: Results (4000 words)
Paper IDs: paper-3, paper-4, paper-6, paper-8
- Comprehensive findings
- Advanced statistical analysis

Chapter 6: Discussion (4000 words)
Paper IDs: paper-1, paper-2, paper-3, paper-5, paper-7, paper-8
- Theoretical advancement
- Scholarly contribution analysis

Chapter 7: Conclusions and Contributions (2000 words)
Paper IDs: paper-1, paper-2, paper-7, paper-8
- Original contributions summary
- Future research agenda
    `.trim()
  };

  return responses[paperType] || responses.researchArticle;
} 