"use client"

import { useState, useMemo } from "react"
import { Tabs, TabsContent } from "@/components/ui/tabs"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import {
  Search,
  Plus,
  BookOpen,
  MoreVertical,
  ExternalLink,
  Trash2,
  Edit3,
  Upload,
  Loader2,
  X,
} from "lucide-react"
import type { LibraryPaper, Paper } from "@/types/simplified"
import FileUpload from "@/components/FileUpload"
import { cn } from "@/lib/utils"

interface LibraryManagerProps {
  className?: string
}

export default function LibraryManager({ className }: LibraryManagerProps) {
  // State declarations
  const [libraryPapers, _setLibraryPapers] = useState<LibraryPaper[]>([])
  const [processingPapers, _setProcessingPapers] = useState<Set<string>>(new Set())
  const [removingPapers, _setRemovingPapers] = useState<Set<string>>(new Set())
  const [searchQuery, setSearchQuery] = useState("")
  const [sortBy, setSortBy] = useState<"added_at" | "title">("added_at")
  const [loading, _setLoading] = useState(false)
  const [searchResults, setSearchResults] = useState<Paper[]>([])
  const [isSearching, setIsSearching] = useState(false)

  // Sorting and filtering logic
  const sortedLibraryPapers = useMemo(() => {
    let sorted = [...libraryPapers]

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      sorted = sorted.filter((p) => p.paper.title.toLowerCase().includes(q) || p.notes?.toLowerCase().includes(q))
    }

    sorted.sort((a, b) => {
      if (sortBy === "title") {
        return a.paper.title.localeCompare(b.paper.title)
      }
      return new Date(b.paper.created_at).getTime() - new Date(a.paper.created_at).getTime()
    })

    return sorted
  }, [libraryPapers, searchQuery, sortBy])

  // Function declarations
  const addPaperToLibrary = (_paperId: string) => {
    // Logic to add paper to library
  }

  const handleNotesEdit = (_libraryPaper: LibraryPaper) => {
    // Logic to handle notes edit
  }

  const removePaperFromLibrary = (_paperId: string) => {
    // Logic to remove paper from library
  }

  const handleUploadComplete = (papers: { title?: string; authors?: string[]; abstract?: string; venue?: string; doi?: string; year?: string }[]) => {
    // Logic to handle upload complete
    console.log("Upload complete:", papers)
  }

  const searchOnlinePapers = async (_query: string) => {
    setIsSearching(true)
    // Logic to search online papers
    const results = await fetchPapers(_query) // Placeholder for fetchPapers function
    setSearchResults(results)
    setIsSearching(false)
  }

  const fetchPapers = async (_query: string) => {
    // Placeholder for fetching papers logic
    return [] as Paper[]
  }

  // UI state
  const [activeTab, setActiveTab] = useState<"library" | "search">("library")

  const PaperItem = ({ paper, isSearchResult = false }: { paper: Paper | LibraryPaper; isSearchResult?: boolean }) => {
    const actualPaper = "paper" in paper ? paper.paper : paper
    const libraryPaper = "paper" in paper ? paper : null
    const paperId = String(actualPaper.id)
    const isProcessing = isSearchResult && processingPapers.has(paperId)
    const isRemoving = removingPapers.has(paperId)

    return (
      <div className={cn("py-3.5 border-b border-border/40 group", isRemoving && "opacity-50")}>
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <h3 className="font-instrument text-sm tracking-tight leading-snug line-clamp-2 group-hover:text-foreground transition-colors">
              {actualPaper.title}
            </h3>
            <p className="text-xs text-muted-foreground truncate mt-1">
              {actualPaper.authors
                ?.map((a) => (typeof a === "string" ? a : a.name))
                .slice(0, 2)
                .join(", ") || "Unknown authors"}
              {actualPaper.publication_date && ` · ${new Date(actualPaper.publication_date).getFullYear()}`}
              {actualPaper.venue && ` · ${actualPaper.venue}`}
            </p>
          </div>
          
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="h-7 w-7 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground shrink-0 opacity-0 group-hover:opacity-100 transition-all" disabled={isProcessing || isRemoving}>
                {isProcessing ? <Loader2 className="h-3 w-3 animate-spin" /> : <MoreVertical className="h-3 w-3" />}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="rounded-xl">
              {isSearchResult ? (
                <DropdownMenuItem onClick={() => addPaperToLibrary(paperId)} disabled={isProcessing}>
                  <Plus className="h-3.5 w-3.5 mr-2" />
                  Add to Library
                </DropdownMenuItem>
              ) : (
                <>
                  <DropdownMenuItem onClick={() => handleNotesEdit(libraryPaper!)}>
                    <Edit3 className="h-3.5 w-3.5 mr-2" />
                    Edit Notes
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => removePaperFromLibrary(paperId)}
                    disabled={isRemoving}
                    className="text-destructive"
                  >
                    <Trash2 className="h-3.5 w-3.5 mr-2" />
                    Remove
                  </DropdownMenuItem>
                </>
              )}
              {actualPaper.url && (
                <DropdownMenuItem onClick={() => window.open(actualPaper.url, "_blank")}>
                  <ExternalLink className="h-3.5 w-3.5 mr-2" />
                  View Paper
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    )
  }

  return (
    <div className={cn("w-full space-y-6", className)}>
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "library" | "search")} className="w-full">
        <div className="flex items-center justify-between gap-4 pb-4 border-b border-border/20">
          <div className="flex gap-0.5" role="tablist">
            <button
              role="tab"
              aria-selected={activeTab === 'library'}
              onClick={() => setActiveTab('library')}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm transition-all duration-200",
                activeTab === 'library'
                  ? "bg-foreground/80 text-background font-medium"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
              )}
            >
              <BookOpen className="h-3.5 w-3.5" aria-hidden="true" />
              My Library
            </button>
            <button
              role="tab"
              aria-selected={activeTab === 'search'}
              onClick={() => setActiveTab('search')}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm transition-all duration-200",
                activeTab === 'search'
                  ? "bg-foreground/80 text-background font-medium"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
              )}
            >
              <Search className="h-3.5 w-3.5" aria-hidden="true" />
              Search
            </button>
          </div>

          {activeTab === "library" && (
            <label className="cursor-pointer h-7 px-3 text-[11px] font-medium rounded-full border border-border/40 text-muted-foreground hover:text-foreground hover:border-border/60 transition-colors inline-flex items-center gap-1.5">
              <Upload className="h-3 w-3" />
              Upload PDF
            </label>
          )}
        </div>

        <TabsContent value="library" className="space-y-4">
          {/* Search and Filter Controls */}
          <div className="flex gap-2 items-end">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
              <Input
                placeholder="Search by title or notes..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 pr-9 h-9 rounded-xl border-border/40 placeholder:text-muted-foreground/60 focus-visible:ring-0 focus-visible:border-foreground/20 transition-colors"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery("")}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            <Select value={sortBy} onValueChange={(v) => setSortBy(v as "added_at" | "title")}>
              <SelectTrigger className="w-36 h-9 rounded-full border-border/30 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="rounded-xl">
                <SelectItem value="added_at">Recently Added</SelectItem>
                <SelectItem value="title">Title (A-Z)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Library Papers List */}
          {loading ? (
            <div>
              {[...Array(3)].map((_, i) => (
                <div key={i} className="py-3.5 border-b border-border/40 animate-pulse">
                  <div className="h-3.5 bg-muted/50 rounded-lg w-3/4 mb-2" />
                  <div className="h-3 bg-muted/30 rounded-lg w-1/2" />
                </div>
              ))}
            </div>
          ) : sortedLibraryPapers.length > 0 ? (
            <div>
              {sortedLibraryPapers.map((paper) => (
                <PaperItem key={paper.id} paper={paper} isSearchResult={false} />
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-14 px-6 text-center">
              <div className="w-10 h-10 rounded-full border border-border/40 flex items-center justify-center mb-4">
                <BookOpen className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              </div>
              <h3 className="font-instrument text-base tracking-tight mb-1">No papers yet</h3>
              <p className="text-xs text-muted-foreground mb-5 max-w-[240px] leading-relaxed">
                Start by uploading a PDF or searching for papers to add to your library.
              </p>
              <div className="flex gap-1.5">
                <label className="cursor-pointer h-7 px-3 text-[11px] font-medium rounded-full border border-border/40 text-muted-foreground hover:text-foreground transition-colors inline-flex items-center gap-1.5">
                  <Upload className="h-3 w-3" />
                  Upload PDF
                </label>
                <button
                  onClick={() => setActiveTab("search")}
                  className="h-7 px-3 text-[11px] font-medium rounded-full bg-foreground/80 text-background hover:bg-foreground/70 transition-colors inline-flex items-center gap-1.5"
                >
                  <Search className="h-3 w-3" />
                  Search Papers
                </button>
              </div>
            </div>
          )}

          {/* File Upload Component */}
          <div className="hidden">
            <FileUpload onUploadComplete={handleUploadComplete} />
          </div>
        </TabsContent>

        <TabsContent value="search" className="space-y-4">
          <div className="space-y-4">
            <div className="relative flex gap-1.5">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                <Input
                  placeholder="Search academic papers..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      searchOnlinePapers(searchQuery)
                    }
                  }}
                  className="pl-9 h-9 rounded-xl border-border/40 placeholder:text-muted-foreground/60 focus-visible:ring-0 focus-visible:border-foreground/20 transition-colors"
                />
              </div>
              <button
                onClick={() => searchOnlinePapers(searchQuery)}
                disabled={isSearching}
                className="h-9 w-9 rounded-full bg-foreground/80 text-background hover:bg-foreground/70 transition-colors flex items-center justify-center shrink-0 disabled:opacity-50"
              >
                {isSearching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
              </button>
            </div>

            {searchResults.length > 0 ? (
              <div>
                {searchResults.map((paper) => (
                  <PaperItem key={paper.id} paper={paper} isSearchResult={true} />
                ))}
              </div>
            ) : searchQuery && !isSearching ? (
              <div className="flex flex-col items-center justify-center py-14 px-6 text-center">
                <div className="w-10 h-10 rounded-full border border-border/40 flex items-center justify-center mb-4">
                  <Search className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                </div>
                <h3 className="font-instrument text-base tracking-tight mb-1">No results found</h3>
                <p className="text-xs text-muted-foreground max-w-[220px] leading-relaxed">
                  Try a different search term or adjust your filters.
                </p>
              </div>
            ) : !searchQuery ? (
              <div className="flex flex-col items-center justify-center py-14 px-6 text-center">
                <div className="w-10 h-10 rounded-full border border-border/40 flex items-center justify-center mb-4">
                  <Search className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                </div>
                <h3 className="font-instrument text-base tracking-tight mb-1">Search for papers</h3>
                <p className="text-xs text-muted-foreground max-w-[240px] leading-relaxed">
                  Enter a search term to find papers from OpenAlex, CrossRef, and Semantic Scholar.
                </p>
              </div>
            ) : null}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}
