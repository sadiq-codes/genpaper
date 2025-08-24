import type { PaperTypeKey } from './types';
import { ai } from '@/lib/ai/vercel-client';

// Constants for consistent fallbacks
export const DEFAULT_QUALITY_CRITERIA = [
  'evidence-based reasoning', 
  'logical coherence', 
  'scholarly depth'
] as const;

/**
 * Centralized JSON parsing utility for LLM responses
 * Handles common cleanup patterns and provides consistent error handling
 */
function safeJsonParseLLM<T>(responseText: string | undefined): { success: true; data: T } | { success: false; error: string } {
  if (!responseText) {
    return { success: false, error: 'No response text available' };
  }

  try {
    // Clean the response text aggressively
    let cleanText = responseText.trim();
    
    // Remove markdown code blocks
    cleanText = cleanText.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
    
    // If it doesn't start with [ or {, try to find the JSON structure
    if (!cleanText.startsWith('[') && !cleanText.startsWith('{')) {
      const structureMatch = cleanText.match(/[\[\{][\s\S]*[\]\}]/);
      if (structureMatch) {
        cleanText = structureMatch[0];
      } else {
        return { success: false, error: 'No valid JSON structure found' };
      }
    }
    
    const parsed = JSON.parse(cleanText);
    return { success: true, data: parsed as T };
  } catch (parseError) {
    return { 
      success: false, 
      error: `JSON parsing failed: ${parseError instanceof Error ? parseError.message : 'Unknown error'}` 
    };
  }
}

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
 */
export function generateOutlineSystemPrompt(paperType: PaperTypeKey): string {
  return `You are an expert academic writer creating a research outline for a ${paperType}. Your task is to organize research into DISTINCT sections following academic structure, ensuring each section has a unique purpose and avoids repetition.

Focus on creating a clear, logical structure that:
1. Follows standard academic organization for this type of paper
2. Maintains clear section boundaries
3. Distributes content appropriately
4. Avoids redundancy between sections

Format your response as a valid JSON object following the schema shown in the user prompt.`;
}

/**
 * Generate user prompt for outline creation - FINAL FIX with paper assignment
 */
export function generateOutlineUserPrompt(
  paperType: PaperTypeKey, 
  topic: string,
  sourcePaperIds: string[] = []
): string {
  const paperIdsList = sourcePaperIds.length > 0 
    ? `AVAILABLE SOURCE PAPER IDs:
[${sourcePaperIds.map(id => `"${id}"`).join(', ')}]

You MUST distribute these paper IDs among the sections you create, assigning each paper to the section(s) where it is most relevant. Each paper can be assigned to multiple sections if appropriate.`
    : 'No source papers are available for this outline.';

  return `You are an expert academic writer specializing in the field relevant to the topic: "${topic}". 
Your task is to generate a logical and conventional outline for a ${paperType}.

${paperIdsList}

Respond with NOTHING BUT a single, valid JSON object.

The JSON object must contain a "sections" array. Each object in the array must have the following keys:
* sectionKey: A camelCase identifier for the section (e.g., 'introduction', 'thematicAnalysis')
* title: A descriptive title for the section
* expectedWords: Your estimated word count for this section
* keyPoints: An array of key objectives or questions this section should address
* candidatePaperIds: An array of the paper IDs from the list above that are most relevant to this section
* disciplineContext: A brief explanation of why this section is important in this specific field/discipline

Determine the most appropriate sections and their order based on your expert knowledge of the discipline.
Consider the conventions and expectations of the field when structuring the outline.

For example, a theoretical mathematics paper might use theorem-proof structures,
while a humanities essay might use thematic sections.

Your response must be valid JSON that matches this TypeScript type:
{
  sections: Array<{
    sectionKey: string;
    title: string;
    expectedWords: number;
    keyPoints: string[];
    candidatePaperIds: string[];
    disciplineContext: string;
  }>
}`
}

/**
 * Generate discipline-specific quality criteria for a section
 * This replaces the hardcoded getDepthCuesForSection function
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

Respond with NOTHING BUT a JSON array of strings, each describing one quality criterion specific to this field and section type.`;

  const model = ai.languageModel('gpt-4o');

  try {
    const response = await model.doGenerate({
      inputFormat: 'messages',
      mode: { type: 'regular' }, // Use regular mode for more reliable text parsing
      prompt: [{ 
        role: 'user', 
        content: [{ type: 'text', text: prompt }]
      }],
      maxTokens: 300,
      temperature: 0.1 // Even lower temperature for more consistency
    });

    // SURGICAL FIX: Use centralized JSON parsing with fallback strategies
    const parseResult = safeJsonParseLLM<unknown>(response.text);
    
    let parsedJson: unknown;
    if (parseResult.success) {
      parsedJson = parseResult.data;
    } else {
      console.error(`Quality criteria parsing failed. Raw response: "${response.text}". Error: ${parseResult.error}`);
      
      // Strategy 2: Try to extract from the raw text using regex with validation
      if (response.text) {
        const stringMatches = response.text.match(/"([^"]+)"/g);
        if (stringMatches && stringMatches.length > 0) {
          const extractedStrings = stringMatches
            .map(match => match.slice(1, -1)) // Remove quotes
            .filter(str => {
              // Lightweight heuristic to filter out noise
              return str.length >= 3 && 
                     str.length <= 80 && 
                     !str.includes('\n') && 
                     !str.includes('\t') && 
                     !/[{}\[\]<>]/.test(str) && // No structural chars
                     !/error|failed|stack|trace/i.test(str); // No error noise
            });
          
          if (extractedStrings.length > 0) {
            console.log(`Extracted quality criteria from regex: ${JSON.stringify(extractedStrings)}`);
            return extractedStrings.slice(0, 5);
          }
        }
      }
      
      // Strategy 3: Fallback to defaults
      console.log('Using fallback quality criteria due to parsing failure');
      return [...DEFAULT_QUALITY_CRITERIA];
    }

    // Validate the parsed result
    if (!Array.isArray(parsedJson)) {
      console.error(`Quality criteria must be a JSON array of strings. Got: ${typeof parsedJson}. Value: ${JSON.stringify(parsedJson)}`);
      
      // Try to extract from object if it's an object with an array property
      if (typeof parsedJson === 'object' && parsedJson !== null) {
        const obj = parsedJson as Record<string, unknown>;
        for (const key of ['criteria', 'quality_criteria', 'items', 'values']) {
          if (Array.isArray(obj[key])) {
            parsedJson = obj[key];
            break;
          }
        }
      }
      
      // If still not an array, use fallback
      if (!Array.isArray(parsedJson)) {
        return [...DEFAULT_QUALITY_CRITERIA];
      }
    }
    
    // Filter to ensure all items are strings
    const criteria = (parsedJson as unknown[])
      .filter((item: unknown): item is string => typeof item === 'string' && item.trim().length > 0)
      .map(item => item.trim());
    
    if (criteria.length === 0) {
      console.warn(`Quality criteria array was empty after filtering. Raw JSON: ${JSON.stringify(parsedJson)}`);
      return [...DEFAULT_QUALITY_CRITERIA];
    }
    
    console.log(`✅ Successfully generated ${criteria.length} quality criteria: ${JSON.stringify(criteria)}`);
    return criteria.slice(0, 5); // Limit to max 5 criteria
    
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
 * @returns Promise resolving to structured outline with sections and paper assignments
 * 
 * @example
 * ```ts
 * const outline = await generateOutline(
 *   "researchArticle", 
 *   "Impact of AI on Healthcare",
 *   ["paper-1", "paper-2", "paper-3"]
 * );
 * // Returns: { sections: [{ sectionKey: "introduction", candidatePaperIds: ["paper-1"], ... }] }
 * ```
 * 
 * @throws Error if outline generation fails or returns invalid structure
 */
export async function generateOutline(
  paperType: PaperTypeKey,
  topic: string,
  sourcePaperIds: string[] = []
): Promise<GeneratedOutline> {
  const systemPrompt = generateOutlineSystemPrompt(paperType);
  const userPrompt = generateOutlineUserPrompt(paperType, topic, sourcePaperIds);

  const model = ai.languageModel('gpt-4o');

  const response = await model.doGenerate({
    inputFormat: 'messages',
    mode: {
      type: 'object-json',
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
            },
          },
        },
        required: ['sections'],
      },
    },
    prompt: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: [{ type: 'text' as const, text: userPrompt }] },
    ],
    temperature: 0.2,
    maxTokens: 2000, // Increased to handle larger outlines with many papers
  });

  // Try to parse the structured response
  let outline: GeneratedOutline;
  
  try {
    // For object-json mode, the structured data might be in response.text as JSON
    if (response.text) {
      const parsedResponse = JSON.parse(response.text);
      outline = parsedResponse as GeneratedOutline;
    } else {
      console.error('Outline generation failed - no response text');
      console.error('Full response:', JSON.stringify(response, null, 2));
      throw new Error('No response text from model');
    }
  } catch (parseError) {
    console.error('Outline generation failed - JSON parsing error');
    console.error('Response text:', response.text);
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