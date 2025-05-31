"use client"

import type React from "react"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Mail, Eye, EyeOff } from "lucide-react"

export default function LoginPage() {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [loading, setLoading] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const router = useRouter()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      })

      if (error) {
        console.error("Login error:", error.message)
      } else {
        console.log("Login successful:", data)
        router.push("/dashboard")
      }
    } catch (error) {
      console.error("Unexpected error:", error)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex h-screen bg-gray-50">
      {/* Left Hero Panel */}
      <div className="flex-1 bg-gradient-to-br from-blue-100 via-blue-400 to-purple-300 relative overflow-hidden">
        <div className="absolute inset-0 bg-black/10"></div>

        {/* Abstract AI Graphic */}
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="relative">
            {/* Neural network nodes */}
            <div className="grid grid-cols-4 gap-8 opacity-20">
              {Array.from({ length: 16 }).map((_, i) => (
                <div
                  key={i}
                  className="w-3 h-3 bg-white rounded-full animate-pulse"
                  style={{ animationDelay: `${i * 0.1}s` }}
                ></div>
              ))}
            </div>

            {/* Connecting lines */}
            <svg className="absolute inset-0 w-full h-full opacity-10" viewBox="0 0 200 200">
              <path
                d="M20,20 L180,60 M60,40 L140,120 M40,80 L160,40 M80,160 L120,80"
                stroke="white"
                strokeWidth="1"
                fill="none"
              />
            </svg>
          </div>
        </div>

        <div className="relative z-10 flex flex-col justify-center h-full px-16">
          <div className="max-w-lg">
            <h1 className="text-5xl font-bold text-white mb-6 leading-tight">Revolutionize Your Research</h1>
            <p className="text-xl text-blue-100 mb-8 leading-relaxed">
              Harness the power of AI to accelerate your academic writing, literature discovery, and citation
              management.
            </p>
            <div className="flex items-center gap-4 text-blue-100">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 bg-green-400 rounded-full"></div>
                <span className="text-sm">AI-Powered Analysis</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 bg-green-400 rounded-full"></div>
                <span className="text-sm">Smart Citations</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Right Sign-In Panel */}
      <div className="w-2/3 bg-white flex flex-col justify-center px-12">
        <div className="max-w-sm mx-auto w-full">
          {/* Logo */}
          <div className="flex items-center gap-3 mb-8">
            <div className="w-10 h-10 bg-black rounded-xl flex items-center justify-center">
              <div className="w-5 h-5 bg-white rounded"></div>
            </div>
            <div>
              <h2 className="text-2xl font-bold text-gray-900">GenPaper</h2>
              <p className="text-sm text-gray-500">AI-Powered Research Assistant</p>
            </div>
          </div>

          <div className="mb-8">
            <h3 className="text-xl font-semibold text-gray-900 mb-2">Welcome back</h3>
            <p className="text-gray-600">Sign in to your research workspace</p>
          </div>

          {/* OAuth Buttons */}
          <div className="space-y-3 mb-6">
            <Button variant="outline" className="w-full h-11 text-gray-700 border-gray-300">
              <Mail className="w-4 h-4 mr-3" />
              Continue with Google
            </Button>
          </div>

          <div className="relative mb-6">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-gray-300"></div>
            </div>
            <div className="relative flex justify-center text-sm">
              <span className="px-4 bg-white text-gray-500">or continue with email</span>
            </div>
          </div>

          {/* Email & Password Form */}
          <form onSubmit={handleSubmit} className="space-y-4 mb-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Email address</label>
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
              <label className="block text-sm font-medium text-gray-700 mb-2">Password</label>
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
              className="w-full h-11 bg-blue-600 hover:bg-blue-700 text-white"
            >
              {loading ? "Signing in..." : "Enter Workspace"}
            </Button>
          </form>

          <div className="text-center">
            <a href="#" className="text-sm text-blue-600 hover:text-blue-700">
              Forgot your password?
            </a>
          </div>

          <div className="mt-8 pt-6 border-t border-gray-200 text-center">
            <p className="text-sm text-gray-600">
              Don&apos;t have an account?{" "}
              <a href="/signup" className="text-blue-600 hover:text-blue-700 font-medium">
                Start free trial
              </a>
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
