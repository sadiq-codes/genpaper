'use client'

import { useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { PageContainer } from '@/components/ui/page-container'
import { PageHeader } from '@/components/ui/page-header'
import { AlertCircle, RefreshCw } from 'lucide-react'

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('App error:', error)
  }, [error])

  return (
    <PageContainer>
      <PageHeader title="Error" />
      <div className="flex-1 flex items-center justify-center p-6">
        <Card className="w-full max-w-md">
          <CardHeader>
            <div className="flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-destructive" />
              <CardTitle>Something went wrong</CardTitle>
            </div>
            <CardDescription>
              An error occurred in the application. This has been logged and we&apos;re working on a fix.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="text-sm text-muted-foreground">
              <p><strong>Error:</strong> {error.message}</p>
              {error.digest && <p><strong>ID:</strong> {error.digest}</p>}
            </div>
            <div className="flex gap-2">
              <Button onClick={reset} className="flex-1">
                <RefreshCw className="h-4 w-4 mr-2" />
                Try again
              </Button>
              <Button variant="outline" onClick={() => window.location.href = '/projects'}>
                Go to Projects
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </PageContainer>
  )
}