'use client'

import { createContext, useContext, useEffect, useState, useRef, type ReactNode } from 'react'
import { useRouter, usePathname } from 'next/navigation'
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
  const [pendingRecovery, setPendingRecovery] = useState(() =>
    typeof window !== 'undefined' && window.location.hash.includes('type=recovery')
  )
  const router = useRouter()
  const pathname = usePathname()
  const routerRef = useRef(router)
  routerRef.current = router

  useEffect(() => {
    const supabase = createClient()
    const hashHasRecovery = window.location.hash.includes('type=recovery')

    const navigateToReset = () => {
      setPendingRecovery(true)
      routerRef.current.replace('/reset-password')
    }

    // Get initial session
    const initSession = async () => {
      try {
        const { data: { session: currentSession } } = await supabase.auth.getSession()
        setSession(currentSession ?? null)
        if (currentSession?.user) {
          setUser(currentSession.user)
        }

        // The singleton client processes hash-fragment tokens at module-import
        // time, so the PASSWORD_RECOVERY event fires before this listener
        // exists. Detect it here as a fallback after the session is ready.
        if (hashHasRecovery && currentSession) {
          navigateToReset()
          return
        }
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

        // `INITIAL_SESSION` can legitimately have a null session on the client even when
        // SSR knows the user via cookies. Don't clobber the hydrated user in that case.
        if (event === 'INITIAL_SESSION' && !newSession?.user && initialUser) {
          setIsLoading(false)
          return
        }

        setSession(newSession ?? null)
        setUser(newSession?.user ?? null)
        setIsLoading(false)

        // Handle specific events
        if (event === 'PASSWORD_RECOVERY') {
          navigateToReset()
          return
        } else if (event === 'SIGNED_OUT') {
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

  // Clear the recovery gate once client-side navigation lands on /reset-password.
  // Safety timeout prevents a permanent blank screen if navigation somehow stalls.
  useEffect(() => {
    if (!pendingRecovery) return

    if (pathname === '/reset-password') {
      setPendingRecovery(false)
      return
    }

    const timer = setTimeout(() => setPendingRecovery(false), 5_000)
    return () => clearTimeout(timer)
  }, [pendingRecovery, pathname])

  const value: AuthContextType = {
    user,
    session,
    isLoading,
    isAuthenticated: !!user,
  }

  if (pendingRecovery) {
    return null
  }

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  )
}
