import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { Toaster } from 'sonner'
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar'
import { AppSidebar } from '@/components/app-shell/sidebar'
import GlobalLibraryProvider from '@/components/GlobalLibraryProvider'

// Full-screen layout for editor with collapsible app sidebar
// No header bar - EditorTopNav serves as the header
export default async function EditorLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createClient()
  const { data: { user }, error } = await supabase.auth.getUser()

  if (error || !user) {
    redirect('/login')
  }

  // Get sidebar state from cookies - default to closed for editor
  const cookieStore = await cookies()
  const sidebarState = cookieStore.get('sidebar:state')?.value
  // Default to closed in editor unless explicitly opened
  const defaultOpen = sidebarState === 'true'

  return (
    <SidebarProvider defaultOpen={defaultOpen}>
      <GlobalLibraryProvider>
        <AppSidebar />
        
        <SidebarInset>
          {/* No header here - EditorTopNav is inside the editor component */}
          <main className="flex-1 min-h-screen bg-muted/30">
            {children}
          </main>
        </SidebarInset>
        
        <Toaster 
          position="bottom-right"
          toastOptions={{
            style: {
              background: 'var(--background)',
              border: '1px solid var(--border)',
              color: 'var(--foreground)',
            },
          }}
        />
      </GlobalLibraryProvider>
    </SidebarProvider>
  )
}
