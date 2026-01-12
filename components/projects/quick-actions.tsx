"use client"

import type React from "react"

import { useRef } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { FileUp, Library } from "lucide-react"
import { toast } from "sonner"

export function QuickActions() {
  const router = useRouter()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleImportPDF = () => {
    fileInputRef.current?.click()
  }

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    if (file.type !== "application/pdf") {
      toast.error("Please select a PDF file")
      return
    }

    toast.info("PDF import coming soon", {
      description: "This will extract paper details and create a project automatically.",
    })

    if (fileInputRef.current) {
      fileInputRef.current.value = ""
    }
  }

  const handleFromLibrary = () => {
    router.push("/library")
  }

  return (
    <div className="flex items-center justify-center gap-2 flex-wrap">
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,application/pdf"
        onChange={handleFileChange}
        className="hidden"
      />

      <Button variant="outline" size="sm" className="gap-2 bg-transparent" onClick={handleImportPDF}>
        <FileUp className="h-4 w-4" />
        Import PDF
      </Button>

      <Button variant="outline" size="sm" className="gap-2 bg-transparent" onClick={handleFromLibrary}>
        <Library className="h-4 w-4" />
        From Library
      </Button>
    </div>
  )
}
