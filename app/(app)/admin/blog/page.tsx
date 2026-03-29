'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { SectionEmptyState, SectionErrorState, SectionLoadingState } from '@/components/ui/async-state'
import { formatDate } from '@/lib/utils'
import { FileText, Plus, Eye, Pencil, RefreshCw, ArrowUpRight, Clock3 } from 'lucide-react'

interface BlogPost {
  slug: string
  title: string
  description: string
  date: string
  author: string
  tags: string[]
  published: boolean
  url: string
}

export default function AdminBlogPage() {
  const [posts, setPosts] = useState<BlogPost[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState('all')

  const fetchPosts = async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch('/api/blog/posts?status=all')
      if (!response.ok) throw new Error('Failed to fetch posts')
      const data = await response.json()
      setPosts(data.posts || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load posts')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchPosts() }, [])

  const filteredPosts = useMemo(() => posts.filter(post => {
    if (activeTab === 'drafts') return !post.published
    if (activeTab === 'published') return post.published
    return true
  }), [activeTab, posts])

  const draftCount = useMemo(() => posts.filter(p => !p.published).length, [posts])
  const publishedCount = useMemo(() => posts.filter(p => p.published).length, [posts])

  return (
    <div className="space-y-6">
      <div className="rounded-3xl border border-border/60 bg-card/70 p-5 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-2">
            <Badge variant="outline" className="rounded-full px-3 py-1 text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
              Editorial Desk
            </Badge>
            <div>
              <h1 className="font-instrument text-3xl tracking-tight">Blog Library</h1>
              <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                Review drafts, spot published posts quickly, and jump into editing without digging through a cramped table.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="rounded-2xl border border-border/50 bg-background/80 px-3 py-2 text-right">
              <p className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Coverage</p>
              <p className="text-sm font-medium">{posts.length} post{posts.length !== 1 ? 's' : ''}</p>
            </div>
            <Button variant="outline" size="sm" onClick={fetchPosts} disabled={loading} className="rounded-full">
              <RefreshCw className={`mr-2 h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
            <Button size="sm" asChild className="rounded-full">
              <Link href="/admin/blog/new">
                <Plus className="mr-2 h-3.5 w-3.5" />
                New Post
              </Link>
            </Button>
          </div>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          <SummaryCard
            label="All Posts"
            value={posts.length}
            detail="Every draft and published entry in the editorial system."
          />
          <SummaryCard
            label="Drafts"
            value={draftCount}
            detail="Posts that still need review, polish, or publication."
          />
          <SummaryCard
            label="Published"
            value={publishedCount}
            detail="Live articles currently visible on the public blog."
          />
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="h-auto w-full flex-wrap justify-start gap-2 rounded-2xl bg-transparent p-0">
          <TabsTrigger value="all" className="rounded-full border border-border/50 bg-background/80 px-4 py-2 data-[state=active]:border-foreground/20 data-[state=active]:bg-foreground data-[state=active]:text-background">
            All ({posts.length})
          </TabsTrigger>
          <TabsTrigger value="drafts" className="rounded-full border border-border/50 bg-background/80 px-4 py-2 data-[state=active]:border-foreground/20 data-[state=active]:bg-foreground data-[state=active]:text-background">
            Drafts ({draftCount})
          </TabsTrigger>
          <TabsTrigger value="published" className="rounded-full border border-border/50 bg-background/80 px-4 py-2 data-[state=active]:border-foreground/20 data-[state=active]:bg-foreground data-[state=active]:text-background">
            Published ({publishedCount})
          </TabsTrigger>
        </TabsList>

        <TabsContent value={activeTab} className="mt-4">
          {loading ? (
            <SectionLoadingState
              title="Loading posts..."
              description="Fetching the latest blog entries from your repository."
              className="min-h-[260px]"
            />
          ) : error ? (
            <SectionErrorState
              title="Failed to load blog posts"
              description={error}
              className="min-h-[260px]"
              action={(
                <Button variant="outline" onClick={fetchPosts}>
                  Try again
                </Button>
              )}
            />
          ) : filteredPosts.length === 0 ? (
            <SectionEmptyState
              title={activeTab === 'drafts' ? 'No drafts' : activeTab === 'published' ? 'No published posts' : 'No blog posts yet'}
              description={
                activeTab === 'drafts'
                  ? 'Everything is published right now.'
                  : activeTab === 'published'
                    ? 'Nothing has been pushed live yet.'
                    : 'Create your first post to start building the editorial library.'
              }
              className="min-h-[260px]"
              icon={<FileText className="h-5 w-5 text-muted-foreground" />}
              action={(
                <Button size="sm" asChild>
                  <Link href="/admin/blog/new">
                    <Plus className="mr-2 h-3.5 w-3.5" />
                    Create Post
                  </Link>
                </Button>
              )}
            />
          ) : (
            <Card className="border-border/60">
              <CardHeader className="pb-3">
                <CardTitle className="font-instrument text-xl tracking-tight">
                  {activeTab === 'drafts' ? 'Draft Queue' : activeTab === 'published' ? 'Published Posts' : 'All Posts'}
                </CardTitle>
                <p className="text-sm text-muted-foreground">
                  {filteredPosts.length} item{filteredPosts.length !== 1 ? 's' : ''} in this view.
                </p>
              </CardHeader>
              <CardContent className="space-y-4">
                {filteredPosts.map((post) => (
                  <article
                    key={post.slug}
                    className="rounded-2xl border border-border/50 bg-background/70 p-5 transition-colors hover:border-border"
                  >
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                      <div className="min-w-0 flex-1 space-y-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant={post.published ? 'default' : 'secondary'} className="rounded-full px-3 py-1 text-[10px] uppercase tracking-[0.16em]">
                            {post.published ? 'Published' : 'Draft'}
                          </Badge>
                          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                            <Clock3 className="h-3 w-3" />
                            {formatDate(post.date)}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            by {post.author}
                          </span>
                        </div>

                        <div className="space-y-2">
                          <Link
                            href={`/admin/blog/${post.slug}`}
                            className="block font-instrument text-2xl tracking-tight transition-colors hover:text-foreground/80"
                          >
                            {post.title}
                          </Link>
                          {post.description ? (
                            <p className="max-w-3xl text-sm text-muted-foreground line-clamp-2">
                              {post.description}
                            </p>
                          ) : null}
                        </div>

                        <div className="flex flex-wrap gap-1.5">
                          {post.tags.slice(0, 4).map((tag) => (
                            <Badge key={tag} variant="outline" className="rounded-full px-2.5 py-1 text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                              {tag}
                            </Badge>
                          ))}
                          {post.tags.length > 4 ? (
                            <Badge variant="outline" className="rounded-full px-2.5 py-1 text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                              +{post.tags.length - 4} more
                            </Badge>
                          ) : null}
                        </div>
                      </div>

                      <div className="flex shrink-0 flex-wrap items-center gap-2 lg:flex-col lg:items-end">
                        {post.published ? (
                          <Button variant="outline" size="sm" asChild className="rounded-full">
                            <a href={post.url} target="_blank" rel="noopener noreferrer">
                              <Eye className="mr-2 h-3.5 w-3.5" />
                              Preview
                            </a>
                          </Button>
                        ) : null}
                        <Button size="sm" asChild className="rounded-full">
                          <Link href={`/admin/blog/${post.slug}`}>
                            <Pencil className="mr-2 h-3.5 w-3.5" />
                            Edit
                          </Link>
                        </Button>
                        <Link
                          href={`/admin/blog/${post.slug}`}
                          className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
                        >
                          Open workspace
                          <ArrowUpRight className="h-3 w-3" />
                        </Link>
                      </div>
                    </div>
                  </article>
                ))}
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}

function SummaryCard({
  label,
  value,
  detail,
}: {
  label: string
  value: number
  detail: string
}) {
  return (
    <div className="rounded-2xl border border-border/50 bg-background/80 p-4">
      <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{label}</p>
      <p className="mt-2 font-instrument text-3xl tracking-tight">{value}</p>
      <p className="mt-2 text-sm text-muted-foreground">{detail}</p>
    </div>
  )
}
