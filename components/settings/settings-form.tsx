'use client'

import { useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { Loader2, Check } from 'lucide-react'
import { toast } from 'sonner'

type CitationStyle = 'apa' | 'mla' | 'chicago' | 'ieee' | 'harvard'

interface SettingsFormProps {
  initialCitationStyle: CitationStyle
}

const citationStyleOptions: { value: CitationStyle; label: string; example: string }[] = [
  { 
    value: 'apa', 
    label: 'APA (7th Edition)', 
    example: '(Smith et al., 2023)' 
  },
  { 
    value: 'mla', 
    label: 'MLA (9th Edition)', 
    example: '(Smith et al.)' 
  },
  { 
    value: 'chicago', 
    label: 'Chicago (17th Edition)', 
    example: '(Smith et al. 2023)' 
  },
  { 
    value: 'ieee', 
    label: 'IEEE', 
    example: '[1]' 
  },
  { 
    value: 'harvard', 
    label: 'Harvard', 
    example: '(Smith et al., 2023)' 
  },
]

export function SettingsForm({ initialCitationStyle }: SettingsFormProps) {
  const [citationStyle, setCitationStyle] = useState<CitationStyle>(initialCitationStyle)
  const [isSaving, setIsSaving] = useState(false)
  const [hasChanges, setHasChanges] = useState(false)

  const handleStyleChange = (value: CitationStyle) => {
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

      toast.success('Settings saved', {
        description: `Default citation style set to ${citationStyleOptions.find(o => o.value === citationStyle)?.label}`,
      })
      setHasChanges(false)
    } catch (error) {
      console.error('Failed to save settings:', error)
      toast.error('Failed to save settings')
    } finally {
      setIsSaving(false)
    }
  }

  const selectedStyle = citationStyleOptions.find(o => o.value === citationStyle)

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
            <Select
              value={citationStyle}
              onValueChange={(value) => handleStyleChange(value as CitationStyle)}
            >
              <SelectTrigger id="citation-style" className="w-full max-w-md">
                <SelectValue placeholder="Select a citation style" />
              </SelectTrigger>
              <SelectContent>
                {citationStyleOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    <div className="flex items-center justify-between w-full gap-4">
                      <span>{option.label}</span>
                      <span className="text-muted-foreground text-xs">
                        {option.example}
                      </span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Preview */}
          {selectedStyle && (
            <div className="rounded-lg bg-muted p-4 text-sm max-w-md">
              <p className="text-muted-foreground text-xs mb-2 font-medium">Example in-text citation:</p>
              <p className="text-foreground">
                Research shows significant findings in this area{' '}
                <span className="font-semibold text-primary">{selectedStyle.example}</span>.
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
