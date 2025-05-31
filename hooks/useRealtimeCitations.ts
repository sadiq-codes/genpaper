import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'

interface CitationLink {
  id: string
  section: string
  start_pos: number
  end_pos: number
  reason: string
  context: string
}

interface RealtimeCitation {
  id: string
  project_id: string
  key: string
  data: any // CSL JSON
  source_type: string
  enriched: boolean
  created_at: string
  updated_at: string
  links: CitationLink[] | null
}

interface UseRealtimeCitationsReturn {
  citations: RealtimeCitation[]
  isLoading: boolean
  error: string | null
  refetch: () => Promise<void>
  addCitation: (citationData: any) => Promise<void>
}

export function useRealtimeCitations(projectId: string): UseRealtimeCitationsReturn {
  const [citations, setCitations] = useState<RealtimeCitation[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  
  const supabase = createClient()

  // Load citations initially
  useEffect(() => {
    loadCitations()
  }, [projectId])

  // Set up real-time subscription
  useEffect(() => {
    const citationsChannel = supabase
      .channel(`citations:${projectId}`)
      .on(
        'postgres_changes',
        {
          event: '*', // All events
          schema: 'public',
          table: 'citations',
          filter: `project_id=eq.${projectId}`
        },
        () => {
          // Reload citations when any citation changes
          loadCitations()
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*', // All events
          schema: 'public',
          table: 'citation_links',
          filter: `project_id=eq.${projectId}`
        },
        () => {
          // Reload citations when citation links change
          loadCitations()
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(citationsChannel)
    }
  }, [projectId])

  const loadCitations = async () => {
    try {
      setError(null)
      
      const { data, error: citationError } = await supabase
        .from('citations_with_links')
        .select('*')
        .eq('project_id', projectId)
        .order('created_at', { ascending: false })

      if (citationError) {
        throw citationError
      }

      setCitations(data || [])
    } catch (err) {
      console.error('Error loading citations:', err)
      setError(err instanceof Error ? err.message : 'Failed to load citations')
    } finally {
      setIsLoading(false)
    }
  }

  const refetch = async () => {
    setIsLoading(true)
    await loadCitations()
  }

  const addCitation = async (citationData: any) => {
    try {
      // This would typically be handled by the AI function calling
      // But we can provide a manual method for UI-driven citations
      const { error } = await supabase
        .from('citations')
        .insert({
          project_id: projectId,
          key: citationData.key || `manual_${Date.now()}`,
          data: citationData,
          source_type: citationData.type || 'manual'
        })

      if (error) {
        throw error
      }

      // Refetch to get the updated list
      await loadCitations()
    } catch (err) {
      console.error('Error adding citation:', err)
      throw err
    }
  }

  return {
    citations,
    isLoading,
    error,
    refetch,
    addCitation
  }
} 