'use client'

import { useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { AlertCircle, RefreshCw, ArrowLeft } from 'lucide-react'
import { useRouter } from 'next/navigation'

export default function ProjectError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const router = useRouter()

  useEffect(() => {
    console.error('Project error:', error)
  }, [error])

  return (
    <div className="flex items-center justify-center h-full p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <div className="flex items-center gap-2">
            <AlertCircle className="h-5 w-5 text-destructive" />
            <CardTitle>Project Error</CardTitle>
          </div>
          <CardDescription>
            Unable to load the project editor. The project may not exist or there was a loading error.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="text-sm text-muted-foreground">
            <p><strong>Error:</strong> {error.message}</p>
          </div>
          <div className="flex gap-2">
            <Button onClick={reset} variant="outline" className="flex-1">
              <RefreshCw className="h-4 w-4 mr-2" />
              Try again
            </Button>
            <Button onClick={() => router.push('/dashboard')} className="flex-1">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Dashboard
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}