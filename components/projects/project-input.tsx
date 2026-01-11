'use client'

import { useActionState, useRef, useState, useEffect, useMemo } from 'react'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { ArrowRight, Loader2, BookOpen, FlaskConical } from 'lucide-react'
import { createProjectAction } from '@/components/dashboard/actions'
import { cn } from '@/lib/utils'
import { PaperTypeSelect, type PaperTypeValue } from './paper-type-select'
import {
  Collapsible,
  CollapsibleContent,
} from '@/components/ui/collapsible'

// Paper types that typically involve original research
const EMPIRICAL_PAPER_TYPES: PaperTypeValue[] = [
  'researchArticle',
  'mastersThesis',
  'phdDissertation',
]

// Paper types that are synthesis-based (no original data)
const SYNTHESIS_PAPER_TYPES: PaperTypeValue[] = [
  'literatureReview',
]

// Paper types where it varies
const VARIABLE_PAPER_TYPES: PaperTypeValue[] = [
  'capstoneProject',
]

// Adaptive field configuration based on paper type
interface FieldConfig {
  label: string
  placeholder: string
  helperText: string
}

const FIELD_CONFIG: Record<PaperTypeValue, FieldConfig> = {
  literatureReview: {
    label: 'Review Topic',
    placeholder: 'What topic will this literature review cover?',
    helperText: 'Describe the subject area you want to synthesize research on.',
  },
  researchArticle: {
    label: 'Research Question',
    placeholder: 'What question does your research answer?',
    helperText: 'State the specific question your study addresses.',
  },
  mastersThesis: {
    label: 'Thesis Question',
    placeholder: 'What is your central thesis question?',
    helperText: 'The main research question your thesis investigates.',
  },
  phdDissertation: {
    label: 'Dissertation Question',
    placeholder: 'What is your central research question?',
    helperText: 'The primary question driving your doctoral research.',
  },
  capstoneProject: {
    label: 'Project Focus',
    placeholder: 'What is your capstone project about?',
    helperText: 'Describe your project topic or research focus.',
  },
}

export function ProjectInput() {
  const [state, formAction, isPending] = useActionState(createProjectAction, null)
  const inputRef = useRef<HTMLInputElement>(null)
  
  // Form state
  const [paperType, setPaperType] = useState<PaperTypeValue>('literatureReview')
  const [mainInput, setMainInput] = useState('') // This is the topic/research question
  const [hasOriginalResearch, setHasOriginalResearch] = useState(false)
  const [keyFindings, setKeyFindings] = useState('')

  // Get adaptive field config
  const fieldConfig = useMemo(() => FIELD_CONFIG[paperType], [paperType])

  // Determine UI mode based on paper type
  const isEmpiricalType = EMPIRICAL_PAPER_TYPES.includes(paperType)
  const isSynthesisType = SYNTHESIS_PAPER_TYPES.includes(paperType)
  const isVariableType = VARIABLE_PAPER_TYPES.includes(paperType)

  // Should we show the original research toggle?
  // - Hide for literature reviews (never has original data)
  // - Show for empirical types and variable types
  const showOriginalResearchToggle = !isSynthesisType

  // Should we show key findings field?
  // - For empirical types: when toggle is checked (default: checked)
  // - For variable types: when toggle is checked (default: unchecked)
  // - For synthesis types: never
  const showKeyFindings = showOriginalResearchToggle && hasOriginalResearch

  // Auto-set hasOriginalResearch based on paper type
  useEffect(() => {
    if (isEmpiricalType) {
      // Default to checked for empirical paper types
      setHasOriginalResearch(true)
    } else if (isSynthesisType) {
      // Always false for synthesis types
      setHasOriginalResearch(false)
    } else if (isVariableType) {
      // Default to unchecked for variable types (user decides)
      setHasOriginalResearch(false)
    }
  }, [paperType, isEmpiricalType, isSynthesisType, isVariableType])

  // Validation logic
  // Main input always required (min 10 chars)
  // Key findings required only when showing original research (min 10 chars)
  const isMainInputValid = mainInput.trim().length >= 10
  const isKeyFindingsValid = !showKeyFindings || keyFindings.trim().length >= 10
  const isFormValid = isMainInputValid && isKeyFindingsValid

  return (
    <div className="w-full max-w-2xl mx-auto">
      <form action={formAction}>
        {/* Main Input - adapts label based on paper type */}
        <div className="space-y-1.5">
          <Label 
            htmlFor="topic" 
            className="text-sm font-medium flex items-center gap-1.5"
          >
            {isEmpiricalType && hasOriginalResearch ? (
              <FlaskConical className="h-3.5 w-3.5 text-amber-600" />
            ) : isSynthesisType ? (
              <BookOpen className="h-3.5 w-3.5 text-blue-600" />
            ) : null}
            {fieldConfig.label}
          </Label>
          
          <div className="relative">
            <Input
              ref={inputRef}
              id="topic"
              name="topic"
              placeholder={fieldConfig.placeholder}
              value={mainInput}
              onChange={(e) => setMainInput(e.target.value)}
              disabled={isPending}
              required
              minLength={10}
              className={cn(
                "h-14 pr-14 text-base rounded-xl border-2",
                "placeholder:text-muted-foreground/60",
                "focus-visible:ring-2 focus-visible:ring-primary/20 focus-visible:border-primary",
                "transition-all duration-200",
                isEmpiricalType && hasOriginalResearch && "border-amber-200 focus-visible:border-amber-400",
                isSynthesisType && "border-blue-200 focus-visible:border-blue-400"
              )}
            />
            
            <Button 
              type="submit"
              size="icon" 
              disabled={isPending || !isFormValid}
              className={cn(
                "absolute right-2 top-1/2 -translate-y-1/2",
                "h-10 w-10 rounded-lg",
                "transition-all duration-200"
              )}
            >
              {isPending ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <ArrowRight className="h-5 w-5" />
              )}
            </Button>
          </div>
          
          <p className="text-xs text-muted-foreground">
            {fieldConfig.helperText}
          </p>
        </div>

        {/* Action Bar */}
        <div className="mt-4 flex flex-wrap items-center gap-4">
          {/* Paper Type Select */}
          <div className="flex items-center gap-2">
            <Label htmlFor="paperType" className="text-sm text-muted-foreground whitespace-nowrap">
              Paper Type:
            </Label>
            <PaperTypeSelect
              value={paperType}
              onValueChange={setPaperType}
              disabled={isPending}
            />
          </div>

          {/* Original Research Checkbox - only show for non-synthesis types */}
          {showOriginalResearchToggle && (
            <div className="flex items-center gap-2">
              <Checkbox
                id="hasOriginalResearch"
                checked={hasOriginalResearch}
                onCheckedChange={(checked) => setHasOriginalResearch(checked === true)}
                disabled={isPending}
              />
              <Label 
                htmlFor="hasOriginalResearch" 
                className="text-sm cursor-pointer select-none flex items-center gap-1.5"
              >
                <FlaskConical className="h-3.5 w-3.5 text-muted-foreground" />
                I have original research/data
              </Label>
            </div>
          )}

          {/* Indicator for synthesis types */}
          {isSynthesisType && (
            <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <BookOpen className="h-3.5 w-3.5" />
              <span>Synthesizing existing literature</span>
            </div>
          )}
        </div>

        {/* Hidden form fields for server action */}
        <input type="hidden" name="paperType" value={paperType} />
        <input type="hidden" name="hasOriginalResearch" value={hasOriginalResearch ? 'true' : 'false'} />

        {/* Key Findings - for empirical/variable types when original research is toggled */}
        <Collapsible open={showKeyFindings}>
          <CollapsibleContent className="overflow-hidden data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:slide-out-to-top-2 data-[state=open]:slide-in-from-top-2">
            <div className="mt-4 p-4 rounded-lg border bg-amber-50/50 border-amber-200">
              <div className="flex items-center gap-2 mb-3">
                <FlaskConical className="h-4 w-4 text-amber-600" />
                <span className="text-sm font-medium text-amber-900">Your Key Findings</span>
                <span className="text-xs text-amber-600">*</span>
              </div>
              <div className="space-y-2">
                <Textarea
                  id="keyFindings"
                  name="keyFindings"
                  placeholder="Summarize your main results (e.g., 'We found that X significantly improves Y by 23% compared to the control group. Statistical analysis showed p < 0.05...')"
                  value={keyFindings}
                  onChange={(e) => setKeyFindings(e.target.value)}
                  disabled={isPending}
                  required={showKeyFindings}
                  className="min-h-[100px] resize-none bg-white"
                />
                <p className="text-xs text-amber-700/70">
                  Brief summary of your primary results and conclusions. This helps us find relevant papers to contextualize your findings.
                </p>
              </div>
            </div>
          </CollapsibleContent>
        </Collapsible>

        {/* Error message */}
        {state && !state.success && state.error && (
          <p className="mt-3 text-sm text-destructive text-center">
            {state.error}
          </p>
        )}

        {/* Validation messages */}
        {!isMainInputValid && mainInput.length > 0 && (
          <p className="mt-3 text-sm text-amber-600 text-center">
            Please provide at least 10 characters for your {fieldConfig.label.toLowerCase()}.
          </p>
        )}
        {showKeyFindings && !isKeyFindingsValid && keyFindings.length > 0 && (
          <p className="mt-3 text-sm text-amber-600 text-center">
            Please provide at least 10 characters for your key findings.
          </p>
        )}
      </form>

      {/* Subtle helper text */}
      <p className="mt-3 text-xs text-muted-foreground/70 text-center">
        Be specific for better results. Press Enter or click the arrow to start.
      </p>
    </div>
  )
}
