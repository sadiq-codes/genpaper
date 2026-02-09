'use client'

import { useCallback, useMemo, memo } from 'react'
import { 
  Search, 
  BookOpen, 
  Globe, 
  X, 
  ExternalLink,
  Calendar,
  Users,
  Quote,
  Plus,
  Check,
  Library,
  FileText,
  ChevronDown,
  Loader2,
  Upload,
  Eye
} from 'lucide-react'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import { useLibraryDrawer, type SearchResult, type PaperActions } from './use-library-drawer'

// =============================================================================
// Types
// =============================================================================

interface LibraryDrawerProps {
  isOpen: boolean
  onClose: () => void
  onAddToProject?: (paperId: string, title: string) => void
  currentProjectId?: string
  initialQuery?: string
  libraryOnlyMode?: boolean
  onSelectForProject?: (paper: { id: string; title: string; authors: string[]; year: number | null }) => void
  selectedPaperIds?: string[]
}

// =============================================================================
// Main Component
// =============================================================================

export default function LibraryDrawer(props: LibraryDrawerProps) {
  const { isOpen, onClose } = props

  const drawer = useLibraryDrawer(props)

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50">
      {/* Hidden file input for PDF upload */}
      <input
        ref={drawer.fileInputRef}
        type="file"
        accept=".pdf,application/pdf"
        className="hidden"
        onChange={drawer.handleFileSelected}
      />
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black/30 backdrop-blur-sm animate-in fade-in-0 duration-200"
        onClick={onClose}
        aria-hidden="true"
      />
      
      {/* Drawer */}
      <div 
        className="absolute right-0 top-0 h-full w-[420px] max-w-[90vw] bg-background border-l border-border/30 shadow-lg animate-in slide-in-from-right duration-300 flex flex-col overflow-hidden"
        role="dialog"
        aria-label="Paper library"
      >
        <DrawerHeader
          libraryCount={drawer.libraryPapers.length}
          searchMode={drawer.searchMode}
          onSearchModeChange={drawer.setSearchMode}
          query={drawer.query}
          onQueryChange={drawer.setQuery}
          isTyping={drawer.isTyping}
          isSearchingOnline={drawer.isSearchingOnline}
          isReranking={drawer.isReranking}
          resultsCount={drawer.results.length}
          onClose={onClose}
        />

        <DrawerResults
          results={drawer.results}
          showSkeletons={drawer.showSkeletons}
          showEmptyLibrary={drawer.showEmptyLibrary}
          showSearchPrompt={drawer.showSearchPrompt}
          showMinCharsHint={drawer.showMinCharsHint}
          showNoResults={drawer.showNoResults}
          searchMode={drawer.searchMode}
          onSearchModeChange={drawer.setSearchMode}
          expandedAbstract={drawer.expandedAbstract}
          onToggleExpand={(id) => drawer.setExpandedAbstract(drawer.expandedAbstract === id ? null : id)}
          onAdd={drawer.handleAddToProject}
          onSave={drawer.handleSaveToLibrary}
          onSelect={drawer.handleSelectForProject}
          onUploadPdf={drawer.handleUploadPdf}
          getPaperActions={drawer.getPaperActions}
          loadMoreRef={drawer.loadMoreRef}
          isFetchingNextPage={drawer.isFetchingNextPage}
          hasNextPage={drawer.hasNextPage}
          libraryCount={drawer.libraryPapers.length}
          pageSize={drawer.LIBRARY_PAGE_SIZE}
        />

        <DrawerFooter
          count={drawer.results.length}
          showSkeletons={drawer.showSkeletons}
          searchMode={drawer.searchMode}
          hasNextPage={drawer.hasNextPage}
        />
      </div>
    </div>
  )
}

// =============================================================================
// Sub-components
// =============================================================================

function DrawerHeader({
  libraryCount,
  searchMode,
  onSearchModeChange,
  query,
  onQueryChange,
  isTyping,
  isSearchingOnline,
  isReranking,
  resultsCount,
  onClose,
}: {
  libraryCount: number
  searchMode: 'library' | 'online'
  onSearchModeChange: (mode: 'library' | 'online') => void
  query: string
  onQueryChange: (q: string) => void
  isTyping: boolean
  isSearchingOnline: boolean
  isReranking: boolean
  resultsCount: number
  onClose: () => void
}) {
  return (
    <div className="flex-none border-b border-border/30">
      <div className="flex items-center justify-between px-5 py-4">
        <div className="flex items-center gap-2.5">
          <h2 className="font-instrument text-base tracking-tight">Papers</h2>
          <span className="text-[10px] text-muted-foreground">{libraryCount} saved</span>
        </div>
        <button
          onClick={onClose}
          className="h-7 w-7 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
          aria-label="Close"
        >
          <X className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </div>

      {/* Search Mode Toggle */}
      <div className="px-5 pb-3">
        <div className="flex gap-0.5 w-full" role="tablist">
          <button
            role="tab"
            aria-selected={searchMode === 'library'}
            onClick={() => onSearchModeChange('library')}
            className={cn(
              "flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-sm transition-all duration-200",
              searchMode === 'library'
                ? "bg-foreground/80 text-background font-medium"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
            )}
          >
            <BookOpen className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Library</span>
          </button>
          <button
            role="tab"
            aria-selected={searchMode === 'online'}
            onClick={() => onSearchModeChange('online')}
            className={cn(
              "flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-sm transition-all duration-200",
              searchMode === 'online'
                ? "bg-foreground/80 text-background font-medium"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
            )}
          >
            <Globe className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Online</span>
          </button>
        </div>
      </div>

      {/* Search Input */}
      <div className="px-5 pb-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
          <Input
            placeholder={searchMode === 'library' ? "Filter papers…" : "Search papers…"}
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            className="pl-9 h-9 rounded-xl border-border/30 bg-background text-sm placeholder:text-muted-foreground/30 focus-visible:ring-0 focus-visible:border-foreground/20 transition-colors"
            aria-label={searchMode === 'library' ? "Filter papers" : "Search papers"}
          />
        </div>
        {isTyping && (
          <p className="text-[10px] text-muted-foreground mt-2 text-center flex items-center justify-center gap-1.5 font-instrument italic" aria-live="polite">
            <Loader2 className="h-2.5 w-2.5 animate-spin" aria-hidden="true" />
            Searching…
          </p>
        )}
        {isSearchingOnline && !isTyping && resultsCount > 0 && (
          <p className="text-[10px] text-muted-foreground mt-2 text-center font-instrument italic" aria-live="polite">
            Updating results…
          </p>
        )}
        {isReranking && !isSearchingOnline && resultsCount > 0 && (
          <p className="text-[10px] text-muted-foreground mt-2 text-center flex items-center justify-center gap-1.5 font-instrument italic" aria-live="polite">
            <Loader2 className="h-2.5 w-2.5 animate-spin" aria-hidden="true" />
            Improving results…
          </p>
        )}
      </div>
    </div>
  )
}

function DrawerResults({
  results,
  showSkeletons,
  showEmptyLibrary,
  showSearchPrompt,
  showMinCharsHint,
  showNoResults,
  searchMode,
  onSearchModeChange,
  expandedAbstract,
  onToggleExpand,
  onAdd,
  onSave,
  onSelect,
  onUploadPdf,
  getPaperActions,
  loadMoreRef,
  isFetchingNextPage,
  hasNextPage,
  libraryCount,
  pageSize,
}: {
  results: SearchResult[]
  showSkeletons: boolean
  showEmptyLibrary: boolean
  showSearchPrompt: boolean
  showMinCharsHint: boolean
  showNoResults: boolean
  searchMode: 'library' | 'online'
  onSearchModeChange: (mode: 'library' | 'online') => void
  expandedAbstract: string | null
  onToggleExpand: (id: string) => void
  onAdd: (paper: SearchResult) => void
  onSave: (paper: SearchResult) => void
  onSelect: (paper: SearchResult) => void
  onUploadPdf: (paperId: string) => void
  getPaperActions: (paper: SearchResult) => PaperActions
  loadMoreRef: React.RefObject<HTMLDivElement | null>
  isFetchingNextPage: boolean
  hasNextPage: boolean | undefined
  libraryCount: number
  pageSize: number
}) {
  return (
    <ScrollArea className="flex-1 min-h-0 overscroll-contain">
      <div className="px-4">
        {showSkeletons && (
          <>
            <PaperCardSkeleton />
            <PaperCardSkeleton />
            <PaperCardSkeleton />
          </>
        )}

        {showEmptyLibrary && (
          <EmptyState
            icon={BookOpen}
            title="No papers yet"
            description="Search online to find papers"
            action={
              <button
                onClick={() => onSearchModeChange('online')}
                className="h-7 px-3 text-[11px] font-medium rounded-full border border-border/40 text-muted-foreground hover:text-foreground hover:border-border/60 transition-colors inline-flex items-center gap-1.5"
              >
                <Globe className="h-3 w-3" aria-hidden="true" />
                Search Online
              </button>
            }
          />
        )}

        {showSearchPrompt && (
          <EmptyState
            icon={Search}
            title="Search academic papers"
            description="Enter a topic to search across databases"
          />
        )}

        {showMinCharsHint && (
          <EmptyState
            icon={Search}
            title="Keep typing…"
            description="Enter at least 3 characters"
          />
        )}

        {showNoResults && (
          <EmptyState
            icon={FileText}
            title="No papers found"
            description={searchMode === 'library' 
              ? "Try different keywords" 
              : "Try different search terms"}
            action={searchMode === 'library' && (
              <button
                onClick={() => onSearchModeChange('online')}
                className="h-7 px-3 text-[11px] font-medium rounded-full border border-border/40 text-muted-foreground hover:text-foreground hover:border-border/60 transition-colors inline-flex items-center gap-1.5"
              >
                <Globe className="h-3 w-3" aria-hidden="true" />
                Search Online
              </button>
            )}
          />
        )}

        {results.length > 0 && !showSkeletons && (
          <>
            {results.map((paper) => (
              <PaperCard
                key={paper.id}
                paper={paper}
                actions={getPaperActions(paper)}
                isExpanded={expandedAbstract === paper.id}
                onToggleExpand={() => onToggleExpand(paper.id)}
                onAdd={onAdd}
                onSave={onSave}
                onSelect={onSelect}
                onUploadPdf={onUploadPdf}
              />
            ))}
            
            {searchMode === 'library' && (
              <div ref={loadMoreRef} className="h-10 flex items-center justify-center">
                {isFetchingNextPage && (
                  <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" aria-label="Loading more papers" />
                )}
                {!hasNextPage && libraryCount > pageSize && (
                  <p className="text-[10px] text-muted-foreground font-instrument italic">All papers loaded</p>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </ScrollArea>
  )
}

function DrawerFooter({
  count,
  showSkeletons,
  searchMode,
  hasNextPage,
}: {
  count: number
  showSkeletons: boolean
  searchMode: 'library' | 'online'
  hasNextPage: boolean | undefined
}) {
  if (count === 0 || showSkeletons) return null

  return (
    <div className="flex-none px-5 py-2.5 border-t border-border/20 text-center">
      <p className="text-[10px] text-muted-foreground font-instrument italic">
        {count} {count === 1 ? 'paper' : 'papers'}
        {searchMode === 'library' && hasNextPage && ' · scroll for more'}
      </p>
    </div>
  )
}

// =============================================================================
// Shared Components
// =============================================================================

function PaperCardSkeleton() {
  return (
    <div className="py-3.5 border-b border-border/15 animate-pulse">
      <div className="h-3.5 bg-muted/50 rounded-lg w-4/5 mb-2" />
      <div className="h-3 bg-muted/30 rounded-lg w-3/5 mb-2.5" />
      <div className="flex gap-2">
        <div className="h-4 bg-muted/20 rounded-full w-14" />
        <div className="h-4 bg-muted/20 rounded-full w-10" />
      </div>
    </div>
  )
}

function EmptyState({ 
  icon: Icon, 
  title, 
  description, 
  action 
}: { 
  icon: React.ComponentType<{ className?: string }>
  title: string
  description: string
  action?: React.ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center px-6">
      <div className="w-10 h-10 rounded-full border border-border/40 flex items-center justify-center mb-3">
        <Icon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
      </div>
      <h3 className="font-instrument text-sm tracking-tight mb-1">{title}</h3>
      <p className="text-xs text-muted-foreground mb-3 max-w-[200px] leading-relaxed">{description}</p>
      {action}
    </div>
  )
}

// =============================================================================
// PaperCard - consolidated boolean props into `actions` object
// =============================================================================

interface PaperCardProps {
  paper: SearchResult
  actions: PaperActions
  isExpanded: boolean
  onToggleExpand: () => void
  onAdd: (paper: SearchResult) => void
  onSave: (paper: SearchResult) => void
  onSelect: (paper: SearchResult) => void
  onUploadPdf: (paperId: string) => void
}

const PaperCard = memo(function PaperCard({ 
  paper, 
  actions,
  isExpanded,
  onToggleExpand,
  onAdd,
  onSave,
  onSelect,
  onUploadPdf,
}: PaperCardProps) {
  const authorDisplay = useMemo(() => {
    if (!paper.authors.length) return null
    if (paper.authors.length <= 2) return paper.authors.join(' & ')
    return `${paper.authors[0]} et al.`
  }, [paper.authors])

  const handleAddClick = useCallback(() => onAdd(paper), [onAdd, paper])
  const handleSaveClick = useCallback(() => onSave(paper), [onSave, paper])
  const handleSelectClick = useCallback(() => onSelect(paper), [onSelect, paper])

  const handleTitleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onToggleExpand()
    }
  }, [onToggleExpand])

  return (
    <div 
      className={cn(
        "py-3.5 border-b border-border/40 group transition-colors",
        "[content-visibility:auto] [contain-intrinsic-size:0_100px]",
        actions.isAdded && "bg-foreground/3"
      )}
    >
      {/* Title */}
      <h3 
        className="font-instrument text-sm tracking-tight leading-snug line-clamp-2 cursor-pointer hover:text-foreground transition-colors text-left"
        onClick={onToggleExpand}
        onKeyDown={handleTitleKeyDown}
        tabIndex={0}
        role="button"
        aria-expanded={isExpanded}
      >
        {paper.title}
      </h3>
      
      {/* Meta */}
      <p className="text-xs text-muted-foreground truncate mt-1">
        {authorDisplay}
        {paper.year && ` · ${paper.year}`}
        {paper.citationCount !== undefined && paper.citationCount > 0 && ` · ${paper.citationCount.toLocaleString()} cited`}
      </p>

      {/* Source label */}
      <span className="text-[10px] text-muted-foreground uppercase tracking-wide font-medium">
        {paper.type === 'library' ? 'Saved' : paper.source}
      </span>

      {/* Expandable Abstract */}
      {paper.abstract && isExpanded && (
        <div className="mt-2.5 pt-2.5 border-t border-border/40">
          <p className="text-xs text-muted-foreground leading-relaxed">
            {paper.abstract}
          </p>
        </div>
      )}

      {/* Actions Row */}
      <div className="flex items-center justify-between mt-2.5 opacity-0 group-hover:opacity-100 transition-opacity">
        <div className="flex items-center gap-0.5">
          {paper.abstract && (
            <button 
              onClick={onToggleExpand}
              className="h-6 px-2 text-[10px] text-muted-foreground hover:text-foreground rounded-full transition-colors inline-flex items-center gap-1"
              aria-expanded={isExpanded}
            >
              <ChevronDown className={cn(
                "h-2.5 w-2.5 transition-transform",
                isExpanded && "rotate-180"
              )} aria-hidden="true" />
              {isExpanded ? 'Less' : 'More'}
            </button>
          )}
          {paper.pdfUrl ? (
            <button
              onClick={() => window.open(paper.pdfUrl, '_blank')}
              className="h-6 px-2 text-[10px] text-muted-foreground hover:text-foreground rounded-full transition-colors inline-flex items-center gap-1"
            >
              <Eye className="h-2.5 w-2.5" aria-hidden="true" />
              PDF
            </button>
          ) : paper.type === 'library' ? (
            <button
              onClick={() => onUploadPdf(paper.id)}
              className="h-6 px-2 text-[10px] text-muted-foreground hover:text-foreground rounded-full transition-colors inline-flex items-center gap-1"
            >
              <Upload className="h-2.5 w-2.5" aria-hidden="true" />
              PDF
            </button>
          ) : null}
          {paper.url && !paper.pdfUrl && (
            <button
              onClick={() => window.open(paper.url, '_blank')}
              className="h-6 px-2 text-[10px] text-muted-foreground hover:text-foreground rounded-full transition-colors inline-flex items-center gap-1"
            >
              <ExternalLink className="h-2.5 w-2.5" aria-hidden="true" />
              Open
            </button>
          )}
        </div>
        
        {/* Add to Project */}
        {actions.canAdd && (
          <button
            onClick={handleAddClick}
            disabled={actions.isAdded}
            className={cn(
              "h-6 px-2.5 text-[10px] font-medium rounded-full transition-colors inline-flex items-center gap-1 disabled:opacity-50",
              actions.isAdded
                ? "text-muted-foreground/50"
                : "bg-foreground/80 text-background hover:bg-foreground/70"
            )}
          >
            {actions.isAdded ? (
              <><Check className="h-2.5 w-2.5" aria-hidden="true" /> Added</>
            ) : (
              <><Plus className="h-2.5 w-2.5" aria-hidden="true" /> Add</>
            )}
          </button>
        )}
        
        {/* Save to Library */}
        {actions.canSave && paper.type === 'search' && (
          <button
            onClick={handleSaveClick}
            disabled={actions.isSaved}
            className={cn(
              "h-6 px-2.5 text-[10px] font-medium rounded-full transition-colors inline-flex items-center gap-1 disabled:opacity-50",
              actions.isSaved
                ? "text-muted-foreground/50"
                : "bg-foreground/80 text-background hover:bg-foreground/70"
            )}
          >
            {actions.isSaved ? (
              <><Check className="h-2.5 w-2.5" aria-hidden="true" /> Saved</>
            ) : (
              <><Plus className="h-2.5 w-2.5" aria-hidden="true" /> Save</>
            )}
          </button>
        )}
        
        {/* Select for Project */}
        {actions.canSelect && (
          <button
            onClick={handleSelectClick}
            disabled={actions.isSelected}
            className={cn(
              "h-6 px-2.5 text-[10px] font-medium rounded-full transition-colors inline-flex items-center gap-1 disabled:opacity-50",
              actions.isSelected
                ? "text-muted-foreground/50"
                : "bg-foreground/80 text-background hover:bg-foreground/70"
            )}
          >
            {actions.isSelected ? (
              <><Check className="h-2.5 w-2.5" aria-hidden="true" /> Selected</>
            ) : (
              <><Plus className="h-2.5 w-2.5" aria-hidden="true" /> Select</>
            )}
          </button>
        )}
      </div>
    </div>
  )
})
