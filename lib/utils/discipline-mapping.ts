/**
 * Discipline Mapping Utilities
 * 
 * Maps academic disciplines to OpenAlex concept IDs for API-level filtering.
 * 
 * DESIGN PHILOSOPHY:
 * - OpenAlex concept IDs are EXTERNAL IDENTIFIERS that we must map to (necessary lookup table)
 * - Wrong-discipline detection is done CONTEXTUALLY by the LLM, not hardcoded keyword lists
 * - The paper profile already identifies the discipline dynamically based on the topic
 * 
 * OpenAlex concepts are hierarchical - we use both broad and specific concepts.
 * See: https://docs.openalex.org/api-entities/concepts
 */

/**
 * OpenAlex concept IDs for academic disciplines.
 * These are EXTERNAL IDENTIFIERS from OpenAlex's taxonomy - we cannot generate them dynamically.
 * The discipline NAME comes from the LLM (context-aware), this just maps to the API identifier.
 * 
 * Format: Discipline name (case-insensitive) -> OpenAlex concept ID
 */
export const DISCIPLINE_TO_OPENALEX_CONCEPT: Record<string, string> = {
  // Humanities - Literature & Language
  'literature': 'C124952713',
  'american literature': 'C5399437',
  'english literature': 'C83081985',
  'english studies': 'C68333046',
  'comparative literature': 'C178985255',
  'world literature': 'C756385',
  'literary criticism': 'C124952713',
  'literary studies': 'C124952713',
  'english language and literature': 'C83081985',
  
  // Humanities - History
  'history': 'C95457728',
  'american history': 'C95457728',
  'modern history': 'C95457728',
  'cultural history': 'C95457728',
  
  // Humanities - Philosophy & Religion
  'philosophy': 'C138885662',
  'religious studies': 'C39549134',
  'theology': 'C39549134',
  'ethics': 'C138885662',
  
  // Humanities - Arts
  'art': 'C142362112',
  'art history': 'C142362112',
  'visual arts': 'C142362112',
  'music': 'C127413603',
  'film studies': 'C142362112',
  
  // Social Sciences
  'sociology': 'C144024400',
  'psychology': 'C15744967',
  'political science': 'C17744445',
  'economics': 'C162324750',
  'anthropology': 'C107993555',
  'geography': 'C205649164',
  'education': 'C185592680',
  'law': 'C111919701',
  'communication': 'C31972630',
  'linguistics': 'C41895202',
  
  // STEM
  'computer science': 'C41008148',
  'mathematics': 'C33923547',
  'physics': 'C121332964',
  'chemistry': 'C185592680',
  'biology': 'C86803240',
  'engineering': 'C127413603',
  'medicine': 'C71924100',
  'environmental science': 'C39432304',
  
  // Business
  'business': 'C144133560',
  'management': 'C144133560',
  'marketing': 'C144133560',
  'finance': 'C162324750',
}

/**
 * Related concepts to include when filtering by a discipline.
 * This broadens the search to include closely related fields.
 */
export const DISCIPLINE_RELATED_CONCEPTS: Record<string, string[]> = {
  'american literature': ['C124952713', 'C83081985'], // Literature, English Literature
  'english literature': ['C124952713', 'C5399437'], // Literature, American Literature
  'literature': ['C83081985', 'C5399437', 'C178985255'], // English Lit, American Lit, Comparative
  'history': ['C95457728'],
  'philosophy': ['C138885662', 'C39549134'], // Philosophy, Religious Studies
  'religious studies': ['C39549134', 'C138885662'], // Religion, Philosophy
}

/**
 * Get OpenAlex concept ID for a discipline.
 * Performs case-insensitive matching and handles common variations.
 * 
 * @param discipline - The discipline name from the paper profile (LLM-determined)
 * @returns OpenAlex concept ID or undefined if no mapping exists
 */
export function getOpenAlexConceptId(discipline: string): string | undefined {
  const normalized = discipline.toLowerCase().trim()
  
  // Direct match
  if (DISCIPLINE_TO_OPENALEX_CONCEPT[normalized]) {
    return DISCIPLINE_TO_OPENALEX_CONCEPT[normalized]
  }
  
  // Try partial matching for compound disciplines
  // e.g., "American Literature and Culture" should match "american literature"
  for (const [key, value] of Object.entries(DISCIPLINE_TO_OPENALEX_CONCEPT)) {
    if (normalized.includes(key) || key.includes(normalized)) {
      return value
    }
  }
  
  return undefined
}

/**
 * Get all OpenAlex concept IDs for a discipline (primary + related).
 * Returns multiple concepts to broaden the search while staying in-discipline.
 * 
 * @param discipline - The discipline name
 * @returns Array of OpenAlex concept IDs
 */
export function getOpenAlexConceptIds(discipline: string): string[] {
  const normalized = discipline.toLowerCase().trim()
  const concepts: string[] = []
  
  // Add primary concept
  const primary = getOpenAlexConceptId(discipline)
  if (primary) {
    concepts.push(primary)
  }
  
  // Add related concepts
  const related = DISCIPLINE_RELATED_CONCEPTS[normalized]
  if (related) {
    for (const concept of related) {
      if (!concepts.includes(concept)) {
        concepts.push(concept)
      }
    }
  }
  
  return concepts
}

/**
 * Check if a discipline has a known OpenAlex concept mapping.
 * If it does, concept filtering should be applied.
 * 
 * This is NOT hardcoded logic - it simply checks if we have an external ID to use.
 * The discipline itself is determined by the LLM based on the topic.
 * 
 * @param discipline - The discipline to check (from LLM-generated paper profile)
 * @returns true if we have a concept ID to filter with
 */
export function shouldApplyConceptFilter(discipline: string): boolean {
  return getOpenAlexConceptId(discipline) !== undefined
}

/**
 * REMOVED: Hardcoded wrong-discipline keyword lists
 * 
 * The old approach used static keyword lists like:
 * - "regression analysis" is bad for literature
 * - "voting behavior" is bad for literature
 * 
 * This was problematic because:
 * 1. It's not context-aware (what if the topic IS about statistical methods in literature?)
 * 2. It requires maintenance for every discipline combination
 * 3. It creates false positives/negatives
 * 
 * NEW APPROACH: Context-aware filtering happens through:
 * 1. OpenAlex concept filtering at the API level (most effective)
 * 2. LLM-based query rewriting that includes discipline context
 * 3. Semantic similarity scoring during re-ranking
 * 
 * The LLM in query-rewrite.ts now receives discipline context and generates
 * appropriate search terms, avoiding wrong-discipline results naturally.
 */

/**
 * Stub function for backward compatibility.
 * Returns false - we no longer use hardcoded keyword filtering.
 * 
 * Wrong-discipline detection is now handled by:
 * 1. OpenAlex concept filtering
 * 2. Discipline-aware query rewriting
 * 3. Semantic similarity thresholds
 */
export function hasWrongDisciplineIndicator(
  _text: string,
  _discipline: string,
  _queryText: string
): boolean {
  // No longer using hardcoded keyword lists
  // Filtering happens through concept IDs and semantic similarity
  return false
}
