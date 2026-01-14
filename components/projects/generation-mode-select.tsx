'use client'

import { ChevronDown, Sparkles, PenLine } from 'lucide-react'
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
          'h-7 px-2.5 text-xs font-medium',
          'bg-muted/50 hover:bg-muted',
          'border-0 rounded-md',
          'gap-1.5 w-auto',
          'focus:ring-1 focus:ring-ring/50',
          'transition-colors'
        )}
      >
        <Icon className="h-3 w-3" />
        <SelectValue>
          {selectedOption?.shortLabel || 'Select mode'}
        </SelectValue>
        <ChevronDown className="h-3 w-3 opacity-50" />
      </SelectTrigger>
      <SelectContent align="start">
        {generationModeOptions.map((option) => {
          const OptionIcon = option.icon
          return (
            <SelectItem
              key={option.value}
              value={option.value}
              className="py-2"
            >
              <div className="flex items-start gap-2">
                <OptionIcon className="h-4 w-4 mt-0.5 shrink-0" />
                <div className="flex flex-col gap-0.5">
                  <span className="font-medium">{option.label}</span>
                  <span className="text-xs text-muted-foreground">
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
