'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
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
        <h2 className="text-lg font-semibold">Appearance</h2>
        <p className="text-sm text-muted-foreground">
          Customize how GenPaper looks
        </p>
      </div>

      {/* Theme Card */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Theme</CardTitle>
          <CardDescription>
            Select your preferred color scheme
          </CardDescription>
        </CardHeader>
        <CardContent>
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
                    'flex flex-col items-center gap-1.5 sm:gap-2 p-3 sm:p-4 rounded-lg border-2 transition-colors',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                    isActive
                      ? 'border-primary bg-primary/5'
                      : 'border-border hover:border-primary/50 hover:bg-muted/50'
                  )}
                >
                  <Icon 
                    className={cn(
                      'h-5 w-5',
                      isActive ? 'text-primary' : 'text-muted-foreground'
                    )} 
                    aria-hidden="true"
                  />
                  <span className={cn(
                    'text-sm font-medium',
                    isActive ? 'text-primary' : 'text-foreground'
                  )}>
                    {themeOption.label}
                  </span>
                </button>
              )
            })}
          </div>
          <p className="text-xs text-muted-foreground mt-3">
            Theme preference is saved in your browser.
          </p>
        </CardContent>
      </Card>

      {/* Font Size Card */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Editor Font Size</CardTitle>
          <CardDescription>
            Adjust the text size in the editor
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 sm:space-y-6">
          <div className="space-y-2">
            <Label htmlFor="font-size" className="flex items-center gap-2">
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
          <div className="rounded-lg bg-muted p-3 sm:p-4 w-full sm:max-w-md">
            <p className="text-muted-foreground text-xs mb-2 font-medium">Preview:</p>
            <p 
              className="text-foreground"
              style={{ 
                fontSize: fontSize === 'small' ? '14px' : fontSize === 'large' ? '18px' : '16px' 
              }}
            >
              The quick brown fox jumps over the lazy dog.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Save Button */}
      {hasChanges && (
        <div className="flex justify-end">
          <Button onClick={handleSave} disabled={isSaving}>
            {isSaving ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                Saving…
              </>
            ) : (
              <>
                <Check className="mr-2 h-4 w-4" aria-hidden="true" />
                Save Changes
              </>
            )}
          </Button>
        </div>
      )}
    </div>
  )
}
