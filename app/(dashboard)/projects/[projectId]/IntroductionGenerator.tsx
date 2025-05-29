'use client'

import { useStreamingText } from '@/hooks/useStreamingText'
import { saveSectionContent, extractAndSaveCitations } from './actions'
import { useState } from 'react'

interface IntroductionGeneratorProps {
  projectId: string
  projectTitle: string
  outline?: string
}

export function IntroductionGenerator({ projectId, projectTitle, outline }: IntroductionGeneratorProps) {
  const { streamedText, isLoading, error, isComplete, startStreaming, reset } = useStreamingText()
  const [isSaving, setIsSaving] = useState(false)
  const [saveSuccess, setSaveSuccess] = useState(false)

  const handleGenerateIntroduction = async () => {
    setSaveSuccess(false) // Reset save success state when generating new content
    await startStreaming({
      url: '/api/research/generate/section',
      body: {
        topicTitle: projectTitle,
        sectionName: 'Introduction',
        outline: outline || undefined
      }
    })
  }

  const handleSaveIntroduction = async () => {
    if (!streamedText.trim()) return

    setIsSaving(true)
    try {
      const result = await saveSectionContent(projectId, streamedText)
      
      if (result.error) {
        console.error('Failed to save introduction:', result.error)
        // Could add error UI here
      } else {
        setSaveSuccess(true)
        
        // Automatically extract and save citations from the saved content
        try {
          const citationResult = await extractAndSaveCitations(projectId, streamedText)
          if (citationResult.error) {
            console.error('Failed to extract citations:', citationResult.error)
          } else {
            console.log(`Extracted ${citationResult.count} citations:`, citationResult.citations)
          }
        } catch (citationError) {
          console.error('Error extracting citations:', citationError)
        }
        
        // Optionally reset the streamed text after saving
        // reset()
      }
    } catch (error) {
      console.error('Error saving introduction:', error)
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div>
      <h3 className="text-lg font-semibold text-gray-900 mb-2">
        Introduction Section
      </h3>
      
      <div className="flex gap-2 mb-4">
        <button 
          type="button"
          onClick={handleGenerateIntroduction}
          disabled={isLoading}
          className={`px-4 py-2 rounded-lg font-medium transition-colors ${
            isLoading 
              ? 'bg-gray-400 cursor-not-allowed text-white' 
              : 'bg-green-600 hover:bg-green-700 text-white'
          }`}
        >
          {isLoading ? 'Generating...' : 'Generate Introduction'}
        </button>

        {isComplete && streamedText.trim() && (
          <button 
            type="button"
            onClick={handleSaveIntroduction}
            disabled={isSaving}
            className={`px-4 py-2 rounded-lg font-medium transition-colors ${
              isSaving 
                ? 'bg-gray-400 cursor-not-allowed text-white'
                : saveSuccess
                ? 'bg-green-600 text-white'
                : 'bg-blue-600 hover:bg-blue-700 text-white'
            }`}
          >
            {isSaving ? 'Saving...' : saveSuccess ? 'Saved!' : 'Save Introduction'}
          </button>
        )}
      </div>
      
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4">
          <p className="text-sm text-red-600">Error: {error}</p>
          <button 
            onClick={reset}
            className="text-sm text-red-700 underline mt-1"
          >
            Try again
          </button>
        </div>
      )}

      {saveSuccess && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-3 mb-4">
          <p className="text-sm text-green-600">Introduction saved successfully!</p>
        </div>
      )}
      
      <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 min-h-[200px]">
        <h4 className="text-sm font-medium text-gray-700 mb-2">Introduction Content:</h4>
        <div className="text-sm text-gray-800 whitespace-pre-wrap font-sans">
          {streamedText || (
            <span className="text-gray-400 italic">
              Click &quot;Generate Introduction&quot; to create content for this section...
            </span>
          )}
        </div>
      </div>
    </div>
  )
} 