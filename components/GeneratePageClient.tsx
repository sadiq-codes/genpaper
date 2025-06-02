"use client"

import PaperGenerator from '@/components/PaperGenerator'

export default function GeneratePageClient() {
  const handleGenerationComplete = (projectId: string) => {
    // Handle navigation or other logic here
    console.log('Generation complete for project:', projectId)
  }

  return (
    <PaperGenerator onGenerationComplete={handleGenerationComplete} />
  )
} 