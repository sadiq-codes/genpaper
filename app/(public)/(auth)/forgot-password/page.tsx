"use client"

import type React from "react"
import { useState } from "react"
import Link from "next/link"
import Image from "next/image"
import { createClient } from "@/lib/supabase/client"
import { Input } from "@/components/ui/input"
import { Loader2 } from "lucide-react"

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [sent, setSent] = useState(false)
  const supabase = createClient()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError("")

    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/auth/callback`,
      })

      if (error) {
        console.error("[forgot-password] Supabase resetPasswordForEmail error:", {
          message: error.message,
          status: error.status,
          name: error.name,
          cause: error.cause,
          full: error,
        })
        setError(error.message)
      } else {
        setSent(true)
      }
    } catch (err) {
      console.error("[forgot-password] Unexpected error:", err)
      setError("An unexpected error occurred. Please try again.")
    } finally {
      setLoading(false)
    }
  }

  if (sent) {
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
            We sent a password reset link to <strong className="text-foreground">{email}</strong>
          </p>
          <p className="text-xs text-muted-foreground">
            Click the link in the email to reset your password. It may take a minute to arrive.
          </p>

          <div className="pt-4 space-y-2">
            <button
              className="w-full h-10 rounded-full border border-border text-sm font-medium hover:bg-muted transition-colors"
              onClick={() => {
                setSent(false)
                setEmail("")
              }}
            >
              Try a different email
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
        <h1 className="font-instrument text-3xl tracking-tight mb-2">Reset your password</h1>
        <p className="text-sm text-muted-foreground">
          Enter your email and we&apos;ll send you a reset link
        </p>
      </div>

      {/* Form */}
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="bg-destructive/10 border border-destructive/20 rounded-xl p-3">
            <p className="text-sm text-destructive">{error}</p>
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
            autoFocus
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full h-11 rounded-full bg-foreground text-background text-sm font-medium hover:bg-foreground/90 transition-colors disabled:opacity-50 inline-flex items-center justify-center gap-2"
        >
          {loading && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />}
          {loading ? "Sending\u2026" : "Send Reset Link"}
        </button>
      </form>

      <div className="text-center mt-8 pt-6 border-t border-border/40">
        <p className="text-sm text-muted-foreground">
          Remember your password?{" "}
          <Link href="/login" className="text-foreground font-medium hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  )
}
