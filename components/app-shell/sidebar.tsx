'use client'

import { usePathname, useRouter } from 'next/navigation'
import Link from 'next/link'
import { 
  FolderOpen,
  Library,
  Loader2,
  LogOut,
  Settings
} from 'lucide-react'
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarFooter,
  SidebarHeader,
  SidebarRail,
  useSidebar,
} from '@/components/ui/sidebar'
import { createClient } from '@/lib/supabase/client'
import { useEffect, useCallback, useState } from 'react'
import Image from 'next/image'
import { useUsageAlerts } from '@/lib/hooks/use-usage-alerts'

const navigation = [
  {
    title: 'Projects',
    url: '/projects',
    icon: FolderOpen,
  },
  {
    title: 'Library',
    url: '/library',
    icon: Library,
  },
  {
    title: 'Settings',
    url: '/settings',
    icon: Settings,
  },
]

export function AppSidebar() {
  const pathname = usePathname()
  const router = useRouter()
  const supabase = createClient()
  const { state } = useSidebar()
  const [prefetchedRoutes, setPrefetchedRoutes] = useState<Set<string>>(new Set())
  
  // Enable usage threshold alerts (shows toasts when approaching limits)
  useUsageAlerts()

  // Persist sidebar state in cookies
  useEffect(() => {
    document.cookie = `sidebar:state=${state === 'expanded'}; path=/; max-age=${60 * 60 * 24 * 7}` // 7 days
  }, [state])

  // Prefetch all nav routes on mount for instant navigation
  useEffect(() => {
    navigation.forEach((item) => {
      router.prefetch(item.url)
    })
  }, [router])

  // Prefetch on hover (for any routes not yet prefetched)
  const handlePrefetch = useCallback((url: string) => {
    if (!prefetchedRoutes.has(url)) {
      router.prefetch(url)
      setPrefetchedRoutes(prev => new Set(prev).add(url))
    }
  }, [router, prefetchedRoutes])

  const [isSigningOut, setIsSigningOut] = useState(false)

  const handleSignOut = async () => {
    setIsSigningOut(true)
    await supabase.auth.signOut()
    router.push('/')
  }

  // Check if navigation item is active
  const isItemActive = (item: typeof navigation[0]) => {
    // Projects is active for /projects and /editor routes
    if (item.url === '/projects') {
      return pathname === '/projects' || pathname.startsWith('/editor')
    }
    
    return pathname === item.url || pathname.startsWith(item.url)
  }

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <Link href="/projects" className="flex items-center gap-2 px-2 py-1 hover:opacity-80 transition-opacity">
          <Image 
            src="/favicon-32x32.png" 
            alt="GenPaper" 
            width={22} 
            height={22} 
            className="shrink-0 dark:invert"
          />
          {state === "expanded" && (
            <span className="font-semibold text-base tracking-tight text-foreground/80">GenPaper</span>
          )}
        </Link>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Navigation</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {navigation.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton 
                    asChild 
                    isActive={isItemActive(item)}
                    tooltip={item.title}
                  >
                    <Link 
                      href={item.url}
                      onMouseEnter={() => handlePrefetch(item.url)}
                      onFocus={() => handlePrefetch(item.url)}
                    >
                      <item.icon />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton onClick={handleSignOut} disabled={isSigningOut} tooltip="Sign Out">
              {isSigningOut ? <Loader2 className="animate-spin" /> : <LogOut />}
              <span>{isSigningOut ? "Signing out…" : "Sign Out"}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      
      {/* Rail for discoverable resizing */}
      <SidebarRail />
    </Sidebar>
  )
}
