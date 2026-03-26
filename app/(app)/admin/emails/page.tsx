'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Loader2, Send } from 'lucide-react'

export default function AdminEmailsPage() {
  const [subject, setSubject] = useState('')
  const [bodyHtml, setBodyHtml] = useState('')
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState<{ sent: number; failed: number; total: number } | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function handleSend() {
    if (!subject.trim() || !bodyHtml.trim()) {
      setError('Subject and body are required')
      return
    }
    setSending(true)
    setError(null)
    setResult(null)

    try {
      const res = await fetch('/api/admin/emails/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject, bodyHtml }),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Send failed')
      }
      const data = await res.json()
      setResult(data)
      setSubject('')
      setBodyHtml('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Send failed')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="container max-w-2xl py-10 space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Send Email Campaign</h1>
        <p className="text-muted-foreground">Send an email to all users who haven't unsubscribed.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Compose Email</CardTitle>
          <CardDescription>Write your email in HTML. It will be wrapped in the GenPaper email layout automatically.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="subject">Subject Line</Label>
            <Input
              id="subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="e.g. New Feature: AI Chat in the Editor"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="body">Email Body (HTML)</Label>
            <textarea
              id="body"
              className="flex min-h-[200px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              value={bodyHtml}
              onChange={(e) => setBodyHtml(e.target.value)}
              placeholder='<p>Hi there,</p><p>We just launched...</p>'
            />
          </div>
          <Button onClick={handleSend} disabled={sending}>
            {sending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
            {sending ? 'Sending...' : 'Send to All Users'}
          </Button>

          {error && (
            <div className="rounded-md bg-destructive/15 p-3 text-sm text-destructive">{error}</div>
          )}
          {result && (
            <div className="rounded-md bg-green-50 dark:bg-green-950 p-3 text-sm text-green-700 dark:text-green-300">
              Sent to {result.sent} of {result.total} users.{result.failed > 0 && ` ${result.failed} failed.`}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
