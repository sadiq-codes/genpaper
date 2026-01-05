'use client'

import { useState } from 'react'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  ChevronDown,
  ChevronRight,
  FileText,
  Lightbulb,
  AlertTriangle,
  Sparkles,
  Plus,
  Loader2,
  RefreshCw,
  CheckCircle,
  Beaker,
  BookOpen,
  HelpCircle,
  ExternalLink,
  Trash2,
  Quote,
} from 'lucide-react'
import type { 
  ProjectPaper, 
  ExtractedClaim, 
  ResearchGap, 
  AnalysisOutput,
  AnalysisState,
  ClaimType,
  GapType,
} from '../types'
import { cn } from '@/lib/utils'

interface ResearchTabProps {
  papers: ProjectPaper[]
  analysisState: AnalysisState
  onInsertClaim: (claim: ExtractedClaim) => void
  onInsertGap: (gap: ResearchGap) => void
  onInsertCitation: (paper: ProjectPaper) => void
  onRunAnalysis: () => void
  onOpenLibrary: () => void
  onRemovePaper: (paperId: string, claimCount: number) => void
}

// Claim type icons and colors
const claimTypeConfig: Record<ClaimType, { icon: typeof Lightbulb; color: string; label: string }> = {
  finding: { icon: Lightbulb, color: 'text-green-600 bg-green-50 border-green-200', label: 'Finding' },
  method: { icon: Beaker, color: 'text-blue-600 bg-blue-50 border-blue-200', label: 'Method' },
  limitation: { icon: AlertTriangle, color: 'text-orange-600 bg-orange-50 border-orange-200', label: 'Limitation' },
  future_work: { icon: Sparkles, color: 'text-purple-600 bg-purple-50 border-purple-200', label: 'Future Work' },
  background: { icon: BookOpen, color: 'text-gray-600 bg-gray-50 border-gray-200', label: 'Background' },
}

// Gap type icons and colors
const gapTypeConfig: Record<GapType, { icon: typeof AlertTriangle; color: string; label: string }> = {
  unstudied: { icon: HelpCircle, color: 'text-yellow-600 bg-yellow-50 border-yellow-200', label: 'Unstudied' },
  contradiction: { icon: AlertTriangle, color: 'text-red-600 bg-red-50 border-red-200', label: 'Contradiction' },
  limitation: { icon: Beaker, color: 'text-orange-600 bg-orange-50 border-orange-200', label: 'Limitation' },
}

// Section Header Component
function SectionHeader({ 
  title, 
  count, 
  isOpen, 
  icon: Icon,
  isLoading,
  action,
}: { 
  title: string
  count: number
  isOpen: boolean
  icon: typeof FileText
  isLoading?: boolean
  action?: React.ReactNode
}) {
  return (
    <div className="flex items-center justify-between w-full py-2 px-3 hover:bg-muted/50 rounded-lg transition-colors">
      <div className="flex items-center gap-2">
        {isOpen ? (
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        )}
        <Icon className="h-4 w-4" />
        <span className="font-medium text-sm">{title}</span>
      </div>
      <div className="flex items-center gap-2">
        {isLoading && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
        {action}
        <Badge variant="secondary" className="text-xs">
          {count}
        </Badge>
      </div>
    </div>
  )
}

// Paper Card with Popover
function PaperCardWithPopover({ 
  paper,
  claimCount,
  onInsertCitation,
  onRemove,
}: { 
  paper: ProjectPaper
  claimCount: number
  onInsertCitation: () => void
  onRemove: () => void
}) {
  const [open, setOpen] = useState(false)
  const [showAbstract, setShowAbstract] = useState(false)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button className="w-full text-left p-2 rounded-lg border bg-card hover:bg-muted/30 transition-colors group">
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              <h4 className="text-xs font-medium line-clamp-2 leading-tight">
                {paper.title}
              </h4>
              <p className="text-[10px] text-muted-foreground mt-0.5 line-clamp-1">
                {paper.authors?.slice(0, 2).join(', ')}
                {(paper.authors?.length || 0) > 2 && ' et al.'}
                {paper.year && ` (${paper.year})`}
              </p>
              {claimCount > 0 && (
                <Badge variant="secondary" className="text-[9px] mt-1 px-1.5 py-0">
                  {claimCount} claims
                </Badge>
              )}
            </div>
          </div>
        </button>
      </PopoverTrigger>
      <PopoverContent 
        className="w-80 p-0" 
        side="right" 
        align="start"
        sideOffset={8}
      >
        <div className="p-3 space-y-3">
          {/* Title */}
          <h3 className="font-semibold text-sm leading-tight">
            {paper.title}
          </h3>

          {/* Authors */}
          {paper.authors && paper.authors.length > 0 && (
            <p className="text-xs text-muted-foreground">
              {paper.authors.join(', ')}
            </p>
          )}

          {/* Metadata */}
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            {paper.year && <span>{paper.year}</span>}
            {paper.journal && (
              <span className="truncate max-w-[150px]">{paper.journal}</span>
            )}
          </div>

          {/* Abstract */}
          {paper.abstract && (
            <div className="space-y-1">
              <button
                onClick={() => setShowAbstract(!showAbstract)}
                className="text-xs font-medium text-primary hover:underline"
              >
                {showAbstract ? 'Hide abstract' : 'Show abstract'}
              </button>
              {showAbstract && (
                <p className="text-xs text-muted-foreground leading-relaxed max-h-32 overflow-y-auto">
                  {paper.abstract}
                </p>
              )}
            </div>
          )}

          {/* Claim count */}
          {claimCount > 0 && (
            <p className="text-xs text-muted-foreground">
              {claimCount} claims extracted from this paper
            </p>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center justify-between gap-2 p-3 border-t bg-muted/30">
          <Button
            size="sm"
            variant="default"
            className="flex-1 h-8 text-xs"
            onClick={() => {
              onInsertCitation()
              setOpen(false)
            }}
          >
            <Quote className="h-3 w-3 mr-1" />
            Insert Citation
          </Button>
          
          {paper.doi && (
            <Button
              size="sm"
              variant="outline"
              className="h-8 px-2"
              onClick={() => window.open(`https://doi.org/${paper.doi}`, '_blank')}
            >
              <ExternalLink className="h-3 w-3" />
            </Button>
          )}
          
          <Button
            size="sm"
            variant="outline"
            className="h-8 px-2 text-destructive hover:text-destructive hover:bg-destructive/10"
            onClick={() => {
              onRemove()
              setOpen(false)
            }}
          >
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}

// Claim Card Component
function ClaimCard({ 
  claim, 
  onInsert,
}: { 
  claim: ExtractedClaim
  onInsert: () => void
}) {
  const config = claimTypeConfig[claim.claim_type] || claimTypeConfig.finding
  const Icon = config.icon

  return (
    <button
      onClick={onInsert}
      className="w-full text-left p-2 rounded-lg border bg-card hover:bg-muted/30 transition-colors group"
    >
      <div className="flex items-start gap-2">
        <div className={cn(
          "p-1 rounded border shrink-0 mt-0.5",
          config.color
        )}>
          <Icon className="h-3 w-3" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs leading-relaxed line-clamp-3">
            {claim.claim_text}
          </p>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-[10px] text-muted-foreground line-clamp-1">
              {claim.paper_title ? `${claim.paper_authors?.[0]?.split(' ').pop() || 'Unknown'}, ${claim.paper_year}` : 'Unknown source'}
            </span>
            <Badge variant="outline" className="text-[9px] px-1 py-0 h-4">
              {Math.round(claim.confidence * 100)}%
            </Badge>
          </div>
        </div>
        <Plus className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity shrink-0 mt-1 text-muted-foreground" />
      </div>
    </button>
  )
}

// Gap Card Component
function GapCard({ 
  gap, 
  onInsert,
}: { 
  gap: ResearchGap
  onInsert: () => void
}) {
  const config = gapTypeConfig[gap.gap_type] || gapTypeConfig.unstudied
  const Icon = config.icon

  return (
    <button
      onClick={onInsert}
      className="w-full text-left p-2 rounded-lg border bg-card hover:bg-muted/30 transition-colors group"
    >
      <div className="flex items-start gap-2">
        <div className={cn(
          "p-1 rounded border shrink-0 mt-0.5",
          config.color
        )}>
          <Icon className="h-3 w-3" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1 mb-1">
            <Badge variant="secondary" className="text-[9px] px-1.5 py-0 h-4">
              {config.label}
            </Badge>
            <Badge variant="outline" className="text-[9px] px-1 py-0 h-4">
              {Math.round(gap.confidence * 100)}%
            </Badge>
          </div>
          <p className="text-xs leading-relaxed line-clamp-3">
            {gap.description}
          </p>
          {gap.research_opportunity && (
            <p className="text-[10px] text-muted-foreground mt-1 line-clamp-2 italic">
              Opportunity: {gap.research_opportunity}
            </p>
          )}
        </div>
        <Plus className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity shrink-0 mt-1 text-muted-foreground" />
      </div>
    </button>
  )
}

// Insights Section Component
function InsightsSection({ synthesis }: { synthesis: AnalysisOutput | null }) {
  if (!synthesis?.structured_output) {
    return (
      <div className="text-center py-4 text-xs text-muted-foreground">
        Run analysis to generate insights
      </div>
    )
  }

  const { themes, key_insights, agreements } = synthesis.structured_output

  return (
    <div className="space-y-3">
      {/* Key Insights */}
      {key_insights && key_insights.length > 0 && (
        <div className="space-y-1.5">
          <h5 className="text-[10px] font-semibold uppercase text-muted-foreground tracking-wider">
            Key Insights
          </h5>
          {key_insights.slice(0, 5).map((insight, idx) => (
            <div 
              key={idx}
              className="text-xs p-2 rounded-lg bg-primary/5 border border-primary/10"
            >
              {insight}
            </div>
          ))}
        </div>
      )}

      {/* Themes */}
      {themes && themes.length > 0 && (
        <div className="space-y-1.5">
          <h5 className="text-[10px] font-semibold uppercase text-muted-foreground tracking-wider">
            Research Themes
          </h5>
          {themes.slice(0, 4).map((theme, idx) => (
            <div 
              key={idx}
              className="text-xs p-2 rounded-lg border"
            >
              <span className="font-medium">{theme.name}</span>
              <span className="text-muted-foreground ml-1">
                ({theme.claims?.length || 0} claims)
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Agreements */}
      {agreements && agreements.length > 0 && (
        <div className="space-y-1.5">
          <h5 className="text-[10px] font-semibold uppercase text-muted-foreground tracking-wider">
            Consensus Findings
          </h5>
          {agreements.slice(0, 3).map((agreement, idx) => (
            <div 
              key={idx}
              className="text-xs p-2 rounded-lg bg-green-50 border border-green-200"
            >
              <div className="flex items-center gap-1 mb-0.5">
                <CheckCircle className="h-3 w-3 text-green-600" />
                <span className="text-[10px] text-green-700">
                  {agreement.papers?.length || 0} papers agree
                </span>
              </div>
              <p>{agreement.finding}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// Analysis Status Banner
function AnalysisStatus({ 
  state, 
  paperCount,
  onRunAnalysis,
}: { 
  state: AnalysisState
  paperCount: number
  onRunAnalysis: () => void
}) {
  if (state.status === 'analyzing') {
    return (
      <div className="p-3 bg-primary/5 border-b border-primary/10">
        <div className="flex items-center gap-2 mb-2">
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
          <span className="text-sm font-medium">Analyzing papers...</span>
        </div>
        <Progress value={45} className="h-1" />
      </div>
    )
  }

  if (state.status === 'error') {
    return (
      <div className="p-3 bg-destructive/10 border-b border-destructive/20">
        <div className="flex items-center justify-between">
          <span className="text-sm text-destructive">Analysis failed</span>
          <Button size="sm" variant="outline" onClick={onRunAnalysis}>
            <RefreshCw className="h-3 w-3 mr-1" />
            Retry
          </Button>
        </div>
      </div>
    )
  }

  if (state.status === 'idle' && paperCount > 0) {
    return (
      <div className="p-3 bg-muted/50 border-b">
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">
            {paperCount} papers ready
          </span>
          <Button size="sm" onClick={onRunAnalysis}>
            <Sparkles className="h-3 w-3 mr-1" />
            Analyze
          </Button>
        </div>
      </div>
    )
  }

  if (state.status === 'complete') {
    return (
      <div className="p-2 bg-green-50 border-b border-green-100 flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-green-700">
          <CheckCircle className="h-3.5 w-3.5" />
          <span className="text-xs">Analysis complete</span>
        </div>
        <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={onRunAnalysis}>
          <RefreshCw className="h-3 w-3 mr-1" />
          Refresh
        </Button>
      </div>
    )
  }

  return null
}

export function ResearchTab({
  papers,
  analysisState,
  onInsertClaim,
  onInsertGap,
  onInsertCitation,
  onRunAnalysis,
  onOpenLibrary,
  onRemovePaper,
}: ResearchTabProps) {
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    papers: true,
    claims: true,
    gaps: true,
    insights: false,
  })

  const toggleSection = (section: string) => {
    setOpenSections(prev => ({ ...prev, [section]: !prev[section] }))
  }

  const { claims, gaps, synthesis, status } = analysisState
  const isLoading = status === 'loading' || status === 'analyzing'

  // Count claims per paper
  const claimCountByPaper = claims.reduce((acc, claim) => {
    acc[claim.paper_id] = (acc[claim.paper_id] || 0) + 1
    return acc
  }, {} as Record<string, number>)

  // Group claims by type
  const claimsByType = claims.reduce((acc, claim) => {
    const type = claim.claim_type || 'finding'
    if (!acc[type]) acc[type] = []
    acc[type].push(claim)
    return acc
  }, {} as Record<ClaimType, ExtractedClaim[]>)

  return (
    <div className="flex flex-col h-full">
      {/* Analysis Status Banner */}
      <AnalysisStatus 
        state={analysisState} 
        paperCount={papers.length}
        onRunAnalysis={onRunAnalysis}
      />

      <ScrollArea className="flex-1">
        <div className="p-2 space-y-1">
          {/* Papers Section */}
          <Collapsible 
            open={openSections.papers} 
            onOpenChange={() => toggleSection('papers')}
          >
            <CollapsibleTrigger className="w-full">
              <SectionHeader 
                title="Papers" 
                count={papers.length}
                isOpen={openSections.papers}
                icon={FileText}
                action={
                  <TooltipProvider delayDuration={300}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6"
                          onClick={(e) => {
                            e.stopPropagation()
                            onOpenLibrary()
                          }}
                        >
                          <Plus className="h-3.5 w-3.5" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Add papers</TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                }
              />
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="pl-6 pr-2 py-2 space-y-1.5">
                {papers.length === 0 ? (
                  <div className="text-center py-3">
                    <p className="text-xs text-muted-foreground mb-2">No papers added yet</p>
                    <Button size="sm" variant="outline" onClick={onOpenLibrary}>
                      <Plus className="h-3 w-3 mr-1" />
                      Add Papers
                    </Button>
                  </div>
                ) : (
                  papers.map(paper => (
                    <PaperCardWithPopover 
                      key={paper.id} 
                      paper={paper}
                      claimCount={claimCountByPaper[paper.id] || 0}
                      onInsertCitation={() => onInsertCitation(paper)}
                      onRemove={() => onRemovePaper(paper.id, claimCountByPaper[paper.id] || 0)}
                    />
                  ))
                )}
              </div>
            </CollapsibleContent>
          </Collapsible>

          {/* Claims Section */}
          <Collapsible 
            open={openSections.claims} 
            onOpenChange={() => toggleSection('claims')}
          >
            <CollapsibleTrigger className="w-full">
              <SectionHeader 
                title="Claims" 
                count={claims.length}
                isOpen={openSections.claims}
                icon={Lightbulb}
                isLoading={isLoading}
              />
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="pl-6 pr-2 py-2 space-y-2">
                {claims.length === 0 ? (
                  <p className="text-xs text-muted-foreground text-center py-3">
                    {isLoading ? 'Extracting claims...' : 'Run analysis to extract claims'}
                  </p>
                ) : (
                  <>
                    {Object.entries(claimsByType).map(([type, typeClaims]) => (
                      <div key={type} className="space-y-1">
                        <h5 className="text-[10px] font-semibold uppercase text-muted-foreground tracking-wider flex items-center gap-1">
                          {claimTypeConfig[type as ClaimType]?.label || type}
                          <Badge variant="secondary" className="text-[9px] ml-1">
                            {typeClaims.length}
                          </Badge>
                        </h5>
                        {typeClaims.slice(0, 5).map(claim => (
                          <ClaimCard 
                            key={claim.id} 
                            claim={claim}
                            onInsert={() => onInsertClaim(claim)}
                          />
                        ))}
                        {typeClaims.length > 5 && (
                          <p className="text-[10px] text-muted-foreground text-center">
                            +{typeClaims.length - 5} more
                          </p>
                        )}
                      </div>
                    ))}
                  </>
                )}
              </div>
            </CollapsibleContent>
          </Collapsible>

          {/* Gaps Section */}
          <Collapsible 
            open={openSections.gaps} 
            onOpenChange={() => toggleSection('gaps')}
          >
            <CollapsibleTrigger className="w-full">
              <SectionHeader 
                title="Research Gaps" 
                count={gaps.length}
                isOpen={openSections.gaps}
                icon={AlertTriangle}
                isLoading={isLoading}
              />
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="pl-6 pr-2 py-2 space-y-1.5">
                {gaps.length === 0 ? (
                  <p className="text-xs text-muted-foreground text-center py-3">
                    {isLoading ? 'Finding gaps...' : 'Run analysis to find research gaps'}
                  </p>
                ) : (
                  gaps.map(gap => (
                    <GapCard 
                      key={gap.id} 
                      gap={gap}
                      onInsert={() => onInsertGap(gap)}
                    />
                  ))
                )}
              </div>
            </CollapsibleContent>
          </Collapsible>

          {/* Insights Section */}
          <Collapsible 
            open={openSections.insights} 
            onOpenChange={() => toggleSection('insights')}
          >
            <CollapsibleTrigger className="w-full">
              <SectionHeader 
                title="Insights" 
                count={synthesis?.structured_output?.key_insights?.length || 0}
                isOpen={openSections.insights}
                icon={Sparkles}
                isLoading={isLoading}
              />
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="pl-6 pr-2 py-2">
                <InsightsSection synthesis={synthesis} />
              </div>
            </CollapsibleContent>
          </Collapsible>
        </div>
      </ScrollArea>
    </div>
  )
}
