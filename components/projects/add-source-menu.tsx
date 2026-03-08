'use client'

import { useRef } from 'react'
import { Plus, Link2, Library, FileUp } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

interface AddSourceMenuProps {
  disabled?: boolean
  /** Callback when PDF files are selected for upload */
  onPdfUpload?: (files: FileList) => void
  /** Callback when "From Library" is clicked */
  onOpenLibrary?: () => void
}

export function AddSourceMenu({ disabled, onPdfUpload, onOpenLibrary }: AddSourceMenuProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleAddUrl = () => {
    toast.info('Add paper URL', {
      description: 'Paste a paper URL to add it to your project. Coming soon!',
    })
  }

  const handleFromLibrary = () => {
    onOpenLibrary?.()
  }

  const handleUploadPdf = () => {
    fileInputRef.current?.click()
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files || files.length === 0) return

    if (onPdfUpload) {
      onPdfUpload(files)
    } else {
      toast.info('PDF upload coming soon', {
        description: 'This will extract paper details and add them to your project.',
      })
    }

    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,application/pdf"
        multiple
        onChange={handleFileChange}
        className="hidden"
        aria-hidden="true"
      />

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            className={cn(
              'h-8 w-8 rounded-full flex items-center justify-center',
              'text-muted-foreground/60 hover:text-foreground',
              'border border-border/60 hover:border-border',
              'transition-colors cursor-pointer',
              'disabled:opacity-40'
            )}
            disabled={disabled}
            type="button"
          >
            <Plus className="h-3.5 w-3.5" />
            <span className="sr-only">Add source</span>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-52 rounded-xl p-1">
          <DropdownMenuItem onClick={handleUploadPdf} className="gap-2.5 rounded-lg py-2.5 px-3">
            <div className="w-6 h-6 rounded-full bg-foreground/5 flex items-center justify-center shrink-0">
              <FileUp className="h-3 w-3 text-foreground/60" />
            </div>
            <div className="flex flex-col">
              <span className="text-sm font-medium">Upload PDF</span>
              <span className="text-[10px] text-muted-foreground/50">From your device</span>
            </div>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={handleFromLibrary} className="gap-2.5 rounded-lg py-2.5 px-3">
            <div className="w-6 h-6 rounded-full bg-foreground/5 flex items-center justify-center shrink-0">
              <Library className="h-3 w-3 text-foreground/60" />
            </div>
            <div className="flex flex-col">
              <span className="text-sm font-medium">From Library</span>
              <span className="text-[10px] text-muted-foreground/50">Your saved papers</span>
            </div>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={handleAddUrl} className="gap-2.5 rounded-lg py-2.5 px-3">
            <div className="w-6 h-6 rounded-full bg-foreground/5 flex items-center justify-center shrink-0">
              <Link2 className="h-3 w-3 text-foreground/60" />
            </div>
            <div className="flex flex-col">
              <span className="text-sm font-medium">Paste URL</span>
              <span className="text-[10px] text-muted-foreground/50">Add by DOI or link</span>
            </div>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  )
}
