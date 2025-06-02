"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter, usePathname } from "next/navigation"
import { Button } from "@/components/ui/button"

import {
  Menu,
  Sparkles,
} from "lucide-react"
import { supabase } from "@/lib/supabase/client"

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

export function Navbar({ user, onToggleSidebar, sidebarOpen }: NavbarProps) {
  const router = useRouter()
  const pathname = usePathname()
  const [searchOpen, setSearchOpen] = useState(false)

  const handleSignOut = async () => {
    await supabase.auth.signOut()
    router.push("/login")
  }

  const getUserInitials = () => {
    if (user?.user_metadata?.full_name) {
      return user.user_metadata.full_name
        .split(" ")
        .map((name) => name[0])
        .join("")
        .toUpperCase()
        .slice(0, 2)
    }
    return user?.email?.slice(0, 2).toUpperCase() || "U"
  }

  const getDisplayName = () => {
    return user?.user_metadata?.full_name || user?.email || "User"
  }

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