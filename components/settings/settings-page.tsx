'use client'

import { useState, useEffect } from 'react'
import dynamic from 'next/dynamic'
import { SettingsSidebar, type SettingsSection, SETTINGS_SECTIONS } from './settings-sidebar'
import { ProfileSection } from './sections/profile-section'
import { WritingSection } from './sections/writing-section'
import { AppearanceSection } from './sections/appearance-section'
import { AccountSection } from './sections/account-section'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Loader2 } from 'lucide-react'

// Lazy load BillingSection - only loads when user clicks billing tab
// This prevents the subscription API from being called on settings page load
const BillingSection = dynamic(
  () => import('./sections/billing-section').then(mod => ({ default: mod.BillingSection })),
  { 
    ssr: false,
    loading: () => (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    )
  }
)

export interface UserData {
  id: string
  email: string
  fullName: string | null
  createdAt: string
}

export interface UserPreferences {
  citationStyle: string
  defaultPaperType: string
  autoSuggestions: boolean
  includeCitations: boolean
  acceptKey: 'tab' | 'ctrlEnter'
  useExternalSources: boolean
  fontSize: string
}

interface SettingsPageProps {
  user: UserData
  preferences: UserPreferences
  subscription: {
    tier: string
    tierName: string
    papersUsed: number
    papersLimit: number
    papersRemaining: number
    periodEndsAt: string | null
    features: string[]
  }
}

export function SettingsPage({ user, preferences, subscription }: SettingsPageProps) {
  const [activeSection, setActiveSection] = useState<SettingsSection>('profile')

  // Handle hash-based navigation
  useEffect(() => {
    const handleHashChange = () => {
      const hash = window.location.hash.slice(1) as SettingsSection
      if (hash && SETTINGS_SECTIONS.some(s => s.id === hash)) {
        setActiveSection(hash)
      }
    }

    // Set initial section from hash
    handleHashChange()

    window.addEventListener('hashchange', handleHashChange)
    return () => window.removeEventListener('hashchange', handleHashChange)
  }, [])

  const handleSectionChange = (section: SettingsSection) => {
    setActiveSection(section)
    window.location.hash = section
  }

  const renderSection = () => {
    switch (activeSection) {
      case 'profile':
        return <ProfileSection user={user} />
      case 'writing':
        return (
          <WritingSection
            initialCitationStyle={preferences.citationStyle}
            initialPaperType={preferences.defaultPaperType}
            initialAutoSuggestions={preferences.autoSuggestions}
            initialIncludeCitations={preferences.includeCitations}
            initialAcceptKey={preferences.acceptKey}
            initialUseExternalSources={preferences.useExternalSources}
          />
        )
      case 'appearance':
        return <AppearanceSection initialFontSize={preferences.fontSize} />
      case 'billing':
        return <BillingSection user={user} initialSubscription={subscription} />
      case 'account':
        return <AccountSection user={user} />
      default:
        return <ProfileSection user={user} />
    }
  }

  return (
    <div className="flex flex-col lg:flex-row gap-4 sm:gap-6 lg:gap-10 min-h-0">
      {/* Mobile Section Selector */}
      <div className="lg:hidden sticky top-0 z-10 bg-background/95 backdrop-blur-sm py-3 -mx-4 px-4 sm:-mx-6 sm:px-6 border-b border-border/60">
        <div className="flex gap-1 overflow-x-auto pb-0.5 scrollbar-none">
          {SETTINGS_SECTIONS.map((section) => {
            const Icon = section.icon
            const isActive = activeSection === section.id
            return (
              <button
                key={section.id}
                onClick={() => handleSectionChange(section.id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs whitespace-nowrap transition-all duration-200 shrink-0 ${
                  isActive
                    ? 'bg-foreground/80 text-background font-medium'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                }`}
              >
                <Icon className="h-3 w-3" aria-hidden="true" />
                {section.label}
              </button>
            )
          })}
        </div>
      </div>

      {/* Desktop Sidebar */}
      <aside className="hidden lg:block w-56 shrink-0">
        <div className="sticky top-6">
          <SettingsSidebar
            activeSection={activeSection}
            onSectionChange={handleSectionChange}
          />
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 min-w-0">
        <ScrollArea className="h-full overscroll-contain touch-manipulation">
          <div className="max-w-2xl pb-8 sm:pb-12">
            {renderSection()}
          </div>
        </ScrollArea>
      </main>
    </div>
  )
}
