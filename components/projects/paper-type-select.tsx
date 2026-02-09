'use client'

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'

export type PaperTypeValue = 
  | 'researchArticle' 
  | 'literatureReview' 
  | 'capstoneProject' 
  | 'mastersThesis' 
  | 'phdDissertation'

interface PaperTypeOption {
  value: PaperTypeValue
  label: string
  shortLabel: string
  description: string
}

const paperTypeOptions: PaperTypeOption[] = [
  {
    value: 'literatureReview',
    label: 'Literature Review',
    shortLabel: 'Lit Review',
    description: 'Synthesis of existing research',
  },
  {
    value: 'researchArticle',
    label: 'Research Article',
    shortLabel: 'Research',
    description: 'Original study with methodology',
  },
  {
    value: 'capstoneProject',
    label: 'Capstone Project',
    shortLabel: 'Capstone',
    description: 'Undergraduate final project',
  },
  {
    value: 'mastersThesis',
    label: "Master's Thesis",
    shortLabel: "Master's",
    description: 'Graduate-level thesis',
  },
  {
    value: 'phdDissertation',
    label: 'PhD Dissertation',
    shortLabel: 'PhD',
    description: 'Doctoral dissertation',
  },
]

interface PaperTypeSelectProps {
  value: PaperTypeValue
  onValueChange: (value: PaperTypeValue) => void
  disabled?: boolean
}

export function PaperTypeSelect({ 
  value, 
  onValueChange, 
  disabled,
}: PaperTypeSelectProps) {
  const selectedOption = paperTypeOptions.find(opt => opt.value === value)

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
        <SelectValue>
          {selectedOption?.shortLabel || 'Select type'}
        </SelectValue>
      </SelectTrigger>
      <SelectContent align="start" className="rounded-xl">
        {paperTypeOptions.map((option) => (
          <SelectItem 
            key={option.value} 
            value={option.value}
            className="py-2.5 rounded-lg"
          >
            <div className="flex flex-col gap-0.5">
              <span className="font-medium text-sm">{option.label}</span>
              <span className="text-[11px] text-muted-foreground/60">
                {option.description}
              </span>
            </div>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

// Export for use in hidden form field
export { paperTypeOptions }
