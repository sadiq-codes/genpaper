"use client"

import type React from "react"
import { useState, useEffect, Suspense } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import Link from "next/link"
import Image from "next/image"
import { createClient } from "@/lib/supabase/client"
import { Input } from "@/components/ui/input"
import { Eye, EyeOff, Loader2 } from "lucide-react"
import { SectionLoadingState } from "@/components/ui/async-state"

function sanitizeNextPath(raw: string | null): string {
  const fallback = "/projects"
  if (!raw || typeof raw !== "string") return fallback
  const trimmed = raw.trim()
  if (!trimmed.startsWith("/") || trimmed.startsWith("//")) return fallback
  if (trimmed.includes("\0") || trimmed.includes("\n")) return fallback
  return trimmed
}

function LoginPageContent() {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [loading, setLoading] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [checking, setChecking] = useState(true)
  const [error, setError] = useState("")
  const [canResendConfirmation, setCanResendConfirmation] = useState(false)
  const [resendLoading, setResendLoading] = useState(false)
  const [resendMessage, setResendMessage] = useState("")
  const [googleLoading, setGoogleLoading] = useState(false)
  const router = useRouter()
  const searchParams = useSearchParams()
  const supabase = createClient()
  const nextPath = sanitizeNextPath(searchParams.get("next"))
  const authCode = searchParams.get("code")
  const authType = searchParams.get("type")
  const authError = searchParams.get("error")
  const authErrorCode = searchParams.get("error_code")
  const authErrorDescription = searchParams.get("error_description")

  const safeDecode = (value: string) => {
    try {
      return decodeURIComponent(value)
    } catch {
      return value
    }
  }

  const getEmailAuthRedirectTo = () =>
    `${window.location.origin}/login?next=${encodeURIComponent(nextPath)}`

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
    let cancelled = false

    const redirectAfterAuth = () => {
      const go = () => {
        if (authType === "recovery") {
          router.replace("/reset-password")
          router.refresh()
          return
        }
        router.replace(nextPath)
        router.refresh()
      }
      requestAnimationFrame(go)
    }

    const waitForSession = async (attempts = 6, delayMs = 150) => {
      for (let i = 0; i < attempts; i += 1) {
        const { data: { session } } = await supabase.auth.getSession()
        if (session) return true
        await new Promise((resolve) => setTimeout(resolve, delayMs))
      }
      return false
    }

    const initializeAuthState = async () => {
      try {
        if (authCode) {
          const codeStatusKey = `login-code-status:${authCode}`
          const existingStatus = sessionStorage.getItem(codeStatusKey)

          if (existingStatus === "pending" || existingStatus === "done") {
            const hasSession = await waitForSession()
            if (hasSession) {
              redirectAfterAuth()
              return
            }

            if (existingStatus === "done") {
              setError("This sign-in link is invalid or expired. Request a new one and open it in the same browser.")
              setCanResendConfirmation(true)
            }
            return
          }

          const nextOnlyParams = new URLSearchParams({ next: nextPath })
          window.history.replaceState(null, "", `/login?${nextOnlyParams.toString()}`)

          sessionStorage.setItem(codeStatusKey, "pending")
          const { data: { session: existingSession } } = await supabase.auth.getSession()
          if (existingSession) {
            sessionStorage.setItem(codeStatusKey, "done")
            redirectAfterAuth()
            return
          }

          const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(authCode)
          if (!exchangeError) {
            sessionStorage.setItem(codeStatusKey, "done")
            redirectAfterAuth()
            return
          }

          sessionStorage.removeItem(codeStatusKey)
          console.error(
            "[login] exchangeCodeForSession failed:",
            exchangeError.message,
            exchangeError.status,
            (exchangeError as { code?: string }).code
          )
          setError("This sign-in link is invalid or expired. Request a new one and open it in the same browser.")
          setCanResendConfirmation(true)
          return
        }

        const { data: { session } } = await supabase.auth.getSession()
        if (session) {
          redirectAfterAuth()
          return
        }

        if (authErrorCode || authErrorDescription) {
          setError(safeDecode(authErrorDescription || authErrorCode || "Authentication failed"))
          if ((authErrorCode || "").toLowerCase().includes("otp")) {
            setCanResendConfirmation(true)
          }
          return
        }

        if (authError) {
          setError(safeDecode(authError))
          if (authError.toLowerCase().includes("authentication failed")) {
            setCanResendConfirmation(true)
          }
        }
      } finally {
        if (!cancelled) {
          setChecking(false)
        }
      }
    }

    initializeAuthState()

    return () => {
      cancelled = true
    }
  }, [authCode, authError, authErrorCode, authErrorDescription, authType, nextPath, router, supabase])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError("")
    setCanResendConfirmation(false)
    setResendMessage("")

    try {
      const normalizedEmail = email.trim().toLowerCase()
      const { data, error: signInError } = await supabase.auth.signInWithPassword({
        email: normalizedEmail,
        password,
      })

      if (signInError) {
        const code = (signInError as { code?: string }).code
        const invalidCredentials =
          code === "invalid_credentials" ||
          signInError.message === "Invalid login credentials"

        if (invalidCredentials) {
          const { error: fallbackError } = await supabase.auth.signInWithOtp({
            email: normalizedEmail,
            options: {
              shouldCreateUser: false,
              emailRedirectTo: getEmailAuthRedirectTo(),
            },
          })

          if (!fallbackError) {
            setError(
              "Invalid email or password. We sent a sign-in link to your email as a fallback. Open it, then set a new password if needed."
            )
          } else {
            setError("Invalid email or password")
          }

          setCanResendConfirmation(true)
          return
        }

        if (code === "email_not_confirmed") {
          setError("Please confirm your email before signing in.")
          setCanResendConfirmation(true)
          return
        }

        setError(signInError.message || "Invalid email or password")
        return
      }

      if (!data.session) {
        setError("Sign in failed. Please try again.")
        return
      }

      requestAnimationFrame(() => {
        router.replace(nextPath)
        router.refresh()
      })
    } catch (error) {
      console.error("Sign-in error:", error)
      setError("Network error. Please check your connection and try again.")
    } finally {
      setLoading(false)
    }
  }

  const handleResendConfirmation = async () => {
    const normalizedEmail = email.trim().toLowerCase()
    if (!normalizedEmail) return

    setResendLoading(true)
    setResendMessage("")

    try {
      const { error } = await supabase.auth.resend({
        type: "signup",
        email: normalizedEmail,
        options: {
          emailRedirectTo: getEmailAuthRedirectTo(),
        },
      })

      if (error) {
        setResendMessage("Could not resend confirmation email.")
        return
      }

      setResendMessage("If your account exists and is unconfirmed, we sent a new confirmation email.")
    } catch {
      setResendMessage("Network error while resending confirmation email.")
    } finally {
      setResendLoading(false)
    }
  }

  if (checking) {
    return (
      <div className="w-full max-w-sm mx-auto px-6">
        <SectionLoadingState
          title="Preparing sign in..."
          description="Checking your current session and any email sign-in link."
          className="min-h-[320px]"
        />
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
        <h1 className="font-instrument text-3xl tracking-tight mb-2">Welcome back</h1>
        <p className="text-sm text-muted-foreground">Sign in to your research workspace</p>
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
            {canResendConfirmation && (
              <div className="mt-2">
                <button
                  type="button"
                  onClick={handleResendConfirmation}
                  disabled={resendLoading || !email.trim()}
                  className="inline-flex items-center rounded-full border border-border/40 px-3 py-1 text-xs font-medium hover:bg-muted transition-colors disabled:opacity-50"
                >
                  {resendLoading ? "Sending..." : "Resend confirmation email"}
                </button>
              </div>
            )}
            {resendMessage && (
              <p className="mt-2 text-xs text-muted-foreground">{resendMessage}</p>
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
              placeholder="Enter your password"
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

        <button
          type="submit"
          disabled={loading}
          className="w-full h-11 rounded-full bg-foreground text-background text-sm font-medium hover:bg-foreground/90 transition-colors disabled:opacity-50 inline-flex items-center justify-center gap-2"
        >
          {loading && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />}
          {loading ? "Signing in\u2026" : "Sign In"}
        </button>
      </form>

      <div className="text-center mt-4">
        <Link href="/forgot-password" className="text-xs text-muted-foreground/50 hover:text-foreground transition-colors">
          Forgot your password?
        </Link>
      </div>

      <div className="text-center mt-8 pt-6 border-t border-border/40">
        <p className="text-sm text-muted-foreground">
          Don&apos;t have an account?{" "}
          <Link href="/signup" className="text-foreground font-medium hover:underline">
            Sign up
          </Link>
        </p>
      </div>
    </div>
  )
}

export default function LoginPage() {
  return (
    <Suspense fallback={(
      <div className="w-full max-w-sm mx-auto px-6">
        <SectionLoadingState title="Loading sign in..." className="min-h-[320px]" />
      </div>
    )}>
      <LoginPageContent />
    </Suspense>
  )
}
