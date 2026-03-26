import { redirect } from 'next/navigation'
import { isAdmin } from '@/lib/admin'
import { AdminNav } from './admin-nav'
import { getUserOrRedirect } from '@/lib/auth/cached'

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const user = await getUserOrRedirect()
  if (!isAdmin(user.id)) {
    redirect('/projects')
  }

  return (
    <div className="flex flex-col min-h-full">
      <AdminNav />
      <div className="flex-1 px-4 md:px-6 py-6 max-w-6xl w-full mx-auto">
        {children}
      </div>
    </div>
  )
}
