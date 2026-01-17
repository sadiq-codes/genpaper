'use client'

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { User, Session, AuthChangeEvent } from '@supabase/supabase-js'

interface AuthContextType {
  user: User | null
  session: Session | null
  isLoading: boolean
  isAuthenticated: boolean
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  session: null,
  isLoading: true,
  isAuthenticated: false,
})

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}

interface AuthProviderProps {
  children: ReactNode
  /** Initial user from server-side rendering (optional) */
  initialUser?: User | null
}

/**
 * AuthProvider - Manages client-side auth state with onAuthStateChange listener.
 * 
 * This solves the hot-reload logout issue by:
 * 1. Listening to auth state changes from Supabase
 * 2. Maintaining consistent auth state across HMR updates
 * 3. Providing a loading state during initial hydration
 */
export function AuthProvider({ children, initialUser = null }: AuthProviderProps) {
  const [user, setUser] = useState<User | null>(initialUser)
  const [session, setSession] = useState<Session | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    const supabase = createClient()

    // Get initial session
    const initSession = async () => {
      try {
        const { data: { session: currentSession } } = await supabase.auth.getSession()
        setSession(currentSession)
        setUser(currentSession?.user ?? null)
      } catch (error) {
        console.error('AuthProvider: Failed to get session:', error)
      } finally {
        setIsLoading(false)
      }
    }

    initSession()

    // Listen for auth state changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event: AuthChangeEvent, newSession: Session | null) => {
        console.log('Auth state changed:', event, newSession?.user?.email)
        
        setSession(newSession)
        setUser(newSession?.user ?? null)
        setIsLoading(false)

        // Handle specific events
        if (event === 'SIGNED_OUT') {
          // Clear any cached data on sign out
          setUser(null)
          setSession(null)
        } else if (event === 'TOKEN_REFRESHED') {
          // Token was refreshed, update session
          setSession(newSession)
        }
      }
    )

    // Cleanup subscription on unmount
    return () => {
      subscription.unsubscribe()
    }
  }, [])

  const value: AuthContextType = {
    user,
    session,
    isLoading,
    isAuthenticated: !!user,
  }

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  )
}
