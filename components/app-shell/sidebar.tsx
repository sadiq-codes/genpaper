'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { 
  Home,
  FileText,
  Library,
  LogOut
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
import { Sparkles } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useEffect } from 'react'

const navigation = [
  {
    title: 'Generate',
    url: '/dashboard',
    icon: Home,
  },
  {
    title: 'Projects',
    url: '/projects',
    icon: FileText,
  },
  {
    title: 'Library',
    url: '/library',
    icon: Library,
  },
]

export function AppSidebar() {
  const pathname = usePathname()
  const _searchParams = useSearchParams()
  const router = useRouter()
  const supabase = createClient()
  const { state } = useSidebar()

  // Persist sidebar state in cookies
  useEffect(() => {
    document.cookie = `sidebar:state=${state === 'expanded'}; path=/; max-age=${60 * 60 * 24 * 7}` // 7 days
  }, [state])

  const handleSignOut = async () => {
    await supabase.auth.signOut()
    router.push('/')
  }

  // Check if navigation item is active
  const isItemActive = (item: typeof navigation[0]) => {
    if (item.url === '/dashboard') {
      return pathname === '/dashboard'
    }
    
    return pathname === item.url || pathname.startsWith(item.url)
  }

  return (
    <Sidebar collapsible="icon" variant="inset">
      <SidebarHeader>
        <div className="flex items-center gap-2 px-2 py-1">
          <Sparkles className="h-6 w-6 text-primary" />
          {state === "expanded" && (
            <span className="font-semibold text-lg">GenPaper</span>
          )}
        </div>
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
                    <Link href={item.url}>
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
            <SidebarMenuButton onClick={handleSignOut} tooltip="Sign Out">
              <LogOut />
              <span>Sign Out</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      
      {/* Rail for discoverable resizing */}
      <SidebarRail />
    </Sidebar>
  )
}