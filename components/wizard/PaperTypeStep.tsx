'use client'

import { Card, CardContent } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { WizardState } from '../GenerationWizard'
import { 
  FileText, 
  BookOpen, 
  GraduationCap, 
  Award,
  ScrollText,
  Check
} from 'lucide-react'

interface PaperTypeStepProps {
  state: WizardState
  onUpdate: (updates: Partial<WizardState>) => void
}

interface PaperTypeOption {
  id: WizardState['paperType']
  title: string
  description: string
  icon: React.ComponentType<{ className?: string }>
  features: string[]
  typicalLength: string
  audience: string
  badge?: {
    text: string
    variant: 'default' | 'secondary' | 'destructive' | 'outline'
  }
}

const PAPER_TYPES: PaperTypeOption[] = [
  {
    id: 'researchArticle',
    title: 'Research Article',
    description: 'Traditional academic paper following IMRaD format (Introduction, Methods, Results, Discussion)',
    icon: FileText,
    features: [
      'Structured format with clear sections',
      'Methodology and results focus',
      'Peer-reviewed journal style',
      '15-25 academic references'
    ],
    typicalLength: '8-12 pages',
    audience: 'Academic researchers, students',
    badge: {
      text: 'Most Popular',
      variant: 'default'
    }
  },
  {
    id: 'literatureReview',
    title: 'Literature Review',
    description: 'Comprehensive synthesis and critical analysis of existing research on a topic',
    icon: BookOpen,
    features: [
      'Critical analysis of sources',
      'Thematic organization',
      'Gap identification',
      '25-40 academic references'
    ],
    typicalLength: '10-15 pages',
    audience: 'Researchers, graduate students'
  },
  {
    id: 'capstoneProject',
    title: 'Capstone Project',
    description: 'Final-year project proposal with implementation plan and expected outcomes',
    icon: Award,
    features: [
      'Problem statement focus',
      'Implementation timeline',
      'Resource requirements',
      '10-20 academic references'
    ],
    typicalLength: '6-10 pages',
    audience: 'Undergraduate students, advisors'
  },
  {
    id: 'mastersThesis',
    title: 'Master\'s Thesis',
    description: 'Multi-chapter research document with comprehensive analysis and original contribution',
    icon: GraduationCap,
    features: [
      'Multi-chapter structure',
      'Original research contribution',
      'Comprehensive methodology',
      '30-50 academic references'
    ],
    typicalLength: '20-30 pages',
    audience: 'Graduate students, committee members'
  },
  {
    id: 'phdDissertation',
    title: 'PhD Dissertation',
    description: 'Extensive research document with significant original contribution and theoretical framework',
    icon: ScrollText,
    features: [
      'Extensive literature review',
      'Theoretical framework development',
      'Multi-method approach',
      '50+ academic references'
    ],
    typicalLength: '40-60 pages',
    audience: 'Doctoral candidates, academic community',
    badge: {
      text: 'Advanced',
      variant: 'secondary'
    }
  }
]

export default function PaperTypeStep({ state, onUpdate }: PaperTypeStepProps) {
  const handlePaperTypeSelect = (paperType: WizardState['paperType']) => {
    onUpdate({ paperType })
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <Label className="text-sm font-medium">
          Choose Your Paper Type
        </Label>
        <p className="text-xs text-muted-foreground">
          Select the format that best matches your requirements.
        </p>
      </div>

      {/* Compact Selection Confirmation */}
      {state.paperType && (
        <div className="flex items-center gap-2 p-2 bg-green-50 border border-green-200 rounded text-xs">
          <Check className="h-3 w-3 text-green-600" />
          <span className="text-green-700 font-medium">
            {PAPER_TYPES.find(t => t.id === state.paperType)?.title} selected
          </span>
        </div>
      )}
      {/* Paper Type Options - Compact Grid */}
      <div className="grid gap-3">
        {PAPER_TYPES.map((option) => {
          const Icon = option.icon
          const isSelected = state.paperType === option.id
          
          return (
            <Card 
              key={option.id}
              className={`cursor-pointer transition-all hover:shadow-sm ${
                isSelected 
                  ? 'ring-1 ring-primary bg-primary/5 border-primary' 
                  : 'hover:border-primary/50'
              }`}
              onClick={() => handlePaperTypeSelect(option.id)}
            >
              <CardContent className="p-3">
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-3 flex-1">
                    <div className={`p-1.5 rounded ${
                      isSelected ? 'bg-primary text-primary-foreground' : 'bg-muted'
                    }`}>
                      <Icon className="h-4 w-4" />
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="text-sm font-medium">{option.title}</h3>
                        {option.badge && (
                          <Badge variant={option.badge.variant} className="text-xs h-4 px-1.5">
                            {option.badge.text}
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mb-2 line-clamp-2">
                        {option.description}
                      </p>
                      
                      {/* Compact metadata */}
                      <div className="flex items-center gap-3 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <FileText className="h-3 w-3" />
                          {option.typicalLength}
                        </span>
                      </div>
                      
                      {/* Features - only show first 2 */}
                      <div className="mt-2">
                        <div className="text-xs text-muted-foreground space-y-0.5">
                          {option.features.slice(0, 2).map((feature, index) => (
                            <div key={index} className="flex items-center gap-1">
                              <div className="w-1 h-1 rounded-full bg-primary/60" />
                              {feature}
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                  
                  {isSelected && (
                    <div className="p-1 rounded-full bg-primary text-primary-foreground">
                      <Check className="h-3 w-3" />
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>

    </div>
  )
} 