'use client'

import { useRef } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Link2, Library, FileUp } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { toast } from 'sonner'

interface AddSourceMenuProps {
  disabled?: boolean
}

export function AddSourceMenu({ disabled }: AddSourceMenuProps) {
  const router = useRouter()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleAddUrl = () => {
    toast.info('Add paper URL', {
      description: 'Paste a paper URL to add it to your project. Coming soon!',
    })
  }

  const handleFromLibrary = () => {
    router.push('/library')
  }

  const handleUploadPdf = () => {
    fileInputRef.current?.click()
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    if (file.type !== 'application/pdf') {
      toast.error('Please select a PDF file')
      return
    }

    toast.info('PDF upload coming soon', {
      description: 'This will extract paper details and add them to your project.',
    })

    // Reset input
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
        onChange={handleFileChange}
        className="hidden"
        aria-hidden="true"
      />

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground hover:text-foreground"
            disabled={disabled}
            type="button"
          >
            <Plus className="h-4 w-4" />
            <span className="sr-only">Add source</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-48">
          <DropdownMenuItem onClick={handleAddUrl} className="gap-2">
            <Link2 className="h-4 w-4" />
            Add paper URL
          </DropdownMenuItem>
          <DropdownMenuItem onClick={handleFromLibrary} className="gap-2">
            <Library className="h-4 w-4" />
            Add from library
          </DropdownMenuItem>
          <DropdownMenuItem onClick={handleUploadPdf} className="gap-2">
            <FileUp className="h-4 w-4" />
            Upload PDF
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  )
}
