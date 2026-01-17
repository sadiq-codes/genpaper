'use client'

import { useActionState, useState, useEffect, useMemo, useCallback, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { ArrowRight, Loader2, BookOpen } from 'lucide-react'
import { createProjectAction } from '@/components/dashboard/actions'
import { cn } from '@/lib/utils'
import { PaperTypeSelect, type PaperTypeValue } from './paper-type-select'
import { GenerationModeSelect, type GenerationMode } from './generation-mode-select'
import { AddSourceMenu } from './add-source-menu'
import { AdvancedOptionsPopover } from './advanced-options-popover'

// Paper type categories for determining behavior
const EMPIRICAL_PAPER_TYPES: PaperTypeValue[] = ['researchArticle', 'mastersThesis', 'phdDissertation']
const SYNTHESIS_PAPER_TYPES: PaperTypeValue[] = ['literatureReview']
const VARIABLE_PAPER_TYPES: PaperTypeValue[] = ['capstoneProject']

// Dynamic placeholder based on paper type
const PLACEHOLDER_CONFIG: Record<PaperTypeValue, string> = {
  literatureReview: 'What topic do you want to explore? e.g., "The impact of AI on healthcare diagnostics"',
  researchArticle: 'What is your research question? e.g., "How does sleep quality affect cognitive performance?"',
  mastersThesis: 'What is your thesis investigating? e.g., "The relationship between social media and adolescent anxiety"',
  phdDissertation: 'What is your dissertation exploring? e.g., "Novel approaches to quantum error correction"',
  capstoneProject: 'What is your project about? e.g., "Building a sustainable urban garden monitoring system"',
}

export function ProjectInput() {
  const router = useRouter()
  const [state, formAction, isPending] = useActionState(createProjectAction, null)
  const [isNavigating, startTransition] = useTransition()

  // Combined loading state for best UX
  const isLoading = isPending || isNavigating

  // Prefetch editor route on mount for faster navigation
  useEffect(() => {
    // Prefetch the editor base route
    router.prefetch('/editor/[projectId]')
  }, [router])

  // Form state
  const [paperType, setPaperType] = useState<PaperTypeValue>('literatureReview')
  const [generationMode, setGenerationMode] = useState<GenerationMode>('generate')
  const [topic, setTopic] = useState('')
  const [hasOriginalResearch, setHasOriginalResearch] = useState(false)
  const [keyFindings, setKeyFindings] = useState('')

  // Derived state
  const isEmpiricalType = EMPIRICAL_PAPER_TYPES.includes(paperType)
  const isSynthesisType = SYNTHESIS_PAPER_TYPES.includes(paperType)
  const isVariableType = VARIABLE_PAPER_TYPES.includes(paperType)

  const showOriginalResearchToggle = !isSynthesisType
  const showKeyFindings = showOriginalResearchToggle && hasOriginalResearch

  const placeholder = useMemo(() => PLACEHOLDER_CONFIG[paperType], [paperType])

  // Auto-set original research based on paper type
  useEffect(() => {
    if (isEmpiricalType) {
      setHasOriginalResearch(true)
    } else if (isSynthesisType) {
      setHasOriginalResearch(false)
    } else if (isVariableType) {
      setHasOriginalResearch(false)
    }
  }, [paperType, isEmpiricalType, isSynthesisType, isVariableType])

  // Validation
  const isTopicValid = topic.trim().length >= 10
  const isKeyFindingsValid = !showKeyFindings || keyFindings.trim().length >= 10
  const isFormValid = isTopicValid && isKeyFindingsValid

  // Handle keyboard submit (Cmd/Ctrl + Enter)
  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && isFormValid && !isLoading) {
      e.preventDefault()
      const form = e.currentTarget.closest('form')
      if (form) {
        form.requestSubmit()
      }
    }
  }, [isFormValid, isLoading])

  return (
    <div className="w-full max-w-2xl mx-auto">
      <form action={formAction} className="space-y-3">
        {/* Unified Input Container */}
        <div
          className={cn(
            'rounded-xl border-2 bg-card/50 transition-all duration-200',
            'border-border/50 hover:border-border',
            'focus-within:border-primary/50 focus-within:ring-4 focus-within:ring-primary/10',
            'shadow-sm hover:shadow-md focus-within:shadow-md',
          )}
        >
          {/* Textarea */}
          <Textarea
            name="topic"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            disabled={isLoading}
            required
            minLength={10}
            rows={3}
            className={cn(
              'border-0 bg-transparent resize-none',
              'min-h-[100px] text-base leading-relaxed',
              'p-4 pb-2',
              'placeholder:text-muted-foreground/60',
              'focus-visible:ring-0 focus-visible:ring-offset-0',
            )}
          />

          {/* Controls Row */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 px-3 pb-3 pt-1">
            {/* Left Controls */}
            <div className="flex items-center gap-0.5 flex-wrap">
              <AddSourceMenu disabled={isLoading} />
              <AdvancedOptionsPopover
                hasOriginalResearch={hasOriginalResearch}
                onHasOriginalResearchChange={setHasOriginalResearch}
                keyFindings={keyFindings}
                onKeyFindingsChange={setKeyFindings}
                showKeyFindings={showKeyFindings}
                showOriginalResearchToggle={showOriginalResearchToggle}
                disabled={isLoading}
              />
              <div className="hidden sm:block w-px h-5 bg-border/50 mx-1" />
              <PaperTypeSelect
                value={paperType}
                onValueChange={setPaperType}
                disabled={isLoading}
                variant="inline"
              />
              <GenerationModeSelect
                value={generationMode}
                onValueChange={setGenerationMode}
                disabled={isLoading}
              />
            </div>

            {/* Right Control - Submit */}
            <Button
              type="submit"
              disabled={isLoading || !isFormValid}
              className={cn(
                'h-9 sm:h-8 sm:w-8 rounded-lg transition-all w-full sm:w-auto',
                isFormValid && !isLoading && 'bg-primary hover:bg-primary/90',
              )}
            >
              {isLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  <span className="sm:hidden mr-2">Start</span>
                  <ArrowRight className="h-4 w-4" />
                </>
              )}
              <span className="sr-only">Start research</span>
            </Button>
          </div>
        </div>

        {/* Hidden fields for form submission */}
        <input type="hidden" name="paperType" value={paperType} />
        <input type="hidden" name="generationMode" value={generationMode} />
        <input type="hidden" name="hasOriginalResearch" value={hasOriginalResearch ? 'true' : 'false'} />
        {showKeyFindings && <input type="hidden" name="keyFindings" value={keyFindings} />}

        {/* Helper Text & Status */}
        <div className="text-center space-y-2">
          {/* Mode indicator */}
          {generationMode === 'write' ? (
            <div className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <BookOpen className="h-3.5 w-3.5" />
              <span>We&apos;ll find relevant papers while you write</span>
            </div>
          ) : isSynthesisType ? (
            <div className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <BookOpen className="h-3.5 w-3.5" />
              <span>Synthesizing existing literature</span>
            </div>
          ) : null}

          {/* Keyboard hint */}
          <p className="text-xs text-muted-foreground/70">
            Press{' '}
            <kbd className="px-1.5 py-0.5 text-[10px] font-mono bg-muted rounded border">
              {typeof navigator !== 'undefined' && navigator.platform?.includes('Mac') ? '⌘' : 'Ctrl'}
            </kbd>
            {' + '}
            <kbd className="px-1.5 py-0.5 text-[10px] font-mono bg-muted rounded border">
              Enter
            </kbd>
            {' '}to {generationMode === 'generate' ? 'generate' : 'start writing'}
          </p>

          {/* Validation feedback */}
          {!isTopicValid && topic.length > 0 && topic.length < 10 && (
            <p className="text-xs text-amber-600">
              Please provide at least 10 characters ({10 - topic.length} more needed)
            </p>
          )}

          {/* Key findings validation */}
          {showKeyFindings && !isKeyFindingsValid && keyFindings.length > 0 && (
            <p className="text-xs text-amber-600">
              Please provide more detail in your key findings ({10 - keyFindings.length} more characters needed)
            </p>
          )}

          {/* Error from server */}
          {state && !state.success && state.error && (
            <p className="text-sm text-destructive">{state.error}</p>
          )}
        </div>
      </form>
    </div>
  )
}
