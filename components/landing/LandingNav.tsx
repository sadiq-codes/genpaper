'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Sparkles, ArrowRight, Menu, X } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import type { User } from '@supabase/supabase-js'

export function LandingNav() {
  const [user, setUser] = useState<User | null>(null)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const supabase = createClient()

  useEffect(() => {
    const getUser = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      setUser(user)
    }
    getUser()
  }, [supabase.auth])

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 bg-background/95 backdrop-blur-md border-b border-border">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          <Link href="/" className="flex items-center space-x-2 group">
            <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
              <Sparkles className="h-5 w-5 text-primary-foreground" />
            </div>
            <span className="text-xl font-bold text-foreground">GenPaper</span>
          </Link>

          <div className="hidden md:flex items-center space-x-8">
            <a
              href="#features"
              className="text-muted-foreground hover:text-foreground transition-colors text-sm font-medium"
            >
              Features
            </a>
            <a
              href="#benefits"
              className="text-muted-foreground hover:text-foreground transition-colors text-sm font-medium"
            >
              How it Works
            </a>
            {user ? (
              <Button className="bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg px-6" asChild>
                <Link href="/projects">
                  Dashboard
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
            ) : (
              <>
                <Link
                  href="/login"
                  className="text-muted-foreground hover:text-foreground transition-colors text-sm font-medium"
                >
                  Sign In
                </Link>
                <Button className="bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg px-6" asChild>
                  <Link href="/signup">Get Started</Link>
                </Button>
              </>
            )}
          </div>

          <button
            className="md:hidden p-2 rounded-lg hover:bg-muted transition-colors"
            onClick={() => setMobileMenuOpen(prev => !prev)}
          >
            {mobileMenuOpen ? (
              <X className="h-6 w-6 text-foreground" />
            ) : (
              <Menu className="h-6 w-6 text-foreground" />
            )}
          </button>
        </div>

        {mobileMenuOpen && (
          <div className="md:hidden py-4 border-t border-border">
            <div className="flex flex-col space-y-4">
              <a
                href="#features"
                className="text-muted-foreground hover:text-foreground transition-colors font-medium px-2 py-2"
                onClick={() => setMobileMenuOpen(false)}
              >
                Features
              </a>
              <a
                href="#benefits"
                className="text-muted-foreground hover:text-foreground transition-colors font-medium px-2 py-2"
                onClick={() => setMobileMenuOpen(false)}
              >
                How it Works
              </a>
              {user ? (
                <Button className="bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg" asChild>
                  <Link href="/projects">
                    Dashboard
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Link>
                </Button>
              ) : (
                <>
                  <Link
                    href="/login"
                    className="text-muted-foreground hover:text-foreground transition-colors font-medium px-2 py-2"
                    onClick={() => setMobileMenuOpen(false)}
                  >
                    Sign In
                  </Link>
                  <Button className="bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg" asChild>
                    <Link href="/signup">Get Started</Link>
                  </Button>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </nav>
  )
}

interface LandingCTAProps {
  variant: 'hero' | 'final'
}

export function LandingCTA({ variant }: LandingCTAProps) {
  const [user, setUser] = useState<User | null>(null)
  const supabase = createClient()

  useEffect(() => {
    const getUser = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      setUser(user)
    }
    getUser()
  }, [supabase.auth])

  if (variant === 'hero') {
    return (
      <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-12">
        {user ? (
          <Button
            size="lg"
            className="bg-primary hover:bg-primary/90 text-primary-foreground px-8 py-6 text-base rounded-lg shadow-lg transition-all duration-300 hover:shadow-xl"
            asChild
          >
            <Link href="/projects">
              Start New Paper
              <ArrowRight className="ml-2 h-5 w-5" />
            </Link>
          </Button>
        ) : (
          <>
            <Button
              size="lg"
              className="bg-primary hover:bg-primary/90 text-primary-foreground px-8 py-6 text-base rounded-lg shadow-lg transition-all duration-300 hover:shadow-xl"
              asChild
            >
              <Link href="/signup">
                Start Free Trial
                <ArrowRight className="ml-2 h-5 w-5" />
              </Link>
            </Button>
            <Button
              size="lg"
              variant="outline"
              className="px-8 py-6 text-base rounded-lg border border-border text-foreground hover:bg-muted transition-all duration-300 bg-transparent"
              asChild
            >
              <Link href="/login">Sign In</Link>
            </Button>
          </>
        )}
      </div>
    )
  }

  // Final CTA section
  return (
    <>
      <h2 className="text-4xl font-bold text-foreground mb-6">
        {user ? 'Ready to continue?' : 'Start writing smarter today'}
      </h2>
      <p className="text-lg text-muted-foreground mb-12">
        {user
          ? 'Pick up where you left off or start a new project.'
          : 'No setup required. Free to start — no credit card needed.'}
      </p>

      <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-8">
        {user ? (
          <>
            <Button
              size="lg"
              className="bg-primary hover:bg-primary/90 text-primary-foreground px-8 py-6 text-base rounded-lg shadow-lg transition-all duration-300"
              asChild
            >
              <Link href="/projects">
                Start New Paper
                <ArrowRight className="ml-2 h-5 w-5" />
              </Link>
            </Button>
            <Button
              size="lg"
              variant="outline"
              className="px-8 py-6 text-base rounded-lg border border-border text-foreground hover:bg-muted transition-all duration-300 bg-transparent"
              asChild
            >
              <Link href="/projects">View Projects</Link>
            </Button>
          </>
        ) : (
          <>
            <Button
              size="lg"
              className="bg-primary hover:bg-primary/90 text-primary-foreground px-8 py-6 text-base rounded-lg shadow-lg transition-all duration-300"
              asChild
            >
              <Link href="/signup">
                Write Your First Paper
                <ArrowRight className="ml-2 h-5 w-5" />
              </Link>
            </Button>
            <Button
              size="lg"
              variant="outline"
              className="px-8 py-6 text-base rounded-lg border border-border text-foreground hover:bg-muted transition-all duration-300 bg-transparent"
              asChild
            >
              <Link href="/login">Sign In</Link>
            </Button>
          </>
        )}
      </div>

      <p className="text-sm text-muted-foreground">
        {user ? 'All work is automatically saved.' : 'Join thousands of researchers worldwide'}
      </p>
    </>
  )
}
