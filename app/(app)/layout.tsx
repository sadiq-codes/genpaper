import { cookies } from 'next/headers'
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar'
import { AppSidebar } from '@/components/app-shell/sidebar'
import GlobalLibraryProvider from '@/components/GlobalLibraryProvider'
import { QueryProvider } from '@/components/providers/QueryProvider'
import { isAdmin } from '@/lib/admin'
import { getUserOrRedirect } from '@/lib/auth/cached'

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const user = await getUserOrRedirect()

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
          
          <AppSidebar showAdmin={isAdmin(user.id)} />
          
          <SidebarInset className="min-w-0 overflow-x-hidden">
            {/* Main content area - matches editor layout with bg-muted/30 */}
            <main id="main-content" className="flex-1 min-h-screen min-w-0 overflow-x-hidden bg-muted/30 p-2 md:p-4">
              {children}
            </main>
          </SidebarInset>
        </GlobalLibraryProvider>
      </SidebarProvider>
    </QueryProvider>
  )
}