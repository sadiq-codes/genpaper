'use client'

import { useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { 
  Zap,
  Paperclip,
  FileText,
  BookOpen,
  Settings
} from 'lucide-react'
import SourceReview from '@/components/SourceReview'
import { LoadingSpinner } from '@/components/ui/loading-spinner'

interface PaperGeneratorProps {
  className?: string
}

// Helper maps for display values
const paperTypeDisplayMap = {
  researchArticle: "Research Article",
  literatureReview: "Literature Review", 
  capstoneProject: "Capstone Project",
  mastersThesis: "Master&apos;s Thesis",
  phdDissertation: "PhD Dissertation"
};

const lengthDisplayMap = {
  short: "Short",
  medium: "Medium",
  long: "Long"
};


interface GenerationConfig {
  length: 'short' | 'medium' | 'long'
  paperType: 'researchArticle' | 'literatureReview' | 'capstoneProject' | 'mastersThesis' | 'phdDissertation'
}

const defaultConfig: GenerationConfig = {
  length: 'medium',
  paperType: 'researchArticle',
}

export default function PaperGenerator({ className }: PaperGeneratorProps) {
  const router = useRouter()
  
  // Form state
  const [topic, setTopic] = useState('')
  const [selectedPapers, setSelectedPapers] = useState<string[]>([])
  const [useLibraryOnly, setUseLibraryOnly] = useState(false)
  const [isStarting, setIsStarting] = useState(false)
  const [config, setConfig] = useState<GenerationConfig>({
    length: defaultConfig.length,
    paperType: defaultConfig.paperType,
  })

  const handlePaperSelection = useCallback((paperId: string, selected: boolean) => {
    setSelectedPapers(prev => 
      selected 
        ? [...prev, paperId]
        : prev.filter(id => id !== paperId)
    )
  }, [])

  const handlePinnedPapersChange = useCallback((pinnedIds: string[]) => {
    setSelectedPapers(pinnedIds)
  }, [])

  const handleGenerate = async () => {
    if (!topic.trim()) return
    
    setIsStarting(true)
    
    const params = new URLSearchParams({
      topic: topic.trim(),
      length: config.length,
      paperType: config.paperType,
      useLibraryOnly: useLibraryOnly.toString(),
      selectedPapers: selectedPapers.join(',')
    })
    
    router.replace(`/generate/outline?${params.toString()}`)
  }

  return (
    <div className={`max-w-6xl mx-auto p-6 space-y-6 ${className}`}>
      <div className="text-center space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">Generate Research Paper</h1>
        <p className="text-muted-foreground">
          Enter your research topic and let AI create a comprehensive paper with citations
        </p>
      </div>

      {/* Paper Configuration Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Settings className="h-5 w-5" />
            Paper Configuration
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="bg-white rounded-lg border border-gray-200 dark:bg-gray-800 dark:border-gray-700 p-4">
            <Textarea
              placeholder="Describe your research topic or question..."
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              className="w-full h-24 resize-none border-0 outline-none text-sm text-gray-700 dark:text-gray-300 placeholder-gray-400 dark:placeholder-gray-500 bg-transparent"
              disabled={isStarting}
              suppressHydrationWarning={true}
            />

            <div className="flex items-center justify-between mt-4">
              <div className="flex items-center gap-1 sm:gap-2 flex-wrap">
                {/* Paper Type Dropdown */}
                <Select 
                  value={config.paperType} 
                  onValueChange={(value: keyof typeof paperTypeDisplayMap) => 
                    setConfig(prev => ({ ...prev, paperType: value }))
                  }
                  disabled={isStarting}
                >
                  <SelectTrigger 
                    className="flex items-center gap-1 text-xs sm:text-sm text-gray-600 dark:text-gray-400 border-0 hover:bg-gray-100 dark:hover:bg-gray-700 px-2 py-1 rounded"
                    suppressHydrationWarning={true}
                  >
                    <FileText className="w-3 h-3 sm:w-4 sm:h-4" />
                    <span>{config.paperType ? paperTypeDisplayMap[config.paperType] : 'Paper Type'}</span>

                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="researchArticle">
                      <div className="flex flex-col">
                        <span className="font-medium">Research Article</span>
                        <span className="text-xs text-gray-500">IMRaD format with methods, results, discussion</span>
                      </div>
                    </SelectItem>
                    <SelectItem value="literatureReview">
                      <div className="flex flex-col">
                        <span className="font-medium">Literature Review</span>
                        <span className="text-xs text-gray-500">Critical synthesis of existing research</span>
                      </div>
                    </SelectItem>
                    <SelectItem value="capstoneProject">
                      <div className="flex flex-col">
                        <span className="font-medium">Capstone Project</span>
                        <span className="text-xs text-gray-500">Final-year project proposal with implementation plan</span>
                      </div>
                    </SelectItem>
                    <SelectItem value="mastersThesis">
                      <div className="flex flex-col">
                        <span className="font-medium">Master&apos;s Thesis</span>
                        <span className="text-xs text-gray-500">Multi-chapter research with 20-30 sources</span>
                      </div>
                    </SelectItem>
                    <SelectItem value="phdDissertation">
                      <div className="flex flex-col">
                        <span className="font-medium">PhD Dissertation</span>
                        <span className="text-xs text-gray-500">Comprehensive research with theoretical framework</span>
                      </div>
                    </SelectItem>
                  </SelectContent>
                </Select>

                {/* Paper Length Dropdown */}
                <Select
                  value={config.length}
                  onValueChange={(value: keyof typeof lengthDisplayMap) =>
                    setConfig(prev => ({ ...prev, length: value }))
                  }
                  disabled={isStarting}
                >
                  <SelectTrigger 
                    className="flex items-center gap-1 text-xs sm:text-sm text-gray-600 dark:text-gray-400 border-0 hover:bg-gray-100 dark:hover:bg-gray-700 px-2 py-1 rounded focus:ring-0 focus:ring-offset-0"
                    suppressHydrationWarning={true}
                  >
                    <Zap className="w-3 h-3 sm:w-4 sm:h-4" />
                    <span>{config.length ? lengthDisplayMap[config.length] : 'Paper Length'}</span>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="short">
                      <div className="flex flex-col">
                        <span className="font-medium">Short</span>
                        <span className="text-xs text-gray-500">3-5 pages, quick overview</span>
                      </div>
                    </SelectItem>
                    <SelectItem value="medium">
                      <div className="flex flex-col">
                        <span className="font-medium">Medium</span>
                        <span className="text-xs text-gray-500">8-12 pages, comprehensive analysis</span>
                      </div>
                    </SelectItem>
                    <SelectItem value="long">
                      <div className="flex flex-col">
                        <span className="font-medium">Long</span>
                        <span className="text-xs text-gray-500">15-20 pages, in-depth research</span>
                      </div>
                    </SelectItem>
                  </SelectContent>
                </Select>

              </div>
            <div className="flex items-center gap-2">
                <Paperclip className="w-4 h-4 text-gray-400 dark:text-gray-500 cursor-pointer hover:text-gray-600 dark:hover:text-gray-300" />
                  <Button 
                onClick={handleGenerate}
                disabled={!topic.trim() || isStarting}
                className="bg-gray-600 hover:bg-gray-700 text-white px-4 sm:px-6 py-2 text-sm sm:text-base dark:bg-gray-600 dark:hover:bg-gray-600 whitespace-nowrap flex items-center gap-2"
              >
                {isStarting ? (
                  <LoadingSpinner size="sm" />
                ) : (
                  <>
                    <Zap className="w-4 h-4" />
                    Generate
                  </>
                )}
              </Button>
            </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Source Selection Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BookOpen className="h-5 w-5" />
            Source Selection
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div>
                <p className="text-sm text-muted-foreground">
                  Choose papers from your library or let AI discover new sources automatically.
                </p>
              </div>
              <div className="flex items-center space-x-2">
                <Switch
                  id="library-only"
                  checked={useLibraryOnly}
                  onCheckedChange={setUseLibraryOnly}
                  disabled={isStarting}
                  suppressHydrationWarning={true}
                />
                <Label htmlFor="library-only" className="text-sm">
                  Library Only
                  <span className="block text-xs text-muted-foreground">
                    Use only your saved papers
                  </span>
                </Label>
              </div>
            </div>
            
            <SourceReview
              selectedPaperIds={selectedPapers}
              onPaperSelectionChange={handlePaperSelection}
              onPinnedPapersChange={handlePinnedPapersChange}
            />
          </div>
        </CardContent>
      </Card>
    </div>
  )
} 