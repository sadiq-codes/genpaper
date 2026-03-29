"use client"

import type React from "react"
import { useState, Suspense, useEffect } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import Link from "next/link"
import Image from "next/image"
import { createImplicitClient } from "@/lib/supabase/implicit-client"
import { Input } from "@/components/ui/input"
import { Eye, EyeOff, Loader2 } from "lucide-react"
import { SectionLoadingState } from "@/components/ui/async-state"

function ResetPasswordContent() {
  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [loading, setLoading] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [error, setError] = useState("")
  const [success, setSuccess] = useState(false)
  const [initializing, setInitializing] = useState(true)
  const router = useRouter()
  const searchParams = useSearchParams()
  const supabase = createImplicitClient()
  const authCode = searchParams.get("code")
  const authErrorCode = searchParams.get("error_code")
  const authErrorDescription = searchParams.get("error_description")

  const invalidResetLinkMessage = "This password reset link is invalid or expired. Please request a new reset link."

  useEffect(() => {
    let cancelled = false

    const initializeRecoverySession = async () => {
      const waitForSession = async (attempts = 12, delayMs = 150) => {
        for (let i = 0; i < attempts; i += 1) {
          const { data: { session } } = await supabase.auth.getSession()
          if (session) return true
          await new Promise((resolve) => setTimeout(resolve, delayMs))
        }
        return false
      }

      try {
        if (authErrorCode === "otp_expired" || authErrorCode === "access_denied") {
          setError(authErrorDescription ? authErrorDescription.replace(/\+/g, " ") : invalidResetLinkMessage)
          return
        }

        if (authCode) {
          const codeStatusKey = `reset-code-status:${authCode}`
          const existingStatus = sessionStorage.getItem(codeStatusKey)

          if (existingStatus === "pending" || existingStatus === "done") {
            const hasSession = await waitForSession()
            if (!hasSession && existingStatus === "done") {
              setError(invalidResetLinkMessage)
            }
            return
          }

          const { data: { session: existingSession } } = await supabase.auth.getSession()
          if (existingSession) {
            window.history.replaceState(null, "", "/reset-password")
            return
          }

          sessionStorage.setItem(codeStatusKey, "pending")
          const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(authCode)
          if (exchangeError) {
            console.error(
              "[reset-password] exchangeCodeForSession failed:",
              exchangeError.message,
              exchangeError.status,
              (exchangeError as { code?: string }).code
            )
            sessionStorage.removeItem(codeStatusKey)
            setError(invalidResetLinkMessage)
            return
          }

          sessionStorage.setItem(codeStatusKey, "done")
          const hasSession = await waitForSession()
          if (!hasSession) {
            setError("This password reset session is missing or expired. Please request a new reset link.")
            return
          }

          // Cleanup one-time code params after successful exchange.
          window.history.replaceState(null, "", "/reset-password")
          return
        }

        const hasSession = await waitForSession()
        if (!hasSession) {
          setError("This password reset session is missing or expired. Please request a new reset link.")
        }
      } finally {
        if (!cancelled) {
          setInitializing(false)
        }
      }
    }

    initializeRecoverySession()

    return () => {
      cancelled = true
    }
  }, [authCode, authErrorCode, authErrorDescription, supabase])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")

    if (initializing) {
      return
    }

    if (password.length < 6) {
      setError("Password must be at least 6 characters.")
      return
    }

    if (password !== confirmPassword) {
      setError("Passwords don\u2019t match.")
      return
    }

    setLoading(true)

    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) {
        setError("This password reset session is missing or expired. Please request a new reset link.")
        return
      }

      const { error } = await supabase.auth.updateUser({ password })

      if (error) {
        console.error('[reset-password] updateUser failed:', error.message, error.status, (error as { code?: string }).code)
        if (error.message.toLowerCase().includes("auth session missing")) {
          setError("This password reset session is missing or expired. Please request a new reset link.")
        } else {
          setError(error.message)
        }
      } else {
        setSuccess(true)
        setTimeout(() => {
          router.replace("/projects")
        }, 2000)
      }
    } catch (err) {
      console.error('[reset-password] Unexpected error:', err)
      setError("An unexpected error occurred. Please try again.")
    } finally {
      setLoading(false)
    }
  }

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
                d="M5 13l4 4L19 7"
              />
            </svg>
          </div>

          <h2 className="font-instrument text-2xl tracking-tight">Password updated</h2>
          <p className="text-sm text-muted-foreground">
            Your password has been reset successfully. Redirecting you now...
          </p>
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
        <h1 className="font-instrument text-3xl tracking-tight mb-2">Set new password</h1>
        <p className="text-sm text-muted-foreground">
          Enter your new password below
        </p>
      </div>

      {/* Form */}
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="bg-destructive/10 border border-destructive/20 rounded-xl p-3">
            <p className="text-sm text-destructive">{error}</p>
            {error.toLowerCase().includes("reset link") && (
              <div className="mt-2">
                <Link
                  href="/forgot-password"
                  className="inline-flex items-center rounded-full border border-border/40 px-3 py-1 text-xs font-medium hover:bg-muted transition-colors"
                >
                  Request a new reset link
                </Link>
              </div>
            )}
          </div>
        )}

        <div>
          <label htmlFor="password" className="block text-[13px] font-medium text-foreground/70 mb-1.5">
            New password
          </label>
          <div className="relative">
            <Input
              id="password"
              type={showPassword ? "text" : "password"}
              placeholder="Enter new password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="h-11 pr-10 rounded-xl border-border/40 bg-background placeholder:text-muted-foreground/30 focus-visible:ring-0 focus-visible:border-foreground/20 transition-colors"
              required
              autoFocus
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
            Confirm new password
          </label>
          <div className="relative">
            <Input
              id="confirm-password"
              type={showConfirmPassword ? "text" : "password"}
              placeholder="Confirm new password"
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
          disabled={loading || initializing}
          className="w-full h-11 rounded-full bg-foreground text-background text-sm font-medium hover:bg-foreground/90 transition-colors disabled:opacity-50 inline-flex items-center justify-center gap-2"
        >
          {(loading || initializing) && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />}
          {initializing ? "Preparing\u2026" : loading ? "Updating\u2026" : "Update Password"}
        </button>
      </form>

      <div className="text-center mt-8 pt-6 border-t border-border/40">
        <p className="text-sm text-muted-foreground">
          <Link href="/login" className="text-foreground font-medium hover:underline">
            Back to sign in
          </Link>
        </p>
      </div>
    </div>
  )
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={(
      <div className="w-full max-w-sm mx-auto px-6">
        <SectionLoadingState title="Loading reset flow..." className="min-h-[320px]" />
      </div>
    )}>
      <ResetPasswordContent />
    </Suspense>
  )
}
