import { notFound } from "next/navigation"
import Link from "next/link"
import Image from "next/image"
import { MDXRemote } from "next-mdx-remote/rsc"
import rehypeSlug from "rehype-slug"
import rehypeAutolinkHeadings from "rehype-autolink-headings"
import { getAllPostSlugs, getPostBySlug, getRelatedPosts } from "@/lib/blog/mdx"
import { formatDate } from "@/lib/utils"
import type { Metadata } from "next"
import { ArrowLeft } from "lucide-react"

interface Props {
  params: Promise<{ slug: string }>
}

// Generate static paths for all blog posts
export async function generateStaticParams() {
  const slugs = getAllPostSlugs()
  return slugs.map((slug) => ({ slug }))
}

// Generate metadata for each post
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params
  const post = getPostBySlug(slug)
  
  if (!post) {
    return { title: "Post Not Found" }
  }

  return {
    title: `${post.title} | GenPaper Blog`,
    description: post.description,
    authors: [{ name: post.author }],
    openGraph: {
      title: post.title,
      description: post.description,
      type: "article",
      publishedTime: post.date,
      authors: [post.author],
      images: post.image ? [{ url: post.image, alt: post.imageAlt || post.title }] : undefined,
    },
    twitter: {
      card: "summary_large_image",
      title: post.title,
      description: post.description,
      images: post.image ? [post.image] : undefined,
    },
  }
}

// Custom MDX components
const components = {
  h1: (props: React.HTMLAttributes<HTMLHeadingElement>) => (
    <h1 className="font-instrument text-3xl md:text-4xl tracking-tight mt-8 mb-4 scroll-mt-20" {...props} />
  ),
  h2: (props: React.HTMLAttributes<HTMLHeadingElement>) => (
    <h2 className="font-instrument text-2xl md:text-3xl tracking-tight mt-8 mb-4 scroll-mt-20 group" {...props} />
  ),
  h3: (props: React.HTMLAttributes<HTMLHeadingElement>) => (
    <h3 className="font-instrument text-xl md:text-2xl tracking-tight mt-6 mb-3 scroll-mt-20 group" {...props} />
  ),
  p: (props: React.HTMLAttributes<HTMLParagraphElement>) => (
    <p className="text-muted-foreground leading-relaxed mb-4" {...props} />
  ),
  ul: (props: React.HTMLAttributes<HTMLUListElement>) => (
    <ul className="list-disc list-inside space-y-2 mb-4 text-muted-foreground" {...props} />
  ),
  ol: (props: React.HTMLAttributes<HTMLOListElement>) => (
    <ol className="list-decimal list-inside space-y-2 mb-4 text-muted-foreground" {...props} />
  ),
  li: (props: React.HTMLAttributes<HTMLLIElement>) => (
    <li className="leading-relaxed" {...props} />
  ),
  a: (props: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a className="text-primary hover:underline" {...props} />
  ),
  blockquote: (props: React.HTMLAttributes<HTMLQuoteElement>) => (
    <blockquote className="border-l-4 border-primary pl-4 italic text-muted-foreground my-4" {...props} />
  ),
  code: (props: React.HTMLAttributes<HTMLElement>) => (
    <code className="bg-muted px-1.5 py-0.5 rounded text-sm font-mono" {...props} />
  ),
  pre: (props: React.HTMLAttributes<HTMLPreElement>) => (
    <pre className="bg-muted p-4 rounded-lg overflow-x-auto my-4 text-sm" {...props} />
  ),
  hr: () => <hr className="my-8 border-border" />,
  strong: (props: React.HTMLAttributes<HTMLElement>) => (
    <strong className="font-semibold text-foreground" {...props} />
  ),
}

export default async function BlogPostPage({ params }: Props) {
  const { slug } = await params
  const post = getPostBySlug(slug)

  if (!post || post.published === false) {
    notFound()
  }

  const relatedPosts = getRelatedPosts(slug, 3)

  // JSON-LD structured data for SEO
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: post.title,
    description: post.description,
    author: {
      "@type": "Person",
      name: post.author,
    },
    datePublished: post.date,
    image: post.image,
    publisher: {
      "@type": "Organization",
      name: "GenPaper",
      logo: {
        "@type": "ImageObject",
        url: "https://genpaper.ai/favicon-32x32.png",
      },
    },
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Structured Data */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      {/* Navigation */}
      <nav className="fixed top-0 left-0 right-0 z-50 bg-background/95 backdrop-blur-md border-b border-border">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <Link href="/" className="flex items-center gap-2.5">
              <Image
                src="/favicon-32x32.png"
                alt="GenPaper"
                width={24}
                height={24}
                className="dark:invert"
              />
              <span className="text-lg font-semibold tracking-tight text-foreground/80">GenPaper</span>
            </Link>

            <div className="hidden md:flex items-center space-x-8">
              <Link
                href="/#features"
                className="text-muted-foreground hover:text-foreground transition-colors text-sm font-medium"
              >
                Features
              </Link>
              <Link
                href="/pricing"
                className="text-muted-foreground hover:text-foreground transition-colors text-sm font-medium"
              >
                Pricing
              </Link>
              <Link
                href="/blog"
                className="text-foreground transition-colors text-sm font-medium"
              >
                Blog
              </Link>
              <Link
                href="/login"
                className="text-muted-foreground hover:text-foreground transition-colors text-sm font-medium"
              >
                Sign In
              </Link>
              <Link
                href="/signup"
                className="inline-flex h-9 items-center justify-center rounded-md bg-accent px-4 text-sm font-medium text-accent-foreground shadow transition-colors hover:bg-accent/90"
              >
                Get Started
              </Link>
            </div>
          </div>
        </div>
      </nav>

      {/* Article */}
      <article className="pt-24 pb-16 px-4">
        <div className="max-w-3xl mx-auto">
          {/* Back link */}
          <Link
            href="/blog"
            className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors mb-8"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Blog
          </Link>

          {/* Header */}
          <header className="mb-8">
            <div className="flex items-center gap-2 text-sm text-muted-foreground mb-4">
              <time dateTime={post.date}>{formatDate(post.date)}</time>
              <span>·</span>
              <span>{post.readingTime}</span>
              <span>·</span>
              <span>{post.author}</span>
            </div>
            <h1 className="font-instrument text-3xl md:text-4xl lg:text-5xl tracking-tight mb-4">
              {post.title}
            </h1>
            <p className="text-lg text-muted-foreground">
              {post.description}
            </p>
            {post.tags.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-4">
                {post.tags.map((tag) => (
                  <span
                    key={tag}
                    className="text-xs px-2 py-1 bg-muted rounded-md text-muted-foreground"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            )}
          </header>

          {/* Featured Image */}
          {post.image && (
            <div className="aspect-video relative rounded-lg overflow-hidden mb-8 bg-muted">
              <Image
                src={post.image}
                alt={post.imageAlt || post.title}
                fill
                className="object-cover"
                priority
              />
            </div>
          )}

          {/* Content */}
          <div className="prose prose-neutral dark:prose-invert max-w-none">
            <MDXRemote 
              source={post.content} 
              components={components}
              options={{
                mdxOptions: {
                  rehypePlugins: [
                    rehypeSlug,
                    [rehypeAutolinkHeadings, { 
                      behavior: "wrap",
                      properties: {
                        className: ["anchor-link"],
                      }
                    }],
                  ],
                },
              }}
            />
          </div>

          {/* CTA */}
          <div className="mt-12 p-6 bg-muted rounded-lg text-center">
            <h3 className="font-instrument text-xl tracking-tight mb-2">
              Ready to write your research paper?
            </h3>
            <p className="text-muted-foreground mb-4">
              GenPaper helps you create high-quality academic papers with AI assistance.
            </p>
            <Link
              href="/signup"
              className="inline-flex h-10 items-center justify-center rounded-md bg-accent px-6 text-sm font-medium text-accent-foreground shadow transition-colors hover:bg-accent/90"
            >
              Get Started Free
            </Link>
          </div>
        </div>
      </article>

      {/* Related Posts */}
      {relatedPosts.length > 0 && (
        <section className="py-16 px-4 border-t border-border">
          <div className="max-w-6xl mx-auto">
            <h2 className="font-instrument text-2xl tracking-tight mb-8 text-center">
              Related Articles
            </h2>
            <div className="grid gap-8 md:grid-cols-3">
              {relatedPosts.map((related) => (
                <Link key={related.slug} href={`/blog/${related.slug}`}>
                  <div className="border border-border rounded-lg p-6 bg-card hover:border-accent/50 transition-colors">
                    <div className="text-xs text-muted-foreground mb-2">
                      {formatDate(related.date)} · {related.readingTime}
                    </div>
                    <h3 className="font-instrument text-lg tracking-tight mb-2 hover:text-accent transition-colors">
                      {related.title}
                    </h3>
                    <p className="text-sm text-muted-foreground line-clamp-2">
                      {related.description}
                    </p>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Footer */}
      <footer className="border-t border-border py-12 px-4">
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row justify-between items-center gap-4">
          <div className="flex items-center gap-2">
            <Image
              src="/favicon-32x32.png"
              alt="GenPaper"
              width={20}
              height={20}
              className="dark:invert"
            />
            <span className="text-sm text-muted-foreground">
              © {new Date().getFullYear()} GenPaper. All rights reserved.
            </span>
          </div>
          <div className="flex items-center gap-6 text-sm text-muted-foreground">
            <Link href="/privacy" className="hover:text-foreground transition-colors">
              Privacy
            </Link>
            <Link href="/terms" className="hover:text-foreground transition-colors">
              Terms
            </Link>
            <Link href="/blog" className="hover:text-foreground transition-colors">
              Blog
            </Link>
          </div>
        </div>
      </footer>
    </div>
  )
}
