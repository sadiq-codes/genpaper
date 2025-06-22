'use client'

import { Card, CardContent } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { WizardState } from '../GenerationWizard'
import { 
  Zap,
  Edit3,
  Target,
  Check
} from 'lucide-react'

interface GenerationOptionsStepProps {
  state: WizardState
  onUpdate: (updates: Partial<WizardState>) => void
}

interface GenerationModeOption {
  id: WizardState['generationMode']
  title: string
  description: string
  icon: React.ComponentType<{ className?: string }>
  features: string[]
  idealFor: string[]
  badge?: {
    text: string
    variant: 'default' | 'secondary' | 'destructive' | 'outline'
  }
}

const GENERATION_MODES: GenerationModeOption[] = [
  {
    id: 'quick',
    title: 'Quick Generation',
    description: 'Generate a complete research paper automatically - starts immediately',
    icon: Zap,
    features: [
      'Fully automated paper generation',
      'Complete with citations and references',
      'Structured academic format',
      'Ready to download or edit afterwards'
    ],
    idealFor: [
      'Tight deadlines',
      'Getting started quickly',
      'First draft generation',
      'Exploring topics'
    ],
    badge: {
      text: 'Recommended',
      variant: 'default'
    }
  },
  {
    id: 'editor',
    title: 'Interactive Editor',
    description: 'Open the editor immediately to build your paper with AI assistance',
    icon: Edit3,
    features: [
      'Full control over content',
      'AI-powered writing commands',
      'Section-by-section development',
      'Real-time editing and refinement'
    ],
    idealFor: [
      'Iterative writing process',
      'Specific requirements',
      'Collaborative editing',
      'Detailed customization'
    ]
  }
]

export default function GenerationOptionsStep({ state, onUpdate }: GenerationOptionsStepProps) {
  const handleModeSelect = (mode: WizardState['generationMode']) => {
    onUpdate({ generationMode: mode })
  }

  return (
    <div className="space-y-4">
      {/* Compact Generation Mode Selection */}
      <div className="space-y-2">
        <Label className="text-sm font-medium">
          Choose Generation Mode
        </Label>
        <p className="text-xs text-muted-foreground">
          How would you like to create your research paper?
        </p>
        
        <div className="grid gap-3">
          {GENERATION_MODES.map((option) => {
            const Icon = option.icon
            const isSelected = state.generationMode === option.id
            
            return (
              <Card 
                key={option.id}
                className={`cursor-pointer transition-all hover:shadow-sm ${
                  isSelected 
                    ? 'ring-1 ring-primary bg-primary/5 border-primary' 
                    : 'hover:border-primary/50'
                }`}
                onClick={() => handleModeSelect(option.id)}
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
                        
                        {/* Ideal for */}
                        <div className="flex items-center gap-1 text-xs text-muted-foreground mb-2">
                          <Target className="h-3 w-3" />
                          <span>Ideal for: {option.idealFor[0]}</span>
                        </div>
                        
                        {/* Features - only show first 2 */}
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

      {/* Editor Mode Note */}
      {state.generationMode === 'editor' && (
        <div className="p-2 bg-blue-50 border border-blue-200 rounded text-xs">
          <div className="flex items-center gap-1 mb-1">
            <Edit3 className="h-3 w-3 text-blue-600" />
            <span className="font-medium text-blue-800">Interactive Editor Mode</span>
          </div>
          <div className="text-blue-700">
            You&apos;ll have full control with AI slash commands (/write, /cite, /rewrite) to build your paper section by section.
          </div>
        </div>
      )}

      {/* Summary */}
      {state.generationMode && (
        <div className="flex items-center gap-2 p-2 bg-green-50 border border-green-200 rounded text-xs">
          <Check className="h-3 w-3 text-green-600" />
          <div className="text-green-700">
            <span className="font-medium">Ready to generate!</span>
            <div className="mt-1 space-y-0.5">
              <div><strong>Topic:</strong> {state.topic}</div>
              <div><strong>Type:</strong> {state.paperType.replace(/([A-Z])/g, ' $1').toLowerCase()}</div>
              <div><strong>Mode:</strong> {state.generationMode === 'quick' ? 'Quick generation' : 'Interactive editor'}</div>
              {state.selectedPapers.length > 0 && (
                <div><strong>Papers:</strong> {state.selectedPapers.length} selected{state.useLibraryOnly ? ' (library-only)' : ''}</div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
} 