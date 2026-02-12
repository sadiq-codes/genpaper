'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { SidebarTrigger } from '@/components/ui/sidebar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { 
  Upload, 
  Globe, 
  Clock, 
  Settings,
  FileText,
  FileCode,
  File,
  Lock,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { UpgradeButton } from '@/components/billing/upgrade-button'

interface EditorTopNavProps {
  onExport: (format: 'pdf' | 'docx' | 'latex') => void
  onPublish?: () => void
  onHistory?: () => void
  onSettings?: () => void
  projectTitle?: string
  projectId?: string
  onTitleChange?: (newTitle: string) => void
  saveStatus?: 'saved' | 'saving' | 'unsaved'
  /** Whether the app is currently offline */
  isOffline?: boolean
  /** When true, export buttons show a lock and are non-functional */
  exportLocked?: boolean
}

export function EditorTopNav({
  onExport,
  onPublish,
  onHistory,
  onSettings,
  projectTitle = 'Untitled Document',
  projectId,
  onTitleChange,
  saveStatus = 'saved',
  isOffline = false,
  exportLocked = false,
}: EditorTopNavProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [editValue, setEditValue] = useState(projectTitle)
  const inputRef = useRef<HTMLInputElement>(null)

  // Sync editValue when projectTitle changes externally
  useEffect(() => {
    if (!isEditing) setEditValue(projectTitle)
  }, [projectTitle, isEditing])

  const handleStartEditing = useCallback(() => {
    if (!onTitleChange) return
    setEditValue(projectTitle)
    setIsEditing(true)
    // Focus after render
    requestAnimationFrame(() => inputRef.current?.select())
  }, [projectTitle, onTitleChange])

  const handleSave = useCallback(() => {
    const trimmed = editValue.trim()
    setIsEditing(false)
    if (trimmed && trimmed !== projectTitle) {
      onTitleChange?.(trimmed)
    }
  }, [editValue, projectTitle, onTitleChange])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleSave()
    } else if (e.key === 'Escape') {
      setIsEditing(false)
      setEditValue(projectTitle)
    }
  }, [handleSave, projectTitle])

  return (
    <header className="h-12 border-b border-border/30 flex items-center justify-between px-4 bg-background">
      {/* Left: Sidebar Trigger + Title */}
      <div className="flex items-center gap-2.5 min-w-0 flex-1">
        {/* Sidebar Trigger */}
        <TooltipProvider delayDuration={300}>
          <Tooltip>
            <TooltipTrigger asChild>
              <SidebarTrigger className="h-7 w-7 rounded-full text-muted-foreground hover:text-foreground shrink-0" />
            </TooltipTrigger>
            <TooltipContent side="bottom">Navigation (B)</TooltipContent>
          </Tooltip>
        </TooltipProvider>

        <div className="h-4 w-px bg-border/40 shrink-0" />

        {/* Project Title — larger, wider */}
        <div className="flex items-center gap-2 min-w-0 flex-1">
          {isEditing ? (
            <input
              ref={inputRef}
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onBlur={handleSave}
              onKeyDown={handleKeyDown}
              className="font-instrument text-base tracking-tight text-foreground bg-transparent border-b border-foreground/20 outline-none w-full max-w-[500px] px-0 py-0"
              aria-label="Project title"
              autoFocus
            />
          ) : (
            <button
              onClick={handleStartEditing}
              className="font-instrument text-base tracking-tight text-foreground/80 truncate max-w-[500px] hover:text-foreground transition-colors cursor-text text-left"
              title="Click to rename"
            >
              {projectTitle}
            </button>
          )}

          {/* Connection status dot */}
          <TooltipProvider delayDuration={300}>
            <Tooltip>
              <TooltipTrigger asChild>
                <span
                  className={cn(
                    "inline-block h-2 w-2 shrink-0 rounded-full transition-colors",
                    isOffline
                      ? "bg-red-500"
                      : saveStatus === 'saving'
                        ? "bg-amber-400 animate-pulse"
                        : "bg-emerald-500"
                  )}
                  aria-label={isOffline ? "Offline — changes saved locally" : saveStatus === 'saving' ? "Saving…" : "All changes saved"}
                />
              </TooltipTrigger>
              <TooltipContent side="bottom" className="text-xs">
                {isOffline ? "Offline — changes saved locally" : saveStatus === 'saving' ? "Saving…" : "All changes saved"}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </div>

      {/* Right: Actions */}
      <div className="flex items-center gap-0.5">
        <TooltipProvider delayDuration={300}>
          {/* Export */}
          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-7 w-7 rounded-full text-muted-foreground hover:text-foreground" aria-label="Export">
                    <Upload className="h-3.5 w-3.5" />
                  </Button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent>Export</TooltipContent>
            </Tooltip>
            <DropdownMenuContent align="end" className="w-44">
              {exportLocked ? (
                <>
                  <DropdownMenuItem disabled className="opacity-50">
                    <Lock className="mr-2 h-3.5 w-3.5" />
                    Export as PDF
                  </DropdownMenuItem>
                  <DropdownMenuItem disabled className="opacity-50">
                    <Lock className="mr-2 h-3.5 w-3.5" />
                    Export as DOCX
                  </DropdownMenuItem>
                  <DropdownMenuItem disabled className="opacity-50">
                    <Lock className="mr-2 h-3.5 w-3.5" />
                    Export as LaTeX
                  </DropdownMenuItem>
                  <div className="px-2 py-1.5 border-t mt-1 pt-1.5">
                    <UpgradeButton label="Upgrade to Export" size="inline" />
                  </div>
                </>
              ) : (
                <>
                  <DropdownMenuItem onClick={() => onExport('pdf')}>
                    <File className="mr-2 h-3.5 w-3.5" />
                    Export as PDF
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => onExport('docx')}>
                    <FileText className="mr-2 h-3.5 w-3.5" />
                    Export as DOCX
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => onExport('latex')}>
                    <FileCode className="mr-2 h-3.5 w-3.5" />
                    Export as LaTeX
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Publish */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button 
                variant="ghost" 
                size="icon" 
                className="h-7 w-7 rounded-full text-muted-foreground hover:text-foreground"
                onClick={onPublish}
                aria-label="Publish"
              >
                <Globe className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Publish</TooltipContent>
          </Tooltip>

          {/* History */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button 
                variant="ghost" 
                size="icon" 
                className="h-7 w-7 rounded-full text-muted-foreground hover:text-foreground"
                onClick={onHistory}
                aria-label="History"
              >
                <Clock className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>History</TooltipContent>
          </Tooltip>

          {/* Settings */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button 
                variant="ghost" 
                size="icon" 
                className="h-7 w-7 rounded-full text-muted-foreground hover:text-foreground"
                onClick={onSettings}
                aria-label="Settings"
              >
                <Settings className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Settings</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
    </header>
  )
}
