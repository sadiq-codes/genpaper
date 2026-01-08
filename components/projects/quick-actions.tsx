'use client'

import { useRef } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { FileUp, Library } from 'lucide-react'
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

    // For now, show a toast that this feature will create a project from the PDF
    toast.info('PDF import coming soon', {
      description: 'This will extract paper details and create a project automatically.'
    })

    // Reset the input
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  const handleFromLibrary = () => {
    router.push('/library')
  }

  return (
    <div className="flex items-center justify-center gap-3">
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,application/pdf"
        onChange={handleFileChange}
        className="hidden"
      />

      <Button 
        variant="outline" 
        className="gap-2 h-10 px-4"
        onClick={handleImportPDF}
      >
        <FileUp className="h-4 w-4" />
        Import PDF
      </Button>

      <Button 
        variant="outline" 
        className="gap-2 h-10 px-4"
        onClick={handleFromLibrary}
      >
        <Library className="h-4 w-4" />
        From Library
      </Button>
    </div>
  )
}
