'use client'

import { useState, useMemo, useEffect } from 'react'
import { Check, ChevronsUpDown, Search, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { CSL_STYLES, getStyleById, type CSLStyleInfo } from '@/lib/citations/csl-styles'

interface CitationStyleSelectorProps {
  value: string
  onValueChange: (value: string) => void
  disabled?: boolean
}

const POPULAR_STYLES = CSL_STYLES.filter(s => s.popular)
const OTHER_STYLES = CSL_STYLES.filter(s => !s.popular)

export function CitationStyleSelector({
  value,
  onValueChange,
  disabled = false,
}: CitationStyleSelectorProps) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [remoteResults, setRemoteResults] = useState<string[]>([])
  const [isSearchingRemote, setIsSearchingRemote] = useState(false)
  const [remoteError, setRemoteError] = useState<string | null>(null)

  const selectedStyle = getStyleById(value)

  // Local filtering of curated styles
  const filteredLocal = useMemo(() => {
    const q = search.toLowerCase().trim()
    if (!q) return { popular: POPULAR_STYLES, other: OTHER_STYLES }

    const match = (s: CSLStyleInfo) =>
      s.name.toLowerCase().includes(q) ||
      s.id.toLowerCase().includes(q) ||
      s.shortName?.toLowerCase().includes(q)

    return {
      popular: POPULAR_STYLES.filter(match),
      other: OTHER_STYLES.filter(match),
    }
  }, [search])

  // Remote search — only when user types a query and local results are few
  useEffect(() => {
    if (!open) return
    const q = search.trim()
    if (!q || q.length < 2) {
      setRemoteResults([])
      setRemoteError(null)
      return
    }

    const localTotal = filteredLocal.popular.length + filteredLocal.other.length
    // Skip remote if we already have enough local results
    if (localTotal >= 5) {
      setRemoteResults([])
      setRemoteError(null)
      return
    }

    const controller = new AbortController()
    const timeout = setTimeout(async () => {
      try {
        setIsSearchingRemote(true)
        setRemoteError(null)
        const url = new URL('/api/citations/styles', window.location.origin)
        url.searchParams.set('q', q)
        url.searchParams.set('limit', '30')
        const res = await fetch(url.toString(), { signal: controller.signal })
        if (!res.ok) throw new Error('fetch failed')
        const data = await res.json() as { styles: string[]; source?: 'github' | 'stale-cache' | 'fallback' }
        // Exclude styles already in our curated list
        const localIds = new Set(CSL_STYLES.map(s => s.id))
        setRemoteResults((data.styles || []).filter(id => !localIds.has(id)))
        if (data.source && data.source !== 'github') {
          setRemoteError('Remote style index unavailable. Showing cached/built-in results.')
        }
      } catch (err) {
        if (!(err instanceof DOMException && err.name === 'AbortError')) {
          setRemoteResults([])
          setRemoteError('Could not load remote styles. Showing built-in styles only.')
        }
      } finally {
        setIsSearchingRemote(false)
      }
    }, 300)

    return () => {
      controller.abort()
      clearTimeout(timeout)
    }
  }, [open, search, filteredLocal.popular.length, filteredLocal.other.length])

  const handleSelect = (styleId: string) => {
    onValueChange(styleId)
    setOpen(false)
    setSearch('')
    setRemoteResults([])
  }

  const localTotal = filteredLocal.popular.length + filteredLocal.other.length
  const hasResults = localTotal > 0 || remoteResults.length > 0

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (!o) {
          setSearch('')
          setRemoteResults([])
          setRemoteError(null)
        }
      }}
    >
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between font-normal"
          disabled={disabled}
        >
          <div className="flex items-center gap-2 truncate">
            {selectedStyle ? (
              <>
                <span className="truncate">{selectedStyle.shortName || selectedStyle.name}</span>
                <span className="text-muted-foreground text-xs shrink-0">{selectedStyle.inlineExample}</span>
              </>
            ) : value ? (
              <span className="truncate">{formatStyleName(value)}</span>
            ) : (
              <span className="text-muted-foreground">Select citation style...</span>
            )}
          </div>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[380px] p-0" align="start">
        {/* Search input */}
        <div className="flex items-center gap-2 px-3 py-2 border-b">
          <Search className="h-4 w-4 text-muted-foreground shrink-0" />
          <Input
            placeholder="Search citation styles..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 border-0 p-0 shadow-none focus-visible:ring-0"
            autoFocus
          />
          {isSearchingRemote && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground shrink-0" />}
        </div>

        <ScrollArea className="h-[300px]">
          {remoteError && (
            <div className="px-3 pt-2 text-[11px] text-muted-foreground">
              {remoteError}
            </div>
          )}
          {!hasResults && !isSearchingRemote ? (
            <div className="py-6 text-center text-sm text-muted-foreground">
              No styles found.
            </div>
          ) : (
            <div className="p-1">
              {/* Popular styles */}
              {filteredLocal.popular.length > 0 && (
                <>
                  <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">Popular</div>
                  {filteredLocal.popular.map((style) => (
                    <StyleRow key={style.id} style={style} isSelected={value === style.id} onSelect={() => handleSelect(style.id)} />
                  ))}
                </>
              )}

              {/* Other curated styles */}
              {filteredLocal.other.length > 0 && (
                <>
                  <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground mt-1">More Styles</div>
                  {filteredLocal.other.map((style) => (
                    <StyleRow key={style.id} style={style} isSelected={value === style.id} onSelect={() => handleSelect(style.id)} />
                  ))}
                </>
              )}

              {/* Remote results */}
              {remoteResults.length > 0 && (
                <>
                  <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground mt-1">From CSL Repository</div>
                  {remoteResults.map((id) => (
                    <button
                      key={id}
                      onClick={() => handleSelect(id)}
                      className={cn(
                        "w-full flex items-center gap-2 rounded-sm px-2 py-1.5 text-sm cursor-pointer",
                        "hover:bg-accent hover:text-accent-foreground",
                        value === id && "bg-accent"
                      )}
                    >
                      <Check className={cn("h-3.5 w-3.5 shrink-0", value === id ? "opacity-100" : "opacity-0")} />
                      <span className="truncate flex-1 text-left">{formatStyleName(id)}</span>
                    </button>
                  ))}
                </>
              )}
            </div>
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  )
}

function StyleRow({ style, isSelected, onSelect }: {
  style: CSLStyleInfo
  isSelected: boolean
  onSelect: () => void
}) {
  return (
    <button
      onClick={onSelect}
      className={cn(
        "w-full flex items-center gap-2 rounded-sm px-2 py-1.5 text-sm cursor-pointer",
        "hover:bg-accent hover:text-accent-foreground",
        isSelected && "bg-accent"
      )}
    >
      <Check className={cn("h-3.5 w-3.5 shrink-0", isSelected ? "opacity-100" : "opacity-0")} />
      <span className="truncate flex-1 text-left">{style.shortName || style.name}</span>
      <span className="text-xs text-muted-foreground shrink-0">{style.inlineExample}</span>
    </button>
  )
}

function formatStyleName(id: string): string {
  return id.replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}
