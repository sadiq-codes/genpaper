/**
 * Region Selector Component
 * 
 * Provides user-friendly controls for region detection:
 * - Toggle for enabling/disabling auto-detection
 * - Dropdown for manual region selection
 * - Integration with the flexible region system
 */

'use client'

import { useState, useEffect } from 'react'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Info } from 'lucide-react'
import { createRegionOptions, parseUserRegionSelection, type RegionDetectionOptions } from '@/lib/utils/region-detection-flexible'

interface RegionSelectorProps {
  value?: string
  onChange?: (options: RegionDetectionOptions) => void
  showDescription?: boolean
  className?: string
}

export function RegionSelector({ 
  value = '', 
  onChange, 
  showDescription = true, 
  className 
}: RegionSelectorProps) {
  const [selectedValue, setSelectedValue] = useState(value)
  const [regionOptions, setRegionOptions] = useState<Array<{
    value: string
    label: string
    category?: string
  }>>([])

  // Load region options on mount
  useEffect(() => {
    const options = createRegionOptions(true)
    setRegionOptions(options)
  }, [])

  // Handle selection change
  const handleSelectionChange = (newValue: string) => {
    setSelectedValue(newValue)
    
    if (onChange) {
      const detectionOptions = parseUserRegionSelection(newValue)
      onChange(detectionOptions)
    }
  }

  // Get current selection info
  const getCurrentInfo = () => {
    if (!selectedValue || selectedValue === '') {
      return {
        type: 'disabled',
        description: 'No regional focus - papers from all regions will be treated equally',
        badge: 'Global'
      }
    }
    
    if (selectedValue === '__auto__') {
      return {
        type: 'auto',
        description: 'Automatically detect region from paper venue, URL, and author affiliations',
        badge: 'Auto-detect'
      }
    }
    
    const selectedOption = regionOptions.find(opt => opt.value === selectedValue)
    return {
      type: 'manual',
      description: `Focus specifically on research from ${selectedOption?.label || selectedValue}`,
      badge: selectedOption?.label || selectedValue
    }
  }

  const currentInfo = getCurrentInfo()

  return (
    <Card className={className}>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          Regional Focus
          <Badge variant={currentInfo.type === 'disabled' ? 'outline' : 'default'}>
            {currentInfo.badge}
          </Badge>
        </CardTitle>
        {showDescription && (
          <CardDescription className="text-sm">
            Choose how to handle regional context in your research
          </CardDescription>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="region-select">Region Selection</Label>
          <Select value={selectedValue} onValueChange={handleSelectionChange}>
            <SelectTrigger id="region-select">
              <SelectValue placeholder="Choose regional focus..." />
            </SelectTrigger>
            <SelectContent>
              {/* No regional focus */}
              <SelectItem value="">
                <div className="flex items-center gap-2">
                  <span>🌍</span>
                  <span>No regional focus</span>
                </div>
              </SelectItem>
              
              {/* Auto-detect */}
              <SelectItem value="__auto__">
                <div className="flex items-center gap-2">
                  <span>🔍</span>
                  <span>Auto-detect from paper content</span>
                </div>
              </SelectItem>
              
              {/* Specific regions */}
              {regionOptions
                .filter(opt => opt.category === 'Specific Regions')
                .map(option => (
                  <SelectItem key={option.value} value={option.value}>
                    <div className="flex items-center gap-2">
                      <span>📍</span>
                      <span>{option.label}</span>
                    </div>
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        </div>

        {/* Current selection info */}
        <div className="rounded-lg bg-muted/50 p-3">
          <div className="flex items-start gap-2">
            <Info className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
            <div className="text-sm text-muted-foreground">
              {currentInfo.description}
            </div>
          </div>
        </div>

        {/* Additional info for auto-detect */}
        {selectedValue === '__auto__' && (
          <div className="text-xs text-muted-foreground space-y-1">
            <p><strong>Detection sources (in order):</strong></p>
            <ul className="ml-4 space-y-0.5">
              <li>• Journal venue names</li>
              <li>• Website domains (.ng, .gh, etc.)</li>
              <li>• Author affiliations</li>
              <li>• Author names (limited)</li>
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// Export type for use in parent components
export type { RegionDetectionOptions } 