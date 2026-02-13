import { NextRequest, NextResponse } from 'next/server'
import { authenticateBlogRequest, isApiKeyAuth } from '@/lib/blog/api-auth'
import { commitFileToGitHub, getFileFromGitHub, listFilesInGitHub } from '@/lib/blog/github'
import { sendDraftNotification } from '@/lib/blog/notifications'
import matter from 'gray-matter'

const BLOG_PATH = 'content/blog'
const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://genpaper.ai'

/**
 * Generate a URL-friendly slug from title
 */
function generateSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60)
}

/**
 * Validate slug for security (prevent path traversal)
 */
function isValidSlug(slug: string): boolean {
  return /^[a-z0-9-]+$/.test(slug) && !slug.includes('..')
}

/**
 * Build MDX file content from post data
 */
function buildMdxContent(data: {
  title: string
  description: string
  content: string
  tags: string[]
  author: string
  published: boolean
  date: string
}): string {
  const frontmatter = `---
title: "${data.title.replace(/"/g, '\\"')}"
description: "${data.description.replace(/"/g, '\\"')}"
date: "${data.date}"
author: "${data.author}"
tags: ${JSON.stringify(data.tags)}
published: ${data.published}
---`

  return `${frontmatter}\n\n${data.content}`
}



/**
 * GET /api/blog/posts
 * 
 * List all blog posts (with optional status filter)
 */
export async function GET(request: NextRequest) {
  // Authenticate
  const auth = await authenticateBlogRequest(request)
  if (!auth.authenticated) {
    return NextResponse.json({ error: auth.error }, { status: 401 })
  }
  
  try {
    const { searchParams } = new URL(request.url)
    const statusFilter = searchParams.get('status') // 'draft', 'published', or 'all'
    
    // List files from GitHub
    const files = await listFilesInGitHub(BLOG_PATH)
    const mdxFiles = files.filter(f => f.endsWith('.mdx'))
    
    // Get metadata for each post
    const posts = await Promise.all(
      mdxFiles.map(async (filename) => {
        const slug = filename.replace('.mdx', '')
        const file = await getFileFromGitHub(`${BLOG_PATH}/${filename}`)
        
        if (!file) return null
        
        const { data } = matter(file.content)
        
        return {
          slug,
          title: data.title || 'Untitled',
          description: data.description || '',
          date: data.date || '',
          author: data.author || 'GenPaper Team',
          tags: data.tags || [],
          published: data.published !== false,
          url: `${BASE_URL}/blog/${slug}`,
        }
      })
    )
    
    // Filter by status
    let filteredPosts = posts.filter(Boolean)
    
    if (statusFilter === 'draft') {
      filteredPosts = filteredPosts.filter(p => !p?.published)
    } else if (statusFilter === 'published') {
      filteredPosts = filteredPosts.filter(p => p?.published)
    }
    
    // Sort by date (newest first)
    filteredPosts.sort((a, b) => 
      new Date(b?.date || 0).getTime() - new Date(a?.date || 0).getTime()
    )
    
    return NextResponse.json({
      posts: filteredPosts,
      total: filteredPosts.length,
    })
    
  } catch (error) {
    console.error('[Blog API] Error listing posts:', error)
    return NextResponse.json(
      { error: 'Failed to list posts', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

/**
 * POST /api/blog/posts
 * 
 * Create a new blog post
 */
export async function POST(request: NextRequest) {
  // Authenticate
  const auth = await authenticateBlogRequest(request)
  if (!auth.authenticated) {
    return NextResponse.json({ error: auth.error }, { status: 401 })
  }
  
  try {
    const body = await request.json()
    
    // Validate required fields
    const { title, description, content, tags = [], author = 'GenPaper Team', published = false, slug: providedSlug } = body
    
    if (!title || typeof title !== 'string') {
      return NextResponse.json({ error: 'Title is required' }, { status: 400 })
    }
    
    if (!description || typeof description !== 'string') {
      return NextResponse.json({ error: 'Description is required' }, { status: 400 })
    }
    
    if (!content || typeof content !== 'string') {
      return NextResponse.json({ error: 'Content is required' }, { status: 400 })
    }
    
    // Generate or validate slug
    const slug = providedSlug || generateSlug(title)
    
    if (!isValidSlug(slug)) {
      return NextResponse.json({ error: 'Invalid slug format' }, { status: 400 })
    }
    
    // Check if post already exists
    const existing = await getFileFromGitHub(`${BLOG_PATH}/${slug}.mdx`)
    if (existing) {
      return NextResponse.json({ error: 'A post with this slug already exists' }, { status: 409 })
    }
    
    // Build MDX content
    const mdxContent = buildMdxContent({
      title,
      description,
      content,
      tags: Array.isArray(tags) ? tags : [],
      author,
      published: Boolean(published),
      date: new Date().toISOString().split('T')[0],
    })
    
    // Commit to GitHub
    const commitMessage = published 
      ? `Add blog post: ${title}`
      : `Add blog draft: ${title}`
    
    const { commitUrl } = await commitFileToGitHub(
      `${BLOG_PATH}/${slug}.mdx`,
      mdxContent,
      commitMessage
    )
    
    // Send notification for drafts (AI-created posts)
    if (!published && isApiKeyAuth(request)) {
      await sendDraftNotification({ title, slug, description })
    }
    
    return NextResponse.json({
      success: true,
      slug,
      url: `${BASE_URL}/blog/${slug}`,
      status: published ? 'published' : 'draft',
      commitUrl,
    }, { status: 201 })
    
  } catch (error) {
    console.error('[Blog API] Error creating post:', error)
    return NextResponse.json(
      { error: 'Failed to create post', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
