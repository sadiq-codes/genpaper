'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
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
      
      if (!response.ok) {
        throw new Error('Failed to fetch posts')
      }
      
      const data = await response.json()
      setPosts(data.posts || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load posts')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchPosts()
  }, [])

  const filteredPosts = posts.filter(post => {
    if (activeTab === 'drafts') return !post.published
    if (activeTab === 'published') return post.published
    return true
  })

  const draftCount = posts.filter(p => !p.published).length
  const publishedCount = posts.filter(p => p.published).length

  return (
    <div className="container max-w-5xl py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="font-instrument text-3xl tracking-tight">Blog Admin</h1>
          <p className="text-muted-foreground mt-1">
            Manage your blog posts
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={fetchPosts} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <Button asChild>
            <Link href="/admin/blog/new">
              <Plus className="h-4 w-4 mr-2" />
              New Post
            </Link>
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList>
          <TabsTrigger value="all">
            All ({posts.length})
          </TabsTrigger>
          <TabsTrigger value="drafts">
            Drafts ({draftCount})
          </TabsTrigger>
          <TabsTrigger value="published">
            Published ({publishedCount})
          </TabsTrigger>
        </TabsList>

        <TabsContent value={activeTab} className="space-y-4">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : error ? (
            <Card>
              <CardContent className="py-12 text-center">
                <p className="text-destructive">{error}</p>
                <Button variant="outline" onClick={fetchPosts} className="mt-4">
                  Try Again
                </Button>
              </CardContent>
            </Card>
          ) : filteredPosts.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <FileText className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                <p className="text-muted-foreground">
                  {activeTab === 'drafts' 
                    ? 'No draft posts yet' 
                    : activeTab === 'published' 
                      ? 'No published posts yet'
                      : 'No blog posts yet'}
                </p>
                <Button asChild className="mt-4">
                  <Link href="/admin/blog/new">
                    <Plus className="h-4 w-4 mr-2" />
                    Create your first post
                  </Link>
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4">
              {filteredPosts.map((post) => (
                <Card key={post.slug}>
                  <CardHeader className="pb-2">
                    <div className="flex items-start justify-between">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <CardTitle className="text-lg">
                            {post.title}
                          </CardTitle>
                          <Badge variant={post.published ? 'default' : 'secondary'}>
                            {post.published ? 'Published' : 'Draft'}
                          </Badge>
                        </div>
                        <CardDescription>
                          {post.description}
                        </CardDescription>
                      </div>
                      <div className="flex gap-2">
                        {post.published && (
                          <Button variant="ghost" size="sm" asChild>
                            <a href={post.url} target="_blank" rel="noopener noreferrer">
                              <Eye className="h-4 w-4" />
                            </a>
                          </Button>
                        )}
                        <Button variant="ghost" size="sm" asChild>
                          <Link href={`/admin/blog/${post.slug}`}>
                            <Pencil className="h-4 w-4" />
                          </Link>
                        </Button>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="flex items-center gap-4 text-sm text-muted-foreground">
                      <span>{formatDate(post.date)}</span>
                      <span>·</span>
                      <span>{post.author}</span>
                      {post.tags.length > 0 && (
                        <>
                          <span>·</span>
                          <div className="flex gap-1">
                            {post.tags.slice(0, 3).map((tag) => (
                              <Badge key={tag} variant="outline" className="text-xs">
                                {tag}
                              </Badge>
                            ))}
                            {post.tags.length > 3 && (
                              <Badge variant="outline" className="text-xs">
                                +{post.tags.length - 3}
                              </Badge>
                            )}
                          </div>
                        </>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}
