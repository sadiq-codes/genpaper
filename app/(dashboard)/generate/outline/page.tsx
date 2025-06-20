'use client'

import { useState, useEffect, useMemo, useRef } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { LoadingSpinner } from '@/components/ui/loading-spinner'
import { FileText, ArrowLeft, ArrowRight, Edit3 } from 'lucide-react'

interface OutlineSection {
  sectionKey: string
  title: string
  candidatePaperIds: string[]
  description?: string
  keyPoints?: string[]
  expectedWords?: number
}

export default function OutlineReviewPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [outline, setOutline] = useState<OutlineSection[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isGenerating, setIsGenerating] = useState(false)
  const isGeneratingOutline = useRef(false)
  
  // Get parameters from URL
  const topic = searchParams.get('topic') || ''
  const length = searchParams.get('length') || 'medium'
  const paperType = searchParams.get('paperType') || 'researchArticle'
  const useLibraryOnly = searchParams.get('useLibraryOnly') === 'true'
  const selectedPapers = useMemo(() => 
    searchParams.get('selectedPapers')?.split(',').filter(Boolean) || [], 
    [searchParams]
  )

  // Stabilize selectedPapers to prevent duplicate API calls
  const selectedPapersString = selectedPapers.join(',')

  // Generate outline on page load
  useEffect(() => {
    if (!topic) {
      router.push('/generate')
      return
    }

    // Prevent duplicate API calls
    if (isGeneratingOutline.current) {
      return
    }

    const generateOutline = async () => {
      try {
        isGeneratingOutline.current = true
        setIsLoading(true)
        
        const response = await fetch('/api/generate/outline', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            topic,
            paperType,
            selectedPapers,
            localRegion: 'global', // TODO: Add localRegion support in UI
            pageLength: length
          })
        })

        if (!response.ok) {
          const error = await response.json()
          throw new Error(error.error || 'Failed to generate outline')
        }

        const data = await response.json()
        if (data.success && data.outline) {
          setOutline(data.outline.sections)
          setIsLoading(false)
          isGeneratingOutline.current = false
          return
        } else {
          throw new Error('Invalid response format')
        }
      } catch (error) {
        console.error('Error generating outline:', error)
        // Fall back to mock data if API fails
      const mockOutlines = {
        researchArticle: [
          { sectionKey: 'introduction', title: 'Introduction', candidatePaperIds: [], description: 'Background and research questions' },
          { sectionKey: 'literatureReview', title: 'Literature Review', candidatePaperIds: [], description: 'Review of existing research' },
          { sectionKey: 'methodology', title: 'Methodology', candidatePaperIds: [], description: 'Research design and methods' },
          { sectionKey: 'results', title: 'Results', candidatePaperIds: [], description: 'Findings and data analysis' },
          { sectionKey: 'discussion', title: 'Discussion', candidatePaperIds: [], description: 'Interpretation and implications' },
          { sectionKey: 'conclusion', title: 'Conclusion', candidatePaperIds: [], description: 'Summary and future work' },
        ],
        literatureReview: [
          { sectionKey: 'introduction', title: 'Introduction & Scope', candidatePaperIds: [], description: 'Purpose and scope of the review' },
          { sectionKey: 'thematicReview1', title: 'Key Themes and Findings', candidatePaperIds: [], description: 'Major research themes' },
          { sectionKey: 'thematicReview2', title: 'Methodological Approaches', candidatePaperIds: [], description: 'Research methods comparison' },
          { sectionKey: 'gapsAndDirections', title: 'Gaps & Future Directions', candidatePaperIds: [], description: 'Identified research gaps' },
          { sectionKey: 'conclusion', title: 'Conclusion', candidatePaperIds: [], description: 'Summary and research agenda' },
        ],
        capstoneProject: [
          { sectionKey: 'introduction', title: 'Introduction & Problem Statement', candidatePaperIds: [], description: 'Project motivation and objectives' },
          { sectionKey: 'literatureReview', title: 'Literature Review', candidatePaperIds: [], description: 'Brief review of relevant work' },
          { sectionKey: 'proposedSolution', title: 'Proposed Solution', candidatePaperIds: [], description: 'Design and approach' },
          { sectionKey: 'implementation', title: 'Implementation Plan', candidatePaperIds: [], description: 'Timeline and deliverables' },
          { sectionKey: 'evaluation', title: 'Expected Outcomes', candidatePaperIds: [], description: 'Success criteria and evaluation' },
          { sectionKey: 'conclusion', title: 'Conclusion', candidatePaperIds: [], description: 'Summary and impact' },
        ],
        mastersThesis: [
          { sectionKey: 'introduction', title: 'Chapter 1: Introduction', candidatePaperIds: [], description: 'Research problem and questions' },
          { sectionKey: 'literatureReview', title: 'Chapter 2: Literature Review', candidatePaperIds: [], description: 'Comprehensive review (20-30 papers)' },
          { sectionKey: 'methodology', title: 'Chapter 3: Methodology', candidatePaperIds: [], description: 'Research design and methods' },
          { sectionKey: 'results', title: 'Chapter 4: Results', candidatePaperIds: [], description: 'Findings and analysis' },
          { sectionKey: 'discussion', title: 'Chapter 5: Discussion', candidatePaperIds: [], description: 'Interpretation and implications' },
          { sectionKey: 'conclusion', title: 'Chapter 6: Conclusions & Future Work', candidatePaperIds: [], description: 'Summary and recommendations' },
        ],
        phdDissertation: [
          { sectionKey: 'introduction', title: 'Chapter 1: Introduction', candidatePaperIds: [], description: 'Research problem and significance' },
          { sectionKey: 'literatureReview', title: 'Chapter 2: Literature Review', candidatePaperIds: [], description: 'Exhaustive review with theoretical framework' },
          { sectionKey: 'theoreticalFramework', title: 'Chapter 3: Theoretical Framework', candidatePaperIds: [], description: 'Conceptual foundation' },
          { sectionKey: 'methodology', title: 'Chapter 4: Methodology', candidatePaperIds: [], description: 'Detailed research design' },
          { sectionKey: 'results', title: 'Chapter 5: Results', candidatePaperIds: [], description: 'Comprehensive findings' },
          { sectionKey: 'discussion', title: 'Chapter 6: Discussion', candidatePaperIds: [], description: 'Analysis and theoretical connections' },
          { sectionKey: 'conclusion', title: 'Chapter 7: Conclusions & Contributions', candidatePaperIds: [], description: 'Summary and research contributions' },
        ]
      }
        setOutline(mockOutlines[paperType as keyof typeof mockOutlines] || mockOutlines.researchArticle)
      } finally {
        setIsLoading(false)
        isGeneratingOutline.current = false
      }
    }

    generateOutline()
  }, [topic, paperType, selectedPapersString, length, router])

  const handleBackToForm = () => {
    const params = new URLSearchParams({
      topic,
      length,
      paperType,
      useLibraryOnly: useLibraryOnly.toString(),
      selectedPapers: selectedPapers.join(',')
    })
    router.push(`/generate?${params.toString()}`)
  }

  const handleProceedToGeneration = () => {
    setIsGenerating(true)
    const params = new URLSearchParams({
      topic,
      length,
      paperType,
      useLibraryOnly: useLibraryOnly.toString(),
      selectedPapers: selectedPapers.join(',')
    })
    router.push(`/generate/processing?${params.toString()}`)
  }

  if (!topic) {
    return null
  }

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <FileText className="h-4 w-4" />
          <span>Outline Review</span>
        </div>
        <h1 className="text-3xl font-bold tracking-tight">Review Your Paper Outline</h1>
        <p className="text-muted-foreground">
          Review the generated outline for your {paperType.replace(/([A-Z])/g, ' $1').toLowerCase().trim()} on &ldquo;{topic}&rdquo;
        </p>
      </div>

      {isLoading ? (
        <Card>
          <CardContent className="p-8">
            <div className="flex flex-col items-center justify-center space-y-4">
              <LoadingSpinner size="lg" />
              <div className="text-center">
                <h3 className="font-medium">Generating Outline</h3>
                <p className="text-sm text-muted-foreground">
                  Creating a structured outline for your {paperType.replace(/([A-Z])/g, ' $1').toLowerCase().trim()}...
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Paper Info */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span>Paper Configuration</span>
                <Badge variant="secondary">{paperType.replace(/([A-Z])/g, ' $1').trim()}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                <div>
                  <span className="font-medium text-muted-foreground">Length:</span>
                  <p className="capitalize">{length}</p>
                </div>
                <div>
                  <span className="font-medium text-muted-foreground">Sources:</span>
                  <p>{useLibraryOnly ? 'Library Only' : 'Auto-discover'}</p>
                </div>
                <div>
                  <span className="font-medium text-muted-foreground">Selected Papers:</span>
                  <p>{selectedPapers.length} papers</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Outline Sections */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span>Paper Outline</span>
                <Button variant="outline" size="sm" disabled>
                  <Edit3 className="h-4 w-4 mr-2" />
                  Edit (Coming Soon)
                </Button>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {outline.map((section, index) => (
                  <div key={`${section.sectionKey}-${index}`} className="border rounded-lg p-4">
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex items-center gap-3">
                        <div className="flex items-center justify-center w-8 h-8 rounded-full bg-primary/10 text-primary font-medium text-sm">
                          {index + 1}
                        </div>
                        <div>
                          <h3 className="font-medium">{section.title}</h3>
                          {section.description && (
                            <p className="text-sm text-muted-foreground mt-1">
                              {section.description}
                            </p>
                          )}
                          {section.keyPoints && section.keyPoints.length > 0 && (
                            <div className="mt-2">
                              <p className="text-xs font-medium text-muted-foreground mb-1">Key Points:</p>
                              <ul className="text-xs text-muted-foreground space-y-1">
                                {section.keyPoints.map((point, idx) => (
                                  <li key={`${section.sectionKey}-point-${idx}`} className="flex items-start">
                                    <span className="mr-2">•</span>
                                    <span>{point}</span>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}
                          {section.expectedWords && (
                            <p className="text-xs text-muted-foreground mt-2">
                              Expected: ~{section.expectedWords} words
                            </p>
                          )}
                          {section.candidatePaperIds && section.candidatePaperIds.length > 0 && (
                            <p className="text-xs text-muted-foreground mt-1">
                              Papers: {section.candidatePaperIds.length}
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Action Buttons */}
          <div className="flex items-center justify-between">
            <Button variant="outline" onClick={handleBackToForm}>
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Form
            </Button>
            <Button onClick={handleProceedToGeneration} disabled={isGenerating}>
              {isGenerating ? (
                <LoadingSpinner size="sm" />
              ) : (
                <>
                  Proceed to Generation
                  <ArrowRight className="h-4 w-4 ml-2" />
                </>
              )}
            </Button>
          </div>
        </>
      )}
    </div>
  )
} 