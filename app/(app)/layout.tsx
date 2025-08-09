import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { SidebarProvider, SidebarInset, SidebarTrigger } from '@/components/ui/sidebar'
import { AppSidebar } from '@/components/app-shell/sidebar'
import GlobalLibraryProvider from '@/components/GlobalLibraryProvider'

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createClient()
  const { data: { user }, error } = await supabase.auth.getUser()

  if (error || !user) {
    redirect('/login')
  }

  // Get sidebar state from cookies
  const cookieStore = await cookies()
  const defaultOpen = cookieStore.get('sidebar:state')?.value === 'true'

  return (
    <SidebarProvider defaultOpen={defaultOpen}>
      <GlobalLibraryProvider>
        {/* Skip to content link for accessibility */}
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 z-50 bg-primary text-primary-foreground px-4 py-2 rounded-md"
        >
          Skip to content
        </a>
        
        <AppSidebar />
        
        <SidebarInset>
          {/* Sticky header for persistent shell */}
          <header className="sticky top-0 z-40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 border-b">
            <div className="flex h-14 items-center px-4">
              <SidebarTrigger className="-ml-1" />
              <div className="mx-2 h-4 w-px bg-sidebar-border" />
              <h1 className="text-lg font-semibold">GenPaper</h1>
            </div>
          </header>
          
          {/* Main content area */}
          <main id="main-content" className="flex-1 p-6">
            {children}
          </main>
        </SidebarInset>
      </GlobalLibraryProvider>
    </SidebarProvider>
  )
}