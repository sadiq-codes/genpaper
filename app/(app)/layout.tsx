// Use service layer for auth to satisfy module boundaries
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar'
import { AppSidebar } from '@/components/app-shell/sidebar'
import GlobalLibraryProvider from '@/components/GlobalLibraryProvider'
import { QueryProvider } from '@/components/providers/QueryProvider'

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
    <QueryProvider>
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
            {/* Main content area - matches editor layout with bg-muted/30 */}
            <main id="main-content" className="flex-1 min-h-screen bg-muted/30 p-2 md:p-4">
              {children}
            </main>
          </SidebarInset>
        </GlobalLibraryProvider>
      </SidebarProvider>
    </QueryProvider>
  )
}