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