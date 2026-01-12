"use client"

import { useState, useMemo } from "react"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Badge } from "@/components/ui/badge"
import { Card } from "@/components/ui/card"
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
  Quote,
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
      <Card className={cn("p-4", isRemoving && "opacity-50")}>
        <div className="flex items-start gap-4">
          <div className="flex-shrink-0 mt-1">
            <BookOpen className="h-5 w-5 text-muted-foreground" />
          </div>

          <div className="flex-1 min-w-0 space-y-2">
            <div className="flex items-start justify-between gap-3">
              <h3 className="text-sm font-medium leading-snug">{actualPaper.title}</h3>
              
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-8 w-8 flex-shrink-0" disabled={isProcessing || isRemoving}>
                    {isProcessing ? <Loader2 className="h-4 w-4 animate-spin" /> : <MoreVertical className="h-4 w-4" />}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {isSearchResult ? (
                    <DropdownMenuItem onClick={() => addPaperToLibrary(paperId)} disabled={isProcessing}>
                      <Plus className="h-4 w-4 mr-2" />
                      Add to Library
                    </DropdownMenuItem>
                  ) : (
                    <>
                      <DropdownMenuItem onClick={() => handleNotesEdit(libraryPaper!)}>
                        <Edit3 className="h-4 w-4 mr-2" />
                        Edit Notes
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => removePaperFromLibrary(paperId)}
                        disabled={isRemoving}
                        className="text-destructive"
                      >
                        <Trash2 className="h-4 w-4 mr-2" />
                        Remove
                      </DropdownMenuItem>
                    </>
                  )}
                  {actualPaper.url && (
                    <DropdownMenuItem onClick={() => window.open(actualPaper.url, "_blank")}>
                      <ExternalLink className="h-4 w-4 mr-2" />
                      View Paper
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            <p className="text-sm text-muted-foreground">
              {actualPaper.authors
                ?.map((a) => (typeof a === "string" ? a : a.name))
                .slice(0, 2)
                .join(", ") || "Unknown authors"}
            </p>

            <div className="flex flex-wrap gap-2">
              {actualPaper.venue && (
                <Badge variant="secondary" className="text-xs h-6">
                  {actualPaper.venue}
                </Badge>
              )}
              {actualPaper.publication_date && (
                <Badge variant="outline" className="text-xs h-6">
                  {new Date(actualPaper.publication_date).getFullYear()}
                </Badge>
              )}
              {actualPaper.citation_count && (
                <Badge variant="outline" className="text-xs h-6 flex items-center gap-1">
                  <Quote className="h-3 w-3" />
                  {actualPaper.citation_count}
                </Badge>
              )}
            </div>
          </div>
        </div>
      </Card>
    )
  }

  return (
    <div className={cn("w-full space-y-6", className)}>
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "library" | "search")} className="w-full">
        <div className="flex items-center justify-between gap-4 pb-4 border-b">
          <TabsList>
            <TabsTrigger value="library">My Library</TabsTrigger>
            <TabsTrigger value="search">Search Papers</TabsTrigger>
          </TabsList>

          {activeTab === "library" && (
            <Button variant="outline" size="sm" asChild>
              <label className="cursor-pointer flex items-center gap-2">
                <Upload className="h-4 w-4" />
                Upload PDF
              </label>
            </Button>
          )}
        </div>

        <TabsContent value="library" className="space-y-4">
          {/* Search and Filter Controls */}
          <div className="flex gap-3 items-end">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by title or notes..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 pr-9"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery("")}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>

            <Select value={sortBy} onValueChange={(v) => setSortBy(v as "added_at" | "title")}>
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="added_at">Recently Added</SelectItem>
                <SelectItem value="title">Title (A-Z)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Library Papers List */}
          {loading ? (
            <div className="space-y-2">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="h-20 bg-muted rounded-lg animate-pulse" />
              ))}
            </div>
          ) : sortedLibraryPapers.length > 0 ? (
            <div className="space-y-3">
              {sortedLibraryPapers.map((paper) => (
                <PaperItem key={paper.id} paper={paper} isSearchResult={false} />
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
              <div className="rounded-full bg-muted p-3 mb-4">
                <BookOpen className="h-6 w-6 text-muted-foreground" />
              </div>
              <h3 className="text-lg font-semibold mb-2">No papers yet</h3>
              <p className="text-sm text-muted-foreground mb-6 max-w-md">
                Start by uploading a PDF or searching for papers to add to your library.
              </p>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" asChild>
                  <label className="cursor-pointer flex items-center gap-2">
                    <Upload className="h-4 w-4" />
                    Upload PDF
                  </label>
                </Button>
                <Button size="sm" onClick={() => setActiveTab("search")}>
                  <Search className="h-4 w-4 mr-2" />
                  Search Papers
                </Button>
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
            <div className="relative flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search academic papers..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      searchOnlinePapers(searchQuery)
                    }
                  }}
                  className="pl-9"
                />
              </div>
              <Button onClick={() => searchOnlinePapers(searchQuery)} disabled={isSearching}>
                {isSearching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              </Button>
            </div>

            {searchResults.length > 0 ? (
              <div className="space-y-3">
                {searchResults.map((paper) => (
                  <PaperItem key={paper.id} paper={paper} isSearchResult={true} />
                ))}
              </div>
            ) : searchQuery && !isSearching ? (
              <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
                <div className="rounded-full bg-muted p-3 mb-4">
                  <Search className="h-6 w-6 text-muted-foreground" />
                </div>
                <h3 className="text-lg font-semibold mb-2">No results found</h3>
                <p className="text-sm text-muted-foreground max-w-md">
                  Try a different search term or adjust your filters.
                </p>
              </div>
            ) : !searchQuery ? (
              <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
                <div className="rounded-full bg-muted p-3 mb-4">
                  <Search className="h-6 w-6 text-muted-foreground" />
                </div>
                <h3 className="text-lg font-semibold mb-2">Search for papers</h3>
                <p className="text-sm text-muted-foreground max-w-md">
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
