import 'server-only'

import { fog } from '@/lib/ai/foglamp'

const { generateObject } = fog.with({ traceName: "Outline planner" })
import { z } from 'zod'
import { getFastAutocompleteLanguageModel } from '@/lib/ai/vercel-client'

export interface OutlinePlanSection {
  heading: string
  goal: string
  targetWords?: number
}

export interface OutlinePlanBlueprint {
  version: number
  source: 'autocomplete' | 'generation'
  createdAt: string
  sections: OutlinePlanSection[]
}

const MAX_SECTION_SUMMARIES = 8

export function normalizeOutlineHeading(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/^#+\s*/, '')
    .replace(/^[0-9ivx]+\.\s+/i, '')
    .replace(/[^\w\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function sanitizeOutlineHeading(rawHeading: string): string {
  return rawHeading
    .replace(/^#+\s*/, '')
    .replace(/^[0-9ivx]+\.\s+/i, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export function headingsRoughlyMatch(a: string, b: string): boolean {
  const left = normalizeOutlineHeading(a)
  const right = normalizeOutlineHeading(b)
  if (!left || !right) return false
  return left === right || left.includes(right) || right.includes(left)
}

export function dedupePlannedOutline(headings: string[]): string[] {
  const deduped: string[] = []
  for (const heading of headings) {
    const cleaned = sanitizeOutlineHeading(heading)
    if (!cleaned) continue
    if (!deduped.some(existing => headingsRoughlyMatch(existing, cleaned))) {
      deduped.push(cleaned)
    }
  }
  return deduped
}

export function findNextMissingOutlineHeading(
  plannedOutline: string[],
  documentOutline: string[]
): string | null {
  for (const planned of plannedOutline) {
    const existsInDoc = documentOutline.some(existing => headingsRoughlyMatch(existing, planned))
    if (!existsInDoc) return planned
  }
  return null
}

export function countWords(text: string): number {
  const normalized = text.trim()
  if (!normalized) return 0
  return normalized.split(/\s+/).length
}

export function extractiveSectionSummary(sectionText: string): string {
  const normalized = sectionText.replace(/\s+/g, ' ').trim()
  if (!normalized) return ''

  // Keep summary cheap and deterministic: first 1-2 complete sentences.
  const sentences = normalized
    .split(/(?<=[.!?])\s+/)
    .map(sentence => sentence.trim())
    .filter(Boolean)

  if (sentences.length === 0) return ''
  if (sentences.length === 1) return sentences[0]

  const combined = `${sentences[0]} ${sentences[1]}`.trim()
  return combined.length > 320 ? `${combined.slice(0, 317).trimEnd()}...` : combined
}

export function limitSectionSummaries(
  sectionSummaries: Record<string, string>,
  plannedOutline: string[]
): Record<string, string> {
  if (Object.keys(sectionSummaries).length <= MAX_SECTION_SUMMARIES) {
    return sectionSummaries
  }

  const prioritizedKeys = plannedOutline.map(normalizeOutlineHeading).filter(Boolean)
  const entries = Object.entries(sectionSummaries)

  entries.sort((a, b) => {
    const indexA = prioritizedKeys.indexOf(a[0])
    const indexB = prioritizedKeys.indexOf(b[0])
    const scoreA = indexA === -1 ? Number.MAX_SAFE_INTEGER : indexA
    const scoreB = indexB === -1 ? Number.MAX_SAFE_INTEGER : indexB
    return scoreA - scoreB
  })

  return Object.fromEntries(entries.slice(0, MAX_SECTION_SUMMARIES))
}

export function buildSectionSummariesContext(
  sectionSummaries: Record<string, string>,
  plannedOutline: string[]
): string {
  if (Object.keys(sectionSummaries).length === 0) return ''

  const rendered: string[] = []
  const usedKeys = new Set<string>()

  for (const heading of plannedOutline) {
    const key = normalizeOutlineHeading(heading)
    const summary = sectionSummaries[key]
    if (!summary) continue
    rendered.push(`- ${heading}: ${summary}`)
    usedKeys.add(key)
  }

  for (const [key, summary] of Object.entries(sectionSummaries)) {
    if (usedKeys.has(key)) continue
    if (!summary) continue
    rendered.push(`- ${key}: ${summary}`)
  }

  return rendered.slice(0, MAX_SECTION_SUMMARIES).join('\n')
}

export function buildSectionGoalMap(sections: OutlinePlanSection[]): Map<string, string> {
  const map = new Map<string, string>()
  for (const section of sections) {
    const key = normalizeOutlineHeading(section.heading)
    if (key && section.goal) {
      map.set(key, section.goal.trim())
    }
  }
  return map
}

export function buildCurrentSectionGoalsContext(
  currentSection: string,
  plannedOutline: string[],
  sectionGoalMap: Map<string, string>
): string {
  const currentKey = normalizeOutlineHeading(currentSection)
  if (!currentKey) return ''

  const lines: string[] = []
  const currentGoal = sectionGoalMap.get(currentKey)
  if (currentGoal) {
    lines.push(`- Focus now (${currentSection}): ${currentGoal}`)
  }

  const currentOutlineIndex = plannedOutline.findIndex(
    heading => headingsRoughlyMatch(heading, currentSection)
  )
  if (currentOutlineIndex >= 0 && currentOutlineIndex + 1 < plannedOutline.length) {
    const nextHeading = plannedOutline[currentOutlineIndex + 1]
    const nextGoal = sectionGoalMap.get(normalizeOutlineHeading(nextHeading))
    if (nextGoal) {
      lines.push(`- Prepare transition to ${nextHeading}: ${nextGoal}`)
    }
  }

  return lines.join('\n')
}

export function getSectionTransitionThreshold(params: {
  currentSection: string
  plannedOutline: string[]
  blueprintSections: OutlinePlanSection[]
  fallbackWords?: number
}): number {
  const fallback = params.fallbackWords ?? 140
  const { currentSection, plannedOutline, blueprintSections } = params

  const currentOutlineIndex = plannedOutline.findIndex(
    heading => headingsRoughlyMatch(heading, currentSection)
  )
  if (currentOutlineIndex < 0) return fallback

  const sectionHeading = plannedOutline[currentOutlineIndex]
  const sectionPlan = blueprintSections.find(
    section => headingsRoughlyMatch(section.heading, sectionHeading)
  )
  const targetWords = sectionPlan?.targetWords
  if (!targetWords || targetWords <= 0) return fallback

  // Advance near section completion, not only at exact target.
  const adaptive = Math.round(targetWords * 0.55)
  return Math.max(90, Math.min(380, adaptive))
}

export function getFallbackOutlineSections(topic: string): OutlinePlanSection[] {
  return [
    {
      heading: 'Abstract',
      goal: `Summarize the central problem, approach, and high-level contribution related to ${topic}.`,
      targetWords: 180,
    },
    {
      heading: 'Introduction',
      goal: `Introduce the research problem, motivate its importance, and state the core research objective for ${topic}.`,
      targetWords: 320,
    },
    {
      heading: 'Literature Review',
      goal: `Synthesize major themes in prior work and identify the gap this paper addresses in ${topic}.`,
      targetWords: 420,
    },
    {
      heading: 'Methodology',
      goal: 'Describe the analytical approach, data/process choices, and justification for methodological decisions.',
      targetWords: 360,
    },
    {
      heading: 'Results',
      goal: 'Present the key findings and observations with clear, evidence-backed statements.',
      targetWords: 320,
    },
    {
      heading: 'Discussion',
      goal: 'Interpret the findings, compare with prior research, and explain implications and limitations.',
      targetWords: 320,
    },
    {
      heading: 'Conclusion',
      goal: 'Conclude with the core contribution, practical/theoretical implications, and future work directions.',
      targetWords: 220,
    },
  ]
}

export function buildOutlineBlueprintFromSections(
  sections: OutlinePlanSection[],
  source: OutlinePlanBlueprint['source']
): OutlinePlanBlueprint {
  const deduped: OutlinePlanSection[] = []
  for (const section of sections) {
    const heading = sanitizeOutlineHeading(section.heading)
    if (!heading) continue
    if (deduped.some(existing => headingsRoughlyMatch(existing.heading, heading))) continue

    deduped.push({
      heading,
      goal: section.goal.trim(),
      targetWords: section.targetWords,
    })
  }

  return {
    version: 1,
    source,
    createdAt: new Date().toISOString(),
    sections: deduped,
  }
}

export function buildOutlineBlueprintFromProfileSections(
  profileSections: Array<{ title: string; keyPoints?: string[]; expectedWords?: number }>
): OutlinePlanBlueprint {
  const sections: OutlinePlanSection[] = profileSections.map(section => ({
    heading: section.title,
    goal: section.keyPoints?.[0]?.trim() || `Develop the core argument and evidence for ${section.title}.`,
    targetWords: section.expectedWords,
  }))

  return buildOutlineBlueprintFromSections(sections, 'generation')
}

export async function generateOutlineBlueprint(params: {
  topic: string
  paperType: string
  titleHeading?: string
}): Promise<OutlinePlanBlueprint> {
  const schema = z.object({
    sections: z.array(
      z.object({
        heading: z.string().min(2).max(80),
        goal: z.string().min(20).max(260),
        targetWords: z.number().int().min(80).max(900).optional(),
      })
    ).min(5).max(9),
  })

  const prompt = [
    'Create a practical section plan for an academic paper.',
    `Topic: ${params.topic}`,
    `Paper type: ${params.paperType}`,
    params.titleHeading ? `Document title: ${params.titleHeading}` : '',
    '',
    'Return 5-9 level-2 section headings in logical order.',
    'Use concise heading names without markdown symbols or numbering.',
    'For each section, provide a one-sentence writing goal and optional targetWords.',
    'Include standard research flow (e.g., Abstract, Introduction, Literature Review/Background, Methodology/Methods, Results/Findings, Discussion, Conclusion) when relevant.',
  ]
    .filter(Boolean)
    .join('\n')

  try {
    const { object } = await generateObject({
      model: getFastAutocompleteLanguageModel(),
      schema,
      prompt,
      temperature: 0.3,
      maxOutputTokens: 700,
    })

    const sections = object.sections
      .map(section => ({
        heading: section.heading,
        goal: section.goal,
        targetWords: section.targetWords,
      }))
      .filter(section => section.heading.trim().length > 0 && section.goal.trim().length > 0)

    const blueprint = buildOutlineBlueprintFromSections(sections, 'autocomplete')
    if (blueprint.sections.length >= 4) {
      return blueprint
    }
  } catch (error) {
    console.warn('[OutlinePlanner] Failed to generate AI blueprint, using fallback:', error)
  }

  return buildOutlineBlueprintFromSections(getFallbackOutlineSections(params.topic), 'autocomplete')
}
