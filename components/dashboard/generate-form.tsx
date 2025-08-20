'use client'

import { useActionState } from 'react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Sparkles, AlertCircle } from 'lucide-react'
import { createProjectAction } from './actions'

const PAPER_TYPES = [
  { id: 'researchArticle', title: 'Research Article', popular: true },
  { id: 'literatureReview', title: 'Literature Review', popular: true },
  { id: 'capstoneProject', title: 'Capstone Project' },
  { id: 'mastersThesis', title: "Master's Thesis" },
  { id: 'phdDissertation', title: 'PhD Dissertation' }
]

const QUICK_PROMPTS = [
  'The impact of artificial intelligence on healthcare',
  'Climate change effects on biodiversity',
  'Social media influence on mental health',
  'Renewable energy adoption challenges',
  'Cybersecurity in remote work environments'
]

export function GenerateForm() {
  const [state, formAction, isPending] = useActionState(createProjectAction, null)

  // Server action handles redirect; no client-side loading UI here

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
        <h3 className="text-xl font-semibold">What would you like to write?</h3>
        <p className="text-muted-foreground">
          Describe your research topic and we&apos;ll generate a comprehensive academic paper
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
            Minimum 10 characters. Be specific for better results.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="paperType">Paper Type</Label>
          <Select name="paperType" defaultValue="researchArticle" disabled={isPending}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Select a paper type" />
            </SelectTrigger>
            <SelectContent>
              {PAPER_TYPES.map(type => (
                <SelectItem key={type.id} value={type.id}>
                  {type.title} {type.popular && '⭐'}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

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

         {/* No progress UI; editor owns the loading/generation experience */}

        {/* Error Display */}
        {state && !state.success && (
          <Alert variant="destructive" role="alert">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{state.error}</AlertDescription>
          </Alert>
        )}

                       {/* Success handling is now done by server action redirect - no client success state needed */}

        <Button 
          type="submit" 
          disabled={isPending}
          className="w-full"
        >
          {isPending ? (
            <>
              <div className="h-4 w-4 mr-2 animate-spin border-2 border-white border-t-transparent rounded-full" />
              Creating Project...
            </>
          ) : (
            <>
              <Sparkles className="h-4 w-4 mr-2" />
              Generate Paper
            </>
          )}
        </Button>
      </form>
    </div>
  )
}