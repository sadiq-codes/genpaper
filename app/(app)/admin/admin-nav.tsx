'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import { BarChart3, FileText, Mail, Server } from 'lucide-react'

const tabs = [
  { label: 'Metrics', href: '/admin/metrics', icon: BarChart3 },
  { label: 'Infrastructure', href: '/admin/infrastructure', icon: Server },
  { label: 'Blog', href: '/admin/blog', icon: FileText },
  { label: 'Emails', href: '/admin/emails', icon: Mail },
]

export function AdminNav() {
  const pathname = usePathname()

  return (
    <div className="border-b bg-background/80 backdrop-blur-sm sticky top-0 z-10">
      <div className="max-w-6xl mx-auto px-4 md:px-6">
        <div className="flex items-center gap-6 h-12">
          <span className="text-sm font-semibold text-foreground/70 tracking-tight select-none">Admin</span>
          <nav className="flex items-center gap-1">
            {tabs.map((tab) => {
              const active = pathname === tab.href || pathname.startsWith(tab.href + '/')
              return (
                <Link
                  key={tab.href}
                  href={tab.href}
                  className={cn(
                    'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors',
                    active
                      ? 'bg-accent text-accent-foreground'
                      : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'
                  )}
                >
                  <tab.icon className="h-3.5 w-3.5" />
                  {tab.label}
                </Link>
              )
            })}
          </nav>
        </div>
      </div>
    </div>
  )
}
