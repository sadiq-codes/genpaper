'use client'

import { Settings2, FlaskConical, Lightbulb } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { cn } from '@/lib/utils'

interface AdvancedOptionsPopoverProps {
  hasOriginalResearch: boolean
  onHasOriginalResearchChange: (value: boolean) => void
  keyFindings: string
  onKeyFindingsChange: (value: string) => void
  showKeyFindings: boolean
  showOriginalResearchToggle: boolean
  disabled?: boolean
}

export function AdvancedOptionsPopover({
  hasOriginalResearch,
  onHasOriginalResearchChange,
  keyFindings,
  onKeyFindingsChange,
  showKeyFindings,
  showOriginalResearchToggle,
  disabled,
}: AdvancedOptionsPopoverProps) {
  // Show indicator dot if original research is enabled
  const hasActiveSettings = hasOriginalResearch

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={cn(
            'h-8 w-8 text-muted-foreground hover:text-foreground relative',
            hasActiveSettings && 'text-primary'
          )}
          disabled={disabled}
          type="button"
        >
          <Settings2 className="h-4 w-4" />
          {hasActiveSettings && (
            <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-primary" />
          )}
          <span className="sr-only">Advanced options</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80" align="start" side="top">
        <div className="space-y-4">
          {/* Header */}
          <div className="space-y-1">
            <h4 className="font-semibold text-sm flex items-center gap-2">
              <Settings2 className="h-4 w-4" />
              Advanced Options
            </h4>
            <p className="text-xs text-muted-foreground">
              Configure how your research paper will be generated
            </p>
          </div>

          {/* Original Research Toggle */}
          {showOriginalResearchToggle && (
            <div className="space-y-3">
              <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/50">
                <Checkbox
                  id="hasOriginalResearch"
                  checked={hasOriginalResearch}
                  onCheckedChange={(checked) => onHasOriginalResearchChange(checked === true)}
                  disabled={disabled}
                  className="mt-0.5"
                />
                <div className="space-y-1">
                  <Label
                    htmlFor="hasOriginalResearch"
                    className="text-sm font-medium cursor-pointer leading-none"
                  >
                    I have original research/data
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Enable this if you&apos;re writing about your own study or experiments
                  </p>
                </div>
              </div>

              {/* Key Findings (conditional) */}
              {showKeyFindings && (
                <div className="space-y-2 animate-in fade-in slide-in-from-top-2 duration-200">
                  <div className="flex items-center gap-2">
                    <FlaskConical className="h-4 w-4 text-primary" />
                    <Label htmlFor="keyFindings" className="text-sm font-medium">
                      Your Key Findings
                    </Label>
                    <span className="text-xs text-destructive">*</span>
                  </div>
                  <Textarea
                    id="keyFindings"
                    value={keyFindings}
                    onChange={(e) => onKeyFindingsChange(e.target.value)}
                    placeholder="Summarize your main results (e.g., 'We found that X significantly improves Y by 30%...')"
                    className="min-h-[100px] resize-none text-sm"
                    disabled={disabled}
                  />
                  <div className="flex items-start gap-2 text-xs text-muted-foreground">
                    <Lightbulb className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                    <span>
                      Brief summary of your primary results. This helps us find relevant 
                      supporting literature for your findings.
                    </span>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Show message if no options available */}
          {!showOriginalResearchToggle && (
            <div className="py-4 text-center text-sm text-muted-foreground">
              <p>No additional options for this paper type.</p>
              <p className="text-xs mt-1">Literature reviews synthesize existing research.</p>
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
