import { createClient } from '@/lib/supabase/server'
import { LiteratureSearchResult } from '@/lib/ai/tools/literatureSearch'
import { CitationInsert, ReferenceLinkInsert, StructuredCitationData, Citation } from '@/types/database'

/**
 * Extract structured citation data from literature search results and CITE placeholders
 */
export function extractStructuredCitations(
  textContent: string, 
  literatureResults: LiteratureSearchResult[] = []
): StructuredCitationData[] {
  const structuredCitations: StructuredCitationData[] = [];
  
  // Find all [CITE: ...] placeholders in the text
  const citePlaceholderRegex = /\[CITE: (.*?)\]/g;
  const citePlaceholders = Array.from(textContent.matchAll(citePlaceholderRegex));
  
  for (const placeholderMatch of citePlaceholders) {
    const placeholderContent = placeholderMatch[1].trim();
    const fullPlaceholder = placeholderMatch[0];
    
    // Try to match the placeholder content with literature search results
    const matchingResult = findMatchingLiteratureResult(placeholderContent, literatureResults);
    
    if (matchingResult) {
      structuredCitations.push({
        title: matchingResult.title,
        authors: matchingResult.authors.map(author => ({ 
          name: author.name || author.given || author.family || 'Unknown Author'
        })),
        year: matchingResult.year,
        doi: matchingResult.doi,
        source_url: matchingResult.source_url,
        citation_placeholder: fullPlaceholder,
        relevance_explanation: `Cited for: ${placeholderContent}`,
      });
    } else {
      // Create a placeholder citation for unmatched CITE placeholders
      structuredCitations.push({
        title: placeholderContent,
        authors: [{ name: 'Unknown Author' }],
        year: null,
        doi: null,
        source_url: null,
        citation_placeholder: fullPlaceholder,
        relevance_explanation: `Citation needed for: ${placeholderContent}`,
      });
    }
  }
  
  return structuredCitations;
}

/**
 * Find a literature search result that matches the citation placeholder content
 */
function findMatchingLiteratureResult(
  placeholderContent: string, 
  results: LiteratureSearchResult[]
): LiteratureSearchResult | null {
  // Try to match by DOI first
  if (placeholderContent.includes('10.')) {
    const doiMatch = results.find(result => 
      result.doi && placeholderContent.includes(result.doi)
    );
    if (doiMatch) return doiMatch;
  }
  
  // Try to match by title (partial match)
  const titleMatch = results.find(result => 
    result.title && (
      result.title.toLowerCase().includes(placeholderContent.toLowerCase()) ||
      placeholderContent.toLowerCase().includes(result.title.toLowerCase())
    )
  );
  if (titleMatch) return titleMatch;
  
  // Try to match by first author's name
  const authorMatch = results.find(result => 
    result.authors && result.authors.length > 0 && 
    result.authors[0].name && 
    placeholderContent.toLowerCase().includes(result.authors[0].name.toLowerCase())
  );
  if (authorMatch) return authorMatch;
  
  return null;
}

/**
 * Save structured citations to the database
 */
export async function saveStructuredCitations(
  projectId: string,
  structuredCitations: StructuredCitationData[],
  sectionName?: string
): Promise<{ success: boolean; citationIds: string[]; error?: string }> {
  try {
    const supabase = await createClient();
    const citationIds: string[] = [];
    
    // Get current user for authentication
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    
    if (authError || !user) {
      return { success: false, citationIds: [], error: 'User not authenticated' };
    }

    for (const citationData of structuredCitations) {
      // Check if citation already exists (by DOI or title+year)
      let existingCitation: Citation | null = null;
      
      if (citationData.doi) {
        const { data } = await supabase
          .from('citations')
          .select('*')
          .eq('project_id', projectId)
          .eq('doi', citationData.doi)
          .single();
        existingCitation = data;
      }
      
      if (!existingCitation) {
        // Check by title and year if DOI lookup failed
        const { data } = await supabase
          .from('citations')
          .select('*')
          .eq('project_id', projectId)
          .eq('title', citationData.title)
          .eq('year', citationData.year)
          .single();
        existingCitation = data;
      }
      
      let citationId: string;
      
      if (existingCitation) {
        // Use existing citation
        citationId = existingCitation.id;
      } else {
        // Create new citation
        const citationInsert: CitationInsert = {
          project_id: projectId,
          doi: citationData.doi,
          title: citationData.title,
          authors: citationData.authors,
          year: citationData.year,
          source_type: 'paper',
          source_url: citationData.source_url,
        };
        
        const { data: newCitation, error: citationError } = await supabase
          .from('citations')
          .insert(citationInsert)
          .select('id')
          .single();
        
        if (citationError) {
          console.error('Error creating citation:', citationError);
          continue;
        }
        
        citationId = newCitation.id;
      }
      
      citationIds.push(citationId);
      
      // Create reference link
      const referenceLinkInsert: ReferenceLinkInsert = {
        project_id: projectId,
        citation_id: citationId,
        text_segment: citationData.text_segment || null,
        placeholder_text: citationData.citation_placeholder,
        section_name: sectionName || null,
      };
      
      const { error: linkError } = await supabase
        .from('reference_links')
        .insert(referenceLinkInsert);
      
      if (linkError) {
        console.error('Error creating reference link:', linkError);
      }
    }
    
    return { success: true, citationIds };
  } catch (error) {
    console.error('Error in saveStructuredCitations:', error);
    return { 
      success: false, 
      citationIds: [], 
      error: 'An unexpected error occurred while saving citations' 
    };
  }
}

/**
 * Extract both general [CN: ...] and specific [CITE: ...] placeholders
 */
export function extractAllCitationPlaceholders(textContent: string): {
  generalCitations: string[];
  specificCitations: string[];
  allCitations: string[];
} {
  // Find all [CN: ...] placeholders (general citation needs)
  const citationRegex = /\[CN: (.*?)\]/g;
  const citationMatches = Array.from(textContent.matchAll(citationRegex));
  const generalCitations = citationMatches.map(match => match[1].trim());
  
  // Find all [CITE: ...] placeholders (specific citations from literature search)
  const specificCitationRegex = /\[CITE: (.*?)\]/g;
  const specificCitationMatches = Array.from(textContent.matchAll(specificCitationRegex));
  const specificCitations = specificCitationMatches.map(match => `Specific citation: ${match[1].trim()}`);
  
  // Combine both types
  const allCitations = [...generalCitations, ...specificCitations];
  
  return {
    generalCitations,
    specificCitations,
    allCitations: Array.from(new Set(allCitations)) // Remove duplicates
  };
} 