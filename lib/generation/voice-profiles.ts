/**
 * Voice Profiles System
 * 
 * Defines distinct authorial personas for academic writing variation.
 * Each profile encodes rules (not vibes) for:
 * - Literature stance (descriptive → evaluative → adversarial)
 * - Hedging density and confidence levels
 * - Sentence rhythm and emphasis patterns
 * - Citation posture (supportive → contrastive)
 * - Intellectual risk tolerance
 * 
 * This system reduces AI detectability by producing authentic-feeling
 * authorial differences while maintaining academic rigor.
 */

// ──────────────────────────────────────────────────────────────────────────────
// Type Definitions
// ──────────────────────────────────────────────────────────────────────────────

export type VoiceProfileId = 
  | 'conservative-reviewer'
  | 'confident-researcher' 
  | 'senior-scholar'
  | 'balanced-academic'

export type LiteratureStance = 'descriptive' | 'evaluative' | 'adversarial'
export type HedgingDensity = 'high' | 'medium' | 'low'
export type CitationStyle = 'supportive' | 'contrastive' | 'mixed'
export type IntellectualRisk = 'conservative' | 'moderate' | 'bold'
export type SectionKey = 'introduction' | 'methods' | 'results' | 'discussion' | 'conclusion' | 'literature-review'

/**
 * Hedging configuration - quantified rules for confidence expression
 */
export interface HedgingConfig {
  /** Overall hedging density */
  density: HedgingDensity
  /** Maximum hedge phrases allowed per paragraph (e.g., "may", "could", "suggests") */
  maxHedgePhrasesPerParagraph: number
  /** Minimum assertive/declarative sentences required per section */
  requiredAssertiveSentencesPerSection: number
}

/**
 * Sentence rhythm configuration - rules for structural variation
 */
export interface SentenceRhythmConfig {
  /** Target percentage of short sentences (≤12 words) */
  shortSentencePercentage: number
  /** Maximum consecutive long sentences before requiring a short one */
  maxConsecutiveLongSentences: number
  /** Number of emphatic/punchy sentences per section */
  emphasisSentencesPerSection: number
}

/**
 * Citation posture configuration - how to engage with sources
 */
export interface CitationPostureConfig {
  /** Overall citation style */
  style: CitationStyle
  /** Minimum contrastive citations per section (e.g., "However, X argues...") */
  minContrastiveCitationsPerSection: number
  /** Whether explicit disagreement with sources is permitted */
  allowExplicitDisagreement: boolean
}

/**
 * Phrase patterns for each voice dimension
 */
export interface VoicePatterns {
  /** Hedge phrases: "may suggest", "appears to indicate", "could potentially" */
  hedgePhrases: string[]
  /** Assertive phrases: "demonstrates", "establishes", "confirms" */
  assertivePhrases: string[]
  /** Contrastive phrases: "However,", "Contrary to", "In contrast" */
  contrastivePhrases: string[]
  /** Evaluative phrases: "This assumption is problematic", "A notable limitation" */
  evaluativePhrases: string[]
}

/**
 * Section-specific voice modulations
 * Different sections require different voice characteristics
 */
export type SectionModulations = Partial<Record<SectionKey, Partial<VoiceProfileCore>>>

/**
 * Core voice profile without section modulations (for recursion prevention)
 */
export interface VoiceProfileCore {
  /** Stance toward literature: how critically to engage with sources */
  literatureStance: LiteratureStance
  /** Hedging rules: confidence expression */
  hedging: HedgingConfig
  /** Sentence rhythm: structural variation */
  sentenceRhythm: SentenceRhythmConfig
  /** Citation posture: how to cite and engage with sources */
  citationPosture: CitationPostureConfig
  /** Intellectual risk tolerance: boldness of claims */
  intellectualRisk: IntellectualRisk
  /** Phrase patterns to use */
  patterns: VoicePatterns
}

/**
 * Complete voice profile definition
 */
export interface VoiceProfile extends VoiceProfileCore {
  /** Unique identifier */
  id: VoiceProfileId
  /** Human-readable name */
  name: string
  /** Description of the authorial persona */
  description: string
  /** Section-specific overrides */
  sectionModulations: SectionModulations
}

/**
 * Voice configuration for a paper profile
 */
export interface PaperVoiceConfig {
  /** Selected voice profile ID */
  profileId: VoiceProfileId
  /** AI-generated rationale for voice selection */
  rationale?: string
  /** Custom overrides to the base profile */
  overrides?: Partial<VoiceProfileCore>
}

// ──────────────────────────────────────────────────────────────────────────────
// Voice Profile Definitions
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Conservative Reviewer
 * 
 * High hedging, descriptive stance, avoids strong claims.
 * Appropriate for: Undergraduate papers, sensitive topics, early-stage research.
 * 
 * Characteristics:
 * - Reports findings without strong judgment
 * - Dense citation clusters for support
 * - Long, heavily qualified sentences
 * - Avoids explicit disagreement
 */
export const CONSERVATIVE_REVIEWER: VoiceProfile = {
  id: 'conservative-reviewer',
  name: 'Conservative Reviewer',
  description: 'a cautious academic who thoroughly reports findings without making strong claims, prioritizing comprehensive coverage over bold interpretation',
  
  literatureStance: 'descriptive',
  
  hedging: {
    density: 'high',
    maxHedgePhrasesPerParagraph: 4,
    requiredAssertiveSentencesPerSection: 0
  },
  
  sentenceRhythm: {
    shortSentencePercentage: 15,
    maxConsecutiveLongSentences: 4,
    emphasisSentencesPerSection: 0
  },
  
  citationPosture: {
    style: 'supportive',
    minContrastiveCitationsPerSection: 0,
    allowExplicitDisagreement: false
  },
  
  intellectualRisk: 'conservative',
  
  patterns: {
    hedgePhrases: [
      'may suggest',
      'appears to indicate',
      'could potentially',
      'seems to imply',
      'might be attributed to',
      'it is possible that',
      'evidence appears to support',
      'findings seem to suggest'
    ],
    assertivePhrases: [],
    contrastivePhrases: [
      'While some studies suggest',
      'Although findings vary',
      'Some researchers note that',
      'It has also been observed that'
    ],
    evaluativePhrases: []
  },
  
  sectionModulations: {
    // Methods can be slightly more assertive (procedural language)
    methods: {
      hedging: {
        density: 'medium',
        maxHedgePhrasesPerParagraph: 2,
        requiredAssertiveSentencesPerSection: 1
      }
    },
    // Conclusion allows slightly more synthesis
    conclusion: {
      hedging: {
        density: 'medium',
        maxHedgePhrasesPerParagraph: 3,
        requiredAssertiveSentencesPerSection: 1
      }
    }
  }
}

/**
 * Confident Early-Career Researcher
 * 
 * Moderate hedging, evaluative stance, clear position on gaps.
 * Appropriate for: Master's theses, research articles, grant proposals.
 * 
 * Characteristics:
 * - Evaluates and compares sources
 * - Identifies gaps and limitations
 * - Mixed sentence lengths with some punchy statements
 * - Selective but clear disagreement
 */
export const CONFIDENT_RESEARCHER: VoiceProfile = {
  id: 'confident-researcher',
  name: 'Confident Early-Career Researcher',
  description: 'an emerging scholar who engages critically with literature, identifies clear gaps, and takes measured positions while acknowledging limitations',
  
  literatureStance: 'evaluative',
  
  hedging: {
    density: 'medium',
    maxHedgePhrasesPerParagraph: 2,
    requiredAssertiveSentencesPerSection: 2
  },
  
  sentenceRhythm: {
    shortSentencePercentage: 25,
    maxConsecutiveLongSentences: 3,
    emphasisSentencesPerSection: 1
  },
  
  citationPosture: {
    style: 'mixed',
    minContrastiveCitationsPerSection: 1,
    allowExplicitDisagreement: true
  },
  
  intellectualRisk: 'moderate',
  
  patterns: {
    hedgePhrases: [
      'suggests',
      'indicates',
      'points to',
      'implies',
      'may reflect'
    ],
    assertivePhrases: [
      'demonstrates',
      'establishes',
      'confirms',
      'reveals',
      'shows clearly',
      'provides evidence that'
    ],
    contrastivePhrases: [
      'However,',
      'In contrast,',
      'Yet',
      'Contrary to expectations,',
      'Despite these findings,',
      'Notably,',
      'Importantly,'
    ],
    evaluativePhrases: [
      'This approach overlooks',
      'A notable limitation is',
      'This gap warrants attention',
      'These findings raise questions about',
      'This methodological choice limits',
      'Further investigation is needed'
    ]
  },
  
  sectionModulations: {
    // Introduction should establish clear position
    introduction: {
      hedging: {
        density: 'medium',
        maxHedgePhrasesPerParagraph: 2,
        requiredAssertiveSentencesPerSection: 2
      },
      intellectualRisk: 'moderate'
    },
    // Discussion can be more evaluative
    discussion: {
      literatureStance: 'evaluative',
      hedging: {
        density: 'medium',
        maxHedgePhrasesPerParagraph: 2,
        requiredAssertiveSentencesPerSection: 3
      },
      citationPosture: {
        style: 'mixed',
        minContrastiveCitationsPerSection: 2,
        allowExplicitDisagreement: true
      }
    },
    // Results should be more assertive (reporting findings)
    results: {
      hedging: {
        density: 'low',
        maxHedgePhrasesPerParagraph: 1,
        requiredAssertiveSentencesPerSection: 3
      }
    }
  }
}

/**
 * Senior Scholar
 * 
 * Low hedging, adversarial stance, explicit disagreement.
 * Appropriate for: PhD dissertations, senior faculty, theoretical contributions.
 * 
 * Characteristics:
 * - Challenges consensus when evidence supports it
 * - Short, emphatic declarative statements
 * - Fewer but heavier citations
 * - Bold intellectual positions
 */
export const SENIOR_SCHOLAR: VoiceProfile = {
  id: 'senior-scholar',
  name: 'Senior Scholar',
  description: 'an established authority who takes clear positions, challenges weak assumptions, and advances the field through bold but evidence-based argumentation',
  
  literatureStance: 'adversarial',
  
  hedging: {
    density: 'low',
    maxHedgePhrasesPerParagraph: 1,
    requiredAssertiveSentencesPerSection: 3
  },
  
  sentenceRhythm: {
    shortSentencePercentage: 30,
    maxConsecutiveLongSentences: 2,
    emphasisSentencesPerSection: 2
  },
  
  citationPosture: {
    style: 'contrastive',
    minContrastiveCitationsPerSection: 2,
    allowExplicitDisagreement: true
  },
  
  intellectualRisk: 'bold',
  
  patterns: {
    hedgePhrases: [
      'may'
    ],
    assertivePhrases: [
      'clearly demonstrates',
      'unequivocally shows',
      'proves',
      'is evident',
      'establishes definitively',
      'leaves no doubt that',
      'compellingly illustrates'
    ],
    contrastivePhrases: [
      'This is mistaken.',
      'Contrary to',
      'Despite widespread claims,',
      'This assumption fails to account for',
      'The evidence contradicts',
      'This view is untenable.',
      'A closer examination reveals'
    ],
    evaluativePhrases: [
      'This consensus warrants re-examination',
      'The evidence contradicts this assumption',
      'This framework is inadequate',
      'This methodological approach is fundamentally flawed',
      'The field has overlooked',
      'This represents a critical oversight',
      'The implications are significant'
    ]
  },
  
  sectionModulations: {
    // Methods should be assertive but procedural
    methods: {
      literatureStance: 'evaluative',
      hedging: {
        density: 'low',
        maxHedgePhrasesPerParagraph: 1,
        requiredAssertiveSentencesPerSection: 2
      }
    },
    // Introduction establishes strong framing
    introduction: {
      literatureStance: 'evaluative',
      sentenceRhythm: {
        shortSentencePercentage: 25,
        maxConsecutiveLongSentences: 3,
        emphasisSentencesPerSection: 2
      }
    },
    // Discussion is where adversarial stance shines
    discussion: {
      literatureStance: 'adversarial',
      hedging: {
        density: 'low',
        maxHedgePhrasesPerParagraph: 1,
        requiredAssertiveSentencesPerSection: 4
      },
      citationPosture: {
        style: 'contrastive',
        minContrastiveCitationsPerSection: 3,
        allowExplicitDisagreement: true
      }
    }
  }
}

/**
 * Balanced Academic (Default)
 * 
 * Medium hedging, balanced evaluative stance.
 * Appropriate for: Most academic papers, general use.
 * 
 * Characteristics:
 * - Synthesizes multiple perspectives
 * - Balanced sentence structure
 * - Mixed citation approach
 * - Moderate intellectual risk
 */
export const BALANCED_ACADEMIC: VoiceProfile = {
  id: 'balanced-academic',
  name: 'Balanced Academic',
  description: 'a thoughtful scholar who synthesizes perspectives, evaluates evidence fairly, and takes measured positions while acknowledging complexity',
  
  literatureStance: 'evaluative',
  
  hedging: {
    density: 'medium',
    maxHedgePhrasesPerParagraph: 2,
    requiredAssertiveSentencesPerSection: 1
  },
  
  sentenceRhythm: {
    shortSentencePercentage: 20,
    maxConsecutiveLongSentences: 3,
    emphasisSentencesPerSection: 1
  },
  
  citationPosture: {
    style: 'mixed',
    minContrastiveCitationsPerSection: 1,
    allowExplicitDisagreement: true
  },
  
  intellectualRisk: 'moderate',
  
  patterns: {
    hedgePhrases: [
      'suggests',
      'indicates',
      'may reflect',
      'appears to',
      'tends to'
    ],
    assertivePhrases: [
      'demonstrates',
      'shows',
      'confirms',
      'reveals',
      'establishes'
    ],
    contrastivePhrases: [
      'However,',
      'By contrast,',
      'Nevertheless,',
      'On the other hand,',
      'Conversely,',
      'That said,'
    ],
    evaluativePhrases: [
      'This raises questions about',
      'Further investigation is needed',
      'These findings warrant consideration',
      'A limitation of this approach is',
      'The evidence suggests room for'
    ]
  },
  
  sectionModulations: {
    // Results should be more assertive
    results: {
      hedging: {
        density: 'low',
        maxHedgePhrasesPerParagraph: 1,
        requiredAssertiveSentencesPerSection: 2
      }
    },
    // Discussion allows more evaluation
    discussion: {
      citationPosture: {
        style: 'mixed',
        minContrastiveCitationsPerSection: 2,
        allowExplicitDisagreement: true
      }
    },
    // Literature review needs more synthesis
    'literature-review': {
      literatureStance: 'evaluative',
      citationPosture: {
        style: 'mixed',
        minContrastiveCitationsPerSection: 2,
        allowExplicitDisagreement: true
      }
    }
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Voice Profile Registry and Utilities
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Registry of all available voice profiles
 */
export const VOICE_PROFILES: Record<VoiceProfileId, VoiceProfile> = {
  'conservative-reviewer': CONSERVATIVE_REVIEWER,
  'confident-researcher': CONFIDENT_RESEARCHER,
  'senior-scholar': SENIOR_SCHOLAR,
  'balanced-academic': BALANCED_ACADEMIC
}

/**
 * Default voice profile ID
 */
export const DEFAULT_VOICE_PROFILE_ID: VoiceProfileId = 'balanced-academic'

/**
 * Get a voice profile by ID
 */
export function getVoiceProfile(id: VoiceProfileId): VoiceProfile {
  return VOICE_PROFILES[id] || VOICE_PROFILES[DEFAULT_VOICE_PROFILE_ID]
}

/**
 * Get all available voice profile IDs
 */
export function getAvailableVoiceProfileIds(): VoiceProfileId[] {
  return Object.keys(VOICE_PROFILES) as VoiceProfileId[]
}

/**
 * Get voice profile summaries for UI display
 */
export function getVoiceProfileSummaries(): Array<{
  id: VoiceProfileId
  name: string
  description: string
  characteristics: string[]
}> {
  return [
    {
      id: 'conservative-reviewer',
      name: 'Conservative Reviewer',
      description: 'Cautious, thorough, avoids strong claims',
      characteristics: [
        'High hedging ("may suggest", "appears to indicate")',
        'Descriptive literature stance',
        'Dense citation clusters',
        'Avoids explicit disagreement'
      ]
    },
    {
      id: 'confident-researcher',
      name: 'Confident Early-Career',
      description: 'Evaluative, identifies gaps, takes measured positions',
      characteristics: [
        'Moderate hedging with clear assertions',
        'Evaluative literature stance',
        'Mixed citation approach',
        'Selective disagreement when warranted'
      ]
    },
    {
      id: 'senior-scholar',
      name: 'Senior Scholar',
      description: 'Bold, challenges assumptions, takes clear positions',
      characteristics: [
        'Low hedging ("demonstrates", "proves")',
        'Adversarial literature stance',
        'Contrastive citations',
        'Explicit disagreement with weak arguments'
      ]
    },
    {
      id: 'balanced-academic',
      name: 'Balanced Academic',
      description: 'Thoughtful, synthesizes perspectives, measured',
      characteristics: [
        'Medium hedging with balanced assertions',
        'Evaluative literature stance',
        'Mixed citation approach',
        'Moderate intellectual risk'
      ]
    }
  ]
}

/**
 * Normalize section title to section key for modulation lookup
 */
export function normalizeSectionKey(sectionTitle: string): SectionKey | null {
  const normalized = sectionTitle.toLowerCase().trim()
  
  if (normalized.includes('introduction') || normalized.includes('background')) {
    return 'introduction'
  }
  if (normalized.includes('method') || normalized.includes('approach') || normalized.includes('design')) {
    return 'methods'
  }
  if (normalized.includes('result') || normalized.includes('finding')) {
    return 'results'
  }
  if (normalized.includes('discussion') || normalized.includes('interpretation') || normalized.includes('implication')) {
    return 'discussion'
  }
  if (normalized.includes('conclusion') || normalized.includes('summary')) {
    return 'conclusion'
  }
  if (normalized.includes('literature') || normalized.includes('review') || normalized.includes('related work')) {
    return 'literature-review'
  }
  
  return null
}

/**
 * Get effective voice profile for a specific section
 * Applies section modulations to base profile
 */
export function getEffectiveVoiceProfile(
  profileId: VoiceProfileId,
  sectionTitle: string,
  overrides?: Partial<VoiceProfileCore>
): VoiceProfile {
  const baseProfile = getVoiceProfile(profileId)
  const sectionKey = normalizeSectionKey(sectionTitle)
  
  // Start with base profile
  let effectiveProfile = { ...baseProfile }
  
  // Apply section modulations if available
  if (sectionKey && baseProfile.sectionModulations[sectionKey]) {
    const modulation = baseProfile.sectionModulations[sectionKey]!
    effectiveProfile = mergeVoiceProfile(effectiveProfile, modulation)
  }
  
  // Apply custom overrides
  if (overrides) {
    effectiveProfile = mergeVoiceProfile(effectiveProfile, overrides)
  }
  
  return effectiveProfile
}

/**
 * Deep merge voice profile with partial overrides
 */
function mergeVoiceProfile(
  base: VoiceProfile,
  overrides: Partial<VoiceProfileCore>
): VoiceProfile {
  return {
    ...base,
    literatureStance: overrides.literatureStance ?? base.literatureStance,
    hedging: {
      ...base.hedging,
      ...overrides.hedging
    },
    sentenceRhythm: {
      ...base.sentenceRhythm,
      ...overrides.sentenceRhythm
    },
    citationPosture: {
      ...base.citationPosture,
      ...overrides.citationPosture
    },
    intellectualRisk: overrides.intellectualRisk ?? base.intellectualRisk,
    patterns: {
      hedgePhrases: overrides.patterns?.hedgePhrases ?? base.patterns.hedgePhrases,
      assertivePhrases: overrides.patterns?.assertivePhrases ?? base.patterns.assertivePhrases,
      contrastivePhrases: overrides.patterns?.contrastivePhrases ?? base.patterns.contrastivePhrases,
      evaluativePhrases: overrides.patterns?.evaluativePhrases ?? base.patterns.evaluativePhrases
    }
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Template Formatting Utilities
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Format voice profile for template injection
 * Converts VoiceProfile to template-ready data structure
 */
export function formatVoiceForTemplate(
  profileId: VoiceProfileId,
  sectionTitle: string,
  overrides?: Partial<VoiceProfileCore>
): TemplateVoiceData {
  const profile = getEffectiveVoiceProfile(profileId, sectionTitle, overrides)
  
  return {
    id: profile.id,
    name: profile.name,
    description: profile.description,
    literatureStance: profile.literatureStance,
    literatureStanceGuidance: getLiteratureStanceGuidance(profile.literatureStance),
    hedging: profile.hedging,
    sentenceRhythm: profile.sentenceRhythm,
    citationPosture: profile.citationPosture,
    intellectualRisk: profile.intellectualRisk,
    intellectualRiskGuidance: getIntellectualRiskGuidance(profile.intellectualRisk),
    patterns: profile.patterns
  }
}

/**
 * Template-ready voice data structure
 */
export interface TemplateVoiceData {
  id: VoiceProfileId
  name: string
  description: string
  literatureStance: LiteratureStance
  literatureStanceGuidance: string
  hedging: HedgingConfig
  sentenceRhythm: SentenceRhythmConfig
  citationPosture: CitationPostureConfig
  intellectualRisk: IntellectualRisk
  intellectualRiskGuidance: string
  patterns: VoicePatterns
}

/**
 * Get descriptive guidance for literature stance
 */
function getLiteratureStanceGuidance(stance: LiteratureStance): string {
  switch (stance) {
    case 'descriptive':
      return `Report what sources say without strong evaluative judgment. Focus on summarizing findings, 
noting patterns, and presenting the state of knowledge. Avoid taking strong positions on the validity 
of different studies. Let the evidence speak for itself.`
    
    case 'evaluative':
      return `Critically assess sources while remaining fair. Compare methodologies, note limitations, 
identify gaps, and synthesize across studies. Take measured positions on which findings are more 
robust or significant. Balance acknowledgment of contributions with honest assessment of weaknesses.`
    
    case 'adversarial':
      return `Engage critically and challenge weak assumptions. Identify flawed reasoning, methodological 
problems, and unsupported claims. Take clear positions when evidence warrants. Don't hesitate to 
disagree with established views if your analysis supports it. Advance the field through rigorous critique.`
  }
}

/**
 * Get descriptive guidance for intellectual risk
 */
function getIntellectualRiskGuidance(risk: IntellectualRisk): string {
  switch (risk) {
    case 'conservative':
      return `Stay close to what the evidence directly supports. Avoid speculation or extrapolation 
beyond the data. Acknowledge uncertainty and avoid overreaching claims. Let readers draw their 
own conclusions from the evidence presented.`
    
    case 'moderate':
      return `Take measured intellectual positions supported by evidence. Make reasonable inferences 
and identify implications, but acknowledge limitations. Propose directions for future work. Balance 
confidence in well-supported claims with appropriate caution elsewhere.`
    
    case 'bold':
      return `Take clear intellectual positions and advance arguments. Propose frameworks, challenge 
consensus, draw novel connections. Speculate thoughtfully when evidence provides foundation. 
Push the field forward through ambitious but grounded claims.`
  }
}

/**
 * Suggest appropriate voice profile based on paper type and discipline
 * Used for AI-assisted voice selection during paper profile generation
 */
export function suggestVoiceProfile(params: {
  paperType: string
  discipline?: string
  academicLevel?: 'undergraduate' | 'masters' | 'doctoral' | 'faculty'
}): {
  suggestedProfile: VoiceProfileId
  rationale: string
  alternatives: VoiceProfileId[]
} {
  const { paperType, discipline, academicLevel } = params
  const paperTypeLower = paperType.toLowerCase()
  const disciplineLower = discipline?.toLowerCase() || ''
  
  // PhD dissertations and senior work → Senior Scholar
  if (
    academicLevel === 'doctoral' ||
    academicLevel === 'faculty' ||
    paperTypeLower.includes('dissertation') ||
    paperTypeLower.includes('doctoral')
  ) {
    return {
      suggestedProfile: 'senior-scholar',
      rationale: `Doctoral and faculty-level work benefits from a senior scholar voice that takes clear positions, 
challenges assumptions, and advances the field through rigorous argumentation.`,
      alternatives: ['confident-researcher', 'balanced-academic']
    }
  }
  
  // Master's theses and research articles → Confident Researcher
  if (
    academicLevel === 'masters' ||
    paperTypeLower.includes('master') ||
    paperTypeLower.includes('thesis') ||
    paperTypeLower.includes('research article')
  ) {
    return {
      suggestedProfile: 'confident-researcher',
      rationale: `Master's-level work and research articles benefit from a confident voice that evaluates 
literature critically, identifies gaps, and takes measured positions while acknowledging limitations.`,
      alternatives: ['balanced-academic', 'senior-scholar']
    }
  }
  
  // Literature reviews → depends on level
  if (paperTypeLower.includes('literature review') || paperTypeLower.includes('review')) {
    if (academicLevel === 'undergraduate') {
      return {
        suggestedProfile: 'conservative-reviewer',
        rationale: `Undergraduate literature reviews benefit from a conservative voice that thoroughly 
reports findings without overreaching, demonstrating comprehensive coverage.`,
        alternatives: ['balanced-academic']
      }
    }
    return {
      suggestedProfile: 'balanced-academic',
      rationale: `Literature reviews benefit from a balanced voice that synthesizes perspectives fairly, 
evaluates evidence thoughtfully, and identifies patterns and gaps.`,
      alternatives: ['confident-researcher', 'conservative-reviewer']
    }
  }
  
  // Humanities and philosophy → often more adversarial/evaluative
  if (
    disciplineLower.includes('philosophy') ||
    disciplineLower.includes('humanities') ||
    disciplineLower.includes('literary') ||
    disciplineLower.includes('critical')
  ) {
    return {
      suggestedProfile: 'confident-researcher',
      rationale: `Humanities scholarship often requires taking interpretive positions and engaging 
critically with existing arguments. A confident, evaluative voice fits these conventions.`,
      alternatives: ['senior-scholar', 'balanced-academic']
    }
  }
  
  // STEM fields with empirical focus → balanced with assertive results
  if (
    disciplineLower.includes('science') ||
    disciplineLower.includes('engineering') ||
    disciplineLower.includes('medical') ||
    disciplineLower.includes('biology') ||
    disciplineLower.includes('chemistry') ||
    disciplineLower.includes('physics')
  ) {
    return {
      suggestedProfile: 'balanced-academic',
      rationale: `STEM research benefits from a balanced voice that reports findings clearly, 
evaluates methods critically, and maintains appropriate caution about generalization.`,
      alternatives: ['confident-researcher', 'conservative-reviewer']
    }
  }
  
  // Social sciences → balanced to confident
  if (
    disciplineLower.includes('social') ||
    disciplineLower.includes('psychology') ||
    disciplineLower.includes('sociology') ||
    disciplineLower.includes('economics') ||
    disciplineLower.includes('political')
  ) {
    return {
      suggestedProfile: 'balanced-academic',
      rationale: `Social science research benefits from a balanced voice that synthesizes 
diverse perspectives, acknowledges methodological complexities, and draws measured conclusions.`,
      alternatives: ['confident-researcher', 'conservative-reviewer']
    }
  }
  
  // Default → Balanced Academic
  return {
    suggestedProfile: 'balanced-academic',
    rationale: `The balanced academic voice provides a versatile foundation that works across 
disciplines and paper types, combining fair evaluation with measured positioning.`,
    alternatives: ['confident-researcher', 'conservative-reviewer']
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Condensed Voice Context for Chat/Autocomplete
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Condensed voice context for chat and autocomplete
 * Lighter than full template voice data, optimized for smaller context windows
 */
export interface CondensedVoiceContext {
  /** Profile name for display */
  name: string
  /** Brief description of the persona */
  persona: string
  /** Key guidance for hedging/confidence */
  hedgingGuidance: string
  /** Key guidance for citations */
  citationGuidance: string
  /** Sample phrases to use (limited set) */
  samplePhrases: {
    hedge: string[]
    assertive: string[]
    contrastive: string[]
  }
}

/**
 * Build condensed voice context for chat/autocomplete
 * Provides essential voice guidance without overwhelming the context window
 * 
 * @param profileId - Voice profile to use
 * @returns Condensed voice context or undefined if no profile
 */
export function buildCondensedVoiceContext(
  profileId: VoiceProfileId | undefined | null
): CondensedVoiceContext | undefined {
  if (!profileId) return undefined
  
  const profile = getVoiceProfile(profileId)
  
  // Build hedging guidance based on density
  let hedgingGuidance: string
  switch (profile.hedging.density) {
    case 'high':
      hedgingGuidance = 'Use hedging liberally (may, could, suggests, appears to). Avoid definitive claims.'
      break
    case 'medium':
      hedgingGuidance = 'Balance confidence with caution. Hedge uncertain claims, be direct about well-supported findings.'
      break
    case 'low':
      hedgingGuidance = 'Write with confidence. Use clear, direct statements. Reserve hedging for genuinely uncertain claims.'
      break
  }
  
  // Build citation guidance based on style
  let citationGuidance: string
  switch (profile.citationPosture.style) {
    case 'supportive':
      citationGuidance = 'Cite to support and substantiate. Avoid confrontational framing.'
      break
    case 'contrastive':
      citationGuidance = 'Engage critically with sources. Compare, contrast, and challenge weak positions.'
      break
    case 'mixed':
      citationGuidance = 'Balance supportive and contrastive citations. Build arguments while noting tensions.'
      break
  }
  
  // Add disagreement note if allowed
  if (profile.citationPosture.allowExplicitDisagreement) {
    citationGuidance += ' You may explicitly disagree with sources when evidence supports it.'
  }
  
  return {
    name: profile.name,
    persona: profile.description,
    hedgingGuidance,
    citationGuidance,
    samplePhrases: {
      hedge: profile.patterns.hedgePhrases.slice(0, 3),
      assertive: profile.patterns.assertivePhrases.slice(0, 3),
      contrastive: profile.patterns.contrastivePhrases.slice(0, 3)
    }
  }
}

/**
 * Format condensed voice context for template injection
 * Returns a string suitable for including in chat/autocomplete prompts
 */
export function formatCondensedVoiceForPrompt(
  profileId: VoiceProfileId | undefined | null
): string {
  const context = buildCondensedVoiceContext(profileId)
  if (!context) return ''
  
  return `## Project Voice: ${context.name}

**Persona:** ${context.persona}

**Hedging:** ${context.hedgingGuidance}
**Citations:** ${context.citationGuidance}

**Preferred phrases:**
- Hedge: "${context.samplePhrases.hedge.join('", "')}"
- Assertive: "${context.samplePhrases.assertive.join('", "')}"
- Contrastive: "${context.samplePhrases.contrastive.join('", "')}"`
}

/**
 * Check if an action type should include voice context
 * Content-generating actions need voice; mechanical edits don't
 */
export function shouldIncludeVoiceForAction(
  actionType: 'write' | 'edit' | 'explain' | 'cite' | 'suggest' | 'analyze' | 'general'
): boolean {
  // Actions that produce academic prose should use voice
  const contentGeneratingActions = ['write', 'edit', 'cite']
  return contentGeneratingActions.includes(actionType)
}
