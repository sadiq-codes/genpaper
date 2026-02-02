'use client'

import { useState, useEffect } from 'react'
import { SettingsSidebar, type SettingsSection, SETTINGS_SECTIONS } from './settings-sidebar'
import { ProfileSection } from './sections/profile-section'
import { WritingSection } from './sections/writing-section'
import { EditorSection } from './sections/editor-section'
import { AppearanceSection } from './sections/appearance-section'
import { AccountSection } from './sections/account-section'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

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
  fontSize: string
}

interface SettingsPageProps {
  user: UserData
  preferences: UserPreferences
}

export function SettingsPage({ user, preferences }: SettingsPageProps) {
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
          />
        )
      case 'editor':
        return (
          <EditorSection
            initialAutoSuggestions={preferences.autoSuggestions}
            initialIncludeCitations={preferences.includeCitations}
            initialAcceptKey={preferences.acceptKey}
          />
        )
      case 'appearance':
        return <AppearanceSection initialFontSize={preferences.fontSize} />
      case 'account':
        return <AccountSection user={user} />
      default:
        return <ProfileSection user={user} />
    }
  }

  return (
    <div className="flex flex-col lg:flex-row gap-6 lg:gap-8 min-h-0">
      {/* Mobile Section Selector */}
      <div className="lg:hidden">
        <Select value={activeSection} onValueChange={(v) => handleSectionChange(v as SettingsSection)}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Select section" />
          </SelectTrigger>
          <SelectContent>
            {SETTINGS_SECTIONS.map((section) => {
              const Icon = section.icon
              return (
                <SelectItem key={section.id} value={section.id}>
                  <span className="flex items-center gap-2">
                    <Icon className="h-4 w-4" />
                    {section.label}
                  </span>
                </SelectItem>
              )
            })}
          </SelectContent>
        </Select>
      </div>

      {/* Desktop Sidebar */}
      <aside className="hidden lg:block w-56 flex-shrink-0">
        <div className="sticky top-6">
          <SettingsSidebar
            activeSection={activeSection}
            onSectionChange={handleSectionChange}
          />
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 min-w-0">
        <ScrollArea className="h-full">
          <div className="max-w-2xl pb-8">
            {renderSection()}
          </div>
        </ScrollArea>
      </main>
    </div>
  )
}
