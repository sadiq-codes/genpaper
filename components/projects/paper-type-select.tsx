'use client'

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

export type PaperTypeValue = 
  | 'researchArticle' 
  | 'literatureReview' 
  | 'capstoneProject' 
  | 'mastersThesis' 
  | 'phdDissertation'

interface PaperTypeOption {
  value: PaperTypeValue
  label: string
  description: string
}

const paperTypeOptions: PaperTypeOption[] = [
  {
    value: 'researchArticle',
    label: 'Research Article',
    description: 'Original study with methodology and results',
  },
  {
    value: 'literatureReview',
    label: 'Literature Review',
    description: 'Synthesis of existing research',
  },
  {
    value: 'capstoneProject',
    label: 'Capstone Project',
    description: 'Undergraduate final project',
  },
  {
    value: 'mastersThesis',
    label: "Master's Thesis",
    description: 'Graduate-level thesis',
  },
  {
    value: 'phdDissertation',
    label: 'PhD Dissertation',
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
  disabled 
}: PaperTypeSelectProps) {
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
            className="flex flex-col items-start"
          >
            <span className="font-medium">{option.label}</span>
            <span className="text-xs text-muted-foreground">
              {option.description}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

// Export for use in hidden form field
export { paperTypeOptions }
