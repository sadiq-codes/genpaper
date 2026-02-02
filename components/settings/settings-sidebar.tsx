'use client'

import { cn } from '@/lib/utils'
import { 
  User, 
  PenLine, 
  Settings2, 
  Palette, 
  Shield,
  type LucideIcon
} from 'lucide-react'

export type SettingsSection = 'profile' | 'writing' | 'editor' | 'appearance' | 'account'

interface SectionConfig {
  id: SettingsSection
  label: string
  icon: LucideIcon
  description: string
}

export const SETTINGS_SECTIONS: SectionConfig[] = [
  { id: 'profile', label: 'Profile', icon: User, description: 'Your account information' },
  { id: 'writing', label: 'Writing', icon: PenLine, description: 'Citation style and defaults' },
  { id: 'editor', label: 'Editor', icon: Settings2, description: 'Autocomplete and shortcuts' },
  { id: 'appearance', label: 'Appearance', icon: Palette, description: 'Theme and display' },
  { id: 'account', label: 'Account', icon: Shield, description: 'Security and data' },
]

interface SettingsSidebarProps {
  activeSection: SettingsSection
  onSectionChange: (section: SettingsSection) => void
}

export function SettingsSidebar({ activeSection, onSectionChange }: SettingsSidebarProps) {
  return (
    <nav className="space-y-1" role="navigation" aria-label="Settings navigation">
      {SETTINGS_SECTIONS.map((section) => {
        const Icon = section.icon
        const isActive = activeSection === section.id
        
        return (
          <button
            key={section.id}
            onClick={() => onSectionChange(section.id)}
            className={cn(
              "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              isActive 
                ? "bg-primary/10 text-primary" 
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            )}
            aria-current={isActive ? 'page' : undefined}
          >
            <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
            <div className="min-w-0">
              <div className={cn(
                "text-sm font-medium",
                isActive && "text-primary"
              )}>
                {section.label}
              </div>
              <div className="text-xs text-muted-foreground truncate hidden lg:block">
                {section.description}
              </div>
            </div>
          </button>
        )
      })}
    </nav>
  )
}
