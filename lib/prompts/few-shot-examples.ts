/**
 * Data-driven few-shot examples system for academic writing
 * Enhanced with schema validation, pluggable scoring, and flexible region handling
 * 
 * IMPROVEMENTS:
 * - JSON schema validation with Zod
 * - Pluggable scoring weights configuration
 * - Generic region/locale handling
 * - Optimized diversity filtering
 * - Stable content-based IDs
 */

import { PaperTypeKey, SectionKey } from './types';
import examplesData from './examples.json';
import { z } from 'zod';

// Schema validation for examples data
const FewShotExampleSchema = z.object({
  id: z.string().min(1),
  paperType: z.enum(['mastersThesis', 'phdDissertation']),
  section: z.enum(['introduction', 'literatureReview', 'methodology', 'discussion', 'conclusion']),
  country: z.string().min(1),
  field: z.string().min(1),
  institution: z.string().min(1),
  metadata: z.object({
    year: z.number().min(1990).max(new Date().getFullYear() + 1),
    author: z.string().min(1),
    title: z.string().min(1)
  }),
  content: z.string().min(50) // Ensure meaningful content length
});

const ExamplesDataSchema = z.object({
  fewShotExamples: z.array(FewShotExampleSchema).min(1)
});

export interface FewShotExample {
  id: string;
  paperType: PaperTypeKey;
  section: SectionKey;
  country: string;
  field: string;
  institution: string;
  metadata: {
    year: number;
    author: string;
    title: string;
  };
  content: string;
}

export interface ScoringWeights {
  baseMatch: number;        // Base score for paper type + section match
  regionBonus: number;      // Bonus for preferred region match
  fieldBonus: number;       // Bonus for preferred field match
  recencyBonus: number;     // Max bonus for recent examples
  qualityBonus: number;     // Base quality bonus
}

export interface ExampleSelectionOptions {
  paperType: PaperTypeKey;
  section: SectionKey;
  preferredRegion?: string;
  preferredField?: string;
  maxExamples?: number;
  ensureDiversity?: boolean;
  scoringWeights?: Partial<ScoringWeights>;
}

export interface ExampleStatistics {
  totalExamples: number;
  byCountry: Record<string, number>;
  byField: Record<string, number>;
  byPaperType: Record<string, number>;
  bySection: Record<string, number>;
}

export interface ValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

// Default scoring weights (now configurable)
const DEFAULT_SCORING_WEIGHTS: ScoringWeights = {
  baseMatch: 10,
  regionBonus: 5,
  fieldBonus: 3,
  recencyBonus: 2,
  qualityBonus: 1
};

// High-stakes paper types that support few-shot examples
const HIGH_STAKES_TYPES: PaperTypeKey[] = ['mastersThesis', 'phdDissertation'];

// Validated examples data (cached after first validation)
let validatedExamples: FewShotExample[] | null = null;

/**
 * Validate and cache examples data on first access
 */
function getValidatedExamples(): FewShotExample[] {
  if (validatedExamples !== null) {
    return validatedExamples;
  }

  try {
    const validation = ExamplesDataSchema.parse(examplesData);
    validatedExamples = validation.fewShotExamples as FewShotExample[];
    return validatedExamples;
  } catch (error) {
    if (error instanceof z.ZodError) {
      const errorMessages = error.errors.map(err => 
        `${err.path.join('.')}: ${err.message}`
      ).join('; ');
      throw new Error(`Examples data validation failed: ${errorMessages}`);
    }
    throw new Error(`Failed to load examples data: ${error}`);
  }
}

/**
 * Get few-shot examples based on selection criteria
 * Uses intelligent scoring and sorting to provide the best examples
 */
export function getFewShotExamples(
  paperType: PaperTypeKey,
  section: SectionKey,
  preferredRegion?: string,
  preferredField?: string,
  maxExamples: number = 1,
  scoringWeights?: Partial<ScoringWeights>
): FewShotExample[] {
  // Only provide examples for high-stakes paper types
  if (!HIGH_STAKES_TYPES.includes(paperType)) {
    return [];
  }

  const examples = getValidatedExamples();
  const weights = { ...DEFAULT_SCORING_WEIGHTS, ...scoringWeights };

  const options: ExampleSelectionOptions = {
    paperType,
    section,
    preferredRegion,
    preferredField,
    maxExamples,
    ensureDiversity: maxExamples > 1,
    scoringWeights: weights
  };

  // Filter and score all matching examples
  const candidates = examples
    .map(example => ({
      example,
      score: scoreExample(example, options)
    }))
    .filter(({ score }) => score >= weights.baseMatch) // Only include if meets base threshold
    .sort((a, b) => b.score - a.score);

  if (candidates.length === 0) {
    return [];
  }

  // Apply diversity constraints if needed
  if (options.ensureDiversity && candidates.length > 1) {
    return selectDiverseExamples(candidates.map(c => c.example), maxExamples);
  }

  return candidates.slice(0, maxExamples).map(c => c.example);
}

/**
 * Score an example based on how well it matches the selection criteria
 * Now uses configurable weights
 */
function scoreExample(example: FewShotExample, options: ExampleSelectionOptions): number {
  const weights: ScoringWeights = { ...DEFAULT_SCORING_WEIGHTS, ...options.scoringWeights };
  let score = 0;

  // Must match paper type and section
  if (example.paperType !== options.paperType || example.section !== options.section) {
    return 0;
  }

  // Base score for exact match
  score += weights.baseMatch;

  // Regional preference bonus (flexible region matching)
  if (options.preferredRegion) {
    if (example.country.toLowerCase() === options.preferredRegion.toLowerCase()) {
      score += weights.regionBonus;
    } else if (isFromSameRegion(example.country, options.preferredRegion)) {
      score += Math.floor(weights.regionBonus * 0.5); // Half bonus for same region
    }
  }

  // Field preference bonus
  if (options.preferredField && example.field.toLowerCase().includes(options.preferredField.toLowerCase())) {
    score += weights.fieldBonus;
  }

  // Recency bonus (scaled by age)
  const currentYear = new Date().getFullYear();
  const age = currentYear - example.metadata.year;
  if (age <= 5) {
    score += weights.recencyBonus;
  } else if (age <= 10) {
    score += Math.floor(weights.recencyBonus * 0.5);
  }

  // Quality bonus
  score += weights.qualityBonus;

  return score;
}

/**
 * Enhanced region grouping for flexible geographic matching
 */
function isFromSameRegion(country1: string, country2: string): boolean {
  const regions = {
    'africa': ['nigeria', 'ghana', 'kenya', 'south africa', 'uganda', 'tanzania', 'ethiopia', 'morocco'],
    'asia': ['india', 'china', 'japan', 'singapore', 'thailand', 'indonesia', 'south korea', 'malaysia'],
    'europe': ['uk', 'germany', 'france', 'netherlands', 'sweden', 'italy', 'spain', 'switzerland'],
    'north_america': ['usa', 'canada', 'mexico'],
    'south_america': ['brazil', 'argentina', 'chile', 'colombia', 'peru'],
    'oceania': ['australia', 'new zealand'],
    'middle_east': ['uae', 'israel', 'saudi arabia', 'qatar', 'iran']
  };
  
  const c1 = country1.toLowerCase();
  const c2 = country2.toLowerCase();
  
  for (const regionCountries of Object.values(regions)) {
    if (regionCountries.includes(c1) && regionCountries.includes(c2)) {
      return true;
    }
  }
  
  return false;
}

/**
 * Optimized diversity selection using grouping to avoid O(n²) loops
 */
function selectDiverseExamples(examples: FewShotExample[], maxCount: number): FewShotExample[] {
  if (examples.length <= maxCount) {
    return examples;
  }

  const selected: FewShotExample[] = [];
  
  // Group by country for efficient selection
  const byCountry = examples.reduce((acc, example) => {
    const country = example.country;
    if (!acc[country]) acc[country] = [];
    acc[country].push(example);
    return acc;
  }, {} as Record<string, FewShotExample[]>);

  // First pass: select one from each country
  const countries = Object.keys(byCountry);
  for (let i = 0; i < countries.length && selected.length < maxCount; i++) {
    const country = countries[i];
    selected.push(byCountry[country][0]); // Take the highest-scored from each country
  }

  // Second pass: fill remaining slots from institutions not yet used
  const usedInstitutions = new Set(selected.map(ex => ex.institution));
  for (const example of examples) {
    if (selected.length >= maxCount) break;
    if (!selected.includes(example) && !usedInstitutions.has(example.institution)) {
      selected.push(example);
      usedInstitutions.add(example.institution);
    }
  }

  // Third pass: fill any remaining slots
  for (const example of examples) {
    if (selected.length >= maxCount) break;
    if (!selected.includes(example)) {
      selected.push(example);
    }
  }

  return selected.slice(0, maxCount);
}

/**
 * Format examples for inclusion in prompts
 */
export function formatFewShotExamples(examples: FewShotExample[]): string {
  if (examples.length === 0) {
    return '';
  }

  const header = `Below are examples of exceptional, examiner-approved academic writing. Notice their analytical depth, critical evaluation, and scholarly tone:`;
  
  const formattedExamples = examples.map((example, index) => {
    const exampleHeader = `Example ${index + 1}: ${example.section.charAt(0).toUpperCase() + example.section.slice(1)} from ${example.metadata.title} (${example.metadata.author}, ${example.metadata.year})`;
    const institutionInfo = `Institution: ${example.institution}, ${example.country}`;
    
    return `${exampleHeader}\n${institutionInfo}\n\n${example.content}`;
  }).join('\n\n---\n\n');

  const footer = `Now, using this style and level of depth, write your own section.`;

  return `${header}\n\n${formattedExamples}\n\n${footer}`;
}

/**
 * Check if few-shot examples are available for a paper type and section combination
 */
export function hasFewShotExamples(paperType: PaperTypeKey, section: SectionKey): boolean {
  // Only high-stakes types support few-shot
  if (!HIGH_STAKES_TYPES.includes(paperType)) {
    return false;
  }

  try {
    const examples = getValidatedExamples();
    return examples.some(
      example => example.paperType === paperType && example.section === section
    );
  } catch {
    return false; // If validation fails, no examples available
  }
}

/**
 * Get all available sections for a given paper type
 */
export function getAvailableFewShotSections(paperType: PaperTypeKey): SectionKey[] {
  // Only high-stakes types support few-shot
  if (!HIGH_STAKES_TYPES.includes(paperType)) {
    return [];
  }

  try {
    const examples = getValidatedExamples();
    const availableSections = examples
      .filter(example => example.paperType === paperType)
      .map(example => example.section);

    // Return unique sections
    return [...new Set(availableSections)];
  } catch {
    return [];
  }
}

/**
 * Get statistics about the examples database
 */
export function getExampleStatistics(): ExampleStatistics {
  try {
    const examples = getValidatedExamples();
    
    const stats: ExampleStatistics = {
      totalExamples: examples.length,
      byCountry: {},
      byField: {},
      byPaperType: {},
      bySection: {}
    };

    examples.forEach(example => {
      stats.byCountry[example.country] = (stats.byCountry[example.country] || 0) + 1;
      stats.byField[example.field] = (stats.byField[example.field] || 0) + 1;
      stats.byPaperType[example.paperType] = (stats.byPaperType[example.paperType] || 0) + 1;
      stats.bySection[example.section] = (stats.bySection[example.section] || 0) + 1;
    });

    return stats;
  } catch {
    return {
      totalExamples: 0,
      byCountry: {},
      byField: {},
      byPaperType: {},
      bySection: {}
    };
  }
}

/**
 * Enhanced validation with detailed schema checking
 */
export function validateExamplesData(): ValidationResult {
  const result: ValidationResult = {
    isValid: true,
    errors: [],
    warnings: []
  };

  try {
    const validation = ExamplesDataSchema.safeParse(examplesData);
    
    if (!validation.success) {
      result.isValid = false;
      result.errors = validation.error.errors.map(err => 
        `${err.path.join('.')}: ${err.message}`
      );
      return result;
    }

    const examples = validation.data.fewShotExamples;

    // Additional business logic validation
    const seenIds = new Set<string>();
    examples.forEach((example, index) => {
      const prefix = `Example ${index + 1}`;
      
      // Check for duplicate IDs
      if (seenIds.has(example.id)) {
        result.errors.push(`${prefix}: Duplicate ID '${example.id}'`);
      }
      seenIds.add(example.id);
      
      // Content quality warnings
      if (example.content.length < 200) {
        result.warnings.push(`${prefix}: Content seems short (${example.content.length} chars)`);
      }
      
      if (example.content.length > 3000) {
        result.warnings.push(`${prefix}: Content is very long (${example.content.length} chars)`);
      }
    });

    // Coverage warnings
    const paperTypes = new Set(examples.map(e => e.paperType));
    const sections = new Set(examples.map(e => e.section));
    
    if (!paperTypes.has('mastersThesis')) {
      result.warnings.push('No examples for mastersThesis');
    }
    if (!paperTypes.has('phdDissertation')) {
      result.warnings.push('No examples for phdDissertation');
    }
    if (!sections.has('introduction')) {
      result.warnings.push('No examples for introduction section');
    }
    if (!sections.has('literatureReview')) {
      result.warnings.push('No examples for literatureReview section');
    }

  } catch (error) {
    result.errors.push(`Failed to validate examples data: ${error}`);
    result.isValid = false;
  }

  result.isValid = result.errors.length === 0;
  return result;
}

/**
 * Utility: Generate stable content-based ID for examples
 */
export function generateStableId(author: string, title: string, year: number): string {
  // Simple hash function for stable IDs
  const input = `${author}-${title}-${year}`.toLowerCase().replace(/\s+/g, '-');
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    const char = input.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return `example-${Math.abs(hash).toString(36)}`;
}

/**
 * Export scoring weights for external configuration
 */
export { DEFAULT_SCORING_WEIGHTS }; 