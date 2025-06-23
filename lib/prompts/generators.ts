import type { PaperTypeKey } from './types';
import { ai } from '@/lib/ai/vercel-client';

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
 * Generate user prompt for outline creation
 */
export function generateOutlineUserPrompt(paperType: PaperTypeKey, topic: string): string {
  return `You are an expert academic writer specializing in the field relevant to the topic: "${topic}". 
Your task is to generate a logical and conventional outline for a ${paperType}.

Respond with NOTHING BUT a single, valid JSON object.

The JSON object must contain a "sections" array. Each object in the array must have the following keys:
* sectionKey: A camelCase identifier for the section (e.g., 'introduction', 'thematicAnalysis')
* title: A descriptive title for the section
* expectedWords: Your estimated word count for this section
* keyPoints: An array of key objectives or questions this section should address
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
    disciplineContext: string;
  }>
}`
}

/**
 * Generate discipline-specific quality criteria for a section
 * This replaces the hardcoded getDepthCuesForSection function
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
      mode: {
        type: 'object-json',
        schema: {
          type: 'array',
          items: { type: 'string' }
        }
      },
      prompt: [{ 
        role: 'user', 
        content: [{ type: 'text', text: prompt }]
      }],
      maxTokens: 300,
      temperature: 0.3 // Lower temperature for more consistent criteria
    });

    const criteria = JSON.parse(response.text || '[]') as string[];
    return criteria.slice(0, 5); // Limit to max 5 criteria
  } catch (error) {
    console.error('Failed to generate quality criteria:', error);
    // Fallback to basic discipline-agnostic criteria
    return ['evidence-based reasoning', 'logical coherence', 'scholarly depth'];
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
    "${qualityCriteria[0] || 'criterion1'}": "How this criterion will be addressed",
    "${qualityCriteria[1] || 'criterion2'}": "How this criterion will be addressed"
  },
  "disciplineSpecific": [
    "Specific methodological approach for this field",
    "Particular conventions or standards to follow"
  ]
}`;
}

/**
 * Generate an outline for a paper
 */
export async function generateOutline(
  paperType: PaperTypeKey,
  topic: string
): Promise<GeneratedOutline> {
  const systemPrompt = generateOutlineSystemPrompt(paperType);
  const userPrompt = generateOutlineUserPrompt(paperType, topic);

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
                disciplineContext: { type: 'string' }
              },
              required: ['sectionKey', 'title', 'expectedWords', 'keyPoints', 'disciplineContext']
            }
          }
        },
        required: ['sections']
      }
    },
    prompt: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: [{ type: 'text' as const, text: userPrompt }] }
    ],
    temperature: 0.2,
    maxTokens: 2000
  });

  try {
    return JSON.parse(response.text || '{}') as GeneratedOutline;
  } catch (error) {
    throw new Error(`Failed to parse outline JSON: ${error}`);
  }
}