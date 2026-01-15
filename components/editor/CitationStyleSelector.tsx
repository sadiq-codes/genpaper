'use client'

import { useState, useMemo } from 'react'
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
import {
  CSL_STYLES,
  getPopularStyles,
  getStyleById,
  getCategoryDisplayName,
  type CSLStyleInfo,
  type CSLStyleCategory,
} from '@/lib/citations/csl-styles'

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

  const selectedStyle = getStyleById(value)
  
  // Group styles for display
  const groupedStyles = useMemo(() => {
    const popular = getPopularStyles()
    const popularIds = new Set(popular.map(s => s.id))
    
    // Filter by search query
    const filteredStyles = searchQuery
      ? CSL_STYLES.filter(s => 
          s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          s.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
          (s.shortName?.toLowerCase().includes(searchQuery.toLowerCase()))
        )
      : CSL_STYLES
    
    // If searching, just return flat list grouped by category
    if (searchQuery) {
      const byCategory: Record<string, CSLStyleInfo[]> = {}
      filteredStyles.forEach(style => {
        const cat = style.category
        if (!byCategory[cat]) byCategory[cat] = []
        byCategory[cat].push(style)
      })
      return { popular: [], byCategory }
    }
    
    // Otherwise show popular first, then by category
    const nonPopular = CSL_STYLES.filter(s => !popularIds.has(s.id))
    const byCategory: Record<string, CSLStyleInfo[]> = {}
    nonPopular.forEach(style => {
      const cat = style.category
      if (!byCategory[cat]) byCategory[cat] = []
      byCategory[cat].push(style)
    })
    
    return { popular, byCategory }
  }, [searchQuery])

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
            {selectedStyle ? (
              <>
                <span className="truncate">{selectedStyle.shortName || selectedStyle.name}</span>
                <span className="text-muted-foreground text-xs shrink-0">
                  {selectedStyle.inlineExample}
                </span>
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
            <CommandEmpty>No citation style found.</CommandEmpty>
            
            {/* Popular styles (when not searching) */}
            {groupedStyles.popular.length > 0 && (
              <CommandGroup heading="Popular">
                {groupedStyles.popular.map((style) => (
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
            )}
            
            {/* Styles by category */}
            {Object.entries(groupedStyles.byCategory).map(([category, styles]) => (
              styles.length > 0 && (
                <CommandGroup key={category} heading={getCategoryDisplayName(category as CSLStyleCategory)}>
                  {styles.map((style) => (
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
              )
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

interface StyleItemProps {
  style: CSLStyleInfo
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
            {style.shortName || style.name}
          </div>
          {style.shortName && (
            <div className="text-xs text-muted-foreground truncate">
              {style.name}
            </div>
          )}
        </div>
      </div>
      <span className="text-xs text-muted-foreground shrink-0 font-mono">
        {style.inlineExample}
      </span>
    </CommandItem>
  )
}
