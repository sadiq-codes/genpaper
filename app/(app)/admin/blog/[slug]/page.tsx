'use client'

import { useEffect, useMemo, useRef, useState, use } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { SectionErrorState, SectionLoadingState } from '@/components/ui/async-state'
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
import { ArrowLeft, Clock3, ExternalLink, FileText, Loader2, Save, Sparkles, Trash2 } from 'lucide-react'

interface BlogPost {
  slug: string
  title: string
  description: string
  content: string
  date: string
  author: string
  tags: string[]
  published: boolean
  url: string
}

function createInitialPost(): BlogPost {
  return {
    slug: '',
    title: '',
    description: '',
    content: '',
    date: new Date().toISOString().split('T')[0],
    author: 'GenPaper Team',
    tags: [],
    published: false,
    url: '',
  }
}

function buildSignature(post: BlogPost, tagsInput: string) {
  return JSON.stringify({
    ...post,
    tagsInput,
  })
}

function getSuggestedSlug(title: string) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60)
}

export default function EditBlogPostPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params)
  const router = useRouter()
  const isNew = slug === 'new'
  const initialPostRef = useRef<BlogPost>(createInitialPost())
  
  const [post, setPost] = useState<BlogPost>(initialPostRef.current)
  
  const [loading, setLoading] = useState(!isNew)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tagsInput, setTagsInput] = useState('')
  const [loadedSignature, setLoadedSignature] = useState(() => buildSignature(initialPostRef.current, ''))

  useEffect(() => {
    if (!isNew) {
      fetchPost()
    }
  }, [slug, isNew])

  const fetchPost = async () => {
    setLoading(true)
    setError(null)
    
    try {
      const response = await fetch(`/api/blog/posts/${slug}`)
      
      if (response.status === 404) {
        router.push('/admin/blog')
        return
      }
      
      if (!response.ok) {
        throw new Error('Failed to fetch post')
      }
      
      const data = await response.json()
      setPost(data)
      setTagsInput(data.tags?.join(', ') || '')
      setLoadedSignature(buildSignature(data, data.tags?.join(', ') || ''))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load post')
    } finally {
      setLoading(false)
    }
  }

  const handleSave = async () => {
    setSaving(true)
    setError(null)
    
    try {
      // Parse tags from input
      const tags = tagsInput
        .split(',')
        .map(t => t.trim())
        .filter(Boolean)
      
      const body = {
        title: post.title,
        description: post.description,
        content: post.content,
        author: post.author,
        tags,
        published: post.published,
        ...(isNew && post.slug ? { slug: post.slug } : {}),
      }
      
      const url = isNew ? '/api/blog/posts' : `/api/blog/posts/${slug}`
      const method = isNew ? 'POST' : 'PATCH'
      
      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      
      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to save post')
      }
      
      const data = await response.json()
      
      if (isNew) {
        router.push(`/admin/blog/${data.slug}`)
      } else {
        // Refresh post data
        await fetchPost()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save post')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    setDeleting(true)
    
    try {
      const response = await fetch(`/api/blog/posts/${slug}`, {
        method: 'DELETE',
      })
      
      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to delete post')
      }
      
      router.push('/admin/blog')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete post')
      setDeleting(false)
    }
  }

  const currentSignature = useMemo(() => buildSignature(post, tagsInput), [post, tagsInput])
  const hasUnsavedChanges = currentSignature !== loadedSignature
  const tagList = useMemo(
    () => tagsInput.split(',').map((tag) => tag.trim()).filter(Boolean),
    [tagsInput]
  )
  const wordCount = useMemo(() => {
    const stripped = post.content.replace(/[#>*`[\]()-]/g, ' ').trim()
    return stripped ? stripped.split(/\s+/).length : 0
  }, [post.content])
  const readingMinutes = Math.max(1, Math.ceil(wordCount / 220))
  const previewSlug = post.slug || getSuggestedSlug(post.title)
  const saveLabel = post.published ? (isNew ? 'Publish Post' : 'Publish Changes') : (isNew ? 'Create Draft' : 'Save Draft')

  if (loading) {
    return (
      <SectionLoadingState
        title="Loading editor..."
        description="Preparing the blog post workspace."
        className="min-h-[420px]"
      />
    )
  }

  if (error && !post.title && !isNew) {
    return (
      <SectionErrorState
        title="Failed to load post"
        description={error}
        className="min-h-[420px]"
        action={(
          <Button variant="outline" onClick={fetchPost}>
            Try again
          </Button>
        )}
      />
    )
  }

  return (
    <div className="space-y-6">
      <div className="rounded-3xl border border-border/60 bg-card/70 p-5 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="mb-2 flex items-center gap-2">
              <Button variant="ghost" size="sm" asChild className="rounded-full">
                <Link href="/admin/blog">
                  <ArrowLeft className="mr-2 h-4 w-4" />
                  Back to Blog
                </Link>
              </Button>
              <Badge variant="outline" className="rounded-full px-3 py-1 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                Editorial Workspace
              </Badge>
            </div>
            <h1 className="font-instrument text-3xl tracking-tight">
              {isNew ? 'New Post' : 'Edit Post'}
            </h1>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <Badge variant={post.published ? 'default' : 'secondary'} className="rounded-full">
                {post.published ? 'Published' : 'Draft'}
              </Badge>
              <span>{wordCount} words</span>
              <span>·</span>
              <span>{readingMinutes} min read</span>
              {post.published && post.url ? (
                <>
                  <span>·</span>
                  <a
                    href={post.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 hover:text-foreground"
                  >
                    View live
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </>
              ) : null}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-border/50 bg-background/80 px-3 py-3">
            <span className="text-xs text-muted-foreground">
              {hasUnsavedChanges ? 'Unsaved changes' : 'All changes saved'}
            </span>
            {!isNew ? (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="destructive" size="sm" disabled={deleting} className="rounded-full">
                    {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete this post?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This action cannot be undone. The post will be permanently deleted.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground">
                      Delete
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            ) : null}
            <Button onClick={handleSave} disabled={saving || !hasUnsavedChanges} className="rounded-full">
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
              {saveLabel}
            </Button>
          </div>
        </div>
      </div>

      {error && (
        <div className="rounded-2xl border border-destructive/20 bg-destructive/10 p-4 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-6">
          <Card className="border-border/60">
            <CardHeader>
              <CardTitle className="font-instrument text-xl tracking-tight">Content</CardTitle>
              <CardDescription>Write the story, then tune the publishing details in the side panel.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="space-y-2">
                <Label htmlFor="title">Title</Label>
                <Input
                  id="title"
                  value={post.title}
                  onChange={(e) => setPost({ ...post, title: e.target.value })}
                  placeholder="How to Write a Literature Review"
                  className="h-12 text-base"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="description">Description</Label>
                <Textarea
                  id="description"
                  value={post.description}
                  onChange={(e) => setPost({ ...post, description: e.target.value })}
                  placeholder="A brief description for search previews and social sharing..."
                  rows={3}
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="content">Post Body</Label>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Clock3 className="h-3.5 w-3.5" />
                    {readingMinutes} min read
                  </div>
                </div>
                <Textarea
                  id="content"
                  value={post.content}
                  onChange={(e) => setPost({ ...post, content: e.target.value })}
                  placeholder="# Your Post Title

Write your content here using Markdown...

## Subheading

- Bullet points
- Work like this

**Bold** and *italic* work too."
                  rows={24}
                  className="min-h-[560px] font-mono text-sm leading-6"
                />
                <p className="text-xs text-muted-foreground">
                  Supports Markdown: headings, emphasis, lists, links, and code spans.
                </p>
              </div>

              <div className="grid gap-3 rounded-2xl border border-border/50 bg-muted/20 p-4 sm:grid-cols-3">
                <EditorStat label="Words" value={wordCount} />
                <EditorStat label="Read Time" value={`${readingMinutes} min`} />
                <EditorStat label="Tags" value={tagList.length} />
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6 xl:sticky xl:top-20">
          <Card className="border-border/60">
            <CardHeader>
              <CardTitle className="font-instrument text-xl tracking-tight">Publishing</CardTitle>
              <CardDescription>Control visibility, URL structure, and publishing readiness.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="rounded-2xl border border-border/50 bg-muted/20 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium">{post.published ? 'Published' : 'Draft'}</p>
                    <p className="text-xs text-muted-foreground">
                      {post.published ? 'Visible on the public blog.' : 'Hidden until you publish it.'}
                    </p>
                  </div>
                  <Switch
                    id="published"
                    checked={post.published}
                    onCheckedChange={(checked) => setPost({ ...post, published: checked })}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="author">Author</Label>
                <Input
                  id="author"
                  value={post.author}
                  onChange={(e) => setPost({ ...post, author: e.target.value })}
                  placeholder="GenPaper Team"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="slug">Slug</Label>
                <Input
                  id="slug"
                  value={post.slug}
                  onChange={(e) => setPost({ ...post, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-') })}
                  placeholder={getSuggestedSlug(post.title) || 'auto-generated-from-title'}
                />
                <p className="text-xs text-muted-foreground">
                  Final URL: <span className="font-mono text-foreground/80">/blog/{previewSlug || 'post-slug'}</span>
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="tags">Tags</Label>
                <Input
                  id="tags"
                  value={tagsInput}
                  onChange={(e) => setTagsInput(e.target.value)}
                  placeholder="academic writing, research, tips"
                />
                <div className="flex flex-wrap gap-2 pt-1">
                  {tagList.length > 0 ? tagList.map((tag) => (
                    <Badge key={tag} variant="outline" className="rounded-full">{tag}</Badge>
                  )) : (
                    <p className="text-xs text-muted-foreground">Separate tags with commas.</p>
                  )}
                </div>
              </div>

              <div className="rounded-2xl border border-border/50 bg-background/80 p-4">
                <div className="flex items-start gap-3">
                  <div className="rounded-2xl border border-border/50 bg-muted/30 p-2.5">
                    <Sparkles className="h-4 w-4 text-muted-foreground/70" />
                  </div>
                  <div className="space-y-1">
                    <p className="text-sm font-medium">{hasUnsavedChanges ? 'Ready to save changes' : 'Up to date'}</p>
                    <p className="text-xs text-muted-foreground">
                      {post.published
                        ? 'Publishing saves directly to the live post.'
                        : 'Saving keeps the article in draft until you publish it.'}
                    </p>
                  </div>
                </div>
                <Button onClick={handleSave} disabled={saving || !hasUnsavedChanges} className="mt-4 w-full rounded-full">
                  {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                  {saveLabel}
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card className="border-border/60">
            <CardHeader>
              <CardTitle className="font-instrument text-xl tracking-tight">Reader Preview</CardTitle>
              <CardDescription>Quick check of how the article is framed before publishing.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-2xl border border-border/50 bg-background/80 p-4">
                <div className="mb-3 flex items-center gap-2 text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                  <FileText className="h-3.5 w-3.5" />
                  Blog Card Preview
                </div>
                <h3 className="font-instrument text-xl tracking-tight">
                  {post.title || 'Post title preview'}
                </h3>
                <p className="mt-2 text-sm text-muted-foreground">
                  {post.description || 'Your description will appear here in blog cards and link previews.'}
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                  {tagList.slice(0, 4).map((tag) => (
                    <Badge key={tag} variant="outline" className="rounded-full">{tag}</Badge>
                  ))}
                </div>
              </div>

              {post.published && post.url ? (
                <Button variant="outline" asChild className="w-full rounded-full">
                  <a href={post.url} target="_blank" rel="noopener noreferrer">
                    View Live Post
                    <ExternalLink className="ml-2 h-4 w-4" />
                  </a>
                </Button>
              ) : null}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}

function EditorStat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl border border-border/50 bg-background/80 p-3">
      <p className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">{label}</p>
      <p className="mt-2 font-instrument text-2xl tracking-tight">{value}</p>
    </div>
  )
}
