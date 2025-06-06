import { createClient } from '@/lib/supabase/client'
import type { Citation } from '@/types/database'

type CitationStatus = 'pending' | 'accepted' | 'rejected'

interface ApiResponse<T = void> {
  success: boolean
  error?: string
  data?: T
}

export interface CitationsResponse extends ApiResponse {
  citations?: Citation[]
}

export class CitationsRepository {
  private supabase = createClient()

  async getCitations(projectId: string): Promise<CitationsResponse> {
    try {
      const { data, error } = await this.supabase
        .from('citations')
        .select('*')
        .eq('project_id', projectId)
        .order('created_at', { ascending: false })

      if (error) {
        console.error('Error fetching citations:', error)
        return { success: false, error: error.message }
      }

      return { success: true, citations: data || [] }
    } catch (error) {
      console.error('Error in getCitations:', error)
      return { success: false, error: 'Failed to fetch citations' }
    }
  }

  async createCitation(citation: Omit<Citation, 'id' | 'created_at' | 'updated_at'>): Promise<ApiResponse<Citation>> {
    try {
      const { data, error } = await this.supabase
        .from('citations')
        .insert({
          ...citation,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .select()
        .single()

      if (error) {
        console.error('Error creating citation:', error)
        return { success: false, error: error.message }
      }

      return { success: true, data }
    } catch (error) {
      console.error('Error in createCitation:', error)
      return { success: false, error: 'Failed to create citation' }
    }
  }

  async updateCitationStatus(
    citationId: string,
    status: CitationStatus
  ): Promise<ApiResponse> {
    try {
      const { error } = await this.supabase
        .from('citations')
        .update({
          status,
          updated_at: new Date().toISOString(),
        })
        .eq('id', citationId)

      if (error) {
        console.error('Error updating citation status:', error)
        return { success: false, error: error.message }
      }

      return { success: true }
    } catch (error) {
      console.error('Error in updateCitationStatus:', error)
      return { success: false, error: 'Failed to update citation status' }
    }
  }

  async deleteCitation(citationId: string): Promise<ApiResponse> {
    try {
      const { error } = await this.supabase
        .from('citations')
        .delete()
        .eq('id', citationId)

      if (error) {
        console.error('Error deleting citation:', error)
        return { success: false, error: error.message }
      }

      return { success: true }
    } catch (error) {
      console.error('Error in deleteCitation:', error)
      return { success: false, error: 'Failed to delete citation' }
    }
  }

  async searchCitations(
    projectId: string,
    query: string,
    limit: number = 10
  ): Promise<CitationsResponse> {
    try {
      const { data, error } = await this.supabase
        .from('citations')
        .select('*')
        .eq('project_id', projectId)
        .or(`title.ilike.%${query}%,authors.ilike.%${query}%,abstract.ilike.%${query}%`)
        .limit(limit)

      if (error) {
        console.error('Error searching citations:', error)
        return { success: false, error: error.message }
      }

      return { success: true, citations: data || [] }
    } catch (error) {
      console.error('Error in searchCitations:', error)
      return { success: false, error: 'Failed to search citations' }
    }
  }

  async getAcceptedCitations(projectId: string): Promise<CitationsResponse> {
    try {
      const { data, error } = await this.supabase
        .from('citations')
        .select('*')
        .eq('project_id', projectId)
        .eq('status', 'accepted')
        .order('authors', { ascending: true })

      if (error) {
        console.error('Error fetching accepted citations:', error)
        return { success: false, error: error.message }
      }

      return { success: true, citations: data || [] }
    } catch (error) {
      console.error('Error in getAcceptedCitations:', error)
      return { success: false, error: 'Failed to fetch accepted citations' }
    }
  }

  // Format citation for bibliography
  formatCitation(citation: Citation, style: 'apa' | 'mla' | 'chicago' = 'apa'): string {
    switch (style) {
      case 'apa':
        return `${citation.authors} (${citation.year}). ${citation.title}. ${citation.journal ? `${citation.journal}.` : ''}`
      case 'mla':
        return `${citation.authors}. "${citation.title}" ${citation.journal ? `${citation.journal}, ` : ''}${citation.year}.`
      case 'chicago':
        return `${citation.authors}. "${citation.title}." ${citation.journal ? `${citation.journal} ` : ''}(${citation.year}).`
      default:
        return this.formatCitation(citation, 'apa')
    }
  }
}

// Export singleton instance
export const citationsRepository = new CitationsRepository() 