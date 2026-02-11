import 'server-only'
import { generateText } from 'ai'
import { getLanguageModel } from '@/lib/ai/vercel-client'
import { info, warn } from '@/lib/utils/logger'
import type { OriginalResearchConfig } from '@/types/simplified'

/**
 * Normalized findings output — structured for reliable downstream use.
 * The raw user text is preserved; `normalizedFindings` is the clean version
 * that gets injected into prompts.
 */
export interface NormalizedResearch {
  has_original_research: true
  research_question: string
  key_findings: string            // Original raw text (preserved)
  normalized_findings: string     // LLM-cleaned structured version
}

/**
 * Normalize raw user-provided findings into a clean, structured format
 * that the generation pipeline can reliably anchor every section to.
 *
 * Accepts any format: pasted chapters, OCR text, bullet points, tables, etc.
 * Returns clean markdown with explicit sections the LLM can reference precisely.
 *
 * Falls back to the raw text if normalization fails (never blocks generation).
 */
export async function normalizeFindings(
  raw: OriginalResearchConfig
): Promise<NormalizedResearch> {
  const rawFindings = raw.key_findings?.trim()
  const researchQuestion = raw.research_question?.trim() || ''

  // Nothing to normalize — empty or trivially short input
  if (!rawFindings || rawFindings.length < 20) {
    return {
      has_original_research: true,
      research_question: researchQuestion,
      key_findings: rawFindings || '',
      normalized_findings: rawFindings || '',
    }
  }

  try {
    const { text } = await generateText({
      model: getLanguageModel(),
      system: `You are a research data parser. Your job is to extract and restructure raw research findings into a clean, precise format that an academic writing system can rely on.

RULES:
- Preserve ALL numbers, percentages, p-values, and statistics EXACTLY as provided
- Preserve ALL proper nouns, species names, market names, location names
- Fix obvious OCR errors or formatting issues but NEVER change data values
- If a table has inconsistent totals, flag it but preserve the original values
- Output clean markdown only — no commentary, no analysis, no additions
- ONLY output sections that have actual content — skip sections with nothing to fill
- If the input is ONLY a research question with no data, output just the Research Question section
- If the input is ONLY a table with no context, output just the Data Tables section
- If you cannot parse something, include it verbatim in an "Unparsed Data" section
- If the input appears to be irrelevant (a URL, filename, or non-research text), output just the Unparsed Data section`,
      prompt: `Parse the following raw research input into a structured format.
Include ONLY the sections that apply — skip any section that would be empty.

${researchQuestion ? `RESEARCH QUESTION: "${researchQuestion}"` : 'RESEARCH QUESTION: not provided — infer from the data if possible'}

RAW INPUT:
${rawFindings}

AVAILABLE SECTIONS (include only those with actual content):

## Research Question
[Clean version of the research question, or inferred from data. Skip if no question is found.]

## Key Findings Summary
[2-4 bullet points summarizing the most important results. Skip if the input has no findings/results.]

## Data Tables
[Reproduce any tables as clean markdown tables with correct headers and alignment]
[Flag any inconsistencies: e.g. "Note: column totals do not sum to 100%"]
[Skip if no tabular data is present.]

## Definitions & Abbreviations
[Any abbreviations, codes, or location mappings found in the data. Skip if none.]

## Specific Results
[Bullet list of every specific quantitative or qualitative finding. Skip if no specific results.]

## Unparsed Data
[Anything that could not be cleanly structured — include verbatim. Skip if everything was parsed.]`,
      temperature: 0.1,
      maxOutputTokens: 4000,
    })

    const normalized = text.trim()

    if (normalized.length < 20) {
      warn({ rawLength: rawFindings.length }, 'Findings normalization produced empty output — using raw text')
      return {
        has_original_research: true,
        research_question: researchQuestion,
        key_findings: rawFindings,
        normalized_findings: rawFindings,
      }
    }

    info({
      rawLength: rawFindings.length,
      normalizedLength: normalized.length,
    }, 'Findings normalized successfully')

    return {
      has_original_research: true,
      research_question: researchQuestion,
      key_findings: rawFindings,
      normalized_findings: normalized,
    }
  } catch (err) {
    warn({ error: err }, 'Findings normalization failed — using raw text as fallback')
    return {
      has_original_research: true,
      research_question: researchQuestion,
      key_findings: rawFindings,
      normalized_findings: rawFindings,
    }
  }
}
