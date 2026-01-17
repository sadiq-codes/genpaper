import type { PaperTypeKey } from './types';
import type { PaperProfile } from '@/lib/generation/paper-profile-types';
import { getLanguageModel } from '@/lib/ai/vercel-client';
import { buildProfileGuidanceForPrompt } from '@/lib/generation/paper-profile';
import { generateObject } from 'ai';
import { z } from 'zod';

// Constants for consistent fallbacks
export const DEFAULT_QUALITY_CRITERIA = [
  'evidence-based reasoning', 
  'logical coherence', 
  'scholarly depth'
] as const;

// Zod schema for quality criteria response
const QualityCriteriaSchema = z.object({
  criteria: z.array(z.string().min(3).max(80))
    .min(1)
    .max(5)
    .describe('Array of 3-5 quality criteria strings specific to this discipline and section type')
});

interface OutlineSection {
  sectionKey: string;
  title: string;
  expectedWords: number;
  candidatePaperIds: string[];
  keyPoints: string[];
}

interface GeneratedOutline {
  sections: OutlineSection[];
}

/**
 * Generate system prompt for outline creation
 * Note: Specific section requirements are now profile-driven, not hardcoded here
 */
export function generateOutlineSystemPrompt(paperType: PaperTypeKey, hasOriginalResearch: boolean = false): string {
  const basePrompt = `You are an expert academic writer creating a research outline for a ${paperType}. Your task is to organize research into DISTINCT sections following academic structure, ensuring each section has a unique purpose and avoids repetition.

Focus on creating a clear, logical structure that:
1. Follows standard academic organization for this type of paper
2. Maintains clear section boundaries
3. Distributes content appropriately
4. Avoids redundancy between sections

CRITICAL: If a PAPER PROFILE is provided in the user prompt, you MUST follow its constraints exactly:
- Use ONLY the sections listed in the MANDATORY STRUCTURE
- NEVER create sections listed in FORBIDDEN SECTIONS
- Respect all GENRE RULES provided

The paper profile is determined by analyzing the topic, paper type, and discipline - it contains context-aware requirements that override any generic assumptions.`

  if (hasOriginalResearch) {
    return `${basePrompt}

NOTE: This paper presents ORIGINAL RESEARCH with data collection. The paper profile will specify the appropriate empirical sections (methodology, results, etc.) - follow those specifications exactly.

The Results section presents the author's original data - do NOT cite external sources for original findings.

Format your response as a valid JSON object following the schema shown in the user prompt.`
  }

  return `${basePrompt}

Format your response as a valid JSON object following the schema shown in the user prompt.`
}

export interface OriginalResearchInput {
  researchQuestion?: string
  keyFindings?: string
}

// NOTE: buildOutlineProfileGuidance has been consolidated into buildProfileGuidanceForPrompt
// in paper-profile.ts. Use buildProfileGuidanceForPrompt(profile, 'outline') for outline generation.

/**
 * Generate user prompt for outline creation - FINAL FIX with paper assignment
 */
export function generateOutlineUserPrompt(
  paperType: PaperTypeKey, 
  topic: string,
  sourcePaperIds: string[] = [],
  originalResearch?: OriginalResearchInput,
  profileGuidance?: string
): string {
  const paperIdsList = sourcePaperIds.length > 0 
    ? `AVAILABLE SOURCE PAPER IDs:
[${sourcePaperIds.map(id => `"${id}"`).join(', ')}]

You MUST distribute these paper IDs among the sections you create, assigning each paper to the section(s) where it is most relevant. Each paper can be assigned to multiple sections if appropriate.`
    : 'No source papers are available for this outline.'

  // Original research context - provides the research question and findings but does NOT prescribe sections
  // The paper profile will determine appropriate sections based on discipline and context
  const originalResearchBlock = originalResearch?.researchQuestion ? `
ORIGINAL RESEARCH CONTEXT:
This paper presents ORIGINAL RESEARCH. You must incorporate:

Research Question: "${originalResearch.researchQuestion}"
${originalResearch.keyFindings ? `Key Findings to Present: "${originalResearch.keyFindings}"` : ''}

The paper profile below specifies which sections are appropriate for presenting this original research.
For Results/Findings sections: present YOUR data without external citations.
For Methodology sections: describe YOUR procedures (only cite external sources for established methods you reference).
` : ''

  // If profile guidance is provided, emphasize it as the primary constraint
  const profileBlock = profileGuidance ? `
${profileGuidance}

CRITICAL INSTRUCTION:
The PAPER PROFILE above is your PRIMARY constraint. You MUST:
1. Create sections ONLY from the MANDATORY STRUCTURE list
2. NEVER create sections from the FORBIDDEN SECTIONS list
3. Follow ALL GENRE RULES exactly

If the profile says a section type is forbidden, DO NOT CREATE IT regardless of what seems "standard".
The profile is context-aware and knows what is appropriate for this specific paper type and discipline.
` : ''

  return `You are an expert academic writer specializing in the field relevant to the topic: "${topic}". 
Your task is to generate a logical and conventional outline for a ${paperType}.

${paperIdsList}
${originalResearchBlock}
${profileBlock}

Respond with NOTHING BUT a single, valid JSON object.

The JSON object must contain a "sections" array. Each object in the array must have the following keys:
* sectionKey: A camelCase identifier for the section (use keys from the MANDATORY STRUCTURE if a profile is provided)
* title: A descriptive title for the section
* expectedWords: Your estimated word count for this section (use ranges from the profile if provided)
* keyPoints: An array of key objectives or questions this section should address
* candidatePaperIds: An array of the MOST RELEVANT paper IDs for this section (MAXIMUM 10-15 papers per section)
* disciplineContext: A brief explanation of why this section is important in this specific field/discipline

CRITICAL CONSTRAINT FOR candidatePaperIds:
- Include ONLY the 10-15 MOST relevant papers per section
- Do NOT include all available papers - be selective
- Choose papers that best support the section's key points
- Quality over quantity - fewer, highly relevant papers are better than many loosely related ones

IMPORTANT: If a PAPER PROFILE was provided above, your outline MUST match its structure exactly.
Do not add sections that are not in the MANDATORY STRUCTURE.
Do not create ANY section that appears in the FORBIDDEN SECTIONS list.

Your response must be valid JSON that matches this TypeScript type:
{
  sections: Array<{
    sectionKey: string;
    title: string;
    expectedWords: number;
    keyPoints: string[];
    candidatePaperIds: string[];  // MAX 15 papers per section
    disciplineContext: string;
  }>
}`
}

/**
 * Generate discipline-specific quality criteria for a section
 * This replaces the hardcoded getDepthCuesForSection function
 * 
 * Uses Zod schema with generateObject for type-safe structured output.
 * 
 * @param topic - The research topic (e.g., "Machine Learning in Healthcare")
 * @param sectionTitle - The section being planned (e.g., "Introduction", "Methodology")
 * @param paperType - Type of academic paper (researchArticle, review, etc.)
 * @param disciplineContext - Optional context about the academic discipline
 * @returns Array of 3-5 quality criteria strings, or DEFAULT_QUALITY_CRITERIA on failure
 * 
 * @example
 * ```ts
 * const criteria = await generateQualityCriteria(
 *   "Fungal Contaminants in Tomato Spoilage", 
 *   "Methodology", 
 *   "researchArticle"
 * );
 * // Returns: ["statistical rigor", "reproducibility", "sample validity"]
 * ```
 * 
 * @throws Never throws - always returns valid array via fallback mechanisms
 */
export async function generateQualityCriteria(
  topic: string,
  sectionTitle: string,
  paperType: PaperTypeKey,
  disciplineContext?: string
): Promise<string[]> {
  const contextInfo = disciplineContext ? `\n\nContext: ${disciplineContext}` : '';
  
  const prompt = `As an expert academic writer in the field relevant to "${topic}", define 3-5 essential quality criteria ("depth cues") that a high-quality "${sectionTitle}" section for this ${paperType} should exhibit.

These criteria should be specific to the discipline and paper type, not generic academic advice.${contextInfo}

Examples of discipline-specific criteria:
- Empirical research methodology: "statistical rigor", "reproducibility", "sample validity"
- Literature review: "synthesis across sources", "critical evaluation", "gap identification"
- Theoretical paper: "logical consistency", "novel insights", "theoretical grounding"
- Case study: "contextual detail", "practical implications", "transferability"
- Humanities analysis: "textual evidence", "interpretive depth", "cultural context"

Return a JSON object with a "criteria" array containing 3-5 quality criteria strings specific to this field and section type.`;

  try {
    const { object } = await generateObject({
      model: getLanguageModel(),
      schema: QualityCriteriaSchema,
      prompt,
      temperature: 0.1, // Low temperature for consistency
    });

    const criteria = object.criteria.map(c => c.trim()).filter(c => c.length > 0);
    
    if (criteria.length === 0) {
      console.warn('Quality criteria array was empty after filtering');
      return [...DEFAULT_QUALITY_CRITERIA];
    }
    
    console.log(`Generated ${criteria.length} quality criteria: ${JSON.stringify(criteria)}`);
    return criteria;
    
  } catch (error) {
    console.error('Failed to generate quality criteria:', error);
    // Fallback to basic discipline-agnostic criteria
    return [...DEFAULT_QUALITY_CRITERIA];
  }
}

/**
 * Enhanced section planning prompt that integrates quality criteria generation
 * This replaces the old approach of using hardcoded depth cues
 */
export function generateSectionPlanPrompt(
  topic: string,
  sectionTitle: string,
  paperType: PaperTypeKey,
  qualityCriteria: string[],
  disciplineContext?: string
): string {
  const contextInfo = disciplineContext ? `\n\nDiscipline Context: ${disciplineContext}` : '';
  
  return `You are writing the "${sectionTitle}" section of a ${paperType} about "${topic}".${contextInfo}

QUALITY CRITERIA FOR THIS SECTION:
The following quality criteria have been identified as essential for this section in this discipline:
${qualityCriteria.map(c => `• ${c}`).join('\n')}

Your task is to create a detailed plan for this section that will ensure ALL these quality criteria are met.
Consider the specific expectations and conventions of this discipline.

Your plan should include:
1. Key arguments or points to cover
2. How you will specifically address each quality criterion
3. Logical flow and transitions
4. Any discipline-specific elements that should be included

Respond with NOTHING BUT a JSON object containing:
{
  "outline": [
    "First key point or argument",
    "Second key point or argument",
    "Third key point or argument"
  ],
  "qualityChecks": {
${qualityCriteria.map(c => `    "${c}": "How this criterion will be addressed"`).join(',\n')}
  },
  "disciplineSpecific": [
    "Specific methodological approach for this field",
    "Particular conventions or standards to follow"
  ]
}`;
}

/**
 * Generate an outline for a paper with automatic paper assignment to sections
 * 
 * @param paperType - Type of academic paper (researchArticle, review, etc.)
 * @param topic - The research topic or question
 * @param sourcePaperIds - Array of available paper IDs to distribute among sections
 * @param originalResearch - Optional original research context (research question, key findings)
 * @param profile - Optional paper profile for contextual guidance
 * @param themeGuidance - Optional theme analysis guidance from actual literature (Scribbr-aligned)
 * @returns Promise resolving to structured outline with sections and paper assignments
 * 
 * @example
 * ```ts
 * const outline = await generateOutline(
 *   "researchArticle", 
 *   "Impact of AI on Healthcare",
 *   ["paper-1", "paper-2", "paper-3"],
 *   { researchQuestion: "How does AI improve diagnostic accuracy?", keyFindings: "AI improved accuracy by 23%" }
 * );
 * // Returns: { sections: [{ sectionKey: "introduction", candidatePaperIds: ["paper-1"], ... }] }
 * ```
 * 
 * @throws Error if outline generation fails or returns invalid structure
 */
export async function generateOutline(
  paperType: PaperTypeKey,
  topic: string,
  sourcePaperIds: string[] = [],
  originalResearch?: OriginalResearchInput,
  profile?: PaperProfile,
  themeGuidance?: string
): Promise<GeneratedOutline> {
  const hasOriginalResearch = Boolean(originalResearch?.researchQuestion);
  const systemPrompt = generateOutlineSystemPrompt(paperType, hasOriginalResearch);
  
  // Build profile guidance if profile is provided (using 'outline' mode for structure-focused guidance)
  const profileGuidance = profile ? buildProfileGuidanceForPrompt(profile, 'outline') : '';
  
  // Combine profile guidance with theme guidance if available
  const combinedGuidance = themeGuidance 
    ? `${profileGuidance}\n\n${themeGuidance}`
    : profileGuidance;
  
  const userPrompt = generateOutlineUserPrompt(paperType, topic, sourcePaperIds, originalResearch, combinedGuidance);

  const model = getLanguageModel();

  const response = await model.doGenerate({
    prompt: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: [{ type: 'text' as const, text: userPrompt }] },
    ],
    responseFormat: {
      type: 'json',
      schema: {
        type: 'object',
        properties: {
          sections: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                sectionKey: { type: 'string' },
                title: { type: 'string' },
                expectedWords: { type: 'number' },
                keyPoints: { type: 'array', items: { type: 'string' } },
                candidatePaperIds: {
                  type: 'array',
                  items: { type: 'string' },
                },
                disciplineContext: { type: 'string' },
              },
              required: [
                'sectionKey',
                'title',
                'expectedWords',
                'keyPoints',
                'candidatePaperIds',
                'disciplineContext',
              ],
              additionalProperties: false,
            },
          },
        },
        required: ['sections'],
        additionalProperties: false,
      },
    },
    temperature: 0.2,
    maxOutputTokens: 4000, // Increased from 2000 to handle outlines with paper IDs
  });

  // Extract text from v3 response format
  const textPart = response.content?.find((p: { type: string }) => p.type === 'text')
  const responseText = textPart && 'text' in textPart ? textPart.text : undefined

  // Check for truncation (finishReason: "length") before parsing
  // Note: Cast to string to handle different type definitions across AI SDK versions
  const finishReason = response.finishReason as unknown as string
  if (finishReason === 'length') {
    console.error('Outline generation was truncated due to max_tokens limit');
    console.error('Input tokens:', response.usage?.inputTokens);
    console.error('Output tokens:', response.usage?.outputTokens);
    throw new Error('Outline generation was truncated. The response exceeded the token limit. Try reducing the number of source papers.');
  }

  // Try to parse the structured response
  let outline: GeneratedOutline;
  
  try {
    // For object-json mode, the structured data might be in response.text as JSON
    if (responseText) {
      const parsedResponse = JSON.parse(responseText);
      outline = parsedResponse as GeneratedOutline;
    } else {
      console.error('Outline generation failed - no response text');
      console.error('Full response:', JSON.stringify(response, null, 2));
      throw new Error('No response text from model');
    }
  } catch (parseError) {
    // Check if this was due to truncation
    if (finishReason === 'length') {
      console.error('Outline generation was truncated - JSON incomplete');
      throw new Error('Outline generation was truncated due to token limit');
    }
    console.error('Outline generation failed - JSON parsing error');
    console.error('Response text:', responseText);
    console.error('Parse error:', parseError);
    console.error('Full response:', JSON.stringify(response, null, 2));
    throw new Error('Failed to parse outline JSON from model response');
  }

  // Validate the outline structure
  if (!outline || typeof outline !== 'object' || !Array.isArray(outline.sections)) {
    console.error('Invalid outline structure:', outline);
    throw new Error('Generated outline does not have the expected structure');
  }

  // SURGICAL FIX: Ensure every section has a `candidatePaperIds` array.
  // This prevents downstream errors if the model omits it.
  for (const section of outline.sections) {
    if (!Array.isArray(section.candidatePaperIds)) {
      section.candidatePaperIds = [];
    }
  }

  return outline;
}