/**
 * Blog Post Types
 */

export interface BlogPostMeta {
  title: string
  description: string
  date: string
  author: string
  tags: string[]
  image?: string
  imageAlt?: string
  slug: string
  readingTime: string
  published?: boolean
}

export interface BlogPost extends BlogPostMeta {
  content: string
}
