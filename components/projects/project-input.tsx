"use client"

import { useActionState, useRef, useState, useEffect, useMemo } from "react"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { ArrowRight, Loader2, BookOpen, FlaskConical } from "lucide-react"
import { createProjectAction } from "@/components/dashboard/actions"
import { cn } from "@/lib/utils"
import { PaperTypeSelect, type PaperTypeValue } from "./paper-type-select"
import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible"

const EMPIRICAL_PAPER_TYPES: PaperTypeValue[] = ["researchArticle", "mastersThesis", "phdDissertation"]

const SYNTHESIS_PAPER_TYPES: PaperTypeValue[] = ["literatureReview"]

const VARIABLE_PAPER_TYPES: PaperTypeValue[] = ["capstoneProject"]

interface FieldConfig {
  label: string
  placeholder: string
  helperText: string
}

const FIELD_CONFIG: Record<PaperTypeValue, FieldConfig> = {
  literatureReview: {
    label: "Review Topic",
    placeholder: "What topic will this literature review cover?",
    helperText: "Describe the subject area you want to synthesize research on.",
  },
  researchArticle: {
    label: "Research Question",
    placeholder: "What question does your research answer?",
    helperText: "State the specific question your study addresses.",
  },
  mastersThesis: {
    label: "Thesis Question",
    placeholder: "What is your central thesis question?",
    helperText: "The main research question your thesis investigates.",
  },
  phdDissertation: {
    label: "Dissertation Question",
    placeholder: "What is your central research question?",
    helperText: "The primary question driving your doctoral research.",
  },
  capstoneProject: {
    label: "Project Focus",
    placeholder: "What is your capstone project about?",
    helperText: "Describe your project topic or research focus.",
  },
}

export function ProjectInput() {
  const [state, formAction, isPending] = useActionState(createProjectAction, null)
  const inputRef = useRef<HTMLInputElement>(null)

  const [paperType, setPaperType] = useState<PaperTypeValue>("literatureReview")
  const [mainInput, setMainInput] = useState("")
  const [hasOriginalResearch, setHasOriginalResearch] = useState(false)
  const [keyFindings, setKeyFindings] = useState("")

  const fieldConfig = useMemo(() => FIELD_CONFIG[paperType], [paperType])

  const isEmpiricalType = EMPIRICAL_PAPER_TYPES.includes(paperType)
  const isSynthesisType = SYNTHESIS_PAPER_TYPES.includes(paperType)
  const isVariableType = VARIABLE_PAPER_TYPES.includes(paperType)

  const showOriginalResearchToggle = !isSynthesisType
  const showKeyFindings = showOriginalResearchToggle && hasOriginalResearch

  useEffect(() => {
    if (isEmpiricalType) {
      setHasOriginalResearch(true)
    } else if (isSynthesisType) {
      setHasOriginalResearch(false)
    } else if (isVariableType) {
      setHasOriginalResearch(false)
    }
  }, [paperType, isEmpiricalType, isSynthesisType, isVariableType])

  const isMainInputValid = mainInput.trim().length >= 10
  const isKeyFindingsValid = !showKeyFindings || keyFindings.trim().length >= 10
  const isFormValid = isMainInputValid && isKeyFindingsValid

  return (
    <div className="w-full max-w-2xl mx-auto">
      <form action={formAction} className="space-y-5">
        {/* Main Input */}
        <div className="space-y-2">
          <Label htmlFor="topic" className="text-sm font-medium">
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
                "h-12 pr-12 text-base rounded-lg border",
                "placeholder:text-muted-foreground/50",
                "focus-visible:ring-2 focus-visible:ring-primary/30 focus-visible:border-primary",
                "transition-all duration-200",
              )}
            />

            <Button
              type="submit"
              size="icon"
              disabled={isPending || !isFormValid}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 h-9 w-9"
            >
              {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
            </Button>
          </div>

          <p className="text-xs text-muted-foreground">{fieldConfig.helperText}</p>
        </div>

        <div className="space-y-3 pt-2">
          {/* Paper Type Select */}
          <div className="space-y-1.5">
            <Label htmlFor="paperType" className="text-xs font-medium text-muted-foreground">
              Paper Type
            </Label>
            <PaperTypeSelect value={paperType} onValueChange={setPaperType} disabled={isPending} />
          </div>

          {/* Original Research Toggle */}
          {showOriginalResearchToggle && (
            <div className="flex items-center gap-2.5 pt-1">
              <Checkbox
                id="hasOriginalResearch"
                checked={hasOriginalResearch}
                onCheckedChange={(checked) => setHasOriginalResearch(checked === true)}
                disabled={isPending}
              />
              <Label htmlFor="hasOriginalResearch" className="text-sm cursor-pointer select-none">
                I have original research/data
              </Label>
            </div>
          )}

          {/* Synthesis Type Indicator */}
          {isSynthesisType && (
            <div className="text-xs text-muted-foreground flex items-center gap-1.5">
              <BookOpen className="h-3.5 w-3.5" />
              <span>Synthesizing existing literature</span>
            </div>
          )}
        </div>

        <input type="hidden" name="paperType" value={paperType} />
        <input type="hidden" name="hasOriginalResearch" value={hasOriginalResearch ? "true" : "false"} />

        {/* Key Findings - Collapsible */}
        <Collapsible open={showKeyFindings}>
          <CollapsibleContent className="overflow-hidden data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:slide-out-to-top-2 data-[state=open]:slide-in-from-top-2">
            <div className="p-3 rounded-lg border bg-card space-y-2">
              <div className="flex items-center gap-2">
                <FlaskConical className="h-4 w-4 text-primary" />
                <span className="text-sm font-medium">Your Key Findings</span>
                <span className="text-xs text-destructive">*</span>
              </div>
              <Textarea
                id="keyFindings"
                name="keyFindings"
                placeholder="Summarize your main results (e.g., 'We found that X significantly improves Y...')"
                value={keyFindings}
                onChange={(e) => setKeyFindings(e.target.value)}
                disabled={isPending}
                required={showKeyFindings}
                className="min-h-[90px] resize-none text-sm"
              />
              <p className="text-xs text-muted-foreground">
                Brief summary of your primary results. This helps us find relevant papers.
              </p>
            </div>
          </CollapsibleContent>
        </Collapsible>

        {/* Error Messages */}
        {state && !state.success && state.error && (
          <p className="text-sm text-destructive text-center">{state.error}</p>
        )}

        {!isMainInputValid && mainInput.length > 0 && (
          <p className="text-sm text-amber-600 text-center">
            Please provide at least 10 characters for your {fieldConfig.label.toLowerCase()}.
          </p>
        )}
        {showKeyFindings && !isKeyFindingsValid && keyFindings.length > 0 && (
          <p className="text-sm text-amber-600 text-center">
            Please provide at least 10 characters for your key findings.
          </p>
        )}
      </form>

      <p className="mt-3 text-xs text-muted-foreground/70 text-center">Press Enter or click the arrow to start.</p>
    </div>
  )
}
