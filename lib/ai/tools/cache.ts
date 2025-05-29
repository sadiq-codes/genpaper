// Database-backed cache for literature search results
import { createClient } from '@/lib/supabase/server'
import { LiteratureSearchResult } from './literatureSearch'

export interface CachedSearchResult {
  id: string
  query: string
  max_results: number
  results: LiteratureSearchResult[]
  created_at: string
  expires_at: string
}

export class LiteratureSearchCache {
  private static CACHE_DURATION = 24 * 60 * 60 * 1000 // 24 hours in milliseconds

  static async get(query: string, maxResults: number): Promise<LiteratureSearchResult[] | null> {
    try {
      const supabase = await createClient()
      
      const { data, error } = await supabase
        .from('literature_search_cache')
        .select('*')
        .eq('query', query)
        .eq('max_results', maxResults)
        .gt('expires_at', new Date().toISOString())
        .order('created_at', { ascending: false })
        .limit(1)

      if (error || !data || data.length === 0) {
        return null
      }

      console.log(`Cache hit for literature search: "${query}"`)
      return data[0].results as LiteratureSearchResult[]
    } catch (error) {
      console.error('Error reading from literature search cache:', error)
      return null
    }
  }

  static async set(query: string, maxResults: number, results: LiteratureSearchResult[]): Promise<void> {
    try {
      const supabase = await createClient()
      const expiresAt = new Date(Date.now() + this.CACHE_DURATION).toISOString()

      const { error } = await supabase
        .from('literature_search_cache')
        .insert({
          query,
          max_results: maxResults,
          results,
          expires_at: expiresAt
        })

      if (error) {
        console.error('Error saving to literature search cache:', error)
      } else {
        console.log(`Cached literature search results for: "${query}"`)
      }
    } catch (error) {
      console.error('Error saving to literature search cache:', error)
    }
  }

  static async cleanup(): Promise<void> {
    try {
      const supabase = await createClient()
      
      const { error } = await supabase
        .from('literature_search_cache')
        .delete()
        .lt('expires_at', new Date().toISOString())

      if (error) {
        console.error('Error cleaning up literature search cache:', error)
      } else {
        console.log('Cleaned up expired literature search cache entries')
      }
    } catch (error) {
      console.error('Error cleaning up literature search cache:', error)
    }
  }
}

// You'll need to create this table in Supabase:
/*
CREATE TABLE literature_search_cache (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  query text NOT NULL,
  max_results integer NOT NULL,
  results jsonb NOT NULL,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  expires_at timestamp with time zone NOT NULL
);

CREATE INDEX idx_literature_search_cache_query ON literature_search_cache(query, max_results);
CREATE INDEX idx_literature_search_cache_expires ON literature_search_cache(expires_at);
*/ 