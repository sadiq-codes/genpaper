'use client'

import { Sparkles, PenLine } from 'lucide-react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'

export type GenerationMode = 'generate' | 'write'

interface GenerationModeOption {
  value: GenerationMode
  label: string
  shortLabel: string
  description: string
  icon: typeof Sparkles
}

const generationModeOptions: GenerationModeOption[] = [
  {
    value: 'generate',
    label: 'AI Generate',
    shortLabel: 'AI Generate',
    description: 'AI writes a complete paper based on your topic',
    icon: Sparkles,
  },
  {
    value: 'write',
    label: 'Write myself',
    shortLabel: 'Write myself',
    description: 'Start with a blank document and write as you go',
    icon: PenLine,
  },
]

interface GenerationModeSelectProps {
  value: GenerationMode
  onValueChange: (value: GenerationMode) => void
  disabled?: boolean
}

export function GenerationModeSelect({
  value,
  onValueChange,
  disabled,
}: GenerationModeSelectProps) {
  const selectedOption = generationModeOptions.find(opt => opt.value === value)
  const Icon = selectedOption?.icon || Sparkles

  return (
    <Select value={value} onValueChange={onValueChange} disabled={disabled}>
      <SelectTrigger
        className={cn(
          'h-8 px-3 text-xs',
          'bg-transparent hover:bg-muted/50',
          'border border-border/40 hover:border-border/60 rounded-full',
          'gap-1.5 w-auto',
          'focus:ring-0 focus:border-foreground/20',
          'transition-colors'
        )}
      >
        <Icon className="h-3 w-3 text-muted-foreground" />
        <SelectValue>
          {selectedOption?.shortLabel || 'Select mode'}
        </SelectValue>
      </SelectTrigger>
      <SelectContent align="start" className="rounded-xl">
        {generationModeOptions.map((option) => {
          const OptionIcon = option.icon
          return (
            <SelectItem
              key={option.value}
              value={option.value}
              className="py-2.5 rounded-lg"
            >
              <div className="flex items-start gap-2.5">
                <div className="w-6 h-6 rounded-full bg-foreground/5 flex items-center justify-center shrink-0 mt-0.5">
                  <OptionIcon className="h-3 w-3 text-foreground/60" />
                </div>
                <div className="flex flex-col gap-0.5">
                  <span className="font-medium text-sm">{option.label}</span>
                  <span className="text-[11px] text-muted-foreground/60">
                    {option.description}
                  </span>
                </div>
              </div>
            </SelectItem>
          )
        })}
      </SelectContent>
    </Select>
  )
}

export { generationModeOptions }
