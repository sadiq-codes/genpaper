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
      className="fixed inset-0 z-50 bg-black/30 backdrop-blur-sm animate-in fade-in-0 duration-200"
    >
      <div className="fixed left-1/2 top-1/4 -translate-x-1/2 w-full max-w-lg mx-auto px-4">
        <div className="bg-background border border-border/30 rounded-2xl shadow-lg animate-in zoom-in-95 duration-200 overflow-hidden">
          {/* Search Input */}
          <div className="relative px-4 py-3 border-b border-border/20">
            <Search className="absolute left-7 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/40" aria-hidden="true" />
            <Input
              ref={inputRef}
              placeholder="Type a command or search..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-10 border-none shadow-none focus-visible:ring-0 text-base bg-transparent placeholder:text-muted-foreground/30"
            />
          </div>

          {/* Commands */}
          <ScrollArea className="max-h-80">
            <div className="p-1.5">
              {filteredCommands.length > 0 ? (
                <div className="space-y-0.5">
                  {filteredCommands.map((command, index) => (
                    <button
                      key={command.id}
                      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-colors ${
                        index === selectedIndex 
                          ? 'bg-muted/50' 
                          : 'hover:bg-muted/30'
                      }`}
                      onClick={command.action}
                    >
                      <div className="w-8 h-8 rounded-lg bg-foreground/5 flex items-center justify-center shrink-0">
                        <span className="text-muted-foreground/50">
                          {command.icon}
                        </span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-instrument text-sm tracking-tight">
                          {command.title}
                        </div>
                        {command.description && (
                          <div className="text-[11px] text-muted-foreground/40 mt-0.5">
                            {command.description}
                          </div>
                        )}
                      </div>
                      {index === selectedIndex && (
                        <kbd className="px-1.5 py-0.5 bg-foreground/5 rounded-md font-mono text-[10px] border border-border/30 text-muted-foreground/40">
                          ↵
                        </kbd>
                      )}
                    </button>
                  ))}
                </div>
              ) : (
                <div className="text-center py-10">
                  <div className="w-10 h-10 rounded-full border border-border/40 flex items-center justify-center mx-auto mb-3">
                    <Search className="h-4 w-4 text-muted-foreground/50" aria-hidden="true" />
                  </div>
                  <p className="font-instrument text-sm tracking-tight mb-1">No commands found</p>
                  <p className="text-[11px] text-muted-foreground/40">
                    Try &quot;library&quot;, &quot;new project&quot;, or &quot;upload&quot;
                  </p>
                </div>
              )}
            </div>
          </ScrollArea>

          {/* Footer */}
          <div className="px-4 py-2 border-t border-border/20">
            <div className="flex items-center justify-between text-[10px] text-muted-foreground/30">
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-1">
                  <kbd className="px-1 py-0.5 bg-foreground/5 rounded font-mono border border-border/30">↑↓</kbd>
                  <span>navigate</span>
                </div>
                <div className="flex items-center gap-1">
                  <kbd className="px-1 py-0.5 bg-foreground/5 rounded font-mono border border-border/30">↵</kbd>
                  <span>select</span>
                </div>
                <div className="flex items-center gap-1">
                  <kbd className="px-1 py-0.5 bg-foreground/5 rounded font-mono border border-border/30">esc</kbd>
                  <span>close</span>
                </div>
              </div>
              <span className="text-muted-foreground/25">⌘K</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
