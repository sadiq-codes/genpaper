'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase/client'
import type { User } from '@supabase/supabase-js'

export default function AuthButton() {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const router = useRouter()

  useEffect(() => {
    // Get initial session
    const getSession = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      setUser(session?.user ?? null)
      setLoading(false)
    }

    getSession()

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        setUser(session?.user ?? null)
        setLoading(false)
      }
    )

    return () => subscription.unsubscribe()
  }, [])

  const handleLogout = async () => {
    try {
      const { error } = await supabase.auth.signOut()
      if (error) {
        console.error('Logout error:', error.message)
      } else {
        console.log('Logout successful')
        router.push('/login')
      }
    } catch (error) {
      console.error('Unexpected error:', error)
    }
  }

  if (loading) {
    return <div className="text-sm">Loading...</div>
  }

  if (user) {
    return (
      <div className="flex items-center space-x-4">
        <span className="text-sm">Welcome, {user.email}</span>
        <button
          onClick={handleLogout}
          className="bg-red-600 hover:bg-red-700 text-white px-3 py-1 rounded text-sm font-medium"
        >
          Logout
        </button>
      </div>
    )
  }

  return (
    <div className="flex items-center space-x-4">
      <a
        href="/login"
        className="text-white hover:text-gray-300 text-sm font-medium"
      >
        Login
      </a>
      <a
        href="/signup"
        className="bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-1 rounded text-sm font-medium"
      >
        Sign up
      </a>
    </div>
  )
} 