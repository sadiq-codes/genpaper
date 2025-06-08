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
