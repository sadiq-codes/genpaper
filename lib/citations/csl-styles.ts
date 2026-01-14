/**
 * CSL Citation Styles Database
 * 
 * Contains a curated list of the most commonly used citation styles
 * organized by category for easy searching.
 * 
 * Style IDs match the CSL style repository: https://github.com/citation-style-language/styles
 */

export interface CSLStyleInfo {
  id: string          // CSL style ID (e.g., 'apa', 'ieee', 'nature')
  name: string        // Human readable name
  shortName?: string  // Abbreviated name for UI
  category: CSLStyleCategory
  inlineExample: string  // Example inline citation
  popular?: boolean   // Flag for commonly used styles
}

export type CSLStyleCategory = 
  | 'author-date'     // (Author, Year) format
  | 'numeric'         // [1] format
  | 'note'            // Footnote-based
  | 'label'           // [ABC12] format

/**
 * Curated list of popular citation styles
 * Organized by frequency of use and academic discipline
 */
export const CSL_STYLES: CSLStyleInfo[] = [
  // ============ MOST POPULAR (Author-Date) ============
  {
    id: 'apa',
    name: 'American Psychological Association 7th edition',
    shortName: 'APA 7th',
    category: 'author-date',
    inlineExample: '(Smith et al., 2023)',
    popular: true,
  },
  {
    id: 'apa-6th-edition',
    name: 'American Psychological Association 6th edition',
    shortName: 'APA 6th',
    category: 'author-date',
    inlineExample: '(Smith et al., 2023)',
    popular: true,
  },
  {
    id: 'chicago-author-date',
    name: 'Chicago Manual of Style 17th edition (author-date)',
    shortName: 'Chicago Author-Date',
    category: 'author-date',
    inlineExample: '(Smith et al. 2023)',
    popular: true,
  },
  {
    id: 'harvard-cite-them-right',
    name: 'Harvard - Cite Them Right 12th edition',
    shortName: 'Harvard',
    category: 'author-date',
    inlineExample: '(Smith et al., 2023)',
    popular: true,
  },
  {
    id: 'modern-language-association',
    name: 'Modern Language Association 9th edition',
    shortName: 'MLA 9th',
    category: 'author-date',
    inlineExample: '(Smith et al.)',
    popular: true,
  },
  {
    id: 'modern-language-association-8th-edition',
    name: 'Modern Language Association 8th edition',
    shortName: 'MLA 8th',
    category: 'author-date',
    inlineExample: '(Smith et al.)',
    popular: true,
  },

  // ============ NUMERIC STYLES ============
  {
    id: 'ieee',
    name: 'IEEE',
    shortName: 'IEEE',
    category: 'numeric',
    inlineExample: '[1]',
    popular: true,
  },
  {
    id: 'vancouver',
    name: 'Vancouver',
    shortName: 'Vancouver',
    category: 'numeric',
    inlineExample: '[1]',
    popular: true,
  },
  {
    id: 'vancouver-superscript',
    name: 'Vancouver (superscript)',
    shortName: 'Vancouver Sup',
    category: 'numeric',
    inlineExample: '¹',
    popular: true,
  },
  {
    id: 'american-medical-association',
    name: 'American Medical Association 11th edition',
    shortName: 'AMA 11th',
    category: 'numeric',
    inlineExample: '¹',
    popular: true,
  },
  {
    id: 'nature',
    name: 'Nature',
    shortName: 'Nature',
    category: 'numeric',
    inlineExample: '¹',
    popular: true,
  },
  {
    id: 'science',
    name: 'Science',
    shortName: 'Science',
    category: 'numeric',
    inlineExample: '(1)',
    popular: true,
  },
  {
    id: 'cell',
    name: 'Cell',
    shortName: 'Cell',
    category: 'numeric',
    inlineExample: '¹',
    popular: true,
  },
  {
    id: 'pnas',
    name: 'Proceedings of the National Academy of Sciences',
    shortName: 'PNAS',
    category: 'numeric',
    inlineExample: '(1)',
    popular: true,
  },
  {
    id: 'plos',
    name: 'PLOS',
    shortName: 'PLOS',
    category: 'numeric',
    inlineExample: '[1]',
    popular: true,
  },
  {
    id: 'biomed-central',
    name: 'BioMed Central',
    shortName: 'BMC',
    category: 'numeric',
    inlineExample: '[1]',
    popular: true,
  },
  {
    id: 'springer-basic-brackets',
    name: 'Springer - Basic (numeric, brackets)',
    shortName: 'Springer Numeric',
    category: 'numeric',
    inlineExample: '[1]',
  },
  {
    id: 'elsevier-vancouver',
    name: 'Elsevier - Vancouver',
    shortName: 'Elsevier Vancouver',
    category: 'numeric',
    inlineExample: '[1]',
  },
  {
    id: 'elsevier-with-titles',
    name: 'Elsevier (numeric, with titles)',
    shortName: 'Elsevier Numeric',
    category: 'numeric',
    inlineExample: '[1]',
  },

  // ============ NOTE STYLES (Footnotes) ============
  {
    id: 'chicago-note-bibliography',
    name: 'Chicago Manual of Style 17th edition (note)',
    shortName: 'Chicago Notes',
    category: 'note',
    inlineExample: '¹',
    popular: true,
  },
  {
    id: 'turabian-fullnote-bibliography',
    name: 'Turabian 9th edition (full note)',
    shortName: 'Turabian',
    category: 'note',
    inlineExample: '¹',
    popular: true,
  },
  {
    id: 'oscola',
    name: 'OSCOLA (Oxford University Standard for Citation of Legal Authorities)',
    shortName: 'OSCOLA',
    category: 'note',
    inlineExample: '¹',
  },
  {
    id: 'bluebook-law-review',
    name: 'Bluebook Law Review',
    shortName: 'Bluebook',
    category: 'note',
    inlineExample: '¹',
  },
  {
    id: 'mcgill-en',
    name: 'McGill Guide 9th edition',
    shortName: 'McGill',
    category: 'note',
    inlineExample: '¹',
  },

  // ============ AUTHOR-DATE (By Discipline) ============
  // Social Sciences
  {
    id: 'american-sociological-association',
    name: 'American Sociological Association 6th edition',
    shortName: 'ASA 6th',
    category: 'author-date',
    inlineExample: '(Smith et al. 2023)',
  },
  {
    id: 'american-political-science-association',
    name: 'American Political Science Association',
    shortName: 'APSA',
    category: 'author-date',
    inlineExample: '(Smith et al. 2023)',
  },
  {
    id: 'american-anthropological-association',
    name: 'American Anthropological Association',
    shortName: 'AAA',
    category: 'author-date',
    inlineExample: '(Smith et al. 2023)',
  },

  // Natural Sciences
  {
    id: 'council-of-science-editors',
    name: 'Council of Science Editors (author-date)',
    shortName: 'CSE Author-Date',
    category: 'author-date',
    inlineExample: '(Smith et al. 2023)',
  },
  {
    id: 'council-of-science-editors-citation-sequence',
    name: 'Council of Science Editors (citation-sequence)',
    shortName: 'CSE Numeric',
    category: 'numeric',
    inlineExample: '[1]',
  },
  {
    id: 'american-chemical-society',
    name: 'American Chemical Society',
    shortName: 'ACS',
    category: 'numeric',
    inlineExample: '(1)',
  },
  {
    id: 'royal-society-of-chemistry',
    name: 'Royal Society of Chemistry',
    shortName: 'RSC',
    category: 'numeric',
    inlineExample: '¹',
  },
  {
    id: 'american-physics-society',
    name: 'American Physical Society',
    shortName: 'APS',
    category: 'numeric',
    inlineExample: '[1]',
  },
  {
    id: 'american-institute-of-physics',
    name: 'American Institute of Physics',
    shortName: 'AIP',
    category: 'numeric',
    inlineExample: '¹',
  },
  {
    id: 'american-geophysical-union',
    name: 'American Geophysical Union',
    shortName: 'AGU',
    category: 'author-date',
    inlineExample: '(Smith et al., 2023)',
  },

  // Humanities
  {
    id: 'american-historical-association',
    name: 'American Historical Association',
    shortName: 'AHA',
    category: 'note',
    inlineExample: '¹',
  },

  // Engineering & Computer Science
  {
    id: 'acm-sig-proceedings',
    name: 'ACM SIG Proceedings',
    shortName: 'ACM',
    category: 'numeric',
    inlineExample: '[1]',
  },
  {
    id: 'association-for-computing-machinery',
    name: 'Association for Computing Machinery',
    shortName: 'ACM Full',
    category: 'numeric',
    inlineExample: '[1]',
  },

  // Business
  {
    id: 'harvard-business-review',
    name: 'Harvard Business Review',
    shortName: 'HBR',
    category: 'author-date',
    inlineExample: '(Smith et al., 2023)',
  },

  // Regional Styles
  {
    id: 'iso690-author-date-en',
    name: 'ISO-690 (author-date, English)',
    shortName: 'ISO-690',
    category: 'author-date',
    inlineExample: '(SMITH et al., 2023)',
  },
  {
    id: 'iso690-numeric-en',
    name: 'ISO-690 (numeric, English)',
    shortName: 'ISO-690 Numeric',
    category: 'numeric',
    inlineExample: '[1]',
  },
  {
    id: 'din-1505-2',
    name: 'DIN 1505-2 (numeric)',
    shortName: 'DIN 1505-2',
    category: 'numeric',
    inlineExample: '[1]',
  },
  {
    id: 'gost-r-7-0-5-2008',
    name: 'GOST R 7.0.5-2008 (Russian)',
    shortName: 'GOST',
    category: 'author-date',
    inlineExample: '(Smith et al., 2023)',
  },

  // Publisher Specific
  {
    id: 'taylor-and-francis-chicago-author-date',
    name: 'Taylor & Francis - Chicago Author-Date',
    shortName: 'T&F Chicago',
    category: 'author-date',
    inlineExample: '(Smith et al. 2023)',
  },
  {
    id: 'sage-harvard',
    name: 'SAGE - Harvard',
    shortName: 'SAGE Harvard',
    category: 'author-date',
    inlineExample: '(Smith et al., 2023)',
  },
  {
    id: 'apa-no-doi-no-issue',
    name: 'APA (no DOI, no issue)',
    shortName: 'APA No DOI',
    category: 'author-date',
    inlineExample: '(Smith et al., 2023)',
  },

  // More Numeric Styles for Journals
  {
    id: 'lancet',
    name: 'The Lancet',
    shortName: 'Lancet',
    category: 'numeric',
    inlineExample: '¹',
  },
  {
    id: 'bmj',
    name: 'BMJ',
    shortName: 'BMJ',
    category: 'numeric',
    inlineExample: '¹',
  },
  {
    id: 'jama',
    name: 'JAMA - Journal of the American Medical Association',
    shortName: 'JAMA',
    category: 'numeric',
    inlineExample: '¹',
  },
  {
    id: 'new-england-journal-of-medicine',
    name: 'New England Journal of Medicine',
    shortName: 'NEJM',
    category: 'numeric',
    inlineExample: '¹',
  },
  {
    id: 'annals-of-internal-medicine',
    name: 'Annals of Internal Medicine',
    shortName: 'Ann Int Med',
    category: 'numeric',
    inlineExample: '¹',
  },
  {
    id: 'springer-humanities-author-date',
    name: 'Springer - Humanities (author-date)',
    shortName: 'Springer Humanities',
    category: 'author-date',
    inlineExample: '(Smith et al. 2023)',
  },
  {
    id: 'springer-socpsych-author-date',
    name: 'Springer - SocPsych (author-date)',
    shortName: 'Springer SocPsych',
    category: 'author-date',
    inlineExample: '(Smith et al. 2023)',
  },

  // Label Styles
  {
    id: 'alpha',
    name: 'Alphabetic',
    shortName: 'Alpha',
    category: 'label',
    inlineExample: '[Smi23]',
  },

  // Additional Popular University Styles
  {
    id: 'university-of-york-harvard',
    name: 'University of York - Harvard',
    shortName: 'York Harvard',
    category: 'author-date',
    inlineExample: '(Smith et al., 2023)',
  },
  {
    id: 'university-of-york-apa',
    name: 'University of York - APA',
    shortName: 'York APA',
    category: 'author-date',
    inlineExample: '(Smith et al., 2023)',
  },
  {
    id: 'university-of-melbourne',
    name: 'University of Melbourne',
    shortName: 'Melbourne',
    category: 'author-date',
    inlineExample: '(Smith et al. 2023)',
  },
]

/**
 * Get all popular styles (most commonly used)
 */
export function getPopularStyles(): CSLStyleInfo[] {
  return CSL_STYLES.filter(s => s.popular)
}

/**
 * Get styles by category
 */
export function getStylesByCategory(category: CSLStyleCategory): CSLStyleInfo[] {
  return CSL_STYLES.filter(s => s.category === category)
}

/**
 * Search styles by name or ID
 */
export function searchStyles(query: string): CSLStyleInfo[] {
  const q = query.toLowerCase().trim()
  if (!q) return CSL_STYLES
  
  return CSL_STYLES.filter(s => 
    s.name.toLowerCase().includes(q) ||
    s.id.toLowerCase().includes(q) ||
    (s.shortName?.toLowerCase().includes(q))
  )
}

/**
 * Get a style by ID
 */
export function getStyleById(id: string): CSLStyleInfo | undefined {
  return CSL_STYLES.find(s => s.id === id)
}

/**
 * Get category display name
 */
export function getCategoryDisplayName(category: CSLStyleCategory): string {
  switch (category) {
    case 'author-date': return 'Author-Date'
    case 'numeric': return 'Numeric'
    case 'note': return 'Footnote/Note'
    case 'label': return 'Label'
    default: return category
  }
}

/**
 * Group styles by category
 */
export function getStylesGroupedByCategory(): Record<CSLStyleCategory, CSLStyleInfo[]> {
  return {
    'author-date': getStylesByCategory('author-date'),
    'numeric': getStylesByCategory('numeric'),
    'note': getStylesByCategory('note'),
    'label': getStylesByCategory('label'),
  }
}

// Legacy mapping for backward compatibility with old style names
export const LEGACY_STYLE_MAPPING: Record<string, string> = {
  'apa': 'apa',
  'mla': 'modern-language-association',
  'chicago': 'chicago-author-date',
  'ieee': 'ieee',
  'harvard': 'harvard-cite-them-right',
}

/**
 * Resolve legacy style ID to current CSL ID
 */
export function resolveLegacyStyleId(styleId: string): string {
  return LEGACY_STYLE_MAPPING[styleId] || styleId
}
