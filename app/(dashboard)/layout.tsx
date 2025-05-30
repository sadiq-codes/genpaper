"use client"

import type React from "react"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabase/client"
import type { User } from "@supabase/supabase-js"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { 
  FolderOpen, 
  BookOpen, 
  Settings, 
  Bell, 
  LogOut, 
  Search, 
  Menu, 
  X,
  Plus,
  HelpCircle,
  Sun,
  Moon,
  Zap,
  MoreHorizontal,
  Send,
  Paperclip,
  Mic,
  FileText,
  PenTool,
  ImageIcon,
  User as UserIcon,
  Code,
  Clock
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [isDark, setIsDark] = useState(false)
  const [message, setMessage] = useState("Summarize the latest")
  const router = useRouter()
  const pathname = usePathname()

  const handleSignOut = async () => {
    await supabase.auth.signOut()
    router.push("/login")
  }

  useEffect(() => {
    // Check initial session
    const checkSession = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession()

      if (!session) {
        router.push("/login")
      } else {
        setUser(session.user)
      }
      setLoading(false)
    }

    checkSession()

    // Listen for auth changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (!session) {
        router.push("/login")
      } else {
        setUser(session.user)
      }
      setLoading(false)
    })

    return () => subscription.unsubscribe()
  }, [router])

  const navigationItems = [
    { name: "Dashboard", href: "/dashboard", icon: FileText, isActive: pathname.startsWith("/dashboard") },
    { name: "Projects", href: "/projects", icon: FolderOpen, isActive: pathname.startsWith("/projects") },
    { name: "Smart Editor", href: "/editor", icon: PenTool, isActive: pathname.startsWith("/editor") },
    { name: "Literature Search", href: "/search", icon: ImageIcon, isActive: pathname.startsWith("/search") },
    { name: "Library", href: "/library", icon: Code, isActive: pathname.startsWith("/library") },
    { name: "Citation Manager", href: "/citations", icon: UserIcon, isActive: pathname.startsWith("/citations") },
    { name: "Notifications", href: "/notifications", icon: HelpCircle, isActive: pathname.startsWith("/notifications") },
  ]

  const projects = [
    "New Research Project",
    "Machine Learning in Healthcare",
    "Climate Change Analysis", 
    "Quantum Computing Review",
    "Neural Network Study",
    "Biomedical Engineering",
    "AI Ethics Research",
  ]

  const projectDescriptions = [
    "",
    "Exploring AI applications in medical diagnosis...",
    "Analyzing environmental impact data...", 
    "Comprehensive review of quantum algorithms...",
    "Deep learning architecture comparison...",
    "Engineering solutions for healthcare...",
    "Ethical considerations in AI development...",
  ]

  const projectTimes = [
    "",
    "2 hours ago",
    "1 day ago",
    "3 days ago", 
    "1 week ago",
    "2 weeks ago",
    "1 month ago",
  ]

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-3"></div>
          <div className="text-slate-600">Loading...</div>
        </div>
      </div>
    )
  }

  if (!user) {
    return null // Will redirect to login
  }

  return (
    <div className="flex h-screen bg-gray-50">
      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="fixed inset-0 bg-black bg-opacity-25" onClick={() => setSidebarOpen(false)} />
        </div>
      )}

      {/* Left Sidebar - Exact same styling as Script.io */}
      <div
        className={`w-72 bg-white border-r border-gray-200 flex flex-col fixed inset-y-0 left-0 z-50 transform ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        } transition-transform duration-200 ease-in-out lg:translate-x-0 lg:static lg:inset-0`}
      >
        {/* Sidebar Header */}
        <div className="p-4 border-b border-gray-200">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-8 h-8 bg-black rounded-lg flex items-center justify-center">
              <div className="grid grid-cols-2 gap-0.5">
                <div className="w-1.5 h-1.5 bg-white rounded-full"></div>
                <div className="w-1.5 h-1.5 bg-white rounded-full"></div>
                <div className="w-1.5 h-1.5 bg-white rounded-full"></div>
                <div className="w-1.5 h-1.5 bg-white rounded-full"></div>
              </div>
            </div>
            <span className="font-semibold text-lg text-gray-900">Genpaper</span>
            <button
              onClick={() => setSidebarOpen(false)}
              className="lg:hidden ml-auto p-1 rounded-md text-slate-400 hover:text-slate-600"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
            <Input placeholder="Search" className="pl-10 bg-gray-50 border-0 h-9" />
            <span className="absolute right-3 top-1/2 transform -translate-y-1/2 text-xs text-gray-400">⌘K</span>
          </div>
        </div>

        {/* Navigation */}
        <div className="flex-1 p-4">
          <nav className="space-y-1">
            {navigationItems.map((item, index) => (
              <Link
                key={index}
                href={item.href}
                onClick={() => setSidebarOpen(false)}
                className={`flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer transition-colors ${
                  item.isActive ? "bg-blue-50 text-blue-700" : "text-gray-600 hover:bg-gray-50"
                }`}
              >
                {item.isActive ? (
                  <div className="w-2 h-2 bg-blue-600 rounded-full"></div>
                ) : (
                  <item.icon className="w-4 h-4" />
                )}
                <span className="text-sm font-medium">{item.name}</span>
              </Link>
            ))}
          </nav>
        </div>

        {/* Settings & Help */}
        <div className="p-4 border-t border-gray-200">
          <div className="text-xs text-gray-500 mb-3">Settings & Help</div>
          <div className="space-y-1">
            <Link
              href="/settings"
              className="flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer hover:bg-gray-50 text-gray-600"
            >
              <Settings className="w-4 h-4" />
              <span className="text-sm">Settings</span>
            </Link>
            <div className="flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer hover:bg-gray-50 text-gray-600">
              <HelpCircle className="w-4 h-4" />
              <span className="text-sm">Help</span>
            </div>
          </div>

          {/* Theme Toggle */}
          <div className="flex items-center gap-0 mt-4 p-1 bg-gray-100 rounded-lg">
            <Button
              variant={!isDark ? "secondary" : "ghost"}
              size="sm"
              className="flex-1 h-8 text-xs"
              onClick={() => setIsDark(false)}
            >
              <Sun className="w-3 h-3 mr-1" />
              Light
            </Button>
            <Button
              variant={isDark ? "secondary" : "ghost"}
              size="sm"
              className="flex-1 h-8 text-xs"
              onClick={() => setIsDark(true)}
            >
              <Moon className="w-3 h-3 mr-1" />
              Dark
            </Button>
          </div>

          {/* User Profile */}
          <div className="flex items-center gap-3 mt-4 p-2">
            <Avatar className="w-8 h-8">
              <AvatarFallback className="bg-purple-200 text-purple-800">
                {user.email?.charAt(0).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <div className="font-semibold text-sm text-gray-900">{user.email}</div>
              <div className="text-xs text-gray-500">Researcher</div>
            </div>
          </div>

          <button
            onClick={handleSignOut}
            className="flex items-center w-full px-3 py-2 mt-2 text-sm text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
          >
            <LogOut className="mr-3 w-4 h-4 text-gray-400" />
            Sign Out
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col bg-white lg:ml-0">
        {/* Top header for mobile */}
        <div className="lg:hidden flex items-center justify-between h-16 px-4 bg-white border-b border-gray-200">
          <button onClick={() => setSidebarOpen(true)} className="p-2 rounded-md text-slate-400 hover:text-slate-600">
            <Menu className="w-5 h-5" />
          </button>
          <div className="flex items-center space-x-2">
            <div className="w-6 h-6 bg-black rounded-md flex items-center justify-center">
              <div className="grid grid-cols-2 gap-0.5">
                <div className="w-1 h-1 bg-white rounded-full"></div>
                <div className="w-1 h-1 bg-white rounded-full"></div>
                <div className="w-1 h-1 bg-white rounded-full"></div>
                <div className="w-1 h-1 bg-white rounded-full"></div>
              </div>
            </div>
            <span className="text-lg font-bold text-gray-900">Genpaper</span>
          </div>
          <div className="w-9" /> {/* Spacer for centering */}
        </div>

        {/* Main Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-semibold text-gray-900">AI Research Assistant</h1>
          </div>
          <div className="flex items-center gap-3">
            <Button className="bg-black text-white hover:bg-gray-800">
              <Zap className="w-4 h-4 mr-2" />
              Upgrade
            </Button>
            <Button variant="ghost" size="icon">
              <HelpCircle className="w-4 h-4 text-gray-500" />
            </Button>
            <Button variant="ghost" size="icon">
              <Bell className="w-4 h-4 text-gray-500" />
            </Button>
            <Avatar className="w-8 h-8">
              <AvatarFallback className="bg-purple-200 text-purple-800">
                {user.email?.charAt(0).toUpperCase()}
              </AvatarFallback>
            </Avatar>
          </div>
        </div>

        {/* Main Content with Chat and Projects */}
        <div className="flex-1 flex">
          {/* Page Content */}
          <div className="flex-1 flex flex-col">
            <main className="flex-1">{children}</main>

            {/* Message Input - Only show on main dashboard */}
            {pathname === "/dashboard" && (
              <div className="border-t border-gray-200 p-6">
                <div className="max-w-3xl mx-auto">
                  <div className="relative">
                    <Input
                      placeholder="Send a message"
                      value={message}
                      onChange={(e) => setMessage(e.target.value)}
                      className="pr-12 h-12 rounded-xl border-2 border-blue-200 focus:border-blue-400"
                    />
                    <Button size="icon" className="absolute right-2 top-2 w-8 h-8 bg-black text-white hover:bg-gray-800">
                      <Send className="w-4 h-4" />
                    </Button>
                  </div>

                  <div className="flex items-center justify-between mt-3">
                    <div className="flex items-center gap-6">
                      <Button variant="ghost" size="sm" className="text-gray-500">
                        <Paperclip className="w-4 h-4 mr-2" />
                        Attach
                      </Button>
                      <Button variant="ghost" size="sm" className="text-gray-500">
                        <Mic className="w-4 h-4 mr-2" />
                        Voice Message
                      </Button>
                      <Button variant="ghost" size="sm" className="text-gray-500">
                        <FileText className="w-4 h-4 mr-2" />
                        Browse Prompts
                      </Button>
                    </div>
                    <div className="text-sm text-gray-500">20 / 3,000</div>
                  </div>

                  <div className="text-xs text-center mt-3 text-gray-400">
                    GenPaper may generate inaccurate information about people, places, or facts. Model: GPT-4
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Projects Section (Right side) - Only show on main dashboard */}
          {pathname === "/dashboard" && (
            <div className="w-80 border-l border-gray-200 bg-gray-50">
              <div className="p-4 border-b border-gray-200 flex items-center justify-between bg-white">
                <h3 className="font-semibold text-gray-900">Projects (7)</h3>
                <Button variant="ghost" size="icon">
                  <MoreHorizontal className="w-4 h-4 text-gray-500" />
                </Button>
              </div>

              <div className="p-4 space-y-2">
                {projects.map((project, index) => (
                  <div
                    key={index}
                    className={`p-3 rounded-lg cursor-pointer transition-colors ${
                      index === 0 ? "bg-white shadow-sm border border-gray-200" : "hover:bg-white/50"
                    }`}
                  >
                    <div className="font-medium text-sm text-gray-900 mb-1">{project}</div>
                    {index > 0 && (
                      <div className="text-xs text-gray-500">
                        {projectDescriptions[index]}
                      </div>
                    )}
                    {index > 0 && (
                      <div className="flex items-center gap-1 mt-2">
                        <Clock className="w-3 h-3 text-gray-400" />
                        <span className="text-xs text-gray-500">
                          {projectTimes[index]}
                        </span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
