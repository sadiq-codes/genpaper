'use client'

import { useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Loader2, Check } from 'lucide-react'
import { toast } from 'sonner'
import { CitationStyleSelector } from '@/components/editor/CitationStyleSelector'
import { getStyleById } from '@/lib/citations/csl-styles'

interface SettingsFormProps {
  initialCitationStyle: string
}

export function SettingsForm({ initialCitationStyle }: SettingsFormProps) {
  const [citationStyle, setCitationStyle] = useState<string>(initialCitationStyle || 'apa')
  const [isSaving, setIsSaving] = useState(false)
  const [hasChanges, setHasChanges] = useState(false)

  const handleStyleChange = (value: string) => {
    setCitationStyle(value)
    setHasChanges(value !== initialCitationStyle)
  }

  const handleSave = async () => {
    setIsSaving(true)
    try {
      const response = await fetch('/api/user/preferences', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ citationStyle }),
      })

      if (!response.ok) {
        throw new Error('Failed to save preferences')
      }

      const styleInfo = getStyleById(citationStyle)
      toast.success('Settings saved', {
        description: `Default citation style set to ${styleInfo?.shortName || styleInfo?.name || citationStyle}`,
      })
      setHasChanges(false)
    } catch (error) {
      console.error('Failed to save settings:', error)
      toast.error('Failed to save settings')
    } finally {
      setIsSaving(false)
    }
  }

  const selectedStyle = getStyleById(citationStyle)

  return (
    <div className="space-y-6">
      {/* Citation Style Card */}
      <Card>
        <CardHeader>
          <CardTitle>Citation Style</CardTitle>
          <CardDescription>
            Choose your default citation format. This will be used for new projects 
            and autocomplete suggestions.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="citation-style">Default Style</Label>
            <div className="max-w-md">
              <CitationStyleSelector
                value={citationStyle}
                onValueChange={handleStyleChange}
              />
            </div>
          </div>

          {/* Preview */}
          {selectedStyle && (
            <div className="rounded-lg bg-muted p-4 text-sm max-w-md">
              <p className="text-muted-foreground text-xs mb-2 font-medium">Example in-text citation:</p>
              <p className="text-foreground">
                Research shows significant findings in this area{' '}
                <span className="font-semibold text-primary">{selectedStyle.inlineExample}</span>.
              </p>
            </div>
          )}

          <p className="text-xs text-muted-foreground">
            You can also set a different citation style per project in the project settings.
          </p>
        </CardContent>
      </Card>

      {/* Save Button */}
      <div className="flex justify-end">
        <Button 
          onClick={handleSave} 
          disabled={isSaving || !hasChanges}
        >
          {isSaving ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Saving...
            </>
          ) : (
            <>
              <Check className="mr-2 h-4 w-4" />
              Save Changes
            </>
          )}
        </Button>
      </div>
    </div>
  )
}
