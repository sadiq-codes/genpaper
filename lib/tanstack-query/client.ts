import { QueryClient } from '@tanstack/react-query'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // 5 minutes cache time
      staleTime: 1000 * 60 * 5,
      // 10 minutes garbage collection
      gcTime: 1000 * 60 * 10, 
      // Retry on failure
      retry: (failureCount, error) => {
        // Don't retry on authentication errors
        if (error instanceof Error && error.message.includes('authentication')) {
          return false
        }
        // Retry up to 3 times for other errors
        return failureCount < 3
      },
      // Refetch on window focus (for real-time data)
      refetchOnWindowFocus: true,
      // Refetch on reconnect
      refetchOnReconnect: true,
    },
    mutations: {
      // Retry mutations once on failure
      retry: 1,
    },
  },
}) 