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
  GapType,
  AllClaimTypes,
  ClaimRelationship,
  GapAddressedStatus,
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

// Claim type icons and colors (includes both literature and original research types)
const claimTypeConfig: Record<AllClaimTypes, { icon: typeof Lightbulb; color: string; label: string }> = {
  // Literature claim types
  finding: { icon: Lightbulb, color: 'text-green-600 bg-green-50 border-green-200', label: 'Finding' },
  method: { icon: Beaker, color: 'text-gray-600 bg-gray-100 border-gray-300', label: 'Method' },
  limitation: { icon: AlertTriangle, color: 'text-orange-600 bg-orange-50 border-orange-200', label: 'Limitation' },
  future_work: { icon: Sparkles, color: 'text-purple-600 bg-purple-50 border-purple-200', label: 'Future Work' },
  background: { icon: BookOpen, color: 'text-gray-600 bg-gray-50 border-gray-200', label: 'Background' },
  // Original research claim types
  hypothesis: { icon: HelpCircle, color: 'text-amber-600 bg-amber-50 border-amber-200', label: 'Hypothesis' },
  contribution: { icon: Sparkles, color: 'text-indigo-600 bg-indigo-50 border-indigo-200', label: 'Contribution' },
  implication: { icon: Lightbulb, color: 'text-teal-600 bg-teal-50 border-teal-200', label: 'Implication' },
}

// Relationship badge config
const relationshipConfig: Record<ClaimRelationship, { color: string; label: string; emoji: string }> = {
  supports: { color: 'text-green-700 bg-green-100 border-green-300', label: 'Supports', emoji: '🟢' },
  extends: { color: 'text-gray-700 bg-gray-200 border-gray-400', label: 'Extends', emoji: '🔵' },
  contradicts: { color: 'text-red-700 bg-red-100 border-red-300', label: 'Contradicts', emoji: '🔴' },
  unrelated: { color: 'text-gray-600 bg-gray-100 border-gray-300', label: 'Unrelated', emoji: '⚪' },
  not_analyzed: { color: 'text-gray-500 bg-gray-50 border-gray-200', label: '', emoji: '' },
}

// Gap addressed status config
const addressedStatusConfig: Record<GapAddressedStatus, { color: string; label: string; emoji: string }> = {
  fully_addressed: { color: 'text-green-700 bg-green-100 border-green-300', label: 'Addressed', emoji: '✅' },
  partially_addressed: { color: 'text-yellow-700 bg-yellow-100 border-yellow-300', label: 'Partial', emoji: '⚠️' },
  not_addressed: { color: 'text-gray-600 bg-gray-100 border-gray-300', label: 'Open', emoji: '❌' },
  not_analyzed: { color: 'text-gray-500 bg-gray-50 border-gray-200', label: '', emoji: '' },
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
  showRelationship = false,
}: { 
  claim: ExtractedClaim
  onInsert: () => void
  showRelationship?: boolean
}) {
  const config = claimTypeConfig[claim.claim_type] || claimTypeConfig.finding
  const Icon = config.icon
  const relConfig = claim.relationship_to_user && claim.relationship_to_user !== 'not_analyzed' 
    ? relationshipConfig[claim.relationship_to_user] 
    : null
  const isUserClaim = claim.source === 'original_research'

  return (
    <button
      onClick={onInsert}
      className={cn(
        "w-full text-left p-2 rounded-lg border bg-card hover:bg-muted/30 transition-colors group",
        isUserClaim && "border-amber-300 bg-amber-50/50"
      )}
    >
      <div className="flex items-start gap-2">
        <div className={cn(
          "p-1 rounded border shrink-0 mt-0.5",
          config.color
        )}>
          <Icon className="h-3 w-3" />
        </div>
        <div className="flex-1 min-w-0">
          {/* Relationship badge for literature claims */}
          {showRelationship && relConfig && (
            <Badge className={cn("text-[9px] px-1.5 py-0 h-4 mb-1 font-normal", relConfig.color)}>
              {relConfig.emoji} {relConfig.label}
            </Badge>
          )}
          <p className="text-xs leading-relaxed line-clamp-3">
            {claim.claim_text}
          </p>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-[10px] text-muted-foreground line-clamp-1">
              {isUserClaim 
                ? 'Your Research' 
                : claim.paper_title 
                  ? `${claim.paper_authors?.[0]?.split(' ').pop() || 'Unknown'}, ${claim.paper_year}` 
                  : 'Unknown source'}
            </span>
            <Badge variant="outline" className="text-[9px] px-1 py-0 h-4">
              {Math.round(claim.confidence * 100)}%
            </Badge>
          </div>
          {/* Show relationship explanation */}
          {showRelationship && claim.relationship_explanation && (
            <p className="text-[10px] text-muted-foreground mt-1 italic line-clamp-2">
              {claim.relationship_explanation}
            </p>
          )}
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
  showAddressedStatus = false,
}: { 
  gap: ResearchGap
  onInsert: () => void
  showAddressedStatus?: boolean
}) {
  const config = gapTypeConfig[gap.gap_type] || gapTypeConfig.unstudied
  const Icon = config.icon
  const addressedConfig = gap.addressed_status && gap.addressed_status !== 'not_analyzed'
    ? addressedStatusConfig[gap.addressed_status]
    : null

  return (
    <button
      onClick={onInsert}
      className={cn(
        "w-full text-left p-2 rounded-lg border bg-card hover:bg-muted/30 transition-colors group",
        gap.addressed_status === 'fully_addressed' && "border-green-300 bg-green-50/30"
      )}
    >
      <div className="flex items-start gap-2">
        <div className={cn(
          "p-1 rounded border shrink-0 mt-0.5",
          config.color
        )}>
          <Icon className="h-3 w-3" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1 mb-1 flex-wrap">
            <Badge variant="secondary" className="text-[9px] px-1.5 py-0 h-4">
              {config.label}
            </Badge>
            <Badge variant="outline" className="text-[9px] px-1 py-0 h-4">
              {Math.round(gap.confidence * 100)}%
            </Badge>
            {/* Addressed status badge */}
            {showAddressedStatus && addressedConfig && (
              <Badge className={cn("text-[9px] px-1.5 py-0 h-4 font-normal", addressedConfig.color)}>
                {addressedConfig.emoji} {addressedConfig.label}
              </Badge>
            )}
          </div>
          <p className="text-xs leading-relaxed line-clamp-3">
            {gap.description}
          </p>
          {/* Show user contribution if gap is addressed */}
          {showAddressedStatus && gap.user_contribution && (
            <p className="text-[10px] text-green-700 mt-1 line-clamp-2 font-medium">
              Your contribution: {gap.user_contribution}
            </p>
          )}
          {/* Show research opportunity if gap is not addressed */}
          {(!showAddressedStatus || gap.addressed_status === 'not_addressed') && gap.research_opportunity && (
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
    positioning: true,  // Show positioning by default when available
  })

  const toggleSection = (section: string) => {
    setOpenSections(prev => ({ ...prev, [section]: !prev[section] }))
  }

  const { claims, userClaims, gaps, synthesis, status, hasOriginalResearch, positioning } = analysisState
  const isLoading = status === 'loading' || status === 'analyzing'

  // Count claims per paper (only for literature claims with paper_id)
  const claimCountByPaper = claims.reduce((acc, claim) => {
    if (claim.paper_id) {
      acc[claim.paper_id] = (acc[claim.paper_id] || 0) + 1
    }
    return acc
  }, {} as Record<string, number>)

  // Group literature claims by type
  const claimsByType = claims.reduce((acc, claim) => {
    const type = claim.claim_type || 'finding'
    if (!acc[type]) acc[type] = []
    acc[type].push(claim)
    return acc
  }, {} as Record<AllClaimTypes, ExtractedClaim[]>)

  // Group user claims by type
  const userClaimsByType = (userClaims || []).reduce((acc, claim) => {
    const type = claim.claim_type || 'finding'
    if (!acc[type]) acc[type] = []
    acc[type].push(claim)
    return acc
  }, {} as Record<AllClaimTypes, ExtractedClaim[]>)

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
            <CollapsibleTrigger asChild>
              <div className="cursor-pointer">
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
              </div>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="pl-6 pr-2 py-2 space-y-1.5">
                {papers.length === 0 ? (
                  <div className="text-center py-3">
                    <p className="text-xs text-muted-foreground mb-2">No papers added yet</p>
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
            <CollapsibleTrigger asChild>
              <div className="cursor-pointer">
                <SectionHeader 
                  title="Claims" 
                  count={claims.length + (userClaims?.length || 0)}
                  isOpen={openSections.claims}
                  icon={Lightbulb}
                  isLoading={isLoading}
                />
              </div>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="pl-6 pr-2 py-2 space-y-3">
                {/* User Claims Section - shown first when hasOriginalResearch */}
                {hasOriginalResearch && userClaims && userClaims.length > 0 && (
                  <div className="space-y-2 pb-2 border-b border-amber-200">
                    <h5 className="text-[10px] font-semibold uppercase text-amber-700 tracking-wider flex items-center gap-1">
                      <Sparkles className="h-3 w-3" />
                      Your Research
                      <Badge className="text-[9px] ml-1 bg-amber-100 text-amber-700">
                        {userClaims.length}
                      </Badge>
                    </h5>
                    {Object.entries(userClaimsByType).map(([type, typeClaims]) => (
                      <div key={`user-${type}`} className="space-y-1">
                        <h6 className="text-[9px] font-medium text-amber-600 pl-1">
                          {claimTypeConfig[type as AllClaimTypes]?.label || type}
                        </h6>
                        {typeClaims.map(claim => (
                          <ClaimCard 
                            key={claim.id} 
                            claim={claim}
                            onInsert={() => onInsertClaim(claim)}
                          />
                        ))}
                      </div>
                    ))}
                  </div>
                )}

                {/* Literature Claims Section */}
                {claims.length === 0 && (!userClaims || userClaims.length === 0) ? (
                  <p className="text-xs text-muted-foreground text-center py-3">
                    {isLoading ? 'Extracting claims...' : 'Run analysis to extract claims'}
                  </p>
                ) : claims.length > 0 && (
                  <>
                    {hasOriginalResearch && (
                      <h5 className="text-[10px] font-semibold uppercase text-muted-foreground tracking-wider">
                        Literature Claims
                      </h5>
                    )}
                    {Object.entries(claimsByType).map(([type, typeClaims]) => (
                      <div key={type} className="space-y-1">
                        <h5 className="text-[10px] font-semibold uppercase text-muted-foreground tracking-wider flex items-center gap-1">
                          {claimTypeConfig[type as AllClaimTypes]?.label || type}
                          <Badge variant="secondary" className="text-[9px] ml-1">
                            {typeClaims.length}
                          </Badge>
                        </h5>
                        {typeClaims.slice(0, 5).map(claim => (
                          <ClaimCard 
                            key={claim.id} 
                            claim={claim}
                            onInsert={() => onInsertClaim(claim)}
                            showRelationship={hasOriginalResearch}
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
            <CollapsibleTrigger asChild>
              <div className="cursor-pointer">
                <SectionHeader 
                  title="Research Gaps" 
                  count={gaps.length}
                  isOpen={openSections.gaps}
                  icon={AlertTriangle}
                  isLoading={isLoading}
                />
              </div>
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
                      showAddressedStatus={hasOriginalResearch}
                    />
                  ))
                )}
              </div>
            </CollapsibleContent>
          </Collapsible>

          {/* Research Positioning Section - only shown when hasOriginalResearch */}
          {hasOriginalResearch && positioning && (
            <Collapsible 
              open={openSections.positioning} 
              onOpenChange={() => toggleSection('positioning')}
            >
              <CollapsibleTrigger asChild>
                <div className="cursor-pointer">
                  <SectionHeader 
                    title="Positioning" 
                    count={
                      (positioning.novelty?.length || 0) + 
                      (positioning.alignments?.length || 0) + 
                      (positioning.divergences?.length || 0)
                    }
                    isOpen={openSections.positioning || false}
                    icon={Sparkles}
                  />
                </div>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="pl-6 pr-2 py-2 space-y-3">
                  {/* Novelty */}
                  {positioning.novelty && positioning.novelty.length > 0 && (
                    <div className="space-y-1.5">
                      <h5 className="text-[10px] font-semibold uppercase text-indigo-600 tracking-wider">
                        What&apos;s New
                      </h5>
                      {positioning.novelty.map((item, idx) => (
                        <div 
                          key={idx}
                          className="text-xs p-2 rounded-lg bg-indigo-50 border border-indigo-200"
                        >
                          {item}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Alignments */}
                  {positioning.alignments && positioning.alignments.length > 0 && (
                    <div className="space-y-1.5">
                      <h5 className="text-[10px] font-semibold uppercase text-green-600 tracking-wider">
                        Supports Literature
                      </h5>
                      {positioning.alignments.slice(0, 3).map((item, idx) => (
                        <div 
                          key={idx}
                          className="text-xs p-2 rounded-lg bg-green-50 border border-green-200"
                        >
                          {item}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Divergences */}
                  {positioning.divergences && positioning.divergences.length > 0 && (
                    <div className="space-y-1.5">
                      <h5 className="text-[10px] font-semibold uppercase text-red-600 tracking-wider">
                        Points to Discuss
                      </h5>
                      {positioning.divergences.slice(0, 3).map((item, idx) => (
                        <div 
                          key={idx}
                          className="text-xs p-2 rounded-lg bg-red-50 border border-red-200"
                        >
                          {item}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Suggested Discussion Points */}
                  {positioning.suggestedDiscussionPoints && positioning.suggestedDiscussionPoints.length > 0 && (
                    <div className="space-y-1.5">
                      <h5 className="text-[10px] font-semibold uppercase text-muted-foreground tracking-wider">
                        Discussion Suggestions
                      </h5>
                      {positioning.suggestedDiscussionPoints.slice(0, 4).map((item, idx) => (
                        <div 
                          key={idx}
                          className="text-xs p-2 rounded-lg bg-muted/50 border text-muted-foreground"
                        >
                          💡 {item}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </CollapsibleContent>
            </Collapsible>
          )}

          {/* Insights Section */}
          <Collapsible 
            open={openSections.insights} 
            onOpenChange={() => toggleSection('insights')}
          >
            <CollapsibleTrigger asChild>
              <div className="cursor-pointer">
                <SectionHeader 
                  title="Insights" 
                  count={synthesis?.structured_output?.key_insights?.length || 0}
                  isOpen={openSections.insights}
                  icon={Sparkles}
                  isLoading={isLoading}
                />
              </div>
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
