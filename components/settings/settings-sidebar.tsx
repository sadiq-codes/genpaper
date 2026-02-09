'use client'

import { cn } from '@/lib/utils'
import { 
  User, 
  PenLine, 
  Settings2, 
  Palette, 
  Shield,
  CreditCard,
  type LucideIcon
} from 'lucide-react'

export type SettingsSection = 'profile' | 'writing' | 'editor' | 'appearance' | 'billing' | 'account'

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
  { id: 'billing', label: 'Billing', icon: CreditCard, description: 'Subscription and usage' },
  { id: 'account', label: 'Account', icon: Shield, description: 'Security and data' },
]

interface SettingsSidebarProps {
  activeSection: SettingsSection
  onSectionChange: (section: SettingsSection) => void
}

export function SettingsSidebar({ activeSection, onSectionChange }: SettingsSidebarProps) {
  return (
    <nav className="space-y-0.5" role="navigation" aria-label="Settings navigation">
      {SETTINGS_SECTIONS.map((section) => {
        const Icon = section.icon
        const isActive = activeSection === section.id
        
        return (
          <button
            key={section.id}
            onClick={() => onSectionChange(section.id)}
            className={cn(
              "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-all duration-200",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              isActive 
                ? "bg-foreground/80 text-background" 
                : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
            )}
            aria-current={isActive ? 'page' : undefined}
          >
            <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
            <div className="min-w-0">
              <div className={cn(
                "text-sm",
                isActive && "font-medium"
              )}>
                {section.label}
              </div>
              <div className={cn(
                "text-xs truncate hidden lg:block",
                isActive ? "text-background/60" : "text-muted-foreground"
              )}>
                {section.description}
              </div>
            </div>
          </button>
        )
      })}
    </nav>
  )
}
