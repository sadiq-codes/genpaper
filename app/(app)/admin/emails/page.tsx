'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Loader2, Send } from 'lucide-react'

interface Campaign {
  id: string
  subject: string
  recipient_count: number
  sent_at: string
}

export default function AdminEmailsPage() {
  const [subject, setSubject] = useState('')
  const [bodyHtml, setBodyHtml] = useState('')
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState<{ sent: number; failed: number; total: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [recipientCount, setRecipientCount] = useState(0)
  const [loadingHistory, setLoadingHistory] = useState(true)

  useEffect(() => {
    fetchHistory()
  }, [])

  async function fetchHistory() {
    setLoadingHistory(true)
    try {
      const res = await fetch('/api/admin/emails/send')
      if (res.ok) {
        const data = await res.json()
        setCampaigns(data.campaigns || [])
        setRecipientCount(data.recipientCount || 0)
      }
    } catch { /* ignore */ } finally {
      setLoadingHistory(false)
    }
  }

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
      fetchHistory()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Send failed')
    } finally {
      setSending(false)
    }
  }

  const canSend = subject.trim().length > 0 && bodyHtml.trim().length > 0

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Email Campaigns</h1>
        <p className="text-sm text-muted-foreground">Send emails to all users who haven't unsubscribed.</p>
      </div>

      <div className="grid md:grid-cols-5 gap-6">
        {/* Compose */}
        <Card className="md:col-span-3">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Compose</CardTitle>
            <CardDescription>HTML body is wrapped in the GenPaper email layout automatically.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="subject">Subject</Label>
              <Input
                id="subject"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="e.g. New Feature: AI Chat in the Editor"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="body">Body (HTML)</Label>
              <Textarea
                id="body"
                className="min-h-[180px] font-mono text-sm"
                value={bodyHtml}
                onChange={(e) => setBodyHtml(e.target.value)}
                placeholder='<p>Hi there,</p><p>We just launched...</p>'
              />
            </div>

            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">
                {recipientCount} eligible recipient{recipientCount !== 1 ? 's' : ''}
              </p>

              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button disabled={!canSend || sending}>
                    {sending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
                    {sending ? 'Sending...' : 'Send Campaign'}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Send this campaign?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This will email <strong>{recipientCount}</strong> users with the subject &ldquo;{subject}&rdquo;. This cannot be undone.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={handleSend}>Send Now</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>

            {error && (
              <div className="rounded-md bg-destructive/15 p-3 text-sm text-destructive">{error}</div>
            )}
            {result && (
              <div className="rounded-md bg-green-50 dark:bg-green-950/50 border border-green-200 dark:border-green-900 p-3 text-sm text-green-700 dark:text-green-300">
                Sent to {result.sent} of {result.total} users.{result.failed > 0 && ` ${result.failed} failed.`}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Campaign history */}
        <Card className="md:col-span-2">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Past Campaigns</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {loadingHistory ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : campaigns.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">No campaigns sent yet.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Subject</TableHead>
                    <TableHead className="text-right w-16">To</TableHead>
                    <TableHead className="text-right w-[100px]">Date</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {campaigns.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell className="font-medium truncate max-w-[180px]">{c.subject}</TableCell>
                      <TableCell className="text-right text-muted-foreground">{c.recipient_count}</TableCell>
                      <TableCell className="text-right text-xs text-muted-foreground whitespace-nowrap">
                        {new Date(c.sent_at).toLocaleDateString()}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
