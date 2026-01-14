'use client'

import { ChevronDown } from 'lucide-react'
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
    description: 'Original study with methodology and results',
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
  variant?: 'default' | 'inline'
}

export function PaperTypeSelect({ 
  value, 
  onValueChange, 
  disabled,
  variant = 'default',
}: PaperTypeSelectProps) {
  const selectedOption = paperTypeOptions.find(opt => opt.value === value)

  if (variant === 'inline') {
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
          <SelectValue>
            {selectedOption?.shortLabel || 'Select type'}
          </SelectValue>
          <ChevronDown className="h-3 w-3 opacity-50" />
        </SelectTrigger>
        <SelectContent align="start">
          {paperTypeOptions.map((option) => (
            <SelectItem 
              key={option.value} 
              value={option.value}
              className="py-2"
            >
              <div className="flex flex-col gap-0.5">
                <span className="font-medium">{option.label}</span>
                <span className="text-xs text-muted-foreground">
                  {option.description}
                </span>
              </div>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    )
  }

  // Default variant
  return (
    <Select value={value} onValueChange={onValueChange} disabled={disabled}>
      <SelectTrigger className="w-[200px]">
        <SelectValue placeholder="Select paper type" />
      </SelectTrigger>
      <SelectContent>
        {paperTypeOptions.map((option) => (
          <SelectItem 
            key={option.value} 
            value={option.value}
            className="py-2"
          >
            <div className="flex flex-col gap-0.5">
              <span className="font-medium">{option.label}</span>
              <span className="text-xs text-muted-foreground">
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
