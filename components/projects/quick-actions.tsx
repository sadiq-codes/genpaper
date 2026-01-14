'use client'

import type React from 'react'
import { useRef } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { FileUp, Library, Link2 } from 'lucide-react'
import { toast } from 'sonner'

export function QuickActions() {
  const router = useRouter()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleImportPDF = () => {
    fileInputRef.current?.click()
  }

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    if (file.type !== 'application/pdf') {
      toast.error('Please select a PDF file')
      return
    }

    toast.info('PDF import coming soon', {
      description: 'This will extract paper details and create a project automatically.',
    })

    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  const handleFromLibrary = () => {
    router.push('/library')
  }

  const handlePasteUrl = async () => {
    try {
      const text = await navigator.clipboard.readText()
      const urlPattern = /^https?:\/\/.+/i
      
      if (urlPattern.test(text)) {
        toast.info('URL detected in clipboard', {
          description: `"${text.substring(0, 50)}${text.length > 50 ? '...' : ''}" - Import coming soon!`,
        })
      } else {
        toast.info('Paste a paper URL', {
          description: 'Copy a URL to a research paper, then click this button.',
        })
      }
    } catch {
      toast.info('Paste a paper URL', {
        description: 'Copy a URL to a research paper, then click this button.',
      })
    }
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
          onChange={handleFileChange}
          className="hidden"
          aria-hidden="true"
        />

        <Button
          variant="ghost"
          size="sm"
          className="gap-2 text-muted-foreground hover:text-foreground hover:bg-muted/50"
          onClick={handleImportPDF}
        >
          <FileUp className="h-4 w-4" />
          Import PDF
        </Button>

        <Button
          variant="ghost"
          size="sm"
          className="gap-2 text-muted-foreground hover:text-foreground hover:bg-muted/50"
          onClick={handleFromLibrary}
        >
          <Library className="h-4 w-4" />
          From Library
        </Button>

        <Button
          variant="ghost"
          size="sm"
          className="gap-2 text-muted-foreground hover:text-foreground hover:bg-muted/50"
          onClick={handlePasteUrl}
        >
          <Link2 className="h-4 w-4" />
          Paste URL
        </Button>
      </div>
    </div>
  )
}
