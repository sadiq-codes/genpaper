'use client'

import type React from 'react'
import { useRef } from 'react'
import { Button } from '@/components/ui/button'
import { FileUp, Library, Link2 } from 'lucide-react'
import { toast } from 'sonner'

export interface QuickActionsProps {
  /** Callback when PDF files are selected for upload */
  onPdfUpload?: (files: FileList) => void
  /** Whether actions are disabled */
  disabled?: boolean
  /** Callback when "From Library" is clicked */
  onOpenLibrary?: () => void
}

export function QuickActions({ onPdfUpload, disabled, onOpenLibrary }: QuickActionsProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleImportPDF = () => {
    fileInputRef.current?.click()
  }

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files || files.length === 0) return

    if (onPdfUpload) {
      // Use the provided callback for actual upload
      onPdfUpload(files)
    } else {
      // Fallback: show coming soon message
      toast.info('PDF import coming soon', {
        description: 'This will extract paper details and create a project automatically.',
      })
    }

    // Reset input so same file can be selected again
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  const handleFromLibrary = () => {
    onOpenLibrary?.()
  }

  const handlePasteUrl = () => {
    toast.info('Coming soon', {
      description: 'URL import feature will be available soon.',
    })
  }

  return (
    <div className="space-y-3">
      {/* Separator */}
      <div className="flex items-center gap-3">
        <div className="flex-1 h-px bg-border/40" />
        <span className="text-[11px] text-muted-foreground/50">or start from</span>
        <div className="flex-1 h-px bg-border/40" />
      </div>

      {/* Action buttons */}
      <div className="flex items-center justify-center gap-1.5 flex-wrap">
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,application/pdf"
          multiple
          onChange={handleFileChange}
          className="hidden"
          aria-hidden="true"
        />

        <button
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-border/40 text-xs text-muted-foreground hover:text-foreground hover:border-border transition-colors disabled:opacity-40 cursor-pointer"
          onClick={handleImportPDF}
          disabled={disabled}
        >
          <FileUp className="h-3 w-3" />
          Import PDF
        </button>

        <button
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-border/40 text-xs text-muted-foreground hover:text-foreground hover:border-border transition-colors disabled:opacity-40 cursor-pointer"
          onClick={handleFromLibrary}
          disabled={disabled}
        >
          <Library className="h-3 w-3" />
          From Library
        </button>

        <button
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-border/40 text-xs text-muted-foreground hover:text-foreground hover:border-border transition-colors disabled:opacity-40 cursor-pointer"
          onClick={handlePasteUrl}
          disabled={disabled}
        >
          <Link2 className="h-3 w-3" />
          Paste URL
        </button>
      </div>
    </div>
  )
}
