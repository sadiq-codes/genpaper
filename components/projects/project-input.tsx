'use client'

import { useActionState, useRef } from 'react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { ArrowRight, Loader2 } from 'lucide-react'
import { createProjectAction } from '@/components/dashboard/actions'
import { cn } from '@/lib/utils'

export function ProjectInput() {
  const [state, formAction, isPending] = useActionState(createProjectAction, null)
  const inputRef = useRef<HTMLInputElement>(null)

  return (
    <div className="w-full max-w-2xl mx-auto">
      <form action={formAction}>
        <div className="relative">
          <Input
            ref={inputRef}
            id="topic"
            name="topic"
            placeholder="Describe your research topic or paste a question..."
            disabled={isPending}
            required
            minLength={10}
            className={cn(
              "h-14 pr-14 text-base rounded-xl border-2",
              "placeholder:text-muted-foreground/60",
              "focus-visible:ring-2 focus-visible:ring-primary/20 focus-visible:border-primary",
              "transition-all duration-200"
            )}
          />
          <input type="hidden" name="paperType" value="literatureReview" />
          
          <Button 
            type="submit"
            size="icon" 
            disabled={isPending}
            className={cn(
              "absolute right-2 top-1/2 -translate-y-1/2",
              "h-10 w-10 rounded-lg",
              "transition-all duration-200"
            )}
          >
            {isPending ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <ArrowRight className="h-5 w-5" />
            )}
          </Button>
        </div>

        {/* Error message */}
        {state && !state.success && state.error && (
          <p className="mt-2 text-sm text-destructive text-center">
            {state.error}
          </p>
        )}
      </form>

      {/* Subtle helper text */}
      <p className="mt-3 text-xs text-muted-foreground/70 text-center">
        Be specific for better results. Press Enter or click the arrow to start.
      </p>
    </div>
  )
}
