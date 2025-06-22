# Project dump for `genpaper`
_generated 2025-06-20T15:59:41.536762Z_

## Project structure

    📁 **(auth)/**
    📁 **(dashboard)/**
    📁 **api/**
    📁 **auth/**
    📁 **components/**
    📁 **demo/**
    📁 **projects/**
    📁 **references/**
    📄 favicon.ico
    📄 globals.css
    📄 layout.tsx
    📄 page.tsx
        📁 **block-editor/**
            📄 page.tsx
        📁 **callback/**
            📄 route.ts
        📄 page.tsx
        📁 **[id]/**
            📄 page.tsx
        📄 AuthButton.tsx
        📁 **auth/**
        📁 **collections/**
        📁 **fetch-sources/**
        📁 **generate/**
        📁 **library/**
        📁 **library-search/**
        📁 **papers/**
        📁 **pdf-queue/**
        📁 **projects/**
        📁 **search-papers/**
        📁 **test-rag/**
        📁 **test-task-5/**
            📁 **[id]/**
            📁 **download-pdf/**
            📁 **ingest-lightweight/**
            📁 **semantic-search/**
            📁 **similar/**
            📁 **update-citation/**
                📁 **[id]/**
                    📄 route.ts
                📄 route.ts
                📄 route.ts
                📄 route.ts
                📄 route.ts
                📄 route.ts
            📁 **check-user/**
            📄 route.ts
            📁 **[id]/**
            📄 route.ts
                📁 **versions/**
                📄 route.ts
                    📄 route.ts
            📄 route.ts
            📄 route.ts
            📁 **papers/**
            📁 **upload/**
            📄 route.ts
                📄 route.ts
                📄 route.ts
            📄 route.ts
            📁 **blocks/**
            📁 **outline/**
            📁 **stream/**
            📁 **unified/**
            📄 route.ts
                📄 route.ts
                📄 route.ts
                📄 route.ts
                📄 route.ts
            📄 route.ts
            📄 route.ts
            📄 route.ts
        📁 **login/**
        📁 **signup/**
        📄 layout.tsx
            📄 page.tsx
            📄 page.tsx
        📁 **generate/**
        📁 **history/**
        📁 **library/**
        📄 layout.tsx
            📄 page.tsx
            📄 page.tsx
            📁 **editor/**
            📁 **outline/**
            📁 **processing/**
            📁 **quick/**
            📄 page.tsx
                📄 page.tsx
                📄 page.tsx
                📄 page.tsx
                📄 page.tsx
    📁 **citations/**
    📁 **ui/**
    📄 BlockEditor.tsx
    📄 ComponentErrorFallbacks.tsx
    📄 DashboardNav.tsx
    📄 ErrorBoundary.tsx
    📄 FetchSourcesReview.tsx
    📄 FileUpload.tsx
    📄 GeneratePageClient.tsx
    📄 HistoryManager.tsx
    📄 LibraryManager.tsx
    📄 Navbar.tsx
    📄 PDFProcessingStatus.tsx
    📄 PaperGenerator.tsx
    📄 PaperViewer.tsx
    📄 ProcessingScreen.tsx
    📄 QueryErrorBoundary.tsx
    📄 SourceReview.tsx
        📄 RegionSelector.tsx
        📄 alert.tsx
        📄 avatar.tsx
        📄 badge.tsx
        📄 breadcrumb.tsx
        📄 button.tsx
        📄 calendar.tsx
        📄 card.tsx
        📄 checkbox.tsx
        📄 collapsible.tsx
        📄 command.tsx
        📄 dialog.tsx
        📄 dropdown-menu.tsx
        📄 form.tsx
        📄 input.tsx
        📄 label.tsx
        📄 loading-spinner.tsx
        📄 navigation-menu.tsx
        📄 pagination.tsx
        📄 popover.tsx
        📄 progress.tsx
        📄 radio-group.tsx
        📄 scroll-area.tsx
        📄 select.tsx
        📄 separator.tsx
        📄 sheet.tsx
        📄 sidebar.tsx
        📄 skeleton.tsx
        📄 switch.tsx
        📄 table.tsx
        📄 tabs.tsx
        📄 textarea.tsx
        📄 tooltip.tsx
        📄 CitationEditor.tsx
        📄 InteractiveCitationRenderer.tsx

---

### `app/(auth)/layout.tsx`

```tsx
export default function AuthLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="min-h-screen bg-background">
      {children}
    </div>
  )
} 
```

### `app/(auth)/login/page.tsx`

```tsx
"use client"

import type React from "react"
import { useState, useEffect, Suspense } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import Link from "next/link"
import { supabase } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Mail, Eye, EyeOff, Sparkles } from "lucide-react"
import { LoadingSpinner } from "@/components/ui/loading-spinner"

function LoginPageContent() {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [loading, setLoading] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [checking, setChecking] = useState(true)
  const [error, setError] = useState("")
  const router = useRouter()
  const searchParams = useSearchParams()

  useEffect(() => {
    const checkUser = async () => {
      // Remove automatic redirect to avoid login/generate loop
      // Let server-side route protection handle authentication flow
      setChecking(false)
    }
    checkUser()
    
    // Check for error message from URL params (e.g., email verification failed)
    const errorParam = searchParams.get('error')
    if (errorParam) {
      setError(decodeURIComponent(errorParam))
    }
  }, [router, searchParams])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError("")

    try {
      const { data, error: loginError } = await supabase.auth.signInWithPassword({
        email,
        password,
      })

      if (loginError) {
        console.error("Login error:", loginError.message)
        setError(loginError.message)
      } else {
        console.log("Login successful:", data)
        router.replace("/generate")
      }
    } catch (error) {
      console.error("Unexpected error:", error)
      setError("An unexpected error occurred")
    } finally {
      setLoading(false)
    }
  }

  if (checking) {
    return <LoadingSpinner fullScreen />
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="flex h-screen bg-background">
        <div className="w-full bg-card flex flex-col justify-center px-12">
          <div className="max-w-sm mx-auto w-full">
            <div className="flex items-center justify-center mb-8">
              <div className="flex items-center space-x-2">
                <Sparkles className="h-8 w-8 text-primary" />
                <span className="text-2xl font-bold">GenPaper</span>
              </div>
            </div>

            <div className="text-center mb-8">
              <h3 className="text-2xl font-semibold text-foreground mb-2">Welcome back</h3>
              <p className="text-muted-foreground">Sign in to your research workspace</p>
            </div>

            <div className="space-y-3 mb-6">
              <Button variant="outline" className="w-full h-11">
                <Mail className="w-4 h-4 mr-3" />
                Continue with Google
              </Button>
            </div>

            <div className="relative mb-6">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-border"></div>
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="px-4 bg-card text-muted-foreground">or continue with email</span>
              </div>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4 mb-6">
              {error && (
                <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-md p-3">
                  <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
                </div>
              )}
              
              <div>
                <label className="block text-sm font-medium text-foreground mb-2">Email address</label>
                <Input
                  type="email"
                  placeholder="Enter your email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="h-11"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-foreground mb-2">Password</label>
                <div className="relative">
                  <Input
                    type={showPassword ? "text" : "password"}
                    placeholder="Enter your password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="h-11 pr-10"
                    required
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="absolute right-2 top-1/2 -translate-y-1/2 h-7 w-7"
                    onClick={() => setShowPassword(!showPassword)}
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </Button>
                </div>
              </div>

              <Button 
                type="submit"
                disabled={loading}
                className="w-full h-11 bg-gray-900 hover:bg-gray-800 text-white"
              >
                {loading ? "Signing in..." : "Enter Workspace"}
              </Button>
            </form>

            <div className="text-center mb-6">
              <a href="#" className="text-sm text-gray-600 hover:text-gray-800">
                Forgot your password?
              </a>
            </div>

            <div className="text-center pt-6 border-t border-border">
              <p className="text-sm text-muted-foreground">
                Don&apos;t have an account?{" "}
                <Link href="/signup" className="text-gray-600 hover:text-gray-800 font-medium">
                  Start free trial
                </Link>
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function LoginPage() {
  return (
    <Suspense fallback={<LoadingSpinner fullScreen />}>
      <LoginPageContent />
    </Suspense>
  )
}

```

### `app/(auth)/signup/page.tsx`

```tsx
"use client"

import type React from "react"
import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { supabase } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Mail, Eye, EyeOff, Sparkles } from "lucide-react"
import { LoadingSpinner } from "@/components/ui/loading-spinner"

export default function SignupPage() {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [loading, setLoading] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [checking, setChecking] = useState(true)
  const [error, setError] = useState("")
  const [success, setSuccess] = useState(false)
  const router = useRouter()

  useEffect(() => {
    const checkUser = async () => {
      // Remove automatic redirect to avoid login/generate loop
      // Let server-side route protection handle authentication flow
      setChecking(false)
    }
    checkUser()
  }, [router])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")

    if (password !== confirmPassword) {
      setError("Passwords don't match")
      return
    }

    setLoading(true)

    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback`
        }
      })

      if (error) {
        console.error("Signup error:", error)
        setError(error.message)
      } else if (data.user) {
        // According to Supabase docs: when email confirmation is enabled and user already exists,
        // an obfuscated/fake user object is returned with an empty identities array
        const isExistingUser = !data.user.identities || data.user.identities.length === 0
        
        if (isExistingUser) {
          // User already exists - show error with login button
          setError(`An account with ${email} already exists. Please sign in instead.`)
        } else if (!data.user.email_confirmed_at) {
          // New user requiring email verification
          setSuccess(true)
        } else {
          // New user, immediately confirmed (email verification disabled)
          router.replace("/generate")
        }
      }
    } catch (error) {
      console.error("Unexpected error:", error)
      setError("An unexpected error occurred")
    } finally {
      setLoading(false)
    }
  }

  if (checking) {
    return <LoadingSpinner fullScreen />
  }

  // Show success message after signup with email verification required
  if (success) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="max-w-md mx-auto text-center p-6">
          <div className="flex items-center justify-center mb-6">
            <div className="flex items-center space-x-2">
              <Sparkles className="h-8 w-8 text-primary" />
              <span className="text-2xl font-bold">GenPaper</span>
            </div>
          </div>
          
          <div className="bg-card border rounded-lg p-6 space-y-4">
            <div className="w-16 h-16 bg-green-100 dark:bg-green-900/20 rounded-full flex items-center justify-center mx-auto mb-4">
              <Mail className="w-8 h-8 text-green-600" />
            </div>
            
            <h2 className="text-2xl font-semibold text-foreground">Check your email</h2>
            <p className="text-muted-foreground">
              We&apos;ve sent a verification link to <strong>{email}</strong>
            </p>
            <p className="text-sm text-muted-foreground">
              Click the link in the email to verify your account and complete your signup.
            </p>
            
            <div className="pt-4 space-y-3">
              <Button 
                variant="outline" 
                className="w-full"
                onClick={() => window.location.reload()}
              >
                Didn&apos;t receive the email? Try again
              </Button>
              
              <Link href="/login">
                <Button variant="ghost" className="w-full">
                  Back to Login
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background">

      <div className="flex h-screen bg-background">
  
        <div className="w-full bg-card flex flex-col justify-center px-12">
          <div className="max-w-sm mx-auto w-full">

            <div className="flex items-center justify-center mb-8">
              <div className="flex items-center space-x-2">
                <Sparkles className="h-8 w-8 text-primary" />
                <span className="text-2xl font-bold">GenPaper</span>
              </div>
            </div>

            <div className="text-center mb-8">
              <h3 className="text-2xl font-semibold text-foreground mb-2">Create your account</h3>
              <p className="text-muted-foreground">Start your free trial today</p>
            </div>


            <div className="space-y-3 mb-6">
              <Button variant="outline" className="w-full h-11">
                <Mail className="w-4 h-4 mr-3" />
                Continue with Google
              </Button>
            </div>

            <div className="relative mb-6">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-border"></div>
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="px-4 bg-card text-muted-foreground">or continue with email</span>
              </div>
            </div>


            <form onSubmit={handleSubmit} className="space-y-4 mb-6">
              {error && (
                <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-md p-3">
                  <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
                  {error.includes("already exists") && (
                    <div className="mt-2">
                      <Link href="/login">
                        <Button variant="outline" size="sm" className="text-xs">
                          Go to Login
                        </Button>
                      </Link>
                    </div>
                  )}
                </div>
              )}
              
              <div>
                <label className="block text-sm font-medium text-foreground mb-2">Email address</label>
                <Input
                  type="email"
                  placeholder="Enter your email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="h-11"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-foreground mb-2">Password</label>
                <div className="relative">
                  <Input
                    type={showPassword ? "text" : "password"}
                    placeholder="Create a password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="h-11 pr-10"
                    required
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="absolute right-2 top-1/2 -translate-y-1/2 h-7 w-7"
                    onClick={() => setShowPassword(!showPassword)}
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </Button>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-foreground mb-2">Confirm Password</label>
                <div className="relative">
                  <Input
                    type={showConfirmPassword ? "text" : "password"}
                    placeholder="Confirm your password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="h-11 pr-10"
                    required
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="absolute right-2 top-1/2 -translate-y-1/2 h-7 w-7"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  >
                    {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </Button>
                </div>
              </div>

              <Button 
                type="submit"
                disabled={loading}
                className="w-full h-11 bg-gray-900 hover:bg-gray-800 text-white"
              >
                {loading ? "Creating account..." : "Start Free Trial"}
              </Button>
            </form>

            <div className="text-center pt-6 border-t border-border mb-6">
              <p className="text-sm text-muted-foreground">
                Already have an account?{" "}
                <Link href="/login" className="text-gray-600 hover:text-gray-800 font-medium">
                  Sign in
                </Link>
              </p>
            </div>

            <div className="text-center">
              <p className="text-xs text-muted-foreground">
                By creating an account, you agree to our{" "}
                <a href="#" className="text-gray-600 hover:text-gray-800">Terms of Service</a>{" "}
                and{" "}
                <a href="#" className="text-gray-600 hover:text-gray-800">Privacy Policy</a>
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

```

### `app/(dashboard)/generate/editor/page.tsx`

```tsx
import { Metadata } from 'next'
import { Suspense } from 'react'
import BlockEditor from '@/components/BlockEditor'
import { LoadingSpinner } from '@/components/ui/loading-spinner'

export const metadata: Metadata = {
  title: 'Block Editor | Genpaper',
  description: 'Build your research paper section by section with AI assistance',
}

function BlockEditorSkeleton() {
  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      <div className="text-center space-y-2">
        <div className="h-8 bg-muted rounded w-64 mx-auto animate-pulse" />
        <div className="h-4 bg-muted rounded w-96 mx-auto animate-pulse" />
      </div>
      
      <div className="border rounded-lg p-6 space-y-6">
        <div className="flex items-center justify-center py-12">
          <LoadingSpinner text="Loading block editor..." />
        </div>
      </div>
    </div>
  )
}

export default function BlockEditorPage() {
  return (
    <div className="min-h-screen bg-background">
      <Suspense fallback={<BlockEditorSkeleton />}>
        <BlockEditor />
      </Suspense>
    </div>
  )
} 
```

### `app/(dashboard)/generate/outline/page.tsx`

```tsx
'use client'

import { useState, useEffect, useMemo, useRef } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { LoadingSpinner } from '@/components/ui/loading-spinner'
import { FileText, ArrowLeft, ArrowRight, Edit3 } from 'lucide-react'

interface OutlineSection {
  sectionKey: string
  title: string
  candidatePaperIds: string[]
  description?: string
  keyPoints?: string[]
  expectedWords?: number
}

export default function OutlineReviewPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [outline, setOutline] = useState<OutlineSection[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isGenerating, setIsGenerating] = useState(false)
  const isGeneratingOutline = useRef(false)
  
  // Get parameters from URL
  const topic = searchParams.get('topic') || ''
  const length = searchParams.get('length') || 'medium'
  const paperType = searchParams.get('paperType') || 'researchArticle'
  const useLibraryOnly = searchParams.get('useLibraryOnly') === 'true'
  const selectedPapers = useMemo(() => 
    searchParams.get('selectedPapers')?.split(',').filter(Boolean) || [], 
    [searchParams]
  )

  // Stabilize selectedPapers to prevent duplicate API calls
  const selectedPapersString = selectedPapers.join(',')

  // Generate outline on page load
  useEffect(() => {
    if (!topic) {
      router.push('/generate')
      return
    }

    // Prevent duplicate API calls
    if (isGeneratingOutline.current) {
      return
    }

    const generateOutline = async () => {
      try {
        isGeneratingOutline.current = true
        setIsLoading(true)
        
        const response = await fetch('/api/generate/outline', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            topic,
            paperType,
            selectedPapers,
            localRegion: 'global', // TODO: Add localRegion support in UI
            pageLength: length
          })
        })

        if (!response.ok) {
          const error = await response.json()
          throw new Error(error.error || 'Failed to generate outline')
        }

        const data = await response.json()
        if (data.success && data.outline) {
          setOutline(data.outline.sections)
          setIsLoading(false)
          isGeneratingOutline.current = false
          return
        } else {
          throw new Error('Invalid response format')
        }
      } catch (error) {
        console.error('Error generating outline:', error)
        // Fall back to mock data if API fails
      const mockOutlines = {
        researchArticle: [
          { sectionKey: 'introduction', title: 'Introduction', candidatePaperIds: [], description: 'Background and research questions' },
          { sectionKey: 'literatureReview', title: 'Literature Review', candidatePaperIds: [], description: 'Review of existing research' },
          { sectionKey: 'methodology', title: 'Methodology', candidatePaperIds: [], description: 'Research design and methods' },
          { sectionKey: 'results', title: 'Results', candidatePaperIds: [], description: 'Findings and data analysis' },
          { sectionKey: 'discussion', title: 'Discussion', candidatePaperIds: [], description: 'Interpretation and implications' },
          { sectionKey: 'conclusion', title: 'Conclusion', candidatePaperIds: [], description: 'Summary and future work' },
        ],
        literatureReview: [
          { sectionKey: 'introduction', title: 'Introduction & Scope', candidatePaperIds: [], description: 'Purpose and scope of the review' },
          { sectionKey: 'thematicReview1', title: 'Key Themes and Findings', candidatePaperIds: [], description: 'Major research themes' },
          { sectionKey: 'thematicReview2', title: 'Methodological Approaches', candidatePaperIds: [], description: 'Research methods comparison' },
          { sectionKey: 'gapsAndDirections', title: 'Gaps & Future Directions', candidatePaperIds: [], description: 'Identified research gaps' },
          { sectionKey: 'conclusion', title: 'Conclusion', candidatePaperIds: [], description: 'Summary and research agenda' },
        ],
        capstoneProject: [
          { sectionKey: 'introduction', title: 'Introduction & Problem Statement', candidatePaperIds: [], description: 'Project motivation and objectives' },
          { sectionKey: 'literatureReview', title: 'Literature Review', candidatePaperIds: [], description: 'Brief review of relevant work' },
          { sectionKey: 'proposedSolution', title: 'Proposed Solution', candidatePaperIds: [], description: 'Design and approach' },
          { sectionKey: 'implementation', title: 'Implementation Plan', candidatePaperIds: [], description: 'Timeline and deliverables' },
          { sectionKey: 'evaluation', title: 'Expected Outcomes', candidatePaperIds: [], description: 'Success criteria and evaluation' },
          { sectionKey: 'conclusion', title: 'Conclusion', candidatePaperIds: [], description: 'Summary and impact' },
        ],
        mastersThesis: [
          { sectionKey: 'introduction', title: 'Chapter 1: Introduction', candidatePaperIds: [], description: 'Research problem and questions' },
          { sectionKey: 'literatureReview', title: 'Chapter 2: Literature Review', candidatePaperIds: [], description: 'Comprehensive review (20-30 papers)' },
          { sectionKey: 'methodology', title: 'Chapter 3: Methodology', candidatePaperIds: [], description: 'Research design and methods' },
          { sectionKey: 'results', title: 'Chapter 4: Results', candidatePaperIds: [], description: 'Findings and analysis' },
          { sectionKey: 'discussion', title: 'Chapter 5: Discussion', candidatePaperIds: [], description: 'Interpretation and implications' },
          { sectionKey: 'conclusion', title: 'Chapter 6: Conclusions & Future Work', candidatePaperIds: [], description: 'Summary and recommendations' },
        ],
        phdDissertation: [
          { sectionKey: 'introduction', title: 'Chapter 1: Introduction', candidatePaperIds: [], description: 'Research problem and significance' },
          { sectionKey: 'literatureReview', title: 'Chapter 2: Literature Review', candidatePaperIds: [], description: 'Exhaustive review with theoretical framework' },
          { sectionKey: 'theoreticalFramework', title: 'Chapter 3: Theoretical Framework', candidatePaperIds: [], description: 'Conceptual foundation' },
          { sectionKey: 'methodology', title: 'Chapter 4: Methodology', candidatePaperIds: [], description: 'Detailed research design' },
          { sectionKey: 'results', title: 'Chapter 5: Results', candidatePaperIds: [], description: 'Comprehensive findings' },
          { sectionKey: 'discussion', title: 'Chapter 6: Discussion', candidatePaperIds: [], description: 'Analysis and theoretical connections' },
          { sectionKey: 'conclusion', title: 'Chapter 7: Conclusions & Contributions', candidatePaperIds: [], description: 'Summary and research contributions' },
        ]
      }
        setOutline(mockOutlines[paperType as keyof typeof mockOutlines] || mockOutlines.researchArticle)
      } finally {
        setIsLoading(false)
        isGeneratingOutline.current = false
      }
    }

    generateOutline()
  }, [topic, paperType, selectedPapersString, length, router])

  const handleBackToForm = () => {
    const params = new URLSearchParams({
      topic,
      length,
      paperType,
      useLibraryOnly: useLibraryOnly.toString(),
      selectedPapers: selectedPapers.join(',')
    })
    router.push(`/generate?${params.toString()}`)
  }

  const handleProceedToGeneration = () => {
    setIsGenerating(true)
    const params = new URLSearchParams({
      topic,
      length,
      paperType,
      useLibraryOnly: useLibraryOnly.toString(),
      selectedPapers: selectedPapers.join(',')
    })
    router.push(`/generate/processing?${params.toString()}`)
  }

  if (!topic) {
    return null
  }

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <FileText className="h-4 w-4" />
          <span>Outline Review</span>
        </div>
        <h1 className="text-3xl font-bold tracking-tight">Review Your Paper Outline</h1>
        <p className="text-muted-foreground">
          Review the generated outline for your {paperType.replace(/([A-Z])/g, ' $1').toLowerCase().trim()} on &ldquo;{topic}&rdquo;
        </p>
      </div>

      {isLoading ? (
        <Card>
          <CardContent className="p-8">
            <div className="flex flex-col items-center justify-center space-y-4">
              <LoadingSpinner size="lg" />
              <div className="text-center">
                <h3 className="font-medium">Generating Outline</h3>
                <p className="text-sm text-muted-foreground">
                  Creating a structured outline for your {paperType.replace(/([A-Z])/g, ' $1').toLowerCase().trim()}...
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Paper Info */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span>Paper Configuration</span>
                <Badge variant="secondary">{paperType.replace(/([A-Z])/g, ' $1').trim()}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                <div>
                  <span className="font-medium text-muted-foreground">Length:</span>
                  <p className="capitalize">{length}</p>
                </div>
                <div>
                  <span className="font-medium text-muted-foreground">Sources:</span>
                  <p>{useLibraryOnly ? 'Library Only' : 'Auto-discover'}</p>
                </div>
                <div>
                  <span className="font-medium text-muted-foreground">Selected Papers:</span>
                  <p>{selectedPapers.length} papers</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Outline Sections */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span>Paper Outline</span>
                <Button variant="outline" size="sm" disabled>
                  <Edit3 className="h-4 w-4 mr-2" />
                  Edit (Coming Soon)
                </Button>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {outline.map((section, index) => (
                  <div key={`${section.sectionKey}-${index}`} className="border rounded-lg p-4">
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex items-center gap-3">
                        <div className="flex items-center justify-center w-8 h-8 rounded-full bg-primary/10 text-primary font-medium text-sm">
                          {index + 1}
                        </div>
                        <div>
                          <h3 className="font-medium">{section.title}</h3>
                          {section.description && (
                            <p className="text-sm text-muted-foreground mt-1">
                              {section.description}
                            </p>
                          )}
                          {section.keyPoints && section.keyPoints.length > 0 && (
                            <div className="mt-2">
                              <p className="text-xs font-medium text-muted-foreground mb-1">Key Points:</p>
                              <ul className="text-xs text-muted-foreground space-y-1">
                                {section.keyPoints.map((point, idx) => (
                                  <li key={`${section.sectionKey}-point-${idx}`} className="flex items-start">
                                    <span className="mr-2">•</span>
                                    <span>{point}</span>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}
                          {section.expectedWords && (
                            <p className="text-xs text-muted-foreground mt-2">
                              Expected: ~{section.expectedWords} words
                            </p>
                          )}
                          {section.candidatePaperIds && section.candidatePaperIds.length > 0 && (
                            <p className="text-xs text-muted-foreground mt-1">
                              Papers: {section.candidatePaperIds.length}
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Action Buttons */}
          <div className="flex items-center justify-between">
            <Button variant="outline" onClick={handleBackToForm}>
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Form
            </Button>
            <Button onClick={handleProceedToGeneration} disabled={isGenerating}>
              {isGenerating ? (
                <LoadingSpinner size="sm" />
              ) : (
                <>
                  Proceed to Generation
                  <ArrowRight className="h-4 w-4 ml-2" />
                </>
              )}
            </Button>
          </div>
        </>
      )}
    </div>
  )
} 
```

### `app/(dashboard)/generate/page.tsx`

```tsx
import { Metadata } from 'next'
import Link from 'next/link'
import { FileText, Edit3, Zap, Clock, Users, Award } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

export const metadata: Metadata = {
  title: 'Generate Research Paper | Genpaper',
  description: 'Generate comprehensive research papers from your topics using AI',
}

export default function GeneratePage() {
  return (
    <div className="container mx-auto p-6 max-w-4xl">
      <div className="text-center mb-8">
        <h1 className="text-3xl font-bold mb-2">Generate Your Research Paper</h1>
        <p className="text-muted-foreground">
          Choose your approach: Get a complete draft instantly, or build your paper section by section
        </p>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        {/* Quick Draft Mode */}
        <Card className="relative overflow-hidden border-2 hover:border-blue-300 transition-colors">
          <div className="absolute top-4 right-4">
            <Badge variant="secondary" className="bg-blue-100 text-blue-700">
              <Zap className="w-3 h-3 mr-1" />
              Quick
            </Badge>
          </div>
          
          <CardHeader className="pb-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-blue-100">
                <FileText className="h-6 w-6 text-blue-600" />
              </div>
              <div>
                <CardTitle className="text-xl">Quick Draft</CardTitle>
                <CardDescription>Complete paper in minutes</CardDescription>
              </div>
            </div>
          </CardHeader>
          
          <CardContent className="space-y-4">
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Clock className="w-4 h-4" />
                <span>5-15 minutes end-to-end</span>
              </div>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Users className="w-4 h-4" />
                <span>Perfect for tight deadlines</span>
              </div>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Award className="w-4 h-4" />
                <span>AI handles structure & citations</span>
              </div>
            </div>
            
            <div className="pt-2">
              <p className="text-sm mb-4">
                Enter your topic and get a complete, cited research paper. You can always edit 
                sections afterward in our block editor.
              </p>
              
              <Button asChild className="w-full" size="lg">
                <Link href="/generate/quick">
                  Generate Complete Draft
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Structured Editor Mode */}
        <Card className="relative overflow-hidden border-2 hover:border-green-300 transition-colors">
          <div className="absolute top-4 right-4">
            <Badge variant="secondary" className="bg-green-100 text-green-700">
              <Edit3 className="w-3 h-3 mr-1" />
              Control
            </Badge>
          </div>
          
          <CardHeader className="pb-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-green-100">
                <Edit3 className="h-6 w-6 text-green-600" />
              </div>
              <div>
                <CardTitle className="text-xl">Block Editor</CardTitle>
                <CardDescription>Build section by section</CardDescription>
              </div>
            </div>
          </CardHeader>
          
          <CardContent className="space-y-4">
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Clock className="w-4 h-4" />
                <span>Work at your own pace</span>
              </div>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Users className="w-4 h-4" />
                <span>Perfect for iterative refinement</span>
              </div>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Award className="w-4 h-4" />
                <span>Full control over every section</span>
              </div>
            </div>
            
            <div className="pt-2">
              <p className="text-sm mb-4">
                Start with a blank document or outline. Use AI slash commands (/write, /rewrite, /cite) 
                to build your paper exactly how you want it.
              </p>
              
              <Button asChild variant="outline" className="w-full" size="lg">
                <Link href="/generate/editor">
                  Open Block Editor
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Bridge Section */}
      <div className="mt-8 p-6 bg-muted/30 rounded-lg">
        <h3 className="font-semibold mb-2">💡 Pro Tip: Use Both Approaches</h3>
        <p className="text-sm text-muted-foreground">
          Many users start with Quick Draft to get a foundation, then switch to the Block Editor 
          to refine specific sections. Both save to the same project format.
        </p>
      </div>
    </div>
  )
}

 
```

### `app/(dashboard)/generate/processing/page.tsx`

```tsx
'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { ProcessingScreen } from '@/components/ProcessingScreen'
import type { GenerateRequest, GenerationProgress } from '@/types/simplified'
import { useStreamGeneration, useStartGeneration } from '@/lib/hooks/useStreamGeneration'

export default function ProcessingPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [hasStarted, setHasStarted] = useState(false)
  
  // Get parameters from URL
  const topic = searchParams.get('topic') || ''
  const length = searchParams.get('length') as 'short' | 'medium' | 'long' || 'medium'
  const paperType = searchParams.get('paperType') as 'researchArticle' | 'literatureReview' | 'capstoneProject' | 'mastersThesis' | 'phdDissertation' || 'researchArticle'
  const useLibraryOnly = searchParams.get('useLibraryOnly') === 'true'
  const selectedPapers = useMemo(() => 
    searchParams.get('selectedPapers')?.split(',').filter(Boolean) || [],
    [searchParams]
  )

  // Generation state
  const { startGeneration, streamUrl } = useStartGeneration()
  
  // Stabilize callbacks to prevent infinite loops
  const handleComplete = useCallback((projectId: string) => {
    // Auto-redirect to view the generated paper
    router.replace(`/projects/${projectId}`)
  }, [router])
  
  const handleError = useCallback((error: string) => {
    console.error('Generation error:', error)
    // Redirect back to generate page with error
    router.push('/generate?error=' + encodeURIComponent(error))
  }, [router])
  
  const handleProgress = useCallback((progress: GenerationProgress) => {  
    console.log('Generation progress:', progress)
  }, [])
  
  // Use stream generation hook to get real-time data
  const streamState = useStreamGeneration(streamUrl, {
    onComplete: handleComplete,
    onError: handleError,
    onProgress: handleProgress
  })

  // Start generation when component mounts
  useEffect(() => {
    if (!topic || hasStarted) return
    
    const request: GenerateRequest = {
      topic: topic.trim(),
      libraryPaperIds: selectedPapers,
      useLibraryOnly,
      config: {
        length,
        paperType
      }
    }

    const startGenerationAsync = async () => {
      try {
        await startGeneration(request)
        setHasStarted(true)
      } catch (error) {
        console.error('Failed to start generation:', error)
        router.push('/generate?error=' + encodeURIComponent('Failed to start generation'))
      }
    }

    startGenerationAsync()
  }, [topic, selectedPapers, useLibraryOnly, length, paperType, hasStarted, startGeneration, router])

  // Redirect back if no topic
  useEffect(() => {
    if (!topic) {
      router.push('/generate')
    }
  }, [topic, router])

  if (!topic) {
    return null
  }

  return (
    <ProcessingScreen 
      topic={topic}
      progress={streamState.progress}
      isConnected={streamState.isConnected}
      error={streamState.error}
    />
  )
} 
```

### `app/(dashboard)/generate/quick/page.tsx`

```tsx
import { Metadata } from 'next'
import { Suspense } from 'react'
import PaperGenerator from '@/components/PaperGenerator'
import { LoadingSpinner } from '@/components/ui/loading-spinner'

export const metadata: Metadata = {
  title: 'Quick Draft | Genpaper',
  description: 'Generate a complete research paper with AI',
}

function GeneratePageSkeleton() {
  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      <div className="text-center space-y-2">
        <div className="h-8 bg-muted rounded w-64 mx-auto animate-pulse" />
        <div className="h-4 bg-muted rounded w-96 mx-auto animate-pulse" />
      </div>
      
      <div className="border rounded-lg p-6 space-y-6">
        <div className="flex items-center justify-center py-12">
          <LoadingSpinner text="Loading paper generator..." />
        </div>
      </div>
    </div>
  )
}

export default function QuickGeneratePage() {
  return (
    <div className="min-h-screen bg-background">
      <Suspense fallback={<GeneratePageSkeleton />}>
        <PaperGenerator />
      </Suspense>
    </div>
  )
} 
```

### `app/(dashboard)/history/page.tsx`

```tsx
import { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import HistoryManager from '@/components/HistoryManager'
import { Suspense } from 'react'
import { LoadingSpinner } from '@/components/ui/loading-spinner'

export const metadata: Metadata = {
  title: 'Project History | Genpaper',
  description: 'View and manage your research paper generation history',
}

export default async function HistoryPage() {
  const supabase = await createClient()
  const { data: { user }, error } = await supabase.auth.getUser()

  if (error || !user) {
    redirect('/login')
  }

  return (
    <div className="min-h-screen bg-background">
      <Suspense fallback={<HistoryPageSkeleton />}>
        <HistoryManager />
      </Suspense>
    </div>
  )
}

function HistoryPageSkeleton() {
  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      <div className="space-y-2">
        <div className="h-8 bg-muted rounded w-48 animate-pulse" />
        <div className="h-4 bg-muted rounded w-72 animate-pulse" />
      </div>
      
      <div className="grid gap-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="border rounded-lg p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div className="space-y-2 flex-1">
                <div className="h-5 bg-muted rounded w-3/4 animate-pulse" />
                <div className="h-4 bg-muted rounded w-1/2 animate-pulse" />
              </div>
              <div className="h-6 bg-muted rounded w-16 animate-pulse" />
            </div>
          </div>
        ))}
      </div>
      
      <div className="flex items-center justify-center py-8">
        <LoadingSpinner text="Loading project history..." />
      </div>
    </div>
  )
} 
```

### `app/(dashboard)/layout.tsx`

```tsx
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import DashboardNav from '@/components/DashboardNav'

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createClient()
  const { data: { user }, error } = await supabase.auth.getUser()

  if (error || !user) {
    redirect('/login')
  }

  return (
    <div className="min-h-screen bg-background">
      <DashboardNav />
      <main>{children}</main>
      </div>
  )
}

```

### `app/(dashboard)/library/page.tsx`

```tsx
import { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import LibraryManager from '@/components/LibraryManager'
import { Suspense } from 'react'
import { LoadingSpinner } from '@/components/ui/loading-spinner'

export const metadata: Metadata = {
  title: 'Research Library | Genpaper',
  description: 'Manage your research papers, collections, and notes',
}

export default async function LibraryPage() {
  const supabase = await createClient()
  const { data: { user }, error } = await supabase.auth.getUser()

  if (error || !user) {
    redirect('/login')
  }

  return (
    <div className="min-h-screen bg-background">
      <Suspense fallback={<LibraryPageSkeleton />}>
        <LibraryManager />
      </Suspense>
    </div>
  )
}

function LibraryPageSkeleton() {
  return (
    <div className="max-w-7xl mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <div className="h-8 bg-muted rounded w-32 animate-pulse" />
          <div className="h-4 bg-muted rounded w-64 animate-pulse" />
        </div>
        <div className="flex gap-2">
          <div className="h-9 bg-muted rounded w-32 animate-pulse" />
          <div className="h-9 bg-muted rounded w-24 animate-pulse" />
        </div>
      </div>
      
      <div className="border rounded-lg p-6">
        <div className="flex items-center justify-center py-12">
          <LoadingSpinner text="Loading library..." />
        </div>
      </div>
    </div>
  )
} 
```

### `app/api/collections/route.ts`

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { 
  createCollection, 
  getUserCollections, 
  deleteCollection,
  addPaperToCollection,
  removePaperFromCollection
} from '@/lib/db/library'

// GET - Retrieve user's collections
export async function GET() {
  try {
    const supabase = await createClient()
    
    // Check authentication
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const collections = await getUserCollections(user.id)

    return NextResponse.json({
      collections
    })

  } catch (error) {
    console.error('Error in collections GET API:', error)
    return NextResponse.json(
      { error: 'Internal server error' }, 
      { status: 500 }
    )
  }
}

// POST - Create a new collection
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    
    // Check authentication
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { name, description } = await request.json()

    if (!name?.trim()) {
      return NextResponse.json({ error: 'Collection name is required' }, { status: 400 })
    }

    const collection = await createCollection(user.id, name.trim(), description)

    return NextResponse.json(collection, { status: 201 })

  } catch (error) {
    console.error('Error in collections POST API:', error)
    return NextResponse.json(
      { error: 'Internal server error' }, 
      { status: 500 }
    )
  }
}

// DELETE - Delete a collection
export async function DELETE(request: NextRequest) {
  try {
    const supabase = await createClient()
    
    // Check authentication
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const url = new URL(request.url)
    const collectionId = url.searchParams.get('id')
    
    if (!collectionId) {
      return NextResponse.json({ error: 'Collection ID is required' }, { status: 400 })
    }

    // Verify ownership
    const { data: collection, error } = await supabase
      .from('library_collections')
      .select('id')
      .eq('id', collectionId)
      .eq('user_id', user.id)
      .single()

    if (error || !collection) {
      return NextResponse.json({ error: 'Collection not found' }, { status: 404 })
    }

    await deleteCollection(collectionId)

    return NextResponse.json({ success: true })

  } catch (error) {
    console.error('Error in collections DELETE API:', error)
    return NextResponse.json(
      { error: 'Internal server error' }, 
      { status: 500 }
    )
  }
}

// PUT - Add/remove paper from collection
export async function PUT(request: NextRequest) {
  try {
    const supabase = await createClient()
    
    // Check authentication
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { collectionId, paperId, action } = await request.json()

    if (!collectionId || !paperId || !action) {
      return NextResponse.json({ 
        error: 'Collection ID, paper ID, and action (add/remove) are required' 
      }, { status: 400 })
    }

    // Verify collection ownership
    const { data: collection, error } = await supabase
      .from('library_collections')
      .select('id')
      .eq('id', collectionId)
      .eq('user_id', user.id)
      .single()

    if (error || !collection) {
      return NextResponse.json({ error: 'Collection not found' }, { status: 404 })
    }

    if (action === 'add') {
      await addPaperToCollection(collectionId, paperId)
    } else if (action === 'remove') {
      await removePaperFromCollection(collectionId, paperId)
    } else {
      return NextResponse.json({ error: 'Invalid action. Use "add" or "remove"' }, { status: 400 })
    }

    return NextResponse.json({ success: true })

  } catch (error) {
    console.error('Error in collections PUT API:', error)
    return NextResponse.json(
      { error: 'Internal server error' }, 
      { status: 500 }
    )
  }
} 
```

### `app/api/fetch-sources/route.ts`

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { searchAndIngestPapers } from '@/lib/services/paper-aggregation'
import { createClient } from '@/lib/supabase/server'
import { z } from 'zod'
import { shortHash } from '@/lib/utils/hash'

// Use Edge runtime for better performance and global distribution
export const runtime = 'edge'

// Schema validation with Zod
const FetchSourcesRequestSchema = z.object({
  topic: z.string().min(1).max(500).trim(),
  options: z.object({
    ingestPapers: z.boolean().optional().default(true),
    maxResults: z.number().int().min(1).max(100).optional().default(25),
    sources: z.array(z.enum(['openalex', 'crossref', 'semantic_scholar', 'arxiv', 'core'])).optional().default(['openalex', 'crossref', 'semantic_scholar']),
    includePreprints: z.boolean().optional().default(true),
    fromYear: z.number().int().min(1900).max(new Date().getFullYear()).optional(),
    toYear: z.number().int().min(1900).max(new Date().getFullYear()).optional(),
    openAccessOnly: z.boolean().optional().default(false),
    semanticWeight: z.number().min(0).max(2).optional().default(1.0),
    authorityWeight: z.number().min(0).max(2).optional().default(0.5),
    recencyWeight: z.number().min(0).max(2).optional().default(0.1)
  }).optional().default({})
}).refine(data => {
  if (data.options.fromYear && data.options.toYear) {
    return data.options.fromYear <= data.options.toYear
  }
  return true
}, {
  message: "fromYear must be less than or equal to toYear"
})

interface FetchSourcesResponse {
  success: boolean
  topic: string
  papers: Array<{
    canonical_id?: string
    title: string
    abstract?: string
    year: number
    venue?: string
    doi?: string
    url?: string
    citationCount: number
    relevanceScore?: number
    source: string
  }>
  ingestedIds?: string[]
  count: number
  cached?: boolean
  error?: string
}

type CacheableOptions = {
  maxResults?: number
  sources?: string[]
  includePreprints?: boolean
  fromYear?: number
  toYear?: number
  openAccessOnly?: boolean
  semanticWeight?: number
  authorityWeight?: number
  recencyWeight?: number
  useLibraryOnly?: boolean
}

function generateCacheKey(topic: string, options: CacheableOptions): string {
  const normalizedOptions = {
    maxResults: options.maxResults,
    sources: options.sources?.sort(),
    includePreprints: options.includePreprints,
    fromYear: options.fromYear,
    toYear: options.toYear,
    openAccessOnly: options.openAccessOnly,
    semanticWeight: options.semanticWeight,
    authorityWeight: options.authorityWeight,
    recencyWeight: options.recencyWeight,
    useLibraryOnly: options.useLibraryOnly
  }
  
  const keyData = JSON.stringify({ t: topic, o: normalizedOptions })
  return shortHash(keyData)
}

function sanitizeForLogging(options: CacheableOptions) {
  return {
    maxResults: options.maxResults,
    sources: options.sources,
    includePreprints: options.includePreprints,
    hasTimeFilter: !!(options.fromYear || options.toYear),
    openAccessOnly: options.openAccessOnly
  }
}

let healthCheckCache: { result: Record<string, unknown>, timestamp: number } | null = null
const HEALTH_CACHE_TTL = 5 * 60 * 1000 // 5 minutes

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const validationResult = FetchSourcesRequestSchema.safeParse(body)
    
    if (!validationResult.success) {
      return NextResponse.json(
        { 
          success: false, 
          error: 'Invalid request parameters',
          details: validationResult.error.errors.map(e => ({
            path: e.path.join('.'),
            message: e.message
          }))
        },
        { status: 400 }
      )
    }

    const { topic, options } = validationResult.data

    console.log(`API: Searching for papers, topic length: ${topic.length} chars`)
    console.log(`API: Options:`, sanitizeForLogging(options))

    const cacheKey = generateCacheKey(topic, options)
    
    const supabase = await createClient()
    
    // Check for recent cached results (last 24 hours)
    const { data: cachedResults, error: cacheError } = await supabase
      .from('papers_api_cache')
      .select('response, fetched_at')
      .eq('id', cacheKey)
      .gte('fetched_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
      .single()

    if (cacheError && cacheError.code !== 'PGRST116') {
      console.error('Cache lookup error:', cacheError)
      return NextResponse.json(
        {
          success: false,
          error: 'Cache lookup failed',
          topic: '',
          papers: [],
          count: 0
        },
        { status: 500 }
      )
    }

    if (!cacheError && cachedResults) {
      console.log('API: Returning cached results')
      const cachedResponse = cachedResults.response as FetchSourcesResponse
      return NextResponse.json({
        ...cachedResponse,
        cached: true
      })
    }

    // Perform the search and ingestion
    const result = await searchAndIngestPapers(topic, {
      maxResults: options.maxResults,
      sources: options.sources,
      includePreprints: options.includePreprints,
      fromYear: options.fromYear,
      toYear: options.toYear,
      openAccessOnly: options.openAccessOnly,
      semanticWeight: options.semanticWeight,
      authorityWeight: options.authorityWeight,
      recencyWeight: options.recencyWeight
    })

    const optimizedResponse: FetchSourcesResponse = {
      success: true,
      topic,
      papers: result.papers.map(paper => ({
        canonical_id: paper.canonical_id,
        title: paper.title,
        abstract: paper.abstract?.substring(0, 500),
        year: paper.year,
        venue: paper.venue,
        doi: paper.doi,
        url: paper.url,
        citationCount: paper.citationCount,
        relevanceScore: paper.relevanceScore,
        source: paper.source
      })),
      count: result.papers.length,
      cached: false
    }

    if (options.ingestPapers) {
      optimizedResponse.ingestedIds = result.ingestedIds
    }

    // Cache successful response
    if (result.papers.length > 0) {
      try {
        await supabase
          .from('papers_api_cache')
          .upsert({
            id: cacheKey,
            response: optimizedResponse,
            fetched_at: new Date().toISOString(),
            expires_at: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
            request_hash: cacheKey
          })
      } catch (cacheUpsertError) {
        console.error('Cache storage error:', cacheUpsertError)
      }
    }

    console.log(`API: Successfully found ${result.papers.length} papers`)
    if (options.ingestPapers) {
      console.log(`API: Successfully ingested ${result.ingestedIds.length} papers`)
    }

    const fullResponse: FetchSourcesResponse = {
      success: true,
      topic,
      papers: result.papers,
      count: result.papers.length,
      cached: false
    }

    if (options.ingestPapers) {
      fullResponse.ingestedIds = result.ingestedIds
    }

    return NextResponse.json(fullResponse)

  } catch (error) {
    console.error('API: fetchSources error:', error)
    
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Internal server error',
        topic: '',
        papers: [],
        count: 0
      },
      { status: 500 }
    )
  }
}

export async function GET() {
  try {
    const now = Date.now()
    if (healthCheckCache && (now - healthCheckCache.timestamp) < HEALTH_CACHE_TTL) {
      console.log('Health check: Returning cached result')
      return NextResponse.json({
        ...healthCheckCache.result,
        cached: true
      })
    }

    const supabase = await createClient()
    
    const { error } = await supabase.from('papers').select('id').limit(1)
    
    if (error) {
      throw new Error(`Database connection failed: ${error.message}`)
    }

    const healthResult = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      apis: {
        openalex: 'available',
        crossref: 'available', 
        semantic_scholar: 'available',
        arxiv: 'available',
        core: process.env.CORE_API_KEY ? 'available' : 'api_key_required'
      },
      cached: false
    }

    healthCheckCache = {
      result: healthResult,
      timestamp: now
    }

    return NextResponse.json(healthResult)
  } catch (error) {
    const errorResult = {
      status: 'unhealthy',
      error: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString(),
      cached: false
    }

    return NextResponse.json(errorResult, { status: 500 })
  }
}
```

### `app/api/generate/blocks/route.ts`

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { generateSectionsAsBlocks } from '@/lib/generation/block-runner'
import { collectPapers } from '@/lib/generation/discovery'
import { ensureChunksForPapers, getRelevantChunks } from '@/lib/generation/chunks'
import { generateOutline } from '@/lib/prompts/generators'
import { mergeWithDefaults } from '@/lib/generation/config'
import type { EnhancedGenerationOptions } from '@/lib/generation/types'
import type { SectionContext } from '@/lib/prompts/types'

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { topic, libraryPaperIds = [], useLibraryOnly = false, config: rawConfig } = body

    if (!topic?.trim()) {
      return NextResponse.json({ error: 'Topic is required' }, { status: 400 })
    }

    const config = mergeWithDefaults(rawConfig)

    // Create research project first
    const { data: project, error: projectError } = await supabase
      .from('research_projects')
      .insert({
        user_id: user.id,
        topic: topic.trim(),
        status: 'generating',
        generation_config: {
          ...config,
          paper_settings: {
            ...config.paper_settings,
            length: config.paper_settings?.length || 'medium',
            paperType: config.paper_settings?.paperType || 'researchArticle',
            useLibraryOnly,
            selectedPaperIds: libraryPaperIds
          }
        }
      })
      .select()
      .single()

    if (projectError || !project) {
      console.error('Failed to create project:', projectError)
      return NextResponse.json({ error: 'Failed to create project' }, { status: 500 })
    }

    // Create document for this project
    const { data: document, error: docError } = await supabase
      .from('documents')
      .insert({
        project_id: project.id,
        title: topic.trim(),
        user_id: user.id
      })
      .select()
      .single()

    if (docError || !document) {
      console.error('Failed to create document:', docError)
      return NextResponse.json({ error: 'Failed to create document' }, { status: 500 })
    }

    console.log(`🔧 Starting block-based generation for project ${project.id}`)

    // Set up streaming response
    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      async start(controller) {
        try {
          // Step 1: Collect papers
          const options: EnhancedGenerationOptions = {
            projectId: project.id,
            userId: user.id,
            topic: topic.trim(),
            libraryPaperIds,
            useLibraryOnly,
            config
          }

          const allPapers = await collectPapers(options)
          
          // Send progress update
          controller.enqueue(encoder.encode(JSON.stringify({
            type: 'progress',
            progress: 20,
            message: `Found ${allPapers.length} papers`
          }) + '\n'))

          // Step 2: Ensure chunks and generate outline
          await ensureChunksForPapers(allPapers)
          
          const outline = await generateOutline(
            config.paper_settings?.paperType || 'researchArticle',
            topic.trim(),
            allPapers.map(p => p.id)
          )

          controller.enqueue(encoder.encode(JSON.stringify({
            type: 'progress',
            progress: 40,
            message: `Generated outline with ${outline.sections.length} sections`
          }) + '\n'))

          // Step 3: Build section contexts
          const sectionContexts: SectionContext[] = []
          const chunkCache = new Map<string, Array<{ paper_id: string; content: string; score?: number }>>()
          
          for (const section of outline.sections) {
            const cacheKey = section.candidatePaperIds.sort().join(',')
            
            let contextChunks = chunkCache.get(cacheKey)
            if (!contextChunks) {
              contextChunks = await getRelevantChunks(
                topic.trim(),
                section.candidatePaperIds,
                Math.min(20, section.candidatePaperIds.length * 3)
              )
              chunkCache.set(cacheKey, contextChunks)
            }
            
            sectionContexts.push({
              sectionKey: section.sectionKey,
              title: section.title,
              candidatePaperIds: section.candidatePaperIds,
              contextChunks,
              expectedWords: section.expectedWords
            })
          }

          controller.enqueue(encoder.encode(JSON.stringify({
            type: 'progress',
            progress: 60,
            message: 'Starting section generation...'
          }) + '\n'))

          // Step 4: Generate sections as blocks
          const { blocks, capturedToolCalls } = await generateSectionsAsBlocks(
            document.id,
            topic.trim(),
            sectionContexts,
            allPapers,
            config,
            supabase,
            (progress, message) => {
              controller.enqueue(encoder.encode(JSON.stringify({
                type: 'progress',
                progress: 60 + (progress * 0.35), // 60% to 95%
                message
              }) + '\n'))
            },
            (block) => {
              // Stream each block as it's created
              controller.enqueue(encoder.encode(JSON.stringify({
                type: 'block',
                block
              }) + '\n'))
            }
          )

          // Step 5: Update project status
          await supabase
            .from('research_projects')
            .update({ 
              status: 'completed',
              updated_at: new Date().toISOString()
            })
            .eq('id', project.id)

          // Send completion
          controller.enqueue(encoder.encode(JSON.stringify({
            type: 'complete',
            projectId: project.id,
            documentId: document.id,
            blocksCount: blocks.length,
            toolCallsCount: capturedToolCalls.length
          }) + '\n'))

          controller.close()

        } catch (error) {
          console.error('Block generation error:', error)
          
          // Update project status to failed
          try {
            await supabase
              .from('research_projects')
              .update({ status: 'failed' })
              .eq('id', project.id)
          } catch (updateError) {
            console.error('Failed to update project status:', updateError)
          }

          controller.enqueue(encoder.encode(JSON.stringify({
            type: 'error',
            error: error instanceof Error ? error.message : 'Unknown error'
          }) + '\n'))
          
          controller.close()
        }
      }
    })

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    })

  } catch (error) {
    console.error('API error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

export const runtime = 'nodejs'
export const maxDuration = 300 // 5 minutes 
```

### `app/api/generate/outline/route.ts`

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { generateOutline } from '@/lib/prompts/generators'
import { getUserLocation } from '@/lib/utils/user-location'
import type { PaperTypeKey, OutlineConfig } from '@/lib/prompts/types'

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    
    // Check authentication
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { 
      topic, 
      paperType = 'researchArticle',
      selectedPapers = [], 
      localRegion,
      pageLength = 'medium'
    } = body

    if (!topic?.trim()) {
      return NextResponse.json({ error: 'Topic is required' }, { status: 400 })
    }

    if (!paperType) {
      return NextResponse.json({ error: 'Paper type is required' }, { status: 400 })
    }

    // Automatically detect user's location for regional boosting
    const userLocation = await getUserLocation(user.id, request)

    // Prepare configuration for outline generation
    const config: OutlineConfig = {
      topic,
      citationStyle: 'apa',
      localRegion: localRegion || userLocation || 'global',
      pageLength: pageLength ? parseInt(pageLength) : undefined,
      temperature: 0.3, // Lower temperature for more consistent outlines
      maxTokens: 2000
    }

    // Generate outline using the backend function
    const outline = await generateOutline(
      paperType as PaperTypeKey,
      topic,
      selectedPapers,
      config
    )

    return NextResponse.json({
      success: true,
      outline
    })

  } catch (error) {
    console.error('Error generating outline:', error)
    
    // Handle specific errors
    if (error instanceof Error) {
      if (error.message.includes('Invalid paper type')) {
        return NextResponse.json({ error: error.message }, { status: 400 })
      }
      if (error.message.includes('No outline template found')) {
        return NextResponse.json({ error: error.message }, { status: 400 })
      }
    }

    return NextResponse.json(
      { error: 'Failed to generate outline. Please try again.' }, 
      { status: 500 }
    )
  }
} 
```

### `app/api/generate/route.ts`

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createResearchProject } from '@/lib/db/research'
import { generatePaperPipeline } from '@/lib/services/generate'
import { getUserLocation } from '@/lib/utils/user-location'
import type { 
  GenerateRequest, 
  GenerateResponse, 
  GenerationConfig
} from '@/types/simplified'

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    
    // Check authentication
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body: GenerateRequest = await request.json()
    const { topic, libraryPaperIds, useLibraryOnly, config } = body

    if (!topic?.trim()) {
      return NextResponse.json({ error: 'Topic is required' }, { status: 400 })
    }

    // Automatically detect user's location for regional boosting
    const userLocation = await getUserLocation(user.id, request)

    // Create generation config
    const generationConfig: GenerationConfig = {
      temperature: 0.7,
      max_tokens: 16000,
      stream: false,
      search_parameters: {
        sources: ['arxiv', 'openalex', 'crossref', 'semantic_scholar'],
        limit: 25,
        fromYear: 1990,
        includePreprints: false,
        useSemanticSearch: true,
        fallbackToAcademic: true
      },
      paper_settings: {
        length: config?.length || 'medium',
        paperType: config?.paperType || 'researchArticle',
        localRegion: config?.localRegion || userLocation, // Auto-detect user's location
        includeMethodology: config?.includeMethodology ?? true
      },
      library_papers_used: libraryPaperIds || []
    }

    // Create research project
    const project = await createResearchProject(user.id, topic, generationConfig)

    // Start paper generation in the background with proper error handling
    void generatePaperPipeline({
      projectId: project.id,
      userId: user.id,
      topic,
      libraryPaperIds,
      useLibraryOnly,
      generationConfig
    }).catch(error => {
      console.error('Background generation failed:', error)
    })

    const response: GenerateResponse = {
      projectId: project.id,
      status: 'generating',
      message: 'Paper generation started. You can check the status or view progress.'
    }

    return NextResponse.json(response)

  } catch (error) {
    console.error('Error in generate API:', error)
    return NextResponse.json(
      { error: 'Internal server error' }, 
      { status: 500 }
    )
  }
}

// GET endpoint for checking generation status
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    
    // Check authentication
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const url = new URL(request.url)
    const projectId = url.searchParams.get('projectId')

    if (!projectId) {
      return NextResponse.json({ error: 'Project ID is required' }, { status: 400 })
    }

    // Get project status
    const { data: project, error } = await supabase
      .from('research_projects')
      .select('id, topic, status, created_at, completed_at')
      .eq('id', projectId)
      .eq('user_id', user.id)
      .single()

    if (error || !project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 })
    }

    return NextResponse.json({
      projectId: project.id,
      topic: project.topic,
      status: project.status,
      createdAt: project.created_at,
      completedAt: project.completed_at
    })

  } catch (error) {
    console.error('Error checking generation status:', error)
    return NextResponse.json(
      { error: 'Internal server error' }, 
      { status: 500 }
    )
  }
} 
```

### `app/api/generate/stream/route.ts`

```typescript
import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createResearchProject } from '@/lib/db/research'
import { generateDraftWithRAG } from '@/lib/generation'
import type { GenerationConfig } from '@/types/simplified'

// Use Node.js runtime for better DNS resolution and OpenAI SDK compatibility
export const runtime = 'nodejs'

// Fail fast on missing environment variables
if (!process.env.OPENAI_API_KEY) {
  throw new Error('OPENAI_API_KEY environment variable is required')
}

const isDev = process.env.NODE_ENV !== 'production'

export async function OPTIONS() {
  return new Response(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400'
    }
  })
}

// GET - EventSource endpoint for streaming (Task 5 requirement)
export async function GET(request: NextRequest) {
  if (isDev) console.log('🚀 Starting GET /api/generate/stream (AI SDK Streaming)')
  
  let supabase
  
  try {
    // Create Supabase client that can read cookies
    supabase = await createClient()
    
    // Check authentication - EventSource sends cookies automatically
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    
    if (authError || !user) {
      // For development, allow bypass with a test parameter
      const url = new URL(request.url)
      const isTest = url.searchParams.get('test') === 'true' && isDev
      
      if (!isTest) {
        if (isDev) console.log('❌ Authentication failed:', authError?.message || 'No user')
        return new Response('Unauthorized. Please log in to use this feature.', { 
          status: 401,
          headers: {
            'Content-Type': 'text/plain',
            'Access-Control-Allow-Origin': '*'
          }
        })
      } else {
        if (isDev) console.log('🧪 Test mode: bypassing authentication')
      }
    } else {
      if (isDev) console.log('✅ User authenticated:', user.id)
    }

    // Get query parameters for the generation request
    const url = new URL(request.url)
    const topic = url.searchParams.get('topic')
    const useLibraryOnly = url.searchParams.get('useLibraryOnly') === 'true'
    const forceIngest = url.searchParams.get('forceIngest') === 'true'
    const length = url.searchParams.get('length') || 'medium'
    const paperType = url.searchParams.get('paperType') || 'researchArticle'

    if (!topic) {
      return new Response(
        JSON.stringify({ error: 'Topic parameter is required' }), 
        { 
          status: 400,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
          }
        }
      )
    }

    if (isDev) console.log('🎯 Creating research project for AI SDK streaming...')
    console.log('📝 Creating research project for user:', user?.id || 'test')
    console.log('📝 Topic:', topic)
    
    // Create generation config
    const generationConfig: GenerationConfig = {
      temperature: 0.2,
      max_tokens: 16000,
      stream: true,
      search_parameters: {
        sources: [],
        limit: 25,
        useSemanticSearch: true,
        forceIngest
      },
      library_papers_used: [],
      paper_settings: {
        length: length as 'short' | 'medium' | 'long',
        paperType: paperType as 'researchArticle' | 'literatureReview' | 'capstoneProject' | 'mastersThesis' | 'phdDissertation',
      }
    }

    console.log('📝 Config:', generationConfig)

    // Create research project (skip in test mode)
    let project: { id: string } = { id: 'test-project' }
    if (user) {
      project = await createResearchProject(user.id, topic, generationConfig)
      console.log('✅ Research project created successfully:', project.id)
      if (isDev) console.log('✅ Research project created:', project.id)
    }

    // Set up streaming response with custom headers
    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      async start(controller) {
        let isControllerClosed = false
        
        // Helper function to send progress events
        const sendProgress = (stage: string, progress: number, message: string, content?: string) => {
          if (isControllerClosed) return // Prevent writing to closed controller
          
          try {
            const data = JSON.stringify({
              type: 'progress',
              stage,
              progress,
              message,
              content,
              timestamp: new Date().toISOString()
            })
            controller.enqueue(encoder.encode(`data: ${data}\n\n`))
          } catch (error) {
            console.warn('Failed to send progress:', error)
            isControllerClosed = true
          }
        }

        // Helper function to send status events
        const sendStatus = (status: string, data?: Record<string, unknown>) => {
          if (isControllerClosed) return
          
          try {
            const statusData = JSON.stringify({
              type: 'status',
              status,
              projectId: project.id,
              data,
              timestamp: new Date().toISOString()
            })
            controller.enqueue(encoder.encode(`data: ${statusData}\n\n`))
          } catch (error) {
            console.warn('Failed to send status:', error)
            isControllerClosed = true
          }
        }

        // Helper function to send error events
        const sendError = (error: string) => {
          if (isControllerClosed) return
          
          try {
            const errorData = JSON.stringify({
              type: 'error',
              error,
              timestamp: new Date().toISOString()
            })
            controller.enqueue(encoder.encode(`data: ${errorData}\n\n`))
          } catch (error) {
            console.warn('Failed to send error:', error)
          } finally {
            isControllerClosed = true
          }
        }

        try {
          // Send initial status with projectId
          sendStatus('started', { projectId: project.id })

          // Use the enhanced generation function with progress callback
          const result = await generateDraftWithRAG({
            projectId: project.id,
            userId: user?.id || 'test-user',
            topic,
            useLibraryOnly,
            config: generationConfig,
            onProgress: (progress) => {
              sendProgress(progress.stage, progress.progress, progress.message, progress.content)
            }
          })

          // Send final completion with full content
          if (!isControllerClosed) {
            // Convert citationsMap to plain object for JSON serialization
            const citationsMapObject = Object.fromEntries(result.citationsMap)
            
            const completionData = JSON.stringify({
              type: 'complete',
              projectId: project.id,
              content: result.content,
              citations: result.citations,
              citationsMap: citationsMapObject,
              wordCount: result.wordCount,
              sources: result.sources,
              timestamp: new Date().toISOString()
            })
            controller.enqueue(encoder.encode(`data: ${completionData}\n\n`))
          }

        } catch (error) {
          console.error('❌ Enhanced generation error:', error)
          sendError(error instanceof Error ? error.message : 'Unknown error occurred')
        } finally {
          if (!isControllerClosed) {
            controller.close()
            isControllerClosed = true
          }
        }
      }
    })

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET',
        'Access-Control-Allow-Headers': 'Content-Type'
      }
    })

  } catch (error) {
    console.error('❌ AI SDK streaming error:', error)
    
    // Return a proper SSE error response
    const errorStream = new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder()
        const errorData = JSON.stringify({
          type: 'error',
          error: error instanceof Error ? error.message : 'Internal server error',
          timestamp: new Date().toISOString()
        })
        controller.enqueue(encoder.encode(`data: ${errorData}\n\n`))
        controller.close()
      }
    })
    
    return new Response(errorStream, {
      status: 200, // SSE should return 200 even for errors
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET',
        'Access-Control-Allow-Headers': 'Content-Type'
      }
    })
  }
}

// POST - Start generation and return streaming response (keeping existing functionality)
export async function POST(request: NextRequest) {
  if (isDev) console.log('🚀 Starting POST /api/generate/stream')
  
  const body = await request.json()
  const { topic, useLibraryOnly, forceIngest, length, paperType } = body
  
  // Create a new request with query parameters for the GET handler
  const url = new URL(request.url)
  if (topic) url.searchParams.set('topic', topic)
  // Properly preserve boolean parameters even when false
  if (typeof useLibraryOnly === 'boolean') url.searchParams.set('useLibraryOnly', String(useLibraryOnly))
  if (typeof forceIngest === 'boolean') url.searchParams.set('forceIngest', String(forceIngest))
  if (length) url.searchParams.set('length', length)
  if (paperType) url.searchParams.set('paperType', paperType)  
  // Create a new request object with the updated URL
  const newRequest = new NextRequest(url, {
    method: 'GET',
    headers: request.headers
  })
  
  // Call the GET handler directly
  return await GET(newRequest)
} 
```

### `app/api/generate/unified/route.ts`

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { generateWithUnifiedTemplate } from '@/lib/generation/unified-generator'
import type { SectionContext } from '@/lib/prompts/unified/prompt-builder'

// Command to section mapping - this could be made more flexible
const COMMAND_SECTION_MAP = {
  write: 'introduction',
  rewrite: 'discussion', 
  cite: 'references',
  outline: 'structure'
} as const

/**
 * Unified Generation API - Single endpoint for all content generation levels 
 * 
 * Supports:
 * - Full section generation
 * - Block-level rewrites  
 * - Sentence-level edits
 * - Multi-section batch processing
 * 
 * All using the same underlying skeleton template with contextual data
 */

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    
    // Get user - this could be optimized with signed cookies for streaming
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return new NextResponse('Unauthorized', { status: 401 })
    }

    const body = await request.json()
    const { 
      command, 
      projectId, 
      selectedText, 
      sectionKey = COMMAND_SECTION_MAP[command as keyof typeof COMMAND_SECTION_MAP] || 'general'
    } = body

    if (!command || !projectId) {
      return new NextResponse('Missing required fields', { status: 400 })
    }

    // Create a streaming response with proper headers for Safari compatibility
    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      async start(controller) {
        try {
          // Generate unique block ID using crypto
          const blockId = crypto.randomUUID()

          // Build section context for unified generator
          const sectionContext: SectionContext = {
            projectId,
            sectionId: blockId,
            paperType: 'researchArticle',
            sectionKey,
            availablePapers: [],
            contextChunks: selectedText ? [{
              paper_id: 'current_selection',
              content: selectedText,
              title: 'Selected Text'
            }] : []
          }

          // Generate content using the unified generator
          const result = await generateWithUnifiedTemplate({
            context: sectionContext,
            options: {
              targetWords: command === 'cite' ? 100 : command === 'outline' ? 200 : 300,
              sentenceMode: command === 'cite',
              forceRewrite: command === 'rewrite'
            },
            onProgress: (stage: string, progress: number, message: string) => {
              controller.enqueue(
                encoder.encode(JSON.stringify({ 
                  type: 'progress',
                  stage,
                  progress,
                  message
                }) + '\n')
              )
            }
          })

          // Stream the final content
          controller.enqueue(
            encoder.encode(JSON.stringify({ 
              type: 'content', 
              content: result.content,
              blockId 
            }) + '\n')
          )

          // Store block in database
          await supabase
            .from('blocks')
            .upsert({
              id: blockId,
              document_id: projectId,
              type: command === 'outline' ? 'heading' : 'paragraph',
              content: {
                type: command === 'outline' ? 'heading' : 'paragraph',
                attrs: command === 'outline' ? { level: 2 } : {},
                content: [{ type: 'text', text: result.content }]
              },
              position: Date.now(),
              metadata: {
                command,
                generatedAt: new Date().toISOString(),
                wordCount: result.wordCount
              }
            })

          controller.enqueue(
            encoder.encode(JSON.stringify({ 
              type: 'complete',
              blockId,
              message: 'Content generated successfully'
            }) + '\n')
          )

        } catch (error) {
          console.error('Generation error:', error)
          controller.enqueue(
            encoder.encode(JSON.stringify({ 
              type: 'error', 
              message: error instanceof Error ? error.message : 'Generation failed' 
            }) + '\n')
          )
        } finally {
          controller.close()
        }
      }
    })

    return new NextResponse(stream, {
      status: 200,
      headers: {
        'Content-Type': 'application/x-ndjson',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    })

  } catch (error) {
    console.error('API error:', error)
    return new NextResponse(
      JSON.stringify({ error: 'Internal server error' }), 
      { 
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          'Retry-After': '60' // Add retry header for rate limit cases
        }
      }
    )
  }
}

/**
 * GET endpoint for testing the unified approach
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const demo = searchParams.get('demo')
  
  if (demo === 'examples') {
    // Return example usage patterns
    return NextResponse.json({
      examples: {
        full_section: {
          action: 'generate',
          context: {
            projectId: 'proj-123',
            sectionId: 'results-001',
            paperType: 'researchArticle',
            sectionKey: 'results',
            availablePapers: ['paper1', 'paper2'],
            contextChunks: [
              { paper_id: 'paper1', content: 'Statistical analysis showed...' }
            ]
          },
          options: { targetWords: 1000 }
        },
        
        block_rewrite: {
          action: 'rewrite',
          context: {
            projectId: 'proj-123',
            sectionId: 'methods-001',
            blockId: 'block-456',
            paperType: 'researchArticle',
            sectionKey: 'methodology',
            availablePapers: ['paper1', 'paper2'],
            contextChunks: [
              { paper_id: 'paper1', content: 'Methodology details...' }
            ]
          },
          options: { forceRewrite: true }
        },
        
        sentence_edit: {
          action: 'edit',
          context: {
            projectId: 'proj-123',
            sectionId: 'discussion-001',
            blockId: 'block-789',
            paperType: 'researchArticle', 
            sectionKey: 'discussion',
            availablePapers: ['paper1'],
            contextChunks: [
              { paper_id: 'paper1', content: 'Discussion points...' }
            ]
          },
          options: { sentenceMode: true, targetWords: 30 }
        },
        
        batch_generation: {
          action: 'batch',
          batch_contexts: [
            // Multiple section contexts...
          ],
          options: { targetWords: 800 }
        }
      },
      
      benefits: {
        unified_template: 'Single YAML skeleton adapts to any content level',
        coherence: 'Rolling summaries maintain document coherence',
        scalability: 'Same system works for sentences, blocks, sections, or papers',
        maintainability: 'Change style in one place, affects all generations',
        quality: 'Consistent reflection and drift detection across all levels'
      }
    })
  }
  
  return NextResponse.json({
    message: 'Unified Generation API',
    description: 'Single endpoint for all content generation using unified skeleton template',
    supported_actions: ['generate', 'rewrite', 'edit', 'batch'],
    examples_url: '/api/generate/unified?demo=examples'
  })
}

/**
 * Example usage from frontend:
 * 
 * // Full section generation
 * const response = await fetch('/api/generate/unified', {
 *   method: 'POST',
 *   body: JSON.stringify({
 *     action: 'generate',
 *     context: { ... },
 *     options: { targetWords: 1000 }
 *   })
 * })
 * 
 * // Block rewrite
 * const response = await fetch('/api/generate/unified', {
 *   method: 'POST', 
 *   body: JSON.stringify({
 *     action: 'rewrite',
 *     context: { ..., blockId: 'block-123' },
 *     options: { forceRewrite: true }
 *   })
 * })
 * 
 * // Sentence edit
 * const response = await fetch('/api/generate/unified', {
 *   method: 'POST',
 *   body: JSON.stringify({
 *     action: 'edit', 
 *     context: { ..., blockId: 'block-123' },
 *     options: { sentenceMode: true, targetWords: 25 }
 *   })
 * })
 */ 
```

### `app/api/library/papers/route.ts`

```typescript
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

interface AuthorRelation {
  author: {
    id: string
    name: string
  }
}

interface PaperWithAuthors {
  id: string
  title: string
  abstract: string | null
  publication_date: string | null
  venue: string | null
  doi: string | null
  url: string | null
  pdf_url: string | null
  citation_count: number | null
  impact_score: number | null
  created_at: string
  authors?: AuthorRelation[]
}

export async function GET() {
  try {
    const supabase = await createClient()
    
    // Check authentication
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get library papers for the authenticated user
    const { data: libraryPapers, error } = await supabase
      .from('library_papers')
      .select(`
        id,
        user_id,
        paper_id,
        notes,
        added_at,
        paper:papers (
          id,
          title,
          abstract,
          publication_date,
          venue,
          doi,
          url,
          pdf_url,
          citation_count,
          impact_score,
          created_at,
          authors:paper_authors (
            author:authors (
              id,
              name
            )
          )
        )
      `)
      .eq('user_id', user.id)
      .order('added_at', { ascending: false })

    if (error) {
      console.error('Error fetching library papers:', error)
      return NextResponse.json({ error: 'Failed to fetch library papers' }, { status: 500 })
    }

    // Transform the data to match the expected format
    const transformedPapers = libraryPapers.map(lp => {
      const paper = lp.paper as unknown as PaperWithAuthors
      return {
        ...lp,
        paper: {
          ...paper,
          authors: paper.authors?.map((pa: AuthorRelation) => pa.author) || [],
          author_names: paper.authors?.map((pa: AuthorRelation) => pa.author.name) || []
        }
      }
    })

    return NextResponse.json({
      papers: transformedPapers,
      count: transformedPapers.length
    })

  } catch (error) {
    console.error('Error in library papers endpoint:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
} 
```

### `app/api/library/route.ts`

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { 
  removePaperFromLibrary, 
  updateLibraryPaperNotes,
} from '@/lib/db/library'

interface PaperAuthorRelation {
  ordinal: number
  authors: {
    id: string
    name: string
  }
}

interface PaperData {
  id: string
  title: string
  abstract: string | null
  publication_date: string | null
  venue: string | null
  doi: string | null
  url: string | null
  pdf_url: string | null
  metadata: Record<string, unknown> | null
  source: string | null
  citation_count: number | null
  impact_score: number | null
  created_at: string
  paper_authors?: PaperAuthorRelation[]
}

// GET - Retrieve user's library papers
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    
    // Check authentication
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const search = searchParams.get('search')
    const collection = searchParams.get('collection')
    const source = searchParams.get('source')
    const sortBy = searchParams.get('sortBy') || 'added_at'
    const sortOrder = searchParams.get('sortOrder') || 'desc'

    let query = supabase
      .from('library_papers')
      .select(`
        id,
        paper_id,
        notes,
        added_at,
        papers:paper_id (
          id,
          title,
          abstract,
          publication_date,
          venue,
          doi,
          url,
          pdf_url,
          metadata,
          source,
          citation_count,
          impact_score,
          created_at,
          paper_authors (
            ordinal,
            authors (
              id,
              name
            )
          )
        )
      `)
      .eq('user_id', user.id)

    if (search) {
      // Simplified search approach to avoid parsing errors
      // Search in local notes OR in paper title/abstract
      query = query.or(`notes.ilike.%${search}%,papers.title.ilike.%${search}%`)
    }

    if (collection) {
      // Filter by collection if specified
      query = query.eq('collection_id', collection)
    }

    if (source) {
      query = query.eq('papers.source', source)
    }

    // Sort
    if (sortBy === 'title') {
      query = query.order('title', { foreignTable: 'papers', ascending: sortOrder === 'asc' })
    } else if (sortBy === 'publication_date') {
      query = query.order('publication_date', { foreignTable: 'papers', ascending: sortOrder === 'asc' })
    } else if (sortBy === 'citation_count') {
      query = query.order('citation_count', { foreignTable: 'papers', ascending: sortOrder === 'asc' })
    } else {
      // Default to added_at
      query = query.order('added_at', { ascending: sortOrder === 'asc' })
    }

    const { data: papers, error } = await query

    if (error) throw error

    // Transform the data to include author names
    const transformedPapers = (papers || []).map((item) => {
      const paperData = item.papers as unknown as PaperData
      return {
        ...item,
        paper: {
          ...paperData,
          authors: paperData.paper_authors?.sort((a: PaperAuthorRelation, b: PaperAuthorRelation) => a.ordinal - b.ordinal).map((pa: PaperAuthorRelation) => pa.authors) || [],
          author_names: paperData.paper_authors?.sort((a: PaperAuthorRelation, b: PaperAuthorRelation) => a.ordinal - b.ordinal).map((pa: PaperAuthorRelation) => pa.authors.name) || []
        }
      }
    })

    return NextResponse.json({ papers: transformedPapers }, {
      headers: {
        'Cache-Control': 'no-store, max-age=0, must-revalidate',
        'Pragma': 'no-cache'
      }
    })

  } catch (error) {
    console.error('Library fetch error:', error)
    return NextResponse.json({ error: 'Failed to load library' }, { status: 500 })
  }
}

// POST - Add paper to library
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    
    // Check authentication
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { paperId, notes } = await request.json()

    if (!paperId) {
      return NextResponse.json({ error: 'Paper ID is required' }, { status: 400 })
    }

    // Check if paper is already in user's library
    const { data: existingEntry, error: checkError } = await supabase
      .from('library_papers')
      .select('id')
      .eq('user_id', user.id)
      .eq('paper_id', paperId)
      .single()

    if (checkError && checkError.code !== 'PGRST116') {
      throw checkError
    }

    if (existingEntry) {
      return NextResponse.json({ 
        error: 'Paper is already in your library',
        code: 'DUPLICATE_ENTRY'
      }, { status: 409 })
    }

    // Add paper to user's library
    const { data, error } = await supabase
      .from('library_papers')
      .insert({
        user_id: user.id,
        paper_id: paperId,
        notes: notes || null
      })
      .select()
      .single()

    if (error) throw error

    return NextResponse.json({ success: true, entry: data })

  } catch (error) {
    console.error('Library add error:', error)
    return NextResponse.json({ error: 'Failed to add paper to library' }, { status: 500 })
  }
}

// PUT - Update library paper notes
export async function PUT(request: NextRequest) {
  try {
    const supabase = await createClient()
    
    // Check authentication
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const url = new URL(request.url)
    const libraryPaperId = url.searchParams.get('id')
    
    if (!libraryPaperId) {
      return NextResponse.json({ error: 'Library paper ID is required' }, { status: 400 })
    }

    const { notes } = await request.json()

    // Verify ownership
    const { data: libraryPaper, error } = await supabase
      .from('library_papers')
      .select('id')
      .eq('id', libraryPaperId)
      .eq('user_id', user.id)
      .single()

    if (error || !libraryPaper) {
      return NextResponse.json({ error: 'Library paper not found' }, { status: 404 })
    }

    await updateLibraryPaperNotes(libraryPaperId, notes || '')

    return NextResponse.json({ success: true })

  } catch (error) {
    console.error('Error in library PUT API:', error)
    return NextResponse.json(
      { error: 'Internal server error' }, 
      { status: 500 }
    )
  }
}

// DELETE - Remove paper from library
export async function DELETE(request: NextRequest) {
  try {
    const supabase = await createClient()
    
    // Check authentication
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const url = new URL(request.url)
    const paperId = url.searchParams.get('paperId')
    
    if (!paperId) {
      return NextResponse.json({ error: 'Paper ID is required' }, { status: 400 })
    }

    // First check if paper exists in user's library
    const { data: existingPaper, error: checkError } = await supabase
      .from('library_papers')
      .select('id')
      .eq('user_id', user.id)
      .eq('paper_id', paperId)
      .single()

    if (checkError && checkError.code !== 'PGRST116') { // PGRST116 is "not found"
      console.error('Error checking paper existence:', checkError)
      return NextResponse.json({ error: 'Database error' }, { status: 500 })
    }

    if (!existingPaper) {
      return NextResponse.json({ error: 'Paper not found in library' }, { status: 404 })
    }

    await removePaperFromLibrary(user.id, paperId)

    return NextResponse.json({ success: true }, {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0'
      }
    })

  } catch (error) {
    console.error('Error in library DELETE API:', error)
    return NextResponse.json(
      { error: 'Internal server error' }, 
      { status: 500 }
    )
  }
} 
```

### `app/api/library/upload/route.ts`

```typescript
// Force Node.js runtime for pdf-parse compatibility
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { ingestPaperWithChunks } from '@/lib/db/papers'
import { addPaperToLibrary } from '@/lib/db/library'
import { extractPDFMetadata } from '@/lib/pdf/extract'
import { sanitizeFilename } from '@/lib/utils/text'
import { debug } from '@/lib/utils/logger'
import { PaperDTOSchema } from '@/lib/schemas/paper'

export async function POST(request: NextRequest) {
  try {
    debug.info('PDF Upload API Started')
    
    // Early size validation from content-length header
    const contentLength = request.headers.get('content-length')
    const maxSize = 10 * 1024 * 1024 // 10MB
    
    if (contentLength && parseInt(contentLength) > maxSize) {
      debug.warn('File too large (header check)', { contentLength })
      return Response.json({ 
        error: 'File too large. Maximum size is 10MB',
        received: contentLength 
      }, { status: 413 })
    }
    
    // Check authentication
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    
    if (authError || !user) {
      debug.error('Authentication failed', { error: authError })
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }
    
    debug.info('Authentication successful', { userId: user.id })

    // Parse form data
    const formData = await request.formData()
    const file = formData.get('file') as File
    const fileName = formData.get('fileName') as string

    if (!file) {
      debug.error('No file provided in form data')
      return Response.json({ error: 'No file provided' }, { status: 400 })
    }

    // Sanitize filename for security
    const sanitizedFileName = fileName 
      ? sanitizeFilename(fileName)
      : sanitizeFilename(file.name)

    debug.info('File received', { 
      fileName: sanitizedFileName, 
      size: file.size, 
      type: file.type 
    })

    // Validate file type
    if (!file.type.includes('pdf') && !file.name.toLowerCase().endsWith('.pdf')) {
      debug.error('Invalid file type', { type: file.type })
      return Response.json({ error: 'Only PDF files are allowed' }, { status: 400 })
    }

    // Double-check file size (after form parsing)
    if (file.size > maxSize) {
      debug.error('File too large', { size: file.size })
      return Response.json({ 
        error: 'File too large. Maximum size is 10MB',
        received: file.size,
        limit: maxSize 
      }, { status: 413 })
    }

    debug.info('Processing PDF upload', { fileName: sanitizedFileName, size: file.size })

    // Extract metadata and content from PDF
    debug.info('Starting PDF metadata extraction')
    const extractedData = await extractPDFMetadata(file)
    
    debug.info('Metadata extraction completed', {
      title: extractedData.title,
      authorsCount: extractedData.authors?.length,
      abstract: extractedData.abstract ? 'Found' : 'Not found',
      venue: extractedData.venue ? 'Found' : 'Not found',
      doi: extractedData.doi ? 'Found' : 'Not found',
      year: extractedData.year
    })

    // Create paper object for ingestion with validation
    const paperData = {
      title: extractedData.title || sanitizedFileName.replace('.pdf', ''),
      abstract: extractedData.abstract,
      publication_date: extractedData.year ? `${extractedData.year}-01-01` : undefined,
      venue: extractedData.venue,
      doi: extractedData.doi,
      url: undefined, // No URL for uploaded files
      pdf_url: undefined, // Could store file if implementing file storage
      metadata: {
        source: 'upload',
        original_filename: sanitizedFileName,
        file_size: file.size,
        upload_date: new Date().toISOString(),
        extracted_content: extractedData.fullText // This is now safely truncated
      },
      source: 'upload',
      citation_count: 0,
      impact_score: undefined,
      authors: extractedData.authors || ['Unknown Author']
    }

    // Validate paper data with Zod schema
    const validationResult = PaperDTOSchema.safeParse(paperData)
    if (!validationResult.success) {
      debug.error('Paper data validation failed', { 
        errors: validationResult.error.errors 
      })
      return Response.json({ 
        error: 'Invalid paper data',
        details: validationResult.error.errors 
      }, { status: 400 })
    }

    debug.info('Starting paper ingestion')
    
    // Ingest paper with content chunks for RAG (creates embeddings for both main paper and chunks)
    const paperId = await ingestPaperWithChunks(validationResult.data, extractedData.contentChunks)
    debug.info('Paper ingested successfully', { paperId })

    debug.info('Adding to user library')
    // Add to user's library
    const libraryPaper = await addPaperToLibrary(user.id, paperId, `Uploaded from file: ${sanitizedFileName}`)
    debug.info('Added to library successfully', { libraryPaperId: libraryPaper.id })

    debug.info('Upload completed successfully')

    // Return success response with extracted data
    return Response.json({
      success: true,
      paperId,
      libraryPaperId: libraryPaper.id,
      extractedData: {
        title: extractedData.title,
        authors: extractedData.authors,
        abstract: extractedData.abstract,
        venue: extractedData.venue,
        doi: extractedData.doi,
        year: extractedData.year
      }
    })

  } catch (error) {
    debug.error('PDF upload error', {
      message: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
      error: error
    })
    
    return Response.json({
      error: error instanceof Error ? error.message : 'Failed to process PDF upload',
      details: process.env.NODE_ENV === 'development' ? (error instanceof Error ? error.stack : String(error)) : undefined
    }, { status: 500 })
  }
}

export async function OPTIONS() {
  return new Response(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400'
    }
  })
} 
```

### `app/api/library-search/route.ts`

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { parallelSearch } from '@/lib/services/paper-aggregation'
import { z } from 'zod'

// Lightweight search schema for Library Manager
const LibrarySearchRequestSchema = z.object({
  query: z.string().min(1).max(500).trim(),
  options: z.object({
    maxResults: z.number().int().min(1).max(50).optional().default(20), // Restored full result limit
    sources: z.array(z.enum(['openalex', 'crossref', 'semantic_scholar', 'arxiv', 'core'])).optional().default(['openalex', 'crossref', 'semantic_scholar', 'arxiv', 'core']), // All sources by default
    includePreprints: z.boolean().optional().default(true),
    fromYear: z.number().int().min(1900).max(new Date().getFullYear()).optional(),
    toYear: z.number().int().min(1900).max(new Date().getFullYear()).optional(),
    openAccessOnly: z.boolean().optional().default(false),
    fastMode: z.boolean().optional().default(true) // Enable fast mode by default
  }).optional().default({})
})

interface LibrarySearchResponse {
  success: boolean
  query: string
  papers: Array<{
    canonical_id: string
    title: string
    abstract?: string
    year: number
    venue?: string
    doi?: string
    url?: string
    citationCount: number
    relevanceScore?: number
    source: string
  }>
  count: number
  searchTimeMs?: number
  error?: string
}

export async function POST(request: NextRequest) {
  const startTime = Date.now()
  
  try {
    const body = await request.json()
    const validationResult = LibrarySearchRequestSchema.safeParse(body)
    
    if (!validationResult.success) {
      return NextResponse.json(
        { 
          success: false, 
          error: 'Invalid request parameters',
          query: '',
          papers: [],
          count: 0,
          details: validationResult.error.errors.map(e => ({
            path: e.path.join('.'),
            message: e.message
          }))
        },
        { status: 400 }
      )
    }

    const { query, options } = validationResult.data

    console.log(`📚 Fast Library Search: "${query}" (${options.sources?.join(', ')})`)

    // **PERFORMANCE OPTIMIZATION**: Use fast mode with timeout
    const searchPromise = parallelSearch(query, {
      maxResults: options.maxResults,
      sources: options.sources,
      includePreprints: options.includePreprints,
      fromYear: options.fromYear,
      toYear: options.toYear,
      openAccessOnly: options.openAccessOnly,
      fastMode: options.fastMode // Pass fast mode to aggregation
    })

    // **TIMEOUT CONTROL**: Maximum 10 seconds for library search
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Search timeout after 10 seconds')), 10000)
    })

    const searchResults = await Promise.race([searchPromise, timeoutPromise]) as Awaited<typeof searchPromise>

    const searchTimeMs = Date.now() - startTime

    const response: LibrarySearchResponse = {
      success: true,
      query,
      papers: searchResults.map(paper => ({
        canonical_id: paper.canonical_id,
        title: paper.title,
        abstract: paper.abstract?.substring(0, 250), // Reduced for faster response
        year: paper.year,
        venue: paper.venue,
        doi: paper.doi,
        url: paper.url,
        citationCount: paper.citationCount,
        relevanceScore: paper.relevanceScore,
        source: paper.source
      })),
      count: searchResults.length,
      searchTimeMs
    }

    console.log(`📚 Fast Search Complete: ${response.count} papers in ${searchTimeMs}ms`)

    return NextResponse.json(response)

  } catch (error) {
    const searchTimeMs = Date.now() - startTime
    console.error(`Library search error after ${searchTimeMs}ms:`, error)
    
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Search failed',
        query: '',
        papers: [],
        count: 0,
        searchTimeMs
      },
      { status: 500 }
    )
  }
} 
```

### `app/api/papers/[id]/route.ts`

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getPaper } from '@/lib/db/papers'
import { isInLibrary } from '@/lib/db/library'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createClient()
    
    // Check authentication
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id: paperId } = await params

    if (!paperId) {
      return NextResponse.json({ error: 'Paper ID is required' }, { status: 400 })
    }

    // Get paper details
    const paper = await getPaper(paperId)
    if (!paper) {
      return NextResponse.json({ error: 'Paper not found' }, { status: 404 })
    }

    // Check if paper is in user's library
    const inLibrary = await isInLibrary(user.id, paperId)

    // Get usage statistics (how many times this paper has been cited in generated papers)
    const { data: citationStats, error: statsError } = await supabase
      .from('project_citations')
      .select('id')
      .eq('paper_id', paperId)

    const citationCount = statsError ? 0 : (citationStats?.length || 0)

    return NextResponse.json({
      ...paper,
      inLibrary,
      usageStats: {
        citedInProjects: citationCount
      }
    })

  } catch (error) {
    console.error('Error in papers/[id] GET API:', error)
    return NextResponse.json(
      { error: 'Internal server error' }, 
      { status: 500 }
    )
  }
} 
```

### `app/api/papers/download-pdf/route.ts`

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { downloadAndStorePDF, updatePaperWithPDF, batchDownloadPDFs } from '@/lib/services/pdf-downloader'

// Download PDF for a single paper
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    
    // Check authentication
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { paperId, doi, batch } = body

    // Handle batch download
    if (batch && Array.isArray(batch)) {
      console.log(`🔄 Starting batch PDF download for ${batch.length} papers`)
      
      const results = await batchDownloadPDFs(batch, 3) // Process 3 at a time
      
      const successful = results.filter(r => r.result.success).length
      
      return NextResponse.json({
        success: true,
        message: `Downloaded ${successful}/${results.length} PDFs`,
        results
      })
    }

    // Handle single paper download
    if (!paperId || !doi) {
      return NextResponse.json({ 
        error: 'Paper ID and DOI are required' 
      }, { status: 400 })
    }

    console.log(`📄 Downloading PDF for paper: ${paperId}`)

    const result = await downloadAndStorePDF(doi, paperId)

    if (result.success && result.pdf_url) {
      // Update the paper record with the PDF URL
      await updatePaperWithPDF(paperId, result.pdf_url, result.file_size)
      
      return NextResponse.json({
        success: true,
        pdf_url: result.pdf_url,
        file_size: result.file_size,
        message: 'PDF downloaded and stored successfully'
      })
    } else {
      return NextResponse.json({
        success: false,
        error: result.error || 'Failed to download PDF'
      }, { status: 400 })
    }

  } catch (error) {
    console.error('PDF download API error:', error)
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Internal server error'
    }, { status: 500 })
  }
}

// Get PDF download status for papers
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    
    // Check authentication
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const paperIds = searchParams.get('paperIds')?.split(',') || []

    if (paperIds.length === 0) {
      return NextResponse.json({ 
        error: 'Paper IDs are required' 
      }, { status: 400 })
    }

    // Get PDF status for papers
    const { data: papers, error } = await supabase
      .from('papers')
      .select('id, pdf_url, doi, metadata')
      .in('id', paperIds)

    if (error) {
      console.error('Database error:', error)
      return NextResponse.json({ 
        error: 'Failed to fetch paper data' 
      }, { status: 500 })
    }

    const pdfStatus = papers.map(paper => ({
      paperId: paper.id,
      hasPdf: !!paper.pdf_url,
      pdfUrl: paper.pdf_url,
      doi: paper.doi,
      canDownload: !!paper.doi,
      downloadedAt: paper.metadata?.pdf_downloaded_at,
      fileSize: paper.metadata?.pdf_file_size
    }))

    return NextResponse.json({
      success: true,
      pdfStatus
    })

  } catch (error) {
    console.error('PDF status API error:', error)
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Internal server error'
    }, { status: 500 })
  }
} 
```

### `app/api/papers/ingest-lightweight/route.ts`

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { ingestPaperLightweight } from '@/lib/db/papers'
import { createClient } from '@/lib/supabase/server'
import { PaperDTO } from '@/lib/schemas/paper'

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    
    // Check authentication
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { paper } = body

    if (!paper || !paper.title) {
      return NextResponse.json({ error: 'Paper data is required' }, { status: 400 })
    }

    // Convert to PaperDTO format
    const paperDTO: PaperDTO = {
      title: paper.title,
      abstract: paper.abstract || undefined,
      publication_date: paper.publication_date || undefined,
      venue: paper.venue || undefined,
      doi: paper.doi || undefined,
      url: paper.url || undefined,
      pdf_url: paper.pdf_url || undefined,
      metadata: {
        ...paper.metadata,
        ingested_via: 'library_manager',
        ingested_at: new Date().toISOString()
      },
      source: paper.source || 'library_search',
      citation_count: paper.citation_count || 0,
      impact_score: paper.impact_score || 0,
      authors: paper.authors || []
    }

    // Ingest paper without chunks for fast library addition
    const paperId = await ingestPaperLightweight(paperDTO)

    return NextResponse.json({ 
      success: true, 
      paperId,
      message: 'Paper ingested without chunks for library'
    })

  } catch (error) {
    console.error('Lightweight ingestion error:', error)
    return NextResponse.json(
      { error: 'Failed to ingest paper' }, 
      { status: 500 }
    )
  }
} 
```

### `app/api/papers/semantic-search/route.ts`

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { semanticSearchPapers, hybridSearchPapers } from '@/lib/db/papers'

// POST - Semantic search for papers
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    
    // Check authentication
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { 
      query, 
      searchType = 'semantic',
      limit = 8,
      minYear = 2018,
      sources,
      semanticWeight = 0.7
    } = await request.json()

    if (!query?.trim()) {
      return NextResponse.json({ error: 'Query is required' }, { status: 400 })
    }

    let papers
    if (searchType === 'hybrid') {
      papers = await hybridSearchPapers(query, {
        limit,
        minYear,
        sources,
        semanticWeight
      })
    } else {
      papers = await semanticSearchPapers(query, {
        limit,
        minYear,
        sources
      })
    }

    return NextResponse.json({
      papers,
      query,
      searchType,
      total: papers.length
    })

  } catch (error) {
    console.error('Error in semantic search API:', error)
    return NextResponse.json(
      { error: 'Internal server error' }, 
      { status: 500 }
    )
  }
} 
```

### `app/api/papers/similar/[id]/route.ts`

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { findSimilarPapers } from '@/lib/db/papers'

// GET - Find papers similar to a given paper
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createClient()
    
    // Check authentication
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const resolvedParams = await params
    const paperId = resolvedParams.id
    const url = new URL(request.url)
    const limit = parseInt(url.searchParams.get('limit') || '5')

    if (!paperId) {
      return NextResponse.json({ error: 'Paper ID is required' }, { status: 400 })
    }

    const similarPapers = await findSimilarPapers(paperId, limit)

    return NextResponse.json({
      papers: similarPapers,
      total: similarPapers.length,
      sourcePaperId: paperId
    })

  } catch (error) {
    console.error('Error in similar papers API:', error)
    return NextResponse.json(
      { error: 'Internal server error' }, 
      { status: 500 }
    )
  }
} 
```

### `app/api/papers/update-citation/route.ts`

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { updatePaperCitationFields } from '@/lib/db/papers'

export async function POST(request: NextRequest) {
  try {
    const { paperId, citationData } = await request.json()

    if (!paperId) {
      return NextResponse.json(
        { error: 'Paper ID is required' },
        { status: 400 }
      )
    }

    if (!citationData || typeof citationData !== 'object') {
      return NextResponse.json(
        { error: 'Citation data is required' },
        { status: 400 }
      )
    }

    // Update citation fields in database
    await updatePaperCitationFields(paperId, citationData)

    return NextResponse.json({ 
      success: true,
      message: 'Citation fields updated successfully' 
    })

  } catch (error) {
    console.error('Error updating citation fields:', error)
    return NextResponse.json(
      { error: 'Failed to update citation fields' },
      { status: 500 }
    )
  }
} 
```

### `app/api/pdf-queue/route.ts`

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { pdfQueue } from '@/lib/services/pdf-queue'

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { paperId, pdfUrl, title, priority = 'normal' } = body

    if (!paperId || !pdfUrl || !title) {
      return NextResponse.json({ 
        error: 'Missing required fields: paperId, pdfUrl, title' 
      }, { status: 400 })
    }

    console.log(`📄 Queueing PDF processing for: ${title}`)
    
    const jobId = await pdfQueue.addJob(
      paperId, 
      pdfUrl, 
      title, 
      user.id,
      priority
    )
    
    console.log(`✅ PDF processing queued: ${jobId}`)

    return NextResponse.json({
      success: true,
      jobId,
      message: 'PDF processing queued successfully'
    })

  } catch (error) {
    console.error('PDF queue API error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to queue PDF processing' },
      { status: 500 }
    )
  }
} 
```

### `app/api/projects/[id]/route.ts`

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { 
  getResearchProject, 
  getLatestProjectVersion, 
  getProjectVersions,
  getProjectPapersWithCSL
} from '@/lib/db/research'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createClient()
    
    // Check authentication
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id: projectId } = await params

    if (!projectId) {
      return NextResponse.json({ error: 'Project ID is required' }, { status: 400 })
    }

    const url = new URL(request.url)
    const includeVersions = url.searchParams.get('includeVersions') === 'true'
    const includeCitations = url.searchParams.get('includeCitations') === 'true'
    const includePapers = url.searchParams.get('includePapers') === 'true'
    const versionLimit = url.searchParams.get('versionLimit')

    // Get project details
    const project = await getResearchProject(projectId, user.id)
    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 })
    }

    // Get latest version
    const latestVersion = await getLatestProjectVersion(projectId)

    let versions = undefined
    let citations = undefined
    let papers = undefined

    // Get versions if requested
    if (includeVersions) {
      const limit = versionLimit ? parseInt(versionLimit) : 10
      versions = await getProjectVersions(projectId, limit)
    }

    // Get citations if requested
    if (includeCitations) {
      const { data: addCitationData, error: addCitationError } = await supabase
        .from('citations')
        .select('id, key, csl_json')
        .eq('project_id', projectId)
        .order('created_at', { ascending: true })

      if (addCitationError) {
        console.error('Error loading citations:', addCitationError)
      }

      const map: Record<string, unknown> = {}
      ;(addCitationData || []).forEach(rec => {
        map[rec.key] = rec.csl_json
      })
      citations = map
    }

    // Get papers with CSL data if requested
    if (includePapers) {
      papers = await getProjectPapersWithCSL(projectId, latestVersion?.version)
    }

    return NextResponse.json({
      ...project,
      latest_version: latestVersion,
      versions,
      citations,
      papers
    })

  } catch (error) {
    console.error('Error in projects/[id] GET API:', error)
    return NextResponse.json(
      { error: 'Internal server error' }, 
      { status: 500 }
    )
  }
} 
```

### `app/api/projects/[id]/versions/route.ts`

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createClient()
    
    // Check authentication
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const resolvedParams = await params
    const projectId = resolvedParams.id

    // Get project versions
    const { data: versions, error } = await supabase
      .from('research_project_versions')
      .select('*')
      .eq('project_id', projectId)
      .order('version', { ascending: false })

    if (error) {
      console.error('Error fetching project versions:', error)
      return NextResponse.json({ error: 'Failed to fetch versions' }, { status: 500 })
    }

    return NextResponse.json({
      versions,
      count: versions.length
    })

  } catch (error) {
    console.error('Error in versions endpoint:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
} 
```

### `app/api/projects/route.ts`

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getUserResearchProjects, deleteResearchProject } from '@/lib/db/research'

// GET - Retrieve user's research projects
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    
    // Check authentication
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const url = new URL(request.url)
    const limitParam = url.searchParams.get('limit')
    const offsetParam = url.searchParams.get('offset')

    const limit = limitParam ? parseInt(limitParam) : 20
    const offset = offsetParam ? parseInt(offsetParam) : 0

    const projects = await getUserResearchProjects(user.id, limit, offset)

    return NextResponse.json({
      projects,
      total: projects.length,
      limit,
      offset
    })

  } catch (error) {
    console.error('Error in projects GET API:', error)
    return NextResponse.json(
      { error: 'Internal server error' }, 
      { status: 500 }
    )
  }
}

// DELETE - Delete a research project
export async function DELETE(request: NextRequest) {
  try {
    const supabase = await createClient()
    
    // Check authentication
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const url = new URL(request.url)
    const projectId = url.searchParams.get('projectId')
    
    if (!projectId) {
      return NextResponse.json({ error: 'Project ID is required' }, { status: 400 })
    }

    // Verify ownership
    const { data: project, error } = await supabase
      .from('research_projects')
      .select('id')
      .eq('id', projectId)
      .eq('user_id', user.id)
      .single()

    if (error || !project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 })
    }

    await deleteResearchProject(projectId)

    return NextResponse.json({ success: true })

  } catch (error) {
    console.error('Error in projects DELETE API:', error)
    return NextResponse.json(
      { error: 'Internal server error' }, 
      { status: 500 }
    )
  }
} 
```

### `app/api/search-papers/route.ts`

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { unifiedSearch } from '@/lib/services/search-orchestrator'
import type { SearchPapersRequest, SearchPapersResponse, PaperSources } from '@/types/simplified'

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    
    // Check authentication
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const url = new URL(request.url)
    const query = url.searchParams.get('q')
    const limitParam = url.searchParams.get('limit')
    const sourcesParam = url.searchParams.get('sources')
    const useSemanticParam = url.searchParams.get('semantic')

    if (!query?.trim()) {
      return NextResponse.json({ error: 'Query parameter is required' }, { status: 400 })
    }

    const limit = limitParam ? parseInt(limitParam) : 20
    const sources = sourcesParam ? sourcesParam.split(',') as PaperSources : undefined
    const useSemanticSearch = useSemanticParam !== 'false' // Default to true

    // Use unified search for consistency and simplicity
    const searchResult = await unifiedSearch(query.trim(), {
      maxResults: limit,
      minResults: Math.min(5, limit),
      useHybridSearch: useSemanticSearch,
      useKeywordSearch: true,
      useAcademicAPIs: true,
      combineResults: true,
      sources: sources,
      fastMode: true // Enable fast mode for manual search
    })

    const response: SearchPapersResponse = {
      papers: searchResult.papers,
      total: searchResult.papers.length,
      query: query.trim()
    }

    return NextResponse.json(response)

  } catch (error) {
    console.error('Error in search-papers API:', error)
    return NextResponse.json(
      { error: 'Internal server error' }, 
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    
    // Check authentication
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body: SearchPapersRequest = await request.json()
    const { query, limit, sources, useSemanticSearch } = body

    if (!query?.trim()) {
      return NextResponse.json({ error: 'Query is required' }, { status: 400 })
    }

    // Use unified search for consistency and simplicity
    const searchResult = await unifiedSearch(query.trim(), {
      maxResults: limit || 20,
      minResults: Math.min(5, limit || 20),
      useHybridSearch: useSemanticSearch !== false, // Default to true
      useKeywordSearch: true,
      useAcademicAPIs: true,
      combineResults: true,
      sources: sources,
      fastMode: true // Enable fast mode for manual search
    })

    const response: SearchPapersResponse = {
      papers: searchResult.papers,
      total: searchResult.papers.length,
      query: query.trim()
    }

    return NextResponse.json(response)

  } catch (error) {
    console.error('Error in search-papers POST API:', error)
    return NextResponse.json(
      { error: 'Internal server error' }, 
      { status: 500 }
    )
  }
} 
```

### `app/api/test-rag/route.ts`

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { hybridSearchPapers } from '@/lib/db/papers'

// GET - Test RAG components
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    
    // Check authentication
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const url = new URL(request.url)
    const topic = url.searchParams.get('topic') || 'machine learning'

    // Test semantic search
    console.log('Testing semantic search for topic:', topic)
    
    let searchResults: unknown[] = []
    let error_message = null
    
    try {
      searchResults = await hybridSearchPapers(topic, {
        limit: 5,
        minYear: 2018,
        semanticWeight: 0.7
      })
    } catch (error) {
      error_message = error instanceof Error ? error.message : 'Unknown error'
      console.log('Semantic search failed:', error_message)
    }

    return NextResponse.json({
      message: 'RAG system test',
      topic,
      semantic_search_results: searchResults.length,
      papers: searchResults.slice(0, 3), // Show first 3 for demo
      error: error_message,
      status: searchResults.length > 0 ? 'working' : 'no_papers_in_db'
    })

  } catch (error) {
    console.error('Error in RAG test:', error)
    return NextResponse.json(
      { error: 'Internal server error', details: error instanceof Error ? error.message : 'Unknown' }, 
      { status: 500 }
    )
  }
} 
```

### `app/api/test-task-5/route.ts`

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    
    // Check authentication
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const url = new URL(request.url)
    const testType = url.searchParams.get('test') || 'stream'

    if (testType === 'stream') {
      // Test EventSource URL building
      const testRequest = {
        topic: 'test topic',
        libraryPaperIds: ['paper1', 'paper2'],
        useLibraryOnly: true,
        config: {
          length: 'medium' as const,
          style: 'academic' as const,
          includeMethodology: true
        }
      }

      const params = new URLSearchParams()
      params.set('topic', testRequest.topic)
      if (testRequest.libraryPaperIds && testRequest.libraryPaperIds.length > 0) {
        params.set('libraryPaperIds', testRequest.libraryPaperIds.join(','))
      }
      if (testRequest.useLibraryOnly) {
        params.set('useLibraryOnly', 'true')
      }
      if (testRequest.config) {
        if (testRequest.config.length) params.set('length', testRequest.config.length)
        if (testRequest.config.style) params.set('style', testRequest.config.style)

        if (testRequest.config.includeMethodology !== undefined) {
          params.set('includeMethodology', testRequest.config.includeMethodology.toString())
        }
      }
      
      const streamUrl = `/api/generate/stream?${params.toString()}`

      return NextResponse.json({
        message: 'Task 5 EventSource URL building test',
        testRequest,
        generatedStreamUrl: streamUrl,
        urlParams: Object.fromEntries(params.entries()),
        status: 'success'
      })
    }

    if (testType === 'swr') {
      // Test SWR mutate keys
      const projectId = 'test-project-123'
      const mutateKeys = [
        `/api/projects/${projectId}/versions`,
        `/api/projects/${projectId}`
      ]

      return NextResponse.json({
        message: 'Task 5 SWR mutate keys test',
        projectId,
        mutateKeys,
        description: 'These are the keys that will be revalidated on checkpoints and completion',
        status: 'success'
      })
    }

    return NextResponse.json({
      message: 'Task 5 implementation test',
      availableTests: ['stream', 'swr'],
      usage: 'Add ?test=stream or ?test=swr to test specific functionality',
      task5Features: [
        '✅ SWR integration with useSWR hook',
        '✅ EventSource fetcher for SSE connections', 
        '✅ Automatic revalidation with mutate() on checkpoints',
        '✅ Query parameter URL building for EventSource',
        '✅ GET endpoint for EventSource connections',
        '✅ Proper cleanup and error handling'
      ]
    })

  } catch (error) {
    console.error('Error in Task 5 test:', error)
    return NextResponse.json(
      { error: 'Internal server error', details: error instanceof Error ? error.message : 'Unknown' }, 
      { status: 500 }
    )
  }
} 
```

### `app/auth/callback/route.ts`

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const code = searchParams.get('code')
  const next = searchParams.get('next') ?? '/generate'

  if (code) {
    const supabase = await createClient()
    
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    
    if (!error) {
      // Email verification successful, redirect to generate page
      return NextResponse.redirect(new URL(next, request.url))
    } else {
      // Email verification failed, redirect to login with error
      return NextResponse.redirect(
        new URL(`/login?error=${encodeURIComponent('Email verification failed. Please try again.')}`, request.url)
      )
    }
  }

  // No code provided, redirect to login
  return NextResponse.redirect(new URL('/login', request.url))
} 
```

### `app/components/AuthButton.tsx`

```tsx
'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase/client'
import type { User } from '@supabase/supabase-js'
import { LoadingSpinner } from '@/components/ui/loading-spinner'

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
    return <LoadingSpinner />
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
```

### `app/demo/block-editor/page.tsx`

```tsx
import { Metadata } from 'next'
import BlockEditor from '@/components/BlockEditor'

export const metadata: Metadata = {
  title: 'Block Editor Demo | Genpaper',
  description: 'Experience the hybrid approach: Quick generation + structured editing',
}

export default function BlockEditorDemo() {
  return (
    <div className="min-h-screen bg-background">
      <BlockEditor />
    </div>
  )
} 
```

### `app/globals.css`

```css
@import "tailwindcss";
@import "katex/dist/katex.min.css";

@custom-variant dark (&:is(.dark *));

@theme {
  /* Color palette from your original config */
  --color-background: oklch(100% 0 0);
  --color-foreground: oklch(9% 0 0);

  --color-card: oklch(100% 0 0);
  --color-card-foreground: oklch(9% 0 0);

  --color-popover: oklch(100% 0 0);
  --color-popover-foreground: oklch(9% 0 0);

  --color-primary: oklch(9% 0 0);
  --color-primary-foreground: oklch(98% 0 0);

  --color-secondary: oklch(96% 0 0);
  --color-secondary-foreground: oklch(9% 0 0);

  --color-muted: oklch(96% 0 0);
  --color-muted-foreground: oklch(45% 0 0);

  --color-accent: oklch(96% 0 0);
  --color-accent-foreground: oklch(9% 0 0);

  --color-destructive: oklch(63% 0.2 25);
  --color-destructive-foreground: oklch(98% 0 0);

  --color-border: oklch(90% 0 0);
  --color-input: oklch(90% 0 0);
  --color-ring: oklch(9% 0 0);

  --color-chart-1: oklch(70% 0.14 12);
  --color-chart-2: oklch(61% 0.14 103);
  --color-chart-3: oklch(49% 0.14 196);
  --color-chart-4: oklch(66% 0.14 251);
  --color-chart-5: oklch(64% 0.14 318);

  /* Sidebar colors */
  --color-sidebar: oklch(100% 0 0);
  --color-sidebar-foreground: oklch(9% 0 0);
  --color-sidebar-primary: oklch(9% 0 0);
  --color-sidebar-primary-foreground: oklch(98% 0 0);
  --color-sidebar-accent: oklch(96% 0 0);
  --color-sidebar-accent-foreground: oklch(9% 0 0);
  --color-sidebar-border: oklch(90% 0 0);
  --color-sidebar-ring: oklch(9% 0 0);

  /* Custom colors from your config */
  --color-dodger-blue: oklch(67% 0.18 240);
  --color-medium-purple: oklch(60% 0.25 270);
  --color-alabaster: oklch(98% 0.01 240);
  --color-azure-radiance: oklch(63% 0.17 240);
  --color-cod-gray: oklch(11% 0.02 240);
  --color-prelude: oklch(75% 0.08 270);
  --color-azure-radiance-darker: oklch(57% 0.17 240);

  /* Border radius */
  --radius: 0.5rem;

  /* Keyframes for animations */
  --animate-accordion-down: accordion-down 0.2s ease-out;
  --animate-accordion-up: accordion-up 0.2s ease-out;
}

@keyframes accordion-down {
  from {
    height: 0;
  }
  to {
    height: var(--radix-accordion-content-height);
  }
}

@keyframes accordion-up {
  from {
    height: var(--radix-accordion-content-height);
  }
  to {
    height: 0;
  }
}

/* Dark mode theme */
@media (prefers-color-scheme: dark) {
  @theme {
    --color-background: oklch(9% 0 0);
    --color-foreground: oklch(98% 0 0);

    --color-card: oklch(9% 0 0);
    --color-card-foreground: oklch(98% 0 0);

    --color-popover: oklch(9% 0 0);
    --color-popover-foreground: oklch(98% 0 0);

    --color-primary: oklch(98% 0 0);
    --color-primary-foreground: oklch(9% 0 0);

    --color-secondary: oklch(15% 0 0);
    --color-secondary-foreground: oklch(98% 0 0);

    --color-muted: oklch(15% 0 0);
    --color-muted-foreground: oklch(64% 0 0);

    --color-accent: oklch(15% 0 0);
    --color-accent-foreground: oklch(98% 0 0);

    --color-destructive: oklch(63% 0.2 25);
    --color-destructive-foreground: oklch(98% 0 0);

    --color-border: oklch(15% 0 0);
    --color-input: oklch(15% 0 0);
    --color-ring: oklch(20% 0 0);

    --color-sidebar: oklch(9% 0 0);
    --color-sidebar-foreground: oklch(98% 0 0);
    --color-sidebar-primary: oklch(98% 0 0);
    --color-sidebar-primary-foreground: oklch(9% 0 0);
    --color-sidebar-accent: oklch(15% 0 0);
    --color-sidebar-accent-foreground: oklch(98% 0 0);
    --color-sidebar-border: oklch(15% 0 0);
    --color-sidebar-ring: oklch(20% 0 0);
  }
}

body {
  font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  background: oklch(var(--color-background));
  color: oklch(var(--color-foreground));
}

@theme inline {
  --radius-sm: calc(var(--radius) - 4px);
  --radius-md: calc(var(--radius) - 2px);
  --radius-lg: var(--radius);
  --radius-xl: calc(var(--radius) + 4px);
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-card: var(--card);
  --color-card-foreground: var(--card-foreground);
  --color-popover: var(--popover);
  --color-popover-foreground: var(--popover-foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-secondary: var(--secondary);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-accent: var(--accent);
  --color-accent-foreground: var(--accent-foreground);
  --color-destructive: var(--destructive);
  --color-border: var(--border);
  --color-input: var(--input);
  --color-ring: var(--ring);
  --color-chart-1: var(--chart-1);
  --color-chart-2: var(--chart-2);
  --color-chart-3: var(--chart-3);
  --color-chart-4: var(--chart-4);
  --color-chart-5: var(--chart-5);
  --color-sidebar: var(--sidebar);
  --color-sidebar-foreground: var(--sidebar-foreground);
  --color-sidebar-primary: var(--sidebar-primary);
  --color-sidebar-primary-foreground: var(--sidebar-primary-foreground);
  --color-sidebar-accent: var(--sidebar-accent);
  --color-sidebar-accent-foreground: var(--sidebar-accent-foreground);
  --color-sidebar-border: var(--sidebar-border);
  --color-sidebar-ring: var(--sidebar-ring);
}

:root {
  --radius: 0.625rem;
  --background: oklch(1 0 0);
  --foreground: oklch(0.129 0.042 264.695);
  --card: oklch(1 0 0);
  --card-foreground: oklch(0.129 0.042 264.695);
  --popover: oklch(1 0 0);
  --popover-foreground: oklch(0.129 0.042 264.695);
  --primary: oklch(0.208 0.042 265.755);
  --primary-foreground: oklch(0.984 0.003 247.858);
  --secondary: oklch(0.968 0.007 247.896);
  --secondary-foreground: oklch(0.208 0.042 265.755);
  --muted: oklch(0.968 0.007 247.896);
  --muted-foreground: oklch(0.554 0.046 257.417);
  --accent: oklch(0.968 0.007 247.896);
  --accent-foreground: oklch(0.208 0.042 265.755);
  --destructive: oklch(0.577 0.245 27.325);
  --border: oklch(0.929 0.013 255.508);
  --input: oklch(0.929 0.013 255.508);
  --ring: oklch(0.704 0.04 256.788);
  --chart-1: oklch(0.646 0.222 41.116);
  --chart-2: oklch(0.6 0.118 184.704);
  --chart-3: oklch(0.398 0.07 227.392);
  --chart-4: oklch(0.828 0.189 84.429);
  --chart-5: oklch(0.769 0.188 70.08);
  --sidebar: oklch(0.984 0.003 247.858);
  --sidebar-foreground: oklch(0.129 0.042 264.695);
  --sidebar-primary: oklch(0.208 0.042 265.755);
  --sidebar-primary-foreground: oklch(0.984 0.003 247.858);
  --sidebar-accent: oklch(0.968 0.007 247.896);
  --sidebar-accent-foreground: oklch(0.208 0.042 265.755);
  --sidebar-border: oklch(0.929 0.013 255.508);
  --sidebar-ring: oklch(0.704 0.04 256.788);
}

.dark {
  --background: oklch(0.129 0.042 264.695);
  --foreground: oklch(0.984 0.003 247.858);
  --card: oklch(0.208 0.042 265.755);
  --card-foreground: oklch(0.984 0.003 247.858);
  --popover: oklch(0.208 0.042 265.755);
  --popover-foreground: oklch(0.984 0.003 247.858);
  --primary: oklch(0.929 0.013 255.508);
  --primary-foreground: oklch(0.208 0.042 265.755);
  --secondary: oklch(0.279 0.041 260.031);
  --secondary-foreground: oklch(0.984 0.003 247.858);
  --muted: oklch(0.279 0.041 260.031);
  --muted-foreground: oklch(0.704 0.04 256.788);
  --accent: oklch(0.279 0.041 260.031);
  --accent-foreground: oklch(0.984 0.003 247.858);
  --destructive: oklch(0.704 0.191 22.216);
  --border: oklch(1 0 0 / 10%);
  --input: oklch(1 0 0 / 15%);
  --ring: oklch(0.551 0.027 264.364);
  --chart-1: oklch(0.488 0.243 264.376);
  --chart-2: oklch(0.696 0.17 162.48);
  --chart-3: oklch(0.769 0.188 70.08);
  --chart-4: oklch(0.627 0.265 303.9);
  --chart-5: oklch(0.645 0.246 16.439);
  --sidebar: oklch(0.208 0.042 265.755);
  --sidebar-foreground: oklch(0.984 0.003 247.858);
  --sidebar-primary: oklch(0.488 0.243 264.376);
  --sidebar-primary-foreground: oklch(0.984 0.003 247.858);
  --sidebar-accent: oklch(0.279 0.041 260.031);
  --sidebar-accent-foreground: oklch(0.984 0.003 247.858);
  --sidebar-border: oklch(1 0 0 / 10%);
  --sidebar-ring: oklch(0.551 0.027 264.364);
}

@layer base {
  * {
    @apply border-border outline-ring/50;
  }
  body {
    @apply bg-background text-foreground;
  }
}

/* Markdown Editor Specific Styles */
.markdown-editor {
  height: 100%;
}

.markdown-editor textarea {
  font-family: "JetBrains Mono", "Fira Code", "Monaco", "Consolas", monospace;
  line-height: 1.6;
  tab-size: 2;
}

.markdown-editor textarea:focus {
  outline: none;
  box-shadow: none;
}

/* Simple syntax highlighting without external dependencies */
.language-javascript,
.language-typescript,
.language-python,
.language-java,
.language-cpp,
.language-c,
.language-html,
.language-css,
.language-json,
.language-markdown,
.language-bash,
.language-shell,
.language-sql,
.language-text {
  display: block;
  background: transparent;
  color: inherit;
  font-family: "JetBrains Mono", "Fira Code", "Monaco", "Consolas", monospace;
  font-size: 0.875em;
  line-height: 1.5;
  white-space: pre;
  word-wrap: normal;
  overflow-x: auto;
}

/* Syntax highlighting for code blocks */
pre {
  background-color: #f8f9fa;
  color: #24292e;
  border-radius: 6px;
  padding: 1rem;
  overflow-x: auto;
}

pre code {
  padding: 0;
  background-color: transparent;
}

pre code .hljs-comment,
pre code .hljs-quote {
  color: #6e7781;
  font-style: italic;
}

pre code .hljs-doctag,
pre code .hljs-keyword,
pre code .hljs-formula {
  color: #d73a49;
}

pre code .hljs-section,
pre code .hljs-name,
pre code .hljs-selector-tag,
pre code .hljs-deletion,
pre code .hljs-subst {
  color: #24292e;
}

pre code .hljs-literal {
  color: #005cc5;
}

pre code .hljs-string,
pre code .hljs-regexp,
pre code .hljs-addition,
pre code .hljs-attribute,
pre code .hljs-meta-string {
  color: #22863a;
}

pre code .hljs-built_in,
pre code .hljs-class .hljs-title {
  color: #6f42c1;
}

pre code .hljs-title.class_,
pre code .hljs-type {
  color: #24292e;
}

pre code .hljs-strong {
  font-weight: bold;
}

pre code .hljs-emphasis {
  font-style: italic;
}

/* Math rendering */
.katex {
  font-size: 1em;
}

/* Prose styling for markdown preview */
.prose {
  max-width: none;
}

.prose h1 {
  border-bottom: 1px solid #e5e7eb;
  padding-bottom: 0.5rem;
}

.prose h2 {
  border-bottom: 1px solid #f3f4f6;
  padding-bottom: 0.25rem;
}

.prose blockquote {
  border-left: 4px solid #3b82f6;
  background-color: #eff6ff;
  margin: 1rem 0;
  padding: 1rem;
  border-radius: 0 0.375rem 0.375rem 0;
}

.prose table {
  border-collapse: collapse;
  margin: 1rem 0;
}

.prose th,
.prose td {
  border: 1px solid #d1d5db;
  padding: 0.5rem 1rem;
  text-align: left;
}

.prose th {
  background-color: #f9fafb;
  font-weight: 600;
}

.prose code {
  background-color: #f3f4f6;
  padding: 0.125rem 0.25rem;
  border-radius: 0.25rem;
  font-size: 0.875em;
  border: 1px solid #e5e7eb;
}

.prose pre {
  background-color: #1f2937;
  color: #f9fafb;
  padding: 1rem;
  border-radius: 0.5rem;
  overflow-x: auto;
  margin: 1rem 0;
  border: 1px solid #374151;
}

.prose pre code {
  background-color: transparent;
  padding: 0;
  color: inherit;
  border: none;
}

.prose ul {
  list-style-type: disc;
  padding-left: 1.5rem;
}

.prose ol {
  list-style-type: decimal;
  padding-left: 1.5rem;
}

.prose li {
  margin: 0.25rem 0;
}

.prose a {
  color: #2563eb;
  text-decoration: underline;
}

.prose a:hover {
  color: #1d4ed8;
}

.prose img {
  max-width: 100%;
  height: auto;
  border-radius: 0.5rem;
  box-shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.1);
  margin: 1rem 0;
}

.prose hr {
  border: none;
  border-top: 1px solid #d1d5db;
  margin: 1.5rem 0;
}

.prose strong {
  font-weight: 600;
  color: #111827;
}

.prose em {
  font-style: italic;
  color: #374151;
}

/* Responsive adjustments */
@media (max-width: 768px) {
  .markdown-editor .split-view {
    flex-direction: column;
  }

  .markdown-editor .split-view > div {
    width: 100% !important;
    border-right: none !important;
    border-bottom: 1px solid #e5e7eb;
  }
}

/* Focus states and accessibility */
.markdown-editor textarea:focus-visible {
  outline: 2px solid #3b82f6;
  outline-offset: 2px;
}

/* Scrollbar styling for webkit browsers */
.prose::-webkit-scrollbar {
  width: 8px;
}

.prose::-webkit-scrollbar-track {
  background: #f1f5f9;
}

.prose::-webkit-scrollbar-thumb {
  background: #cbd5e1;
  border-radius: 4px;
}

.prose::-webkit-scrollbar-thumb:hover {
  background: #94a3b8;
}

```

### `app/layout.tsx`

```tsx
import type React from "react"
import type { Metadata } from "next"
import { Geist, Geist_Mono } from "next/font/google"
import "./globals.css"

// import AuthButton from "./components/AuthButton"
// import { QueryProvider } from '@/lib/tanstack-query/provider'
// import { ErrorBoundary } from "@/components/ErrorBoundary"

// Initialize global error handler
import "@/lib/error-handling/global-error-handler"

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
})

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
})

export const metadata: Metadata = {
  title: "GenPaper - AI Research Assistant",
  description: "Generate research papers with AI assistance",
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`} suppressHydrationWarning={true}>
        {/* <ErrorBoundary> */}
        {/* <QueryProvider> */}
        <main>{children}</main>
        {/* </QueryProvider> */}
        {/* </ErrorBoundary> */}
      </body>
    </html>
  )
}

```

### `app/page.tsx`

```tsx
'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { 
  Sparkles, 
  BookOpen, 
  Zap, 
  Users, 
  CheckCircle, 
  ArrowRight,
  FileText,
  Search,
  Quote,
  Brain,
  Clock,
  Shield
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import type { User } from '@supabase/supabase-js'
import { LoadingSpinner } from '@/components/ui/loading-spinner'

export default function LandingPage() {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const supabase = createClient()

  useEffect(() => {
    const getUser = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      setUser(user)
      setLoading(false)
    }
    getUser()
  }, [supabase.auth])

  if (loading) {
    return <LoadingSpinner fullScreen />
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Navigation */}
      <nav className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            <div className="flex items-center space-x-2">
              <Sparkles className="h-8 w-8 text-primary" />
              <span className="text-xl font-bold">GenPaper</span>
              <Badge variant="secondary" className="ml-2">AI-Powered</Badge>
            </div>
            
            <div className="flex items-center space-x-4">
              {user ? (
                <>
                  <span className="text-sm text-muted-foreground">Welcome back, {user.email}</span>
                  <Button asChild>
                    <Link href="/generate">Continue Writing</Link>
                  </Button>
                </>
              ) : (
                <>
                  <Button variant="ghost" asChild>
                    <Link href="/login">Sign In</Link>
                  </Button>
                  <Button asChild>
                    <Link href="/signup">Start Free Trial</Link>
                  </Button>
                </>
              )}
            </div>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="relative">
        <div className="bg-gradient-to-br from-gray-50 via-gray-100 to-gray-200 relative overflow-hidden">
          <div className="absolute inset-0 bg-white/40"></div>
          
          {/* Abstract AI Graphic */}
          <div className="absolute inset-0 flex items-center justify-center opacity-10">
            <div className="relative">
              <div className="grid grid-cols-6 gap-8">
                {Array.from({ length: 24 }).map((_, i) => (
                  <div
                    key={i}
                    className="w-2 h-2 bg-gray-600 rounded-full animate-pulse"
                    style={{ animationDelay: `${i * 0.1}s` }}
                  ></div>
                ))}
              </div>
              <svg className="absolute inset-0 w-full h-full" viewBox="0 0 300 200">
                <path
                  d="M20,20 L280,60 M60,40 L240,120 M40,80 L260,40 M80,160 L220,80 M120,30 L180,150"
                  stroke="rgb(75 85 99)"
                  strokeWidth="1"
                  fill="none"
                  opacity="0.3"
                />
              </svg>
            </div>
          </div>

          <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-24">
            <div className="text-center">
              <h1 className="text-4xl sm:text-6xl font-bold text-gray-900 mb-6 leading-tight">
                From topic to
                <span className="text-transparent bg-clip-text bg-gradient-to-r from-gray-700 to-gray-900"> finished paper</span>
                — effortlessly
              </h1>
              <p className="text-xl text-gray-600 mb-8 max-w-3xl mx-auto leading-relaxed">
                GenPaper helps you write well-structured, properly cited research papers in minutes — with sources you can trust.
              </p>
              
              <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-12">
                {user ? (
                  <>
                    <Button size="lg" className="bg-gray-900 hover:bg-gray-800 text-white px-8 py-3" asChild>
                      <Link href="/generate">
                        Continue Your Research
                        <ArrowRight className="ml-2 h-4 w-4" />
                      </Link>
                    </Button>
                    <Button size="lg" variant="outline" className="px-8 py-3" asChild>
                      <Link href="/library">View Library</Link>
                    </Button>
                  </>
                ) : (
                  <>
                    <Button size="lg" className="bg-gray-900 hover:bg-gray-800 text-white px-8 py-3" asChild>
                      <Link href="/signup">
                        Start Free Trial
                        <ArrowRight className="ml-2 h-4 w-4" />
                      </Link>
                    </Button>
                    <Button size="lg" variant="outline" className="px-8 py-3" asChild>
                      <Link href="/login">Sign In</Link>
                    </Button>
                  </>
                )}
              </div>

              <div className="flex flex-wrap items-center justify-center gap-6 text-sm text-gray-600">
                <div className="flex items-center gap-2">
                  <CheckCircle className="w-4 h-4 text-green-500" />
                  <span>Focus on ideas, not formatting</span>
                </div>
                <div className="flex items-center gap-2">
                  <CheckCircle className="w-4 h-4 text-green-500" />
                  <span>No credit card required</span>
                </div>
                <div className="flex items-center gap-2">
                  <CheckCircle className="w-4 h-4 text-green-500" />
                  <span>Perfect for essays, reports, theses</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="py-24 bg-background">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl sm:text-4xl font-bold text-foreground mb-4">
              Everything you need for research excellence
            </h2>
            <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
              Comprehensive tools designed to streamline your research workflow from discovery to publication.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            <Card className="border-2 hover:border-gray-300 transition-colors">
              <CardHeader>
                <div className="w-12 h-12 bg-gray-100 rounded-lg flex items-center justify-center mb-4">
                  <Brain className="h-6 w-6 text-gray-600" />
                </div>
                <CardTitle>Write Full Papers in Minutes</CardTitle>
                <CardDescription>
                  Just enter your topic. GenPaper writes a high-quality, citation-ready paper — including introduction, literature review, results, and conclusion.
                </CardDescription>
              </CardHeader>
            </Card>

            <Card className="border-2 hover:border-gray-300 transition-colors">
              <CardHeader>
                <div className="w-12 h-12 bg-gray-100 rounded-lg flex items-center justify-center mb-4">
                  <Search className="h-6 w-6 text-gray-600" />
                </div>
                <CardTitle>Find Trusted Sources Instantly</CardTitle>
                <CardDescription>
                  Get relevant papers from real journals, handpicked by smart search — no more digging through confusing search results.
                </CardDescription>
              </CardHeader>
            </Card>

            <Card className="border-2 hover:border-gray-300 transition-colors">
              <CardHeader>
                <div className="w-12 h-12 bg-gray-100 rounded-lg flex items-center justify-center mb-4">
                  <Quote className="h-6 w-6 text-gray-600" />
                </div>
                <CardTitle>Cite Without Headaches</CardTitle>
                <CardDescription>
                  Citations are generated for you in APA, MLA, or Chicago — with correct formatting, every time.
                </CardDescription>
              </CardHeader>
            </Card>

            <Card className="border-2 hover:border-gray-300 transition-colors">
              <CardHeader>
                <div className="w-12 h-12 bg-gray-100 rounded-lg flex items-center justify-center mb-4">
                  <BookOpen className="h-6 w-6 text-gray-600" />
                </div>
                <CardTitle>Keep Everything in One Place</CardTitle>
                <CardDescription>
                  Save, organize, and revisit your papers and sources — automatically sorted and easy to find.
                </CardDescription>
              </CardHeader>
            </Card>

            <Card className="border-2 hover:border-gray-300 transition-colors">
              <CardHeader>
                <div className="w-12 h-12 bg-gray-100 rounded-lg flex items-center justify-center mb-4">
                  <Clock className="h-6 w-6 text-gray-600" />
                </div>
                <CardTitle>Track Your Progress</CardTitle>
                <CardDescription>
                  Go back to any draft. GenPaper keeps versions of your work so you never lose a thing.
                </CardDescription>
              </CardHeader>
            </Card>

            <Card className="border-2 hover:border-gray-300 transition-colors">
              <CardHeader>
                <div className="w-12 h-12 bg-gray-100 rounded-lg flex items-center justify-center mb-4">
                  <Shield className="h-6 w-6 text-gray-600" />
                </div>
                <CardTitle>Private, Always Yours</CardTitle>
                <CardDescription>
                  Your work stays private and secure. GenPaper never shares or trains on your content.
                </CardDescription>
              </CardHeader>
            </Card>
          </div>
        </div>
      </section>

      {/* Benefits Section */}
      <section className="py-24 bg-muted/50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
            <div>
              <h2 className="text-3xl sm:text-4xl font-bold text-foreground mb-6">
                Transform your writing workflow
              </h2>
              <p className="text-lg text-muted-foreground mb-8">
                Join students and researchers who have simplified their academic writing with GenPaper&apos;s easy-to-use tools.
              </p>
              
              <div className="space-y-6">
                <div className="flex items-start gap-4">
                  <div className="w-8 h-8 bg-gray-100 rounded-full flex items-center justify-center flex-shrink-0 mt-1">
                    <Zap className="h-4 w-4 text-gray-600" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-foreground mb-2">Focus on Ideas, Not Formatting</h3>
                    <p className="text-muted-foreground">Let GenPaper handle structure, citations, and formatting while you focus on your research and arguments.</p>
                  </div>
                </div>
                
                <div className="flex items-start gap-4">
                  <div className="w-8 h-8 bg-gray-100 rounded-full flex items-center justify-center flex-shrink-0 mt-1">
                    <FileText className="h-4 w-4 text-gray-600" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-foreground mb-2">No Stress Over Finding Sources</h3>
                    <p className="text-muted-foreground">Reliable papers are included automatically — no more hours spent searching through databases.</p>
                  </div>
                </div>
                
                <div className="flex items-start gap-4">
                  <div className="w-8 h-8 bg-gray-100 rounded-full flex items-center justify-center flex-shrink-0 mt-1">
                    <Users className="h-4 w-4 text-gray-600" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-foreground mb-2">Perfect for Any Assignment</h3>
                    <p className="text-muted-foreground">Essays, reports, literature reviews, theses — GenPaper adapts to whatever you&apos;re writing.</p>
                  </div>
                </div>
              </div>
            </div>
            
            <div className="relative">
              <div className="bg-gradient-to-br from-gray-600 to-gray-800 rounded-2xl p-8 text-white">
                <div className="space-y-6">
                  <div className="bg-white/20 rounded-lg p-4">
                    <div className="flex items-center gap-3 mb-3">
                      <div className="w-3 h-3 bg-green-400 rounded-full"></div>
                      <span className="text-sm opacity-90">AI Analysis Complete</span>
                    </div>
                    <div className="bg-white/10 rounded h-2 mb-2">
                      <div className="bg-green-400 h-2 rounded w-full"></div>
                    </div>
                    <p className="text-sm opacity-75">Found 47 relevant sources</p>
                  </div>
                  
                  <div className="bg-white/20 rounded-lg p-4">
                    <div className="flex items-center gap-3 mb-3">
                      <div className="w-3 h-3 bg-gray-400 rounded-full animate-pulse"></div>
                      <span className="text-sm opacity-90">Generating Citations...</span>
                    </div>
                    <div className="bg-white/10 rounded h-2 mb-2">
                      <div className="bg-gray-400 h-2 rounded w-3/4 animate-pulse"></div>
                    </div>
                    <p className="text-sm opacity-75">Processing APA format</p>
                  </div>
                  
                  <div className="text-center pt-4">
                    <p className="text-sm opacity-90">Your research assistant is working...</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-24 bg-background">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-3xl sm:text-4xl font-bold text-foreground mb-6">
            {user ? "Ready to continue writing?" : "Ready to write your best paper yet?"}
          </h2>
          <p className="text-xl text-muted-foreground mb-8">
            {user ? "Pick up where you left off or start a new project." : "No setup, no stress. Just start writing."}
          </p>
          
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-8">
            {user ? (
              <>
                <Button size="lg" className="bg-gray-900 hover:bg-gray-800 text-white px-8 py-3" asChild>
                  <Link href="/generate">
                    Start New Paper
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Link>
                </Button>
                <Button size="lg" variant="outline" className="px-8 py-3" asChild>
                  <Link href="/history">View Past Projects</Link>
                </Button>
              </>
            ) : (
              <>
                <Button size="lg" className="bg-gray-900 hover:bg-gray-800 text-white px-8 py-3" asChild>
                  <Link href="/signup">
                    Write Your First Paper with GenPaper
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Link>
                </Button>
                <Button size="lg" variant="outline" className="px-8 py-3" asChild>
                  <Link href="/login">Sign In to Continue</Link>
                </Button>
              </>
            )}
          </div>
          
          <p className="text-sm text-muted-foreground">
            {user ? "All your work is automatically saved and organized." : "It's free — no credit card, no complicated setup • Free 14-day trial • Cancel anytime"}
          </p>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t bg-muted/30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <div className="flex flex-col md:flex-row justify-between items-center">
            <div className="flex items-center space-x-2 mb-4 md:mb-0">
              <Sparkles className="h-6 w-6 text-primary" />
              <span className="text-lg font-bold">GenPaper</span>
              <span className="text-sm text-muted-foreground ml-2">AI-Powered Research Assistant</span>
            </div>
            
            <div className="flex items-center space-x-6 text-sm text-muted-foreground">
              <a href="#" className="hover:text-foreground transition-colors">Privacy Policy</a>
              <a href="#" className="hover:text-foreground transition-colors">Terms of Service</a>
              <a href="#" className="hover:text-foreground transition-colors">Support</a>
            </div>
          </div>
          
          <div className="border-t mt-8 pt-8 text-center text-sm text-muted-foreground">
            <p>&copy; 2024 GenPaper. All rights reserved. Built for researchers, by researchers.</p>
          </div>
        </div>
      </footer>
    </div>
  )
}

```

### `app/projects/[id]/page.tsx`

```tsx
import { Metadata } from 'next'
import { redirect, notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import PaperViewer from '@/components/PaperViewer'
import { Suspense } from 'react'
import { LoadingSpinner } from '@/components/ui/loading-spinner'

interface ProjectPageProps {
  params: Promise<{
    id: string
  }>
}

export async function generateMetadata({ params }: ProjectPageProps): Promise<Metadata> {
  const { id } = await params
  const supabase = await createClient()
  
  try {
    const { data: project } = await supabase
      .from('research_projects')
      .select('topic')
      .eq('id', id)
      .single()

    if (project) {
      return {
        title: `${project.topic} | Genpaper`,
        description: `Research paper: ${project.topic}`,
      }
    }
  } catch {
    // Fall back to default metadata
  }

  return {
    title: 'Research Paper | Genpaper',
    description: 'View your generated research paper',
  }
}

export default async function ProjectPage({ params }: ProjectPageProps) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()

  if (authError || !user) {
    redirect('/login')
  }

  // Verify project exists and belongs to user
  const { data: project, error: projectError } = await supabase
    .from('research_projects')
    .select('id, user_id, topic, status')
    .eq('id', id)
    .single()

  if (projectError || !project) {
    notFound()
  }

  if (project.user_id !== user.id) {
    redirect('/history')
  }

  return (
    <div className="min-h-screen bg-background">
      <Suspense fallback={<ProjectViewerSkeleton />}>
        <PaperViewer projectId={id} />
      </Suspense>
    </div>
  )
}

function ProjectViewerSkeleton() {
  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      <div className="border rounded-lg p-6">
        <div className="flex items-start justify-between">
          <div className="space-y-2 flex-1">
            <div className="h-8 bg-muted rounded w-3/4 animate-pulse" />
            <div className="h-4 bg-muted rounded w-1/2 animate-pulse" />
          </div>
          <div className="flex items-center gap-2">
            <div className="h-6 bg-muted rounded w-20 animate-pulse" />
            <div className="h-8 bg-muted rounded w-24 animate-pulse" />
            <div className="h-8 bg-muted rounded w-20 animate-pulse" />
            <div className="h-8 bg-muted rounded w-28 animate-pulse" />
          </div>
        </div>
      </div>

      <div className="border rounded-lg p-6">
        <div className="space-y-4">
          <div className="h-6 bg-muted rounded w-1/3 animate-pulse" />
          <div className="space-y-2">
            <div className="h-4 bg-muted rounded w-full animate-pulse" />
            <div className="h-4 bg-muted rounded w-full animate-pulse" />
            <div className="h-4 bg-muted rounded w-3/4 animate-pulse" />
          </div>
          <div className="h-6 bg-muted rounded w-1/4 animate-pulse" />
          <div className="space-y-2">
            <div className="h-4 bg-muted rounded w-full animate-pulse" />
            <div className="h-4 bg-muted rounded w-5/6 animate-pulse" />
          </div>
        </div>
        
        <div className="flex items-center justify-center py-8">
          <LoadingSpinner text="Loading research paper..." />
        </div>
      </div>
    </div>
  )
} 
```

### `app/references/page.tsx`

```tsx
import ReferenceManager from '@/components/ReferenceManager'

export default function ReferencesPage() {
  return (
    <div className="container mx-auto p-6">
      <ReferenceManager className="w-full" />
    </div>
  )
} 
```

### `components/BlockEditor.tsx`

```tsx
'use client'

import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import CharacterCount from '@tiptap/extension-character-count'
import { useState, useCallback, useRef, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { LoadingSpinner } from '@/components/ui/loading-spinner'
import { 
  FileText, 
  Edit3, 
  Zap, 
  Save,
  Download,
  Eye,
  Sparkles
} from 'lucide-react'
import { toast } from 'react-hot-toast'
import { Node } from '@tiptap/core'

// AI Command types
interface AICommand {
  label: string
  description: string
  icon: React.ReactNode
  action: string
}

interface AIProgress {
  isGenerating: boolean
  progress: number
  message: string
}

interface BlockEditorProps {
  className?: string
  initialContent?: string
  documentId?: string
  onSave?: (content: string) => void
}

// AI Slash Commands Configuration
const AI_COMMANDS: AICommand[] = [
  {
    label: '/write',
    description: 'Generate new content section',
    icon: <Edit3 className="h-4 w-4" />,
    action: 'write'
  },
  {
    label: '/rewrite',
    description: 'Rewrite selected text for clarity',
    icon: <Zap className="h-4 w-4" />,
    action: 'rewrite'
  },
  {
    label: '/cite',
    description: 'Add citations to support claims',
    icon: <FileText className="h-4 w-4" />,
    action: 'cite'
  },
  {
    label: '/outline',
    description: 'Generate section outline',
    icon: <Sparkles className="h-4 w-4" />,
    action: 'outline'
  }
]

export default function BlockEditor({ 
  className, 
  initialContent = '', 
  documentId,
  onSave 
}: BlockEditorProps) {
  const [topic, setTopic] = useState('')
  const [aiProgress, setAiProgress] = useState<AIProgress>({
    isGenerating: false,
    progress: 0,
    message: ''
  })
  const [showSlashMenu, setShowSlashMenu] = useState(false)
  const [slashMenuPosition, setSlashMenuPosition] = useState({ x: 0, y: 0 })
  const [pendingAISuggestion, setPendingAISuggestion] = useState<{
    content: string
    range: { from: number, to: number }
  } | null>(null)
  const [selectedCommandIndex, setSelectedCommandIndex] = useState(0)
  const editorRef = useRef<HTMLDivElement>(null)
  const abortControllerRef = useRef<AbortController | null>(null)

  // Initialize Tiptap editor
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        // Configure heading levels
        heading: {
          levels: [1, 2, 3, 4, 5, 6],
        },
        // Enable all basic formatting
        bold: {},
        italic: {},
        strike: {},
        code: {},
        codeBlock: {},
        blockquote: {},
        bulletList: {},
        orderedList: {},
        listItem: {},
        horizontalRule: {},
      }),
      Placeholder.configure({
        placeholder: ({ node }) => {
          if (node.type.name === 'heading') {
            return 'What\'s the title?'
          }
          return 'Start writing your research paper... Type "/" for AI commands'
        },
        showOnlyWhenEditable: true,
        showOnlyCurrent: false,
      }),
      CharacterCount,
    ],
    content: initialContent || `
      <h1>Research Paper Title</h1>
      <p>Start writing your paper here. Use slash commands for AI assistance:</p>
      <ul>
        <li><strong>/write</strong> - Generate new content</li>
        <li><strong>/rewrite</strong> - Improve selected text</li>
        <li><strong>/cite</strong> - Add citations</li>
        <li><strong>/outline</strong> - Create section outline</li>
      </ul>
      <h2>Introduction</h2>
      <p>Begin your introduction here...</p>
    `,
    editorProps: {
      attributes: {
        class: 'prose prose-lg max-w-none focus:outline-none min-h-[500px] p-6',
      },
      handleKeyDown: (view, event) => {
        if (event.key === '/') {
          const { selection } = view.state
          const { from } = selection
          
          // Check if the character before the cursor is whitespace or we're at document start
          const charBefore = from > 0 ? view.state.doc.textBetween(from - 1, from) : ' '
          if (from > 0 && !/\s/.test(charBefore)) {
            return false // Don't show menu if we're in the middle of a word
          }
          
          // Get coordinates and adjust for scroll position
          const coords = view.coordsAtPos(from)
          const editorRect = editorRef.current?.getBoundingClientRect()
          
          if (editorRect) {
            setSlashMenuPosition({
              x: coords.left - editorRect.left,
              y: coords.bottom - editorRect.top
            })
          } else {
            setSlashMenuPosition({ x: coords.left, y: coords.bottom })
          }
          
          setShowSlashMenu(true)
          setSelectedCommandIndex(0)
          return false
        }
        
        if (showSlashMenu) {
          if (event.key === 'ArrowDown') {
            event.preventDefault()
            setSelectedCommandIndex(prev => (prev + 1) % AI_COMMANDS.length)
            return true
          }
          if (event.key === 'ArrowUp') {
            event.preventDefault()
            setSelectedCommandIndex(prev => prev === 0 ? AI_COMMANDS.length - 1 : prev - 1)
            return true
          }
          if (event.key === 'Enter') {
            event.preventDefault()
            handleSlashCommand(AI_COMMANDS[selectedCommandIndex].action)
            return true
          }
          if (event.key === 'Escape') {
            setShowSlashMenu(false)
            return true
          }
        }
        
        return false
      },
    },
    onUpdate: ({ editor }) => {
      // Auto-save logic could go here
      const content = editor.getHTML()
      onSave?.(content)
      
      // Hide slash menu if user continues typing
      if (showSlashMenu) {
        const { state } = editor
        const { selection } = state
        const textBefore = state.doc.textBetween(Math.max(0, selection.from - 10), selection.from)
        if (!textBefore.endsWith('/')) {
          setShowSlashMenu(false)
        }
      }
    },
  })

  // Handle AI command execution
  const executeAICommand = useCallback(async (command: string) => {
    if (!editor || !topic.trim()) {
      alert('Please enter a research topic first')
      return
    }

    setShowSlashMenu(false)
    setAiProgress({ isGenerating: true, progress: 0, message: `Running ${command} command...` })

    try {
      const { state } = editor
      const { selection } = state
      const selectedText = state.doc.textBetween(selection.from, selection.to)
      
      // Get current document content for context
      const documentContent = editor.getHTML()
      
      const response = await fetch('/api/generate/unified', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          command,
          topic: topic.trim(),
          selection: selectedText,
          documentContent,
          documentId,
          cursorPosition: selection.from
        })
      })

      if (!response.ok) throw new Error('AI command failed')

      const reader = response.body?.getReader()
      if (!reader) throw new Error('No response body')

      const decoder = new TextDecoder()
      let buffer = ''
      let generatedContent = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (!line.trim()) continue

          try {
            const data = JSON.parse(line)
            
            if (data.type === 'progress') {
              setAiProgress({
                isGenerating: true,
                progress: data.progress || 0,
                message: data.message || 'Processing...'
              })
            } else if (data.type === 'block' && data.block?.content) {
              // Extract text content from the block
              const blockText = extractTextFromBlock(data.block.content)
              generatedContent += blockText + '\n\n'
            } else if (data.type === 'complete') {
              // Show AI suggestion for user approval
              if (generatedContent.trim()) {
                setPendingAISuggestion({
                  content: generatedContent.trim(),
                  range: { from: selection.from, to: selection.to }
                })
              }
            }
          } catch (e) {
            console.error('Failed to parse AI response:', e)
          }
        }
      }
    } catch (error) {
      console.error('AI command error:', error)
      setAiProgress({
        isGenerating: false,
        progress: 0,
        message: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`
      })
    } finally {
      setAiProgress({ isGenerating: false, progress: 0, message: '' })
    }
  }, [editor, topic, documentId])

  // Accept AI suggestion
  const acceptAISuggestion = useCallback(() => {
    if (!editor || !pendingAISuggestion) return

    const { content, range } = pendingAISuggestion
    
    // Replace the selected range with AI content
    editor.chain()
      .focus()
      .setTextSelection({ from: range.from, to: range.to })
      .insertContent(content)
      .run()

    setPendingAISuggestion(null)
  }, [editor, pendingAISuggestion])

  // Reject AI suggestion
  const rejectAISuggestion = useCallback(() => {
    setPendingAISuggestion(null)
  }, [])

  // Extract text content from block structure
  const extractTextFromBlock = useCallback((block: any): string => {
    if (!block?.content) return ''
    
    try {
      // Use Tiptap's built-in method to extract text content
      const node = Node.fromJSON(editor?.schema || {}, block.content)
      return node.textContent || ''
    } catch (error) {
      console.warn('Failed to extract text from block:', error)
      // Fallback to simple extraction
      if (typeof block.content === 'string') return block.content
      if (block.content?.content) {
        return block.content.content
          .map((item: any) => item.text || '')
          .join(' ')
      }
      return ''
    }
  }, [editor])

  // Save document
  const handleSave = useCallback(() => {
    if (!editor) return
    const content = editor.getHTML()
    onSave?.(content)
    // Here you could also save to your blocks table by parsing the HTML
    console.log('Document saved:', content)
  }, [editor, onSave])

  // Export document
  const handleExport = useCallback(() => {
    if (!editor) return
    const content = editor.getHTML()
    const blob = new Blob([content], { type: 'text/html' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'research-paper.html'
    a.click()
    URL.revokeObjectURL(url)
  }, [editor])

  const handleSlashCommand = useCallback(async (command: string) => {
    if (!editor) return
    
    // Abort any existing generation
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
    }
    
    // Create new abort controller
    abortControllerRef.current = new AbortController()
    
    setShowSlashMenu(false)
    setAiProgress({ isGenerating: true, progress: 0, message: `Running ${command} command...` })
    
    const { selection } = editor.state
    const selectedText = editor.state.doc.textBetween(selection.from, selection.to)
    
    try {
      const response = await fetch('/api/generate/unified', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: abortControllerRef.current.signal,
        body: JSON.stringify({
          command,
          topic: topic.trim(),
          selection: selectedText,
          documentContent: editor.getHTML(),
          documentId,
          cursorPosition: selection.from
        })
      })

      if (!response.ok) throw new Error('Generation failed')
      
      const reader = response.body?.getReader()
      if (!reader) throw new Error('No response body')
      
      let accumulatedText = ''
      
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        
        const chunk = new TextDecoder().decode(value)
        const lines = chunk.split('\n').filter(line => line.trim())
        
        for (const line of lines) {
          try {
            const data = JSON.parse(line)
            
            if (data.type === 'progress') {
              setAiProgress({
                isGenerating: true,
                progress: data.progress,
                message: data.message || 'Processing...'
              })
            } else if (data.type === 'content') {
              accumulatedText += data.content
              setAiProgress({
                isGenerating: true,
                progress: data.progress,
                message: data.message || 'Processing...'
              })
            } else if (data.type === 'complete') {
              setAiProgress({
                isGenerating: false,
                progress: 100,
                message: 'Content generated successfully'
              })
              break
            } else if (data.type === 'error') {
              throw new Error(data.message)
            }
          } catch (parseError) {
            console.warn('Failed to parse chunk:', parseError)
          }
        }
      }
      
    } catch (error: any) {
      if (error.name === 'AbortError') {
        console.log('Generation aborted')
      } else {
        console.error('Generation error:', error)
        toast.error('Failed to generate content')
      }
    } finally {
      setAiProgress({ isGenerating: false, progress: 0, message: '' })
      abortControllerRef.current = null
    }
  }, [editor, topic, documentId])

  // Clean up abort controller on unmount
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort()
      }
    }
  }, [])

  const stats = editor ? {
    words: editor.storage.characterCount.words({ nodeTypes: ['paragraph', 'heading'] }),
    characters: editor.storage.characterCount.characters({ nodeTypes: ['paragraph', 'heading'] })
  } : { words: 0, characters: 0 }

  return (
    <div className={`max-w-6xl mx-auto p-6 space-y-6 ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Research Paper Editor</h1>
          <p className="text-muted-foreground">
            Write naturally and use AI slash commands for assistance
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleSave}>
            <Save className="h-4 w-4 mr-2" />
            Save
          </Button>
          <Button variant="outline" size="sm" onClick={handleExport}>
            <Download className="h-4 w-4 mr-2" />
            Export
          </Button>
        </div>
      </div>

      {/* Topic Input */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Research Topic</CardTitle>
        </CardHeader>
        <CardContent>
          <Textarea
            placeholder="Enter your research topic to enable AI commands..."
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            className="min-h-[60px]"
          />
        </CardContent>
      </Card>

      {/* AI Progress */}
      {aiProgress.isGenerating && (
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <LoadingSpinner size="sm" />
              <div className="flex-1">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-medium">AI Processing</span>
                  <span className="text-sm text-muted-foreground">{aiProgress.progress}%</span>
                </div>
                <div className="w-full bg-muted rounded-full h-2">
                  <div 
                    className="bg-primary h-2 rounded-full transition-all"
                    style={{ width: `${aiProgress.progress}%` }}
                  />
                </div>
                <p className="text-sm text-muted-foreground mt-1">{aiProgress.message}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* AI Suggestion Approval */}
      {pendingAISuggestion && (
        <Card className="border-blue-200 bg-blue-50">
          <CardContent className="p-4">
            <div className="flex items-start justify-between mb-3">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-blue-600" />
                <span className="font-medium text-blue-900">AI Suggestion</span>
              </div>
              <div className="flex gap-2">
                <Button size="sm" onClick={acceptAISuggestion}>
                  Accept
                </Button>
                <Button size="sm" variant="outline" onClick={rejectAISuggestion}>
                  Reject
                </Button>
              </div>
            </div>
            <div className="bg-white rounded border p-3 text-sm">
              <div dangerouslySetInnerHTML={{ __html: pendingAISuggestion.content.replace(/\n/g, '<br/>') }} />
            </div>
          </CardContent>
        </Card>
      )}

      {/* Main Editor */}
      <Card>
        <div className="relative">
          <EditorContent 
            editor={editor} 
            className="min-h-[600px] focus-within:ring-2 focus-within:ring-ring rounded-lg"
          />
          
          {/* Slash Command Menu */}
          {showSlashMenu && (
            <div 
              className="absolute z-50 bg-white border rounded-lg shadow-lg p-2 w-64"
              style={{
                left: slashMenuPosition.x,
                top: slashMenuPosition.y + 5
              }}
            >
              <div className="text-sm font-medium text-muted-foreground mb-2 px-2">
                AI Commands
              </div>
              {AI_COMMANDS.map((command, index) => (
                <button
                  key={command.action}
                  className={`w-full flex items-center gap-3 px-2 py-2 text-sm hover:bg-muted rounded text-left ${index === selectedCommandIndex ? 'bg-primary text-primary' : ''}`}
                  onClick={() => handleSlashCommand(command.action)}
                >
                  {command.icon}
                  <div>
                    <div className="font-medium">{command.label}</div>
                    <div className="text-muted-foreground text-xs">{command.description}</div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </Card>

      {/* Editor Stats */}
      <div className="flex items-center gap-4 text-sm text-muted-foreground">
        <div className="flex items-center gap-1">
          <Eye className="h-4 w-4" />
          Words: {stats.words}
        </div>
        <div className="flex items-center gap-1">
          <FileText className="h-4 w-4" />
          Characters: {stats.characters}
        </div>
        {topic && (
          <Badge variant="secondary" className="ml-auto">
            <Sparkles className="h-3 w-3 mr-1" />
            AI Ready
          </Badge>
        )}
      </div>
    </div>
  )
} 
```

### `components/ComponentErrorFallbacks.tsx`

```tsx
'use client'

import React from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { 
  RefreshCw, 
  FileText, 
  BookOpen, 
  Edit3,
  AlertCircle,
  Zap
} from 'lucide-react'

interface ComponentErrorFallbackProps {
  error?: Error
  onRetry?: () => void
  title?: string
  description?: string
}

// Generic component error fallback
export function ComponentErrorFallback({
  error,
  onRetry,
  title = "Component Error",
  description = "This component encountered an error."
}: ComponentErrorFallbackProps) {
  return (
    <Card className="border-red-200 bg-red-50">
      <CardContent className="p-4">
        <div className="flex items-center gap-3">
          <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0" />
          <div className="flex-1">
            <h3 className="font-medium text-red-900">{title}</h3>
            <p className="text-sm text-red-700 mt-1">{description}</p>
            {error && process.env.NODE_ENV === 'development' && (
              <pre className="text-xs text-red-600 mt-2 bg-red-100 p-2 rounded overflow-x-auto">
                {error.message}
              </pre>
            )}
          </div>
          {onRetry && (
            <Button 
              size="sm" 
              variant="outline" 
              onClick={onRetry}
              className="border-red-200 text-red-700 hover:bg-red-100"
            >
              <RefreshCw className="w-4 h-4 mr-1" />
              Retry
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

// Editor-specific error fallback
export function EditorErrorFallback({
  error,
  onRetry,
  onSafeMode
}: ComponentErrorFallbackProps & { onSafeMode?: () => void }) {
  return (
    <div className="flex items-center justify-center h-96 bg-gray-50 rounded-lg border-2 border-dashed border-gray-300">
      <Card className="w-full max-w-md border-orange-200 bg-orange-50">
        <CardHeader className="text-center pb-3">
          <div className="mx-auto w-12 h-12 bg-orange-100 rounded-full flex items-center justify-center mb-3">
            <Edit3 className="w-6 h-6 text-orange-600" />
          </div>
          <CardTitle className="text-lg text-orange-900">Editor Error</CardTitle>
        </CardHeader>
        
        <CardContent className="space-y-4">
          <p className="text-sm text-orange-800 text-center">
            The text editor encountered an error. Your content should be automatically saved.
          </p>
          
          {error && process.env.NODE_ENV === 'development' && (
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription className="text-xs">
                <strong>Dev Error:</strong> {error.message}
              </AlertDescription>
            </Alert>
          )}
          
          <div className="flex flex-col gap-2">
            {onRetry && (
              <Button onClick={onRetry} size="sm" className="w-full">
                <RefreshCw className="w-4 h-4 mr-2" />
                Reload Editor
              </Button>
            )}
            
            {onSafeMode && (
              <Button 
                variant="outline" 
                onClick={onSafeMode} 
                size="sm" 
                className="w-full"
              >
                <Zap className="w-4 h-4 mr-2" />
                Safe Mode (Plain Text)
              </Button>
            )}
          </div>
          
          <p className="text-xs text-orange-600 text-center">
            Try refreshing the page if the problem persists.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}

// Outline panel error fallback
export function OutlinePanelErrorFallback({
  error,
  onRetry
}: ComponentErrorFallbackProps) {
  return (
    <div className="p-4">
      <Card className="border-blue-200 bg-blue-50">
        <CardContent className="p-4">
          <div className="text-center">
            <FileText className="w-8 h-8 text-blue-600 mx-auto mb-3" />
            <h3 className="font-medium text-blue-900 mb-2">Outline Panel Error</h3>
            <p className="text-sm text-blue-700 mb-3">
              Unable to load document outline.
            </p>
            
            {error && process.env.NODE_ENV === 'development' && (
              <div className="text-xs text-blue-600 mb-3 bg-blue-100 p-2 rounded">
                {error.message}
              </div>
            )}
            
            {onRetry && (
              <Button 
                size="sm" 
                onClick={onRetry}
                className="bg-blue-600 hover:bg-blue-700"
              >
                <RefreshCw className="w-4 h-4 mr-2" />
                Reload Outline
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

// Citation panel error fallback
export function CitationPanelErrorFallback({
  error,
  onRetry
}: ComponentErrorFallbackProps) {
  return (
    <div className="p-4">
      <Card className="border-green-200 bg-green-50">
        <CardContent className="p-4">
          <div className="text-center">
            <BookOpen className="w-8 h-8 text-green-600 mx-auto mb-3" />
            <h3 className="font-medium text-green-900 mb-2">Citations Error</h3>
            <p className="text-sm text-green-700 mb-3">
              Unable to load citations and references.
            </p>
            
            {error && process.env.NODE_ENV === 'development' && (
              <div className="text-xs text-green-600 mb-3 bg-green-100 p-2 rounded">
                {error.message}
              </div>
            )}
            
            {onRetry && (
              <Button 
                size="sm" 
                onClick={onRetry}
                className="bg-green-600 hover:bg-green-700"
              >
                <RefreshCw className="w-4 h-4 mr-2" />
                Reload Citations
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

// Loading state error fallback (for when loading states fail)
export function LoadingErrorFallback({
  error,
  onRetry,
  message = "Failed to load content"
}: ComponentErrorFallbackProps & { message?: string }) {
  return (
    <div className="flex items-center justify-center p-8">
      <div className="text-center">
        <div className="w-12 h-12 bg-gray-200 rounded-full flex items-center justify-center mx-auto mb-4">
          <AlertCircle className="w-6 h-6 text-gray-500" />
        </div>
        <h3 className="font-medium text-gray-900 mb-2">{message}</h3>
        
        {error && (
          <p className="text-sm text-gray-600 mb-4">
            {error.message || "An unexpected error occurred"}
          </p>
        )}
        
        {onRetry && (
          <Button size="sm" variant="outline" onClick={onRetry}>
            <RefreshCw className="w-4 h-4 mr-2" />
            Try Again
          </Button>
        )}
      </div>
    </div>
  )
} 
```

### `components/DashboardNav.tsx`

```tsx
'use client'

import { useState, useEffect } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { 
  DropdownMenu, 
  DropdownMenuContent, 
  DropdownMenuItem, 
  DropdownMenuSeparator, 
  DropdownMenuTrigger 
} from '@/components/ui/dropdown-menu'
import { 
  Sparkles, 
  BookOpen, 
  History, 
  User, 
  Settings, 
  LogOut, 
  Menu,
  X,
  Zap
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

export default function DashboardNav() {
  const router = useRouter()
  const pathname = usePathname()
  const [user, setUser] = useState<{ email?: string; user_metadata?: { full_name?: string } } | null>(null)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const supabase = createClient()

  useEffect(() => {
    const getUser = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      setUser(user)
    }
    getUser()
  }, [supabase.auth])

  const handleSignOut = async () => {
    await supabase.auth.signOut()
    router.push('/login')
  }

  const navigation = [
    {
      name: 'Generate',
      href: '/generate',
      icon: Zap,
      description: 'Create new research papers'
    },
    {
      name: 'Library',
      href: '/library',
      icon: BookOpen,
      description: 'Manage your research collection'
    },
    {
      name: 'History',
      href: '/history',
      icon: History,
      description: 'View past projects'
    }
  ]

  const isActive = (href: string) => {
    if (href === '/') return pathname === '/'
    return pathname.startsWith(href)
  }

  return (
    <nav className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-16">
          {/* Logo and Desktop Navigation */}
          <div className="flex items-center">
            <Link href="/generate" className="flex items-center space-x-2">
              <Sparkles className="h-8 w-8 text-primary" />
              <span className="text-xl font-bold">Genpaper</span>
            </Link>
            
            <div className="hidden sm:ml-8 sm:flex sm:space-x-1">
              {navigation.map((item) => {
                const Icon = item.icon
                return (
                  <Link
                    key={item.name}
                    href={item.href}
                    className={`inline-flex items-center px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                      isActive(item.href)
                        ? 'bg-primary/10 text-primary'
                        : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                    }`}
                  >
                    <Icon className="h-4 w-4 mr-2" />
                    {item.name}
                  </Link>
                )
              })}
            </div>
          </div>

          {/* Desktop User Menu */}
          <div className="hidden sm:flex sm:items-center sm:space-x-4">
            {user && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" className="relative h-8 w-8 rounded-full">
                    <Avatar className="h-8 w-8">
                      <AvatarFallback className="bg-primary text-primary-foreground">
                        {user.email?.charAt(0).toUpperCase() || 'U'}
                      </AvatarFallback>
                    </Avatar>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-56" align="end" forceMount>
                  <div className="flex items-center justify-start gap-2 p-2">
                    <div className="flex flex-col space-y-1 leading-none">
                      <p className="font-medium text-sm">{user.email}</p>
                      <p className="text-xs text-muted-foreground">
                        {user.user_metadata?.full_name || 'Researcher'}
                      </p>
                    </div>
                  </div>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem asChild>
                    <Link href="/profile" className="cursor-pointer">
                      <User className="mr-2 h-4 w-4" />
                      Profile
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link href="/settings" className="cursor-pointer">
                      <Settings className="mr-2 h-4 w-4" />
                      Settings
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={handleSignOut} className="cursor-pointer">
                    <LogOut className="mr-2 h-4 w-4" />
                    Sign out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>

          {/* Mobile menu button */}
          <div className="sm:hidden flex items-center">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              aria-label="Toggle menu"
            >
              {mobileMenuOpen ? (
                <X className="h-5 w-5" />
              ) : (
                <Menu className="h-5 w-5" />
              )}
            </Button>
          </div>
        </div>
      </div>

      {/* Mobile menu */}
      {mobileMenuOpen && (
        <div className="sm:hidden">
          <div className="px-2 pt-2 pb-3 space-y-1 bg-background border-t">
            {navigation.map((item) => {
              const Icon = item.icon
              return (
                <Link
                  key={item.name}
                  href={item.href}
                  onClick={() => setMobileMenuOpen(false)}
                  className={`flex items-center px-3 py-2 rounded-md text-base font-medium transition-colors ${
                    isActive(item.href)
                      ? 'bg-primary/10 text-primary'
                      : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                  }`}
                >
                  <Icon className="h-5 w-5 mr-3" />
                  <div>
                    <div className="font-medium">{item.name}</div>
                    <div className="text-xs text-muted-foreground">{item.description}</div>
                  </div>
                </Link>
              )
            })}
            
            {user && (
              <div className="border-t pt-3 mt-3">
                <div className="flex items-center px-3 py-2">
                  <Avatar className="h-8 w-8 mr-3">
                    <AvatarFallback className="bg-primary text-primary-foreground">
                      {user.email?.charAt(0).toUpperCase() || 'U'}
                    </AvatarFallback>
                  </Avatar>
                  <div>
                    <div className="text-sm font-medium">{user.email}</div>
                    <div className="text-xs text-muted-foreground">
                      {user.user_metadata?.full_name || 'Researcher'}
                    </div>
                  </div>
                </div>
                <div className="px-2 space-y-1">
                  <Link
                    href="/profile"
                    onClick={() => setMobileMenuOpen(false)}
                    className="flex items-center px-3 py-2 rounded-md text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted"
                  >
                    <User className="h-4 w-4 mr-3" />
                    Profile
                  </Link>
                  <Link
                    href="/settings"
                    onClick={() => setMobileMenuOpen(false)}
                    className="flex items-center px-3 py-2 rounded-md text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted"
                  >
                    <Settings className="h-4 w-4 mr-3" />
                    Settings
                  </Link>
                  <button
                    onClick={handleSignOut}
                    className="flex items-center w-full px-3 py-2 rounded-md text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted"
                  >
                    <LogOut className="h-4 w-4 mr-3" />
                    Sign out
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </nav>
  )
} 
```

### `components/ErrorBoundary.tsx`

```tsx
'use client'

import React, { Component, ErrorInfo, ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { 
  RefreshCw, 
  AlertTriangle, 
  Home, 
  Bug,
  ChevronDown,
  ChevronUp 
} from 'lucide-react'

interface Props {
  children: ReactNode
  fallback?: ReactNode
  onError?: (error: Error, errorInfo: ErrorInfo) => void
  resetOnPropsChange?: boolean
  resetKeys?: Array<string | number>
}

interface State {
  hasError: boolean
  error: Error | null
  errorInfo: ErrorInfo | null
  showDetails: boolean
  errorId: string
}

export class ErrorBoundary extends Component<Props, State> {
  private resetTimeoutId: number | null = null

  constructor(props: Props) {
    super(props)
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
      showDetails: false,
      errorId: '',
    }
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    // Generate a unique error ID for tracking
    const errorId = `error_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    
    return {
      hasError: true,
      error,
      errorId,
    }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    // Log error details
    console.error('ErrorBoundary caught an error:', error, errorInfo)
    
    this.setState({
      errorInfo,
    })

    // Call custom error handler if provided
    this.props.onError?.(error, errorInfo)

    // In a real app, you'd send this to an error reporting service
    this.logErrorToService(error, errorInfo)
  }

  componentDidUpdate(prevProps: Props) {
    const { resetOnPropsChange, resetKeys } = this.props
    const { hasError } = this.state

    // Auto-reset if props changed and resetOnPropsChange is true
    if (hasError && resetOnPropsChange && prevProps.children !== this.props.children) {
      this.resetErrorBoundary()
    }

    // Reset if any of the resetKeys changed
    if (hasError && resetKeys && prevProps.resetKeys) {
      const hasResetKeyChanged = resetKeys.some(
        (resetKey, idx) => prevProps.resetKeys![idx] !== resetKey
      )
      if (hasResetKeyChanged) {
        this.resetErrorBoundary()
      }
    }
  }

  resetErrorBoundary = () => {
    // Clear any pending reset timeout
    if (this.resetTimeoutId) {
      clearTimeout(this.resetTimeoutId)
    }

    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
      showDetails: false,
      errorId: '',
    })
  }

  handleRetry = () => {
    this.resetErrorBoundary()
  }

  handleReload = () => {
    window.location.reload()
  }

  handleGoHome = () => {
    window.location.href = '/'
  }

  toggleDetails = () => {
    this.setState(prev => ({ showDetails: !prev.showDetails }))
  }

  private logErrorToService = (error: Error, errorInfo: ErrorInfo) => {
    // In production, send to error tracking service like Sentry, LogRocket, etc.
    const errorData = {
      message: error.message,
      stack: error.stack,
      componentStack: errorInfo.componentStack,
      errorId: this.state.errorId,
      url: window.location.href,
      userAgent: navigator.userAgent,
      timestamp: new Date().toISOString(),
    }

    // For now, just log to console in development
    if (process.env.NODE_ENV === 'development') {
      console.group('🚨 Error Boundary Report')
      console.error('Error ID:', errorData.errorId)
      console.error('Error:', error)
      console.error('Component Stack:', errorInfo.componentStack)
      console.error('Full Report:', errorData)
      console.groupEnd()
    }
  }

  render() {
    if (this.state.hasError) {
      // If a custom fallback is provided, use it
      if (this.props.fallback) {
        return this.props.fallback
      }

      // Default error UI
      const { error, errorInfo, showDetails, errorId } = this.state

      return (
        <div className="min-h-screen flex items-center justify-center p-4 bg-gray-50">
          <Card className="w-full max-w-2xl">
            <CardHeader className="text-center">
              <div className="mx-auto w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mb-4">
                <AlertTriangle className="w-8 h-8 text-red-600" />
              </div>
              <CardTitle className="text-2xl text-gray-900">
                Oops! Something went wrong
              </CardTitle>
              <p className="text-gray-600 mt-2">
                We encountered an unexpected error. Don&apos;t worry, we&apos;ve been notified and are working on a fix.
              </p>
            </CardHeader>
            
            <CardContent className="space-y-4">
              <Alert>
                <Bug className="h-4 w-4" />
                <AlertDescription>
                  Error ID: <code className="font-mono text-sm">{errorId}</code>
                  <br />
                  Please include this ID when reporting the issue.
                </AlertDescription>
              </Alert>

              <div className="flex flex-col sm:flex-row gap-3">
                <Button onClick={this.handleRetry} className="flex-1">
                  <RefreshCw className="w-4 h-4 mr-2" />
                  Try Again
                </Button>
                <Button variant="outline" onClick={this.handleReload} className="flex-1">
                  <RefreshCw className="w-4 h-4 mr-2" />
                  Reload Page
                </Button>
                <Button variant="outline" onClick={this.handleGoHome} className="flex-1">
                  <Home className="w-4 h-4 mr-2" />
                  Go Home
                </Button>
              </div>

              {/* Error Details (for developers) */}
              {process.env.NODE_ENV === 'development' && (
                <div className="border-t pt-4">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={this.toggleDetails}
                    className="mb-3"
                  >
                    {showDetails ? (
                      <>
                        <ChevronUp className="w-4 h-4 mr-2" />
                        Hide Details
                      </>
                    ) : (
                      <>
                        <ChevronDown className="w-4 h-4 mr-2" />
                        Show Details (Dev)
                      </>
                    )}
                  </Button>

                  {showDetails && (
                    <div className="space-y-3">
                      <div>
                        <h4 className="font-semibold text-sm text-gray-900 mb-2">Error Message:</h4>
                        <pre className="text-xs bg-red-50 p-3 rounded border overflow-x-auto text-red-800">
                          {error?.message}
                        </pre>
                      </div>
                      
                      {error?.stack && (
                        <div>
                          <h4 className="font-semibold text-sm text-gray-900 mb-2">Stack Trace:</h4>
                          <pre className="text-xs bg-gray-100 p-3 rounded border overflow-x-auto max-h-40 overflow-y-auto">
                            {error.stack}
                          </pre>
                        </div>
                      )}
                      
                      {errorInfo?.componentStack && (
                        <div>
                          <h4 className="font-semibold text-sm text-gray-900 mb-2">Component Stack:</h4>
                          <pre className="text-xs bg-blue-50 p-3 rounded border overflow-x-auto max-h-40 overflow-y-auto">
                            {errorInfo.componentStack}
                          </pre>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )
    }

    return this.props.children
  }
} 
```

### `components/FetchSourcesReview.tsx`

```tsx
'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Checkbox } from '@/components/ui/checkbox'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { 
  Search, 
  BookOpen, 
  Download,
  FileText,
  ExternalLink,
  Users,
  Calendar,
  AlertCircle,
  Globe
} from 'lucide-react'
import { toast } from 'sonner'
import { LoadingSpinner } from '@/components/ui/loading-spinner'
import { PaperSource, PaperSources } from '@/types/simplified'

interface RankedPaper {
  canonical_id: string
  title: string
  abstract: string
  year: number
  venue?: string
  doi?: string
  url?: string
  pdf_url?: string
  citationCount: number
  authors?: string[]
  source: PaperSource
  relevanceScore: number
  combinedScore: number
  bm25Score?: number
  authorityScore?: number
  recencyScore?: number
}

interface SearchOptions {
  limit?: number
  fromYear?: number
  toYear?: number
  openAccessOnly?: boolean
  maxResults?: number
  includePreprints?: boolean
  semanticWeight?: number
  authorityWeight?: number
  recencyWeight?: number
  sources?: PaperSources
}

interface FetchSourcesResponse {
  success: boolean
  topic: string
  papers: RankedPaper[]
  count: number
  error?: string
}

interface PDFDownloadStatus {
  paperId: string
  hasPdf: boolean
  pdfUrl?: string
  doi?: string
  canDownload: boolean
  downloading?: boolean
  error?: string
}

interface FetchSourcesReviewProps {
  onPapersSelected: (papers: RankedPaper[]) => void
  className?: string
}

export default function FetchSourcesReview({ 
  onPapersSelected,
  className 
}: FetchSourcesReviewProps) {
  // Search state
  const [searchTopic, setSearchTopic] = useState('')
  const [searchOptions, setSearchOptions] = useState<SearchOptions>({
    maxResults: 25,
    fromYear: new Date().getFullYear() - 5, // Last 5 years by default
    openAccessOnly: false,
    sources: ['openalex', 'crossref', 'semantic_scholar']
  })
  
  // Results state
  const [papers, setPapers] = useState<RankedPaper[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedPaperIds, setSelectedPaperIds] = useState<Set<string>>(new Set())
  
  // PDF download state
  const [pdfStatus, setPdfStatus] = useState<Map<string, PDFDownloadStatus>>(new Map())
  const [batchDownloading, setBatchDownloading] = useState(false)
  
  // Filter state for results
  const [resultsFilter, setResultsFilter] = useState('')
  const [sortBy, setSortBy] = useState<'relevance' | 'citations' | 'year' | 'title'>('relevance')

  const formatAuthors = useCallback((authors?: string[]) => {
    if (!authors || authors.length === 0) return 'Unknown authors'
    if (authors.length === 1) return authors[0]
    if (authors.length === 2) return `${authors[0]} & ${authors[1]}`
    return `${authors[0]} et al.`
  }, [])

  const formatDate = useCallback((year?: number) => {
    return year ? year.toString() : 'Unknown year'
  }, [])

  // Filtered and sorted papers
  const filteredPapers = useMemo(() => {
    let filtered = [...papers]

    // Apply search filter
    if (resultsFilter) {
      const searchLower = resultsFilter.toLowerCase()
      filtered = filtered.filter(paper => 
        paper.title.toLowerCase().includes(searchLower) ||
        paper.abstract.toLowerCase().includes(searchLower) ||
        paper.authors?.some(author => 
          author.toLowerCase().includes(searchLower)
        ) ||
        paper.venue?.toLowerCase().includes(searchLower)
      )
    }

    // Apply sorting
    filtered.sort((a, b) => {
      switch (sortBy) {
        case 'relevance':
          return b.combinedScore - a.combinedScore
        case 'citations':
          return b.citationCount - a.citationCount
        case 'year':
          return b.year - a.year
        case 'title':
          return a.title.localeCompare(b.title)
        default:
          return 0
      }
    })

    return filtered
  }, [papers, resultsFilter, sortBy])

  // Search papers
  const searchPapers = useCallback(async () => {
    if (!searchTopic.trim()) {
      toast.error('Please enter a search topic')
      return
    }

    setLoading(true)
    setError(null)
    setPapers([])

    try {
      console.log('🔍 Searching for papers:', searchTopic)
      
      const response = await fetch('/api/fetch-sources', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({
          topic: searchTopic,
          options: searchOptions
        })
      })

      if (!response.ok) {
        throw new Error(`Search failed: ${response.status} ${response.statusText}`)
      }

      const data: FetchSourcesResponse = await response.json()
      
      if (!data.success) {
        throw new Error(data.error || 'Search failed')
      }

      console.log(`✅ Found ${data.papers.length} papers`)
      setPapers(data.papers)
      
      // Initialize PDF status for papers with DOIs
      const initialPdfStatus = new Map<string, PDFDownloadStatus>()
      data.papers.forEach(paper => {
        initialPdfStatus.set(paper.canonical_id, {
          paperId: paper.canonical_id,
          hasPdf: !!paper.pdf_url,
          pdfUrl: paper.pdf_url,
          doi: paper.doi,
          canDownload: !!paper.doi && !paper.pdf_url
        })
      })
      setPdfStatus(initialPdfStatus)

      toast.success(`Found ${data.papers.length} papers for "${searchTopic}"`)

    } catch (error) {
      console.error('Search error:', error)
      const message = error instanceof Error ? error.message : 'Search failed'
      setError(message)
      toast.error(message)
    } finally {
      setLoading(false)
    }
  }, [searchTopic, searchOptions])

  // Download PDF for a single paper
  const downloadPDF = useCallback(async (paper: RankedPaper) => {
    if (!paper.doi) {
      toast.error('No DOI available for PDF download')
      return
    }

    const currentStatus = pdfStatus.get(paper.canonical_id)
    if (currentStatus?.downloading) return

    // Update status to downloading
    setPdfStatus(prev => new Map(prev.set(paper.canonical_id, {
      ...currentStatus!,
      downloading: true,
      error: undefined
    })))

    try {
      console.log(`📄 Downloading PDF for: ${paper.title}`)
      
      const response = await fetch('/api/papers/download-pdf', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({
          paperId: paper.canonical_id,
          doi: paper.doi
        })
      })

      const result = await response.json()

      if (result.success && result.pdf_url) {
        // Update status to success
        setPdfStatus(prev => new Map(prev.set(paper.canonical_id, {
          paperId: paper.canonical_id,
          hasPdf: true,
          pdfUrl: result.pdf_url,
          doi: paper.doi,
          canDownload: false,
          downloading: false
        })))

        // Update paper in the list
        setPapers(prev => prev.map(p => 
          p.canonical_id === paper.canonical_id 
            ? { ...p, pdf_url: result.pdf_url }
            : p
        ))

        toast.success(`PDF downloaded for "${paper.title}"`)
      } else {
        throw new Error(result.error || 'Failed to download PDF')
      }

    } catch (error) {
      console.error('PDF download error:', error)
      const message = error instanceof Error ? error.message : 'Download failed'
      
      // Update status to error
      setPdfStatus(prev => new Map(prev.set(paper.canonical_id, {
        ...currentStatus!,
        downloading: false,
        error: message
      })))

      toast.error(`PDF download failed: ${message}`)
    }
  }, [pdfStatus])

  // Batch download PDFs
  const batchDownloadPDFs = useCallback(async () => {
    const downloadablePapers = papers.filter(paper => {
      const status = pdfStatus.get(paper.canonical_id)
      return status?.canDownload && paper.doi
    })

    if (downloadablePapers.length === 0) {
      toast.error('No papers available for PDF download')
      return
    }

    setBatchDownloading(true)

    try {
      console.log(`📦 Starting batch download for ${downloadablePapers.length} papers`)
      
      const response = await fetch('/api/papers/download-pdf', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({
          batch: downloadablePapers.map(paper => ({
            id: paper.canonical_id,
            doi: paper.doi
          }))
        })
      })

      const result = await response.json()
      
      if (result.success) {
        // Update PDF status based on results
        const newPdfStatus = new Map(pdfStatus)
        
        result.results.forEach(({ paperId, result: downloadResult }: { paperId: string; result: { success: boolean; pdf_url?: string; error?: string } }) => {
          if (downloadResult.success) {
            newPdfStatus.set(paperId, {
              paperId,
              hasPdf: true,
              pdfUrl: downloadResult.pdf_url,
              canDownload: false
            })
          } else {
            const current = newPdfStatus.get(paperId)
            if (current) {
              newPdfStatus.set(paperId, {
                ...current,
                error: downloadResult.error
              })
            }
          }
        })
        
        setPdfStatus(newPdfStatus)
        toast.success(result.message)
      } else {
        throw new Error(result.error || 'Batch download failed')
      }

    } catch (error) {
      console.error('Batch download error:', error)
      const message = error instanceof Error ? error.message : 'Batch download failed'
      toast.error(message)
    } finally {
      setBatchDownloading(false)
    }
  }, [papers, pdfStatus])

  // Handle paper selection
  const handlePaperSelection = useCallback((paperId: string, selected: boolean) => {
    setSelectedPaperIds(prev => {
      const newSet = new Set(prev)
      if (selected) {
        newSet.add(paperId)
      } else {
        newSet.delete(paperId)
      }
      return newSet
    })
  }, [])

  // Handle select all/none
  const handleSelectAll = useCallback(() => {
    setSelectedPaperIds(new Set(filteredPapers.map(p => p.canonical_id)))
  }, [filteredPapers])

  const handleSelectNone = useCallback(() => {
    setSelectedPaperIds(new Set())
  }, [])

  // Update parent component when selection changes
  useEffect(() => {
    const selectedPapers = papers.filter(p => selectedPaperIds.has(p.canonical_id))
    onPapersSelected(selectedPapers)
  }, [selectedPaperIds, papers, onPapersSelected])

  const downloadableCount = useMemo(() => {
    return papers.filter(paper => {
      const status = pdfStatus.get(paper.canonical_id)
      return status?.canDownload
    }).length
  }, [papers, pdfStatus])

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Search className="h-5 w-5" />
          Source Discovery & Review
          {papers.length > 0 && (
            <Badge variant="secondary" className="ml-auto">
              {selectedPaperIds.size} selected
            </Badge>
          )}
        </CardTitle>
        <CardDescription>
          Search for academic papers across multiple databases and review sources for your research.
        </CardDescription>
      </CardHeader>
      
      <CardContent className="space-y-6">
        <Tabs defaultValue="search" className="w-full">
          <TabsList>
            <TabsTrigger value="search">Search</TabsTrigger>
            <TabsTrigger value="results" disabled={papers.length === 0}>
              Results ({papers.length})
            </TabsTrigger>
          </TabsList>

          {/* Search Tab */}
          <TabsContent value="search" className="space-y-4">
            <div className="space-y-4">
              <div>
                <Label htmlFor="search-topic">Research Topic</Label>
                <div className="flex gap-2">
                  <Input
                    id="search-topic"
                    placeholder="e.g., machine learning in healthcare, climate change adaptation..."
                    value={searchTopic}
                    onChange={(e) => setSearchTopic(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && searchPapers()}
                    className="flex-1"
                  />
                  <Button 
                    onClick={searchPapers} 
                    disabled={loading || !searchTopic.trim()}
                    className="min-w-[100px]"
                  >
                    {loading ? (
                      <LoadingSpinner size="sm" text="Searching..." />
                    ) : (
                      <>
                        <Search className="h-4 w-4 mr-2" />
                        Search
                      </>
                    )}
                  </Button>
                </div>
              </div>

              {/* Search Options */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <div>
                  <Label>Max Results</Label>
                  <Select 
                    value={searchOptions.maxResults?.toString() || '25'}
                    onValueChange={(value) => setSearchOptions(prev => ({ 
                      ...prev, 
                      maxResults: parseInt(value) 
                    }))}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="10">10 papers</SelectItem>
                      <SelectItem value="25">25 papers</SelectItem>
                      <SelectItem value="50">50 papers</SelectItem>
                      <SelectItem value="100">100 papers</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label>From Year</Label>
                  <Input
                    type="number"
                    placeholder="2020"
                    value={searchOptions.fromYear || ''}
                    onChange={(e) => setSearchOptions(prev => ({ 
                      ...prev, 
                      fromYear: e.target.value ? parseInt(e.target.value) : undefined 
                    }))}
                    min="1900"
                    max={new Date().getFullYear()}
                  />
                </div>

                <div>
                  <Label>To Year</Label>
                  <Input
                    type="number"
                    placeholder="2024"
                    value={searchOptions.toYear || ''}
                    onChange={(e) => setSearchOptions(prev => ({ 
                      ...prev, 
                      toYear: e.target.value ? parseInt(e.target.value) : undefined 
                    }))}
                    min="1900"
                    max={new Date().getFullYear()}
                  />
                </div>

                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="open-access"
                    checked={searchOptions.openAccessOnly || false}
                    onCheckedChange={(checked) => setSearchOptions(prev => ({ 
                      ...prev, 
                      openAccessOnly: !!checked 
                    }))}
                  />
                  <Label htmlFor="open-access" className="text-sm">
                    Open Access Only
                  </Label>
                </div>
              </div>

              {/* Source Selection */}
              <div>
                <Label className="text-sm font-medium">Data Sources</Label>
                <div className="flex flex-wrap gap-2 mt-2">
                  {[
                    { id: 'openalex', name: 'OpenAlex', desc: '240M+ papers' },
                    { id: 'crossref', name: 'Crossref', desc: 'DOI metadata' },
                    { id: 'semantic_scholar', name: 'Semantic Scholar', desc: 'AI research' },
                    { id: 'arxiv', name: 'arXiv', desc: 'Preprints' },
                    { id: 'core', name: 'CORE', desc: 'Open access' }
                  ].map(source => (
                    <div key={source.id} className="flex items-center space-x-2">
                      <Checkbox
                        id={source.id}
                        checked={searchOptions.sources?.includes(source.id as PaperSource) || false}
                        onCheckedChange={(checked) => {
                          setSearchOptions(prev => ({
                            ...prev,
                            sources: checked 
                              ? [...(prev.sources || []), source.id as PaperSource]
                              : (prev.sources || []).filter(s => s !== source.id)
                          }))
                        }}
                      />
                      <Label htmlFor={source.id} className="text-sm">
                        {source.name}
                        <span className="text-muted-foreground ml-1">({source.desc})</span>
                      </Label>
                    </div>
                  ))}
                </div>
              </div>

              {error && (
                <div className="flex items-center gap-2 p-3 bg-red-50 text-red-700 rounded-md">
                  <AlertCircle className="h-4 w-4" />
                  <span>{error}</span>
                </div>
              )}
            </div>
          </TabsContent>

          {/* Results Tab */}
          <TabsContent value="results" className="space-y-4">
            {papers.length > 0 && (
              <>
                {/* Results Controls */}
                <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
                  <div className="flex gap-2">
                    <Button 
                      variant="outline" 
                      size="sm" 
                      onClick={handleSelectAll}
                      disabled={selectedPaperIds.size === filteredPapers.length}
                    >
                      Select All
                    </Button>
                    <Button 
                      variant="outline" 
                      size="sm" 
                      onClick={handleSelectNone}
                      disabled={selectedPaperIds.size === 0}
                    >
                      Select None
                    </Button>
                    {downloadableCount > 0 && (
                      <Button 
                        variant="outline" 
                        size="sm" 
                        onClick={batchDownloadPDFs}
                        disabled={batchDownloading}
                      >
                        {batchDownloading ? (
                          <LoadingSpinner size="sm" text="Downloading..." />
                        ) : (
                          <>
                            <Download className="h-4 w-4 mr-2" />
                            Download PDFs ({downloadableCount})
                          </>
                        )}
                      </Button>
                    )}
                  </div>

                  <div className="flex gap-2 items-center">
                    <Input
                      placeholder="Filter results..."
                      value={resultsFilter}
                      onChange={(e) => setResultsFilter(e.target.value)}
                      className="w-48"
                    />
                    <Select value={sortBy} onValueChange={(value: 'relevance' | 'citations' | 'year' | 'title') => setSortBy(value)}>
                      <SelectTrigger className="w-32">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="relevance">Relevance</SelectItem>
                        <SelectItem value="citations">Citations</SelectItem>
                        <SelectItem value="year">Year</SelectItem>
                        <SelectItem value="title">Title</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {/* Paper List */}
                <ScrollArea className="h-[600px]">
                  <div className="space-y-4">
                    {filteredPapers.map((paper, index) => {
                      const isSelected = selectedPaperIds.has(paper.canonical_id)
                      const pdfInfo = pdfStatus.get(paper.canonical_id)
                      
                      return (
                        <Card key={paper.canonical_id} className={`transition-colors ${
                          isSelected ? 'ring-2 ring-blue-500 bg-blue-50' : ''
                        }`}>
                          <CardContent className="p-4">
                            <div className="flex items-start gap-3">
                              <Checkbox
                                checked={isSelected}
                                onCheckedChange={(checked) => 
                                  handlePaperSelection(paper.canonical_id, !!checked)
                                }
                                className="mt-1"
                              />
                              
                              <div className="flex-1 min-w-0">
                                <div className="flex items-start justify-between gap-2">
                                  <h3 className="font-medium text-sm leading-5 line-clamp-2">
                                    {paper.title}
                                  </h3>
                                  <div className="flex items-center gap-1 shrink-0">
                                    <Badge variant="outline" className="text-xs">
                                      {paper.source}
                                    </Badge>
                                    <Badge variant="secondary" className="text-xs">
                                      Rank #{index + 1}
                                    </Badge>
                                  </div>
                                </div>

                                <p className="text-xs text-muted-foreground mt-2 line-clamp-2">
                                  {paper.abstract}
                                </p>

                                <div className="flex flex-wrap items-center gap-4 mt-3 text-xs text-muted-foreground">
                                  <div className="flex items-center gap-1">
                                    <Users className="h-3 w-3" />
                                    {formatAuthors(paper.authors)}
                                  </div>
                                  <div className="flex items-center gap-1">
                                    <Calendar className="h-3 w-3" />
                                    {formatDate(paper.year)}
                                  </div>
                                  {paper.venue && (
                                    <div className="flex items-center gap-1">
                                      <BookOpen className="h-3 w-3" />
                                      {paper.venue}
                                    </div>
                                  )}
                                  <div className="flex items-center gap-1">
                                    <Globe className="h-3 w-3" />
                                    {paper.citationCount} citations
                                  </div>
                                </div>

                                <div className="flex items-center justify-between mt-3">
                                  <div className="flex items-center gap-2">
                                    <Badge variant="outline" className="text-xs">
                                      Score: {paper.combinedScore.toFixed(2)}
                                    </Badge>
                                    {paper.doi && (
                                      <Badge variant="outline" className="text-xs">
                                        DOI: {paper.doi.slice(0, 20)}...
                                      </Badge>
                                    )}
                                  </div>

                                  <div className="flex items-center gap-1">
                                    {paper.url && (
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        asChild
                                      >
                                        <a 
                                          href={paper.url} 
                                          target="_blank" 
                                          rel="noopener noreferrer"
                                          className="h-8 w-8 p-0"
                                        >
                                          <ExternalLink className="h-3 w-3" />
                                        </a>
                                      </Button>
                                    )}

                                    {/* PDF Status and Download */}
                                    {pdfInfo?.hasPdf ? (
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        asChild
                                      >
                                        <a 
                                          href={pdfInfo.pdfUrl} 
                                          target="_blank" 
                                          rel="noopener noreferrer"
                                          className="h-8 w-8 p-0"
                                        >
                                          <FileText className="h-3 w-3 text-green-600" />
                                        </a>
                                      </Button>
                                    ) : pdfInfo?.canDownload ? (
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => downloadPDF(paper)}
                                        disabled={pdfInfo.downloading}
                                        className="h-8 w-8 p-0"
                                      >
                                        {pdfInfo.downloading ? (
                                          <LoadingSpinner size="sm" className="h-3 w-3" />
                                        ) : (
                                          <Download className="h-3 w-3" />
                                        )}
                                      </Button>
                                    ) : null}
                                  </div>
                                </div>

                                {pdfInfo?.error && (
                                  <div className="text-xs text-red-600 mt-2">
                                    PDF Error: {pdfInfo.error}
                                  </div>
                                )}
                              </div>
                            </div>
                          </CardContent>
                        </Card>
                      )
                    })}
                  </div>
                </ScrollArea>

                <div className="text-sm text-muted-foreground text-center">
                  Showing {filteredPapers.length} of {papers.length} papers
                  {selectedPaperIds.size > 0 && (
                    <span className="ml-2">• {selectedPaperIds.size} selected</span>
                  )}
                </div>
              </>
            )}
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  )
} 
```

### `components/FileUpload.tsx`

```tsx
'use client'

import { useState, useCallback, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Separator } from '@/components/ui/separator'
import { 
  Upload, 
  FileText, 
  X, 
  CheckCircle, 
  AlertCircle,
  FilePlus
} from 'lucide-react'
import { LoadingSpinner } from '@/components/ui/loading-spinner'

interface UploadedFile {
  file: File
  id: string
  status: 'pending' | 'uploading' | 'processing' | 'success' | 'error'
  progress: number
  error?: string
  extractedData?: {
    title?: string
    authors?: string[]
    abstract?: string
    venue?: string
    doi?: string
    year?: string
  }
}

interface UploadedPaperWithData extends UploadedFile {
  extractedData: NonNullable<UploadedFile['extractedData']>
}

interface FileUploadProps {
  onUploadComplete?: (papers: Array<UploadedPaperWithData['extractedData']>) => void
  className?: string
}

export default function FileUpload({ onUploadComplete, className }: FileUploadProps) {
  const [files, setFiles] = useState<UploadedFile[]>([])
  const [isDragOver, setIsDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [globalProgress, setGlobalProgress] = useState(0)

  const generateId = () => Math.random().toString(36).substr(2, 9)

  const addFiles = useCallback((newFiles: File[]) => {
    const uploadedFiles: UploadedFile[] = newFiles.map(file => ({
      file,
      id: generateId(),
      status: 'pending',
      progress: 0
    }))
    
    setFiles(prev => [...prev, ...uploadedFiles])
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)
    
    const droppedFiles = Array.from(e.dataTransfer.files)
    const pdfFiles = droppedFiles.filter(file => 
      file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
    )
    
    if (pdfFiles.length > 0) {
      addFiles(pdfFiles)
    }
  }, [addFiles])

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = e.target.files
    if (selectedFiles) {
      const pdfFiles = Array.from(selectedFiles).filter(file => 
        file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
      )
      if (pdfFiles.length > 0) {
        addFiles(pdfFiles)
      }
    }
  }, [addFiles])

  const removeFile = useCallback((fileId: string) => {
    setFiles(prev => prev.filter(f => f.id !== fileId))
  }, [])

  const processFile = async (uploadedFile: UploadedFile): Promise<void> => {
    const { file, id } = uploadedFile
    
    try {
      // Update status to uploading
      setFiles(prev => prev.map(f => 
        f.id === id ? { ...f, status: 'uploading', progress: 10 } : f
      ))

      // Create FormData for file upload
      const formData = new FormData()
      formData.append('file', file)
      formData.append('fileName', file.name)

      // Upload and process the file
      const response = await fetch('/api/library/upload', {
        method: 'POST',
        body: formData,
        credentials: 'include'
      })

      if (!response.ok) {
        throw new Error(`Upload failed: ${response.statusText}`)
      }

      // Update progress during processing
      setFiles(prev => prev.map(f => 
        f.id === id ? { ...f, status: 'processing', progress: 50 } : f
      ))

      const result = await response.json()

      // Update with success
      setFiles(prev => prev.map(f => 
        f.id === id ? { 
          ...f, 
          status: 'success', 
          progress: 100,
          extractedData: result.extractedData 
        } : f
      ))

    } catch (error) {
      console.error('File processing error:', error)
      setFiles(prev => prev.map(f => 
        f.id === id ? { 
          ...f, 
          status: 'error', 
          progress: 0,
          error: error instanceof Error ? error.message : 'Upload failed'
        } : f
      ))
    }
  }

  const handleUploadAll = async () => {
    const pendingFiles = files.filter(f => f.status === 'pending')
    
    if (pendingFiles.length === 0) return

    // Process files sequentially to avoid overwhelming the server
    for (const file of pendingFiles) {
      await processFile(file)
    }

    // Calculate global progress
    const totalFiles = files.length
    const completedFiles = files.filter(f => f.status === 'success').length
    setGlobalProgress((completedFiles / totalFiles) * 100)

    // Notify parent of successful uploads
    const successfulUploads = files.filter((f): f is UploadedPaperWithData => f.status === 'success' && f.extractedData !== undefined)
    if (successfulUploads.length > 0 && onUploadComplete) {
      onUploadComplete(successfulUploads.map(f => f.extractedData))
    }
  }

  const clearCompleted = () => {
    setFiles(prev => prev.filter(f => f.status !== 'success'))
    setGlobalProgress(0)
  }

  const getStatusIcon = (status: UploadedFile['status']) => {
    switch (status) {
      case 'pending':
        return <FileText className="h-4 w-4 text-muted-foreground" />
      case 'uploading':
      case 'processing':
        return <LoadingSpinner size="sm" className="h-4 w-4 text-blue-500" />
      case 'success':
        return <CheckCircle className="h-4 w-4 text-green-500" />
      case 'error':
        return <AlertCircle className="h-4 w-4 text-red-500" />
    }
  }

  const getStatusColor = (status: UploadedFile['status']) => {
    switch (status) {
      case 'pending':
        return 'border-muted'
      case 'uploading':
      case 'processing':
        return 'border-blue-200 bg-blue-50'
      case 'success':
        return 'border-green-200 bg-green-50'
      case 'error':
        return 'border-red-200 bg-red-50'
    }
  }

  const pendingFiles = files.filter(f => f.status === 'pending')
  const processingFiles = files.filter(f => f.status === 'uploading' || f.status === 'processing')
  const completedFiles = files.filter(f => f.status === 'success' || f.status === 'error')

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Upload className="h-5 w-5" />
          Upload Papers
        </CardTitle>
        <CardDescription>
          Upload PDF papers from your local system to add them to your library
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Drop Zone */}
        <div
          className={`
            border-2 border-dashed rounded-lg p-8 text-center transition-colors cursor-pointer
            ${isDragOver ? 'border-primary bg-primary/5' : 'border-muted-foreground/25 hover:border-primary/50'}
          `}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
        >
          <FilePlus className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
          <h3 className="text-lg font-medium mb-2">Drop PDF files here</h3>
          <p className="text-sm text-muted-foreground mb-4">
            Or click to browse your computer
          </p>
          <Button variant="outline">
            Select Files
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,application/pdf"
            multiple
            className="hidden"
            onChange={handleFileSelect}
          />
        </div>

        {/* File List */}
        {files.length > 0 && (
          <div className="space-y-4">
            <Separator />
            
            <div className="flex items-center justify-between">
              <h3 className="font-medium">
                Selected Files ({files.length})
              </h3>
              <div className="flex gap-2">
                {pendingFiles.length > 0 && (
                  <Button 
                    onClick={handleUploadAll}
                    disabled={processingFiles.length > 0}
                    size="sm"
                  >
                    {processingFiles.length > 0 ? (
                      <LoadingSpinner size="sm" text="Processing..." />
                    ) : (
                      <>
                        <Upload className="h-4 w-4 mr-2" />
                        Upload All
                      </>
                    )}
                  </Button>
                )}
                {completedFiles.length > 0 && (
                  <Button variant="outline" size="sm" onClick={clearCompleted}>
                    Clear Completed
                  </Button>
                )}
              </div>
            </div>

            {/* Global Progress */}
            {processingFiles.length > 0 && (
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span>Overall Progress</span>
                  <span>{Math.round(globalProgress)}%</span>
                </div>
                <Progress value={globalProgress} />
              </div>
            )}

            {/* Individual Files */}
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {files.map((uploadedFile) => (
                <div
                  key={uploadedFile.id}
                  className={`p-3 border rounded-lg ${getStatusColor(uploadedFile.status)}`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      {getStatusIcon(uploadedFile.status)}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">
                          {uploadedFile.file.name}
                        </p>
                        <div className="flex items-center gap-4 text-xs text-muted-foreground">
                          <span>{(uploadedFile.file.size / 1024 / 1024).toFixed(1)} MB</span>
                          <Badge variant="secondary">
                            {uploadedFile.status}
                          </Badge>
                        </div>
                      </div>
                    </div>
                    
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => removeFile(uploadedFile.id)}
                      disabled={uploadedFile.status === 'uploading' || uploadedFile.status === 'processing'}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>

                  {/* Progress Bar */}
                  {(uploadedFile.status === 'uploading' || uploadedFile.status === 'processing') && (
                    <div className="mt-2">
                      <Progress value={uploadedFile.progress} className="h-2" />
                    </div>
                  )}

                  {/* Error Message */}
                  {uploadedFile.status === 'error' && uploadedFile.error && (
                    <div className="mt-2 text-xs text-red-600">
                      {uploadedFile.error}
                    </div>
                  )}

                  {/* Extracted Data Preview */}
                  {uploadedFile.status === 'success' && uploadedFile.extractedData && (
                    <div className="mt-2 text-xs text-green-700">
                      <p><strong>Title:</strong> {uploadedFile.extractedData.title || 'Not detected'}</p>
                      {uploadedFile.extractedData.authors && (
                        <p><strong>Authors:</strong> {uploadedFile.extractedData.authors.join(', ')}</p>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
} 
```

### `components/GeneratePageClient.tsx`

```tsx
"use client"

import PaperGenerator from '@/components/PaperGenerator'

export default function GeneratePageClient() {
  return (
    <PaperGenerator />
  )
} 
```

### `components/HistoryManager.tsx`

```tsx
'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { 
  History, 
  Search, 
  Eye, 
  Trash2, 
  MoreVertical,
  Calendar,
  FileText,
  Quote,
  Download,
  Share2,
  SortAsc,
  SortDesc,
  Plus,
} from 'lucide-react'
import { LoadingSpinner } from '@/components/ui/loading-spinner'
import { format } from 'date-fns'
import type { ResearchProjectWithLatestVersion } from '@/types/simplified'

interface HistoryManagerProps {
  className?: string
}

export default function HistoryManager({ className }: HistoryManagerProps) {
  const router = useRouter()
  
  const [projects, setProjects] = useState<ResearchProjectWithLatestVersion[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  
  // Filters and search
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [sortBy, setSortBy] = useState<'created_at' | 'topic' | 'status'>('created_at')
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc')
  
  // UI state
  const [selectedProject, setSelectedProject] = useState<ResearchProjectWithLatestVersion | null>(null)
  const [deletingProject, setDeletingProject] = useState<string | null>(null)

  useEffect(() => {
    loadProjects()
  }, [])

  const loadProjects = async () => {
    setLoading(true)
    try {
      const response = await fetch('/api/projects', { credentials: 'include' })
      if (response.ok) {
        const data = await response.json()
        setProjects(data.projects || [])
      } else {
        console.error('Failed to load projects:', response.status)
        setError('Failed to load projects')
      }
    } catch (error) {
      console.error('Error loading projects:', error)
      setError('Failed to load projects')
    } finally {
      setLoading(false)
    }
  }

  const deleteProject = async (projectId: string) => {
    try {
      setDeletingProject(projectId)
      const response = await fetch(`/api/projects?projectId=${projectId}`, {
        method: 'DELETE',
        credentials: 'include'
      })
      
      if (response.ok) {
        setProjects(prev => prev.filter(p => p.id !== projectId))
      } else {
        console.error('Failed to delete project')
      }
    } catch (error) {
      console.error('Error deleting project:', error)
    } finally {
      setDeletingProject(null)
    }
  }

  const viewProject = (projectId: string) => {
    router.push(`/projects/${projectId}`)
  }

  const downloadProject = async (project: ResearchProjectWithLatestVersion) => {
    if (!project.latest_version?.content) return

    const blob = new Blob([project.latest_version.content], { type: 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${project.topic.replace(/[^a-zA-Z0-9]/g, '_')}.md`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  const shareProject = async (project: ResearchProjectWithLatestVersion) => {
    const shareData = {
      title: project.topic,
      text: `Research paper: ${project.topic}`,
      url: `${window.location.origin}/projects/${project.id}`
    }

    if (navigator.share) {
      try {
        await navigator.share(shareData)
      } catch {
        // Fall back to copying URL
        navigator.clipboard.writeText(shareData.url)
      }
    } else {
      navigator.clipboard.writeText(shareData.url)
    }
  }

  // Filter and sort projects
  const filteredProjects = projects
    .filter(project => {
      const matchesSearch = searchQuery === '' || 
        project.topic.toLowerCase().includes(searchQuery.toLowerCase())
      
      const matchesStatus = statusFilter === 'all' || project.status === statusFilter
      
      return matchesSearch && matchesStatus
    })
    .sort((a, b) => {
      let comparison = 0
      
      switch (sortBy) {
        case 'topic':
          comparison = a.topic.localeCompare(b.topic)
          break
        case 'status':
          comparison = a.status.localeCompare(b.status)
          break
        case 'created_at':
        default:
          comparison = new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
          break
      }
      
      return sortOrder === 'desc' ? -comparison : comparison
    })

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'complete':
        return 'default'
      case 'generating':
        return 'secondary'
      case 'failed':
        return 'destructive'
      default:
        return 'outline'
    }
  }

  const ProjectCard = ({ project }: { project: ResearchProjectWithLatestVersion }) => (
    <Card className="hover:shadow-md transition-shadow">
      <CardContent className="pt-6">
        <div className="space-y-4">
          <div className="flex items-start justify-between">
            <div className="flex-1 space-y-2">
              <h3 className="font-medium text-lg leading-tight line-clamp-2">
                {project.topic}
              </h3>
              <div className="flex items-center gap-4 text-sm text-muted-foreground">
                <span className="flex items-center gap-1">
                  <Calendar className="h-4 w-4" />
                  {format(new Date(project.created_at), 'PP')}
                </span>
                {project.latest_version?.word_count && (
                  <span className="flex items-center gap-1">
                    <FileText className="h-4 w-4" />
                    {project.latest_version.word_count} words
                  </span>
                )}
                {project.citation_count && (
                  <span className="flex items-center gap-1">
                    <Quote className="h-4 w-4" />
                    {project.citation_count} citations
                  </span>
                )}
              </div>
            </div>
            
            <div className="flex items-center gap-2">
              <Badge variant={getStatusColor(project.status)}>
                {project.status}
              </Badge>
              
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm">
                    <MoreVertical className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => viewProject(project.id)}>
                    <Eye className="h-4 w-4 mr-2" />
                    View Paper
                  </DropdownMenuItem>
                  {project.status === 'complete' && project.latest_version?.content && (
                    <>
                      <DropdownMenuItem onClick={() => downloadProject(project)}>
                        <Download className="h-4 w-4 mr-2" />
                        Download
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => shareProject(project)}>
                        <Share2 className="h-4 w-4 mr-2" />
                        Share
                      </DropdownMenuItem>
                    </>
                  )}
                  <DropdownMenuItem 
                    onClick={() => deleteProject(project.id)}
                    className="text-red-600"
                    disabled={deletingProject === project.id}
                  >
                    {deletingProject === project.id ? (
                      <LoadingSpinner size="sm" text="Delete" />
                    ) : (
                      <>
                        <Trash2 className="h-4 w-4 mr-2" />
                        Delete
                      </>
                    )}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>

          {project.status === 'complete' && project.completed_at && (
            <div className="text-xs text-muted-foreground">
              Completed {format(new Date(project.completed_at), 'PPp')}
            </div>
          )}

          {project.status === 'generating' && (
            <div className="flex items-center gap-2 text-sm text-blue-600">
              <LoadingSpinner size="sm" text="Paper generation in progress..." />
            </div>
          )}

          {project.status === 'failed' && (
            <div className="text-sm text-red-600">
              Generation failed. You can try again with a new paper.
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )

  if (loading) {
    return (
      <div className={`max-w-6xl mx-auto p-6 space-y-6 ${className}`}>
        <div className="flex items-center justify-center py-12">
          <LoadingSpinner text="Loading project history..." />
        </div>
      </div>
    )
  }

  return (
    <div className={`max-w-6xl mx-auto p-6 space-y-6 ${className}`}>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <History className="h-8 w-8" />
            Project History
          </h1>
          <p className="text-muted-foreground">
            View and manage your research paper generation history
          </p>
        </div>
        
        <Button onClick={() => router.push('/generate')}>
          <Plus className="h-4 w-4 mr-2" />
          Generate New Paper
        </Button>
      </div>

      {/* Filters and Search */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center gap-4 flex-wrap">
            <div className="relative flex-1 min-w-64">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search projects..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>
            
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="complete">Complete</SelectItem>
                <SelectItem value="generating">Generating</SelectItem>
                <SelectItem value="failed">Failed</SelectItem>
              </SelectContent>
            </Select>
            
            <Select value={sortBy} onValueChange={(value: 'created_at' | 'topic' | 'status') => setSortBy(value)}>
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="created_at">Date Created</SelectItem>
                <SelectItem value="topic">Topic</SelectItem>
                <SelectItem value="status">Status</SelectItem>
              </SelectContent>
            </Select>
            
            <Button 
              variant="outline" 
              size="sm"
              onClick={() => setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')}
            >
              {sortOrder === 'asc' ? (
                <SortAsc className="h-4 w-4" />
              ) : (
                <SortDesc className="h-4 w-4" />
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Projects List */}
      {error ? (
        <Card>
          <CardContent className="pt-6 text-center">
            <p className="text-red-600">Failed to load projects: {error}</p>
            <Button variant="outline" onClick={loadProjects} className="mt-4">
              Try Again
            </Button>
          </CardContent>
        </Card>
      ) : filteredProjects.length === 0 ? (
        <Card>
          <CardContent className="pt-6 text-center py-12">
            <History className="h-12 w-12 mx-auto mb-4 text-muted-foreground opacity-50" />
            <h3 className="text-lg font-medium mb-2">
              {searchQuery || statusFilter !== 'all' ? 'No projects found' : 'No projects yet'}
            </h3>
            <p className="text-muted-foreground mb-4">
              {searchQuery || statusFilter !== 'all' 
                ? 'Try adjusting your search or filters'
                : 'Start by generating your first research paper'
              }
            </p>
            {!searchQuery && statusFilter === 'all' && (
              <Button onClick={() => router.push('/generate')}>
                <Plus className="h-4 w-4 mr-2" />
                Generate Your First Paper
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {filteredProjects.map(project => (
            <ProjectCard key={project.id} project={project} />
          ))}
        </div>
      )}

      {/* Project Details Dialog */}
      {selectedProject && (
        <Dialog open={!!selectedProject} onOpenChange={() => setSelectedProject(null)}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>{selectedProject.topic}</DialogTitle>
              <DialogDescription>
                Project created on {format(new Date(selectedProject.created_at), 'PPP')}
              </DialogDescription>
            </DialogHeader>
            
            <div className="space-y-4">
              <div className="flex items-center gap-4">
                <Badge variant={getStatusColor(selectedProject.status)}>
                  {selectedProject.status}
                </Badge>
                {selectedProject.latest_version?.word_count && (
                  <span className="text-sm text-muted-foreground">
                    {selectedProject.latest_version.word_count} words
                  </span>
                )}
              </div>
              
              <div className="flex gap-2">
                <Button onClick={() => viewProject(selectedProject.id)}>
                  <Eye className="h-4 w-4 mr-2" />
                  View Paper
                </Button>
                {selectedProject.status === 'complete' && (
                  <>
                    <Button variant="outline" onClick={() => downloadProject(selectedProject)}>
                      <Download className="h-4 w-4 mr-2" />
                      Download
                    </Button>
                    <Button variant="outline" onClick={() => shareProject(selectedProject)}>
                      <Share2 className="h-4 w-4 mr-2" />
                      Share
                    </Button>
                  </>
                )}
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
} 
```

### `components/LibraryManager.tsx`

```tsx
'use client'

import { useState, useEffect, useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'

import { 
  BookOpen, 
  Search, 
  Plus, 
  SortAsc,
  SortDesc,
  MoreVertical,
  ExternalLink,
  Trash2,
  Edit3,
  Quote,
  FolderPlus,
  Folder,

  X,
  Check,
  Upload,
  Settings,
  Star
} from 'lucide-react'
import { format } from 'date-fns'
import type { 
  LibraryPaper, 
  LibraryCollection, 
  Paper,
  LibraryFilters,
  PaperWithAuthors,
  PaperSources,
  PaperSource
} from '@/types/simplified'
import FileUpload from '@/components/FileUpload'
import React from 'react'
import { LoadingSpinner } from '@/components/ui/loading-spinner'

interface LibraryManagerProps {
  className?: string
}

export default function LibraryManager({ className }: LibraryManagerProps) {
  // Library state
  const [libraryPapers, setLibraryPapers] = useState<LibraryPaper[]>([])
  const [collections, setCollections] = useState<LibraryCollection[]>([])
  const [loading, setLoading] = useState(true)
  const [error,setError] = useState<string | null>(null)

  // Search and filters
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<Paper[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const [processingPapers, setProcessingPapers] = useState<Set<string>>(new Set())
  const [filters, setFilters] = useState<LibraryFilters>({
    sortBy: 'added_at',
    sortOrder: 'desc'
  })
  
  // Advanced search options
  const [searchOptions, setSearchOptions] = useState({
    sources: ['openalex', 'crossref', 'semantic_scholar'] as PaperSources,
    maxResults: 25,
    includePreprints: true,
    fromYear: undefined as number | undefined,
    toYear: undefined as number | undefined,
    openAccessOnly: false
  })
  const [showAdvancedOptions, setShowAdvancedOptions] = useState(false)
  // UI state
  //  const [selectedPapers, setSelectedPapers] = useState<Set<string>>(new Set())
  const [showAddDialog, setShowAddDialog] = useState(false)
  const [showCollectionDialog, setShowCollectionDialog] = useState(false)
  const [editingNotes, setEditingNotes] = useState<string | null>(null)
  const [notesText, setNotesText] = useState('')
  const [removingPapers, setRemovingPapers] = useState<Set<string>>(new Set())

  // Collection creation
  const [newCollectionName, setNewCollectionName] = useState('')
  const [newCollectionDescription, setNewCollectionDescription] = useState('')

  useEffect(() => {
    loadLibraryData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters])

  const loadLibraryData = async () => {
    try {
      setLoading(true)
      setError(null)

      const params = new URLSearchParams()
      if (filters.search) params.set('search', filters.search)
      if (filters.collectionId) params.set('collection', filters.collectionId)
      if (filters.source) params.set('source', filters.source)
      if (filters.sortBy) params.set('sortBy', filters.sortBy)
      if (filters.sortOrder) params.set('sortOrder', filters.sortOrder)
      
      // Add timestamp for cache busting
      params.set('_t', Date.now().toString())

      const [libraryResponse, collectionsResponse] = await Promise.all([
        fetch(`/api/library?${params.toString()}`, { 
          credentials: 'include',
          cache: 'no-store' // Prevent browser caching
        }),
        fetch(`/api/collections?_t=${Date.now()}`, { 
          credentials: 'include',
          cache: 'no-store' // Prevent browser caching
        })
      ])

      if (libraryResponse.ok) {
        const { papers } = await libraryResponse.json()
        setLibraryPapers(papers)
      }

      if (collectionsResponse.ok) {
        const { collections } = await collectionsResponse.json()
        setCollections(collections)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load library')
    } finally {
      setLoading(false)
    }
  }
  console.log(error)
  const searchOnlinePapers = async (query: string) => {
    if (!query.trim()) return

    try {
      setIsSearching(true)
      
      // Use lightweight library search for fast UX
      const response = await fetch('/api/library-search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          query: query,
          options: {
            maxResults: searchOptions.maxResults,
            sources: searchOptions.sources,
            includePreprints: searchOptions.includePreprints,
            fromYear: searchOptions.fromYear,
            toYear: searchOptions.toYear,
            openAccessOnly: searchOptions.openAccessOnly
          }
        })
      })
      
      if (response.ok) {
        const data = await response.json()
        if (data.success) {
          // Transform the results to match Paper interface
          const transformedPapers: PaperWithAuthors[] = data.papers.map((paper: PaperWithAuthors) => ({
            id: paper.id,
            title: paper.title,
            abstract: paper.abstract,
            publication_date: paper.publication_date ? `${paper.publication_date}-01-01` : null,
            venue: paper.venue,
            doi: paper.doi,
            url: paper.url,
            pdf_url: null,
            metadata: {
              citation_count: paper.citation_count,
              impact_score: paper.impact_score,
              source: paper.source
            },
            source: paper.source,
            citation_count: paper.citation_count || 0,
            impact_score: Math.max(paper.impact_score || 0, 0),
            created_at: new Date().toISOString(),
            authors: [],
            author_names: []
          }))
          
          setSearchResults(transformedPapers)
          console.log(`📚 Library search found ${transformedPapers.length} papers from sources: ${searchOptions.sources.join(', ')}`)
        } else {
          console.error('Library search failed:', data.error)
          setSearchResults([])
        }
      } else {
        console.error('Library search request failed:', response.status)
        setSearchResults([])
      }
    } catch (err) {
      console.error('Library search error:', err)
      setSearchResults([])
    } finally {
      setIsSearching(false)
    }
  }

  const addPaperToLibrary = async (paperId: string, notes?: string) => {
    try {
      // Show processing status
      setProcessingPapers(prev => new Set(prev).add(paperId))
      
      // First, check if the paper exists in database, if not, ingest it lightly
      const searchResult = searchResults.find(p => p.id === paperId)
      if (searchResult) {
        // Convert search result to PaperDTO for lightweight ingestion
        const paperDTO = {
          title: searchResult.title,
          abstract: searchResult.abstract || undefined,
          publication_date: searchResult.publication_date || undefined,
          venue: searchResult.venue || undefined,
          doi: searchResult.doi || undefined,
          url: searchResult.url || undefined,
          pdf_url: searchResult.pdf_url || undefined,
          metadata: {
            ...searchResult.metadata,
            added_via: 'library_search'
          },
          source: searchResult.source || 'library_search',
          citation_count: searchResult.citation_count || 0,
          impact_score: searchResult.impact_score || 0,
          authors: searchResult.authors?.map(a => a.name || a) || []
        }

        // Ingest paper without chunks using the library ingestion API
        const ingestResponse = await fetch('/api/papers/ingest-lightweight', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ paper: paperDTO })
        })

        if (!ingestResponse.ok) {
          console.warn('Failed to ingest paper, but continuing with library addition')
        } else {
          const { paperId: actualPaperId } = await ingestResponse.json()
          console.log(`📚 Paper ingested without chunks: ${actualPaperId}`)
          
          // If paper has PDF URL, queue it for background processing
          if (searchResult.pdf_url) {
            console.log(`📄 Queueing PDF processing for: ${searchResult.title}`)
            try {
              const pdfResponse = await fetch('/api/pdf-queue', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({
                  paperId: actualPaperId,
                  pdfUrl: searchResult.pdf_url,
                  title: searchResult.title,
                  priority: 'normal'
                })
              })
              
              if (pdfResponse.ok) {
                const { jobId } = await pdfResponse.json()
                console.log(`✅ PDF processing queued: ${jobId}`)
              } else {
                console.warn(`⚠️ PDF processing queue failed: ${pdfResponse.status}`)
              }
            } catch (pdfError) {
              console.warn(`⚠️ PDF processing queue failed, but paper still added to library:`, pdfError)
            }
          }
        }
      }

      // Add to user's library
      const response = await fetch('/api/library', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ paperId, notes })
      })

      if (response.ok) {
        await loadLibraryData()
        setSearchResults(prev => prev.filter(p => p.id !== paperId))
        console.log(`📚 Paper added to library: ${paperId}`)
      } else {
        const errorData = await response.json()
        
        // Handle duplicate entries gracefully
        if (response.status === 409 && errorData.code === 'DUPLICATE_ENTRY') {
          // Remove from search results without showing error
          setSearchResults(prev => prev.filter(p => p.id !== paperId))
          console.log(`📚 Paper already in library: ${paperId}`)
          return // Don't throw error for duplicates
        }
        
        console.error('Failed to add paper to library:', errorData.error)
        throw new Error(errorData.error || 'Failed to add to library')
      }
    } catch (err) {
      console.error('Error adding paper to library:', err)
      // Show error feedback to user
      alert(`Failed to add paper to library: ${err instanceof Error ? err.message : 'Unknown error'}`)
    } finally {
      // Clear processing status
      setProcessingPapers(prev => {
        const newSet = new Set(prev)
        newSet.delete(paperId)
        return newSet
      })
    }
  }

  const removePaperFromLibrary = async (paperId: string) => {
    try {
      console.log(`🗑️ Attempting to remove paper: ${paperId}`)
      
      // Add to removing state
      setRemovingPapers(prev => new Set(prev).add(paperId))
      
      const response = await fetch(`/api/library?paperId=${paperId}`, {
        method: 'DELETE',
        credentials: 'include'
      })

      console.log(`📡 DELETE response status: ${response.status}`)

      if (response.ok) {
        console.log(`✅ Successfully removed paper: ${paperId}`)
        
        // Optimistically update UI first
        setLibraryPapers(prev => prev.filter(p => p.paper.id !== paperId))
        
        // Then reload data to ensure consistency with server
        await loadLibraryData()
        
        // Optional: Show success toast
        // toast.success('Paper removed from library')
      } else {
        // Handle specific error cases
        const errorData = await response.text()
        console.error(`❌ Failed to remove paper: ${response.status} - ${errorData}`)
        
        if (response.status === 401) {
          console.error('Authentication required - user may need to log in again')
          // Optional: Show auth error toast
          // toast.error('Please log in again to remove papers')
        } else if (response.status === 404) {
          console.error('Paper not found in library')
          // Paper might already be removed, so update UI and reload data
          setLibraryPapers(prev => prev.filter(p => p.paper.id !== paperId))
          await loadLibraryData()
        } else {
          console.error('Unknown error removing paper')
          // Reload data to ensure UI reflects server state
          await loadLibraryData()
          // Optional: Show generic error toast  
          // toast.error('Failed to remove paper from library')
        }
      }
    } catch (err) {
      console.error('Network error removing paper:', err)
      // Reload data on network error to ensure consistency
      await loadLibraryData()
      // Optional: Show network error toast
      // toast.error('Network error - please try again')
    } finally {
      // Remove from removing state
      setRemovingPapers(prev => {
        const newSet = new Set(prev)
        newSet.delete(paperId)
        return newSet
      })
    }
  }

  const updatePaperNotes = async (libraryPaperId: string, notes: string) => {
    try {
      const response = await fetch(`/api/library?id=${libraryPaperId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ notes })
      })

      if (response.ok) {
        setLibraryPapers(prev => prev.map(paper => 
          paper.id === libraryPaperId 
            ? { ...paper, notes }
            : paper
        ))
      }
    } catch (err) {
      console.error('Error updating notes:', err)
    }
  }

  const createCollection = async () => {
    if (!newCollectionName.trim()) return

    try {
      const response = await fetch('/api/collections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          name: newCollectionName.trim(),
          description: newCollectionDescription.trim() || undefined
        })
      })

      if (response.ok) {
        setShowCollectionDialog(false)
        setNewCollectionName('')
        setNewCollectionDescription('')
        // Reload to get updated collections
        await loadLibraryData()
      }
    } catch (err) {
      console.error('Error creating collection:', err)
    }
  }
  const handleUploadComplete = async () => {
    // Refresh library data to show newly uploaded papers
    await loadLibraryData()
  }

  const filteredLibraryPapers = useMemo(() => {
    return libraryPapers.filter(paper => {
      if (filters.search) {
        const search = filters.search.toLowerCase()
        return (
          paper.paper.title.toLowerCase().includes(search) ||
          paper.paper.abstract?.toLowerCase().includes(search) ||
          paper.notes?.toLowerCase().includes(search)
        )
      }
      return true
    })
  }, [libraryPapers, filters.search])

  const handleNotesEdit = (libraryPaper: LibraryPaper) => {
    setEditingNotes(libraryPaper.id)
    setNotesText(libraryPaper.notes || '')
  }

  const saveNotes = async () => {
    if (!editingNotes) return
    
    await updatePaperNotes(editingNotes, notesText)
    setEditingNotes(null)
    setNotesText('')
  }

  const cancelNotesEdit = () => {
    setEditingNotes(null)
    setNotesText('')
  }

  const PaperCard = ({ paper, isSearchResult = false }: { paper: Paper | LibraryPaper, isSearchResult?: boolean }) => {
    const actualPaper = 'paper' in paper ? paper.paper : paper
    const libraryPaper = 'paper' in paper ? paper : null
    // const isInLibrary = !isSearchResult
    const isProcessing = isSearchResult && processingPapers.has(actualPaper.id)
    const isRemoving = removingPapers.has(actualPaper.id)

    return (
      <Card className="hover:shadow-md transition-shadow">
        <CardContent className="pt-4">
          <div className="space-y-3">
            <div className="flex items-start justify-between">
              <div className="flex-1 space-y-1">
                <h3 className="font-medium text-sm leading-tight line-clamp-2">
                  {actualPaper.title}
                </h3>
                <p className="text-xs text-muted-foreground">
                  {actualPaper.authors?.map(a => typeof a === 'string' ? a : a.name).join(', ') || 'Unknown authors'}
                </p>
              </div>
              
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" disabled={isProcessing}>
                    {isProcessing ? (
                      <LoadingSpinner size="sm" className="h-4 w-4" />
                    ) : (
                      <MoreVertical className="h-4 w-4" />
                    )}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {isSearchResult ? (
                    <DropdownMenuItem 
                      onClick={() => addPaperToLibrary(actualPaper.id)}
                      disabled={isProcessing}
                    >
                      <Plus className="h-4 w-4 mr-2" />
                      {isProcessing ? 'Adding...' : 'Add to Library'}
                    </DropdownMenuItem>
                  ) : (
                    <>
                      <DropdownMenuItem onClick={() => handleNotesEdit(libraryPaper!)}>
                        <Edit3 className="h-4 w-4 mr-2" />
                        Edit Notes
                      </DropdownMenuItem>
                      <DropdownMenuItem 
                        onClick={() => removePaperFromLibrary(actualPaper.id)}
                        disabled={isRemoving}
                        className="text-red-600"
                      >
                        {isRemoving ? (
                          <LoadingSpinner size="sm" text="Remove" />
                        ) : (
                          <>
                            <Trash2 className="h-4 w-4 mr-2" />
                            Remove
                          </>
                        )}
                      </DropdownMenuItem>
                    </>
                  )}
                  {actualPaper.url && (
                    <DropdownMenuItem onClick={() => window.open(actualPaper.url, '_blank')}>
                      <ExternalLink className="h-4 w-4 mr-2" />
                      View Paper
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            {isProcessing && (
              <div className="flex items-center gap-2 p-2 bg-blue-50 rounded-lg">
                <LoadingSpinner size="sm" text="Adding to library..." className="text-blue-600" />
              </div>
            )}

            {actualPaper.abstract && (
              <p className="text-xs text-muted-foreground line-clamp-2">
                {actualPaper.abstract}
              </p>
            )}

            <div className="flex items-center gap-2 flex-wrap">
              {actualPaper.venue && (
                <Badge variant="secondary" className="text-xs">
                  {actualPaper.venue}
                </Badge>
              )}
              {actualPaper.publication_date && (
                <span className="text-xs text-muted-foreground">
                  {new Date(actualPaper.publication_date).getFullYear()}
                </span>
              )}
              {actualPaper.citation_count && (
                <span className="text-xs text-muted-foreground flex items-center gap-1">
                  <Quote className="h-3 w-3" />
                  {actualPaper.citation_count}
                </span>
              )}
              
              {/* Show additional metadata for search results */}
              {isSearchResult && actualPaper.metadata && (
                <React.Fragment>
                  {(actualPaper.metadata as { source?: string }).source && (
                    <Badge variant="outline" className="text-xs">
                      {(actualPaper.metadata as { source: string }).source}
                    </Badge>
                  )}
                  {(actualPaper.metadata as { relevanceScore?: number }).relevanceScore && (
                    <span className="text-xs text-muted-foreground flex items-center gap-1">
                      <Star className="h-3 w-3" />
                      {(actualPaper.metadata as { relevanceScore: number }).relevanceScore.toFixed(2)}
                    </span>
                  )}
                </React.Fragment>
              )}
            </div>

            {libraryPaper?.notes && editingNotes !== libraryPaper.id && (
              <div className="p-2 bg-muted rounded text-xs">
                <p className="font-medium mb-1">Notes:</p>
                <p>{libraryPaper.notes}</p>
              </div>
            )}

            {editingNotes === libraryPaper?.id && (
              <div className="space-y-2">
                <Textarea
                  placeholder="Add your notes..."
                  value={notesText}
                  onChange={(e) => setNotesText(e.target.value)}
                  rows={3}
                  className="text-xs"
                />
                <div className="flex gap-2">
                  <Button size="sm" onClick={saveNotes}>
                    <Check className="h-3 w-3 mr-1" />
                    Save
                  </Button>
                  <Button variant="outline" size="sm" onClick={cancelNotesEdit}>
                    <X className="h-3 w-3 mr-1" />
                    Cancel
                  </Button>
                </div>
              </div>
            )}

            {libraryPaper?.added_at && (
              <p className="text-xs text-muted-foreground">
                Added {format(new Date(libraryPaper.added_at), 'PP')}
              </p>
            )}
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className={`max-w-7xl mx-auto p-4 sm:p-6 space-y-4 sm:space-y-6 ${className}`}>
      {/* Header Section - Responsive */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Library</h1>
          <p className="text-muted-foreground text-sm sm:text-base">
            Manage your research papers and collections
          </p>
        </div>
        
        {/* Action Buttons - Mobile Responsive */}
        <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
          <Dialog open={showCollectionDialog} onOpenChange={setShowCollectionDialog}>
            <DialogTrigger asChild>
              <Button variant="outline" className="w-full sm:w-auto">
                <FolderPlus className="h-4 w-4 mr-2" />
                <span className="hidden sm:inline">New Collection</span>
                <span className="sm:hidden">New Collection</span>
              </Button>
            </DialogTrigger>
            <DialogContent className="mx-4 sm:mx-0 w-[calc(100vw-2rem)] sm:w-full max-w-md">
              <DialogHeader>
                <DialogTitle>Create Collection</DialogTitle>
                <DialogDescription>
                  Organize your papers into collections for better management
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="collection-name">Collection Name</Label>
                  <Input
                    id="collection-name"
                    placeholder="e.g., Machine Learning Papers"
                    value={newCollectionName}
                    onChange={(e) => setNewCollectionName(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="collection-description">Description (optional)</Label>
                  <Textarea
                    id="collection-description"
                    placeholder="Brief description of this collection..."
                    value={newCollectionDescription}
                    onChange={(e) => setNewCollectionDescription(e.target.value)}
                  />
                </div>
                <div className="flex flex-col sm:flex-row justify-end gap-2">
                  <Button variant="outline" onClick={() => setShowCollectionDialog(false)} className="w-full sm:w-auto">
                    Cancel
                  </Button>
                  <Button onClick={createCollection} disabled={!newCollectionName.trim()} className="w-full sm:w-auto">
                    Create Collection
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>

          <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
            <DialogTrigger asChild>
              <Button className="w-full sm:w-auto">
                <Plus className="h-4 w-4 mr-2" />
                Add Papers
              </Button>
            </DialogTrigger>
            <DialogContent className="mx-4 sm:mx-0 w-[calc(100vw-2rem)] sm:w-full max-w-4xl max-h-[90vh] sm:max-h-[80vh]">
              <DialogHeader>
                <DialogTitle>Search and Add Papers</DialogTitle>
                <DialogDescription>
                  Search for papers online and add them to your library
                </DialogDescription>
              </DialogHeader>
              
              <div className="space-y-4">
                {/* Search Controls - Mobile Responsive */}
                <div className="flex flex-col sm:flex-row gap-2">
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Search for research papers..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && searchOnlinePapers(searchQuery)}
                      className="pl-10"
                    />
                  </div>
                  <div className="flex gap-2">
                    <Button 
                      variant="outline"
                      onClick={() => setShowAdvancedOptions(!showAdvancedOptions)}
                      className="px-3 w-full sm:w-auto"
                    >
                      <Settings className="h-4 w-4 sm:mr-0" />
                      <span className="sm:hidden ml-2">Advanced</span>
                    </Button>
                    <Button 
                      onClick={() => searchOnlinePapers(searchQuery)}
                      disabled={isSearching || !searchQuery.trim()}
                      className="w-full sm:w-auto"
                    >
                      {isSearching ? (
                        <LoadingSpinner size="sm" className="h-4 w-4 sm:mr-0" />
                      ) : (
                        <Search className="h-4 w-4 sm:mr-0" />
                      )}
                      <span className="sm:hidden ml-2">{isSearching ? 'Searching...' : 'Search'}</span>
                    </Button>
                  </div>
                </div>

                {/* Advanced Search Options - Mobile Responsive */}
                {showAdvancedOptions && (
                  <Card className="p-3 sm:p-4 bg-muted/50">
                    <div className="space-y-4">
                      <div className="flex items-center gap-2 mb-3">
                        <Settings className="h-4 w-4" />
                        <span className="font-medium text-sm sm:text-base">Advanced Search Options</span>
                      </div>
                      
                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                        {/* Sources Selection */}
                        <div className="space-y-2">
                          <Label className="text-sm font-medium">Search Sources</Label>
                          <div className="space-y-2">
                            {[
                              { id: 'openalex', label: 'OpenAlex', desc: 'Comprehensive research database' },
                              { id: 'crossref', label: 'Crossref', desc: 'DOI registry & metadata' },
                              { id: 'semantic_scholar', label: 'Semantic Scholar', desc: 'AI-powered search' },
                              { id: 'arxiv', label: 'ArXiv', desc: 'Preprint repository' },
                              { id: 'core', label: 'CORE', desc: 'Open access repository' }
                            ].map(source => (
                              <div key={source.id} className="flex items-center space-x-2">
                                <input
                                  type="checkbox"
                                  id={source.id}
                                  checked={searchOptions.sources.includes(source.id as PaperSource)}
                                  onChange={(e) => {
                                    if (e.target.checked) {
                                      setSearchOptions(prev => ({
                                        ...prev,
                                        sources: [...prev.sources, source.id as PaperSource]
                                      }))
                                    } else {
                                      setSearchOptions(prev => ({
                                        ...prev,
                                        sources: prev.sources.filter(s => s !== source.id as PaperSource)
                                      }))
                                    }
                                  }}
                                  className="rounded border-gray-300"
                                />
                                <Label htmlFor={source.id} className="text-sm">
                                  <span className="font-medium">{source.label}</span>
                                  <span className="text-muted-foreground ml-1 hidden sm:inline">({source.desc})</span>
                                </Label>
                              </div>
                            ))}
                          </div>
                        </div>

                        {/* Filters */}
                        <div className="space-y-3">
                          <div className="space-y-2">
                            <Label className="text-sm font-medium">Max Results</Label>
                            <Select 
                              value={searchOptions.maxResults.toString()} 
                              onValueChange={(value) => setSearchOptions(prev => ({ ...prev, maxResults: parseInt(value) }))}
                            >
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="10">10 papers</SelectItem>
                                <SelectItem value="25">25 papers</SelectItem>
                                <SelectItem value="50">50 papers</SelectItem>
                                <SelectItem value="100">100 papers</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>

                          <div className="space-y-2">
                            <Label className="text-sm font-medium">Publication Year Range</Label>
                            <div className="flex gap-2">
                              <Input
                                type="number"
                                placeholder="From year"
                                value={searchOptions.fromYear || ''}
                                onChange={(e) => setSearchOptions(prev => ({ 
                                  ...prev, 
                                  fromYear: e.target.value ? parseInt(e.target.value) : undefined 
                                }))}
                                className="flex-1"
                              />
                              <span className="self-center text-muted-foreground text-sm">to</span>
                              <Input
                                type="number"
                                placeholder="To year"
                                value={searchOptions.toYear || ''}
                                onChange={(e) => setSearchOptions(prev => ({ 
                                  ...prev, 
                                  toYear: e.target.value ? parseInt(e.target.value) : undefined 
                                }))}
                                className="flex-1"
                              />
                            </div>
                          </div>

                          <div className="flex items-center space-x-2">
                            <input
                              type="checkbox"
                              id="preprints"
                              checked={searchOptions.includePreprints}
                              onChange={(e) => setSearchOptions(prev => ({ ...prev, includePreprints: e.target.checked }))}
                              className="rounded border-gray-300"
                            />
                            <Label htmlFor="preprints" className="text-sm">Include preprints</Label>
                          </div>

                          <div className="flex items-center space-x-2">
                            <input
                              type="checkbox"
                              id="openaccess"
                              checked={searchOptions.openAccessOnly}
                              onChange={(e) => setSearchOptions(prev => ({ ...prev, openAccessOnly: e.target.checked }))}
                              className="rounded border-gray-300"
                            />
                            <Label htmlFor="openaccess" className="text-sm">Open access only</Label>
                          </div>
                        </div>
                      </div>
                    </div>
                  </Card>
                )}

                {/* Search Results Summary - Mobile Responsive */}
                {searchResults.length > 0 && !isSearching && (
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 p-3 bg-muted/50 rounded-lg">
                    <div className="flex items-center gap-2">
                      <Search className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm font-medium">
                        Found {searchResults.length} papers
                      </span>
                      {searchQuery && (
                        <span className="text-sm text-muted-foreground hidden sm:inline">
                          for &quot;{searchQuery}&quot;
                        </span>
                      )}
                    </div>
                    <div className="flex gap-1 flex-wrap">
                      {searchOptions.sources.map(source => (
                        <Badge key={source} variant="outline" className="text-xs">
                          {source}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}

                {/* Search Results Grid - Mobile Responsive */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 max-h-96 overflow-y-auto">
                  {searchResults.length === 0 && !isSearching && searchQuery && (
                    <div className="col-span-full text-center py-8 text-muted-foreground">
                      <Search className="h-8 w-8 mx-auto mb-2 opacity-50" />
                      <p>No papers found for &quot;{searchQuery}&quot;</p>
                    </div>
                  )}
                  
                  {searchResults.map(paper => (
                    <PaperCard key={paper.id} paper={paper} isSearchResult />
                  ))}
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
            <div>
              <CardTitle className="flex items-center gap-2">
                <BookOpen className="h-5 w-5" />
                Your Library
              </CardTitle>
              <CardDescription>
                {libraryPapers.length} papers in your library
              </CardDescription>
            </div>
            
            {/* Search and Filter Controls - Mobile Responsive */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 w-full lg:w-auto">
              <div className="relative flex-1 lg:flex-initial">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search library..."
                  value={filters.search || ''}
                  onChange={(e) => setFilters(prev => ({ ...prev, search: e.target.value }))}
                  className="pl-10 w-full lg:w-64"
                />
              </div>
              
              <div className="flex gap-2">
                <Select 
                  value={filters.sortBy} 
                  onValueChange={(value: 'added_at' | 'title' | 'publication_date' | 'citation_count') => 
                    setFilters(prev => ({ ...prev, sortBy: value }))
                  }
                >
                  <SelectTrigger className="w-full sm:w-40">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="added_at">Date Added</SelectItem>
                    <SelectItem value="title">Title</SelectItem>
                    <SelectItem value="publication_date">Publication Date</SelectItem>
                    <SelectItem value="citation_count">Citations</SelectItem>
                  </SelectContent>
                </Select>
                
                <Button 
                  variant="outline" 
                  size="sm"
                  onClick={() => setFilters(prev => ({ 
                    ...prev, 
                    sortOrder: prev.sortOrder === 'asc' ? 'desc' : 'asc' 
                  }))}
                  className="px-3"
                >
                  {filters.sortOrder === 'asc' ? (
                    <SortAsc className="h-4 w-4" />
                  ) : (
                    <SortDesc className="h-4 w-4" />
                  )}
                </Button>
              </div>
            </div>
          </div>
        </CardHeader>
        
        <CardContent>
          <Tabs defaultValue="all" className="w-full">
            {/* Tabs List - Mobile Responsive */}
            <div className="overflow-x-auto">
              <TabsList className="w-full sm:w-auto">
                <TabsTrigger value="all" className="text-xs sm:text-sm">
                  <span className="hidden sm:inline">All Papers ({libraryPapers.length})</span>
                  <span className="sm:hidden">All ({libraryPapers.length})</span>
                </TabsTrigger>
                <TabsTrigger value="upload" className="text-xs sm:text-sm">
                  <Upload className="h-4 w-4 mr-1" />
                  <span className="hidden sm:inline">Upload</span>
                </TabsTrigger>
                {collections.map(collection => (
                  <TabsTrigger key={collection.id} value={collection.id} className="text-xs sm:text-sm">
                    <Folder className="h-4 w-4 mr-1" />
                    <span className="hidden sm:inline">{collection.name} ({collection.paper_count || 0})</span>
                    <span className="sm:hidden">{collection.name.substring(0, 8)}...</span>
                  </TabsTrigger>
                ))}
              </TabsList>
            </div>

            <TabsContent value="upload" className="mt-6">
              <FileUpload onUploadComplete={handleUploadComplete} />
            </TabsContent>

            <TabsContent value="all" className="mt-6">
              {loading ? (
                <div className="flex items-center justify-center py-12">
                  <LoadingSpinner text="Loading library..." />
                </div>
              ) : filteredLibraryPapers.length === 0 ? (
                <div className="text-center py-12">
                  <BookOpen className="h-12 w-12 mx-auto mb-4 text-muted-foreground opacity-50" />
                  <h3 className="text-lg font-medium mb-2">No papers in your library</h3>
                  <p className="text-muted-foreground mb-4 text-sm sm:text-base">
                    Start building your research library by adding papers
                  </p>
                  <Button onClick={() => setShowAddDialog(true)} className="w-full sm:w-auto">
                    <Plus className="h-4 w-4 mr-2" />
                    Add Your First Paper
                  </Button>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-4">
                  {filteredLibraryPapers.map(paper => (
                    <PaperCard key={paper.id} paper={paper} />
                  ))}
                </div>
              )}
            </TabsContent>

            {collections.map(collection => (
              <TabsContent key={collection.id} value={collection.id} className="mt-6">
                <div className="space-y-4">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                    <div>
                      <h3 className="font-medium">{collection.name}</h3>
                      {collection.description && (
                        <p className="text-sm text-muted-foreground">{collection.description}</p>
                      )}
                    </div>
                    <Badge variant="secondary">
                      {collection.paper_count || 0} papers
                    </Badge>
                  </div>
                  
                  <div className="text-center py-8 text-muted-foreground">
                    <Folder className="h-8 w-8 mx-auto mb-2 opacity-50" />
                    <p className="text-sm sm:text-base">Collection management coming soon</p>
                  </div>
                </div>
              </TabsContent>
            ))}
          </Tabs>
        </CardContent>
      </Card>
    </div>
  )
} 
```

### `components/Navbar.tsx`

```tsx
"use client"

import Link from "next/link"
import { Button } from "@/components/ui/button"

import {
  Menu,
  Sparkles,
} from "lucide-react"

interface NavbarProps {
  user?: {
    id: string
    email?: string
    user_metadata?: {
      full_name?: string
      avatar_url?: string
    }
  } | null
  onToggleSidebar: () => void
  sidebarOpen: boolean
}

export function Navbar({ onToggleSidebar, sidebarOpen }: NavbarProps) {
  return (
    <nav className="fixed top-0 left-0 right-0 h-14 bg-white border-b border-gray-200 z-50 px-4">
      <div className="flex items-center justify-between h-full">
        {/* Left Section - Logo and Sidebar Toggle */}
        <div className="flex items-center gap-3">
          {/* Sidebar Toggle */}
          <Button
            variant="ghost"
            size="sm"
            onClick={onToggleSidebar}
            className="h-8 w-8 p-0 lg:flex"
            aria-label={sidebarOpen ? "Close sidebar" : "Open sidebar"}
          >
            <Menu className="h-4 w-4" />
          </Button>

          {/* Logo */}
          <Link href="/dashboard" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
            <div className="w-7 h-7 bg-gradient-to-br from-blue-500 to-blue-600 rounded-lg flex items-center justify-center">
              <Sparkles className="w-4 h-4 text-white" />
            </div>
            <span className="font-semibold text-lg text-gray-900 hidden sm:block">GenPaper</span>
          </Link>
        </div>

        {/* Right Section - Upgrade Button */}
        <div className="hidden md:flex items-center gap-1">
          <Button
            size="sm"
            className="h-8 px-3 text-sm bg-blue-500 hover:bg-blue-600 text-white"
          >
            <Sparkles className="w-4 h-4 mr-1.5" />
            Upgrade
          </Button>
        </div>
      </div>
    </nav>
  )
} 
```

### `components/PDFProcessingStatus.tsx`

```tsx
'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Badge } from '@/components/ui/badge'
import { CheckCircle, AlertCircle, Clock, XCircle, Loader2 } from 'lucide-react'

interface ProcessingStatus {
  jobId: string
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'poisoned'
  progress: number
  message: string
  extractionMethod?: string
  confidence?: string
  timeElapsed?: number
}

interface PDFProcessingStatusProps {
  jobId: string
  paperTitle: string
  onComplete?: (success: boolean) => void
}

export function PDFProcessingStatus({ 
  jobId, 
  paperTitle, 
  onComplete 
}: PDFProcessingStatusProps) {
  const [status, setStatus] = useState<ProcessingStatus>({
    jobId,
    status: 'pending',
    progress: 0,
    message: 'Initializing PDF processing...'
  })

  useEffect(() => {
    const supabase = createClient()
    
    // Subscribe to real-time updates
    const channel = supabase
      .channel('pdf-processing')
      .on('broadcast', { event: 'status-update' }, (payload: { payload: ProcessingStatus }) => {
        const update = payload.payload
        if (update.jobId === jobId) {
          setStatus(update)
          
          // Notify parent component when completed
          if (update.status === 'completed' && onComplete) {
            onComplete(true)
          } else if ((update.status === 'failed' || update.status === 'poisoned') && onComplete) {
            onComplete(false)
          }
        }
      })
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [jobId, onComplete])

  const getStatusIcon = () => {
    switch (status.status) {
      case 'pending':
        return <Clock className="h-4 w-4 text-yellow-500" />
      case 'processing':
        return <Loader2 className="h-4 w-4 text-blue-500 animate-spin" />
      case 'completed':
        return <CheckCircle className="h-4 w-4 text-green-500" />
      case 'failed':
        return <XCircle className="h-4 w-4 text-red-500" />
      case 'poisoned':
        return <AlertCircle className="h-4 w-4 text-orange-500" />
      default:
        return <Clock className="h-4 w-4 text-gray-500" />
    }
  }

  const getStatusColor = () => {
    switch (status.status) {
      case 'pending':
        return 'bg-yellow-100 text-yellow-800'
      case 'processing':
        return 'bg-blue-100 text-blue-800'
      case 'completed':
        return 'bg-green-100 text-green-800'
      case 'failed':
        return 'bg-red-100 text-red-800'
      case 'poisoned':
        return 'bg-orange-100 text-orange-800'
      default:
        return 'bg-gray-100 text-gray-800'
    }
  }

  const formatTimeElapsed = (ms?: number) => {
    if (!ms) return ''
    if (ms < 1000) return `${ms}ms`
    return `${(ms / 1000).toFixed(1)}s`
  }

  const getExtractionMethodBadge = () => {
    if (!status.extractionMethod) return null
    
    const methodLabels = {
      'doi-lookup': 'DOI Lookup',
      'grobid': 'GROBID',
      'text-layer': 'Text Layer',
      'ocr': 'OCR',
      'fallback': 'Fallback'
    }

    const methodColors = {
      'doi-lookup': 'bg-purple-100 text-purple-800',
      'grobid': 'bg-blue-100 text-blue-800',
      'text-layer': 'bg-green-100 text-green-800',
      'ocr': 'bg-orange-100 text-orange-800',
      'fallback': 'bg-gray-100 text-gray-800'
    }

    return (
      <Badge className={methodColors[status.extractionMethod as keyof typeof methodColors]}>
        {methodLabels[status.extractionMethod as keyof typeof methodLabels]}
      </Badge>
    )
  }

  const getConfidenceBadge = () => {
    if (!status.confidence) return null
    
    const confidenceColors = {
      'high': 'bg-green-100 text-green-800',
      'medium': 'bg-yellow-100 text-yellow-800',
      'low': 'bg-red-100 text-red-800'
    }

    return (
      <Badge className={confidenceColors[status.confidence as keyof typeof confidenceColors]}>
        {status.confidence} confidence
      </Badge>
    )
  }

  return (
    <Card className="w-full max-w-md">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          {getStatusIcon()}
          Processing PDF
        </CardTitle>
        <p className="text-xs text-gray-600 truncate" title={paperTitle}>
          {paperTitle}
        </p>
      </CardHeader>
      
      <CardContent className="space-y-4">
        {/* Status Badge */}
        <div className="flex items-center justify-between">
          <Badge className={getStatusColor()}>
            {status.status.charAt(0).toUpperCase() + status.status.slice(1)}
          </Badge>
          {status.timeElapsed && (
            <span className="text-xs text-gray-500">
              {formatTimeElapsed(status.timeElapsed)}
            </span>
          )}
        </div>

        {/* Progress Bar */}
        {status.status === 'processing' && (
          <div className="space-y-2">
            <Progress value={status.progress} className="h-2" />
            <p className="text-xs text-gray-600">{status.progress}% complete</p>
          </div>
        )}

        {/* Status Message */}
        <p className="text-sm text-gray-700">{status.message}</p>

        {/* Extraction Details */}
        {(status.extractionMethod || status.confidence) && (
          <div className="flex gap-2 flex-wrap">
            {getExtractionMethodBadge()}
            {getConfidenceBadge()}
          </div>
        )}

        {/* Additional Info for Completed Status */}
        {status.status === 'completed' && (
          <div className="text-xs text-green-600 bg-green-50 p-2 rounded">
            ✅ PDF successfully processed and ready for paper generation
          </div>
        )}

        {/* Error Info */}
        {status.status === 'failed' && (
          <div className="text-xs text-red-600 bg-red-50 p-2 rounded">
            ❌ Processing failed. The paper is still available in your library with basic metadata.
          </div>
        )}

        {/* Poison Pill Info */}
        {status.status === 'poisoned' && (
          <div className="text-xs text-orange-600 bg-orange-50 p-2 rounded">
            ⚠️ This PDF has failed processing multiple times and has been marked as problematic.
          </div>
        )}
      </CardContent>
    </Card>
  )
}

export default PDFProcessingStatus 
```

### `components/PaperGenerator.tsx`

```tsx
'use client'

import { useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { 
  Zap,
  Paperclip,
  FileText,
  BookOpen,
  Settings
} from 'lucide-react'
import SourceReview from '@/components/SourceReview'
import { LoadingSpinner } from '@/components/ui/loading-spinner'

interface PaperGeneratorProps {
  className?: string
}

// Helper maps for display values
const paperTypeDisplayMap = {
  researchArticle: "Research Article",
  literatureReview: "Literature Review", 
  capstoneProject: "Capstone Project",
  mastersThesis: "Master&apos;s Thesis",
  phdDissertation: "PhD Dissertation"
};

const lengthDisplayMap = {
  short: "Short",
  medium: "Medium",
  long: "Long"
};


interface GenerationConfig {
  length: 'short' | 'medium' | 'long'
  paperType: 'researchArticle' | 'literatureReview' | 'capstoneProject' | 'mastersThesis' | 'phdDissertation'
}

const defaultConfig: GenerationConfig = {
  length: 'medium',
  paperType: 'researchArticle',
}

export default function PaperGenerator({ className }: PaperGeneratorProps) {
  const router = useRouter()
  
  // Form state
  const [topic, setTopic] = useState('')
  const [selectedPapers, setSelectedPapers] = useState<string[]>([])
  const [useLibraryOnly, setUseLibraryOnly] = useState(false)
  const [isStarting, setIsStarting] = useState(false)
  const [config, setConfig] = useState<GenerationConfig>({
    length: defaultConfig.length,
    paperType: defaultConfig.paperType,
  })

  const handlePaperSelection = useCallback((paperId: string, selected: boolean) => {
    setSelectedPapers(prev => 
      selected 
        ? [...prev, paperId]
        : prev.filter(id => id !== paperId)
    )
  }, [])

  const handlePinnedPapersChange = useCallback((pinnedIds: string[]) => {
    setSelectedPapers(pinnedIds)
  }, [])

  const handleGenerate = async () => {
    if (!topic.trim()) return
    
    setIsStarting(true)
    
    const params = new URLSearchParams({
      topic: topic.trim(),
      length: config.length,
      paperType: config.paperType,
      useLibraryOnly: useLibraryOnly.toString(),
      selectedPapers: selectedPapers.join(',')
    })
    
    router.replace(`/generate/outline?${params.toString()}`)
  }

  return (
    <div className={`max-w-6xl mx-auto p-6 space-y-6 ${className}`}>
      <div className="text-center space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">Generate Research Paper</h1>
        <p className="text-muted-foreground">
          Enter your research topic and let AI create a comprehensive paper with citations
        </p>
      </div>

      {/* Paper Configuration Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Settings className="h-5 w-5" />
            Paper Configuration
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="bg-white rounded-lg border border-gray-200 dark:bg-gray-800 dark:border-gray-700 p-4">
            <Textarea
              placeholder="Describe your research topic or question..."
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              className="w-full h-24 resize-none border-0 outline-none text-sm text-gray-700 dark:text-gray-300 placeholder-gray-400 dark:placeholder-gray-500 bg-transparent"
              disabled={isStarting}
              suppressHydrationWarning={true}
            />

            <div className="flex items-center justify-between mt-4">
              <div className="flex items-center gap-1 sm:gap-2 flex-wrap">
                {/* Paper Type Dropdown */}
                <Select 
                  value={config.paperType} 
                  onValueChange={(value: keyof typeof paperTypeDisplayMap) => 
                    setConfig(prev => ({ ...prev, paperType: value }))
                  }
                  disabled={isStarting}
                >
                  <SelectTrigger 
                    className="flex items-center gap-1 text-xs sm:text-sm text-gray-600 dark:text-gray-400 border-0 hover:bg-gray-100 dark:hover:bg-gray-700 px-2 py-1 rounded"
                    suppressHydrationWarning={true}
                  >
                    <FileText className="w-3 h-3 sm:w-4 sm:h-4" />
                    <span>{config.paperType ? paperTypeDisplayMap[config.paperType] : 'Paper Type'}</span>

                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="researchArticle">
                      <div className="flex flex-col">
                        <span className="font-medium">Research Article</span>
                        <span className="text-xs text-gray-500">IMRaD format with methods, results, discussion</span>
                      </div>
                    </SelectItem>
                    <SelectItem value="literatureReview">
                      <div className="flex flex-col">
                        <span className="font-medium">Literature Review</span>
                        <span className="text-xs text-gray-500">Critical synthesis of existing research</span>
                      </div>
                    </SelectItem>
                    <SelectItem value="capstoneProject">
                      <div className="flex flex-col">
                        <span className="font-medium">Capstone Project</span>
                        <span className="text-xs text-gray-500">Final-year project proposal with implementation plan</span>
                      </div>
                    </SelectItem>
                    <SelectItem value="mastersThesis">
                      <div className="flex flex-col">
                        <span className="font-medium">Master&apos;s Thesis</span>
                        <span className="text-xs text-gray-500">Multi-chapter research with 20-30 sources</span>
                      </div>
                    </SelectItem>
                    <SelectItem value="phdDissertation">
                      <div className="flex flex-col">
                        <span className="font-medium">PhD Dissertation</span>
                        <span className="text-xs text-gray-500">Comprehensive research with theoretical framework</span>
                      </div>
                    </SelectItem>
                  </SelectContent>
                </Select>

                {/* Paper Length Dropdown */}
                <Select
                  value={config.length}
                  onValueChange={(value: keyof typeof lengthDisplayMap) =>
                    setConfig(prev => ({ ...prev, length: value }))
                  }
                  disabled={isStarting}
                >
                  <SelectTrigger 
                    className="flex items-center gap-1 text-xs sm:text-sm text-gray-600 dark:text-gray-400 border-0 hover:bg-gray-100 dark:hover:bg-gray-700 px-2 py-1 rounded focus:ring-0 focus:ring-offset-0"
                    suppressHydrationWarning={true}
                  >
                    <Zap className="w-3 h-3 sm:w-4 sm:h-4" />
                    <span>{config.length ? lengthDisplayMap[config.length] : 'Paper Length'}</span>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="short">
                      <div className="flex flex-col">
                        <span className="font-medium">Short</span>
                        <span className="text-xs text-gray-500">3-5 pages, quick overview</span>
                      </div>
                    </SelectItem>
                    <SelectItem value="medium">
                      <div className="flex flex-col">
                        <span className="font-medium">Medium</span>
                        <span className="text-xs text-gray-500">8-12 pages, comprehensive analysis</span>
                      </div>
                    </SelectItem>
                    <SelectItem value="long">
                      <div className="flex flex-col">
                        <span className="font-medium">Long</span>
                        <span className="text-xs text-gray-500">15-20 pages, in-depth research</span>
                      </div>
                    </SelectItem>
                  </SelectContent>
                </Select>

              </div>
            <div className="flex items-center gap-2">
                <Paperclip className="w-4 h-4 text-gray-400 dark:text-gray-500 cursor-pointer hover:text-gray-600 dark:hover:text-gray-300" />
                  <Button 
                onClick={handleGenerate}
                disabled={!topic.trim() || isStarting}
                className="bg-gray-600 hover:bg-gray-700 text-white px-4 sm:px-6 py-2 text-sm sm:text-base dark:bg-gray-600 dark:hover:bg-gray-600 whitespace-nowrap flex items-center gap-2"
              >
                {isStarting ? (
                  <LoadingSpinner size="sm" />
                ) : (
                  <>
                    <Zap className="w-4 h-4" />
                    Generate
                  </>
                )}
              </Button>
            </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Source Selection Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BookOpen className="h-5 w-5" />
            Source Selection
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div>
                <p className="text-sm text-muted-foreground">
                  Choose papers from your library or let AI discover new sources automatically.
                </p>
              </div>
              <div className="flex items-center space-x-2">
                <Switch
                  id="library-only"
                  checked={useLibraryOnly}
                  onCheckedChange={setUseLibraryOnly}
                  disabled={isStarting}
                  suppressHydrationWarning={true}
                />
                <Label htmlFor="library-only" className="text-sm">
                  Library Only
                  <span className="block text-xs text-muted-foreground">
                    Use only your saved papers
                  </span>
                </Label>
              </div>
            </div>
            
            <SourceReview
              selectedPaperIds={selectedPapers}
              onPaperSelectionChange={handlePaperSelection}
              onPinnedPapersChange={handlePinnedPapersChange}
            />
          </div>
        </CardContent>
      </Card>
    </div>
  )
} 
```

### `components/PaperViewer.tsx`

```tsx
'use client'

import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { 
  FileText, 
  Download, 
  Share2, 
  BookOpen, 
  ExternalLink,
  Clock,
  Calendar,
  Quote,
  Copy,
  Check
} from 'lucide-react'
import { format } from 'date-fns'
import { InteractiveCitationRenderer } from '@/components/citations/InteractiveCitationRenderer'
import { paperToCSL, type CSLItem } from '@/lib/utils/csl'
import type { 
  ResearchProject, 
  ResearchProjectVersion,
  PaperWithAuthors
} from '@/types/simplified'

// Extended type for papers with CSL data
interface PaperWithCSL extends PaperWithAuthors {
  csl_json?: CSLItem
}

interface PaperViewerProps {
  projectId: string
  className?: string
}

export default function PaperViewer({ projectId, className }: PaperViewerProps) {
  const [project, setProject] = useState<ResearchProject | null>(null)
  const [latestVersion, setLatestVersion] = useState<ResearchProjectVersion | null>(null)
  const [papers, setPapers] = useState<PaperWithCSL[]>([])
  const [citations, setCitations] = useState<Record<string, CSLItem>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [copiedText, setCopiedText] = useState<string | null>(null)
  const [showReferences, setShowReferences] = useState(false)
  
  // Fix copy button race condition
  const copyTimer = useRef<NodeJS.Timeout | undefined>(undefined)

  // Calculate cited papers count
  const citedPapersCount = useMemo(() => {
    if (!latestVersion?.content) return 0
    const citations = latestVersion.content.match(/\[CITE:\s*([a-f0-9-]{36}|[A-Za-z0-9_\-\.\/]+)\]/g)
    return new Set(
      citations?.map(cite => cite.match(/\[CITE:\s*([a-f0-9-]{36}|[A-Za-z0-9_\-\.\/]+)\]/)?.[1]).filter(Boolean)
    ).size
  }, [latestVersion?.content])

  // Create CSL-JSON citations map for the new citation system
  const citationsMap = useMemo(() => {
    const map = new Map<string, CSLItem>()

    // Use citations from API if available
    if (citations && Object.keys(citations).length > 0) {
      Object.entries(citations).forEach(([key, value]) => {
        map.set(key, value as CSLItem)
      })
      return map
    }

    // Fallback: derive from content & papers if citations object missing
    if (!latestVersion?.content) return map
    const tokens = latestVersion.content.match(/\[CITE:\s*([a-f0-9-]{36}|[A-Za-z0-9_\-\.\/]+)\]/g) || []
    const ids = new Set(tokens.map(t => t.replace(/\[CITE:\s*([a-f0-9-]{36}|[A-Za-z0-9_\-\.\/]+)\]/, '$1')))
    ids.forEach(id => {
      const paper = papers.find(p=>p.id===id)
      if (paper) map.set(id, paper.csl_json || paperToCSL(paper))
    })
    return map
  }, [latestVersion?.content, papers, citations])

  const loadProject = useCallback(async () => {
    try {
      setLoading(true)
      const response = await fetch(
        `/api/projects/${projectId}?includeCitations=true&includePapers=true&includeVersions=false`,
        { credentials: 'include' }
      )
      
      if (!response.ok) {
        throw new Error('Failed to load project')
      }

      const data = await response.json()
      console.log('🔍 API Response:', {
        project: !!data.project || !!data.id,
        latest_version: !!data.latest_version,
        papers: data.papers?.length || 0,
        citations: data.citations?.length || 0
      })
      console.log('📄 Papers data:', data.papers)
      console.log('📄 Citations data:', data.citations)
      
      setProject(data)
      setLatestVersion(data.latest_version)
      setPapers(data.papers || [])
      setCitations(data.citations || {})
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load project')
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    loadProject()
  }, [projectId, loadProject])
  
  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (copyTimer.current) {
        clearTimeout(copyTimer.current)
      }
    }
  }, [])

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopiedText(text)
      
      // Clear existing timer and set new one
      if (copyTimer.current) {
        clearTimeout(copyTimer.current)
      }
      copyTimer.current = setTimeout(() => setCopiedText(null), 2000)
    } catch {
      // Silently fail
    }
  }

  const downloadPaper = () => {
    if (!latestVersion?.content || !project) return

    const blob = new Blob([latestVersion.content], { type: 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${project.topic.replace(/[^a-zA-Z0-9]/g, '_')}.md`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  const sharePaper = async () => {
    if (!project) return

    const shareData = {
      title: project.topic,
      text: `Research paper: ${project.topic}`,
      url: window.location.href
    }

    if (navigator.share) {
      try {
        await navigator.share(shareData)
      } catch {
        // Fall back to copying URL
        copyToClipboard(window.location.href)
      }
    } else {
      copyToClipboard(window.location.href)
    }
  }

  if (loading) {
    return (
      <div className={`flex items-center justify-center min-h-[400px] ${className}`}>
        <div className="text-center space-y-2">
          <FileText className="h-8 w-8 animate-pulse mx-auto text-muted-foreground" />
          <p className="text-muted-foreground">Loading paper...</p>
        </div>
      </div>
    )
  }

  if (error || !project || !latestVersion) {
    return (
      <div className={`flex items-center justify-center min-h-[400px] ${className}`}>
        <Card className="max-w-md">
          <CardContent className="pt-6 text-center">
            <FileText className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
            <p className="font-medium">Unable to load paper</p>
            <p className="text-sm text-muted-foreground mt-1">
              {error || 'Paper not found or still generating'}
            </p>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className={`max-w-5xl mx-auto p-6 space-y-6 ${className}`}>
      {/* Header */}
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between">
            <div className="space-y-2 flex-1">
              <CardTitle className="text-2xl leading-tight">
                {project.topic}
              </CardTitle>
              <CardDescription className="flex items-center gap-4 text-sm">
                <span className="flex items-center gap-1">
                  <Calendar className="h-4 w-4" />
                  {format(new Date(project.created_at), 'PPP')}
                </span>
                <span className="flex items-center gap-1">
                  <Clock className="h-4 w-4" />
                  {latestVersion.word_count || 0} words
                </span>
                <span className="flex items-center gap-1">
                  <Quote className="h-4 w-4" />
                  {citedPapersCount} cited
                </span>
              </CardDescription>
            </div>
            
            <div className="flex items-center gap-2">
              <Badge variant={project.status === 'complete' ? 'default' : 'secondary'}>
                {project.status}
              </Badge>
              
              <Button variant="outline" size="sm" onClick={downloadPaper}>
                <Download className="h-4 w-4 mr-2" />
                Download
              </Button>
              
              <Button variant="outline" size="sm" onClick={sharePaper}>
                <Share2 className="h-4 w-4 mr-2" />
                Share
              </Button>

              <Sheet open={showReferences} onOpenChange={setShowReferences}>
                <SheetTrigger asChild>
                  <Button variant="outline" size="sm">
                    <BookOpen className="h-4 w-4 mr-2" />
                    References ({citedPapersCount})
                  </Button>
                </SheetTrigger>
                <SheetContent side="right" className="w-[400px] sm:w-[540px]">
                  <SheetHeader>
                    <SheetTitle>References</SheetTitle>
                    <SheetDescription>
                      Papers cited in this research
                    </SheetDescription>
                  </SheetHeader>
                  <ScrollArea className="h-[calc(100vh-120px)] mt-6">
                    <div className="space-y-4">
                      {papers.map((paper) => (
                        <Card key={paper.id}>
                          <CardContent className="pt-4">
                            <div className="space-y-2">
                              <h4 className="font-medium text-sm leading-tight">
                                {paper.title}
                              </h4>
                              <p className="text-xs text-muted-foreground">
                                {paper.author_names?.join(', ')}
                              </p>
                              {paper.venue && (
                                <Badge variant="secondary" className="text-xs">
                                  {paper.venue}
                                </Badge>
                              )}
                              <div className="flex items-center gap-2 pt-2">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => copyToClipboard(paper.title || 'Untitled')}
                                >
                                  {copiedText === (paper.title || 'Untitled') ? (
                                    <Check className="h-3 w-3" />
                                  ) : (
                                    <Copy className="h-3 w-3" />
                                  )}
                                </Button>
                                {paper.url && (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => window.open(paper.url, '_blank')}
                                  >
                                    <ExternalLink className="h-3 w-3" />
                                  </Button>
                                )}
                              </div>
                            </div>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  </ScrollArea>
                </SheetContent>
              </Sheet>
            </div>
          </div>
        </CardHeader>
      </Card>

      {/* Paper Content with Citation Formatting */}
      <Card>
        <CardContent className="pt-6">
          <div className="max-w-4xl mx-auto">
            <InteractiveCitationRenderer 
              content={latestVersion.content || ''}
              citations={citationsMap}
              documentId={projectId}
              initialStyle="apa"
            />
          </div>
        </CardContent>
      </Card>
    </div>
  )
} 
```

### `components/ProcessingScreen.tsx`

```tsx
"use client"

import { useEffect, useState, useMemo } from "react"
import { Sparkles, Search, FileText, CheckCircle, Brain, Quote } from "lucide-react"
import { Progress } from "@/components/ui/progress"
import type { GenerationProgress } from "@/types/simplified"

interface Step {
  stage: string;
  message: string;
  icon: React.ElementType;
  fallbackMessage: string;
}

interface ProcessingScreenProps {
  topic: string
  progress?: GenerationProgress | null
  isConnected?: boolean
  error?: string | null
}

export function ProcessingScreen({ 
  topic, 
  progress, 
  isConnected = false, 
  error 
}: ProcessingScreenProps) {
  const [currentStep, setCurrentStep] = useState(0)
  const [displayProgress, setDisplayProgress] = useState(0)
  const [displayMessage, setDisplayMessage] = useState("Initializing...")

  // Map backend stages to UI steps, including a UI-specific initial step
  const steps: Step[] = useMemo(() => [
    { 
      stage: 'ui_analyzing', // Pseudo-stage for the initial UI analyzing phase
      message: "Analyzing your research topic...", // Main message for this phase
      icon: Brain,
      fallbackMessage: "Analyzing your research topic..." // Text for the step list item
    },
    { 
      stage: 'searching', // Backend stage name
      message: "Analyzing your research topic and searching for papers...", // Overall process message for this stage
      icon: Search, // Icon for searching
      fallbackMessage: "Searching academic databases for relevant papers..." // Text for the step list item
    },
    { 
      stage: 'evaluating', // Backend stage name
      message: "Evaluating and selecting the best academic sources...", 
      icon: FileText, // Icon for evaluating
      fallbackMessage: "Evaluating and selecting the best academic sources..." // Text for the step list item
    },
    { 
      stage: 'writing', // Backend stage name
      message: "Generating your research paper with AI assistance...", 
      icon: Quote,
      fallbackMessage: "Generating your research paper with proper citations..." // Text for the step list item
    },
    { 
      stage: 'citations', // Backend stage name
      message: "Adding citations and formatting references...", 
      icon: CheckCircle,
      fallbackMessage: "Adding citations and formatting references..." // Text for the step list item
    },
    { 
      stage: 'complete', // Backend stage name
      message: "Finalizing document structure and formatting...", 
      icon: Sparkles, // Icon for completion
      fallbackMessage: "Finalizing document structure and formatting..." // Text for the step list item
    },
  ], [])

  // Update step and progress based on backend progress or connection state
  useEffect(() => {
    if (error) {
      // Error state is handled by the error display block, no further action here for progress/steps.
      return;
    }

    if (!isConnected) {
      setCurrentStep(0); // Default to the first step (Analyzing)
      setDisplayProgress(0);
      setDisplayMessage("Connecting to generation service...");
      return;
    }

    // At this point, isConnected is true and no error.
    if (progress) {
      const { stage: backendStageName, progress: progressValue, message: backendStageMessage } = progress;
      
      let targetStepIndex = -1;
      // Find index in our `steps` array that matches the backend stage.
      // The first step (ui_analyzing) is not a backend stage.
      const matchedStep = steps.find(step => step.stage === backendStageName);

      if (matchedStep) {
        targetStepIndex = steps.indexOf(matchedStep);
      }

      if (targetStepIndex !== -1) {
        setCurrentStep(targetStepIndex);
        const currentStepObject = steps[targetStepIndex];
        setDisplayMessage(backendStageMessage || (currentStepObject ? currentStepObject.message : "") || "Processing...");
      } else {
        // If backend stage is unknown or doesn't map, update message but don't change step
        // However, if it's 'complete' and somehow missed, ensure we go to the complete step.
        if (backendStageName === 'complete') {
          const completeStepIdx = steps.findIndex(s => s.stage === 'complete');
          if (completeStepIdx !== -1) setCurrentStep(completeStepIdx);
        }
        setDisplayMessage(backendStageMessage || "Processing...");
      }
      
      setDisplayProgress(Math.min(progressValue || 0, 100));
    } else { 
      // isConnected is true, but no progress object yet (initial "analyzing" phase)
      setCurrentStep(0); // Activate the first step ("Analyzing your research topic...")
      setDisplayProgress(0); 
      const firstStep = steps[0];
      setDisplayMessage(firstStep ? firstStep.message : "Analyzing your research topic..."); 
    }
  }, [steps, progress, isConnected, error]); 

  // Fallback simulation for progress bar and step advancement if backend is silent
  useEffect(() => {
    if (!progress && !error && isConnected) {
      // This simulation runs when connected, no error, and no backend progress signal.
      // `currentStep` should be 0 initially (set by the other useEffect).
      const interval = setInterval(() => {
        setDisplayProgress((prevDisplayProgress) => {
          if (prevDisplayProgress >= 95 && (!progress || (progress && (progress as GenerationProgress).stage !== 'complete'))) {
            return prevDisplayProgress; 
          }
          if (prevDisplayProgress >= 100 && progress && (progress as GenerationProgress).stage === 'complete') {
            return 100;
          }
          
          const newDisplayProgress = prevDisplayProgress + 2;
          
          // Visually advance step if backend is silent.
          // currentStep indices: 0:Analyzing, 1:Searching, 2:Evaluating, 3:Writing, 4:Citations
          // This should not advance to step 5 (Complete) via simulation.
          // The check `currentStep < X` ensures we only advance if not already past that simulated threshold.
          if (newDisplayProgress >= 15 && currentStep < 1) setCurrentStep(1);
          else if (newDisplayProgress >= 35 && currentStep < 2) setCurrentStep(2);
          else if (newDisplayProgress >= 65 && currentStep < 3) setCurrentStep(3);
          else if (newDisplayProgress >= 85 && currentStep < 4) setCurrentStep(4);
          
          return Math.min(newDisplayProgress, 100);
        });
      }, 500);

      return () => clearInterval(interval);
    }
  }, [progress, error, isConnected, currentStep]); // currentStep is a dependency

  // Handle error state
  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-background p-4 sm:p-6 lg:p-8">
        <div className="w-full max-w-sm sm:max-w-md md:max-w-lg lg:max-w-xl space-y-6 sm:space-y-8 text-center">
          <div className="flex items-center justify-center gap-2 text-lg sm:text-xl lg:text-2xl font-bold">
            <Sparkles className="h-5 w-5 sm:h-6 sm:w-6 lg:h-7 lg:w-7 text-primary" />
            <span>GenPaper</span>
          </div>
          
          <div className="space-y-2 sm:space-y-3">
            <h1 className="text-xl sm:text-2xl lg:text-3xl font-semibold leading-tight text-red-600">
              Generation Error
            </h1>
            <p className="text-base sm:text-lg lg:text-xl text-muted-foreground px-2 sm:px-4">
              {error}
            </p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-background p-4 sm:p-6 lg:p-8">
      <div className="w-full max-w-sm sm:max-w-md md:max-w-lg lg:max-w-xl space-y-6 sm:space-y-8 text-center">
        {/* Logo */}
        <div className="flex items-center justify-center gap-2 text-lg sm:text-xl lg:text-2xl font-bold">
          <Sparkles className="h-5 w-5 sm:h-6 sm:w-6 lg:h-7 lg:w-7 text-primary" />
          <span>GenPaper</span>
        </div>

        {/* Topic */}
        <div className="space-y-2 sm:space-y-3">
          <h1 className="text-xl sm:text-2xl lg:text-3xl font-semibold leading-tight">
            Generating Your Paper
          </h1>
          <p className="text-base sm:text-lg lg:text-xl text-muted-foreground px-2 sm:px-4">
            {topic}
          </p>
        </div>

        {/* Connection Status */}
        {!isConnected && !error && (
          <div className="text-sm text-blue-600">
            Connecting to generation service...
          </div>
        )}

        {/* Progress */}
        <div className="space-y-4 sm:space-y-6">
          <Progress value={displayProgress} className="h-2 sm:h-3" />

          {/* Current Status */}
          <div className="text-sm sm:text-base text-muted-foreground">
            {displayMessage}
          </div>

          <div className="space-y-3 sm:space-y-4">
            {steps.map((stepItem: Step, index: number) => {
              const StepIcon = stepItem.icon
              const isActive = index === currentStep
              const isComplete = index < currentStep || 
                               (progress && (progress as GenerationProgress).stage === 'complete' && 
                                displayProgress === 100 && 
                                stepItem.stage === 'complete')

              return (
                <div
                  key={index}
                  className={`flex items-start sm:items-center gap-3 sm:gap-4 transition-all duration-500 ${
                    isActive ? "opacity-100 scale-105" : isComplete ? "opacity-70" : "opacity-30"
                  }`}
                >
                  <div className={`p-2 sm:p-2.5 lg:p-3 rounded-full transition-colors flex-shrink-0 ${
                    isActive ? "bg-primary/20" : isComplete ? "bg-green-100" : "bg-muted"
                  }`}>
                    <StepIcon className={`h-4 w-4 sm:h-5 sm:w-5 lg:h-6 lg:w-6 ${
                      isActive ? "text-primary" : isComplete ? "text-green-600" : "text-muted-foreground"
                    }`} />
                  </div>
                  <span className={`text-left text-sm sm:text-base lg:text-lg transition-all leading-relaxed ${
                    isActive ? "font-medium text-foreground" : isComplete ? "text-muted-foreground" : "text-muted-foreground"
                  }`}>
                    {stepItem.fallbackMessage}
                  </span>
                </div>
              )
            })}
          </div>
        </div>

        <div className="space-y-2 sm:space-y-3 px-2 sm:px-4">
          <p className="text-sm sm:text-base text-muted-foreground">
            This usually takes 2-4 minutes depending on your topic complexity.
          </p>
          <p className="text-xs sm:text-sm text-muted-foreground">
            Please don&apos;t close this window while your paper is being generated.
          </p>
          
          {/* Real-time connection status */}
          <div className="text-xs text-muted-foreground">
            {isConnected ? (
              <span className="text-green-600">● Connected</span>
            ) : (
              <span className="text-orange-600">● Connecting...</span>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

```

### `components/QueryErrorBoundary.tsx`

```tsx
'use client'

import React from 'react'
import { ErrorBoundary } from './ErrorBoundary'
import { useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { 
  RefreshCw, 
  Database, 
  Wifi,
  WifiOff
} from 'lucide-react'

interface QueryErrorBoundaryProps {
  children: React.ReactNode
  fallback?: React.ReactNode
  queryKeys?: string[][]
}

export function QueryErrorBoundary({ 
  children, 
  fallback,
  queryKeys = [] 
}: QueryErrorBoundaryProps) {
  const queryClient = useQueryClient()

  const handleQueryRetry = () => {
    // Retry all failed queries
    queryClient.refetchQueries({
      type: 'all',
      stale: true
    })
  }

  const handleInvalidateQueries = () => {
    // Invalidate specific query keys if provided, otherwise invalidate all
    if (queryKeys.length > 0) {
      queryKeys.forEach(queryKey => {
        queryClient.invalidateQueries({ queryKey })
      })
    } else {
      queryClient.invalidateQueries()
    }
  }

  const handleClearCache = () => {
    queryClient.clear()
    window.location.reload()
  }

  const isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true

  const queryErrorFallback = (
    <div className="flex items-center justify-center min-h-[400px] p-4">
      <Card className="w-full max-w-lg">
        <CardHeader className="text-center">
          <div className="mx-auto w-12 h-12 bg-yellow-100 rounded-full flex items-center justify-center mb-4">
            <Database className="w-6 h-6 text-yellow-600" />
          </div>
          <CardTitle className="text-xl text-gray-900">
            Data Loading Error
          </CardTitle>
          <p className="text-gray-600 text-sm mt-2">
            We&apos;re having trouble loading your data. This might be a temporary network issue.
          </p>
        </CardHeader>
        
        <CardContent className="space-y-4">
          {!isOnline && (
            <Alert>
              <WifiOff className="h-4 w-4" />
              <AlertDescription>
                You appear to be offline. Please check your internet connection.
              </AlertDescription>
            </Alert>
          )}

          {isOnline && (
            <Alert>
              <Wifi className="h-4 w-4" />
              <AlertDescription>
                Connection detected. The issue might be temporary.
              </AlertDescription>
            </Alert>
          )}

          <div className="flex flex-col gap-2">
            <Button onClick={handleQueryRetry} className="w-full">
              <RefreshCw className="w-4 h-4 mr-2" />
              Retry Loading
            </Button>
            
            <Button 
              variant="outline" 
              onClick={handleInvalidateQueries}
              className="w-full"
            >
              <Database className="w-4 h-4 mr-2" />
              Refresh Data
            </Button>
            
            <Button 
              variant="outline" 
              onClick={handleClearCache}
              size="sm"
              className="w-full text-xs"
            >
              Clear Cache & Reload
            </Button>
          </div>

          <p className="text-xs text-gray-500 text-center">
            If the problem persists, please contact support.
          </p>
        </CardContent>
      </Card>
    </div>
  )

  return (
    <ErrorBoundary
      fallback={fallback || queryErrorFallback}
      onError={(error, errorInfo) => {
        console.error('Query Error Boundary:', error, errorInfo)
        
        // Log query-specific error details
        console.group('🔍 Query Error Details')
        console.error('Network State:', navigator.onLine ? 'Online' : 'Offline')
        console.error('Query Cache Size:', queryClient.getQueryCache().getAll().length)
        console.error('Failed Queries:', queryClient.getQueryCache().getAll().filter(q => q.state.status === 'error'))
        console.groupEnd()
      }}
      resetKeys={queryKeys.flat()}
      resetOnPropsChange={true}
    >
      {children}
    </ErrorBoundary>
  )
}

// Hook to use QueryErrorBoundary with specific query keys
export function useQueryErrorBoundary(queryKeys: string[][]) {
  return { queryKeys }
} 
```

### `components/SourceReview.tsx`

```tsx
'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { 
  Search, 
  BookOpen, 
  Pin, 
  PinOff,
  Users,
  Calendar,
  ExternalLink,
  AlertCircle
} from 'lucide-react'
import { LoadingSpinner } from '@/components/ui/loading-spinner'
import type { LibraryPaper, LibraryFilters, Author } from '@/types/simplified'

interface SourceReviewProps {
  selectedPaperIds: string[]
  onPaperSelectionChange: (paperId: string, selected: boolean) => void
  onPinnedPapersChange: (pinnedIds: string[]) => void
  className?: string
}

interface LibraryResponse {
  papers: LibraryPaper[]
  total: number
}

export default function SourceReview({ 
  selectedPaperIds, 
  onPaperSelectionChange, 
  onPinnedPapersChange,
  className 
}: SourceReviewProps) {
  const [libraryPapers, setLibraryPapers] = useState<LibraryPaper[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [pinnedPaperIds, setPinnedPaperIds] = useState<Set<string>>(new Set(selectedPaperIds))
  
  // Filter states
  const [filters, setFilters] = useState<LibraryFilters>({
    search: '',
    sortBy: 'added_at',
    sortOrder: 'desc'
  })

  // Memoized utility functions
  const formatDate = useCallback((dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    })
  }, [])

  const formatAuthors = useCallback((authors: Author[]) => {
    if (!authors || authors.length === 0) return 'Unknown authors'
    if (authors.length === 1) return authors[0].name
    if (authors.length === 2) return `${authors[0].name} & ${authors[1].name}`
    return `${authors[0].name} et al.`
  }, [])

  // Memoized filtered papers to prevent unnecessary recalculations
  const filteredPapers = useMemo(() => {
    let filtered = [...libraryPapers]

    // Apply search filter
    if (filters.search) {
      const searchLower = filters.search.toLowerCase()
      filtered = filtered.filter(lp => 
        lp.paper.title.toLowerCase().includes(searchLower) ||
        lp.paper.abstract?.toLowerCase().includes(searchLower) ||
        lp.paper.authors?.some(author => 
          author.name.toLowerCase().includes(searchLower)
        ) ||
        lp.paper.venue?.toLowerCase().includes(searchLower) ||
        lp.notes?.toLowerCase().includes(searchLower)
      )
    }

    // Apply source filter
    if (filters.source) {
      filtered = filtered.filter(lp => lp.paper.source === filters.source)
    }

    // Apply sorting
    const sortBy = filters.sortBy || 'added_at'
    const sortOrder = filters.sortOrder || 'desc'
    
    filtered.sort((a, b) => {
      let comparison = 0
      
      switch (sortBy) {
        case 'added_at':
          comparison = new Date(a.added_at).getTime() - new Date(b.added_at).getTime()
          break
        case 'title':
          comparison = a.paper.title.localeCompare(b.paper.title)
          break
        case 'publication_date':
          const dateA = a.paper.publication_date ? new Date(a.paper.publication_date).getTime() : 0
          const dateB = b.paper.publication_date ? new Date(b.paper.publication_date).getTime() : 0
          comparison = dateA - dateB
          break
        case 'citation_count':
          comparison = (a.paper.citation_count || 0) - (b.paper.citation_count || 0)
          break
        default:
          comparison = 0
      }
      
      return sortOrder === 'asc' ? comparison : -comparison
    })

    return filtered
  }, [libraryPapers, filters])

  const loadLibraryPapers = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      
      const response = await fetch('/api/library/papers', {
        credentials: 'include'
      })
      
      if (!response.ok) {
        throw new Error('Failed to fetch library papers')
      }
      
      const data: LibraryResponse = await response.json()
      setLibraryPapers(data.papers || [])
    } catch (error) {
      console.error('Failed to load library:', error)
      setError('Failed to load library papers')
    } finally {
      setLoading(false)
    }
  }, [])

  const handlePinToggle = useCallback((paperId: string) => {
    const newPinnedIds = new Set(pinnedPaperIds)
    if (newPinnedIds.has(paperId)) {
      newPinnedIds.delete(paperId)
      onPaperSelectionChange(paperId, false)
    } else {
      newPinnedIds.add(paperId)
      onPaperSelectionChange(paperId, true)
    }
    setPinnedPaperIds(newPinnedIds)
  }, [pinnedPaperIds, onPaperSelectionChange])

  const handleSelectAll = useCallback(() => {
    const allIds = filteredPapers.map(lp => lp.paper.id)
    setPinnedPaperIds(new Set(allIds))
    allIds.forEach(id => onPaperSelectionChange(id, true))
  }, [filteredPapers, onPaperSelectionChange])

  const handleClearAll = useCallback(() => {
    pinnedPaperIds.forEach(id => onPaperSelectionChange(id, false))
    setPinnedPaperIds(new Set())
  }, [pinnedPaperIds, onPaperSelectionChange])

  // Load data only once
  useEffect(() => {
    loadLibraryPapers()
  }, [loadLibraryPapers])

  // Update parent only when pinnedPaperIds actually changes
  useEffect(() => {
    const pinnedArray = Array.from(pinnedPaperIds)
    onPinnedPapersChange(pinnedArray)
  }, [pinnedPaperIds, onPinnedPapersChange])

  if (loading) {
    return (
      <Card className={className}>
        <CardContent className="flex items-center justify-center py-8">
          <LoadingSpinner text="Loading your library..." />
        </CardContent>
      </Card>
    )
  }

  if (error) {
    return (
      <Card className={className}>
        <CardContent className="flex items-center justify-center py-8">
          <AlertCircle className="h-6 w-6 text-red-500 mr-2" />
          <span className="text-red-700">{error}</span>
          <Button 
            variant="outline" 
            size="sm" 
            onClick={loadLibraryPapers}
            className="ml-4"
          >
            Retry
          </Button>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BookOpen className="h-5 w-5" />
          Source Review
          <Badge variant="secondary" className="ml-auto">
            {pinnedPaperIds.size} pinned
          </Badge>
        </CardTitle>
        <CardDescription>
          Select papers from your library to use as sources. Pinned papers will be used alongside automatically discovered papers.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Filters */}
        <div className="space-y-4">
          <div className="flex items-center gap-4">
            <div className="flex-1 space-y-2">
              <Label htmlFor="search">Search papers</Label>
              <div className="relative">
                <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <Input
                  id="search"
                  placeholder="Search title, authors, venue, or notes..."
                  value={filters.search}
                  onChange={(e) => setFilters(prev => ({ ...prev, search: e.target.value }))}
                  className="pl-9"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Sort by</Label>
              <Select 
                value={`${filters.sortBy}-${filters.sortOrder}`}
                onValueChange={(value) => {
                  const [sortBy, sortOrder] = value.split('-') as [typeof filters.sortBy, typeof filters.sortOrder]
                  setFilters(prev => ({ ...prev, sortBy, sortOrder }))
                }}
              >
                <SelectTrigger className="w-48">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="added_at-desc">Recently added</SelectItem>
                  <SelectItem value="added_at-asc">Oldest first</SelectItem>
                  <SelectItem value="title-asc">Title A-Z</SelectItem>
                  <SelectItem value="title-desc">Title Z-A</SelectItem>
                  <SelectItem value="publication_date-desc">Newest papers</SelectItem>
                  <SelectItem value="publication_date-asc">Oldest papers</SelectItem>
                  <SelectItem value="citation_count-desc">Most cited</SelectItem>
                  <SelectItem value="citation_count-asc">Least cited</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Bulk actions */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleSelectAll}
                disabled={filteredPapers.length === 0}
              >
                <Pin className="h-4 w-4 mr-1" />
                Pin All ({filteredPapers.length})
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleClearAll}
                disabled={pinnedPaperIds.size === 0}
              >
                <PinOff className="h-4 w-4 mr-1" />
                Clear All
              </Button>
            </div>
            <div className="text-sm text-muted-foreground">
              {filteredPapers.length} of {libraryPapers.length} papers
            </div>
          </div>
        </div>

        <Separator />

        {/* Papers list */}
        <ScrollArea className="h-96">
          {filteredPapers.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              {libraryPapers.length === 0 
                ? "No papers in your library yet. Add some papers to get started."
                : "No papers match your search criteria."
              }
            </div>
          ) : (
            <div className="space-y-3">
              {filteredPapers.map((libraryPaper) => {
                const isPinned = pinnedPaperIds.has(libraryPaper.paper.id)
                
                return (
                  <Card 
                    key={libraryPaper.id}
                    className={`transition-all ${isPinned ? 'ring-2 ring-primary shadow-md' : 'hover:shadow-sm'}`}
                  >
                    <CardContent className="p-4">
                      <div className="flex items-start gap-3">
                        <Button
                          variant={isPinned ? "default" : "outline"}
                          size="sm"
                          onClick={() => handlePinToggle(libraryPaper.paper.id)}
                          className="shrink-0"
                        >
                          {isPinned ? (
                            <Pin className="h-4 w-4" />
                          ) : (
                            <PinOff className="h-4 w-4" />
                          )}
                        </Button>
                        
                        <div className="flex-1 min-w-0">
                          <h4 className="font-medium text-sm leading-tight mb-1">
                            {libraryPaper.paper.title}
                          </h4>
                          
                          <div className="flex items-center gap-4 text-xs text-muted-foreground mb-2">
                            <div className="flex items-center gap-1">
                              <Users className="h-3 w-3" />
                              {formatAuthors(libraryPaper.paper.authors || [])}
                            </div>
                            {libraryPaper.paper.publication_date && (
                              <div className="flex items-center gap-1">
                                <Calendar className="h-3 w-3" />
                                {formatDate(libraryPaper.paper.publication_date)}
                              </div>
                            )}
                            {libraryPaper.paper.citation_count && (
                              <Badge variant="secondary" className="text-xs">
                                {libraryPaper.paper.citation_count} citations
                              </Badge>
                            )}
                          </div>
                          
                          {libraryPaper.paper.abstract && (
                            <p className="text-xs text-muted-foreground line-clamp-2 mb-2">
                              {libraryPaper.paper.abstract}
                            </p>
                          )}
                          
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              {libraryPaper.paper.venue && (
                                <Badge variant="outline" className="text-xs">
                                  {libraryPaper.paper.venue}
                                </Badge>
                              )}
                              {libraryPaper.paper.source && (
                                <Badge variant="outline" className="text-xs">
                                  {libraryPaper.paper.source}
                                </Badge>
                              )}
                            </div>
                            
                            <div className="flex items-center gap-1">
                              {libraryPaper.paper.url && (
                                <Button variant="ghost" size="sm" asChild>
                                  <a 
                                    href={libraryPaper.paper.url} 
                                    target="_blank" 
                                    rel="noopener noreferrer"
                                    className="p-1"
                                  >
                                    <ExternalLink className="h-3 w-3" />
                                  </a>
                                </Button>
                              )}
                            </div>
                          </div>
                          
                          {libraryPaper.notes && (
                            <div className="mt-2 p-2 bg-muted rounded text-xs">
                              <strong>Notes:</strong> {libraryPaper.notes}
                            </div>
                          )}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                )
              })}
            </div>
          )}
        </ScrollArea>
      </CardContent>
    </Card>
  )
} 
```

### `components/citations/CitationEditor.tsx`

```tsx
'use client'

import React, { useState, useEffect } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Plus, Minus, Save, X } from 'lucide-react'
import type { CSLItem, CSLAuthor } from '@/lib/utils/csl'

interface CitationEditorProps {
  citationId: string
  initialCsl?: CSLItem
  onSave: (csl: CSLItem) => void
  onCancel: () => void
}

const PUBLICATION_TYPES = [
  { value: 'article-journal', label: 'Journal Article' },
  { value: 'article', label: 'Article' },
  { value: 'book', label: 'Book' },
  { value: 'chapter', label: 'Book Chapter' },
  { value: 'paper-conference', label: 'Conference Paper' },
  { value: 'thesis', label: 'Thesis' },
  { value: 'report', label: 'Report' },
  { value: 'webpage', label: 'Web Page' },
  { value: 'manuscript', label: 'Manuscript' }
]

export function CitationEditor({ citationId, initialCsl, onSave, onCancel }: CitationEditorProps) {
  const [csl, setCsl] = useState<CSLItem>(() => {
    if (initialCsl) {
      return { ...initialCsl }
    }
    
    // Default CSL structure
    return {
      id: citationId,
      type: 'article-journal',
      title: '',
      author: [{ family: '', given: '' }],
      issued: { 'date-parts': [[new Date().getFullYear()]] }
    }
  })

  const [errors, setErrors] = useState<Record<string, string>>({})

  // Validation
  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {}

    if (!csl.title?.trim()) {
      newErrors.title = 'Title is required'
    }

    if (!csl.author || csl.author.length === 0) {
      newErrors.authors = 'At least one author is required'
    } else {
      const hasValidAuthor = csl.author.some(author => 
        (author.family && author.family.trim()) || 
        (author.literal && author.literal.trim())
      )
      if (!hasValidAuthor) {
        newErrors.authors = 'At least one author must have a name'
      }
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  // Handle form submission
  const handleSave = async () => {
    if (!validateForm()) {
      return
    }

    // Clean up the CSL object
    const cleanedCsl: CSLItem = {
      ...csl,
      title: csl.title?.trim(),
      author: csl.author?.filter(author => 
        (author.family && author.family.trim()) || 
        (author.literal && author.literal.trim())
      ).map(author => ({
        ...author,
        family: author.family?.trim() || '',
        given: author.given?.trim() || ''
      }))
    }

    // Remove empty optional fields
    Object.keys(cleanedCsl).forEach(key => {
      const value = (cleanedCsl as any)[key]
      if (value === '' || value === null || value === undefined) {
        delete (cleanedCsl as any)[key]
      }
    })

    // Save citation fields to database if this is a paper citation
    if (citationId && cleanedCsl.volume || cleanedCsl.issue || cleanedCsl.page) {
      try {
        const response = await fetch('/api/papers/update-citation', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            paperId: citationId,
            citationData: {
              volume: cleanedCsl.volume,
              issue: cleanedCsl.issue,
              page: cleanedCsl.page,
              publisher: cleanedCsl.publisher,
              isbn: cleanedCsl.ISBN,
              issn: cleanedCsl.ISSN
            }
          })
        })

        if (!response.ok) {
          console.warn('Failed to save citation fields to database')
        }
      } catch (error) {
        console.warn('Error saving citation fields:', error)
      }
    }

    onSave(cleanedCsl)
  }

  // Update basic field
  const updateField = (field: keyof CSLItem, value: any) => {
    setCsl(prev => ({ ...prev, [field]: value }))
    // Clear error for this field
    if (errors[field]) {
      setErrors(prev => ({ ...prev, [field]: '' }))
    }
  }

  // Update author
  const updateAuthor = (index: number, field: keyof CSLAuthor, value: string) => {
    setCsl(prev => ({
      ...prev,
      author: prev.author?.map((author, i) => 
        i === index ? { ...author, [field]: value } : author
      ) || []
    }))
    // Clear authors error
    if (errors.authors) {
      setErrors(prev => ({ ...prev, authors: '' }))
    }
  }

  // Add author
  const addAuthor = () => {
    setCsl(prev => ({
      ...prev,
      author: [...(prev.author || []), { family: '', given: '' }]
    }))
  }

  // Remove author
  const removeAuthor = (index: number) => {
    setCsl(prev => ({
      ...prev,
      author: prev.author?.filter((_, i) => i !== index) || []
    }))
  }

  // Update publication year
  const updateYear = (year: string) => {
    const yearNum = parseInt(year)
    if (!isNaN(yearNum) && yearNum > 0) {
      setCsl(prev => ({
        ...prev,
        issued: { 'date-parts': [[yearNum]] }
      }))
    }
  }

  // Get current year
  const getCurrentYear = (): number => {
    return csl.issued?.['date-parts']?.[0]?.[0] || new Date().getFullYear()
  }

  return (
    <Dialog open={true} onOpenChange={onCancel}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Citation</DialogTitle>
          <div className="text-sm text-gray-500">
            Citation ID: <code className="bg-gray-100 px-1 rounded">{citationId}</code>
          </div>
        </DialogHeader>

        <div className="space-y-6">
          {/* Publication Type */}
          <div className="space-y-2">
            <Label htmlFor="type">Publication Type</Label>
            <Select value={csl.type} onValueChange={(value) => updateField('type', value)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PUBLICATION_TYPES.map(type => (
                  <SelectItem key={type.value} value={type.value}>
                    {type.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Title */}
          <div className="space-y-2">
            <Label htmlFor="title">Title *</Label>
            <Input
              id="title"
              value={csl.title || ''}
              onChange={(e) => updateField('title', e.target.value)}
              placeholder="Enter the title"
              className={errors.title ? 'border-red-500' : ''}
            />
            {errors.title && (
              <p className="text-sm text-red-600">{errors.title}</p>
            )}
          </div>

          {/* Authors */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Authors *</Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addAuthor}
              >
                <Plus className="h-4 w-4 mr-1" />
                Add Author
              </Button>
            </div>
            
            {csl.author?.map((author, index) => (
              <div key={index} className="flex items-center space-x-2 p-3 border rounded-lg">
                <div className="flex-1 grid grid-cols-2 gap-2">
                  <Input
                    placeholder="First name"
                    value={author.given || ''}
                    onChange={(e) => updateAuthor(index, 'given', e.target.value)}
                  />
                  <Input
                    placeholder="Last name"
                    value={author.family || ''}
                    onChange={(e) => updateAuthor(index, 'family', e.target.value)}
                  />
                </div>
                {(csl.author?.length || 0) > 1 && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => removeAuthor(index)}
                  >
                    <Minus className="h-4 w-4" />
                  </Button>
                )}
              </div>
            ))}
            
            {errors.authors && (
              <p className="text-sm text-red-600">{errors.authors}</p>
            )}
          </div>

          {/* Publication Year */}
          <div className="space-y-2">
            <Label htmlFor="year">Publication Year</Label>
            <Input
              id="year"
              type="number"
              min="1000"
              max="2030"
              value={getCurrentYear()}
              onChange={(e) => updateYear(e.target.value)}
              placeholder="YYYY"
            />
          </div>

          {/* Journal/Container Title */}
          <div className="space-y-2">
            <Label htmlFor="container-title">
              {csl.type === 'article-journal' ? 'Journal Name' : 
               csl.type === 'book' ? 'Publisher' : 
               csl.type === 'chapter' ? 'Book Title' : 
               'Container Title'}
            </Label>
            <Input
              id="container-title"
              value={csl['container-title'] || ''}
              onChange={(e) => updateField('container-title', e.target.value)}
              placeholder={
                csl.type === 'article-journal' ? 'e.g., Nature, Science' :
                csl.type === 'book' ? 'e.g., Academic Press' :
                csl.type === 'chapter' ? 'e.g., Handbook of Research' :
                'Enter container title'
              }
            />
          </div>

          {/* Volume, Issue, Pages (for journal articles) */}
          {csl.type === 'article-journal' && (
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor="volume">Volume</Label>
                <Input
                  id="volume"
                  value={csl.volume || ''}
                  onChange={(e) => updateField('volume', e.target.value)}
                  placeholder="e.g., 123"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="issue">Issue</Label>
                <Input
                  id="issue"
                  value={csl.issue || ''}
                  onChange={(e) => updateField('issue', e.target.value)}
                  placeholder="e.g., 4"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="page">Pages</Label>
                <Input
                  id="page"
                  value={csl.page || ''}
                  onChange={(e) => updateField('page', e.target.value)}
                  placeholder="e.g., 123-145"
                />
              </div>
            </div>
          )}

          {/* DOI */}
          <div className="space-y-2">
            <Label htmlFor="doi">DOI</Label>
            <Input
              id="doi"
              value={csl.DOI || ''}
              onChange={(e) => updateField('DOI', e.target.value)}
              placeholder="e.g., 10.1000/182"
            />
          </div>

          {/* URL */}
          <div className="space-y-2">
            <Label htmlFor="url">URL</Label>
            <Input
              id="url"
              type="url"
              value={csl.URL || ''}
              onChange={(e) => updateField('URL', e.target.value)}
              placeholder="https://example.com"
            />
          </div>

          {/* Abstract */}
          <div className="space-y-2">
            <Label htmlFor="abstract">Abstract</Label>
            <Textarea
              id="abstract"
              value={csl.abstract || ''}
              onChange={(e) => updateField('abstract', e.target.value)}
              placeholder="Enter abstract (optional)"
              rows={3}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            <X className="h-4 w-4 mr-1" />
            Cancel
          </Button>
          <Button onClick={handleSave}>
            <Save className="h-4 w-4 mr-1" />
            Save Citation
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
} 
```

### `components/citations/InteractiveCitationRenderer.tsx`

```tsx
'use client'

import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Loader2, BookOpen, RefreshCw } from 'lucide-react'
import { 
  citationEngine, 
  type DocumentCitationContext, 
  type CitationRenderOptions,
  type CitationStyleInfo,
  type InteractiveCitation
} from '@/lib/citations/engine'
import type { CSLItem } from '@/lib/utils/csl'
import { CitationEditor } from './CitationEditor'

// Global window type extension
declare global {
  interface Window {
    handleCitationClick?: (citationId: string) => void
  }
}

interface InteractiveCitationRendererProps {
  content: string
  citations: Map<string, CSLItem>
  documentId: string
  initialStyle?: string
  locale?: string
  onContentChange?: (content: string) => void
  onCitationUpdate?: (citationId: string, csl: CSLItem) => void
  onStyleChange?: (style: string) => void
  className?: string
}

export function InteractiveCitationRenderer({
  content,
  citations,
  documentId,
  initialStyle = 'apa',
  locale = 'en-US',
  onContentChange,
  onCitationUpdate,
  onStyleChange,
  className = ''
}: InteractiveCitationRendererProps) {
  const [currentStyle, setCurrentStyle] = useState(initialStyle)
  const [availableStyles, setAvailableStyles] = useState<CitationStyleInfo[]>([])
  const [renderedContent, setRenderedContent] = useState('')
  const [bibliography, setBibliography] = useState('')
  const [interactiveCitations, setInteractiveCitations] = useState<InteractiveCitation[]>([])
  const [missingCitations, setMissingCitations] = useState<string[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isChangingStyle, setIsChangingStyle] = useState(false)
  const [editingCitation, setEditingCitation] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Create document context
  const documentContext: DocumentCitationContext = useMemo(() => ({
    documentId,
    citations,
    currentStyle,
    locale
  }), [documentId, citations, currentStyle, locale])

  // Render options
  const renderOptions: CitationRenderOptions = useMemo(() => ({
    style: currentStyle,
    format: 'html',
    locale,
    interactive: true,
    highlightEditable: true
  }), [currentStyle, locale])

  // Load available citation styles
  useEffect(() => {
    const loadStyles = async () => {
      try {
        const styles = await citationEngine.getAvailableStyles()
        setAvailableStyles(styles)
      } catch (error) {
        console.error('Failed to load citation styles:', error)
        setError('Failed to load citation styles')
      }
    }
    loadStyles()
  }, [])

  // Render document with citations
  const renderDocument = useCallback(async () => {
    if (citations.size === 0) {
      setRenderedContent(content)
      setBibliography('')
      setInteractiveCitations([])
      setMissingCitations([])
      setIsLoading(false)
      return
    }

    try {
      setError(null)
      const result = await citationEngine.renderDocument(
        content,
        documentContext,
        renderOptions
      )

      // Convert <button> interactive citations to inline <span> for cleaner typography
      const cleanedContent = result.renderedContent
        .replace(/<button([^>]+)>([^<]+)<\/button>/g, '<span $1 style="background:none;border:none;padding:0;margin:0;color:inherit;text-decoration:underline;cursor:pointer">$2</span>')

      setRenderedContent(cleanedContent)
      setBibliography(result.bibliography)
      setInteractiveCitations(result.citations)
      setMissingCitations(result.missingCitations)
      
      // Notify parent of content change
      onContentChange?.(result.renderedContent)
      
    } catch (error) {
      console.error('Failed to render document:', error)
      setError('Failed to render citations')
      setRenderedContent(content) // Fallback to original content
    } finally {
      setIsLoading(false)
      setIsChangingStyle(false)
    }
  }, [content, documentContext, renderOptions, onContentChange])

  // Initial render and re-render on changes
  useEffect(() => {
    setIsLoading(true)
    renderDocument()
  }, [renderDocument])

  // Handle citation style change
  const handleStyleChange = async (newStyle: string) => {
    if (newStyle === currentStyle) return

    setIsChangingStyle(true)
    setCurrentStyle(newStyle)
    onStyleChange?.(newStyle)

    try {
      const result = await citationEngine.changeDocumentStyle(
        content,
        documentContext,
        newStyle,
        { format: 'html', locale, interactive: true, highlightEditable: true }
      )

      setRenderedContent(result.renderedContent)
      setBibliography(result.bibliography)
      setInteractiveCitations(result.citations)
      onContentChange?.(result.renderedContent)
      
    } catch (error) {
      console.error('Failed to change citation style:', error)
      setError('Failed to change citation style')
    } finally {
      setIsChangingStyle(false)
    }
  }

  // Handle citation click for editing
  const handleCitationClick = useCallback((citationId: string) => {
    setEditingCitation(citationId)
  }, [citations.size])

  // Handle citation update
  const handleCitationUpdate = async (citationId: string, newCsl: CSLItem) => {
    try {
      const updatedCitation = await citationEngine.updateCitation(
        citationId,
        newCsl,
        documentContext,
        renderOptions
      )

      // Update local state
      setInteractiveCitations(prev => 
        prev.map(citation => 
          citation.id === citationId ? updatedCitation : citation
        )
      )

      // Notify parent
      onCitationUpdate?.(citationId, newCsl)
      
      // Re-render document
      await renderDocument()
      
    } catch (error) {
      console.error('Failed to update citation:', error)
      setError('Failed to update citation')
    } finally {
      setEditingCitation(null)
    }
  }

  // Set up global citation click handler
  useEffect(() => {
    window.handleCitationClick = handleCitationClick
    return () => {
      delete window.handleCitationClick
    }
  }, [handleCitationClick])

  // Get current style info
  const currentStyleInfo = availableStyles.find(style => style.id === currentStyle)

  if (isLoading) {
    return (
      <div className={`flex items-center justify-center p-8 ${className}`}>
        <Loader2 className="h-6 w-6 animate-spin mr-2" />
        <span>Rendering citations...</span>
      </div>
    )
  }

  return (
    <div className={`space-y-6 ${className}`}>
      {/* Citation Controls */}
      <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg border">
        <div className="flex items-center space-x-4">
          <div className="flex items-center space-x-2">
            <BookOpen className="h-4 w-4 text-gray-600" />
            <span className="text-sm font-medium text-gray-700">Citation Style:</span>
          </div>
          
          <Select value={currentStyle} onValueChange={handleStyleChange} disabled={isChangingStyle}>
            <SelectTrigger className="w-64">
              <SelectValue>
                {isChangingStyle ? (
                  <div className="flex items-center">
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    Changing style...
                  </div>
                ) : (
                  currentStyleInfo?.name || currentStyle
                )}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {availableStyles.map((style) => (
                <SelectItem key={style.id} value={style.id}>
                  <div className="flex items-center justify-between w-full">
                    <span>{style.name}</span>
                    <Badge variant="outline" className="ml-2 text-xs">
                      {style.category}
                    </Badge>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {currentStyleInfo && (
            <div className="text-sm text-gray-500">
              Example: <code className="bg-gray-100 px-1 rounded">{currentStyleInfo.example}</code>
            </div>
          )}
        </div>

        <div className="flex items-center space-x-2">
          <Badge variant="secondary">
            {interactiveCitations.length} citations
          </Badge>
          
          {missingCitations.length > 0 && (
            <Badge variant="destructive">
              {missingCitations.length} missing
            </Badge>
          )}

          <Button
            variant="outline"
            size="sm"
            onClick={renderDocument}
            disabled={isLoading || isChangingStyle}
          >
            <RefreshCw className="h-4 w-4 mr-1" />
            Refresh
          </Button>
        </div>
      </div>

      {/* Error Display */}
      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
          <p className="text-red-800 text-sm">{error}</p>
        </div>
      )}

      {/* Missing Citations Warning */}
      {missingCitations.length > 0 && (
        <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
          <p className="text-yellow-800 text-sm font-medium mb-2">
            Missing Citations ({missingCitations.length}):
          </p>
          <div className="flex flex-wrap gap-1">
            {missingCitations.map(id => (
              <Badge key={id} variant="outline" className="text-yellow-700 border-yellow-300">
                {id.slice(0, 8)}...
              </Badge>
            ))}
          </div>
        </div>
      )}

      {/* Rendered Content */}
      <div className="prose max-w-none">
        <div 
          className="citation-content"
          dangerouslySetInnerHTML={{ __html: renderedContent }}
        />
      </div>

      {/* Bibliography */}
      {bibliography && (
        <div className="border-t pt-6">
          <h3 className="text-lg font-semibold mb-4">References</h3>
          <div 
            className="prose max-w-none text-sm"
            dangerouslySetInnerHTML={{ __html: bibliography }}
          />
        </div>
      )}

      {/* Citation Editor Modal */}
      {editingCitation && (
        <CitationEditor
          citationId={editingCitation}
          initialCsl={citations.get(editingCitation)}
          onSave={(csl: CSLItem) => handleCitationUpdate(editingCitation, csl)}
          onCancel={() => setEditingCitation(null)}
        />
      )}

      {/* Custom Styles for Citation Links */}
      <style jsx global>{`
        .citation-content .citation-link {
          transition: all 0.2s ease;
          text-decoration: none;
          border-radius: 4px;
        }
        
        .citation-content .citation-link:hover {
          transform: translateY(-1px);
          box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
        }
        
        .citation-content .citation-link:active {
          transform: translateY(0);
        }
        
        .citation-content .citation-link:focus {
          outline: 2px solid #3b82f6;
          outline-offset: 2px;
        }
      `}</style>
    </div>
  )
} 
```

### `components/ui/RegionSelector.tsx`

```tsx
/**
 * Region Selector Component
 * 
 * Provides user-friendly controls for region detection:
 * - Toggle for enabling/disabling auto-detection
 * - Dropdown for manual region selection
 * - Integration with the flexible region system
 */

'use client'

import { useState, useEffect } from 'react'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Info } from 'lucide-react'
import { createRegionOptions, parseUserRegionSelection, type RegionDetectionOptions } from '@/lib/utils/region-detection-flexible'

interface RegionSelectorProps {
  value?: string
  onChange?: (options: RegionDetectionOptions) => void
  showDescription?: boolean
  className?: string
}

export function RegionSelector({ 
  value = '', 
  onChange, 
  showDescription = true, 
  className 
}: RegionSelectorProps) {
  const [selectedValue, setSelectedValue] = useState(value)
  const [regionOptions, setRegionOptions] = useState<Array<{
    value: string
    label: string
    category?: string
  }>>([])

  // Load region options on mount
  useEffect(() => {
    const options = createRegionOptions(true)
    setRegionOptions(options)
  }, [])

  // Handle selection change
  const handleSelectionChange = (newValue: string) => {
    setSelectedValue(newValue)
    
    if (onChange) {
      const detectionOptions = parseUserRegionSelection(newValue)
      onChange(detectionOptions)
    }
  }

  // Get current selection info
  const getCurrentInfo = () => {
    if (!selectedValue || selectedValue === '') {
      return {
        type: 'disabled',
        description: 'No regional focus - papers from all regions will be treated equally',
        badge: 'Global'
      }
    }
    
    if (selectedValue === '__auto__') {
      return {
        type: 'auto',
        description: 'Automatically detect region from paper venue, URL, and author affiliations',
        badge: 'Auto-detect'
      }
    }
    
    const selectedOption = regionOptions.find(opt => opt.value === selectedValue)
    return {
      type: 'manual',
      description: `Focus specifically on research from ${selectedOption?.label || selectedValue}`,
      badge: selectedOption?.label || selectedValue
    }
  }

  const currentInfo = getCurrentInfo()

  return (
    <Card className={className}>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          Regional Focus
          <Badge variant={currentInfo.type === 'disabled' ? 'outline' : 'default'}>
            {currentInfo.badge}
          </Badge>
        </CardTitle>
        {showDescription && (
          <CardDescription className="text-sm">
            Choose how to handle regional context in your research
          </CardDescription>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="region-select">Region Selection</Label>
          <Select value={selectedValue} onValueChange={handleSelectionChange}>
            <SelectTrigger id="region-select">
              <SelectValue placeholder="Choose regional focus..." />
            </SelectTrigger>
            <SelectContent>
              {/* No regional focus */}
              <SelectItem value="">
                <div className="flex items-center gap-2">
                  <span>🌍</span>
                  <span>No regional focus</span>
                </div>
              </SelectItem>
              
              {/* Auto-detect */}
              <SelectItem value="__auto__">
                <div className="flex items-center gap-2">
                  <span>🔍</span>
                  <span>Auto-detect from paper content</span>
                </div>
              </SelectItem>
              
              {/* Specific regions */}
              {regionOptions
                .filter(opt => opt.category === 'Specific Regions')
                .map(option => (
                  <SelectItem key={option.value} value={option.value}>
                    <div className="flex items-center gap-2">
                      <span>📍</span>
                      <span>{option.label}</span>
                    </div>
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        </div>

        {/* Current selection info */}
        <div className="rounded-lg bg-muted/50 p-3">
          <div className="flex items-start gap-2">
            <Info className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
            <div className="text-sm text-muted-foreground">
              {currentInfo.description}
            </div>
          </div>
        </div>

        {/* Additional info for auto-detect */}
        {selectedValue === '__auto__' && (
          <div className="text-xs text-muted-foreground space-y-1">
            <p><strong>Detection sources (in order):</strong></p>
            <ul className="ml-4 space-y-0.5">
              <li>• Journal venue names</li>
              <li>• Website domains (.ng, .gh, etc.)</li>
              <li>• Author affiliations</li>
              <li>• Author names (limited)</li>
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// Export type for use in parent components
export type { RegionDetectionOptions } 
```

### `components/ui/alert.tsx`

```tsx
import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const alertVariants = cva(
  "relative w-full rounded-lg border px-4 py-3 text-sm grid has-[>svg]:grid-cols-[calc(var(--spacing)*4)_1fr] grid-cols-[0_1fr] has-[>svg]:gap-x-3 gap-y-0.5 items-start [&>svg]:size-4 [&>svg]:translate-y-0.5 [&>svg]:text-current",
  {
    variants: {
      variant: {
        default: "bg-card text-card-foreground",
        destructive:
          "text-destructive bg-card [&>svg]:text-current *:data-[slot=alert-description]:text-destructive/90",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Alert({
  className,
  variant,
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof alertVariants>) {
  return (
    <div
      data-slot="alert"
      role="alert"
      className={cn(alertVariants({ variant }), className)}
      {...props}
    />
  )
}

function AlertTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-title"
      className={cn(
        "col-start-2 line-clamp-1 min-h-4 font-medium tracking-tight",
        className
      )}
      {...props}
    />
  )
}

function AlertDescription({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-description"
      className={cn(
        "text-muted-foreground col-start-2 grid justify-items-start gap-1 text-sm [&_p]:leading-relaxed",
        className
      )}
      {...props}
    />
  )
}

export { Alert, AlertTitle, AlertDescription }

```

### `components/ui/avatar.tsx`

```tsx
"use client"

import * as React from "react"
import * as AvatarPrimitive from "@radix-ui/react-avatar"

import { cn } from "@/lib/utils"

function Avatar({
  className,
  ...props
}: React.ComponentProps<typeof AvatarPrimitive.Root>) {
  return (
    <AvatarPrimitive.Root
      data-slot="avatar"
      className={cn(
        "relative flex size-8 shrink-0 overflow-hidden rounded-full",
        className
      )}
      {...props}
    />
  )
}

function AvatarImage({
  className,
  ...props
}: React.ComponentProps<typeof AvatarPrimitive.Image>) {
  return (
    <AvatarPrimitive.Image
      data-slot="avatar-image"
      className={cn("aspect-square size-full", className)}
      {...props}
    />
  )
}

function AvatarFallback({
  className,
  ...props
}: React.ComponentProps<typeof AvatarPrimitive.Fallback>) {
  return (
    <AvatarPrimitive.Fallback
      data-slot="avatar-fallback"
      className={cn(
        "bg-muted flex size-full items-center justify-center rounded-full",
        className
      )}
      {...props}
    />
  )
}

export { Avatar, AvatarImage, AvatarFallback }

```

### `components/ui/badge.tsx`

```tsx
import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "inline-flex items-center justify-center rounded-md border px-2 py-0.5 text-xs font-medium w-fit whitespace-nowrap shrink-0 [&>svg]:size-3 gap-1 [&>svg]:pointer-events-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive transition-[color,box-shadow] overflow-hidden",
  {
    variants: {
      variant: {
        default:
          "border-transparent bg-primary text-primary-foreground [a&]:hover:bg-primary/90",
        secondary:
          "border-transparent bg-secondary text-secondary-foreground [a&]:hover:bg-secondary/90",
        destructive:
          "border-transparent bg-destructive text-white [a&]:hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40 dark:bg-destructive/60",
        outline:
          "text-foreground [a&]:hover:bg-accent [a&]:hover:text-accent-foreground",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant,
  asChild = false,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "span"

  return (
    <Comp
      data-slot="badge"
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  )
}

export { Badge, badgeVariants }

```

### `components/ui/breadcrumb.tsx`

```tsx
import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { ChevronRight, MoreHorizontal } from "lucide-react"

import { cn } from "@/lib/utils"

function Breadcrumb({ ...props }: React.ComponentProps<"nav">) {
  return <nav aria-label="breadcrumb" data-slot="breadcrumb" {...props} />
}

function BreadcrumbList({ className, ...props }: React.ComponentProps<"ol">) {
  return (
    <ol
      data-slot="breadcrumb-list"
      className={cn(
        "text-muted-foreground flex flex-wrap items-center gap-1.5 text-sm break-words sm:gap-2.5",
        className
      )}
      {...props}
    />
  )
}

function BreadcrumbItem({ className, ...props }: React.ComponentProps<"li">) {
  return (
    <li
      data-slot="breadcrumb-item"
      className={cn("inline-flex items-center gap-1.5", className)}
      {...props}
    />
  )
}

function BreadcrumbLink({
  asChild,
  className,
  ...props
}: React.ComponentProps<"a"> & {
  asChild?: boolean
}) {
  const Comp = asChild ? Slot : "a"

  return (
    <Comp
      data-slot="breadcrumb-link"
      className={cn("hover:text-foreground transition-colors", className)}
      {...props}
    />
  )
}

function BreadcrumbPage({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="breadcrumb-page"
      role="link"
      aria-disabled="true"
      aria-current="page"
      className={cn("text-foreground font-normal", className)}
      {...props}
    />
  )
}

function BreadcrumbSeparator({
  children,
  className,
  ...props
}: React.ComponentProps<"li">) {
  return (
    <li
      data-slot="breadcrumb-separator"
      role="presentation"
      aria-hidden="true"
      className={cn("[&>svg]:size-3.5", className)}
      {...props}
    >
      {children ?? <ChevronRight />}
    </li>
  )
}

function BreadcrumbEllipsis({
  className,
  ...props
}: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="breadcrumb-ellipsis"
      role="presentation"
      aria-hidden="true"
      className={cn("flex size-9 items-center justify-center", className)}
      {...props}
    >
      <MoreHorizontal className="size-4" />
      <span className="sr-only">More</span>
    </span>
  )
}

export {
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbPage,
  BreadcrumbSeparator,
  BreadcrumbEllipsis,
}

```

### `components/ui/button.tsx`

```tsx
import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-all disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground shadow-xs hover:bg-primary/90",
        destructive:
          "bg-destructive text-white shadow-xs hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40 dark:bg-destructive/60",
        outline:
          "border bg-background shadow-xs hover:bg-accent hover:text-accent-foreground dark:bg-input/30 dark:border-input dark:hover:bg-input/50",
        secondary:
          "bg-secondary text-secondary-foreground shadow-xs hover:bg-secondary/80",
        ghost:
          "hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/50",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-4 py-2 has-[>svg]:px-3",
        sm: "h-8 rounded-md gap-1.5 px-3 has-[>svg]:px-2.5",
        lg: "h-10 rounded-md px-6 has-[>svg]:px-4",
        icon: "size-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot : "button"

  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }

```

### `components/ui/calendar.tsx`

```tsx
"use client"

import * as React from "react"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { DayPicker } from "react-day-picker"

import { cn } from "@/lib/utils"
import { buttonVariants } from "@/components/ui/button"

function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  ...props
}: React.ComponentProps<typeof DayPicker>) {
  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cn("p-3", className)}
      classNames={{
        months: "flex flex-col sm:flex-row gap-2",
        month: "flex flex-col gap-4",
        caption: "flex justify-center pt-1 relative items-center w-full",
        caption_label: "text-sm font-medium",
        nav: "flex items-center gap-1",
        nav_button: cn(
          buttonVariants({ variant: "outline" }),
          "size-7 bg-transparent p-0 opacity-50 hover:opacity-100"
        ),
        nav_button_previous: "absolute left-1",
        nav_button_next: "absolute right-1",
        table: "w-full border-collapse space-x-1",
        head_row: "flex",
        head_cell:
          "text-muted-foreground rounded-md w-8 font-normal text-[0.8rem]",
        row: "flex w-full mt-2",
        cell: cn(
          "relative p-0 text-center text-sm focus-within:relative focus-within:z-20 [&:has([aria-selected])]:bg-accent [&:has([aria-selected].day-range-end)]:rounded-r-md",
          props.mode === "range"
            ? "[&:has(>.day-range-end)]:rounded-r-md [&:has(>.day-range-start)]:rounded-l-md first:[&:has([aria-selected])]:rounded-l-md last:[&:has([aria-selected])]:rounded-r-md"
            : "[&:has([aria-selected])]:rounded-md"
        ),
        day: cn(
          buttonVariants({ variant: "ghost" }),
          "size-8 p-0 font-normal aria-selected:opacity-100"
        ),
        day_range_start:
          "day-range-start aria-selected:bg-primary aria-selected:text-primary-foreground",
        day_range_end:
          "day-range-end aria-selected:bg-primary aria-selected:text-primary-foreground",
        day_selected:
          "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground focus:bg-primary focus:text-primary-foreground",
        day_today: "bg-accent text-accent-foreground",
        day_outside:
          "day-outside text-muted-foreground aria-selected:text-muted-foreground",
        day_disabled: "text-muted-foreground opacity-50",
        day_range_middle:
          "aria-selected:bg-accent aria-selected:text-accent-foreground",
        day_hidden: "invisible",
        ...classNames,
      }}
      components={{
        Chevron: ({ orientation, className, ...props }) => {
          const Icon = orientation === "left" ? ChevronLeft : ChevronRight;
          return <Icon className={cn("size-4", className)} {...props} />;
        },
      }}
      {...props}
    />
  )
}

export { Calendar }

```

### `components/ui/card.tsx`

```tsx
import * as React from "react"

import { cn } from "@/lib/utils"

function Card({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card"
      className={cn(
        "bg-card text-card-foreground flex flex-col gap-6 rounded-xl border py-6",
        className
      )}
      {...props}
    />
  )
}

function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-header"
      className={cn(
        "@container/card-header grid auto-rows-min grid-rows-[auto_auto] items-start gap-1.5 px-6 has-data-[slot=card-action]:grid-cols-[1fr_auto] [.border-b]:pb-6",
        className
      )}
      {...props}
    />
  )
}

function CardTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-title"
      className={cn("leading-none font-semibold", className)}
      {...props}
    />
  )
}

function CardDescription({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-description"
      className={cn("text-muted-foreground text-sm", className)}
      {...props}
    />
  )
}

function CardAction({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-action"
      className={cn(
        "col-start-2 row-span-2 row-start-1 self-start justify-self-end",
        className
      )}
      {...props}
    />
  )
}

function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-content"
      className={cn("px-6", className)}
      {...props}
    />
  )
}

function CardFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-footer"
      className={cn("flex items-center px-6 [.border-t]:pt-6", className)}
      {...props}
    />
  )
}

export {
  Card,
  CardHeader,
  CardFooter,
  CardTitle,
  CardAction,
  CardDescription,
  CardContent,
}

```

### `components/ui/checkbox.tsx`

```tsx
"use client"

import * as React from "react"
import * as CheckboxPrimitive from "@radix-ui/react-checkbox"
import { CheckIcon } from "lucide-react"

import { cn } from "@/lib/utils"

function Checkbox({
  className,
  ...props
}: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        "peer border-input dark:bg-input/30 data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground dark:data-[state=checked]:bg-primary data-[state=checked]:border-primary focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive size-4 shrink-0 rounded-[4px] border shadow-xs transition-shadow outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        data-slot="checkbox-indicator"
        className="flex items-center justify-center text-current transition-none"
      >
        <CheckIcon className="size-3.5" />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
}

export { Checkbox }

```

### `components/ui/collapsible.tsx`

```tsx
"use client"

import * as CollapsiblePrimitive from "@radix-ui/react-collapsible"

function Collapsible({
  ...props
}: React.ComponentProps<typeof CollapsiblePrimitive.Root>) {
  return <CollapsiblePrimitive.Root data-slot="collapsible" {...props} />
}

function CollapsibleTrigger({
  ...props
}: React.ComponentProps<typeof CollapsiblePrimitive.CollapsibleTrigger>) {
  return (
    <CollapsiblePrimitive.CollapsibleTrigger
      data-slot="collapsible-trigger"
      {...props}
    />
  )
}

function CollapsibleContent({
  ...props
}: React.ComponentProps<typeof CollapsiblePrimitive.CollapsibleContent>) {
  return (
    <CollapsiblePrimitive.CollapsibleContent
      data-slot="collapsible-content"
      {...props}
    />
  )
}

export { Collapsible, CollapsibleTrigger, CollapsibleContent }

```

### `components/ui/command.tsx`

```tsx
"use client"

import * as React from "react"
import { Command as CommandPrimitive } from "cmdk"
import { SearchIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

function Command({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive>) {
  return (
    <CommandPrimitive
      data-slot="command"
      className={cn(
        "bg-popover text-popover-foreground flex h-full w-full flex-col overflow-hidden rounded-md",
        className
      )}
      {...props}
    />
  )
}

function CommandDialog({
  title = "Command Palette",
  description = "Search for a command to run...",
  children,
  ...props
}: React.ComponentProps<typeof Dialog> & {
  title?: string
  description?: string
}) {
  return (
    <Dialog {...props}>
      <DialogHeader className="sr-only">
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
      </DialogHeader>
      <DialogContent className="overflow-hidden p-0">
        <Command className="[&_[cmdk-group-heading]]:text-muted-foreground **:data-[slot=command-input-wrapper]:h-12 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group]]:px-2 [&_[cmdk-group]:not([hidden])_~[cmdk-group]]:pt-0 [&_[cmdk-input-wrapper]_svg]:h-5 [&_[cmdk-input-wrapper]_svg]:w-5 [&_[cmdk-input]]:h-12 [&_[cmdk-item]]:px-2 [&_[cmdk-item]]:py-3 [&_[cmdk-item]_svg]:h-5 [&_[cmdk-item]_svg]:w-5">
          {children}
        </Command>
      </DialogContent>
    </Dialog>
  )
}

function CommandInput({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Input>) {
  return (
    <div
      data-slot="command-input-wrapper"
      className="flex h-9 items-center gap-2 border-b px-3"
    >
      <SearchIcon className="size-4 shrink-0 opacity-50" />
      <CommandPrimitive.Input
        data-slot="command-input"
        className={cn(
          "placeholder:text-muted-foreground flex h-10 w-full rounded-md bg-transparent py-3 text-sm outline-hidden disabled:cursor-not-allowed disabled:opacity-50",
          className
        )}
        {...props}
      />
    </div>
  )
}

function CommandList({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.List>) {
  return (
    <CommandPrimitive.List
      data-slot="command-list"
      className={cn(
        "max-h-[300px] scroll-py-1 overflow-x-hidden overflow-y-auto",
        className
      )}
      {...props}
    />
  )
}

function CommandEmpty({
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Empty>) {
  return (
    <CommandPrimitive.Empty
      data-slot="command-empty"
      className="py-6 text-center text-sm"
      {...props}
    />
  )
}

function CommandGroup({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Group>) {
  return (
    <CommandPrimitive.Group
      data-slot="command-group"
      className={cn(
        "text-foreground [&_[cmdk-group-heading]]:text-muted-foreground overflow-hidden p-1 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium",
        className
      )}
      {...props}
    />
  )
}

function CommandSeparator({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Separator>) {
  return (
    <CommandPrimitive.Separator
      data-slot="command-separator"
      className={cn("bg-border -mx-1 h-px", className)}
      {...props}
    />
  )
}

function CommandItem({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Item>) {
  return (
    <CommandPrimitive.Item
      data-slot="command-item"
      className={cn(
        "data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground [&_svg:not([class*='text-'])]:text-muted-foreground relative flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-hidden select-none data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    />
  )
}

function CommandShortcut({
  className,
  ...props
}: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="command-shortcut"
      className={cn(
        "text-muted-foreground ml-auto text-xs tracking-widest",
        className
      )}
      {...props}
    />
  )
}

export {
  Command,
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandShortcut,
  CommandSeparator,
}

```

### `components/ui/dialog.tsx`

```tsx
"use client"

import * as React from "react"
import * as DialogPrimitive from "@radix-ui/react-dialog"
import { XIcon } from "lucide-react"

import { cn } from "@/lib/utils"

function Dialog({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />
}

function DialogTrigger({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

function DialogPortal({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Portal>) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />
}

function DialogClose({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

function DialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      className={cn(
        "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed inset-0 z-50 bg-black/50",
        className
      )}
      {...props}
    />
  )
}

function DialogContent({
  className,
  children,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content>) {
  return (
    <DialogPortal data-slot="dialog-portal">
      <DialogOverlay />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        className={cn(
          "bg-background data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 fixed top-[50%] left-[50%] z-50 grid w-full max-w-[calc(100%-2rem)] translate-x-[-50%] translate-y-[-50%] gap-4 rounded-lg border p-6 shadow-lg duration-200 sm:max-w-lg",
          className
        )}
        {...props}
      >
        {children}
        <DialogPrimitive.Close className="ring-offset-background focus:ring-ring data-[state=open]:bg-accent data-[state=open]:text-muted-foreground absolute top-4 right-4 rounded-xs opacity-70 transition-opacity hover:opacity-100 focus:ring-2 focus:ring-offset-2 focus:outline-hidden disabled:pointer-events-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4">
          <XIcon />
          <span className="sr-only">Close</span>
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPortal>
  )
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("flex flex-col gap-2 text-center sm:text-left", className)}
      {...props}
    />
  )
}

function DialogFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        "flex flex-col-reverse gap-2 sm:flex-row sm:justify-end",
        className
      )}
      {...props}
    />
  )
}

function DialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn("text-lg leading-none font-semibold", className)}
      {...props}
    />
  )
}

function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn("text-muted-foreground text-sm", className)}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
}

```

### `components/ui/dropdown-menu.tsx`

```tsx
"use client"

import * as React from "react"
import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu"
import { CheckIcon, ChevronRightIcon, CircleIcon } from "lucide-react"

import { cn } from "@/lib/utils"

function DropdownMenu({
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Root>) {
  return <DropdownMenuPrimitive.Root data-slot="dropdown-menu" {...props} />
}

function DropdownMenuPortal({
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Portal>) {
  return (
    <DropdownMenuPrimitive.Portal data-slot="dropdown-menu-portal" {...props} />
  )
}

function DropdownMenuTrigger({
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Trigger>) {
  return (
    <DropdownMenuPrimitive.Trigger
      data-slot="dropdown-menu-trigger"
      {...props}
    />
  )
}

function DropdownMenuContent({
  className,
  sideOffset = 4,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Content>) {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        data-slot="dropdown-menu-content"
        sideOffset={sideOffset}
        className={cn(
          "bg-popover text-popover-foreground data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 z-50 max-h-(--radix-dropdown-menu-content-available-height) min-w-[8rem] origin-(--radix-dropdown-menu-content-transform-origin) overflow-x-hidden overflow-y-auto rounded-md border p-1 shadow-md",
          className
        )}
        {...props}
      />
    </DropdownMenuPrimitive.Portal>
  )
}

function DropdownMenuGroup({
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Group>) {
  return (
    <DropdownMenuPrimitive.Group data-slot="dropdown-menu-group" {...props} />
  )
}

function DropdownMenuItem({
  className,
  inset,
  variant = "default",
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Item> & {
  inset?: boolean
  variant?: "default" | "destructive"
}) {
  return (
    <DropdownMenuPrimitive.Item
      data-slot="dropdown-menu-item"
      data-inset={inset}
      data-variant={variant}
      className={cn(
        "focus:bg-accent focus:text-accent-foreground data-[variant=destructive]:text-destructive data-[variant=destructive]:focus:bg-destructive/10 dark:data-[variant=destructive]:focus:bg-destructive/20 data-[variant=destructive]:focus:text-destructive data-[variant=destructive]:*:[svg]:!text-destructive [&_svg:not([class*='text-'])]:text-muted-foreground relative flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-hidden select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[inset]:pl-8 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    />
  )
}

function DropdownMenuCheckboxItem({
  className,
  children,
  checked,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.CheckboxItem>) {
  return (
    <DropdownMenuPrimitive.CheckboxItem
      data-slot="dropdown-menu-checkbox-item"
      className={cn(
        "focus:bg-accent focus:text-accent-foreground relative flex cursor-default items-center gap-2 rounded-sm py-1.5 pr-2 pl-8 text-sm outline-hidden select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      checked={checked}
      {...props}
    >
      <span className="pointer-events-none absolute left-2 flex size-3.5 items-center justify-center">
        <DropdownMenuPrimitive.ItemIndicator>
          <CheckIcon className="size-4" />
        </DropdownMenuPrimitive.ItemIndicator>
      </span>
      {children}
    </DropdownMenuPrimitive.CheckboxItem>
  )
}

function DropdownMenuRadioGroup({
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.RadioGroup>) {
  return (
    <DropdownMenuPrimitive.RadioGroup
      data-slot="dropdown-menu-radio-group"
      {...props}
    />
  )
}

function DropdownMenuRadioItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.RadioItem>) {
  return (
    <DropdownMenuPrimitive.RadioItem
      data-slot="dropdown-menu-radio-item"
      className={cn(
        "focus:bg-accent focus:text-accent-foreground relative flex cursor-default items-center gap-2 rounded-sm py-1.5 pr-2 pl-8 text-sm outline-hidden select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    >
      <span className="pointer-events-none absolute left-2 flex size-3.5 items-center justify-center">
        <DropdownMenuPrimitive.ItemIndicator>
          <CircleIcon className="size-2 fill-current" />
        </DropdownMenuPrimitive.ItemIndicator>
      </span>
      {children}
    </DropdownMenuPrimitive.RadioItem>
  )
}

function DropdownMenuLabel({
  className,
  inset,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Label> & {
  inset?: boolean
}) {
  return (
    <DropdownMenuPrimitive.Label
      data-slot="dropdown-menu-label"
      data-inset={inset}
      className={cn(
        "px-2 py-1.5 text-sm font-medium data-[inset]:pl-8",
        className
      )}
      {...props}
    />
  )
}

function DropdownMenuSeparator({
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Separator>) {
  return (
    <DropdownMenuPrimitive.Separator
      data-slot="dropdown-menu-separator"
      className={cn("bg-border -mx-1 my-1 h-px", className)}
      {...props}
    />
  )
}

function DropdownMenuShortcut({
  className,
  ...props
}: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="dropdown-menu-shortcut"
      className={cn(
        "text-muted-foreground ml-auto text-xs tracking-widest",
        className
      )}
      {...props}
    />
  )
}

function DropdownMenuSub({
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Sub>) {
  return <DropdownMenuPrimitive.Sub data-slot="dropdown-menu-sub" {...props} />
}

function DropdownMenuSubTrigger({
  className,
  inset,
  children,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.SubTrigger> & {
  inset?: boolean
}) {
  return (
    <DropdownMenuPrimitive.SubTrigger
      data-slot="dropdown-menu-sub-trigger"
      data-inset={inset}
      className={cn(
        "focus:bg-accent focus:text-accent-foreground data-[state=open]:bg-accent data-[state=open]:text-accent-foreground flex cursor-default items-center rounded-sm px-2 py-1.5 text-sm outline-hidden select-none data-[inset]:pl-8",
        className
      )}
      {...props}
    >
      {children}
      <ChevronRightIcon className="ml-auto size-4" />
    </DropdownMenuPrimitive.SubTrigger>
  )
}

function DropdownMenuSubContent({
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.SubContent>) {
  return (
    <DropdownMenuPrimitive.SubContent
      data-slot="dropdown-menu-sub-content"
      className={cn(
        "bg-popover text-popover-foreground data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 z-50 min-w-[8rem] origin-(--radix-dropdown-menu-content-transform-origin) overflow-hidden rounded-md border p-1 shadow-lg",
        className
      )}
      {...props}
    />
  )
}

export {
  DropdownMenu,
  DropdownMenuPortal,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
}

```

### `components/ui/form.tsx`

```tsx
"use client"

import * as React from "react"
import * as LabelPrimitive from "@radix-ui/react-label"
import { Slot } from "@radix-ui/react-slot"
import {
  Controller,
  FormProvider,
  useFormContext,
  useFormState,
  type ControllerProps,
  type FieldPath,
  type FieldValues,
} from "react-hook-form"

import { cn } from "@/lib/utils"
import { Label } from "@/components/ui/label"

const Form = FormProvider

type FormFieldContextValue<
  TFieldValues extends FieldValues = FieldValues,
  TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>,
> = {
  name: TName
}

const FormFieldContext = React.createContext<FormFieldContextValue>(
  {} as FormFieldContextValue
)

const FormField = <
  TFieldValues extends FieldValues = FieldValues,
  TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>,
>({
  ...props
}: ControllerProps<TFieldValues, TName>) => {
  return (
    <FormFieldContext.Provider value={{ name: props.name }}>
      <Controller {...props} />
    </FormFieldContext.Provider>
  )
}

const useFormField = () => {
  const fieldContext = React.useContext(FormFieldContext)
  const itemContext = React.useContext(FormItemContext)
  const { getFieldState } = useFormContext()
  const formState = useFormState({ name: fieldContext.name })
  const fieldState = getFieldState(fieldContext.name, formState)

  if (!fieldContext) {
    throw new Error("useFormField should be used within <FormField>")
  }

  const { id } = itemContext

  return {
    id,
    name: fieldContext.name,
    formItemId: `${id}-form-item`,
    formDescriptionId: `${id}-form-item-description`,
    formMessageId: `${id}-form-item-message`,
    ...fieldState,
  }
}

type FormItemContextValue = {
  id: string
}

const FormItemContext = React.createContext<FormItemContextValue>(
  {} as FormItemContextValue
)

function FormItem({ className, ...props }: React.ComponentProps<"div">) {
  const id = React.useId()

  return (
    <FormItemContext.Provider value={{ id }}>
      <div
        data-slot="form-item"
        className={cn("grid gap-2", className)}
        {...props}
      />
    </FormItemContext.Provider>
  )
}

function FormLabel({
  className,
  ...props
}: React.ComponentProps<typeof LabelPrimitive.Root>) {
  const { error, formItemId } = useFormField()

  return (
    <Label
      data-slot="form-label"
      data-error={!!error}
      className={cn("data-[error=true]:text-destructive", className)}
      htmlFor={formItemId}
      {...props}
    />
  )
}

function FormControl({ ...props }: React.ComponentProps<typeof Slot>) {
  const { error, formItemId, formDescriptionId, formMessageId } = useFormField()

  return (
    <Slot
      data-slot="form-control"
      id={formItemId}
      aria-describedby={
        !error
          ? `${formDescriptionId}`
          : `${formDescriptionId} ${formMessageId}`
      }
      aria-invalid={!!error}
      {...props}
    />
  )
}

function FormDescription({ className, ...props }: React.ComponentProps<"p">) {
  const { formDescriptionId } = useFormField()

  return (
    <p
      data-slot="form-description"
      id={formDescriptionId}
      className={cn("text-muted-foreground text-sm", className)}
      {...props}
    />
  )
}

function FormMessage({ className, ...props }: React.ComponentProps<"p">) {
  const { error, formMessageId } = useFormField()
  const body = error ? String(error?.message ?? "") : props.children

  if (!body) {
    return null
  }

  return (
    <p
      data-slot="form-message"
      id={formMessageId}
      className={cn("text-destructive text-sm", className)}
      {...props}
    >
      {body}
    </p>
  )
}

export {
  useFormField,
  Form,
  FormItem,
  FormLabel,
  FormControl,
  FormDescription,
  FormMessage,
  FormField,
}

```

### `components/ui/input.tsx`

```tsx
import * as React from "react"

import { cn } from "@/lib/utils"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "file:text-foreground placeholder:text-muted-foreground selection:bg-primary selection:text-primary-foreground dark:bg-input/30 border-input flex h-9 w-full min-w-0 rounded-md border bg-transparent px-3 py-1 text-base shadow-xs transition-[color,box-shadow] outline-none file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
        "focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]",
        "aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive",
        className
      )}
      {...props}
    />
  )
}

export { Input }

```

### `components/ui/label.tsx`

```tsx
"use client"

import * as React from "react"
import * as LabelPrimitive from "@radix-ui/react-label"

import { cn } from "@/lib/utils"

function Label({
  className,
  ...props
}: React.ComponentProps<typeof LabelPrimitive.Root>) {
  return (
    <LabelPrimitive.Root
      data-slot="label"
      className={cn(
        "flex items-center gap-2 text-sm leading-none font-medium select-none group-data-[disabled=true]:pointer-events-none group-data-[disabled=true]:opacity-50 peer-disabled:cursor-not-allowed peer-disabled:opacity-50",
        className
      )}
      {...props}
    />
  )
}

export { Label }

```

### `components/ui/loading-spinner.tsx`

```tsx
import { Sparkles } from 'lucide-react'
import { cn } from '@/lib/utils'

interface LoadingSpinnerProps {
  size?: 'sm' | 'md' | 'lg'
  text?: string
  className?: string
  fullScreen?: boolean
}

export function LoadingSpinner({ 
  size = 'md', 
  text = 'Loading...', 
  className,
  fullScreen = false 
}: LoadingSpinnerProps) {
  const sizeClasses = {
    sm: 'h-4 w-4',
    md: 'h-6 w-6', 
    lg: 'h-8 w-8'
  }

  const textSizeClasses = {
    sm: 'text-sm',
    md: 'text-base',
    lg: 'text-lg'
  }

  const content = (
    <div className={cn(
      "flex items-center gap-2",
      textSizeClasses[size],
      className
    )}>
      <Sparkles className={cn(sizeClasses[size], "animate-spin text-primary")} />
      <span>{text}</span>
    </div>
  )

  if (fullScreen) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        {content}
      </div>
    )
  }

  return content
} 
```

### `components/ui/navigation-menu.tsx`

```tsx
import * as React from "react"
import * as NavigationMenuPrimitive from "@radix-ui/react-navigation-menu"
import { cva } from "class-variance-authority"
import { ChevronDownIcon } from "lucide-react"

import { cn } from "@/lib/utils"

function NavigationMenu({
  className,
  children,
  viewport = true,
  ...props
}: React.ComponentProps<typeof NavigationMenuPrimitive.Root> & {
  viewport?: boolean
}) {
  return (
    <NavigationMenuPrimitive.Root
      data-slot="navigation-menu"
      data-viewport={viewport}
      className={cn(
        "group/navigation-menu relative flex max-w-max flex-1 items-center justify-center",
        className
      )}
      {...props}
    >
      {children}
      {viewport && <NavigationMenuViewport />}
    </NavigationMenuPrimitive.Root>
  )
}

function NavigationMenuList({
  className,
  ...props
}: React.ComponentProps<typeof NavigationMenuPrimitive.List>) {
  return (
    <NavigationMenuPrimitive.List
      data-slot="navigation-menu-list"
      className={cn(
        "group flex flex-1 list-none items-center justify-center gap-1",
        className
      )}
      {...props}
    />
  )
}

function NavigationMenuItem({
  className,
  ...props
}: React.ComponentProps<typeof NavigationMenuPrimitive.Item>) {
  return (
    <NavigationMenuPrimitive.Item
      data-slot="navigation-menu-item"
      className={cn("relative", className)}
      {...props}
    />
  )
}

const navigationMenuTriggerStyle = cva(
  "group inline-flex h-9 w-max items-center justify-center rounded-md bg-background px-4 py-2 text-sm font-medium hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground disabled:pointer-events-none disabled:opacity-50 data-[state=open]:hover:bg-accent data-[state=open]:text-accent-foreground data-[state=open]:focus:bg-accent data-[state=open]:bg-accent/50 focus-visible:ring-ring/50 outline-none transition-[color,box-shadow] focus-visible:ring-[3px] focus-visible:outline-1"
)

function NavigationMenuTrigger({
  className,
  children,
  ...props
}: React.ComponentProps<typeof NavigationMenuPrimitive.Trigger>) {
  return (
    <NavigationMenuPrimitive.Trigger
      data-slot="navigation-menu-trigger"
      className={cn(navigationMenuTriggerStyle(), "group", className)}
      {...props}
    >
      {children}{" "}
      <ChevronDownIcon
        className="relative top-[1px] ml-1 size-3 transition duration-300 group-data-[state=open]:rotate-180"
        aria-hidden="true"
      />
    </NavigationMenuPrimitive.Trigger>
  )
}

function NavigationMenuContent({
  className,
  ...props
}: React.ComponentProps<typeof NavigationMenuPrimitive.Content>) {
  return (
    <NavigationMenuPrimitive.Content
      data-slot="navigation-menu-content"
      className={cn(
        "data-[motion^=from-]:animate-in data-[motion^=to-]:animate-out data-[motion^=from-]:fade-in data-[motion^=to-]:fade-out data-[motion=from-end]:slide-in-from-right-52 data-[motion=from-start]:slide-in-from-left-52 data-[motion=to-end]:slide-out-to-right-52 data-[motion=to-start]:slide-out-to-left-52 top-0 left-0 w-full p-2 pr-2.5 md:absolute md:w-auto",
        "group-data-[viewport=false]/navigation-menu:bg-popover group-data-[viewport=false]/navigation-menu:text-popover-foreground group-data-[viewport=false]/navigation-menu:data-[state=open]:animate-in group-data-[viewport=false]/navigation-menu:data-[state=closed]:animate-out group-data-[viewport=false]/navigation-menu:data-[state=closed]:zoom-out-95 group-data-[viewport=false]/navigation-menu:data-[state=open]:zoom-in-95 group-data-[viewport=false]/navigation-menu:data-[state=open]:fade-in-0 group-data-[viewport=false]/navigation-menu:data-[state=closed]:fade-out-0 group-data-[viewport=false]/navigation-menu:top-full group-data-[viewport=false]/navigation-menu:mt-1.5 group-data-[viewport=false]/navigation-menu:overflow-hidden group-data-[viewport=false]/navigation-menu:rounded-md group-data-[viewport=false]/navigation-menu:border group-data-[viewport=false]/navigation-menu:shadow group-data-[viewport=false]/navigation-menu:duration-200 **:data-[slot=navigation-menu-link]:focus:ring-0 **:data-[slot=navigation-menu-link]:focus:outline-none",
        className
      )}
      {...props}
    />
  )
}

function NavigationMenuViewport({
  className,
  ...props
}: React.ComponentProps<typeof NavigationMenuPrimitive.Viewport>) {
  return (
    <div
      className={cn(
        "absolute top-full left-0 isolate z-50 flex justify-center"
      )}
    >
      <NavigationMenuPrimitive.Viewport
        data-slot="navigation-menu-viewport"
        className={cn(
          "origin-top-center bg-popover text-popover-foreground data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-90 relative mt-1.5 h-[var(--radix-navigation-menu-viewport-height)] w-full overflow-hidden rounded-md border shadow md:w-[var(--radix-navigation-menu-viewport-width)]",
          className
        )}
        {...props}
      />
    </div>
  )
}

function NavigationMenuLink({
  className,
  ...props
}: React.ComponentProps<typeof NavigationMenuPrimitive.Link>) {
  return (
    <NavigationMenuPrimitive.Link
      data-slot="navigation-menu-link"
      className={cn(
        "data-[active=true]:focus:bg-accent data-[active=true]:hover:bg-accent data-[active=true]:bg-accent/50 data-[active=true]:text-accent-foreground hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground focus-visible:ring-ring/50 [&_svg:not([class*='text-'])]:text-muted-foreground flex flex-col gap-1 rounded-sm p-2 text-sm transition-all outline-none focus-visible:ring-[3px] focus-visible:outline-1 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    />
  )
}

function NavigationMenuIndicator({
  className,
  ...props
}: React.ComponentProps<typeof NavigationMenuPrimitive.Indicator>) {
  return (
    <NavigationMenuPrimitive.Indicator
      data-slot="navigation-menu-indicator"
      className={cn(
        "data-[state=visible]:animate-in data-[state=hidden]:animate-out data-[state=hidden]:fade-out data-[state=visible]:fade-in top-full z-[1] flex h-1.5 items-end justify-center overflow-hidden",
        className
      )}
      {...props}
    >
      <div className="bg-border relative top-[60%] h-2 w-2 rotate-45 rounded-tl-sm shadow-md" />
    </NavigationMenuPrimitive.Indicator>
  )
}

export {
  NavigationMenu,
  NavigationMenuList,
  NavigationMenuItem,
  NavigationMenuContent,
  NavigationMenuTrigger,
  NavigationMenuLink,
  NavigationMenuIndicator,
  NavigationMenuViewport,
  navigationMenuTriggerStyle,
}

```

### `components/ui/pagination.tsx`

```tsx
import * as React from "react"
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  MoreHorizontalIcon,
} from "lucide-react"

import { cn } from "@/lib/utils"
import { Button, buttonVariants } from "@/components/ui/button"

function Pagination({ className, ...props }: React.ComponentProps<"nav">) {
  return (
    <nav
      role="navigation"
      aria-label="pagination"
      data-slot="pagination"
      className={cn("mx-auto flex w-full justify-center", className)}
      {...props}
    />
  )
}

function PaginationContent({
  className,
  ...props
}: React.ComponentProps<"ul">) {
  return (
    <ul
      data-slot="pagination-content"
      className={cn("flex flex-row items-center gap-1", className)}
      {...props}
    />
  )
}

function PaginationItem({ ...props }: React.ComponentProps<"li">) {
  return <li data-slot="pagination-item" {...props} />
}

type PaginationLinkProps = {
  isActive?: boolean
} & Pick<React.ComponentProps<typeof Button>, "size"> &
  React.ComponentProps<"a">

function PaginationLink({
  className,
  isActive,
  size = "icon",
  ...props
}: PaginationLinkProps) {
  return (
    <a
      aria-current={isActive ? "page" : undefined}
      data-slot="pagination-link"
      data-active={isActive}
      className={cn(
        buttonVariants({
          variant: isActive ? "outline" : "ghost",
          size,
        }),
        className
      )}
      {...props}
    />
  )
}

function PaginationPrevious({
  className,
  ...props
}: React.ComponentProps<typeof PaginationLink>) {
  return (
    <PaginationLink
      aria-label="Go to previous page"
      size="default"
      className={cn("gap-1 px-2.5 sm:pl-2.5", className)}
      {...props}
    >
      <ChevronLeftIcon />
      <span className="hidden sm:block">Previous</span>
    </PaginationLink>
  )
}

function PaginationNext({
  className,
  ...props
}: React.ComponentProps<typeof PaginationLink>) {
  return (
    <PaginationLink
      aria-label="Go to next page"
      size="default"
      className={cn("gap-1 px-2.5 sm:pr-2.5", className)}
      {...props}
    >
      <span className="hidden sm:block">Next</span>
      <ChevronRightIcon />
    </PaginationLink>
  )
}

function PaginationEllipsis({
  className,
  ...props
}: React.ComponentProps<"span">) {
  return (
    <span
      aria-hidden
      data-slot="pagination-ellipsis"
      className={cn("flex size-9 items-center justify-center", className)}
      {...props}
    >
      <MoreHorizontalIcon className="size-4" />
      <span className="sr-only">More pages</span>
    </span>
  )
}

export {
  Pagination,
  PaginationContent,
  PaginationLink,
  PaginationItem,
  PaginationPrevious,
  PaginationNext,
  PaginationEllipsis,
}

```

### `components/ui/popover.tsx`

```tsx
"use client"

import * as React from "react"
import * as PopoverPrimitive from "@radix-ui/react-popover"

import { cn } from "@/lib/utils"

function Popover({
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Root>) {
  return <PopoverPrimitive.Root data-slot="popover" {...props} />
}

function PopoverTrigger({
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Trigger>) {
  return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />
}

function PopoverContent({
  className,
  align = "center",
  sideOffset = 4,
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Content>) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        data-slot="popover-content"
        align={align}
        sideOffset={sideOffset}
        className={cn(
          "bg-popover text-popover-foreground data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 z-50 w-72 origin-(--radix-popover-content-transform-origin) rounded-md border p-4 shadow-md outline-hidden",
          className
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  )
}

function PopoverAnchor({
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Anchor>) {
  return <PopoverPrimitive.Anchor data-slot="popover-anchor" {...props} />
}

export { Popover, PopoverTrigger, PopoverContent, PopoverAnchor }

```

### `components/ui/progress.tsx`

```tsx
"use client"

import * as React from "react"
import * as ProgressPrimitive from "@radix-ui/react-progress"

import { cn } from "@/lib/utils"

function Progress({
  className,
  value,
  ...props
}: React.ComponentProps<typeof ProgressPrimitive.Root>) {
  return (
    <ProgressPrimitive.Root
      data-slot="progress"
      className={cn(
        "bg-primary/20 relative h-2 w-full overflow-hidden rounded-full",
        className
      )}
      {...props}
    >
      <ProgressPrimitive.Indicator
        data-slot="progress-indicator"
        className="bg-primary h-full w-full flex-1 transition-all"
        style={{ transform: `translateX(-${100 - (value || 0)}%)` }}
      />
    </ProgressPrimitive.Root>
  )
}

export { Progress }

```

### `components/ui/radio-group.tsx`

```tsx
"use client"

import * as React from "react"
import * as RadioGroupPrimitive from "@radix-ui/react-radio-group"
import { CircleIcon } from "lucide-react"

import { cn } from "@/lib/utils"

function RadioGroup({
  className,
  ...props
}: React.ComponentProps<typeof RadioGroupPrimitive.Root>) {
  return (
    <RadioGroupPrimitive.Root
      data-slot="radio-group"
      className={cn("grid gap-3", className)}
      {...props}
    />
  )
}

function RadioGroupItem({
  className,
  ...props
}: React.ComponentProps<typeof RadioGroupPrimitive.Item>) {
  return (
    <RadioGroupPrimitive.Item
      data-slot="radio-group-item"
      className={cn(
        "border-input text-primary focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive dark:bg-input/30 aspect-square size-4 shrink-0 rounded-full border shadow-xs transition-[color,box-shadow] outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    >
      <RadioGroupPrimitive.Indicator
        data-slot="radio-group-indicator"
        className="relative flex items-center justify-center"
      >
        <CircleIcon className="fill-primary absolute top-1/2 left-1/2 size-2 -translate-x-1/2 -translate-y-1/2" />
      </RadioGroupPrimitive.Indicator>
    </RadioGroupPrimitive.Item>
  )
}

export { RadioGroup, RadioGroupItem }

```

### `components/ui/scroll-area.tsx`

```tsx
"use client"

import * as React from "react"
import * as ScrollAreaPrimitive from "@radix-ui/react-scroll-area"

import { cn } from "@/lib/utils"

function ScrollArea({
  className,
  children,
  ...props
}: React.ComponentProps<typeof ScrollAreaPrimitive.Root>) {
  return (
    <ScrollAreaPrimitive.Root
      data-slot="scroll-area"
      className={cn("relative", className)}
      {...props}
    >
      <ScrollAreaPrimitive.Viewport
        data-slot="scroll-area-viewport"
        className="focus-visible:ring-ring/50 size-full rounded-[inherit] transition-[color,box-shadow] outline-none focus-visible:ring-[3px] focus-visible:outline-1"
      >
        {children}
      </ScrollAreaPrimitive.Viewport>
      <ScrollBar />
      <ScrollAreaPrimitive.Corner />
    </ScrollAreaPrimitive.Root>
  )
}

function ScrollBar({
  className,
  orientation = "vertical",
  ...props
}: React.ComponentProps<typeof ScrollAreaPrimitive.ScrollAreaScrollbar>) {
  return (
    <ScrollAreaPrimitive.ScrollAreaScrollbar
      data-slot="scroll-area-scrollbar"
      orientation={orientation}
      className={cn(
        "flex touch-none p-px transition-colors select-none",
        orientation === "vertical" &&
          "h-full w-2.5 border-l border-l-transparent",
        orientation === "horizontal" &&
          "h-2.5 flex-col border-t border-t-transparent",
        className
      )}
      {...props}
    >
      <ScrollAreaPrimitive.ScrollAreaThumb
        data-slot="scroll-area-thumb"
        className="bg-border relative flex-1 rounded-full"
      />
    </ScrollAreaPrimitive.ScrollAreaScrollbar>
  )
}

export { ScrollArea, ScrollBar }

```

### `components/ui/select.tsx`

```tsx
"use client"

import * as React from "react"
import * as SelectPrimitive from "@radix-ui/react-select"
import { CheckIcon, ChevronDownIcon, ChevronUpIcon } from "lucide-react"

import { cn } from "@/lib/utils"

function Select({
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Root>) {
  return <SelectPrimitive.Root data-slot="select" {...props} />
}

function SelectGroup({
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Group>) {
  return <SelectPrimitive.Group data-slot="select-group" {...props} />
}

function SelectValue({
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Value>) {
  return <SelectPrimitive.Value data-slot="select-value" {...props} />
}

function SelectTrigger({
  className,
  size = "default",
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Trigger> & {
  size?: "sm" | "default"
}) {
  return (
    <SelectPrimitive.Trigger
      data-slot="select-trigger"
      data-size={size}
      className={cn(
        "border-input data-[placeholder]:text-muted-foreground [&_svg:not([class*='text-'])]:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive dark:bg-input/30 dark:hover:bg-input/50 flex w-fit items-center justify-between gap-2 rounded-md border bg-transparent px-3 py-2 text-sm whitespace-nowrap shadow-xs transition-[color,box-shadow] outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50 data-[size=default]:h-9 data-[size=sm]:h-8 *:data-[slot=select-value]:line-clamp-1 *:data-[slot=select-value]:flex *:data-[slot=select-value]:items-center *:data-[slot=select-value]:gap-2 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon asChild>
        <ChevronDownIcon className="size-4 opacity-50" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  )
}

function SelectContent({
  className,
  children,
  position = "popper",
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Content>) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        data-slot="select-content"
        className={cn(
          "bg-popover text-popover-foreground data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 relative z-50 max-h-(--radix-select-content-available-height) min-w-[8rem] origin-(--radix-select-content-transform-origin) overflow-x-hidden overflow-y-auto rounded-md border shadow-md",
          position === "popper" &&
            "data-[side=bottom]:translate-y-1 data-[side=left]:-translate-x-1 data-[side=right]:translate-x-1 data-[side=top]:-translate-y-1",
          className
        )}
        position={position}
        {...props}
      >
        <SelectScrollUpButton />
        <SelectPrimitive.Viewport
          className={cn(
            "p-1",
            position === "popper" &&
              "h-[var(--radix-select-trigger-height)] w-full min-w-[var(--radix-select-trigger-width)] scroll-my-1"
          )}
        >
          {children}
        </SelectPrimitive.Viewport>
        <SelectScrollDownButton />
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  )
}

function SelectLabel({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Label>) {
  return (
    <SelectPrimitive.Label
      data-slot="select-label"
      className={cn("text-muted-foreground px-2 py-1.5 text-xs", className)}
      {...props}
    />
  )
}

function SelectItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Item>) {
  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      className={cn(
        "focus:bg-accent focus:text-accent-foreground [&_svg:not([class*='text-'])]:text-muted-foreground relative flex w-full cursor-default items-center gap-2 rounded-sm py-1.5 pr-8 pl-2 text-sm outline-hidden select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 *:[span]:last:flex *:[span]:last:items-center *:[span]:last:gap-2",
        className
      )}
      {...props}
    >
      <span className="absolute right-2 flex size-3.5 items-center justify-center">
        <SelectPrimitive.ItemIndicator>
          <CheckIcon className="size-4" />
        </SelectPrimitive.ItemIndicator>
      </span>
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  )
}

function SelectSeparator({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Separator>) {
  return (
    <SelectPrimitive.Separator
      data-slot="select-separator"
      className={cn("bg-border pointer-events-none -mx-1 my-1 h-px", className)}
      {...props}
    />
  )
}

function SelectScrollUpButton({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollUpButton>) {
  return (
    <SelectPrimitive.ScrollUpButton
      data-slot="select-scroll-up-button"
      className={cn(
        "flex cursor-default items-center justify-center py-1",
        className
      )}
      {...props}
    >
      <ChevronUpIcon className="size-4" />
    </SelectPrimitive.ScrollUpButton>
  )
}

function SelectScrollDownButton({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollDownButton>) {
  return (
    <SelectPrimitive.ScrollDownButton
      data-slot="select-scroll-down-button"
      className={cn(
        "flex cursor-default items-center justify-center py-1",
        className
      )}
      {...props}
    >
      <ChevronDownIcon className="size-4" />
    </SelectPrimitive.ScrollDownButton>
  )
}

export {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectScrollDownButton,
  SelectScrollUpButton,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
}

```

### `components/ui/separator.tsx`

```tsx
"use client"

import * as React from "react"
import * as SeparatorPrimitive from "@radix-ui/react-separator"

import { cn } from "@/lib/utils"

function Separator({
  className,
  orientation = "horizontal",
  decorative = true,
  ...props
}: React.ComponentProps<typeof SeparatorPrimitive.Root>) {
  return (
    <SeparatorPrimitive.Root
      data-slot="separator-root"
      decorative={decorative}
      orientation={orientation}
      className={cn(
        "bg-border shrink-0 data-[orientation=horizontal]:h-px data-[orientation=horizontal]:w-full data-[orientation=vertical]:h-full data-[orientation=vertical]:w-px",
        className
      )}
      {...props}
    />
  )
}

export { Separator }

```

### `components/ui/sheet.tsx`

```tsx
"use client"

import * as React from "react"
import * as SheetPrimitive from "@radix-ui/react-dialog"
import { XIcon } from "lucide-react"

import { cn } from "@/lib/utils"

function Sheet({ ...props }: React.ComponentProps<typeof SheetPrimitive.Root>) {
  return <SheetPrimitive.Root data-slot="sheet" {...props} />
}

function SheetTrigger({
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Trigger>) {
  return <SheetPrimitive.Trigger data-slot="sheet-trigger" {...props} />
}

function SheetClose({
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Close>) {
  return <SheetPrimitive.Close data-slot="sheet-close" {...props} />
}

function SheetPortal({
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Portal>) {
  return <SheetPrimitive.Portal data-slot="sheet-portal" {...props} />
}

function SheetOverlay({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Overlay>) {
  return (
    <SheetPrimitive.Overlay
      data-slot="sheet-overlay"
      className={cn(
        "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed inset-0 z-50 bg-black/50",
        className
      )}
      {...props}
    />
  )
}

function SheetContent({
  className,
  children,
  side = "right",
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Content> & {
  side?: "top" | "right" | "bottom" | "left"
}) {
  return (
    <SheetPortal>
      <SheetOverlay />
      <SheetPrimitive.Content
        data-slot="sheet-content"
        className={cn(
          "bg-background data-[state=open]:animate-in data-[state=closed]:animate-out fixed z-50 flex flex-col gap-4 shadow-lg transition ease-in-out data-[state=closed]:duration-300 data-[state=open]:duration-500",
          side === "right" &&
            "data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right inset-y-0 right-0 h-full w-3/4 border-l sm:max-w-sm",
          side === "left" &&
            "data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left inset-y-0 left-0 h-full w-3/4 border-r sm:max-w-sm",
          side === "top" &&
            "data-[state=closed]:slide-out-to-top data-[state=open]:slide-in-from-top inset-x-0 top-0 h-auto border-b",
          side === "bottom" &&
            "data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom inset-x-0 bottom-0 h-auto border-t",
          className
        )}
        {...props}
      >
        {children}
        <SheetPrimitive.Close className="ring-offset-background focus:ring-ring data-[state=open]:bg-secondary absolute top-4 right-4 rounded-xs opacity-70 transition-opacity hover:opacity-100 focus:ring-2 focus:ring-offset-2 focus:outline-hidden disabled:pointer-events-none">
          <XIcon className="size-4" />
          <span className="sr-only">Close</span>
        </SheetPrimitive.Close>
      </SheetPrimitive.Content>
    </SheetPortal>
  )
}

function SheetHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-header"
      className={cn("flex flex-col gap-1.5 p-4", className)}
      {...props}
    />
  )
}

function SheetFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-footer"
      className={cn("mt-auto flex flex-col gap-2 p-4", className)}
      {...props}
    />
  )
}

function SheetTitle({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Title>) {
  return (
    <SheetPrimitive.Title
      data-slot="sheet-title"
      className={cn("text-foreground font-semibold", className)}
      {...props}
    />
  )
}

function SheetDescription({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Description>) {
  return (
    <SheetPrimitive.Description
      data-slot="sheet-description"
      className={cn("text-muted-foreground text-sm", className)}
      {...props}
    />
  )
}

export {
  Sheet,
  SheetTrigger,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetFooter,
  SheetTitle,
  SheetDescription,
}

```

### `components/ui/sidebar.tsx`

```tsx
"use client"

import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { VariantProps, cva } from "class-variance-authority"
import { PanelLeftIcon } from "lucide-react"

import { useIsMobile } from "@/lib/hooks/use-mobile"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"

const SIDEBAR_COOKIE_NAME = "sidebar_state"
const SIDEBAR_COOKIE_MAX_AGE = 60 * 60 * 24 * 7
const SIDEBAR_WIDTH = "16rem"
const SIDEBAR_WIDTH_MOBILE = "18rem"
const SIDEBAR_WIDTH_ICON = "3rem"
const SIDEBAR_KEYBOARD_SHORTCUT = "b"

type SidebarContextProps = {
  state: "expanded" | "collapsed"
  open: boolean
  setOpen: (open: boolean) => void
  openMobile: boolean
  setOpenMobile: (open: boolean) => void
  isMobile: boolean
  toggleSidebar: () => void
}

const SidebarContext = React.createContext<SidebarContextProps | null>(null)

function useSidebar() {
  const context = React.useContext(SidebarContext)
  if (!context) {
    throw new Error("useSidebar must be used within a SidebarProvider.")
  }

  return context
}

function SidebarProvider({
  defaultOpen = true,
  open: openProp,
  onOpenChange: setOpenProp,
  className,
  style,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  defaultOpen?: boolean
  open?: boolean
  onOpenChange?: (open: boolean) => void
}) {
  const isMobile = useIsMobile()
  const [openMobile, setOpenMobile] = React.useState(false)

  // This is the internal state of the sidebar.
  // We use openProp and setOpenProp for control from outside the component.
  const [_open, _setOpen] = React.useState(defaultOpen)
  const open = openProp ?? _open
  const setOpen = React.useCallback(
    (value: boolean | ((value: boolean) => boolean)) => {
      const openState = typeof value === "function" ? value(open) : value
      if (setOpenProp) {
        setOpenProp(openState)
      } else {
        _setOpen(openState)
      }

      // This sets the cookie to keep the sidebar state.
      document.cookie = `${SIDEBAR_COOKIE_NAME}=${openState}; path=/; max-age=${SIDEBAR_COOKIE_MAX_AGE}`
    },
    [setOpenProp, open]
  )

  // Helper to toggle the sidebar.
  const toggleSidebar = React.useCallback(() => {
    return isMobile ? setOpenMobile((open) => !open) : setOpen((open) => !open)
  }, [isMobile, setOpen, setOpenMobile])

  // Adds a keyboard shortcut to toggle the sidebar.
  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.key === SIDEBAR_KEYBOARD_SHORTCUT &&
        (event.metaKey || event.ctrlKey)
      ) {
        event.preventDefault()
        toggleSidebar()
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [toggleSidebar])

  // We add a state so that we can do data-state="expanded" or "collapsed".
  // This makes it easier to style the sidebar with Tailwind classes.
  const state = open ? "expanded" : "collapsed"

  const contextValue = React.useMemo<SidebarContextProps>(
    () => ({
      state,
      open,
      setOpen,
      isMobile,
      openMobile,
      setOpenMobile,
      toggleSidebar,
    }),
    [state, open, setOpen, isMobile, openMobile, setOpenMobile, toggleSidebar]
  )

  return (
    <SidebarContext.Provider value={contextValue}>
      <TooltipProvider delayDuration={0}>
        <div
          data-slot="sidebar-wrapper"
          style={
            {
              "--sidebar-width": SIDEBAR_WIDTH,
              "--sidebar-width-icon": SIDEBAR_WIDTH_ICON,
              ...style,
            } as React.CSSProperties
          }
          className={cn(
            "group/sidebar-wrapper has-data-[variant=inset]:bg-sidebar flex min-h-svh w-full",
            className
          )}
          {...props}
        >
          {children}
        </div>
      </TooltipProvider>
    </SidebarContext.Provider>
  )
}

function Sidebar({
  side = "left",
  variant = "sidebar",
  collapsible = "offcanvas",
  className,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  side?: "left" | "right"
  variant?: "sidebar" | "floating" | "inset"
  collapsible?: "offcanvas" | "icon" | "none"
}) {
  const { isMobile, state, openMobile, setOpenMobile } = useSidebar()

  if (collapsible === "none") {
    return (
      <div
        data-slot="sidebar"
        className={cn(
          "bg-sidebar text-sidebar-foreground flex h-full w-(--sidebar-width) flex-col",
          className
        )}
        {...props}
      >
        {children}
      </div>
    )
  }

  if (isMobile) {
    return (
      <Sheet open={openMobile} onOpenChange={setOpenMobile} {...props}>
        <SheetContent
          data-sidebar="sidebar"
          data-slot="sidebar"
          data-mobile="true"
          className="bg-sidebar text-sidebar-foreground w-(--sidebar-width) p-0 [&>button]:hidden"
          style={
            {
              "--sidebar-width": SIDEBAR_WIDTH_MOBILE,
            } as React.CSSProperties
          }
          side={side}
        >
          <SheetHeader className="sr-only">
            <SheetTitle>Sidebar</SheetTitle>
            <SheetDescription>Displays the mobile sidebar.</SheetDescription>
          </SheetHeader>
          <div className="flex h-full w-full flex-col">{children}</div>
        </SheetContent>
      </Sheet>
    )
  }

  return (
    <div
      className="group peer text-sidebar-foreground hidden md:block"
      data-state={state}
      data-collapsible={state === "collapsed" ? collapsible : ""}
      data-variant={variant}
      data-side={side}
      data-slot="sidebar"
    >
      {/* This is what handles the sidebar gap on desktop */}
      <div
        data-slot="sidebar-gap"
        className={cn(
          "relative w-(--sidebar-width) bg-transparent transition-[width] duration-200 ease-linear",
          "group-data-[collapsible=offcanvas]:w-0",
          "group-data-[side=right]:rotate-180",
          variant === "floating" || variant === "inset"
            ? "group-data-[collapsible=icon]:w-[calc(var(--sidebar-width-icon)+(--spacing(4)))]"
            : "group-data-[collapsible=icon]:w-(--sidebar-width-icon)"
        )}
      />
      <div
        data-slot="sidebar-container"
        className={cn(
          "fixed inset-y-0 z-10 hidden h-svh w-(--sidebar-width) transition-[left,right,width] duration-200 ease-linear md:flex",
          side === "left"
            ? "left-0 group-data-[collapsible=offcanvas]:left-[calc(var(--sidebar-width)*-1)]"
            : "right-0 group-data-[collapsible=offcanvas]:right-[calc(var(--sidebar-width)*-1)]",
          // Adjust the padding for floating and inset variants.
          variant === "floating" || variant === "inset"
            ? "p-2 group-data-[collapsible=icon]:w-[calc(var(--sidebar-width-icon)+(--spacing(4))+2px)]"
            : "group-data-[collapsible=icon]:w-(--sidebar-width-icon) group-data-[side=left]:border-r group-data-[side=right]:border-l",
          className
        )}
        {...props}
      >
        <div
          data-sidebar="sidebar"
          data-slot="sidebar-inner"
          className="bg-sidebar group-data-[variant=floating]:border-sidebar-border flex h-full w-full flex-col group-data-[variant=floating]:rounded-lg group-data-[variant=floating]:border group-data-[variant=floating]:shadow-sm"
        >
          {children}
        </div>
      </div>
    </div>
  )
}

function SidebarTrigger({
  className,
  onClick,
  ...props
}: React.ComponentProps<typeof Button>) {
  const { toggleSidebar } = useSidebar()

  return (
    <Button
      data-sidebar="trigger"
      data-slot="sidebar-trigger"
      variant="ghost"
      size="icon"
      className={cn("size-7", className)}
      onClick={(event) => {
        onClick?.(event)
        toggleSidebar()
      }}
      {...props}
    >
      <PanelLeftIcon />
      <span className="sr-only">Toggle Sidebar</span>
    </Button>
  )
}

function SidebarRail({ className, ...props }: React.ComponentProps<"button">) {
  const { toggleSidebar } = useSidebar()

  return (
    <button
      data-sidebar="rail"
      data-slot="sidebar-rail"
      aria-label="Toggle Sidebar"
      tabIndex={-1}
      onClick={toggleSidebar}
      title="Toggle Sidebar"
      className={cn(
        "hover:after:bg-sidebar-border absolute inset-y-0 z-20 hidden w-4 -translate-x-1/2 transition-all ease-linear group-data-[side=left]:-right-4 group-data-[side=right]:left-0 after:absolute after:inset-y-0 after:left-1/2 after:w-[2px] sm:flex",
        "in-data-[side=left]:cursor-w-resize in-data-[side=right]:cursor-e-resize",
        "[[data-side=left][data-state=collapsed]_&]:cursor-e-resize [[data-side=right][data-state=collapsed]_&]:cursor-w-resize",
        "hover:group-data-[collapsible=offcanvas]:bg-sidebar group-data-[collapsible=offcanvas]:translate-x-0 group-data-[collapsible=offcanvas]:after:left-full",
        "[[data-side=left][data-collapsible=offcanvas]_&]:-right-2",
        "[[data-side=right][data-collapsible=offcanvas]_&]:-left-2",
        className
      )}
      {...props}
    />
  )
}

function SidebarInset({ className, ...props }: React.ComponentProps<"main">) {
  return (
    <main
      data-slot="sidebar-inset"
      className={cn(
        "bg-background relative flex w-full flex-1 flex-col",
        "md:peer-data-[variant=inset]:m-2 md:peer-data-[variant=inset]:ml-0 md:peer-data-[variant=inset]:rounded-xl md:peer-data-[variant=inset]:shadow-sm md:peer-data-[variant=inset]:peer-data-[state=collapsed]:ml-2",
        className
      )}
      {...props}
    />
  )
}

function SidebarInput({
  className,
  ...props
}: React.ComponentProps<typeof Input>) {
  return (
    <Input
      data-slot="sidebar-input"
      data-sidebar="input"
      className={cn("bg-background h-8 w-full shadow-none", className)}
      {...props}
    />
  )
}

function SidebarHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sidebar-header"
      data-sidebar="header"
      className={cn("flex flex-col gap-2 p-2", className)}
      {...props}
    />
  )
}

function SidebarFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sidebar-footer"
      data-sidebar="footer"
      className={cn("flex flex-col gap-2 p-2", className)}
      {...props}
    />
  )
}

function SidebarSeparator({
  className,
  ...props
}: React.ComponentProps<typeof Separator>) {
  return (
    <Separator
      data-slot="sidebar-separator"
      data-sidebar="separator"
      className={cn("bg-sidebar-border mx-2 w-auto", className)}
      {...props}
    />
  )
}

function SidebarContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sidebar-content"
      data-sidebar="content"
      className={cn(
        "flex min-h-0 flex-1 flex-col gap-2 overflow-auto group-data-[collapsible=icon]:overflow-hidden",
        className
      )}
      {...props}
    />
  )
}

function SidebarGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sidebar-group"
      data-sidebar="group"
      className={cn("relative flex w-full min-w-0 flex-col p-2", className)}
      {...props}
    />
  )
}

function SidebarGroupLabel({
  className,
  asChild = false,
  ...props
}: React.ComponentProps<"div"> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "div"

  return (
    <Comp
      data-slot="sidebar-group-label"
      data-sidebar="group-label"
      className={cn(
        "text-sidebar-foreground/70 ring-sidebar-ring flex h-8 shrink-0 items-center rounded-md px-2 text-xs font-medium outline-hidden transition-[margin,opacity] duration-200 ease-linear focus-visible:ring-2 [&>svg]:size-4 [&>svg]:shrink-0",
        "group-data-[collapsible=icon]:-mt-8 group-data-[collapsible=icon]:opacity-0",
        className
      )}
      {...props}
    />
  )
}

function SidebarGroupAction({
  className,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "button"

  return (
    <Comp
      data-slot="sidebar-group-action"
      data-sidebar="group-action"
      className={cn(
        "text-sidebar-foreground ring-sidebar-ring hover:bg-sidebar-accent hover:text-sidebar-accent-foreground absolute top-3.5 right-3 flex aspect-square w-5 items-center justify-center rounded-md p-0 outline-hidden transition-transform focus-visible:ring-2 [&>svg]:size-4 [&>svg]:shrink-0",
        // Increases the hit area of the button on mobile.
        "after:absolute after:-inset-2 md:after:hidden",
        "group-data-[collapsible=icon]:hidden",
        className
      )}
      {...props}
    />
  )
}

function SidebarGroupContent({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sidebar-group-content"
      data-sidebar="group-content"
      className={cn("w-full text-sm", className)}
      {...props}
    />
  )
}

function SidebarMenu({ className, ...props }: React.ComponentProps<"ul">) {
  return (
    <ul
      data-slot="sidebar-menu"
      data-sidebar="menu"
      className={cn("flex w-full min-w-0 flex-col gap-1", className)}
      {...props}
    />
  )
}

function SidebarMenuItem({ className, ...props }: React.ComponentProps<"li">) {
  return (
    <li
      data-slot="sidebar-menu-item"
      data-sidebar="menu-item"
      className={cn("group/menu-item relative", className)}
      {...props}
    />
  )
}

const sidebarMenuButtonVariants = cva(
  "peer/menu-button flex w-full items-center gap-2 overflow-hidden rounded-md p-2 text-left text-sm outline-hidden ring-sidebar-ring transition-[width,height,padding] hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 active:bg-sidebar-accent active:text-sidebar-accent-foreground disabled:pointer-events-none disabled:opacity-50 group-has-data-[sidebar=menu-action]/menu-item:pr-8 aria-disabled:pointer-events-none aria-disabled:opacity-50 data-[active=true]:bg-sidebar-accent data-[active=true]:font-medium data-[active=true]:text-sidebar-accent-foreground data-[state=open]:hover:bg-sidebar-accent data-[state=open]:hover:text-sidebar-accent-foreground group-data-[collapsible=icon]:size-8! group-data-[collapsible=icon]:p-2! [&>span:last-child]:truncate [&>svg]:size-4 [&>svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
        outline:
          "bg-background shadow-[0_0_0_1px_hsl(var(--sidebar-border))] hover:bg-sidebar-accent hover:text-sidebar-accent-foreground hover:shadow-[0_0_0_1px_hsl(var(--sidebar-accent))]",
      },
      size: {
        default: "h-8 text-sm",
        sm: "h-7 text-xs",
        lg: "h-12 text-sm group-data-[collapsible=icon]:p-0!",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function SidebarMenuButton({
  asChild = false,
  isActive = false,
  variant = "default",
  size = "default",
  tooltip,
  className,
  ...props
}: React.ComponentProps<"button"> & {
  asChild?: boolean
  isActive?: boolean
  tooltip?: string | React.ComponentProps<typeof TooltipContent>
} & VariantProps<typeof sidebarMenuButtonVariants>) {
  const Comp = asChild ? Slot : "button"
  const { isMobile, state } = useSidebar()

  const button = (
    <Comp
      data-slot="sidebar-menu-button"
      data-sidebar="menu-button"
      data-size={size}
      data-active={isActive}
      className={cn(sidebarMenuButtonVariants({ variant, size }), className)}
      {...props}
    />
  )

  if (!tooltip) {
    return button
  }

  if (typeof tooltip === "string") {
    tooltip = {
      children: tooltip,
    }
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent
        side="right"
        align="center"
        hidden={state !== "collapsed" || isMobile}
        {...tooltip}
      />
    </Tooltip>
  )
}

function SidebarMenuAction({
  className,
  asChild = false,
  showOnHover = false,
  ...props
}: React.ComponentProps<"button"> & {
  asChild?: boolean
  showOnHover?: boolean
}) {
  const Comp = asChild ? Slot : "button"

  return (
    <Comp
      data-slot="sidebar-menu-action"
      data-sidebar="menu-action"
      className={cn(
        "text-sidebar-foreground ring-sidebar-ring hover:bg-sidebar-accent hover:text-sidebar-accent-foreground peer-hover/menu-button:text-sidebar-accent-foreground absolute top-1.5 right-1 flex aspect-square w-5 items-center justify-center rounded-md p-0 outline-hidden transition-transform focus-visible:ring-2 [&>svg]:size-4 [&>svg]:shrink-0",
        // Increases the hit area of the button on mobile.
        "after:absolute after:-inset-2 md:after:hidden",
        "peer-data-[size=sm]/menu-button:top-1",
        "peer-data-[size=default]/menu-button:top-1.5",
        "peer-data-[size=lg]/menu-button:top-2.5",
        "group-data-[collapsible=icon]:hidden",
        showOnHover &&
          "peer-data-[active=true]/menu-button:text-sidebar-accent-foreground group-focus-within/menu-item:opacity-100 group-hover/menu-item:opacity-100 data-[state=open]:opacity-100 md:opacity-0",
        className
      )}
      {...props}
    />
  )
}

function SidebarMenuBadge({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sidebar-menu-badge"
      data-sidebar="menu-badge"
      className={cn(
        "text-sidebar-foreground pointer-events-none absolute right-1 flex h-5 min-w-5 items-center justify-center rounded-md px-1 text-xs font-medium tabular-nums select-none",
        "peer-hover/menu-button:text-sidebar-accent-foreground peer-data-[active=true]/menu-button:text-sidebar-accent-foreground",
        "peer-data-[size=sm]/menu-button:top-1",
        "peer-data-[size=default]/menu-button:top-1.5",
        "peer-data-[size=lg]/menu-button:top-2.5",
        "group-data-[collapsible=icon]:hidden",
        className
      )}
      {...props}
    />
  )
}

function SidebarMenuSkeleton({
  className,
  showIcon = false,
  ...props
}: React.ComponentProps<"div"> & {
  showIcon?: boolean
}) {
  // Random width between 50 to 90%.
  const width = React.useMemo(() => {
    return `${Math.floor(Math.random() * 40) + 50}%`
  }, [])

  return (
    <div
      data-slot="sidebar-menu-skeleton"
      data-sidebar="menu-skeleton"
      className={cn("flex h-8 items-center gap-2 rounded-md px-2", className)}
      {...props}
    >
      {showIcon && (
        <Skeleton
          className="size-4 rounded-md"
          data-sidebar="menu-skeleton-icon"
        />
      )}
      <Skeleton
        className="h-4 max-w-(--skeleton-width) flex-1"
        data-sidebar="menu-skeleton-text"
        style={
          {
            "--skeleton-width": width,
          } as React.CSSProperties
        }
      />
    </div>
  )
}

function SidebarMenuSub({ className, ...props }: React.ComponentProps<"ul">) {
  return (
    <ul
      data-slot="sidebar-menu-sub"
      data-sidebar="menu-sub"
      className={cn(
        "border-sidebar-border mx-3.5 flex min-w-0 translate-x-px flex-col gap-1 border-l px-2.5 py-0.5",
        "group-data-[collapsible=icon]:hidden",
        className
      )}
      {...props}
    />
  )
}

function SidebarMenuSubItem({
  className,
  ...props
}: React.ComponentProps<"li">) {
  return (
    <li
      data-slot="sidebar-menu-sub-item"
      data-sidebar="menu-sub-item"
      className={cn("group/menu-sub-item relative", className)}
      {...props}
    />
  )
}

function SidebarMenuSubButton({
  asChild = false,
  size = "md",
  isActive = false,
  className,
  ...props
}: React.ComponentProps<"a"> & {
  asChild?: boolean
  size?: "sm" | "md"
  isActive?: boolean
}) {
  const Comp = asChild ? Slot : "a"

  return (
    <Comp
      data-slot="sidebar-menu-sub-button"
      data-sidebar="menu-sub-button"
      data-size={size}
      data-active={isActive}
      className={cn(
        "text-sidebar-foreground ring-sidebar-ring hover:bg-sidebar-accent hover:text-sidebar-accent-foreground active:bg-sidebar-accent active:text-sidebar-accent-foreground [&>svg]:text-sidebar-accent-foreground flex h-7 min-w-0 -translate-x-px items-center gap-2 overflow-hidden rounded-md px-2 outline-hidden focus-visible:ring-2 disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 [&>span:last-child]:truncate [&>svg]:size-4 [&>svg]:shrink-0",
        "data-[active=true]:bg-sidebar-accent data-[active=true]:text-sidebar-accent-foreground",
        size === "sm" && "text-xs",
        size === "md" && "text-sm",
        "group-data-[collapsible=icon]:hidden",
        className
      )}
      {...props}
    />
  )
}

export {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInput,
  SidebarInset,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSkeleton,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarProvider,
  SidebarRail,
  SidebarSeparator,
  SidebarTrigger,
  useSidebar,
}

```

### `components/ui/skeleton.tsx`

```tsx
import { cn } from "@/lib/utils"

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("bg-accent animate-pulse rounded-md", className)}
      {...props}
    />
  )
}

export { Skeleton }

```

### `components/ui/switch.tsx`

```tsx
"use client"

import * as React from "react"
import * as SwitchPrimitive from "@radix-ui/react-switch"

import { cn } from "@/lib/utils"

function Switch({
  className,
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        "peer data-[state=checked]:bg-primary data-[state=unchecked]:bg-input focus-visible:border-ring focus-visible:ring-ring/50 dark:data-[state=unchecked]:bg-input/80 inline-flex h-[1.15rem] w-8 shrink-0 items-center rounded-full border border-transparent shadow-xs transition-all outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className={cn(
          "bg-background dark:data-[state=unchecked]:bg-foreground dark:data-[state=checked]:bg-primary-foreground pointer-events-none block size-4 rounded-full ring-0 transition-transform data-[state=checked]:translate-x-[calc(100%-2px)] data-[state=unchecked]:translate-x-0"
        )}
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }

```

### `components/ui/table.tsx`

```tsx
"use client"

import * as React from "react"

import { cn } from "@/lib/utils"

function Table({ className, ...props }: React.ComponentProps<"table">) {
  return (
    <div
      data-slot="table-container"
      className="relative w-full overflow-x-auto"
    >
      <table
        data-slot="table"
        className={cn("w-full caption-bottom text-sm", className)}
        {...props}
      />
    </div>
  )
}

function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  return (
    <thead
      data-slot="table-header"
      className={cn("[&_tr]:border-b", className)}
      {...props}
    />
  )
}

function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return (
    <tbody
      data-slot="table-body"
      className={cn("[&_tr:last-child]:border-0", className)}
      {...props}
    />
  )
}

function TableFooter({ className, ...props }: React.ComponentProps<"tfoot">) {
  return (
    <tfoot
      data-slot="table-footer"
      className={cn(
        "bg-muted/50 border-t font-medium [&>tr]:last:border-b-0",
        className
      )}
      {...props}
    />
  )
}

function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
  return (
    <tr
      data-slot="table-row"
      className={cn(
        "hover:bg-muted/50 data-[state=selected]:bg-muted border-b transition-colors",
        className
      )}
      {...props}
    />
  )
}

function TableHead({ className, ...props }: React.ComponentProps<"th">) {
  return (
    <th
      data-slot="table-head"
      className={cn(
        "text-foreground h-10 px-2 text-left align-middle font-medium whitespace-nowrap [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]",
        className
      )}
      {...props}
    />
  )
}

function TableCell({ className, ...props }: React.ComponentProps<"td">) {
  return (
    <td
      data-slot="table-cell"
      className={cn(
        "p-2 align-middle whitespace-nowrap [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]",
        className
      )}
      {...props}
    />
  )
}

function TableCaption({
  className,
  ...props
}: React.ComponentProps<"caption">) {
  return (
    <caption
      data-slot="table-caption"
      className={cn("text-muted-foreground mt-4 text-sm", className)}
      {...props}
    />
  )
}

export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
}

```

### `components/ui/tabs.tsx`

```tsx
"use client"

import * as React from "react"
import * as TabsPrimitive from "@radix-ui/react-tabs"

import { cn } from "@/lib/utils"

function Tabs({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      className={cn("flex flex-col gap-2", className)}
      {...props}
    />
  )
}

function TabsList({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      className={cn(
        "bg-muted text-muted-foreground inline-flex h-9 w-fit items-center justify-center rounded-lg p-[3px]",
        className
      )}
      {...props}
    />
  )
}

function TabsTrigger({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        "data-[state=active]:bg-background dark:data-[state=active]:text-foreground focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:outline-ring dark:data-[state=active]:border-input dark:data-[state=active]:bg-input/30 text-foreground dark:text-muted-foreground inline-flex h-[calc(100%-1px)] flex-1 items-center justify-center gap-1.5 rounded-md border border-transparent px-2 py-1 text-sm font-medium whitespace-nowrap transition-[color,box-shadow] focus-visible:ring-[3px] focus-visible:outline-1 disabled:pointer-events-none disabled:opacity-50 data-[state=active]:shadow-sm [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    />
  )
}

function TabsContent({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cn("flex-1 outline-none", className)}
      {...props}
    />
  )
}

export { Tabs, TabsList, TabsTrigger, TabsContent }

```

### `components/ui/textarea.tsx`

```tsx
import * as React from "react"

import { cn } from "@/lib/utils"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "border-input placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive dark:bg-input/30 flex field-sizing-content min-h-16 w-full rounded-md border bg-transparent px-3 py-2 text-base shadow-xs transition-[color,box-shadow] outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }

```

### `components/ui/tooltip.tsx`

```tsx
"use client"

import * as React from "react"
import * as TooltipPrimitive from "@radix-ui/react-tooltip"

import { cn } from "@/lib/utils"

function TooltipProvider({
  delayDuration = 0,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Provider>) {
  return (
    <TooltipPrimitive.Provider
      data-slot="tooltip-provider"
      delayDuration={delayDuration}
      {...props}
    />
  )
}

function Tooltip({
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Root>) {
  return (
    <TooltipProvider>
      <TooltipPrimitive.Root data-slot="tooltip" {...props} />
    </TooltipProvider>
  )
}

function TooltipTrigger({
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Trigger>) {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />
}

function TooltipContent({
  className,
  sideOffset = 0,
  children,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Content>) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        data-slot="tooltip-content"
        sideOffset={sideOffset}
        className={cn(
          "bg-primary text-primary-foreground animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 z-50 w-fit origin-(--radix-tooltip-content-transform-origin) rounded-md px-3 py-1.5 text-xs text-balance",
          className
        )}
        {...props}
      >
        {children}
        <TooltipPrimitive.Arrow className="bg-primary fill-primary z-50 size-2.5 translate-y-[calc(-50%_-_2px)] rotate-45 rounded-[2px]" />
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  )
}

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider }

```
