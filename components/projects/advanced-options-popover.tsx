'use client'

import { Settings2, FlaskConical, Lightbulb, Library, Globe } from 'lucide-react'
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
  useLibraryOnly: boolean
  onUseLibraryOnlyChange: (value: boolean) => void
  disabled?: boolean
}

export function AdvancedOptionsPopover({
  hasOriginalResearch,
  onHasOriginalResearchChange,
  keyFindings,
  onKeyFindingsChange,
  showKeyFindings,
  showOriginalResearchToggle,
  useLibraryOnly,
  onUseLibraryOnlyChange,
  disabled,
}: AdvancedOptionsPopoverProps) {
  const hasActiveSettings = hasOriginalResearch || useLibraryOnly

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          className={cn(
            'h-8 w-8 rounded-full flex items-center justify-center relative',
            'text-muted-foreground/60 hover:text-foreground',
            'border border-border/60 hover:border-border',
            'transition-colors cursor-pointer',
            'disabled:opacity-40',
            hasActiveSettings && 'text-foreground border-foreground/20'
          )}
          disabled={disabled}
          type="button"
        >
          <Settings2 className="h-3.5 w-3.5" />
          {hasActiveSettings && (
            <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-foreground" />
          )}
          <span className="sr-only">Advanced options</span>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-96 rounded-xl p-5" align="start" side="bottom">
        <div className="space-y-5">
          {/* Header */}
          <div>
            <h4 className="font-instrument text-base tracking-tight mb-0.5">
              Advanced Options
            </h4>
            <p className="text-[11px] text-muted-foreground/50">
              Configure how your research paper will be generated
            </p>
          </div>

          {/* Paper Source Toggle */}
          <div className="space-y-3">
            <div className="flex items-start gap-3 p-3 rounded-xl bg-muted/30 border border-border/20">
              <Checkbox
                id="useLibraryOnly"
                checked={useLibraryOnly}
                onCheckedChange={(checked) => onUseLibraryOnlyChange(checked === true)}
                disabled={disabled}
                className="mt-0.5"
              />
              <div className="space-y-1">
                <Label
                  htmlFor="useLibraryOnly"
                  className="text-sm font-medium cursor-pointer leading-none flex items-center gap-1.5"
                >
                  <Library className="h-3 w-3" />
                  Use only my papers
                </Label>
                <p className="text-[11px] text-muted-foreground/50">
                  Only use papers you&apos;ve uploaded or added. Don&apos;t search online databases.
                </p>
              </div>
            </div>
            
            {!useLibraryOnly && (
              <div className="flex items-center gap-2 text-[11px] text-muted-foreground/40 px-1">
                <Globe className="h-3 w-3" />
                <span>Will also search academic databases for relevant papers</span>
              </div>
            )}
          </div>

          {/* Original Research Toggle */}
          {showOriginalResearchToggle && (
            <div className="space-y-3 pt-3 border-t border-border/20">
              <div className="flex items-start gap-3 p-3 rounded-xl bg-muted/30 border border-border/20">
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
                  <p className="text-[11px] text-muted-foreground/50">
                    Enable if writing about your own study or experiments
                  </p>
                </div>
              </div>

              {showKeyFindings && (
                <div className="space-y-2 animate-in fade-in slide-in-from-top-2 duration-200">
                  <div className="flex items-center gap-2">
                    <FlaskConical className="h-3.5 w-3.5 text-foreground/50" />
                    <Label htmlFor="keyFindings" className="text-sm font-medium">
                      Your Key Findings
                    </Label>
                    <span className="text-[10px] text-destructive/70">required</span>
                  </div>
                  <Textarea
                    id="keyFindings"
                    value={keyFindings}
                    onChange={(e) => onKeyFindingsChange(e.target.value)}
                    placeholder="Summarize your main results (e.g., 'We found that X significantly improves Y by 30%...')"
                    className="min-h-[200px] resize-y text-sm rounded-xl border-border/30 focus-visible:ring-0 focus-visible:border-foreground/20"
                    disabled={disabled}
                  />
                  <div className="flex items-start gap-2 text-[11px] text-muted-foreground/40">
                    <Lightbulb className="h-3 w-3 mt-0.5 shrink-0" />
                    <span>
                      This helps us find relevant supporting literature for your findings.
                    </span>
                  </div>
                </div>
              )}
            </div>
          )}

          {!showOriginalResearchToggle && !useLibraryOnly && (
            <p className="text-center text-[11px] text-muted-foreground/40 font-instrument italic">
              Literature reviews synthesize existing research.
            </p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
