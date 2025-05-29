'use client'

import { useStreamingText } from '@/hooks/useStreamingText'

interface IntroductionGeneratorProps {
  projectTitle: string
  outline?: string
}

export function IntroductionGenerator({ projectTitle, outline }: IntroductionGeneratorProps) {
  const { streamedText, isLoading, error, startStreaming, reset } = useStreamingText()

  const handleGenerateIntroduction = async () => {
    await startStreaming({
      url: '/api/research/generate/section',
      body: {
        topicTitle: projectTitle,
        sectionName: 'Introduction',
        outline: outline || undefined
      }
    })
  }

  return (
    <div>
      <h3 className="text-lg font-semibold text-gray-900 mb-2">
        Introduction Section
      </h3>
      <button 
        type="button"
        onClick={handleGenerateIntroduction}
        disabled={isLoading}
        className={`px-4 py-2 rounded-lg font-medium transition-colors mb-4 ${
          isLoading 
            ? 'bg-gray-400 cursor-not-allowed text-white' 
            : 'bg-green-600 hover:bg-green-700 text-white'
        }`}
      >
        {isLoading ? 'Generating...' : 'Generate Introduction'}
      </button>
      
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