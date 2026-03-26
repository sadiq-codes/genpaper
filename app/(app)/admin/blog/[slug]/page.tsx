'use client'

import { useEffect, useState, use } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
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
import { ArrowLeft, Loader2, Save, Trash2, Eye, ExternalLink } from 'lucide-react'

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

export default function EditBlogPostPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params)
  const router = useRouter()
  const isNew = slug === 'new'
  
  const [post, setPost] = useState<BlogPost>({
    slug: '',
    title: '',
    description: '',
    content: '',
    date: new Date().toISOString().split('T')[0],
    author: 'GenPaper Team',
    tags: [],
    published: false,
    url: '',
  })
  
  const [loading, setLoading] = useState(!isNew)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tagsInput, setTagsInput] = useState('')

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

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="max-w-4xl space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="sm" asChild>
            <Link href="/admin/blog">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back
            </Link>
          </Button>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">
              {isNew ? 'New Post' : 'Edit Post'}
            </h1>
            {!isNew && (
              <div className="flex items-center gap-2 mt-1">
                <Badge variant={post.published ? 'default' : 'secondary'}>
                  {post.published ? 'Published' : 'Draft'}
                </Badge>
                {post.published && (
                  <a 
                    href={post.url} 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
                  >
                    View live <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </div>
            )}
          </div>
        </div>
        <div className="flex gap-2">
          {!isNew && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" size="sm" disabled={deleting}>
                  {deleting ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Trash2 className="h-4 w-4" />
                  )}
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
          )}
          <Button onClick={handleSave} disabled={saving}>
            {saving ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Save className="h-4 w-4 mr-2" />
            )}
            {isNew ? 'Create' : 'Save'}
          </Button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="p-4 bg-destructive/10 border border-destructive/20 rounded-lg text-destructive text-sm">
          {error}
        </div>
      )}

      {/* Form */}
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Post Details</CardTitle>
            <CardDescription>Basic information about the post</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="title">Title</Label>
              <Input
                id="title"
                value={post.title}
                onChange={(e) => setPost({ ...post, title: e.target.value })}
                placeholder="How to Write a Literature Review"
              />
            </div>
            
            {isNew && (
              <div className="space-y-2">
                <Label htmlFor="slug">Slug (optional)</Label>
                <Input
                  id="slug"
                  value={post.slug}
                  onChange={(e) => setPost({ ...post, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-') })}
                  placeholder="how-to-write-literature-review"
                />
                <p className="text-xs text-muted-foreground">
                  Leave empty to auto-generate from title
                </p>
              </div>
            )}
            
            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                value={post.description}
                onChange={(e) => setPost({ ...post, description: e.target.value })}
                placeholder="A brief description for SEO and previews..."
                rows={2}
              />
            </div>
            
            <div className="grid grid-cols-2 gap-4">
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
                <Label htmlFor="tags">Tags</Label>
                <Input
                  id="tags"
                  value={tagsInput}
                  onChange={(e) => setTagsInput(e.target.value)}
                  placeholder="academic writing, research, tips"
                />
                <p className="text-xs text-muted-foreground">
                  Separate with commas
                </p>
              </div>
            </div>
            
            <div className="flex items-center space-x-2 pt-2">
              <Switch
                id="published"
                checked={post.published}
                onCheckedChange={(checked) => setPost({ ...post, published: checked })}
              />
              <Label htmlFor="published">
                {post.published ? 'Published' : 'Draft'} 
                <span className="text-muted-foreground ml-1">
                  ({post.published ? 'visible on blog' : 'hidden from public'})
                </span>
              </Label>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Content</CardTitle>
            <CardDescription>Write your post in Markdown format</CardDescription>
          </CardHeader>
          <CardContent>
            <Textarea
              value={post.content}
              onChange={(e) => setPost({ ...post, content: e.target.value })}
              placeholder="# Your Post Title

Write your content here using Markdown...

## Subheading

- Bullet points
- Work like this

**Bold** and *italic* work too."
              rows={20}
              className="font-mono text-sm"
            />
            <p className="text-xs text-muted-foreground mt-2">
              Supports Markdown: # headings, **bold**, *italic*, - lists, [links](url), etc.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
