import fs from 'fs'
import path from 'path'
import matter from 'gray-matter'
import readingTime from 'reading-time'
import type { BlogPostMeta, BlogPost } from './types'

const BLOG_DIR = path.join(process.cwd(), 'content/blog')

/**
 * Get all blog post slugs
 */
export function getAllPostSlugs(): string[] {
  if (!fs.existsSync(BLOG_DIR)) {
    return []
  }
  
  const files = fs.readdirSync(BLOG_DIR)
  return files
    .filter((file) => file.endsWith('.mdx'))
    .map((file) => file.replace(/\.mdx$/, ''))
}

/**
 * Get metadata for all published posts (sorted by date, newest first)
 */
export function getAllPostsMeta(): BlogPostMeta[] {
  const slugs = getAllPostSlugs()
  
  const posts = slugs
    .map((slug) => getPostMeta(slug))
    .filter((post): post is BlogPostMeta => post !== null)
    .filter((post) => post.published !== false) // Exclude drafts
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
  
  return posts
}

/**
 * Get metadata for a single post by slug
 */
export function getPostMeta(slug: string): BlogPostMeta | null {
  const filePath = path.join(BLOG_DIR, `${slug}.mdx`)
  
  if (!fs.existsSync(filePath)) {
    return null
  }
  
  const fileContents = fs.readFileSync(filePath, 'utf8')
  const { data, content } = matter(fileContents)
  const stats = readingTime(content)
  
  return {
    title: data.title || 'Untitled',
    description: data.description || '',
    date: data.date || new Date().toISOString(),
    author: data.author || 'GenPaper Team',
    tags: data.tags || [],
    image: data.image,
    imageAlt: data.imageAlt,
    slug,
    readingTime: stats.text,
    published: data.published,
  }
}

/**
 * Get a full post by slug (including content)
 */
export function getPostBySlug(slug: string): BlogPost | null {
  const filePath = path.join(BLOG_DIR, `${slug}.mdx`)
  
  if (!fs.existsSync(filePath)) {
    return null
  }
  
  const fileContents = fs.readFileSync(filePath, 'utf8')
  const { data, content } = matter(fileContents)
  const stats = readingTime(content)
  
  return {
    title: data.title || 'Untitled',
    description: data.description || '',
    date: data.date || new Date().toISOString(),
    author: data.author || 'GenPaper Team',
    tags: data.tags || [],
    image: data.image,
    imageAlt: data.imageAlt,
    slug,
    readingTime: stats.text,
    published: data.published,
    content,
  }
}

/**
 * Get posts by tag
 */
export function getPostsByTag(tag: string): BlogPostMeta[] {
  return getAllPostsMeta().filter((post) =>
    post.tags.map((t) => t.toLowerCase()).includes(tag.toLowerCase())
  )
}

/**
 * Get all unique tags
 */
export function getAllTags(): string[] {
  const posts = getAllPostsMeta()
  const tags = new Set<string>()
  
  posts.forEach((post) => {
    post.tags.forEach((tag) => tags.add(tag.toLowerCase()))
  })
  
  return Array.from(tags).sort()
}

/**
 * Get related posts (by shared tags)
 */
export function getRelatedPosts(slug: string, limit = 3): BlogPostMeta[] {
  const currentPost = getPostMeta(slug)
  if (!currentPost) return []
  
  const allPosts = getAllPostsMeta().filter((post) => post.slug !== slug)
  
  // Score posts by number of shared tags
  const scoredPosts = allPosts.map((post) => {
    const sharedTags = post.tags.filter((tag) =>
      currentPost.tags.map((t) => t.toLowerCase()).includes(tag.toLowerCase())
    )
    return { post, score: sharedTags.length }
  })
  
  return scoredPosts
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((item) => item.post)
}
