'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { formatDate } from '@/lib/utils'
import { FileText, Plus, Eye, Pencil, Loader2, RefreshCw } from 'lucide-react'

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

  const filteredPosts = posts.filter(post => {
    if (activeTab === 'drafts') return !post.published
    if (activeTab === 'published') return post.published
    return true
  })

  const draftCount = posts.filter(p => !p.published).length
  const publishedCount = posts.filter(p => p.published).length

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Blog</h1>
          <p className="text-sm text-muted-foreground">{posts.length} post{posts.length !== 1 ? 's' : ''}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={fetchPosts} disabled={loading}>
            <RefreshCw className={`h-3.5 w-3.5 mr-2 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <Button size="sm" asChild>
            <Link href="/admin/blog/new">
              <Plus className="h-3.5 w-3.5 mr-2" />
              New Post
            </Link>
          </Button>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="all">All ({posts.length})</TabsTrigger>
          <TabsTrigger value="drafts">Drafts ({draftCount})</TabsTrigger>
          <TabsTrigger value="published">Published ({publishedCount})</TabsTrigger>
        </TabsList>

        <TabsContent value={activeTab} className="mt-4">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : error ? (
            <Card>
              <CardContent className="py-12 text-center">
                <p className="text-destructive mb-4">{error}</p>
                <Button variant="outline" onClick={fetchPosts}>Try Again</Button>
              </CardContent>
            </Card>
          ) : filteredPosts.length === 0 ? (
            <Card>
              <CardContent className="py-16 text-center">
                <FileText className="h-10 w-10 mx-auto text-muted-foreground/50 mb-3" />
                <p className="text-muted-foreground mb-4">
                  {activeTab === 'drafts' ? 'No drafts' : activeTab === 'published' ? 'No published posts' : 'No blog posts yet'}
                </p>
                <Button size="sm" asChild>
                  <Link href="/admin/blog/new"><Plus className="h-3.5 w-3.5 mr-2" />Create Post</Link>
                </Button>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Title</TableHead>
                    <TableHead className="w-[90px]">Status</TableHead>
                    <TableHead className="w-[120px]">Author</TableHead>
                    <TableHead className="w-[100px]">Date</TableHead>
                    <TableHead className="w-[80px] text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredPosts.map((post) => (
                    <TableRow key={post.slug}>
                      <TableCell>
                        <Link href={`/admin/blog/${post.slug}`} className="font-medium hover:underline">
                          {post.title}
                        </Link>
                        {post.tags.length > 0 && (
                          <div className="flex gap-1 mt-1">
                            {post.tags.slice(0, 3).map((tag) => (
                              <Badge key={tag} variant="outline" className="text-[10px] px-1.5 py-0">{tag}</Badge>
                            ))}
                            {post.tags.length > 3 && (
                              <Badge variant="outline" className="text-[10px] px-1.5 py-0">+{post.tags.length - 3}</Badge>
                            )}
                          </div>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant={post.published ? 'default' : 'secondary'} className="text-xs">
                          {post.published ? 'Published' : 'Draft'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">{post.author}</TableCell>
                      <TableCell className="text-sm text-muted-foreground whitespace-nowrap">{formatDate(post.date)}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          {post.published && (
                            <Button variant="ghost" size="icon" className="h-7 w-7" asChild>
                              <a href={post.url} target="_blank" rel="noopener noreferrer">
                                <Eye className="h-3.5 w-3.5" />
                              </a>
                            </Button>
                          )}
                          <Button variant="ghost" size="icon" className="h-7 w-7" asChild>
                            <Link href={`/admin/blog/${post.slug}`}>
                              <Pencil className="h-3.5 w-3.5" />
                            </Link>
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}
