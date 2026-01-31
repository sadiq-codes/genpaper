'use client'

import { useState, useMemo, useEffect } from 'react'
import { Check, ChevronsUpDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { CSL_STYLES, getStyleById, type CSLStyleCategory } from '@/lib/citations/csl-styles'

interface CitationStyleSelectorProps {
  value: string
  onValueChange: (value: string) => void
  disabled?: boolean
}

export function CitationStyleSelector({
  value,
  onValueChange,
  disabled = false,
}: CitationStyleSelectorProps) {
  const [open, setOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [remoteStyleIds, setRemoteStyleIds] = useState<string[]>([])
  const [isLoading, setIsLoading] = useState(false)

  const selectedStyle = getStyleById(value)
  const fallbackSelected = value
    ? {
        id: value,
        name: formatStyleName(value),
        shortName: undefined,
        inlineExample: undefined,
        category: 'author-date' as CSLStyleCategory
      }
    : null
  
  useEffect(() => {
    if (!open) return
    const query = searchQuery.trim()
    const controller = new AbortController()
    const timeout = setTimeout(async () => {
      try {
        setIsLoading(true)
        const url = new URL('/api/citations/styles', window.location.origin)
        if (query) {
          url.searchParams.set('q', query)
        }
        url.searchParams.set('limit', '200')
        const response = await fetch(url.toString(), { signal: controller.signal })
        if (!response.ok) throw new Error('Failed to fetch styles')
        const data = await response.json() as { styles: string[] }
        setRemoteStyleIds(data.styles || [])
      } catch (error) {
        if (!(error instanceof DOMException && error.name === 'AbortError')) {
          console.error('Failed to load CSL styles:', error)
          setRemoteStyleIds([])
        }
      } finally {
        setIsLoading(false)
      }
    }, query ? 200 : 0)
    return () => {
      controller.abort()
      clearTimeout(timeout)
    }
  }, [open, searchQuery])

  const displayStyles = useMemo(() => {
    const baseIds = remoteStyleIds.length > 0
      ? remoteStyleIds
      : CSL_STYLES.map(style => style.id)

    const styles = baseIds.map(id => {
      const known = getStyleById(id)
      return {
        id,
        name: known?.name || formatStyleName(id),
        shortName: known?.shortName,
        inlineExample: known?.inlineExample
      }
    })

    if (!value || styles.some(s => s.id === value)) return styles
    return [
      {
        id: value,
        name: formatStyleName(value),
        shortName: undefined,
        inlineExample: undefined
      },
      ...styles
    ]
  }, [remoteStyleIds, value])

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between font-normal"
          disabled={disabled}
        >
          <div className="flex items-center gap-2 truncate">
            {selectedStyle || fallbackSelected ? (
              <>
                <span className="truncate">
                  {(selectedStyle || fallbackSelected)?.shortName || (selectedStyle || fallbackSelected)?.name}
                </span>
                {(selectedStyle?.inlineExample || '') && (
                  <span className="text-muted-foreground text-xs shrink-0">
                    {selectedStyle?.inlineExample}
                  </span>
                )}
              </>
            ) : (
              <span className="text-muted-foreground">Select citation style...</span>
            )}
          </div>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[400px] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput 
            placeholder="Search citation styles..." 
            value={searchQuery}
            onValueChange={setSearchQuery}
          />
          <CommandList className="max-h-[400px]">
            <CommandEmpty>
              {isLoading ? 'Loading citation styles...' : 'No citation style found.'}
            </CommandEmpty>
            
            <CommandGroup heading={searchQuery.trim() ? 'Results' : 'All CSL Styles'}>
              {displayStyles.map((style) => (
                <StyleItem
                  key={style.id}
                  style={style}
                  isSelected={value === style.id}
                  onSelect={() => {
                    onValueChange(style.id)
                    setOpen(false)
                    setSearchQuery('')
                  }}
                />
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

interface StyleItemProps {
  style: {
    id: string
    name: string
    shortName?: string
    inlineExample?: string
  }
  isSelected: boolean
  onSelect: () => void
}

function StyleItem({ style, isSelected, onSelect }: StyleItemProps) {
  return (
    <CommandItem
      value={style.id}
      onSelect={onSelect}
      className="flex items-center justify-between gap-2"
    >
      <div className="flex items-center gap-2 min-w-0">
        <Check
          className={cn(
            "h-4 w-4 shrink-0",
            isSelected ? "opacity-100" : "opacity-0"
          )}
        />
        <div className="min-w-0">
          <div className="truncate text-sm">
            {style.name}
          </div>
          <div className="text-xs text-muted-foreground truncate">
            {style.id}
          </div>
        </div>
      </div>
      {style.inlineExample && (
        <span className="text-xs text-muted-foreground shrink-0 font-mono">
          {style.inlineExample}
        </span>
      )}
    </CommandItem>
  )
}

function formatStyleName(id: string): string {
  return id
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase())
}
