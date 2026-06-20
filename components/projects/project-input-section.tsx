'use client'

import { useActionState, useState, useEffect, useMemo, useCallback, useTransition } from 'react'
import dynamic from 'next/dynamic'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { ArrowRight, Loader2 } from 'lucide-react'
import { createProjectAction } from '@/components/dashboard/actions'
import { cn } from '@/lib/utils'
import { PaperTypeSelect, type PaperTypeValue } from './paper-type-select'
import { useSubscription } from '@/lib/hooks/use-subscription'
import { useLimitModal } from '@/components/billing/limit-modal'
import { GenerationModeSelect, type GenerationMode } from './generation-mode-select'
import { AddSourceMenu } from './add-source-menu'
import { AdvancedOptionsPopover } from './advanced-options-popover'
import { QuickActions } from './quick-actions'
import { PdfChipList } from './pdf-chip'
import { PaperChipList } from './paper-chip'
import { usePdfUpload } from './hooks/usePdfUpload'
import type { UploadedPdf, SelectedPaper } from './types'

// Lazy load the library drawer
const LibraryDrawer = dynamic(() => import('@/components/ui/library-drawer'), {
  ssr: false,
})

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

/**
 * Combined ProjectInput + QuickActions component that shares PDF upload state.
 * This is the main component to use on the projects page.
 */
export function ProjectInputSection() {
  const { subscription } = useSubscription()
  const { showLimitModal } = useLimitModal()
  const [state, formAction, isPending] = useActionState(createProjectAction, null)
  const [isNavigating] = useTransition()
  
  // Show paywall modal when billing-related error occurs
  useEffect(() => {
    if (state && !state.success && state.error) {
      // Check if error is billing-related (quota/limit errors)
      const isBillingError = state.error.includes('limit') || 
                            state.error.includes('quota') || 
                            state.error.includes('upgrade') ||
                            state.error.includes('paper generation')
      if (isBillingError) {
        showLimitModal('papers')
      }
    }
  }, [state, showLimitModal])

  // Combined loading state for best UX
  const isLoading = isPending || isNavigating

  // Form state
  const [paperType, setPaperType] = useState<PaperTypeValue>('literatureReview')
  const [generationMode, setGenerationMode] = useState<GenerationMode>('generate')
  const [topic, setTopic] = useState('')
  const [hasOriginalResearch, setHasOriginalResearch] = useState(false)
  const [keyFindings, setKeyFindings] = useState('')
  const [useLibraryOnly, setUseLibraryOnly] = useState(false)
  
  // PDF upload state - shared between ProjectInput area and QuickActions
  const [uploadedPdfs, setUploadedPdfs] = useState<UploadedPdf[]>([])
  
  // Selected papers from library
  const [selectedPapers, setSelectedPapers] = useState<SelectedPaper[]>([])
  const [isLibraryOpen, setIsLibraryOpen] = useState(false)
  
  // PDF upload hook
  const { uploadFiles } = usePdfUpload({
    onUploadStart: (pdf) => {
      setUploadedPdfs((prev) => [...prev, pdf])
    },
    onUploadProgress: (id, updates) => {
      setUploadedPdfs((prev) =>
        prev.map((pdf) => (pdf.id === id ? { ...pdf, ...updates } : pdf))
      )
    },
    onUploadComplete: (_id, _result) => {
      // Paper uploaded successfully - no auto-fill of topic from filename
      // User should enter their own topic/prompt
    },
    onUploadError: (id, error) => {
      console.error(`PDF upload error for ${id}:`, error)
    },
  })
  
  // Handle PDF file selection from QuickActions or AddSourceMenu
  const handlePdfUpload = useCallback((files: FileList) => {
    uploadFiles(files)
  }, [uploadFiles])
  
  // Handle removing an uploaded PDF
  const handleRemovePdf = useCallback((id: string) => {
    setUploadedPdfs((prev) => prev.filter((pdf) => pdf.id !== id))
  }, [])
  
  // Handle selecting a paper from library
  const handleSelectPaper = useCallback((paper: SelectedPaper) => {
    setSelectedPapers((prev) => {
      // Don't add duplicates
      if (prev.some(p => p.id === paper.id)) return prev
      return [...prev, paper]
    })
  }, [])
  
  // Handle removing a selected paper
  const handleRemovePaper = useCallback((id: string) => {
    setSelectedPapers((prev) => prev.filter((p) => p.id !== id))
  }, [])
  
  // Get paper IDs for successfully uploaded PDFs
  const uploadedPaperIds = useMemo(
    () => uploadedPdfs.filter((pdf) => pdf.status === 'ready' && pdf.paperId).map((pdf) => pdf.paperId!),
    [uploadedPdfs]
  )
  
  // Get paper IDs for selected papers from library
  const selectedPaperIds = useMemo(
    () => selectedPapers.map((p) => p.id),
    [selectedPapers]
  )
  
  // Check if any uploads are in progress
  const hasUploadsInProgress = uploadedPdfs.some(
    (pdf) => pdf.status === 'uploading' || pdf.status === 'processing'
  )

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
  // Form is valid if topic is valid, key findings are valid, and no uploads are in progress
  const isFormValid = isTopicValid && isKeyFindingsValid && !hasUploadsInProgress

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
    <div className="space-y-5 pt-2">
      {/* Main Input Form */}
      <div className="w-full max-w-3xl mx-auto">
        <form action={formAction} className="space-y-4">
          {/* Input Container */}
          <div
            className={cn(
              'rounded-2xl border border-border/70 bg-background transition-all duration-300',
              'hover:border-border',
              'focus-within:border-accent/50 focus-within:shadow-lg focus-within:shadow-accent/5',
            )}
          >
            {/* Chips area */}
            <PdfChipList
              pdfs={uploadedPdfs}
              onRemove={handleRemovePdf}
              disabled={isLoading}
            />
            <PaperChipList
              papers={selectedPapers}
              onRemove={handleRemovePaper}
              disabled={isLoading}
            />
            
            {/* Textarea — larger, more breathing room */}
            <Textarea
              data-tour="topic-input"
              name="topic"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={placeholder}
              disabled={isLoading}
              required
              minLength={10}
              rows={4}
              className={cn(
                'border-0 bg-transparent resize-none',
                'min-h-[140px] text-[15px] leading-relaxed',
                'px-6 pt-5 pb-3',
                'placeholder:text-muted-foreground/40',
                'focus-visible:ring-0 focus-visible:ring-offset-0',
              )}
            />

            {/* Controls Row */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 px-4 pb-4 pt-1">
              {/* Left: Source + Options + Selects */}
              <div className="flex items-center gap-1.5 flex-wrap">
                <span data-tour="add-sources">
                <AddSourceMenu 
                  disabled={isLoading} 
                  onPdfUpload={handlePdfUpload} 
                  onOpenLibrary={() => setIsLibraryOpen(true)}
                />
                </span>
                <AdvancedOptionsPopover
                  hasOriginalResearch={hasOriginalResearch}
                  onHasOriginalResearchChange={setHasOriginalResearch}
                  keyFindings={keyFindings}
                  onKeyFindingsChange={setKeyFindings}
                  showKeyFindings={showKeyFindings}
                  showOriginalResearchToggle={showOriginalResearchToggle}
                  useLibraryOnly={useLibraryOnly}
                  onUseLibraryOnlyChange={setUseLibraryOnly}
                  disabled={isLoading}
                />
                <div className="hidden sm:block w-px h-4 bg-border/30 mx-0.5" />
                <span data-tour="paper-type">
                <PaperTypeSelect
                  value={paperType}
                  onValueChange={setPaperType}
                  disabled={isLoading}
                  userTier={subscription?.tier}
                />
                </span>
                <span data-tour="generation-mode">
                <GenerationModeSelect
                  value={generationMode}
                  onValueChange={setGenerationMode}
                  disabled={isLoading}
                />
                </span>
              </div>

              {/* Right: Submit */}
              <Button
                data-tour="start-button"
                type="submit"
                disabled={isLoading || !isFormValid}
                className={cn(
                  'h-10 rounded-full transition-all w-full sm:w-auto sm:px-5 gap-2 text-sm font-medium',
                  isFormValid && !isLoading
                    ? 'bg-brand text-brand-foreground hover:bg-brand/90 shadow-sm'
                    : '',
                )}
              >
                {isLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    <span>Start</span>
                    <ArrowRight className="h-3.5 w-3.5" />
                  </>
                )}
                <span className="sr-only">Start research</span>
              </Button>
            </div>
          </div>

          {/* Hidden fields */}
          <input type="hidden" name="paperType" value={paperType} />
          <input type="hidden" name="generationMode" value={generationMode} />
          <input type="hidden" name="hasOriginalResearch" value={hasOriginalResearch ? 'true' : 'false'} />
          <input type="hidden" name="useLibraryOnly" value={useLibraryOnly ? 'true' : 'false'} />
          {showKeyFindings && <input type="hidden" name="keyFindings" value={keyFindings} />}
          {uploadedPaperIds.map((paperId) => (
            <input key={paperId} type="hidden" name="uploadedPaperIds" value={paperId} />
          ))}
          {selectedPaperIds.map((paperId) => (
            <input key={`selected-${paperId}`} type="hidden" name="selectedPaperIds" value={paperId} />
          ))}

          {/* Status area */}
          <div className="text-center space-y-1.5">
            {generationMode === 'write' ? (
              <p className="text-[11px] text-muted-foreground/50">
                We&apos;ll find relevant papers while you write
              </p>
            ) : isSynthesisType ? (
              <p className="text-[11px] text-muted-foreground/50">
                Synthesizing existing literature
              </p>
            ) : null}

            <p className="text-[11px] text-muted-foreground/35">
              <kbd className="px-1 py-0.5 text-[9px] font-mono bg-foreground/5 rounded border border-border/30">
                {typeof navigator !== 'undefined' && navigator.platform?.includes('Mac') ? '⌘' : 'Ctrl'}
              </kbd>
              {' + '}
              <kbd className="px-1 py-0.5 text-[9px] font-mono bg-foreground/5 rounded border border-border/30">
                Enter
              </kbd>
              {' '}to {generationMode === 'generate' ? 'generate' : 'start writing'}
            </p>

            {!isTopicValid && topic.length > 0 && topic.length < 10 && (
              <p className="text-xs text-amber-600/80">
                {10 - topic.length} more characters needed
              </p>
            )}

            {showKeyFindings && !isKeyFindingsValid && keyFindings.length > 0 && (
              <p className="text-xs text-amber-600/80">
                Key findings need {10 - keyFindings.length} more characters
              </p>
            )}

            {state && !state.success && state.error && (
              // Don't show billing errors as text - paywall modal handles those
              !(state.error.includes('limit') || state.error.includes('quota') || state.error.includes('upgrade') || state.error.includes('paper generation')) && (
                <p className="text-sm text-destructive">{state.error}</p>
              )
            )}
          </div>
        </form>
      </div>

      {/* Quick Actions */}
      <QuickActions 
        onPdfUpload={handlePdfUpload} 
        disabled={isLoading || hasUploadsInProgress} 
        onOpenLibrary={() => setIsLibraryOpen(true)}
      />
      
      {/* Library Drawer */}
      {isLibraryOpen ? (
        <LibraryDrawer
          isOpen={isLibraryOpen}
          onClose={() => setIsLibraryOpen(false)}
          onSelectForProject={handleSelectPaper}
          selectedPaperIds={selectedPaperIds}
        />
      ) : null}
    </div>
  )
}
