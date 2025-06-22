'use client'

import { useState, useEffect, useRef } from 'react'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { WizardState } from '../GenerationWizard'
import { Lightbulb, Target, BookOpen } from 'lucide-react'

interface TopicInputStepProps {
  state: WizardState
  onUpdate: (updates: Partial<WizardState>) => void
}

const EXAMPLE_TOPICS = [
  "The impact of artificial intelligence on modern healthcare systems",
  "Climate change effects on marine biodiversity in tropical regions", 
  "Blockchain technology applications in supply chain management",
  "The role of social media in political discourse and democracy",
  "Sustainable energy alternatives for developing countries"
]

export default function TopicInputStep({ state, onUpdate }: TopicInputStepProps) {
  const [wordCount, setWordCount] = useState(state.topic.split(/\s+/).filter(Boolean).length)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const words = state.topic.split(/\s+/).filter(Boolean)
    setWordCount(words.length)
  }, [state.topic])

  // Focus the textarea on mount (client-side only)
  useEffect(() => {
    if (textareaRef.current && !state.topic) {
      textareaRef.current.focus()
    }
  }, [state.topic])

  const handleTopicChange = (value: string) => {
    onUpdate({ topic: value })
  }

  const handleExampleClick = (example: string) => {
    onUpdate({ topic: example })
  }

  const isValid = state.topic.trim().length > 10
  const minWordsReached = wordCount >= 5

  return (
    <div className="space-y-4">
      {/* Topic Input with inline feedback */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label htmlFor="topic" className="text-sm font-medium">
            Research Topic or Question
          </Label>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>{wordCount} words</span>
            {minWordsReached ? (
              <Badge variant="default" className="bg-green-100 text-green-700 text-xs h-5">
                <Target className="h-2.5 w-2.5 mr-1" />
                Good
              </Badge>
            ) : (
              <Badge variant="secondary" className="text-orange-600 text-xs h-5">
                Add more
              </Badge>
            )}
          </div>
        </div>
        
        <Textarea
          id="topic"
          placeholder="Describe your research topic, question, or area of interest. Be as specific as possible..."
          value={state.topic}
          onChange={(e) => handleTopicChange(e.target.value)}
          className="min-h-[100px] resize-none text-sm"
          ref={textareaRef}
        />

        {/* Inline feedback */}
        {!isValid && state.topic.length > 0 && (
          <div className="flex items-start gap-2 p-2 bg-orange-50 border border-orange-200 rounded text-xs">
            <Lightbulb className="h-3 w-3 text-orange-600 mt-0.5 flex-shrink-0" />
            <span className="text-orange-700">
              Be more specific - include aspects, time periods, or populations you want to research
            </span>
          </div>
        )}
        
        {isValid && (
          <div className="flex items-center gap-2 p-2 bg-green-50 border border-green-200 rounded text-xs">
            <Target className="h-3 w-3 text-green-600" />
            <span className="text-green-700 font-medium">
              Great! Your topic is well-defined and ready for research.
            </span>
          </div>
        )}
      </div>

      {/* Collapsible Examples and Tips */}
      <div className="grid md:grid-cols-2 gap-3">
        {/* Example Topics - only show if no topic */}
        {!state.topic && (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <BookOpen className="h-3 w-3 text-muted-foreground" />
              <Label className="text-xs font-medium text-muted-foreground">
                Example Topics
              </Label>
            </div>
            <div className="space-y-1 max-h-32 overflow-y-auto">
              {EXAMPLE_TOPICS.slice(0, 3).map((example, index) => (
                <button
                  key={index}
                  onClick={() => handleExampleClick(example)}
                  className="text-left p-2 rounded border border-dashed border-muted-foreground/30 hover:border-primary hover:bg-primary/5 transition-colors text-xs text-muted-foreground hover:text-foreground w-full"
                >
                  {example}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Tips - always visible but compact */}
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Lightbulb className="h-3 w-3 text-blue-600" />
            <Label className="text-xs font-medium text-blue-800">
              Quick Tips
            </Label>
          </div>
          <div className="text-xs text-blue-700 space-y-1">
            <div>• Be specific about what you want to investigate</div>
            <div>• Include relevant keywords and terminology</div>
            <div>• Consider appropriate scope for your research</div>
          </div>
        </div>
      </div>
    </div>
  )
} 