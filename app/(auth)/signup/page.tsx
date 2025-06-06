"use client"

import type React from "react"
import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { supabase } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Mail, Eye, EyeOff, Zap } from "lucide-react"
import { LoadingSpinner } from "@/components/ui/loading-spinner"

export default function SignupPage() {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [loading, setLoading] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [checking, setChecking] = useState(true)
  const router = useRouter()

  useEffect(() => {
    const checkUser = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        router.push('/generate')
        return
      }
      setChecking(false)
    }
    checkUser()
  }, [router])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (password !== confirmPassword) {
      alert("Passwords don't match")
      return
    }

    setLoading(true)

    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
      })

      if (error) {
        console.error("Signup error:", error.message)
      } else {
        console.log("Signup successful:", data)
        router.push("/generate")
      }
    } catch (error) {
      console.error("Unexpected error:", error)
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
                <Zap className="h-8 w-8 text-primary" />
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
