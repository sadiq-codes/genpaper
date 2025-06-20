import { loadPrompts, getPromptTemplate, validateDepthCues } from '@/lib/prompts/loader'
import type { PaperTypeKey, PaperType, SectionKey, PromptTemplate, SectionContext } from '@/lib/prompts/types'
import type { PaperWithAuthors, GenerationConfig } from '@/types/simplified'
import type { PaperChunk, TemplateVars } from './types'
import Mustache from 'mustache'

export function buildSystemPrompt(config: GenerationConfig, numProvidedPapers: number): string {
  const paperType = config?.paper_settings?.paperType || 'researchArticle';
  const length = config?.paper_settings?.length || 'medium';
  const includeMethodology = config?.paper_settings?.includeMethodology;

  // Use template-based system exclusively
  const library = loadPrompts();
  const paperTypeConfig = library.paperTypes[paperType as PaperTypeKey];
  
  if (!paperTypeConfig) {
    throw new Error(`Paper type '${paperType}' not found in prompt library. Available types: ${Object.keys(library.paperTypes).join(', ')}`);
  }

  // Get the specialized template for this paper type
  const outlineTemplate = getPromptTemplate(paperType as PaperTypeKey, 'outline');
  
  if (!outlineTemplate) {
    throw new Error(`Outline template not found for paper type '${paperType}'. Please ensure the template exists in the prompt library.`);
  }

  // Use template system with Mustache rendering for dynamic content
  const templateVars: TemplateVars = {
    numProvidedPapers,
    length,
    lengthGuidance: `${length} length paper`,
    includeMethodology,
    paperTypeName: paperTypeConfig.name,
    paperTypeDescription: paperTypeConfig.description
  };
  
  // Render the template with variables
  const baseSystemPrompt = Mustache.render(outlineTemplate.systemPrompt, templateVars);
  
  // Validate depth cues are present
  const missingCues = validateDepthCues(outlineTemplate, paperTypeConfig.depthCues || []);
  if (missingCues.length > 0) {
    console.warn(`Template for ${paperType} missing depth cues:`, missingCues);
  }
  
  // Build comprehensive system prompt with template + citation rules
  return buildTemplateBasedSystemPrompt(baseSystemPrompt, paperTypeConfig, templateVars, numProvidedPapers);
}

export function buildUserPromptWithSources(
  topic: string, 
  papers: PaperWithAuthors[], 
  chunks: PaperChunk[] = [],
  config?: GenerationConfig
): string {
  const paperType = config?.paper_settings?.paperType || 'researchArticle';

  // Use template-based user prompt exclusively
  const outlineTemplate = getPromptTemplate(paperType as PaperTypeKey, 'outline');
  
  if (!outlineTemplate) {
    throw new Error(`Outline template not found for paper type '${paperType}'. Please ensure the template exists in the prompt library.`);
  }

  if (!outlineTemplate.userPromptTemplate) {
    throw new Error(`User prompt template not found for paper type '${paperType}'. Please ensure the template includes a userPromptTemplate field.`);
  }

  // Prepare template variables for user prompt
  const papersWithMetadata = papers.map(paper => ({
    id: paper.id,
    title: paper.title,
    authors: paper.authors?.map(a => a.name) || ['Unknown'],
    year: paper.publication_date ? new Date(paper.publication_date).getFullYear() : 'Unknown',
    venue: paper.venue,
    doi: paper.doi
  }));

  // Organize chunks by paper to encourage coverage
  const chunksByPaper = new Map<string, string[]>();
  chunks.forEach(chunk => {
    if (!chunksByPaper.has(chunk.paper_id)) {
      chunksByPaper.set(chunk.paper_id, []);
    }
    chunksByPaper.get(chunk.paper_id)?.push(chunk.content.substring(0, 200));
  });

  const contextChunks = Array.from(chunksByPaper.entries())
    .map(([paperId, paperChunks]) => 
      `[${paperId}]: ${paperChunks.join(' ... ')}`
    ).join('\n\n');

  // Template variables for user prompt
  const templateVars = {
    topic,
    paperCount: papers.length,
    chunkCount: chunks.length,
    papers: JSON.stringify(papersWithMetadata, null, 2),
    context: contextChunks,
    paperType
  };

  // Render the user prompt template
  const renderedUserPrompt = Mustache.render(outlineTemplate.userPromptTemplate, templateVars);
  
  console.log(`📝 Using template-based user prompt for ${paperType}`);
  return renderedUserPrompt;
}

// Helper function to build template-based system prompts
function buildTemplateBasedSystemPrompt(
  baseSystemPrompt: string, 
  paperTypeConfig: PaperType, 
  templateVars: TemplateVars, 
  numProvidedPapers: number
): string {
  const citationRules = `🚨 CRITICAL CITATION RULES - READ CAREFULLY:
1. **ONLY USE PROVIDED PAPERS**: You have access to ${numProvidedPapers} research papers. You MUST ONLY cite these papers.
2. **NO FAKE CITATIONS**: Do NOT invent authors, dates, or papers that aren't in the provided sources
3. **NO EXTERNAL SOURCES**: Do NOT reference Smith (2020), Johnson (2019), or any other sources not explicitly provided
4. **USE TOOL FOR FOUNDATIONAL CONCEPTS**: Only use addCitation tool for widely-known foundational concepts (e.g., "machine learning", "artificial intelligence") that need basic definition citations

🛠️ CITATION METHODOLOGY:
- **For all citations**: Use addCitation tool which returns neutral [CITE:key] tokens
- **Do NOT write author-year citations yourself**: Let the renderer handle formatting
- **Example GOOD**: "AI implementation faces significant challenges [CITE:abc123]."
- **Example BAD**: "Smith (2020) argues that..." (write your own author-year text)`;

  const structureGuidance = `📝 STRUCTURE & QUALITY EXPECTATIONS:
- Follow the ${paperTypeConfig.name} format and conventions
- Begin with strong introduction defining key concepts
- Systematically review ALL provided papers
- Include ${templateVars.includeMethodology ? 'methodology section detailing research approaches found in papers' : 'discussion of research methodologies where relevant'}
- Provide critical analysis and synthesis of provided research
- Conclude with implications based on the reviewed literature

🔬 ACADEMIC RIGOR:
- Ground all claims in the provided papers
- Use precise academic language
- Maintain logical flow and coherence
- Demonstrate deep understanding of the reviewed research
- Show connections and patterns across the provided papers`;

  return `${baseSystemPrompt}

📝 ACADEMIC PAPER TYPE: ${paperTypeConfig.name}
${paperTypeConfig.description}

📏 LENGTH REQUIREMENT: ${templateVars.lengthGuidance} target

${citationRules}

${structureGuidance}

🔧 TOOL USAGE REQUIREMENT:
You MUST invoke the addCitation tool **at least three times** before you reach half of the target word count. If you have not done so, stop writing and invoke it immediately.

✅ REMEMBER: Only cite what's actually provided. Use real author names and years from the papers!`;
}

export function buildSectionSystemPrompt(
  config: GenerationConfig, 
  sectionKey: string,
  numProvidedPapers: number
): string {
  const paperType = config?.paper_settings?.paperType || 'researchArticle';
  
  // Map section keys to template keys for literature reviews
  let templateKey = sectionKey;
  if (paperType === 'literatureReview' && !['introduction', 'conclusion', 'outline'].includes(sectionKey)) {
    templateKey = 'thematicSection';
  }
  
  // Get section-specific template
  const sectionTemplate = getPromptTemplate(paperType as PaperTypeKey, templateKey as SectionKey);
  
  if (!sectionTemplate) {
    // Create a focused system prompt for this specific section
    return buildFocusedSectionPrompt(sectionKey, 'Generic Topic', [], paperType, 500);
  }
  
  const templateVars: TemplateVars = {
    numProvidedPapers,
    length: config?.paper_settings?.length || 'medium',
    lengthGuidance: `${config?.paper_settings?.length || 'medium'} length section`,
    includeMethodology: config?.paper_settings?.includeMethodology,
    paperTypeName: paperType,
    paperTypeDescription: `Section: ${sectionKey}`
  };
  
  // Render the template with variables
  const baseSystemPrompt = Mustache.render(sectionTemplate.systemPrompt, templateVars);
  
  return `${baseSystemPrompt}

🔧 CITATION INSTRUCTIONS (MANDATORY):
• For *every* fact, statistic or claim originating from a paper, CALL the addCitation tool.
• Pass the correct paper metadata (title, authors, year, doi) to the tool; it will return a neutral [CITE:key] token which you must insert verbatim.
• Do NOT write author-year citations like "(Smith, 2020)" yourself – only use the neutral tokens from the tool.
• You may cite the same paper multiple times; call the tool each time it supports a different statement.
• Aim for ≥70 % of provided papers to be cited at least once.
• Failure to call the tool will be treated as a generation error.

📝 SECTION FOCUS: ${sectionKey.toUpperCase()}
Write this section with appropriate depth and academic rigor for a ${paperType}.`;
}

export function buildFocusedSectionPrompt(
  sectionTitle: string,
  topic: string,
  contextChunks: string[],
  paperType: string,
  expectedWords: number = 1000,
  sectionFocus?: string
): string {
  const templates = loadPrompts();
  const paperTypeConfig = templates.paperTypes[paperType as keyof typeof templates.paperTypes];
  
  if (!paperTypeConfig) {
    throw new Error(`Unknown paper type: ${paperType}`);
  }

  // Determine which template to use based on paper type and section
  let templateKey: string;
  let template: PromptTemplate | undefined;

  // Map sections to appropriate templates for each paper type
  if (paperType === 'literatureReview') {
    // Literature reviews use thematic sections for main content
    if (sectionTitle.toLowerCase().includes('introduction')) {
      templateKey = 'introduction';
    } else if (sectionTitle.toLowerCase().includes('conclusion')) {
      templateKey = 'conclusion';
    } else {
      templateKey = 'thematicSection';
    }
  } else if (paperType === 'researchArticle') {
    // Research articles follow IMRaD structure
    if (sectionTitle.toLowerCase().includes('introduction')) {
      templateKey = 'introduction';
    } else if (sectionTitle.toLowerCase().includes('literature') || sectionTitle.toLowerCase().includes('review')) {
      templateKey = 'literatureReview';
    } else if (sectionTitle.toLowerCase().includes('method')) {
      templateKey = 'methodology';
    } else if (sectionTitle.toLowerCase().includes('result')) {
      templateKey = 'results';
    } else if (sectionTitle.toLowerCase().includes('discussion')) {
      templateKey = 'discussion';
    } else if (sectionTitle.toLowerCase().includes('conclusion')) {
      templateKey = 'conclusion';
    } else {
      // Default to introduction for unknown sections
      templateKey = 'introduction';
    }
  } else if (paperType === 'capstoneProject') {
    // Capstone projects have practical focus
    if (sectionTitle.toLowerCase().includes('problem') || sectionTitle.toLowerCase().includes('introduction')) {
      templateKey = 'introduction';
    } else if (sectionTitle.toLowerCase().includes('literature') || sectionTitle.toLowerCase().includes('review')) {
      templateKey = 'literatureReview';
    } else if (sectionTitle.toLowerCase().includes('solution') || sectionTitle.toLowerCase().includes('proposed')) {
      templateKey = 'proposedSolution';
    } else {
      // Default to introduction for other sections
      templateKey = 'introduction';
    }
  } else if (paperType === 'mastersThesis' || paperType === 'phdDissertation') {
    // Thesis and dissertation structure
    if (sectionTitle.toLowerCase().includes('introduction')) {
      templateKey = 'introduction';
    } else if (sectionTitle.toLowerCase().includes('literature') || sectionTitle.toLowerCase().includes('review')) {
      templateKey = 'literatureReview';
    } else if (sectionTitle.toLowerCase().includes('method')) {
      templateKey = 'methodology';
    } else {
      // Default to introduction for other sections
      templateKey = 'introduction';
    }
  } else {
    // Fallback for unknown paper types
    templateKey = 'introduction';
  }

  template = paperTypeConfig.sections[templateKey as keyof typeof paperTypeConfig.sections];
  
  if (!template) {
    // Fallback to introduction if specific template not found
    template = paperTypeConfig.sections.introduction;
  }

  if (!template) {
    throw new Error(`No template found for section type: ${templateKey} in paper type: ${paperType}`);
  }

  // Build the context string
  const contextString = contextChunks.join('\n\n');
  
  // Replace template variables
  const userPrompt = template.userPromptTemplate
    .replace(/\{\{sectionTitle\}\}/g, sectionTitle)
    .replace(/\{\{topic\}\}/g, topic)
    .replace(/\{\{contextChunks\}\}/g, contextString)
    .replace(/\{\{expectedWords\}\}/g, expectedWords.toString())
    .replace(/\{\{sectionFocus\}\}/g, sectionFocus || `specific analysis of ${sectionTitle.toLowerCase()}`);

  return `${template.systemPrompt}\n\n${userPrompt}`;
}

export function buildSectionUserPrompt(
  topic: string,
  sectionContext: SectionContext,
  papers: PaperWithAuthors[],
  config: GenerationConfig,
  previousContext: string = ''
): string {
  const paperType = config?.paper_settings?.paperType || 'researchArticle';
  
  // Map section keys to template keys for literature reviews
  let templateKey = sectionContext.sectionKey;
  if (paperType === 'literatureReview' && !['introduction', 'conclusion', 'outline'].includes(sectionContext.sectionKey)) {
    templateKey = 'thematicSection';
  }
  
  // Get section-specific template
  const sectionTemplate = getPromptTemplate(paperType as PaperTypeKey, templateKey as SectionKey);
  
  if (!sectionTemplate?.userPromptTemplate) {
    // Fallback to a generic section prompt
    return buildGenericSectionPrompt(topic, sectionContext, papers, config, previousContext);
  }
  
  // Prepare context chunks for this section
  const contextChunks = sectionContext.contextChunks
    ?.map((chunk: PaperChunk, idx: number) => `[${idx + 1}] ${chunk.content.substring(0, 300)}...`)
    .join('\n\n') || '';
  
  // Template variables for section-specific prompt
  const templateVars = {
    topic,
    sectionTitle: sectionContext.title,
    sectionFocus: `This section examines ${sectionContext.title.toLowerCase()} in the context of ${topic}`,
    expectedWords: sectionContext.expectedWords || 500,
    contextChunks,
    candidatePaperIds: sectionContext.candidatePaperIds.join(', '),
    paperCount: papers.length,
    previousContext
  };
  
  // Render the section-specific user prompt template and strip obsolete CITE placeholders
  let renderedPrompt = Mustache.render(sectionTemplate.userPromptTemplate, templateVars);
  renderedPrompt = renderedPrompt
    .replace(/\[CITE:[^\]]+\]/g, '')
    .replace(/\bCite (?:foundational|methodological|comparative|supporting)? ?sources? with.*?\.?\s*/gi, '')
    .replace(/\bWrite \d+ ?words?\.?/gi, '')
    .replace(/When citing sources, call the citation tool\./gi, '')
  
  return `${previousContext}${renderedPrompt}

📋 SECTION REQUIREMENTS:
- Write approximately ${sectionContext.expectedWords || 500} words
- Use provided context chunks and cite every factual statement by CALLING the addCitation tool
- Maintain coherent flow with previous sections
- Include critical analysis and synthesis where appropriate
- Do NOT repeat these instructions verbatim in your response
- Write in fully developed academic paragraphs (NO bullet lists or outlines)`;
}

function buildGenericSectionPrompt(
  topic: string,
  sectionContext: SectionContext,
  papers: PaperWithAuthors[],
  config: GenerationConfig,
  previousContext: string
): string {
  const contextChunks = sectionContext.contextChunks
    ?.map((chunk: PaperChunk, idx: number) => `[${idx + 1}] ${chunk.content.substring(0, 300)}...`)
    .join('\n\n') || '';
  
  return `${previousContext}Write the section "${sectionContext.title}" for a paper on "${topic}".

Use these context chunks:
${contextChunks}

Focus on papers: ${sectionContext.candidatePaperIds.join(', ')}

Requirements:
- Write approximately ${sectionContext.expectedWords || 500} words
- Cite every factual statement by CALLING the addCitation tool; you may cite the same paper multiple times across different sentences
- Maintain academic tone and rigor
- Build upon previous sections for coherent flow
- Write as continuous paragraphs, not bullet lists or outlines`;
} 