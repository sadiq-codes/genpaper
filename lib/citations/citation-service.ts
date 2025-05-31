// Unified Citation Service
import { createClient } from '@/lib/supabase/server';
import { Citation } from '@/lib/ai/citation-function-schema';
import crypto from 'crypto';

interface CitationLink {
  citationKey: string;
  section: string;
  start: number;
  end: number;
  textSegment?: string;
  reason?: string;
}

interface BulkCitationPayload {
  projectId: string;
  citations: Citation[];
  links: CitationLink[];
}

interface CitationUpsertResult {
  key: string;
  id: string;
  isNew: boolean;
}

// CrossRef API types
interface CrossRefWork {
  DOI?: string;
  title?: string[];
  author?: Array<{
    family?: string;
    given?: string;
  }>;
  published?: {
    'date-parts'?: number[][];
  };
  publisher?: string;
  'container-title'?: string[];
  volume?: string;
  issue?: string;
  page?: string;
  type?: string;
  abstract?: string;
}

interface CrossRefResponse {
  message?: {
    items?: CrossRefWork[];
  };
}

export class CitationService {
  /**
   * Generate a unique key for a citation
   * Uses DOI if available, otherwise hash of project_id + title + year
   */
  private static generateCitationKey(citation: Citation, projectId: string): string {
    if (citation.doi) {
      return citation.doi.toLowerCase();
    }
    
    // Include projectId to prevent cross-project collisions
    const hashInput = `${projectId}|${citation.title.toLowerCase()}|${citation.year || 'unknown'}`;
    return crypto.createHash('sha256').update(hashInput).digest('hex').substring(0, 16);
  }

  /**
   * Bulk upsert citations and their links in a single transaction
   */
  static async bulkUpsert(payload: BulkCitationPayload): Promise<{ 
    success: boolean; 
    citations?: CitationUpsertResult[];
    error?: string;
    details?: Error | unknown;
  }> {
    const supabase = await createClient();
    
    try {
      // Prepare citations with keys and CSL-formatted authors
      const citationsWithKeys = payload.citations.map(citation => ({
        ...citation,
        key: this.generateCitationKey(citation, payload.projectId),
        authors_csl: citation.authors.map(name => {
          const parts = name.split(', ');
          return {
            family: parts[0] || name,
            given: parts[1] || ''
          };
        })
      }));

      // Call the Postgres function for atomic upsert
      const { data, error } = await supabase.rpc('citations_bulk_upsert_v2', {
        p_project_id: payload.projectId,
        p_citations: citationsWithKeys,
        p_links: payload.links.map(link => ({
          ...link,
          reason: link.reason || citation.reason, // Use citation reason if link doesn't have one
          textSegment: link.textSegment?.substring(0, 300) // Enforce limit
        }))
      });

      if (error) throw error;

      // Parse the result to get detailed information
      const citations = data as CitationUpsertResult[];

      // Emit real-time event (non-blocking)
      this.emitCitationUpdate(payload.projectId, citations).catch(console.error);

      return { 
        success: true, 
        citations 
      };
    } catch (error) {
      console.error('Citation bulk upsert error:', error);
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error',
        details: error // Include full error details for debugging
      };
    }
  }

  /**
   * Emit real-time updates for citation changes (non-blocking)
   */
  private static async emitCitationUpdate(projectId: string, citations: CitationUpsertResult[]) {
    const supabase = await createClient();
    
    try {
      // Broadcast to project channel
      const channel = supabase.channel(`project:${projectId}`);
      await channel.send({
        type: 'broadcast',
        event: 'citations_updated',
        payload: { 
          projectId,
          citationCount: citations.length,
          newCitations: citations.filter(c => c.isNew).length,
          citations 
        }
      });
    } catch (error) {
      // Don't fail the main operation if broadcast fails
      console.error('Failed to emit citation update:', error);
    }
  }

  /**
   * Background enrichment - fetch DOI and metadata
   */
  static async enrichCitation(citationId: string): Promise<void> {
    const supabase = await createClient();
    
    // Get citation
    const { data: citation, error } = await supabase
      .from('citations')
      .select('*')
      .eq('id', citationId)
      .single();

    if (error || !citation || citation.doi) return;

    try {
      // Try CrossRef API
      const crossrefData = await this.fetchCrossRefByTitle(citation.title, citation.year);
      
      if (crossrefData && crossrefData.DOI) {
        // Update citation with enriched data
        await supabase
          .from('citations')
          .update({
            doi: crossrefData.DOI,
            metadata: crossrefData,
            journal: crossrefData.publisher || citation.journal,
            year: crossrefData.published?.['date-parts']?.[0]?.[0] || citation.year,
            enriched_at: new Date().toISOString()
          })
          .eq('id', citationId);

        // Emit update event
        await this.emitCitationUpdate(citation.project_id, [{ 
          key: citation.citation_key,
          id: citation.id,
          isNew: false 
        }]);
      }
    } catch (error) {
      console.error('Citation enrichment error:', error);
      
      // Update enrichment queue with error
      await supabase
        .from('citation_enrichment_queue')
        .update({
          status: 'failed',
          last_error: error instanceof Error ? error.message : 'Unknown error',
          processed_at: new Date().toISOString()
        })
        .eq('citation_id', citationId);
    }
  }

  /**
   * Fetch metadata from CrossRef
   */
  private static async fetchCrossRefByTitle(title: string, year?: number | null): Promise<CrossRefWork | null> {
    const query = year ? `${title} ${year}` : title;
    const url = `https://api.crossref.org/works?query=${encodeURIComponent(query)}&rows=1`;
    
    try {
      const response = await fetch(url, {
        headers: {
          // Replace with your actual email
          'User-Agent': 'GenPaper/1.0 (mailto:support@genpaper.ai)'
        }
      });
      
      if (!response.ok) return null;
      
      const data = await response.json() as CrossRefResponse;
      const firstItem = data.message?.items?.[0];
      
      // Verify it's a good match
      if (firstItem && this.isTitleMatch(title, firstItem.title?.[0])) {
        return firstItem;
      }
      
      return null;
    } catch (error) {
      console.error('CrossRef API error:', error);
      return null;
    }
  }

  /**
   * Fuzzy title matching with improved accuracy
   */
  private static isTitleMatch(title1: string, title2: string): boolean {
    if (!title1 || !title2) return false;
    
    const normalize = (s: string) => s.toLowerCase()
      .replace(/[^\w\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    
    const n1 = normalize(title1);
    const n2 = normalize(title2);
    
    // Exact match
    if (n1 === n2) return true;
    
    // One contains the other (for subtitles)
    if (n1.includes(n2) || n2.includes(n1)) return true;
    
    // Calculate Jaccard similarity for better accuracy
    const words1 = new Set(n1.split(' '));
    const words2 = new Set(n2.split(' '));
    const intersection = new Set([...words1].filter(x => words2.has(x)));
    const union = new Set([...words1, ...words2]);
    
    const similarity = intersection.size / union.size;
    return similarity > 0.7;
  }

  /**
   * Batch process enrichment queue
   */
  static async processEnrichmentQueue(limit = 20): Promise<void> {
    const supabase = await createClient();
    
    // Get pending citations
    const { data: queue, error } = await supabase
      .from('citation_enrichment_queue')
      .select('citation_id')
      .eq('status', 'pending')
      .lt('attempts', 3)
      .limit(limit);

    if (error || !queue) return;

    // Process in parallel with rate limiting
    const batchSize = 5;
    for (let i = 0; i < queue.length; i += batchSize) {
      const batch = queue.slice(i, i + batchSize);
      await Promise.all(
        batch.map(item => this.enrichCitation(item.citation_id))
      );
      
      // Rate limit: wait 1 second between batches
      if (i + batchSize < queue.length) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
  }
} 