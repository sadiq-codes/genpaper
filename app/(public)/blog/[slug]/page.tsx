import { notFound } from "next/navigation"
import Link from "next/link"
import Image from "next/image"
import { MDXRemote } from "next-mdx-remote/rsc"
import rehypeSlug from "rehype-slug"
import rehypeAutolinkHeadings from "rehype-autolink-headings"
import { getAllPostSlugs, getPostBySlug, getRelatedPosts } from "@/lib/blog/mdx"
import { formatDate } from "@/lib/utils"
import type { Metadata } from "next"
import { ArrowLeft, ArrowUpRight } from "lucide-react"

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
      <nav className="fixed top-0 left-0 right-0 z-50 border-b border-border bg-background/95 backdrop-blur-md">
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

            <div className="flex items-center gap-2 md:gap-8">
              <Link
                href="/blog"
                className="inline-flex h-9 items-center justify-center rounded-full border border-border/60 px-3 text-sm font-medium text-foreground transition-colors hover:bg-muted md:hidden"
              >
                Blog
              </Link>
              <Link
                href="/signup"
                className="inline-flex h-9 items-center justify-center rounded-full bg-accent px-4 text-sm font-medium text-accent-foreground shadow transition-colors hover:bg-accent/90 md:hidden"
              >
                Get Started
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
        </div>
      </nav>

      {/* Article */}
      <article className="px-4 pb-20 pt-24 sm:pt-28">
        <div className="mx-auto max-w-5xl">
          {/* Back link */}
          <Link
            href="/blog"
            className="mb-8 inline-flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Blog
          </Link>

          <div className="rounded-4xl border border-border/60 bg-card/70 p-6 shadow-sm sm:p-8">
            {/* Header */}
            <header className="mx-auto max-w-3xl">
              <div className="mb-5 flex flex-wrap items-center gap-2">
                <span className="inline-flex rounded-full border border-border/60 bg-background/80 px-3 py-1 text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                  GenPaper Blog
                </span>
                {post.tags.slice(0, 3).map((tag) => (
                  <span
                    key={tag}
                    className="inline-flex rounded-full border border-border/60 bg-background/70 px-3 py-1 text-[10px] uppercase tracking-[0.14em] text-muted-foreground"
                  >
                    {tag}
                  </span>
                ))}
              </div>

              <h1 className="font-instrument text-4xl tracking-tight sm:text-5xl lg:text-6xl">
                {post.title}
              </h1>
              <p className="mt-4 text-lg leading-8 text-muted-foreground sm:text-xl">
                {post.description}
              </p>

              <div className="mt-6 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
                <span className="rounded-full border border-border/60 bg-background/80 px-3 py-1">
                  <time dateTime={post.date}>{formatDate(post.date)}</time>
                </span>
                <span className="rounded-full border border-border/60 bg-background/80 px-3 py-1">
                  {post.readingTime}
                </span>
                <span className="rounded-full border border-border/60 bg-background/80 px-3 py-1">
                  {post.author}
                </span>
              </div>
            </header>

            {/* Featured Image */}
            {post.image && (
              <div className="relative mx-auto mt-8 aspect-video max-w-4xl overflow-hidden rounded-3xl border border-border/60 bg-muted">
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
            <div className="mx-auto mt-10 max-w-3xl rounded-[1.75rem] border border-border/60 bg-background/90 p-6 sm:p-8 lg:p-10">
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
            </div>

            {/* CTA */}
            <div className="mx-auto mt-10 max-w-3xl rounded-[1.75rem] border border-border/60 bg-muted/40 p-6 text-center sm:p-8">
              <h3 className="font-instrument text-2xl tracking-tight">
                Ready to write your research paper?
              </h3>
              <p className="mx-auto mt-3 max-w-xl text-muted-foreground">
                GenPaper helps you turn research into a structured academic draft with faster outlining, writing, and revision support.
              </p>
              <Link
                href="/signup"
                className="mt-5 inline-flex h-11 items-center justify-center rounded-full bg-accent px-6 text-sm font-medium text-accent-foreground shadow transition-colors hover:bg-accent/90"
              >
                Get Started Free
              </Link>
            </div>
          </div>
        </div>
      </article>

      {/* Related Posts */}
      {relatedPosts.length > 0 && (
        <section className="border-t border-border px-4 py-16">
          <div className="mx-auto max-w-6xl">
            <h2 className="mb-8 text-center font-instrument text-3xl tracking-tight">
              Related Articles
            </h2>
            <div className="grid gap-8 md:grid-cols-3">
              {relatedPosts.map((related) => (
                <Link key={related.slug} href={`/blog/${related.slug}`} className="group">
                  <div className="rounded-3xl border border-border/60 bg-card p-6 transition-colors hover:border-accent/50">
                    <div className="mb-2 text-xs text-muted-foreground">
                      {formatDate(related.date)} · {related.readingTime}
                    </div>
                    <h3 className="mb-2 font-instrument text-xl tracking-tight transition-colors group-hover:text-accent">
                      {related.title}
                    </h3>
                    <p className="text-sm text-muted-foreground line-clamp-2">
                      {related.description}
                    </p>
                    <div className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-foreground/80 transition-colors group-hover:text-accent">
                      Read article
                      <ArrowUpRight className="h-4 w-4" />
                    </div>
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
