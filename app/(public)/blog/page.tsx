import Link from "next/link"
import Image from "next/image"
import { getAllPostsMeta } from "@/lib/blog/mdx"
import { formatDate } from "@/lib/utils"
import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Blog | GenPaper - AI Research Paper Generator",
  description: "Tips, guides, and insights on academic writing, research papers, literature reviews, and using AI for scholarly work.",
  openGraph: {
    title: "Blog | GenPaper",
    description: "Tips, guides, and insights on academic writing, research papers, and AI-assisted research.",
    type: "website",
  },
}

export default function BlogPage() {
  const posts = getAllPostsMeta()

  return (
    <div className="min-h-screen bg-background">
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
                className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90"
              >
                Get Started
              </Link>
            </div>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="pt-32 pb-16 px-4">
        <div className="max-w-4xl mx-auto text-center">
          <h1 className="font-instrument text-4xl md:text-5xl tracking-tight mb-4">
            GenPaper Blog
          </h1>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            Tips, guides, and insights on academic writing, research papers, 
            literature reviews, and using AI for scholarly work.
          </p>
        </div>
      </section>

      {/* Blog Posts Grid */}
      <section className="pb-24 px-4">
        <div className="max-w-6xl mx-auto">
          {posts.length === 0 ? (
            <div className="text-center py-16">
              <p className="text-muted-foreground">No blog posts yet. Check back soon!</p>
            </div>
          ) : (
            <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-3">
              {posts.map((post) => (
                <article key={post.slug} className="group">
                  <Link href={`/blog/${post.slug}`}>
                    <div className="border border-border rounded-lg overflow-hidden bg-card hover:border-primary/50 transition-colors">
                      {post.image && (
                        <div className="aspect-video relative bg-muted">
                          <Image
                            src={post.image}
                            alt={post.imageAlt || post.title}
                            fill
                            className="object-cover"
                          />
                        </div>
                      )}
                      <div className="p-6">
                        <div className="flex items-center gap-2 text-xs text-muted-foreground mb-3">
                          <time dateTime={post.date}>{formatDate(post.date)}</time>
                          <span>·</span>
                          <span>{post.readingTime}</span>
                        </div>
                        <h2 className="font-instrument text-xl tracking-tight mb-2 group-hover:text-primary transition-colors">
                          {post.title}
                        </h2>
                        <p className="text-sm text-muted-foreground line-clamp-2">
                          {post.description}
                        </p>
                        {post.tags.length > 0 && (
                          <div className="flex flex-wrap gap-2 mt-4">
                            {post.tags.slice(0, 3).map((tag) => (
                              <span
                                key={tag}
                                className="text-xs px-2 py-1 bg-muted rounded-md text-muted-foreground"
                              >
                                {tag}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </Link>
                </article>
              ))}
            </div>
          )}
        </div>
      </section>

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
