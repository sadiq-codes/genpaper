'use client'

import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
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
import { Loader2, Mail, RefreshCw, Send, ShieldCheck, Users } from 'lucide-react'
import { SectionEmptyState, SectionErrorState, SectionLoadingState } from '@/components/ui/async-state'

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
  const [historyError, setHistoryError] = useState<string | null>(null)

  useEffect(() => {
    fetchHistory()
  }, [])

  async function fetchHistory() {
    setLoadingHistory(true)
    setHistoryError(null)
    try {
      const res = await fetch('/api/admin/emails/send')
      if (!res.ok) {
        throw new Error('Failed to load campaign history')
      }

      const data = await res.json()
      setCampaigns(data.campaigns || [])
      setRecipientCount(data.recipientCount || 0)
    } catch (err) {
      setHistoryError(err instanceof Error ? err.message : 'Failed to load campaign history')
    } finally {
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

  const plainBody = useMemo(
    () => bodyHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
    [bodyHtml]
  )
  const canSend = subject.trim().length > 0 && bodyHtml.trim().length > 0 && !loadingHistory && !historyError

  return (
    <div className="space-y-6">
      <div className="rounded-3xl border border-border/60 bg-card/70 p-5 shadow-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-2">
            <Badge variant="outline" className="rounded-full px-3 py-1 text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
              Broadcast Email
            </Badge>
            <div>
              <h1 className="font-instrument text-3xl tracking-tight">Email Campaigns</h1>
              <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                Compose and review outbound product emails before sending them to subscribed users.
              </p>
            </div>
          </div>
          <div className="rounded-2xl border border-border/50 bg-background/80 px-4 py-3">
            <p className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Audience</p>
            <p className="mt-1 text-sm font-medium">
              {loadingHistory ? 'Loading recipients...' : historyError ? 'Unavailable' : `${recipientCount} eligible users`}
            </p>
          </div>
        </div>
      </div>

      <div className="grid md:grid-cols-5 gap-6">
        {/* Compose */}
        <Card className="md:col-span-3">
          <CardHeader className="pb-4">
            <CardTitle className="font-instrument text-xl tracking-tight">Compose</CardTitle>
            <CardDescription>HTML content is wrapped in the GenPaper campaign layout automatically.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
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

            <div className="grid gap-3 rounded-2xl border border-border/60 bg-muted/20 p-4 sm:grid-cols-3">
              <ReviewStat
                icon={Users}
                label="Recipients"
                value={loadingHistory ? 'Loading...' : historyError ? 'Unavailable' : recipientCount}
                detail={historyError ? 'Retry history load before sending' : 'Subscribed users only'}
              />
              <ReviewStat
                icon={Mail}
                label="Subject"
                value={subject.trim() ? 'Ready' : 'Missing'}
                detail={subject.trim() || 'Add a clear campaign title'}
              />
              <ReviewStat
                icon={ShieldCheck}
                label="Body"
                value={plainBody ? `${plainBody.length} chars` : 'Empty'}
                detail={plainBody ? 'Rendered inside email wrapper' : 'Add campaign content'}
              />
            </div>

            <div className="rounded-2xl border border-border/60 bg-background/80 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Campaign Review</p>
                  <h3 className="mt-2 font-instrument text-lg tracking-tight">
                    {subject.trim() || 'Your campaign subject'}
                  </h3>
                </div>
                <Badge variant={historyError ? 'destructive' : 'outline'} className="rounded-full px-3 py-1">
                  {historyError ? 'Needs Attention' : 'Ready to Review'}
                </Badge>
              </div>
              <p className="mt-3 text-sm text-muted-foreground">
                {plainBody || 'Add campaign copy to preview the message summary here.'}
              </p>
              <div className="mt-4 flex flex-wrap gap-2 text-xs text-muted-foreground">
                <span className="rounded-full border border-border/40 px-3 py-1">
                  {historyError ? 'Recipient count unavailable' : `${recipientCount} subscribed recipient${recipientCount === 1 ? '' : 's'}`}
                </span>
                <span className="rounded-full border border-border/40 px-3 py-1">
                  HTML wrapped automatically
                </span>
                <span className="rounded-full border border-border/40 px-3 py-1">
                  Unsubscribed users excluded
                </span>
              </div>
            </div>

            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-muted-foreground">
                {historyError
                  ? 'Recipient count unavailable. Retry the history panel before sending.'
                  : `${recipientCount} eligible recipient${recipientCount !== 1 ? 's' : ''}`}
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
                      This will email <strong>{recipientCount}</strong> subscribed users with the subject &ldquo;{subject}&rdquo;.
                      Review the content carefully before continuing. This action cannot be undone.
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
              <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-4 text-sm text-emerald-700 dark:text-emerald-300">
                <p className="font-medium">Campaign sent.</p>
                <p className="mt-1">
                  Sent to {result.sent} of {result.total} users.{result.failed > 0 && ` ${result.failed} failed.`}
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Campaign history */}
        <Card className="md:col-span-2">
          <CardHeader className="flex flex-row items-start justify-between gap-3 pb-3">
            <div>
              <CardTitle className="font-instrument text-xl tracking-tight">Past Campaigns</CardTitle>
              <CardDescription>Recent sends, recipient counts, and delivery activity.</CardDescription>
            </div>
            <Button variant="outline" size="sm" onClick={fetchHistory} disabled={loadingHistory} className="rounded-full">
              <RefreshCw className={`mr-2 h-3.5 w-3.5 ${loadingHistory ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
          </CardHeader>
          <CardContent className="p-0">
            {loadingHistory ? (
              <SectionLoadingState
                title="Loading campaign history..."
                className="min-h-[220px] border-0 bg-transparent"
              />
            ) : historyError ? (
              <SectionErrorState
                title="Failed to load campaign history"
                description={historyError}
                className="min-h-[220px] border-0 bg-transparent"
                action={(
                  <Button variant="outline" size="sm" onClick={fetchHistory}>
                    Try again
                  </Button>
                )}
              />
            ) : campaigns.length === 0 ? (
              <SectionEmptyState
                title="No campaigns sent yet"
                description="Your sent campaigns will appear here."
                className="min-h-[220px] border-0 bg-transparent"
              />
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

function ReviewStat({
  icon: Icon,
  label,
  value,
  detail,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: string | number
  detail: string
}) {
  return (
    <div className="rounded-xl border border-border/50 bg-background/70 p-3">
      <div className="mb-2 flex items-center gap-2">
        <Icon className="h-3.5 w-3.5 text-muted-foreground/70" />
        <p className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">{label}</p>
      </div>
      <p className="font-instrument text-xl tracking-tight">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
    </div>
  )
}
