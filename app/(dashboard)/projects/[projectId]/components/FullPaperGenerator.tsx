'use client'

import { useState } from 'react'
import { saveFullPaperContent } from '../actions'

interface FullPaperGeneratorProps {
  projectId: string
  projectTitle: string
  outline?: string | null
}

export function FullPaperGenerator({ projectId, projectTitle, outline }: FullPaperGeneratorProps) {
  const [isGenerating, setIsGenerating] = useState(false)
  const [streamedContent, setStreamedContent] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [generationStats, setGenerationStats] = useState<{
    toolCalls: number
    stepsCompleted: number
    currentSection: string
  }>({ toolCalls: 0, stepsCompleted: 0, currentSection: '' })

  const generateFullPaper = async () => {
    setIsGenerating(true)
    setIsStreaming(true)
    setStreamedContent('')
    setMessage(null)
    setGenerationStats({ toolCalls: 0, stepsCompleted: 0, currentSection: '' })

    console.log('Starting full paper generation...')
    console.log('Project ID:', projectId)
    console.log('Project Title:', projectTitle)
    console.log('Outline:', outline)

    try {
      const response = await fetch('/api/research/generate/full-paper', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          topicTitle: projectTitle,
          outline: outline
        })
      })

      console.log('Response status:', response.status)
      console.log('Response headers:', Object.fromEntries(response.headers.entries()))

      if (!response.ok) {
        const errorData = await response.json().catch(() => null)
        console.error('API Error:', errorData)
        throw new Error(errorData?.details || errorData?.error || 'Failed to generate full paper')
      }

      // Handle the Vercel AI SDK streaming response
      if (response.body) {
        console.log('Starting to read response stream...')
        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let content = ''
        let toolCallCount = 0
        let stepCount = 0
        let buffer = ''
        let chunkCount = 0

        try {
          while (true) {
            const { done, value } = await reader.read()
            chunkCount++
            
            if (done) {
              console.log('Stream completed. Total chunks:', chunkCount)
              console.log('Final content length:', content.length)
              setIsStreaming(false)
              break
            }
            
            // Decode the chunk and handle AI SDK data format
            buffer += decoder.decode(value, { stream: true })
            const lines = buffer.split('\n')
            
            // Keep the last incomplete line in the buffer
            buffer = lines.pop() || ''
            
            console.log(`Chunk ${chunkCount}: Processing ${lines.length} lines`)
            
            for (const line of lines) {
              // Only process lines that follow the AI SDK protocol format
              if (!line.trim().startsWith('0:')) {
                // Skip any lines that don't follow the AI SDK data stream protocol
                continue
              }
              
              // Extract the content from the AI SDK format
              try {
                const jsonStr = line.slice(2).trim() // Remove '0:' and trim
                const data = JSON.parse(jsonStr)
                
                console.log('Parsed data type:', data.type)
                
                // Handle different types of streaming data
                if (data.type === 'text-delta' && data.textDelta) {
                  content += data.textDelta
                  setStreamedContent(content)
                  console.log('Added text delta, total length:', content.length)
                  
                  // Try to detect current section being written
                  const lastLines = content.split('\n').slice(-5).join('\n')
                  const sectionMatch = lastLines.match(/##\s+([^#\n]+)/i)
                  if (sectionMatch) {
                    setGenerationStats(prev => ({
                      ...prev,
                      currentSection: sectionMatch[1].trim()
                    }))
                  }
                }
                
                // Handle tool calls
                if (data.type === 'tool-call') {
                  toolCallCount++
                  console.log('Tool call detected, count:', toolCallCount)
                  setGenerationStats(prev => ({
                    ...prev,
                    toolCalls: toolCallCount
                  }))
                }
                
                // Handle step completion
                if (data.type === 'step-finish') {
                  stepCount++
                  console.log('Step completed, count:', stepCount)
                  setGenerationStats(prev => ({
                    ...prev,
                    stepsCompleted: stepCount
                  }))
                }

                // Handle direct text content (fallback for simple text responses)
                if (typeof data === 'string') {
                  content += data
                  setStreamedContent(content)
                  console.log('Added direct text content')
                }
              } catch (parseError) {
                console.warn('JSON parse error for line:', line, parseError)
                // Silently skip malformed JSON chunks - do NOT append them to content
                // This prevents system messages and meta-commentary from being included
              }
            }
          }
        } catch (streamError) {
          console.error('Stream processing error:', streamError)
          setMessage({ 
            type: 'error', 
            text: 'Error processing stream data. Please try again.' 
          })
        }
      } else {
        console.error('No response body available')
        throw new Error('No response body received')
      }

    } catch (error) {
      console.error('Error generating full paper:', error)
      setMessage({ 
        type: 'error', 
        text: error instanceof Error ? error.message : 'Failed to generate full paper' 
      })
      setIsStreaming(false)
    } finally {
      setIsGenerating(false)
      console.log('Generation process completed')
    }
  }

  const saveFullPaper = async () => {
    if (!streamedContent) return

    setIsSaving(true)
    setMessage(null)

    try {
      // We need to call a simplified save function since we already have the content
      const supabase = await (await import('@/lib/supabase/client')).supabase
      
      // Update the project content directly
      const { error } = await supabase
        .from('projects')
        .update({ content: streamedContent })
        .eq('id', projectId)

      if (error) {
        throw error
      }

      // Also extract and save citations
      const result = await saveFullPaperContent(projectId, streamedContent)
      
      if (result.success) {
        setMessage({ type: 'success', text: 'Full research paper saved successfully!' })
        setStreamedContent('') // Clear the streamed content
        setGenerationStats({ toolCalls: 0, stepsCompleted: 0, currentSection: '' })
        // Refresh the page to show the saved content
        window.location.reload()
      } else {
        setMessage({ type: 'error', text: result.error || 'Failed to save paper' })
      }
    } catch (error) {
      console.error('Error saving full paper:', error)
      setMessage({ type: 'error', text: 'An unexpected error occurred while saving' })
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      {/* Generate Button */}
      <button
        onClick={generateFullPaper}
        disabled={isGenerating}
        className="w-full bg-purple-600 hover:bg-purple-700 text-white px-4 py-3 rounded-lg font-medium transition-colors disabled:bg-purple-400 disabled:cursor-not-allowed flex items-center justify-center space-x-2"
      >
        {isGenerating ? (
          <>
            <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent"></div>
            <span>Generating Full Paper...</span>
          </>
        ) : (
          <>
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.746 0 3.332.477 4.5 1.253v13C19.832 18.477 18.246 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
            </svg>
            <span>Generate Full Research Paper</span>
          </>
        )}
      </button>

      {/* Enhanced Progress Display */}
      {isStreaming && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-sm font-medium text-blue-800">Generation Progress</h4>
            <div className="flex items-center space-x-2 text-sm text-blue-600">
              <div className="animate-pulse w-2 h-2 bg-blue-500 rounded-full"></div>
              <span>AI is writing...</span>
            </div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
            <div className="text-blue-700">
              <span className="font-medium">Literature Searches:</span> {generationStats.toolCalls}
            </div>
            <div className="text-blue-700">
              <span className="font-medium">Steps Completed:</span> {generationStats.stepsCompleted}
            </div>
            {generationStats.currentSection && (
              <div className="text-blue-700 md:col-span-1 col-span-2">
                <span className="font-medium">Current:</span> {generationStats.currentSection}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Streaming Content Display */}
      {(isStreaming || streamedContent) && (
        <div className="border border-gray-200 rounded-lg p-4 bg-gray-50">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-sm font-medium text-gray-700">
              {isStreaming ? 'Generating Full Paper...' : 'Generated Content'}
            </h4>
            {!isStreaming && streamedContent && (
              <div className="text-sm text-gray-500">
                {Math.round(streamedContent.length / 5)} words (approx.)
              </div>
            )}
          </div>
          <div className="max-h-96 overflow-y-auto">
            <div className="text-sm text-gray-800 whitespace-pre-wrap leading-relaxed">
              {streamedContent}
              {isStreaming && <span className="animate-pulse">▋</span>}
            </div>
          </div>
        </div>
      )}

      {/* Save Button */}
      {streamedContent && !isStreaming && (
        <button
          onClick={saveFullPaper}
          disabled={isSaving}
          className="w-full bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg font-medium transition-colors disabled:bg-green-400 disabled:cursor-not-allowed flex items-center justify-center space-x-2"
        >
          {isSaving ? (
            <>
              <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent"></div>
              <span>Saving...</span>
            </>
          ) : (
            <>
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3-3m0 0l-3 3m3-3v12" />
              </svg>
              <span>Save Full Paper</span>
            </>
          )}
        </button>
      )}

      {/* Status Messages */}
      {message && (
        <div className={`p-3 rounded-lg flex items-start space-x-3 ${
          message.type === 'success' 
            ? 'bg-green-50 text-green-800 border border-green-200' 
            : 'bg-red-50 text-red-800 border border-red-200'
        }`}>
          <div className="flex-shrink-0 mt-0.5">
            {message.type === 'success' ? (
              <svg className="w-4 h-4 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            ) : (
              <svg className="w-4 h-4 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            )}
          </div>
          <span className="text-sm font-medium">{message.text}</span>
        </div>
      )}
    </div>
  )
} 