"use client"
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { PageContainer } from '@/components/ui/page-container'
import { PageHeader } from '@/components/ui/page-header'
import { FileQuestion, ArrowLeft } from 'lucide-react'
import Link from 'next/link'

export default function AppNotFound() {
  return (
    <PageContainer>
      <PageHeader title="Not Found" />
      <div className="flex-1 flex items-center justify-center p-6">
        <Card className="w-full max-w-md">
          <CardHeader>
            <div className="flex items-center gap-2">
              <FileQuestion className="h-5 w-5 text-muted-foreground" />
              <CardTitle>Page Not Found</CardTitle>
            </div>
            <CardDescription>
              The page you&apos;re looking for doesn&apos;t exist or may have been moved.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild className="w-full">
              <Link href="/projects">
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back to Projects
              </Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </PageContainer>
  )
}