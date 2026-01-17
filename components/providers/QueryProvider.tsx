'use client'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState, type ReactNode } from 'react'

interface QueryProviderProps {
  children: ReactNode
}

/**
 * QueryProvider with optimized caching strategies
 * 
 * Caching tiers:
 * - User data (library, projects): Long cache (10-15 min) - changes infrequently
 * - Search results: Medium cache (2-5 min) - may change but tolerable staleness
 * - Editor data: Short cache (30 sec) - changes frequently during editing
 * - Real-time data: No cache - always fresh
 */
export function QueryProvider({ children }: QueryProviderProps) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Default: 5 minutes - good for most data
            staleTime: 5 * 60 * 1000,
            // Keep data in cache for 30 minutes
            gcTime: 30 * 60 * 1000,
            // Don't refetch on window focus (reduces unnecessary requests)
            refetchOnWindowFocus: false,
            // Retry once on failure
            retry: 1,
            // Enable structural sharing for better performance
            structuralSharing: true,
          },
          mutations: {
            retry: 1,
          },
        },
      })
  )

  // Set query-specific defaults for optimal caching
  // These provide hints but can be overridden at the query level
  queryClient.setQueryDefaults(['projects'], {
    staleTime: 10 * 60 * 1000, // 10 min - project list changes rarely
    gcTime: 60 * 60 * 1000, // 1 hour cache
  })

  queryClient.setQueryDefaults(['library'], {
    staleTime: 15 * 60 * 1000, // 15 min - library changes infrequently
    gcTime: 60 * 60 * 1000, // 1 hour cache
  })

  queryClient.setQueryDefaults(['papers', 'search'], {
    staleTime: 2 * 60 * 1000, // 2 min - search results can be slightly stale
    gcTime: 10 * 60 * 1000, // 10 min cache
  })

  queryClient.setQueryDefaults(['project'], {
    staleTime: 30 * 1000, // 30 sec - editor data changes frequently
    gcTime: 5 * 60 * 1000, // 5 min cache
  })

  queryClient.setQueryDefaults(['chat', 'history'], {
    staleTime: Infinity, // Chat history doesn't go stale during session
    gcTime: 60 * 60 * 1000, // 1 hour cache
  })

  return (
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>
  )
}
