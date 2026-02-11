"use client"

import type React from "react"
import { useState, useEffect, Suspense } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import Link from "next/link"
import Image from "next/image"
import { createClient } from "@/lib/supabase/client"
import { Input } from "@/components/ui/input"
import { Eye, EyeOff, Loader2 } from "lucide-react"

function SignupContent() {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [loading, setLoading] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [checking, setChecking] = useState(true)
  const [error, setError] = useState("")
  const [success, setSuccess] = useState(false)
  const [googleLoading, setGoogleLoading] = useState(false)
  const router = useRouter()
  const searchParams = useSearchParams()
  const supabase = createClient()
  const nextPath = searchParams.get("next") || "/projects"

  const handleGoogleSignIn = async () => {
    setGoogleLoading(true)
    setError("")

    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(nextPath)}`,
        queryParams: {
          access_type: "offline",
          prompt: "consent",
        },
      },
    })

    if (error) {
      setError(error.message)
      setGoogleLoading(false)
    }
  }

  useEffect(() => {
    const checkUser = async () => {
      setChecking(false)
    }
    checkUser()
  }, [router])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")

    if (password !== confirmPassword) {
      setError("Passwords don\u2019t match")
      return
    }

    setLoading(true)

    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(nextPath)}`,
        },
      })

      if (error) {
        console.error("Signup error:", error)
        setError(error.message)
      } else if (data.user) {
        const isExistingUser = !data.user.identities || data.user.identities.length === 0

        if (isExistingUser) {
          setError(`An account with ${email} already exists. Please sign in instead.`)
        } else if (!data.user.email_confirmed_at) {
          setSuccess(true)
        } else {
          router.replace("/projects")
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
    return <div className="min-h-screen" />
  }

  // Success — email verification sent
  if (success) {
    return (
      <div className="w-full max-w-sm mx-auto px-6 text-center">
        <div className="flex items-center justify-center mb-10">
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
        </div>

        <div className="bg-card border border-border/50 rounded-2xl p-8 space-y-4">
          <div className="w-14 h-14 bg-emerald-500/10 rounded-full flex items-center justify-center mx-auto">
            <svg
              className="w-7 h-7 text-emerald-600 dark:text-emerald-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
              />
            </svg>
          </div>

          <h2 className="font-instrument text-2xl tracking-tight">Check your email</h2>
          <p className="text-sm text-muted-foreground">
            We sent a verification link to <strong className="text-foreground">{email}</strong>
          </p>
          <p className="text-xs text-muted-foreground">
            Click the link in the email to verify your account and get started.
          </p>

          <div className="pt-4 space-y-2">
            <button
              className="w-full h-10 rounded-full border border-border text-sm font-medium hover:bg-muted transition-colors"
              onClick={() => window.location.reload()}
            >
              Didn&apos;t receive it? Try again
            </button>
            <Link
              href="/login"
              className="block w-full h-10 rounded-full text-sm text-muted-foreground hover:text-foreground transition-colors leading-10"
            >
              Back to sign in
            </Link>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="w-full max-w-sm mx-auto px-6">
      {/* Logo */}
      <div className="flex items-center justify-center mb-10">
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
      </div>

      {/* Header */}
      <div className="text-center mb-8">
        <h1 className="font-instrument text-3xl tracking-tight mb-2">Create your account</h1>
        <p className="text-sm text-muted-foreground">Start writing better papers today</p>
      </div>

      {/* Google sign-in */}
      <button
        className="w-full flex items-center justify-center gap-3 h-11 rounded-full border border-border bg-card text-sm font-medium hover:bg-muted transition-colors disabled:opacity-50"
        onClick={handleGoogleSignIn}
        disabled={googleLoading}
      >
        {googleLoading ? (
          <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
        ) : (
          <svg className="w-4 h-4" viewBox="0 0 24 24" aria-hidden="true">
            <path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
            <path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
            <path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
            <path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
          </svg>
        )}
        {googleLoading ? "Connecting\u2026" : "Continue with Google"}
      </button>

      {/* Divider */}
      <div className="relative my-6">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t border-border/60" />
        </div>
        <div className="relative flex justify-center text-xs">
          <span className="px-3 bg-background text-muted-foreground/60">or</span>
        </div>
      </div>

      {/* Email form */}
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="bg-destructive/10 border border-destructive/20 rounded-xl p-3">
            <p className="text-sm text-destructive">{error}</p>
            {error.includes("already exists") && (
              <div className="mt-2">
                <Link
                  href="/login"
                  className="inline-flex items-center rounded-full border border-border/40 px-3 py-1 text-xs font-medium hover:bg-muted transition-colors"
                >
                  Go to sign in
                </Link>
              </div>
            )}
          </div>
        )}

        <div>
          <label htmlFor="email" className="block text-[13px] font-medium text-foreground/70 mb-1.5">
            Email
          </label>
          <Input
            id="email"
            type="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="h-11 rounded-xl border-border/40 bg-background placeholder:text-muted-foreground/30 focus-visible:ring-0 focus-visible:border-foreground/20 transition-colors"
            required
          />
        </div>

        <div>
          <label htmlFor="password" className="block text-[13px] font-medium text-foreground/70 mb-1.5">
            Password
          </label>
          <div className="relative">
            <Input
              id="password"
              type={showPassword ? "text" : "password"}
              placeholder="Create a password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="h-11 pr-10 rounded-xl border-border/40 bg-background placeholder:text-muted-foreground/30 focus-visible:ring-0 focus-visible:border-foreground/20 transition-colors"
              required
            />
            <button
              type="button"
              className="absolute right-2.5 top-1/2 -translate-y-1/2 h-7 w-7 rounded-full flex items-center justify-center text-muted-foreground/40 hover:text-foreground transition-colors"
              onClick={() => setShowPassword(!showPassword)}
              aria-label={showPassword ? "Hide password" : "Show password"}
            >
              {showPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
            </button>
          </div>
        </div>

        <div>
          <label htmlFor="confirm-password" className="block text-[13px] font-medium text-foreground/70 mb-1.5">
            Confirm password
          </label>
          <div className="relative">
            <Input
              id="confirm-password"
              type={showConfirmPassword ? "text" : "password"}
              placeholder="Confirm your password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="h-11 pr-10 rounded-xl border-border/40 bg-background placeholder:text-muted-foreground/30 focus-visible:ring-0 focus-visible:border-foreground/20 transition-colors"
              required
            />
            <button
              type="button"
              className="absolute right-2.5 top-1/2 -translate-y-1/2 h-7 w-7 rounded-full flex items-center justify-center text-muted-foreground/40 hover:text-foreground transition-colors"
              onClick={() => setShowConfirmPassword(!showConfirmPassword)}
              aria-label={showConfirmPassword ? "Hide password" : "Show password"}
            >
              {showConfirmPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
            </button>
          </div>
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full h-11 rounded-full bg-foreground text-background text-sm font-medium hover:bg-foreground/90 transition-colors disabled:opacity-50 inline-flex items-center justify-center gap-2"
        >
          {loading && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />}
          {loading ? "Creating account\u2026" : "Create Account"}
        </button>
      </form>

      <div className="text-center mt-8 pt-6 border-t border-border/40">
        <p className="text-sm text-muted-foreground">
          Already have an account?{" "}
          <Link href="/login" className="text-foreground font-medium hover:underline">
            Sign in
          </Link>
        </p>
      </div>

      <div className="text-center mt-4 mb-6">
        <p className="text-xs text-muted-foreground/60">
          By creating an account, you agree to our{" "}
          <a href="#" className="hover:text-foreground transition-colors">Terms</a> and{" "}
          <a href="#" className="hover:text-foreground transition-colors">Privacy Policy</a>
        </p>
      </div>
    </div>
  )
}

export default function SignupPage() {
  return (
    <Suspense fallback={<div className="min-h-screen" />}>
      <SignupContent />
    </Suspense>
  )
}
