'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { 
  Search, 
  BookOpen, 
  FolderPlus, 
  Upload, 
  Settings, 
  Command as CommandIcon,
  FolderOpen
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'

interface CommandPaletteProps {
  isOpen: boolean
  onClose: () => void
  onLibrarySearch: (query: string) => void
  onProjectSearch?: (query: string) => void
  onUploadPdf?: () => void
}

interface CommandItem {
  id: string
  title: string
  description?: string
  icon: React.ReactNode
  action: () => void
  keywords?: string[] // Additional search keywords
}

export default function CommandPalette({ 
  isOpen, 
  onClose, 
  onLibrarySearch,
  onUploadPdf
}: CommandPaletteProps) {
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const overlayRef = useRef<HTMLDivElement>(null)
  const router = useRouter()

  // Command items - clean, non-repetitive list
  const commands: CommandItem[] = [
    {
      id: 'library',
      title: 'Library',
      description: 'Search and browse your research papers',
      icon: <BookOpen className="h-4 w-4" />,
      action: () => {
        onLibrarySearch(query)
        onClose()
      },
      keywords: ['papers', 'search', 'research', 'browse']
    },
    {
      id: 'projects',
      title: 'Projects',
      description: 'View your research projects',
      icon: <FolderOpen className="h-4 w-4" />,
      action: () => {
        router.push('/projects')
        onClose()
      },
      keywords: ['research', 'documents', 'papers']
    },
    {
      id: 'new-project',
      title: 'New Project',
      description: 'Start a new research paper',
      icon: <FolderPlus className="h-4 w-4" />,
      action: () => {
        router.push('/projects?new=true')
        onClose()
      },
      keywords: ['create', 'start', 'write', 'paper']
    },
    {
      id: 'upload-pdf',
      title: 'Upload PDF',
      description: 'Add a PDF to your library',
      icon: <Upload className="h-4 w-4" />,
      action: () => {
        if (onUploadPdf) {
          onUploadPdf()
        } else {
          // Fallback: navigate to library page
          router.push('/library')
        }
        onClose()
      },
      keywords: ['import', 'add', 'paper', 'document']
    },
    {
      id: 'settings',
      title: 'Settings',
      description: 'Configure your preferences',
      icon: <Settings className="h-4 w-4" />,
      action: () => {
        router.push('/settings')
        onClose()
      },
      keywords: ['preferences', 'options', 'config']
    }
  ]

  // Filter commands based on query (search title, description, and keywords)
  const filteredCommands = query
    ? commands.filter(cmd => {
        const searchText = query.toLowerCase()
        return (
          cmd.title.toLowerCase().includes(searchText) ||
          cmd.description?.toLowerCase().includes(searchText) ||
          cmd.keywords?.some(kw => kw.toLowerCase().includes(searchText))
        )
      })
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
      <div className="fixed left-1/2 top-1/4 -translate-x-1/2 w-full max-w-lg mx-auto px-4">
        <div className="bg-card border border-border rounded-lg shadow-lg animate-in zoom-in-95 duration-200">
          {/* Header */}
          <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
            <div className="flex items-center gap-2 text-muted-foreground">
              <CommandIcon className="h-4 w-4" />
              <span className="text-sm font-medium">Quick Actions</span>
            </div>
            <div className="flex items-center gap-1 ml-auto">
              <kbd className="inline-flex items-center rounded border border-border bg-muted px-1.5 py-0.5 text-xs font-mono text-muted-foreground">
                esc
              </kbd>
            </div>
          </div>

          {/* Search Input */}
          <div className="relative px-4 py-3">
            <Search className="absolute left-7 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              ref={inputRef}
              placeholder="Type a command or search..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-10 border-none shadow-none focus-visible:ring-0 text-base"
            />
          </div>

          {/* Commands */}
          <ScrollArea className="max-h-80">
            <div className="px-2 pb-2">
              {filteredCommands.length > 0 ? (
                <div className="space-y-1">
                  {filteredCommands.map((command, index) => (
                    <Button
                      key={command.id}
                      variant="ghost"
                      className={`w-full justify-start h-auto p-3 ${
                        index === selectedIndex 
                          ? 'bg-muted text-foreground' 
                          : 'hover:bg-muted/50'
                      }`}
                      onClick={command.action}
                    >
                      <div className="flex items-center gap-3 w-full">
                        <div className="flex-shrink-0 text-muted-foreground">
                          {command.icon}
                        </div>
                        <div className="flex-1 text-left">
                          <div className="font-medium text-sm">
                            {command.title}
                          </div>
                          {command.description && (
                            <div className="text-xs text-muted-foreground mt-0.5">
                              {command.description}
                            </div>
                          )}
                        </div>
                        {index === selectedIndex && (
                          <kbd className="inline-flex items-center rounded border border-border bg-muted px-1.5 py-0.5 text-xs font-mono text-muted-foreground">
                            ↵
                          </kbd>
                        )}
                      </div>
                    </Button>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8">
                  <Search className="h-8 w-8 text-muted-foreground/50 mx-auto mb-3" />
                  <p className="text-sm text-muted-foreground">No commands found</p>
                  <p className="text-xs text-muted-foreground/70 mt-1">
                    Try &quot;library&quot;, &quot;new project&quot;, or &quot;upload&quot;
                  </p>
                </div>
              )}
            </div>
          </ScrollArea>

          {/* Footer */}
          <div className="px-4 py-2 border-t border-border bg-muted/30 rounded-b-lg">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-1">
                  <kbd className="inline-flex items-center rounded border border-border bg-card px-1 py-0.5 font-mono">
                    ↑↓
                  </kbd>
                  <span>navigate</span>
                </div>
                <div className="flex items-center gap-1">
                  <kbd className="inline-flex items-center rounded border border-border bg-card px-1 py-0.5 font-mono">
                    ↵
                  </kbd>
                  <span>select</span>
                </div>
              </div>
              <span className="text-muted-foreground/70">⌘K</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
