import 'server-only'
import { openai } from '@ai-sdk/openai'
import { generateText } from 'ai'
import { getSB } from '@/lib/supabase/server'
import { getClaimsForPaper, type ExtractedClaim } from './claim-extractor'
import { getGapsForProject, type ResearchGap } from './gap-finder'

/**
 * Synthesis Generator - Creates structured analysis outputs
 * 
 * Generates both structured JSON and markdown outputs for:
 * - Research synthesis (combining findings across papers)
 * - Literature review (narrative summary)
 * - Gap analysis report
 */

export type AnalysisType = 'claim_extraction' | 'gap_analysis' | 'synthesis' | 'literature_review'

export interface AnalysisOutput {
  id?: string
  project_id: string
  analysis_type: AnalysisType
  status: 'pending' | 'processing' | 'completed' | 'failed'
  structured_output: Record<string, unknown>
  markdown_output: string
  metadata: Record<string, unknown>
  created_at?: string
  completed_at?: string
}

export interface SynthesisResult {
  structured: {
    topic: string
    paper_count: number
    claim_count: number
    themes: Array<{
      name: string
      claims: string[]
      supporting_papers: string[]
    }>
    agreements: Array<{
      finding: string
      papers: string[]
      confidence: number
    }>
    gaps: ResearchGap[]
    key_insights: string[]
  }
  markdown: string
  processing_time_ms: number
  error?: string
}

/**
 * Generate a synthesis of findings across papers
 */
export async function generateSynthesis(
  projectId: string,
  paperIds: string[],
  topic: string
): Promise<SynthesisResult> {
  const startTime = Date.now()
  
  try {
    // Gather all claims and gaps
    const allClaims: ExtractedClaim[] = []
    for (const paperId of paperIds) {
      const claims = await getClaimsForPaper(paperId)
      allClaims.push(...claims)
    }
    
    const gaps = await getGapsForProject(projectId)

    if (allClaims.length === 0) {
      return {
        structured: {
          topic,
          paper_count: paperIds.length,
          claim_count: 0,
          themes: [],
          agreements: [],
          gaps: [],
          key_insights: []
        },
        markdown: `# Research Synthesis: ${topic}\n\nNo claims have been extracted yet. Please run claim extraction first.`,
        processing_time_ms: Date.now() - startTime
      }
    }

    // Group findings by theme using GPT
    const { text: synthesisText } = await generateText({
      model: openai('gpt-4o-mini'),
      prompt: buildSynthesisPrompt(topic, allClaims, gaps),
      temperature: 0.3,
    })

    // Parse the synthesis into structured format
    const structured = parseSynthesis(topic, paperIds, allClaims, gaps, synthesisText)
    
    // Generate markdown output
    const markdown = generateMarkdownSynthesis(topic, structured, synthesisText)

    return {
      structured,
      markdown,
      processing_time_ms: Date.now() - startTime
    }
  } catch (error) {
    console.error('Synthesis generation failed:', error)
    return {
      structured: {
        topic,
        paper_count: paperIds.length,
        claim_count: 0,
        themes: [],
        agreements: [],
        gaps: [],
        key_insights: []
      },
      markdown: `# Error\n\nFailed to generate synthesis: ${error instanceof Error ? error.message : 'Unknown error'}`,
      processing_time_ms: Date.now() - startTime,
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
}

/**
 * Generate a literature review
 */
export async function generateLiteratureReview(
  projectId: string,
  paperIds: string[],
  topic: string
): Promise<SynthesisResult> {
  const startTime = Date.now()
  
  try {
    // Gather claims
    const allClaims: ExtractedClaim[] = []
    for (const paperId of paperIds) {
      const claims = await getClaimsForPaper(paperId)
      allClaims.push(...claims)
    }

    const gaps = await getGapsForProject(projectId)

    // Generate narrative review
    const { text: reviewText } = await generateText({
      model: openai('gpt-4o'),
      prompt: buildLiteratureReviewPrompt(topic, allClaims, gaps),
      temperature: 0.4,
    })

    const structured = {
      topic,
      paper_count: paperIds.length,
      claim_count: allClaims.length,
      themes: [],
      agreements: [],
      gaps,
      key_insights: []
    }

    return {
      structured,
      markdown: formatLiteratureReview(topic, reviewText),
      processing_time_ms: Date.now() - startTime
    }
  } catch (error) {
    console.error('Literature review generation failed:', error)
    return {
      structured: {
        topic,
        paper_count: paperIds.length,
        claim_count: 0,
        themes: [],
        agreements: [],
        gaps: [],
        key_insights: []
      },
      markdown: `# Error\n\nFailed to generate literature review.`,
      processing_time_ms: Date.now() - startTime,
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
}

/**
 * Store analysis output in database
 */
export async function storeAnalysis(output: AnalysisOutput): Promise<{ id: string } | null> {
  const supabase = await getSB()
  
  const { data, error } = await supabase
    .from('project_analysis')
    .insert({
      project_id: output.project_id,
      analysis_type: output.analysis_type,
      status: output.status,
      structured_output: output.structured_output,
      markdown_output: output.markdown_output,
      metadata: output.metadata,
      completed_at: output.status === 'completed' ? new Date().toISOString() : null
    })
    .select('id')
    .single()

  if (error) {
    console.error('Failed to store analysis:', error)
    return null
  }

  return { id: data.id }
}

/**
 * Get analysis outputs for a project
 */
export async function getAnalysisForProject(
  projectId: string,
  analysisType?: AnalysisType
): Promise<AnalysisOutput[]> {
  const supabase = await getSB()
  
  let query = supabase
    .from('project_analysis')
    .select('*')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })

  if (analysisType) {
    query = query.eq('analysis_type', analysisType)
  }

  const { data, error } = await query

  if (error) {
    console.error('Failed to fetch analysis:', error)
    return []
  }

  return data || []
}

// Helper functions

function buildSynthesisPrompt(
  topic: string,
  claims: ExtractedClaim[],
  gaps: ResearchGap[]
): string {
  const findings = claims.filter(c => c.claim_type === 'finding')
  const methods = claims.filter(c => c.claim_type === 'method')
  const limitations = claims.filter(c => c.claim_type === 'limitation')

  return `Synthesize the following research on "${topic}".

KEY FINDINGS (${findings.length}):
${findings.map(c => `- ${c.claim_text}`).join('\n')}

METHODS USED (${methods.length}):
${methods.map(c => `- ${c.claim_text}`).join('\n')}

LIMITATIONS NOTED (${limitations.length}):
${limitations.map(c => `- ${c.claim_text}`).join('\n')}

IDENTIFIED GAPS (${gaps.length}):
${gaps.map(g => `- [${g.gap_type}] ${g.description}`).join('\n')}

Create a synthesis that:
1. Identifies common themes across the findings
2. Highlights areas of agreement between papers
3. Notes methodological approaches and their trade-offs
4. Summarizes the key gaps and opportunities
5. Provides 3-5 key insights for researchers

Write in a clear, academic style suitable for a research overview.`
}

function buildLiteratureReviewPrompt(
  topic: string,
  claims: ExtractedClaim[],
  gaps: ResearchGap[]
): string {
  const claimsByPaper = claims.reduce((acc, c) => {
    if (!acc[c.paper_id]) acc[c.paper_id] = []
    acc[c.paper_id].push(c)
    return acc
  }, {} as Record<string, ExtractedClaim[]>)

  return `Write a literature review on "${topic}" based on the following extracted information.

PAPERS ANALYZED: ${Object.keys(claimsByPaper).length}

EXTRACTED CLAIMS BY PAPER:
${Object.entries(claimsByPaper).map(([paperId, paperClaims]) => 
  `Paper ${paperId.slice(0, 8)}:\n${paperClaims.map(c => `  - [${c.claim_type}] ${c.claim_text}`).join('\n')}`
).join('\n\n')}

RESEARCH GAPS IDENTIFIED:
${gaps.map(g => `- [${g.gap_type}] ${g.description}`).join('\n')}

Write a cohesive literature review that:
1. Introduces the topic and its importance
2. Organizes findings thematically (not paper-by-paper)
3. Compares and contrasts different approaches
4. Critically evaluates the current state of knowledge
5. Identifies gaps and future directions
6. Uses proper academic language

Every factual claim should be attributable to the source papers (reference by paper ID).`
}

function parseSynthesis(
  topic: string,
  paperIds: string[],
  claims: ExtractedClaim[],
  gaps: ResearchGap[],
  synthesisText: string
): SynthesisResult['structured'] {
  // Extract key insights from the synthesis text
  const keyInsights: string[] = []
  const insightMatches = synthesisText.match(/(?:key insight|finding|important|significant)[:\s]+([^.]+\.)/gi)
  if (insightMatches) {
    keyInsights.push(...insightMatches.slice(0, 5).map(m => m.replace(/^[^:]+:\s*/, '')))
  }

  return {
    topic,
    paper_count: paperIds.length,
    claim_count: claims.length,
    themes: [], // Would need more sophisticated parsing
    agreements: [], // Would need claim comparison
    gaps,
    key_insights: keyInsights
  }
}

function generateMarkdownSynthesis(
  topic: string,
  structured: SynthesisResult['structured'],
  synthesisText: string
): string {
  return `# Research Synthesis: ${topic}

## Overview

- **Papers Analyzed**: ${structured.paper_count}
- **Claims Extracted**: ${structured.claim_count}
- **Gaps Identified**: ${structured.gaps.length}

## Synthesis

${synthesisText}

## Research Gaps

${structured.gaps.map(g => `### ${g.gap_type.charAt(0).toUpperCase() + g.gap_type.slice(1)}

${g.description}

**Confidence**: ${(g.confidence * 100).toFixed(0)}%
`).join('\n')}

## Key Insights

${structured.key_insights.map((insight, i) => `${i + 1}. ${insight}`).join('\n')}

---
*Generated by Research Assistant*
`
}

function formatLiteratureReview(topic: string, reviewText: string): string {
  return `# Literature Review: ${topic}

${reviewText}

---
*Generated by Research Assistant*
`
}
