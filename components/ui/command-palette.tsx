'use client'

import { useState, useEffect, useRef } from 'react'
import { Search, BookOpen, FileText, Command as CommandIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Badge } from '@/components/ui/badge'

interface CommandPaletteProps {
  isOpen: boolean
  onClose: () => void
  onLibrarySearch: (query: string) => void
  onProjectSearch?: (query: string) => void
}

interface CommandItem {
  id: string
  title: string
  description?: string
  icon: React.ReactNode
  action: () => void
  category: 'library' | 'projects' | 'actions'
  shortcut?: string
}

export default function CommandPalette({ 
  isOpen, 
  onClose, 
  onLibrarySearch,
  onProjectSearch 
}: CommandPaletteProps) {
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const overlayRef = useRef<HTMLDivElement>(null)

  // Command items
  const commands: CommandItem[] = [
    {
      id: 'search-library',
      title: 'Search Library',
      description: 'Search your research papers',
      icon: <BookOpen className="h-4 w-4" />,
      action: () => {
        onLibrarySearch(query)
        onClose()
      },
      category: 'library',
      shortcut: '↵'
    },
    {
      id: 'open-library',
      title: 'Open Library Drawer',
      description: 'Browse your complete library',
      icon: <BookOpen className="h-4 w-4" />,
      action: () => {
        onLibrarySearch('')
        onClose()
      },
      category: 'library'
    },
    {
      id: 'search-projects',
      title: 'Search Projects',
      description: 'Find your research projects',
      icon: <FileText className="h-4 w-4" />,
      action: () => {
        onProjectSearch?.(query)
        onClose()
      },
      category: 'projects'
    }
  ]

  // Filter commands based on query
  const filteredCommands = query
    ? commands.filter(cmd => 
        cmd.title.toLowerCase().includes(query.toLowerCase()) ||
        cmd.description?.toLowerCase().includes(query.toLowerCase())
      )
    : commands

  // Handle keyboard navigation
  useEffect(() => {
    if (!isOpen) return

    const handleKeyDown = (e: KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault()
          setSelectedIndex(prev => 
            prev < filteredCommands.length - 1 ? prev + 1 : 0
          )
          break
        case 'ArrowUp':
          e.preventDefault()
          setSelectedIndex(prev => 
            prev > 0 ? prev - 1 : filteredCommands.length - 1
          )
          break
        case 'Enter':
          e.preventDefault()
          if (filteredCommands[selectedIndex]) {
            filteredCommands[selectedIndex].action()
          }
          break
        case 'Escape':
          e.preventDefault()
          onClose()
          break
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, filteredCommands, selectedIndex, onClose])

  // Reset selection when query changes
  useEffect(() => {
    setSelectedIndex(0)
  }, [query])

  // Focus input when opening
  useEffect(() => {
    if (isOpen && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 100)
    }
  }, [isOpen])

  // Handle outside click
  useEffect(() => {
    if (!isOpen) return

    const handleClickOutside = (e: MouseEvent) => {
      if (overlayRef.current === e.target) {
        onClose()
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isOpen, onClose])

  // Reset state when closing
  useEffect(() => {
    if (!isOpen) {
      setQuery('')
      setSelectedIndex(0)
    }
  }, [isOpen])

  if (!isOpen) return null

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm animate-in fade-in-0 duration-200"
    >
      <div className="fixed left-1/2 top-1/4 -translate-x-1/2 w-full max-w-lg mx-auto">
        <div className="bg-white border border-gray-200 rounded-lg shadow-2xl animate-in zoom-in-95 duration-200">
          {/* Header */}
          <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100">
            <div className="flex items-center gap-2 text-gray-500">
              <CommandIcon className="h-4 w-4" />
              <span className="text-sm font-medium">Command Palette</span>
            </div>
            <div className="flex items-center gap-1 ml-auto">
              <kbd className="inline-flex items-center rounded border bg-gray-100 px-1.5 py-0.5 text-xs font-mono text-gray-600">
                esc
              </kbd>
              <span className="text-xs text-gray-500">to close</span>
            </div>
          </div>

          {/* Search Input */}
          <div className="relative px-4 py-3">
            <Search className="absolute left-7 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <Input
              ref={inputRef}
              placeholder="Search library, projects, or run commands..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-10 border-none shadow-none focus-visible:ring-0 text-base"
            />
          </div>

          {/* Commands */}
          <ScrollArea className="max-h-96">
            <div className="px-2 pb-2">
              {filteredCommands.length > 0 ? (
                <div className="space-y-1">
                  {filteredCommands.map((command, index) => (
                    <Button
                      key={command.id}
                      variant="ghost"
                      className={`w-full justify-start h-auto p-3 ${
                        index === selectedIndex 
                          ? 'bg-blue-50 text-blue-700 border-blue-200' 
                          : 'hover:bg-gray-50'
                      }`}
                      onClick={command.action}
                    >
                      <div className="flex items-center gap-3 w-full">
                        <div className="flex-shrink-0">
                          {command.icon}
                        </div>
                        <div className="flex-1 text-left">
                          <div className="font-medium text-sm">
                            {command.title}
                          </div>
                          {command.description && (
                            <div className="text-xs text-gray-500 mt-0.5">
                              {command.description}
                            </div>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge variant="secondary" className="text-xs">
                            {command.category}
                          </Badge>
                          {command.shortcut && (
                            <kbd className="inline-flex items-center rounded border bg-gray-100 px-1.5 py-0.5 text-xs font-mono text-gray-600">
                              {command.shortcut}
                            </kbd>
                          )}
                        </div>
                      </div>
                    </Button>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8">
                  <Search className="h-8 w-8 text-gray-300 mx-auto mb-3" />
                  <p className="text-sm text-gray-500">No commands found</p>
                  <p className="text-xs text-gray-400 mt-1">
                    Try searching for &quot;library&quot; or &quot;projects&quot;
                  </p>
                </div>
              )}
            </div>
          </ScrollArea>

          {/* Footer */}
          <div className="px-4 py-2 border-t border-gray-100 bg-gray-50 rounded-b-lg">
            <div className="flex items-center justify-between text-xs text-gray-500">
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-1">
                  <kbd className="inline-flex items-center rounded border bg-white px-1 py-0.5 font-mono">
                    ↑↓
                  </kbd>
                  <span>navigate</span>
                </div>
                <div className="flex items-center gap-1">
                  <kbd className="inline-flex items-center rounded border bg-white px-1 py-0.5 font-mono">
                    ↵
                  </kbd>
                  <span>select</span>
                </div>
              </div>
              <span>GenPaper Command Palette</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
} 