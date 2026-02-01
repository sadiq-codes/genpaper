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
    <div className="space-y-4">
      {/* Separator with text */}
      <div className="flex items-center gap-4">
        <div className="flex-1 h-px bg-border" />
        <span className="text-xs text-muted-foreground font-medium">or start from</span>
        <div className="flex-1 h-px bg-border" />
      </div>

      {/* Action buttons */}
      <div className="flex items-center justify-center gap-2 flex-wrap">
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,application/pdf"
          multiple
          onChange={handleFileChange}
          className="hidden"
          aria-hidden="true"
        />

        <Button
          variant="ghost"
          size="sm"
          className="gap-2 text-muted-foreground hover:text-foreground hover:bg-muted/50"
          onClick={handleImportPDF}
          disabled={disabled}
        >
          <FileUp className="h-4 w-4" />
          Import PDF
        </Button>

        <Button
          variant="ghost"
          size="sm"
          className="gap-2 text-muted-foreground hover:text-foreground hover:bg-muted/50"
          onClick={handleFromLibrary}
          disabled={disabled}
        >
          <Library className="h-4 w-4" />
          From Library
        </Button>

        <Button
          variant="ghost"
          size="sm"
          className="gap-2 text-muted-foreground hover:text-foreground hover:bg-muted/50"
          onClick={handlePasteUrl}
          disabled={disabled}
        >
          <Link2 className="h-4 w-4" />
          Paste URL
        </Button>
      </div>
    </div>
  )
}
