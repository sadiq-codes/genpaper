'use client'

import { useState, useEffect } from 'react'
import { Label } from '@/components/ui/label'
import { Loader2, Check, Moon, Sun, Monitor, Type } from 'lucide-react'
import { toast } from 'sonner'
import { useTheme } from 'next-themes'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'

const FONT_SIZES = [
  { value: 'small', label: 'Small', description: '14px base' },
  { value: 'medium', label: 'Medium', description: '16px base' },
  { value: 'large', label: 'Large', description: '18px base' },
]

const THEMES = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Monitor },
]

interface AppearanceSectionProps {
  initialFontSize: string
}

export function AppearanceSection({ initialFontSize }: AppearanceSectionProps) {
  const { theme, setTheme } = useTheme()
  const [fontSize, setFontSize] = useState(initialFontSize || 'medium')
  const [isSaving, setIsSaving] = useState(false)
  const [hasChanges, setHasChanges] = useState(false)
  const [mounted, setMounted] = useState(false)

  // Prevent hydration mismatch
  useEffect(() => {
    setMounted(true)
  }, [])

  const handleFontSizeChange = (value: string) => {
    setFontSize(value)
    setHasChanges(value !== initialFontSize)
  }

  const handleSave = async () => {
    setIsSaving(true)
    try {
      const response = await fetch('/api/user/preferences', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fontSize }),
      })

      if (!response.ok) {
        throw new Error('Failed to save preferences')
      }

      toast.success('Appearance settings saved')
      setHasChanges(false)
    } catch (error) {
      console.error('Failed to save settings:', error)
      toast.error('Failed to save settings')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-instrument text-xl tracking-tight">Appearance</h2>
        <p className="text-xs text-muted-foreground mt-0.5">
          Customize how GenPaper looks
        </p>
      </div>

      {/* Theme */}
      <div className="rounded-xl border border-border/70 p-5 sm:p-6 space-y-5">
        <div>
          <h3 className="font-instrument text-base tracking-tight">Theme</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Select your preferred color scheme
          </p>
        </div>

        <div className="grid grid-cols-3 gap-2 sm:gap-3 w-full sm:max-w-md">
          {THEMES.map((themeOption) => {
            const Icon = themeOption.icon
            const isActive = mounted && theme === themeOption.value
            return (
              <button
                key={themeOption.value}
                onClick={() => setTheme(themeOption.value)}
                aria-label={`Set theme to ${themeOption.label}`}
                aria-pressed={isActive}
                className={cn(
                  'flex flex-col items-center gap-1.5 sm:gap-2 p-3 sm:p-4 rounded-xl border transition-all duration-200',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                  isActive
                  ? 'border-brand/50 bg-brand/8 text-brand'
                  : 'border-border/70 hover:border-border hover:bg-muted/50'
                )}
              >
                <Icon 
                  className={cn(
                    'h-5 w-5',
                    isActive ? 'text-foreground' : 'text-muted-foreground'
                  )} 
                  aria-hidden="true"
                />
                <span className={cn(
                  'text-xs',
                  isActive ? 'text-foreground font-medium' : 'text-muted-foreground'
                )}>
                  {themeOption.label}
                </span>
              </button>
            )
          })}
        </div>
        <p className="text-[11px] text-muted-foreground">
          Theme preference is saved in your browser.
        </p>
      </div>

      {/* Font Size */}
      <div className="rounded-xl border border-border/70 p-5 sm:p-6 space-y-5">
        <div>
          <h3 className="font-instrument text-base tracking-tight">Editor Font Size</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Adjust the text size in the editor
          </p>
        </div>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="font-size" className="flex items-center gap-2 text-xs">
              <Type className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
              Font Size
            </Label>
            <Select value={fontSize} onValueChange={handleFontSizeChange}>
              <SelectTrigger className="w-full sm:max-w-xs">
                <SelectValue placeholder="Select size…" />
              </SelectTrigger>
              <SelectContent>
                {FONT_SIZES.map((size) => (
                  <SelectItem key={size.value} value={size.value}>
                    <span className="flex items-center gap-2">
                      {size.label}
                      <span className="text-muted-foreground text-xs">({size.description})</span>
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Preview */}
          <div className="rounded-lg bg-muted/50 p-3 sm:p-4 w-full sm:max-w-md border border-border/70">
            <p className="text-muted-foreground text-[11px] mb-2 font-medium uppercase tracking-wide">Preview</p>
            <p 
              className="text-foreground"
              style={{ 
                fontSize: fontSize === 'small' ? '14px' : fontSize === 'large' ? '18px' : '16px' 
              }}
            >
              The quick brown fox jumps over the lazy dog.
            </p>
          </div>
        </div>
      </div>

      {/* Save Button */}
      {hasChanges && (
        <div className="flex justify-end">
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="inline-flex items-center gap-2 h-9 px-4 rounded-full bg-foreground/80 text-background text-sm font-medium hover:bg-foreground transition-colors disabled:opacity-50"
          >
            {isSaving ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                Saving…
              </>
            ) : (
              <>
                <Check className="h-3.5 w-3.5" aria-hidden="true" />
                Save Changes
              </>
            )}
          </button>
        </div>
      )}
    </div>
  )
}
