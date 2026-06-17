'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ArrowRight, Menu, X } from 'lucide-react'
import Image from 'next/image'
import type { User } from '@supabase/supabase-js'

interface LandingNavProps {
  user: User | null
}

export function LandingNav({ user }: LandingNavProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 bg-background/95 backdrop-blur-md border-b border-border">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          <Link href="/" className="flex items-center gap-2.5">
            <Image 
              src="/favicon-32x32.png" 
              alt="GenPaper" 
              width={24} 
              height={24} 
              className="dark:invert"
            />
            <span className="text-lg font-semibold tracking-tight text-foreground/80">GenPaper</span>
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
              <Link href="/projects" className="bg-foreground text-background hover:bg-foreground/90 rounded-full px-5 py-2 text-sm font-medium transition-colors inline-flex items-center gap-1.5">
                Dashboard
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            ) : (
              <>
                <Link
                  href="/login"
                  className="text-muted-foreground hover:text-foreground transition-colors text-sm font-medium"
                >
                  Sign In
                </Link>
                <Link href="/signup" className="bg-foreground text-background hover:bg-foreground/90 rounded-full px-5 py-2 text-sm font-medium transition-colors">
                  Get Started
                </Link>
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
                <Link href="/projects" className="bg-foreground text-background hover:bg-foreground/90 rounded-full px-5 py-2 text-sm font-medium transition-colors inline-flex items-center gap-1.5 w-fit">
                  Dashboard
                  <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              ) : (
                <>
                  <Link
                    href="/login"
                    className="text-muted-foreground hover:text-foreground transition-colors font-medium px-2 py-2"
                    onClick={() => setMobileMenuOpen(false)}
                  >
                    Sign In
                  </Link>
                  <Link href="/signup" className="bg-foreground text-background hover:bg-foreground/90 rounded-full px-5 py-2 text-sm font-medium transition-colors w-fit">
                    Get Started
                  </Link>
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
  user: User | null
}

export function LandingCTA({ variant, user }: LandingCTAProps) {
  if (variant === 'hero') {
    return (
      <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-12">
        {user ? (
          <Link href="/projects" className="bg-foreground text-background hover:bg-foreground/90 rounded-full px-8 py-3 text-base font-medium transition-colors inline-flex items-center gap-2">
            Start New Paper
            <ArrowRight className="h-4 w-4" />
          </Link>
        ) : (
          <>
            <Link href="/signup" className="bg-foreground text-background hover:bg-foreground/90 rounded-full px-8 py-3 text-base font-medium transition-colors inline-flex items-center gap-2">
              Get Started
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link href="/login" className="rounded-full px-8 py-3 text-base font-medium border border-border text-foreground hover:bg-muted transition-colors">
              Sign In
            </Link>
          </>
        )}
      </div>
    )
  }

  // Final CTA section
  return (
    <>
      <h2 className="font-instrument text-4xl tracking-tight text-foreground mb-6">
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
            <Link href="/projects" className="bg-foreground text-background hover:bg-foreground/90 rounded-full px-8 py-3 text-base font-medium transition-colors inline-flex items-center gap-2">
              Start New Paper
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link href="/projects" className="rounded-full px-8 py-3 text-base font-medium border border-border text-foreground hover:bg-muted transition-colors">
              View Projects
            </Link>
          </>
        ) : (
          <>
            <Link href="/signup" className="bg-foreground text-background hover:bg-foreground/90 rounded-full px-8 py-3 text-base font-medium transition-colors inline-flex items-center gap-2">
              Write Your First Paper
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link href="/login" className="rounded-full px-8 py-3 text-base font-medium border border-border text-foreground hover:bg-muted transition-colors">
              Sign In
            </Link>
          </>
        )}
      </div>

      <p className="text-sm text-muted-foreground">
        {user ? 'All work is automatically saved.' : 'Join thousands of researchers worldwide'}
      </p>
    </>
  )
}
