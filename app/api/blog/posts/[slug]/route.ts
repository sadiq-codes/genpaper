import { NextRequest, NextResponse } from 'next/server'
import { authenticateBlogRequest } from '@/lib/blog/api-auth'
import { commitFileToGitHub, getFileFromGitHub, deleteFileFromGitHub } from '@/lib/blog/github'
import matter from 'gray-matter'

const BLOG_PATH = 'content/blog'
const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://genpaper.ai'

interface RouteParams {
  params: Promise<{ slug: string }>
}

/**
 * Validate slug for security
 */
function isValidSlug(slug: string): boolean {
  return /^[a-z0-9-]+$/.test(slug) && !slug.includes('..')
}

/**
 * GET /api/blog/posts/[slug]
 * 
 * Get a single blog post by slug
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  const { slug } = await params
  
  // Authenticate
  const auth = await authenticateBlogRequest(request)
  if (!auth.authenticated) {
    return NextResponse.json({ error: auth.error }, { status: 401 })
  }
  
  if (!isValidSlug(slug)) {
    return NextResponse.json({ error: 'Invalid slug format' }, { status: 400 })
  }
  
  try {
    const file = await getFileFromGitHub(`${BLOG_PATH}/${slug}.mdx`)
    
    if (!file) {
      return NextResponse.json({ error: 'Post not found' }, { status: 404 })
    }
    
    const { data, content } = matter(file.content)
    
    return NextResponse.json({
      slug,
      title: data.title || 'Untitled',
      description: data.description || '',
      content,
      date: data.date || '',
      author: data.author || 'GenPaper Team',
      tags: data.tags || [],
      published: data.published !== false,
      url: `${BASE_URL}/blog/${slug}`,
    })
    
  } catch (error) {
    console.error('[Blog API] Error getting post:', error)
    return NextResponse.json(
      { error: 'Failed to get post', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

/**
 * PATCH /api/blog/posts/[slug]
 * 
 * Update an existing blog post
 */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const { slug } = await params
  
  // Authenticate
  const auth = await authenticateBlogRequest(request)
  if (!auth.authenticated) {
    return NextResponse.json({ error: auth.error }, { status: 401 })
  }
  
  if (!isValidSlug(slug)) {
    return NextResponse.json({ error: 'Invalid slug format' }, { status: 400 })
  }
  
  try {
    // Get existing post
    const file = await getFileFromGitHub(`${BLOG_PATH}/${slug}.mdx`)
    
    if (!file) {
      return NextResponse.json({ error: 'Post not found' }, { status: 404 })
    }
    
    const { data: existingData, content: existingContent } = matter(file.content)
    
    // Parse update body
    const body = await request.json()
    const { title, description, content, tags, author, published } = body
    
    // Merge with existing data
    const updatedData = {
      title: title ?? existingData.title,
      description: description ?? existingData.description,
      date: existingData.date, // Keep original date
      author: author ?? existingData.author,
      tags: tags ?? existingData.tags,
      published: published ?? existingData.published,
    }
    
    const updatedContent = content ?? existingContent
    
    // Build new MDX content
    const frontmatter = `---
title: "${updatedData.title.replace(/"/g, '\\"')}"
description: "${updatedData.description.replace(/"/g, '\\"')}"
date: "${updatedData.date}"
author: "${updatedData.author}"
tags: ${JSON.stringify(updatedData.tags || [])}
published: ${updatedData.published !== false}
---`

    const mdxContent = `${frontmatter}\n\n${updatedContent}`
    
    // Determine commit message
    let commitMessage = `Update blog post: ${updatedData.title}`
    if (published === true && existingData.published === false) {
      commitMessage = `Publish blog post: ${updatedData.title}`
    } else if (published === false && existingData.published === true) {
      commitMessage = `Unpublish blog post: ${updatedData.title}`
    }
    
    // Commit to GitHub
    const { commitUrl } = await commitFileToGitHub(
      `${BLOG_PATH}/${slug}.mdx`,
      mdxContent,
      commitMessage
    )
    
    return NextResponse.json({
      success: true,
      slug,
      url: `${BASE_URL}/blog/${slug}`,
      status: updatedData.published ? 'published' : 'draft',
      commitUrl,
    })
    
  } catch (error) {
    console.error('[Blog API] Error updating post:', error)
    return NextResponse.json(
      { error: 'Failed to update post', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/blog/posts/[slug]
 * 
 * Delete a blog post
 */
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const { slug } = await params
  
  // Authenticate
  const auth = await authenticateBlogRequest(request)
  if (!auth.authenticated) {
    return NextResponse.json({ error: auth.error }, { status: 401 })
  }
  
  if (!isValidSlug(slug)) {
    return NextResponse.json({ error: 'Invalid slug format' }, { status: 400 })
  }
  
  try {
    // Check if post exists
    const file = await getFileFromGitHub(`${BLOG_PATH}/${slug}.mdx`)
    
    if (!file) {
      return NextResponse.json({ error: 'Post not found' }, { status: 404 })
    }
    
    const { data } = matter(file.content)
    
    // Delete from GitHub
    const { commitUrl } = await deleteFileFromGitHub(
      `${BLOG_PATH}/${slug}.mdx`,
      `Delete blog post: ${data.title || slug}`
    )
    
    return NextResponse.json({
      success: true,
      slug,
      commitUrl,
    })
    
  } catch (error) {
    console.error('[Blog API] Error deleting post:', error)
    return NextResponse.json(
      { error: 'Failed to delete post', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
