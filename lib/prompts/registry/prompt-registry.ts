import 'server-only'
import Mustache from 'mustache'
import { PaperTypeKey, SectionKey } from '../types'

/**
 * Production-grade prompt registry system
 * Separates content logic from prompt wording for better maintainability
 */

export interface PromptVersion {
  id: string
  version: string
  system: string
  user: string
  metadata: {
    created: string
    author: string
    description: string
    tags: string[]
  }
  config: {
    temperature?: number
    maxTokens?: number
    minCitations?: number
    expectedWords?: number
    requiredDepthCues: string[]
  }
}

export interface PromptRegistry {
  [key: string]: { // e.g., "researchArticle::Results::v1"
    [version: string]: PromptVersion
  }
}

// Cache for loaded prompts
let registryCache: PromptRegistry | null = null

/**
 * Get a specific prompt template with variable substitution
 */
export function getPromptFromRegistry(
  paperType: PaperTypeKey,
  section: SectionKey,
  version: string = 'v1',
  variables: Record<string, any> = {}
): { system: string; user: string; config: PromptVersion['config'] } | null {
  const promptId = `${paperType}::${section}::${version}`
  const registry = loadPromptRegistry()
  
  const promptConfig = registry[promptId]?.[version]
  if (!promptConfig) {
    console.warn(`Prompt not found: ${promptId}`)
    return null
  }

  // Fill templates with variables using Mustache
  const system = Mustache.render(promptConfig.system, variables)
  const user = Mustache.render(promptConfig.user, variables)

  return {
    system,
    user,
    config: promptConfig.config
  }
}

/**
 * Load prompt registry (in production, this would load from database/YAML files)
 * For now, implementing with embedded configurations that can be easily externalized
 */
function loadPromptRegistry(): PromptRegistry {
  if (registryCache) return registryCache

  // This would load from YAML files in production
  registryCache = {
    'researchArticle::Results::v1': {
      v1: {
        id: 'researchArticle::Results::v1',
        version: 'v1',
        system: `You are writing the **Results** section of a peer-reviewed research article.
        
Your task is to present findings objectively with statistical precision.
Focus on data presentation without interpretation (save that for Discussion).

🚨 CITATION RULE: For every factual claim, call the addCitation tool immediately.`,
        user: `Write the Results section for "{{topic}}" using the research context provided.

**Requirements:**
- Target length: {{expectedWords}} words
- Must cite at least {{minCitations}} sources from context
- Present findings objectively without interpretation
- Include statistical details (p-values, effect sizes, confidence intervals)
- Organize by research questions/hypotheses

**Context:** {{contextChunks}}

Focus on empirical findings and statistical results. Save interpretation for Discussion section.`,
        metadata: {
          created: '2025-01-15',
          author: 'system',
          description: 'Results section with statistical focus and objective reporting',
          tags: ['results', 'empirical', 'statistical']
        },
        config: {
          temperature: 0.2,
          maxTokens: 2000,
          minCitations: 8,
          expectedWords: 1000,
          requiredDepthCues: ['statistical precision', 'objective reporting', 'empirical findings']
        }
      }
    },
    'researchArticle::Methods::v1': {
      v1: {
        id: 'researchArticle::Methods::v1',
        version: 'v1',
        system: `You are writing the **Methods** section of a peer-reviewed research article.
        
Provide detailed, replicable procedures that allow others to reproduce your study.
Focus on methodological rigor and transparency.`,
        user: `Write the Methods section for "{{topic}}" with comprehensive methodological detail.

**Requirements:**
- Target length: {{expectedWords}} words
- Must cite at least {{minCitations}} methodological sources
- Provide replication-level detail
- Justify all methodological choices
- Include statistical analysis plan

**Research Design Context:** {{contextChunks}}

Ensure someone could replicate your study from this description alone.`,
        metadata: {
          created: '2025-01-15',
          author: 'system',
          description: 'Methods section with replication focus and methodological rigor',
          tags: ['methods', 'replication', 'methodology']
        },
        config: {
          temperature: 0.1,
          maxTokens: 2500,
          minCitations: 6,
          expectedWords: 1200,
          requiredDepthCues: ['replication detail', 'methodological justification', 'statistical procedures']
        }
      }
    },
    'literatureReview::thematicSection::v1': {
      v1: {
        id: 'literatureReview::thematicSection::v1',
        version: 'v1',
        system: `You are writing a focused thematic section of a literature review.
        
This section must synthesize research around a specific theme, comparing methodologies
and identifying patterns, contradictions, and gaps. Focus on critical analysis, not summary.`,
        user: `Write the thematic section "{{sectionTitle}}" for literature review on {{topic}}.

**Theme Focus:** {{themeFocus}}

**Requirements:**
- Target length: {{expectedWords}} words
- Synthesize at least {{minCitations}} studies thematically
- Compare methodological approaches
- Identify agreements and contradictions
- Highlight specific research gaps

**Research Context:** {{contextChunks}}

Structure: Theme importance → synthesis of findings → methodological comparison → gaps → unresolved questions.`,
        metadata: {
          created: '2025-01-15',
          author: 'system',
          description: 'Thematic literature review with synthesis focus',
          tags: ['literature-review', 'synthesis', 'thematic']
        },
        config: {
          temperature: 0.3,
          maxTokens: 2000,
          minCitations: 10,
          expectedWords: 1000,
          requiredDepthCues: ['synthesis', 'methodological comparison', 'gap identification', 'critical analysis']
        }
      }
    }
  }

  return registryCache
}

/**
 * Get all available prompt versions for a given paper type and section
 */
export function getAvailableVersions(paperType: PaperTypeKey, section: SectionKey): string[] {
  const promptId = `${paperType}::${section}`
  const registry = loadPromptRegistry()
  
  const versions = Object.keys(registry).filter(key => key.startsWith(promptId))
  return versions.map(key => key.split('::')[2]).filter(Boolean)
}

/**
 * Log prompt usage for analytics and A/B testing
 */
export function logPromptUsage(
  promptId: string,
  model: string,
  latency: number,
  outputScore?: number,
  metadata?: Record<string, any>
): void {
  // In production, this would log to Supabase or analytics service
  console.log('Prompt Usage:', {
    promptId,
    model,
    latency,
    outputScore,
    timestamp: new Date().toISOString(),
    ...metadata
  })
}

/**
 * Clear registry cache (useful for testing and hot-reloading)
 */
export function clearRegistryCache(): void {
  registryCache = null
} 