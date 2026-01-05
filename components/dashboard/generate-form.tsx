'use client'

import { useActionState } from 'react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Search, AlertCircle } from 'lucide-react'
import { createProjectAction } from './actions'

const QUICK_PROMPTS = [
  'Machine learning applications in healthcare diagnostics',
  'Climate change impact on marine ecosystems',
  'Social media effects on adolescent mental health',
  'Renewable energy storage technologies',
  'Remote work productivity and employee wellbeing'
]

export function GenerateForm() {
  const [state, formAction, isPending] = useActionState(createProjectAction, null)

  const handleQuickPrompt = (prompt: string) => {
    const textarea = document.getElementById('topic') as HTMLTextAreaElement
    if (textarea) {
      textarea.value = `${prompt} `
      textarea.focus()
      textarea.setSelectionRange(textarea.value.length, textarea.value.length)
    }
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="text-center space-y-2">
        <h3 className="text-xl font-semibold">What would you like to research?</h3>
        <p className="text-muted-foreground">
          Enter your research topic and we&apos;ll help you discover papers, extract key findings, and identify research gaps.
        </p>
      </div>

      <form action={formAction} className="space-y-6">
        <div className="space-y-2">
          <Label htmlFor="topic">Research Topic</Label>
          <Textarea
            id="topic"
            name="topic"
            placeholder="Describe your research topic, question, or area of interest..."
            rows={3}
            required
            disabled={isPending}
            className="resize-none"
          />
          <p className="text-sm text-muted-foreground">
            Be specific for better results. Example: &quot;The effectiveness of cognitive behavioral therapy for treating anxiety disorders in adolescents&quot;
          </p>
        </div>

        {/* Hidden field for paper type - default to research analysis */}
        <input type="hidden" name="paperType" value="literatureReview" />

        {/* Quick Prompts */}
        <div className="space-y-2">
          <Label>Quick starts</Label>
          <div className="flex flex-wrap gap-2">
            {QUICK_PROMPTS.map(prompt => (
              <button
                key={prompt}
                type="button"
                onClick={() => handleQuickPrompt(prompt)}
                disabled={isPending}
                className="px-3 py-1 bg-muted hover:bg-muted/80 rounded-full text-sm transition-colors disabled:opacity-50"
              >
                {prompt}
              </button>
            ))}
          </div>
        </div>

        {/* Error Display */}
        {state && !state.success && (
          <Alert variant="destructive" role="alert">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{state.error}</AlertDescription>
          </Alert>
        )}

        <Button 
          type="submit" 
          disabled={isPending}
          className="w-full"
        >
          {isPending ? (
            <>
              <div className="h-4 w-4 mr-2 animate-spin border-2 border-white border-t-transparent rounded-full" />
              Creating Research Project...
            </>
          ) : (
            <>
              <Search className="h-4 w-4 mr-2" />
              Start Research
            </>
          )}
        </Button>
      </form>
      
      <div className="text-center text-sm text-muted-foreground">
        <p>After creating your project, you can:</p>
        <ul className="mt-2 space-y-1">
          <li>• Search and add relevant papers</li>
          <li>• Extract key claims and findings</li>
          <li>• Identify research gaps and contradictions</li>
          <li>• Generate a literature synthesis</li>
        </ul>
      </div>
    </div>
  )
}
