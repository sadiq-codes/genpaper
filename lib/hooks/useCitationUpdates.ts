'use client'

import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { mutate } from 'swr'
import type { RealtimeChannel } from '@supabase/supabase-js'

/**
 * Client subscribe & reconcile hook for citation updates
 * 
 * Purpose: Live updates for references panel and inline chips
 * Subscribes to citation change events and refetches data accordingly
 */

interface CitationChangeEvent {
  projectId: string
  citeKey: string
  isNew: boolean
  timestamp: string
}

interface UseCitationUpdatesOptions {
  projectId: string | null
  enabled?: boolean
  onCitationAdded?: (event: CitationChangeEvent) => void
  onCitationUpdated?: (event: CitationChangeEvent) => void
}

interface CitationUpdatesState {
  isConnected: boolean
  lastEvent: CitationChangeEvent | null
  error: string | null
  eventCount: number
}

export function useCitationUpdates(options: UseCitationUpdatesOptions) {
  const { projectId, enabled = true, onCitationAdded, onCitationUpdated } = options
  
  const [state, setState] = useState<CitationUpdatesState>({
    isConnected: false,
    lastEvent: null,
    error: null,
    eventCount: 0
  })
  
  const channelRef = useRef<RealtimeChannel | null>(null)
  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null)

  useEffect(() => {
    if (!enabled || !projectId) {
      return
    }

    let mounted = true

    const setupRealtimeSubscription = async () => {
      try {
        // Create Supabase client
        if (!supabaseRef.current) {
          supabaseRef.current = createClient()
        }
        const supabase = supabaseRef.current

        // Create realtime channel
        const channel = supabase.channel('citations-changes')
        channelRef.current = channel

        // Subscribe to citation change events
        channel.on('broadcast', { event: 'citation-changed' }, (payload) => {
          if (!mounted) return

          const event = payload.payload as CitationChangeEvent
          
          // Only process events for our project
          if (event.projectId !== projectId) {
            return
          }

          setState(prev => ({
            ...prev,
            lastEvent: event,
            eventCount: prev.eventCount + 1
          }))

          // Trigger callbacks
          if (event.isNew) {
            onCitationAdded?.(event)
          } else {
            onCitationUpdated?.(event)
          }

          // Revalidate related data
          handleCitationChange(event)
        })

        // Subscribe and handle connection state
        await channel.subscribe((status) => {
          if (!mounted) return

          if (status === 'SUBSCRIBED') {
            setState(prev => ({ ...prev, isConnected: true, error: null }))
          } else if (status === 'CHANNEL_ERROR') {
            setState(prev => ({ 
              ...prev, 
              isConnected: false, 
              error: 'Failed to connect to realtime updates' 
            }))
          } else if (status === 'TIMED_OUT') {
            setState(prev => ({ 
              ...prev, 
              isConnected: false, 
              error: 'Connection timed out' 
            }))
          } else if (status === 'CLOSED') {
            setState(prev => ({ ...prev, isConnected: false }))
          }
        })

        // Supabase v2 channel.subscribe does not return 'error' string; errors are delivered via status callback

      } catch (error) {
        if (mounted) {
          setState(prev => ({ 
            ...prev, 
            error: error instanceof Error ? error.message : 'Unknown error',
            isConnected: false 
          }))
        }
      }
    }

    setupRealtimeSubscription()

    // Cleanup function
    return () => {
      mounted = false
      
      if (channelRef.current) {
        channelRef.current.unsubscribe()
        channelRef.current = null
      }
    }
  }, [projectId, enabled, onCitationAdded, onCitationUpdated])

  /**
   * Handle citation change by revalidating relevant data
   * Task requirement: refetch `/render-bibliography` & update inline
   */
  const handleCitationChange = (event: CitationChangeEvent) => {
    const { projectId } = event

    // Revalidate bibliography data
    mutate(`/api/citations/render-bibliography?projectId=${projectId}`)
    
    // Revalidate inline citations (if we had a specific endpoint)
    mutate(`/api/citations/render-inline?projectId=${projectId}`)
    
    // Revalidate project citations list
    mutate(`/api/projects/${projectId}/citations`)
    
    // Revalidate project data
    mutate(`/api/projects/${projectId}`)
  }

  /**
   * Manual trigger for citation refresh (useful for testing)
   */
  const refreshCitations = () => {
    if (projectId) {
      handleCitationChange({ 
        projectId, 
        citeKey: 'manual-refresh', 
        isNew: false, 
        timestamp: new Date().toISOString() 
      })
    }
  }

  /**
   * Force reconnection
   */
  const reconnect = () => {
    if (channelRef.current) {
      channelRef.current.unsubscribe()
      channelRef.current = null
    }
    
    setState(prev => ({ 
      ...prev, 
      isConnected: false, 
      error: null 
    }))
  }

  return {
    ...state,
    refreshCitations,
    reconnect
  }
}

/**
 * Hook for components that need to respond to citation updates
 * Simplified version that just triggers SWR revalidation
 */
export function useCitationSync(projectId: string | null, enabled = true) {
  const citationUpdates = useCitationUpdates({
    projectId,
    enabled,
    onCitationAdded: (event) => {
      console.log('Citation added:', event.citeKey)
    },
    onCitationUpdated: (event) => {
      console.log('Citation updated:', event.citeKey)
    }
  })

  return {
    isConnected: citationUpdates.isConnected,
    lastUpdate: citationUpdates.lastEvent?.timestamp,
    eventCount: citationUpdates.eventCount,
    error: citationUpdates.error
  }
}