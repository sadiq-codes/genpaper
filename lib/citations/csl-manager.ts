import { Cite } from '@citation-js/core';
import '@citation-js/plugin-csl';
import Cite from 'citation-js';

// Types for citations
interface CitationAuthor {
  family?: string
  given?: string
  literal?: string
}

interface CitationDate {
  'date-parts'?: number[][]
  raw?: string
}

interface CitationItem {
  id?: string
  title?: string
  author?: CitationAuthor[]
  issued?: CitationDate
  'container-title'?: string
  volume?: string | number
  issue?: string | number
  page?: string
  DOI?: string
  URL?: string
  type?: string
  publisher?: string
  'publisher-place'?: string
  accessed?: CitationDate
  ISSN?: string
  ISBN?: string
  abstract?: string
  language?: string
  [key: string]: unknown // Allow additional fields
}

// Cache for loaded CSL styles
const styleCache = new Map<string, string>();

// Popular citation styles for quick access
export const POPULAR_STYLES = [
  { id: 'apa', name: 'APA 7th Edition' },
  { id: 'modern-language-association', name: 'MLA 9th Edition' },
  { id: 'chicago-author-date', name: 'Chicago (Author-Date)' },
  { id: 'chicago-note-bibliography', name: 'Chicago (Notes)' },
  { id: 'ieee', name: 'IEEE' },
  { id: 'nature', name: 'Nature' },
  { id: 'science', name: 'Science' },
  { id: 'cell', name: 'Cell' },
  { id: 'vancouver', name: 'Vancouver' },
  { id: 'harvard-cite-them-right', name: 'Harvard' },
  { id: 'american-medical-association', name: 'AMA' },
  { id: 'american-psychological-association', name: 'APA 6th Edition' },
  { id: 'modern-humanities-research-association', name: 'MHRA' },
  { id: 'turabian-fullnote-bibliography', name: 'Turabian' },
  { id: 'american-sociological-association', name: 'ASA' }
];

// Journal-specific styles (subset)
export const JOURNAL_STYLES = [
  { id: 'nature', name: 'Nature' },
  { id: 'science', name: 'Science' },
  { id: 'cell', name: 'Cell' },
  { id: 'the-lancet', name: 'The Lancet' },
  { id: 'new-england-journal-of-medicine', name: 'NEJM' },
  { id: 'british-medical-journal', name: 'BMJ' },
  { id: 'plos-one', name: 'PLOS ONE' },
  { id: 'proceedings-of-the-national-academy-of-sciences', name: 'PNAS' },
  { id: 'journal-of-the-american-medical-association', name: 'JAMA' }
];

/**
 * Load a CSL style file dynamically
 */
export async function loadStyle(styleId: string): Promise<string> {
  // Check cache first
  if (styleCache.has(styleId)) {
    return styleCache.get(styleId)!;
  }

  // Check localStorage for persistent cache
  const cacheKey = `csl-style-${styleId}`;
  const cached = localStorage.getItem(cacheKey);
  if (cached) {
    styleCache.set(styleId, cached);
    return cached;
  }

  try {
    // Try loading from public folder first
    let response = await fetch(`/csl/${styleId}.csl`);
    
    // If not found locally, try loading from GitHub CDN
    if (!response.ok) {
      response = await fetch(
        `https://raw.githubusercontent.com/citation-style-language/styles/master/${styleId}.csl`
      );
    }

    if (!response.ok) {
      throw new Error(`Style "${styleId}" not found`);
    }

    const styleXml = await response.text();
    
    // Cache in memory and localStorage
    styleCache.set(styleId, styleXml);
    try {
      localStorage.setItem(cacheKey, styleXml);
    } catch (e) {
      // localStorage might be full, ignore
      console.warn('Failed to cache style in localStorage:', e);
    }

    return styleXml;
  } catch (error) {
    console.error(`Failed to load style ${styleId}:`, error);
    throw error;
  }
}

/**
 * Format citations using a specific CSL style
 */
export async function formatCitations(
  citations: CitationItem[],
  styleId: string = 'apa',
  format: 'bibliography' | 'citation' = 'bibliography',
  locale: string = 'en-US'
): Promise<string> {
  try {
    // Load the style
    const styleXml = await loadStyle(styleId);
    
    // Register the style with citation-js
    const config = Cite.plugins.config.get('@csl');
    config.templates.add(styleId, styleXml);
    
    // Load locale if not English
    if (locale !== 'en-US') {
      try {
        const localeResponse = await fetch(
          `https://raw.githubusercontent.com/citation-style-language/locales/master/locales-${locale}.xml`
        );
        if (localeResponse.ok) {
          const localeXml = await localeResponse.text();
          config.locales.add(locale, localeXml);
        }
      } catch (e) {
        console.warn(`Failed to load locale ${locale}, using en-US`);
        locale = 'en-US';
      }
    }
    
    // Create citation instance
    const cite = new Cite(citations);
    
    // Format based on type
    return cite.format(format, {
      template: styleId,
      lang: locale,
      format: 'text'
    });
  } catch (error) {
    console.error('Error formatting citations:', error);
    // Fallback to a simple format
    return citations
      .map(c => `${c.author?.[0]?.family || 'Unknown'}. ${c.title}. ${c.issued?.['date-parts']?.[0]?.[0] || 'n.d.'}.`)
      .join('\n');
  }
}

/**
 * Format in-text citation
 */
export async function formatInTextCitation(
  citation: CitationItem,
  styleId: string = 'apa',
  locale: string = 'en-US'
): Promise<string> {
  // For in-text citations, we use the 'citation' format
  const formatted = await formatCitations([citation], styleId, 'citation', locale);
  return formatted.trim();
}

/**
 * Search available citation styles
 */
export async function searchStyles(query: string): Promise<Array<{ id: string; name: string }>> {
  // In a real implementation, this would search through a pre-built index
  // For now, search through popular and journal styles
  const allStyles = [...POPULAR_STYLES, ...JOURNAL_STYLES];
  
  const normalizedQuery = query.toLowerCase();
  return allStyles.filter(style => 
    style.id.toLowerCase().includes(normalizedQuery) || 
    style.name.toLowerCase().includes(normalizedQuery)
  );
}

/**
 * Get style metadata
 */
export async function getStyleInfo(styleId: string): Promise<{
  title: string;
  titleShort?: string;
  id: string;
  updated?: string;
}> {
  try {
    const styleXml = await loadStyle(styleId);
    
    // Parse XML to extract metadata
    const parser = new DOMParser();
    const doc = parser.parseFromString(styleXml, 'text/xml');
    
    const info = doc.querySelector('info');
    if (!info) {
      throw new Error('Invalid CSL file');
    }
    
    return {
      title: info.querySelector('title')?.textContent || styleId,
      titleShort: info.querySelector('title-short')?.textContent,
      id: info.querySelector('id')?.textContent || styleId,
      updated: info.querySelector('updated')?.textContent
    };
  } catch (error) {
    // Fallback to basic info
    return {
      title: styleId.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
      id: styleId
    };
  }
}

/**
 * Clear style cache
 */
export function clearStyleCache() {
  styleCache.clear();
  
  // Clear localStorage cache
  const keys = Object.keys(localStorage);
  keys.forEach(key => {
    if (key.startsWith('csl-style-')) {
      localStorage.removeItem(key);
    }
  });
} 