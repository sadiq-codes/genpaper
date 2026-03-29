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

    const initSession = async () => {
      try {
        const { data: { session: currentSession } } = await supabase.auth.getSession()
        setSession(currentSession ?? null)
        setUser(currentSession?.user ?? initialUser ?? null)
      } catch (error) {
        console.error('AuthProvider: Failed to get session:', error)
      } finally {
        setIsLoading(false)
      }
    }

    initSession()

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event: AuthChangeEvent, newSession: Session | null) => {
        // `INITIAL_SESSION` can legitimately have a null session on the client even when
        // SSR knows the user via cookies. Don't clobber the hydrated user in that case.
        if (event === 'INITIAL_SESSION' && !newSession?.user && initialUser) {
          setIsLoading(false)
          return
        }

        setSession(newSession ?? null)
        setUser(newSession?.user ?? null)
        setIsLoading(false)

        if (event === 'SIGNED_OUT') {
          setUser(null)
          setSession(null)
        } else if (event === 'TOKEN_REFRESHED') {
          setSession(newSession)
        }
      }
    )

    // Cleanup subscription on unmount
    return () => {
      subscription.unsubscribe()
    }
  }, [initialUser])

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
