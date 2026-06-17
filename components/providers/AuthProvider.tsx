'use client'

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { User, Session } from '@supabase/supabase-js'

interface AuthContextType {
  user: User | null
  session: Session | null
  isLoading: boolean
  isAuthenticated: boolean
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | null>(null)

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}

interface AuthProviderProps {
  children: ReactNode
  initialUser?: User | null
}

/**
 * AuthProvider - Manages client-side auth state.
 * 
 * Provides:
 * - Current user and session
 * - Loading state during hydration
 * - Sign out function
 * 
 * Note: Protected routes use server-side auth (getUserOrRedirect).
 * This provider is for client-side UI state only.
 */
export function AuthProvider({ children, initialUser = null }: AuthProviderProps) {
  const [user, setUser] = useState<User | null>(initialUser)
  const [session, setSession] = useState<Session | null>(null)
  const [isLoading, setIsLoading] = useState(!initialUser)
  const supabase = createClient()

  useEffect(() => {
    // Get initial session
    supabase.auth.getSession().then(({ data: { session: currentSession } }) => {
      setSession(currentSession)
      setUser(currentSession?.user ?? initialUser)
      setIsLoading(false)
    })

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, newSession) => {
        setSession(newSession)
        setUser(newSession?.user ?? null)
        setIsLoading(false)
      }
    )

    return () => subscription.unsubscribe()
  }, [supabase, initialUser])

  const signOut = async () => {
    await supabase.auth.signOut()
    window.location.href = '/login'
  }

  return (
    <AuthContext.Provider value={{
      user,
      session,
      isLoading,
      isAuthenticated: !!user,
      signOut,
    }}>
      {children}
    </AuthContext.Provider>
  )
}
