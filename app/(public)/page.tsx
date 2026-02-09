"use client"

import { useEffect, useState, useRef, type ReactNode } from "react"
import Link from "next/link"
import Image from "next/image"
import {
  ArrowRight,
  FileText,
  Search,
  Brain,
  Clock,
  Shield,
  BookOpen,
  CheckCircle,
  Menu,
  X,
  Sparkles,
} from "lucide-react"
import { TIER_CONFIG } from "@/types/subscription"
import type { SubscriptionTier, BillingInterval } from "@/types/subscription"
import { Switch } from "@/components/ui/switch"
import { getCheckoutUrl } from "@/lib/hooks/use-subscription"
import { createClient } from "@/lib/supabase/client"
import type { User } from "@supabase/supabase-js"
import { cn } from "@/lib/utils"

// ─── Nav links ─────────────────────────────────────────────────────────────────

const NAV_LINKS = [
  { href: "#features", label: "Features" },
  { href: "#how-it-works", label: "How it Works" },
  { href: "#pricing", label: "Pricing" },
]

// ─── Scroll-triggered reveal ───────────────────────────────────────────────────

function Reveal({
  children,
  className = "",
  delay = 0,
}: {
  children: ReactNode
  className?: string
  delay?: number
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const obs = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          setVisible(true)
          obs.disconnect()
        }
      },
      { threshold: 0.12 }
    )
    obs.observe(el)
    return () => obs.disconnect()
  }, [])

  return (
    <div
      ref={ref}
      className={cn(
        "transition-all duration-700 ease-out",
        visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6",
        className
      )}
      style={{ transitionDelay: `${delay}ms` }}
    >
      {children}
    </div>
  )
}

// ─── Main page ─────────────────────────────────────────────────────────────────

export default function LandingPage() {
  const [user, setUser] = useState<User | null>(null)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [billingInterval, setBillingInterval] = useState<BillingInterval>("yearly")
  const supabase = createClient()

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUser(data.user))
  }, [supabase.auth])

  return (
    <div className="min-h-screen bg-background relative">
      {/* Grain texture overlay */}
      <div
        className="pointer-events-none fixed inset-0 z-[100] opacity-[0.025] dark:opacity-[0.04]"
        aria-hidden="true"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`,
          backgroundRepeat: "repeat",
          backgroundSize: "128px 128px",
        }}
      />

      {/* ─── Navigation ──────────────────────────────────────────── */}
      <nav className="fixed top-0 left-0 right-0 z-50 bg-background/80 backdrop-blur-xl border-b border-border/40">
        <div className="max-w-6xl mx-auto px-6">
          <div className="flex items-center justify-between h-16">
            <Link href="/" className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-foreground/80 flex items-center justify-center p-1.5">
                <Image
                  src="/favicon-32x32.png"
                  alt="GenPaper"
                  width={20}
                  height={20}
                  className="w-full h-full invert dark:invert-0"
                />
              </div>
              <span className="text-lg font-semibold tracking-tight text-foreground/80">GenPaper</span>
            </Link>

            <div className="hidden md:flex items-center gap-8">
              {NAV_LINKS.map((link) => (
                <a
                  key={link.href}
                  href={link.href}
                  className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  {link.label}
                </a>
              ))}

              <div className="h-4 w-px bg-border" aria-hidden="true" />

              {user ? (
                <Link
                  href="/projects"
                  className="inline-flex items-center gap-1.5 text-sm font-medium text-foreground hover:text-foreground/80 transition-colors"
                >
                  Dashboard <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              ) : (
                <>
                  <Link
                    href="/login"
                    className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                  >
                    Sign in
                  </Link>
                  <Link
                    href="/signup"
                    className="inline-flex items-center rounded-full bg-foreground text-background px-4 py-2 text-sm font-medium hover:bg-foreground/90 transition-colors"
                  >
                    Get Started
                  </Link>
                </>
              )}
            </div>

            <button
              className="md:hidden p-2 rounded-lg hover:bg-muted transition-colors"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              aria-label={mobileMenuOpen ? "Close menu" : "Open menu"}
            >
              {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
          </div>

          {mobileMenuOpen && (
            <div className="md:hidden py-6 border-t border-border/40 space-y-1">
              {NAV_LINKS.map((link) => (
                <a
                  key={link.href}
                  href={link.href}
                  className="block text-muted-foreground hover:text-foreground transition-colors py-2"
                  onClick={() => setMobileMenuOpen(false)}
                >
                  {link.label}
                </a>
              ))}
              <div className="pt-4 flex flex-col gap-2">
                {user ? (
                  <Link
                    href="/projects"
                    className="inline-flex items-center justify-center gap-2 rounded-full bg-foreground text-background px-4 py-2.5 text-sm font-medium"
                  >
                    Dashboard <ArrowRight className="h-4 w-4" />
                  </Link>
                ) : (
                  <>
                    <Link
                      href="/login"
                      className="text-muted-foreground hover:text-foreground transition-colors py-2"
                      onClick={() => setMobileMenuOpen(false)}
                    >
                      Sign in
                    </Link>
                    <Link
                      href="/signup"
                      className="inline-flex items-center justify-center rounded-full bg-foreground text-background px-4 py-2.5 text-sm font-medium"
                    >
                      Get Started
                    </Link>
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      </nav>

      {/* ─── Hero ────────────────────────────────────────────────── */}
      <section className="relative pt-32 pb-24 lg:pt-40 lg:pb-32 overflow-hidden">
        {/* Background gradients */}
        <div className="absolute inset-0 -z-10" aria-hidden="true">
          <div className="absolute top-0 right-0 w-[800px] h-[600px] bg-[radial-gradient(ellipse,oklch(0.93_0.03_250)_0%,transparent_70%)] dark:bg-[radial-gradient(ellipse,oklch(0.20_0.04_250)_0%,transparent_70%)]" />
          <div className="absolute bottom-0 left-0 w-[600px] h-[500px] bg-[radial-gradient(ellipse,oklch(0.95_0.02_30)_0%,transparent_70%)] dark:bg-[radial-gradient(ellipse,oklch(0.18_0.02_30)_0%,transparent_70%)]" />
        </div>

        <div className="max-w-6xl mx-auto px-6 grid lg:grid-cols-2 gap-12 lg:gap-20 items-center">
          {/* Text */}
          <div>
            <Reveal>
              <span className="inline-block text-xs font-medium tracking-[0.2em] uppercase text-muted-foreground mb-6">
                AI-Powered Research
              </span>
            </Reveal>

            <Reveal delay={100}>
              <h1 className="font-instrument text-5xl sm:text-6xl lg:text-[4.5rem] leading-[1.08] tracking-tight mb-6">
                Research papers, written{" "}
                <em className="font-instrument italic">brilliantly</em>
              </h1>
            </Reveal>

            <Reveal delay={200}>
              <p className="text-lg text-muted-foreground leading-relaxed max-w-lg mb-10">
                From topic to finished paper — with real sources, perfect citations,
                and writing that sounds like you.
              </p>
            </Reveal>

            <Reveal delay={300}>
              <div className="flex flex-col sm:flex-row gap-3 mb-8">
                {user ? (
                  <Link
                    href="/projects"
                    className="inline-flex items-center justify-center gap-2 rounded-full bg-foreground text-background px-7 py-3.5 text-sm font-medium hover:bg-foreground/90 transition-all shadow-lg shadow-foreground/10"
                  >
                    Start New Paper <ArrowRight className="h-4 w-4" />
                  </Link>
                ) : (
                  <>
                    <Link
                      href="/signup"
                      className="inline-flex items-center justify-center gap-2 rounded-full bg-foreground text-background px-7 py-3.5 text-sm font-medium hover:bg-foreground/90 transition-all shadow-lg shadow-foreground/10"
                    >
                      Start Writing — Free <ArrowRight className="h-4 w-4" />
                    </Link>
                    <Link
                      href="/login"
                      className="inline-flex items-center justify-center gap-2 rounded-full border border-border px-7 py-3.5 text-sm font-medium text-foreground hover:bg-muted transition-colors"
                    >
                      Sign In
                    </Link>
                  </>
                )}
              </div>
            </Reveal>

            <Reveal delay={400}>
              <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <CheckCircle className="h-3.5 w-3.5 text-emerald-500" aria-hidden="true" /> No credit card needed
                </span>
                <span className="flex items-center gap-1.5">
                  <CheckCircle className="h-3.5 w-3.5 text-emerald-500" aria-hidden="true" /> Verified sources
                </span>
                <span className="flex items-center gap-1.5">
                  <CheckCircle className="h-3.5 w-3.5 text-emerald-500" aria-hidden="true" /> Export anywhere
                </span>
              </div>
            </Reveal>
          </div>

          {/* Visual: stylized editor mockup */}
          <Reveal delay={300} className="hidden lg:block">
            <div className="relative">
              {/* Glow */}
              <div
                className="absolute -inset-4 bg-gradient-to-br from-indigo-500/10 via-transparent to-emerald-500/10 rounded-3xl blur-2xl"
                aria-hidden="true"
              />

              {/* Editor window */}
              <div className="relative bg-card border border-border/60 rounded-2xl shadow-2xl shadow-black/5 dark:shadow-black/30 overflow-hidden">
                {/* Title bar */}
                <div className="flex items-center gap-2 px-4 py-3 border-b border-border/50 bg-muted/30">
                  <div className="flex gap-1.5" aria-hidden="true">
                    <div className="w-2.5 h-2.5 rounded-full bg-red-400/60" />
                    <div className="w-2.5 h-2.5 rounded-full bg-amber-400/60" />
                    <div className="w-2.5 h-2.5 rounded-full bg-emerald-400/60" />
                  </div>
                  <span className="text-xs text-muted-foreground ml-2">Research Paper — Draft</span>
                </div>

                {/* Editor content */}
                <div className="p-6 space-y-4">
                  <div>
                    <h3 className="font-instrument text-xl mb-3 text-foreground">
                      Impact of Climate Variability on Crop Yields
                    </h3>
                    <p className="text-sm text-muted-foreground leading-relaxed">
                      Climate variability has become one of the most pressing challenges facing
                      global agriculture in the 21st century. Recent studies demonstrate that
                      shifting precipitation patterns and rising temperatures significantly
                      affect crop productivity across diverse agro-ecological zones
                      <span className="text-indigo-500 dark:text-indigo-400">
                        {" "}(Martinez et al., 2024)
                      </span>
                      .
                    </p>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground/60 pt-2 border-t border-border/30">
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-[11px] font-medium">
                      <Sparkles className="h-3 w-3" aria-hidden="true" /> AI Suggestion
                    </span>
                    <span className="text-muted-foreground/30" aria-hidden="true">|</span>
                    <span>12 sources cited</span>
                    <span className="text-muted-foreground/30" aria-hidden="true">|</span>
                    <span>2,340 words</span>
                  </div>
                </div>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ─── Features ────────────────────────────────────────────── */}
      <section id="features" className="py-24 lg:py-32 scroll-mt-20">
        <div className="max-w-6xl mx-auto px-6">
          <Reveal>
            <div className="max-w-2xl mb-16">
              <h2 className="font-instrument text-4xl lg:text-5xl tracking-tight mb-4">
                Everything for research excellence
              </h2>
              <p className="text-lg text-muted-foreground leading-relaxed">
                Tools designed to make academic writing faster, better, and less painful.
              </p>
            </div>
          </Reveal>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {FEATURES.map((feature, i) => (
              <Reveal key={feature.title} delay={i * 80}>
                <div
                  className={cn(
                    "group relative p-6 rounded-2xl border border-border/50 bg-card",
                    "hover:border-border hover:shadow-lg hover:shadow-black/[0.03] dark:hover:shadow-black/20",
                    "transition-all duration-300",
                    i === 0 && "lg:col-span-2"
                  )}
                >
                  <div
                    className={cn(
                      "w-10 h-10 rounded-xl flex items-center justify-center mb-4 transition-colors duration-300",
                      feature.accent
                    )}
                  >
                    <feature.icon className="h-5 w-5" />
                  </div>
                  <h3 className="font-semibold text-foreground mb-2">{feature.title}</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    {feature.description}
                  </p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ─── How It Works ────────────────────────────────────────── */}
      <section id="how-it-works" className="py-24 lg:py-32 bg-muted/30 scroll-mt-20">
        <div className="max-w-6xl mx-auto px-6">
          <Reveal>
            <div className="text-center max-w-2xl mx-auto mb-20">
              <h2 className="font-instrument text-4xl lg:text-5xl tracking-tight mb-4">
                Three steps to your paper
              </h2>
              <p className="text-lg text-muted-foreground">
                No setup. No learning curve. Just results.
              </p>
            </div>
          </Reveal>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 lg:gap-12">
            {STEPS.map((step, i) => (
              <Reveal key={step.title} delay={i * 150}>
                <div className="relative text-center md:text-left">
                  <span
                    className="font-instrument text-6xl lg:text-7xl text-border dark:text-border/50 leading-none block mb-4"
                    aria-hidden="true"
                  >
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <h3 className="font-semibold text-foreground mb-2 text-lg">{step.title}</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    {step.description}
                  </p>

                  {/* Connector line */}
                  {i < STEPS.length - 1 && (
                    <div
                      className="hidden md:block absolute top-8 -right-4 lg:-right-6 w-4 lg:w-8 border-t border-dashed border-border"
                      aria-hidden="true"
                    />
                  )}
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ─── Pricing ─────────────────────────────────────────────── */}
      <section id="pricing" className="py-24 lg:py-32 scroll-mt-20">
        <div className="max-w-6xl mx-auto px-6">
          <Reveal>
            <div className="text-center mb-12">
              <h2 className="font-instrument text-4xl lg:text-5xl tracking-tight mb-4">
                Simple, transparent pricing
              </h2>
              <p className="text-lg text-muted-foreground max-w-xl mx-auto mb-8">
                Start free. Upgrade when you need more.
              </p>
              <div className="flex items-center justify-center gap-3">
                <span
                  className={cn(
                    "text-sm font-medium",
                    billingInterval === "monthly" ? "text-foreground" : "text-muted-foreground"
                  )}
                >
                  Monthly
                </span>
                <Switch
                  checked={billingInterval === "yearly"}
                  onCheckedChange={(checked) =>
                    setBillingInterval(checked ? "yearly" : "monthly")
                  }
                  aria-label="Toggle yearly billing"
                />
                <span
                  className={cn(
                    "text-sm font-medium",
                    billingInterval === "yearly" ? "text-foreground" : "text-muted-foreground"
                  )}
                >
                  Yearly
                </span>
                <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full ml-1">
                  Save 33%
                </span>
              </div>
            </div>
          </Reveal>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-5xl mx-auto">
            <Reveal delay={0}>
              <PricingCard tier="free" user={user} billingInterval={billingInterval} />
            </Reveal>
            <Reveal delay={100}>
              <PricingCard tier="starter" user={user} billingInterval={billingInterval} />
            </Reveal>
            <Reveal delay={200}>
              <PricingCard
                tier="pro"
                user={user}
                billingInterval={billingInterval}
                recommended
              />
            </Reveal>
          </div>

          <Reveal delay={300}>
            <div className="text-center mt-10">
              <Link
                href="/pricing"
                className="text-sm text-muted-foreground hover:text-foreground transition-colors inline-flex items-center gap-1"
              >
                View full comparison <ArrowRight className="h-3 w-3" />
              </Link>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ─── Final CTA ───────────────────────────────────────────── */}
      <section className="py-24 lg:py-32 relative overflow-hidden">
        <div className="absolute inset-0 -z-10" aria-hidden="true">
          <div className="absolute inset-0 bg-gradient-to-b from-muted/50 to-background" />
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[400px] bg-[radial-gradient(ellipse,oklch(0.93_0.03_250)_0%,transparent_70%)] dark:bg-[radial-gradient(ellipse,oklch(0.18_0.03_250)_0%,transparent_70%)]" />
        </div>

        <div className="max-w-3xl mx-auto px-6 text-center">
          <Reveal>
            <h2 className="font-instrument text-4xl sm:text-5xl lg:text-6xl tracking-tight mb-6">
              {user ? "Ready to continue?" : "Start writing smarter"}
            </h2>
          </Reveal>
          <Reveal delay={100}>
            <p className="text-lg text-muted-foreground mb-10 max-w-xl mx-auto">
              {user
                ? "Pick up where you left off or start a new project."
                : "Free to start. No credit card needed. Your first paper in minutes."}
            </p>
          </Reveal>
          <Reveal delay={200}>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
              {user ? (
                <>
                  <Link
                    href="/projects"
                    className="inline-flex items-center gap-2 rounded-full bg-foreground text-background px-8 py-3.5 text-sm font-medium hover:bg-foreground/90 transition-all shadow-lg shadow-foreground/10"
                  >
                    Start New Paper <ArrowRight className="h-4 w-4" />
                  </Link>
                  <Link
                    href="/projects"
                    className="inline-flex items-center gap-2 rounded-full border border-border px-8 py-3.5 text-sm font-medium text-foreground hover:bg-muted transition-colors"
                  >
                    View Projects
                  </Link>
                </>
              ) : (
                <>
                  <Link
                    href="/signup"
                    className="inline-flex items-center gap-2 rounded-full bg-foreground text-background px-8 py-3.5 text-sm font-medium hover:bg-foreground/90 transition-all shadow-lg shadow-foreground/10"
                  >
                    Write Your First Paper <ArrowRight className="h-4 w-4" />
                  </Link>
                  <Link
                    href="/login"
                    className="inline-flex items-center gap-2 rounded-full border border-border px-8 py-3.5 text-sm font-medium text-foreground hover:bg-muted transition-colors"
                  >
                    Sign In
                  </Link>
                </>
              )}
            </div>
          </Reveal>
        </div>
      </section>

      {/* ─── Footer ──────────────────────────────────────────────── */}
      <footer className="border-t border-border/40 bg-background">
        <div className="max-w-6xl mx-auto px-6 py-12">
          <div className="flex flex-col md:flex-row justify-between items-center gap-6">
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-lg bg-foreground/80 flex items-center justify-center p-1">
                <Image
                  src="/favicon-32x32.png"
                  alt="GenPaper"
                  width={16}
                  height={16}
                  className="w-full h-full invert dark:invert-0"
                />
              </div>
              <span className="text-sm font-medium text-foreground/80">GenPaper</span>
              <span className="text-xs text-muted-foreground/50 ml-1">
                — AI Research Assistant
              </span>
            </div>
            <div className="flex items-center gap-6 text-sm text-muted-foreground">
              <Link href="/pricing" className="hover:text-foreground transition-colors">
                Pricing
              </Link>
              <span className="text-border" aria-hidden="true">·</span>
              <a href="#" className="hover:text-foreground transition-colors">
                Privacy
              </a>
              <span className="text-border" aria-hidden="true">·</span>
              <a href="#" className="hover:text-foreground transition-colors">
                Terms
              </a>
            </div>
          </div>
          <div className="mt-8 pt-6 border-t border-border/30 text-center text-xs text-muted-foreground/50">
            &copy; {new Date().getFullYear()} GenPaper
          </div>
        </div>
      </footer>
    </div>
  )
}

// ─── Feature data ──────────────────────────────────────────────────────────────

const FEATURES = [
  {
    icon: Brain,
    title: "Write Full Papers",
    description:
      "Enter your topic. GenPaper writes a complete paper with introduction, literature review, analysis, and conclusion — grounded in real research.",
    accent:
      "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 group-hover:bg-indigo-500/15",
  },
  {
    icon: Search,
    title: "Find Trusted Sources",
    description:
      "Search real academic databases. Every source is a genuine, citable publication.",
    accent:
      "bg-amber-500/10 text-amber-600 dark:text-amber-400 group-hover:bg-amber-500/15",
  },
  {
    icon: FileText,
    title: "Perfect Citations",
    description:
      "APA, MLA, Chicago — automatically formatted and always correct.",
    accent:
      "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 group-hover:bg-emerald-500/15",
  },
  {
    icon: BookOpen,
    title: "Organize Everything",
    description:
      "Save papers and sources in your personal library. Find anything instantly.",
    accent:
      "bg-rose-500/10 text-rose-600 dark:text-rose-400 group-hover:bg-rose-500/15",
  },
  {
    icon: Clock,
    title: "Version History",
    description:
      "Every draft is saved. Go back to any version with a single click.",
    accent:
      "bg-violet-500/10 text-violet-600 dark:text-violet-400 group-hover:bg-violet-500/15",
  },
  {
    icon: Shield,
    title: "Private & Secure",
    description:
      "Your work stays yours. We never share or train on your content.",
    accent:
      "bg-teal-500/10 text-teal-600 dark:text-teal-400 group-hover:bg-teal-500/15",
  },
]

// ─── How it works steps ────────────────────────────────────────────────────────

const STEPS = [
  {
    title: "Enter your topic",
    description:
      "Describe what you want to write about. Add any specific requirements or focus areas.",
  },
  {
    title: "AI generates your paper",
    description:
      "GenPaper finds real sources, structures your argument, and writes every section with proper citations.",
  },
  {
    title: "Edit, refine, export",
    description:
      "Use the AI editor to polish your paper. Export to Word, PDF, or LaTeX when you're ready.",
  },
]

// ─── Pricing card ──────────────────────────────────────────────────────────────

function PricingCard({
  tier,
  user,
  billingInterval,
  recommended,
}: {
  tier: SubscriptionTier
  user: User | null
  billingInterval: BillingInterval
  recommended?: boolean
}) {
  const config = TIER_CONFIG[tier]
  const isYearly = billingInterval === "yearly"
  const displayPrice =
    tier === "free" ? 0 : isYearly ? Math.round(config.yearlyPrice / 12) : config.price
  const yearlyTotal = config.yearlyPrice
  const monthlyCost = config.price * 12
  const savings = monthlyCost - yearlyTotal

  const getButtonProps = () => {
    if (tier === "free") {
      return {
        href: user ? "/projects" : "/signup",
        text: user ? "Current Plan" : "Get Started Free",
      }
    }
    return {
      href: getCheckoutUrl(tier as "starter" | "pro", {
        email: user?.email || undefined,
        userId: user?.id || undefined,
        interval: billingInterval,
      }),
      text: `Get ${config.name}`,
    }
  }

  const { href, text } = getButtonProps()

  return (
    <div
      className={cn(
        "relative rounded-2xl border p-6 flex flex-col h-full bg-card transition-all duration-300",
        recommended
          ? "border-foreground/20 shadow-xl shadow-black/[0.06] dark:shadow-black/30 scale-[1.02]"
          : "border-border/50 hover:border-border"
      )}
    >
      {recommended && (
        <span className="absolute -top-3 left-1/2 -translate-x-1/2 text-[11px] font-medium tracking-wide uppercase bg-foreground text-background px-3 py-1 rounded-full">
          Most Popular
        </span>
      )}

      <div className="mb-6">
        <h3 className="font-semibold text-lg mb-1">{config.name}</h3>
        <p className="text-sm text-muted-foreground">{config.description}</p>
      </div>

      <div className="mb-6">
        <span className="text-4xl font-bold tracking-tight">${displayPrice}</span>
        {displayPrice > 0 && (
          <span className="text-muted-foreground text-sm">/mo</span>
        )}
        {tier !== "free" && isYearly && (
          <div className="mt-1 text-xs text-muted-foreground">
            ${yearlyTotal}/yr ·{" "}
            <span className="text-emerald-600 dark:text-emerald-400">Save ${savings}</span>
          </div>
        )}
      </div>

      <ul className="space-y-2.5 mb-8 flex-1">
        {config.features.slice(0, 4).map((feature, i) => (
          <li key={i} className="flex items-start gap-2.5 text-sm">
            <CheckCircle className="h-4 w-4 text-emerald-500 mt-0.5 shrink-0" aria-hidden="true" />
            <span className="text-muted-foreground">{feature}</span>
          </li>
        ))}
      </ul>

      <Link
        href={href}
        className={cn(
          "inline-flex items-center justify-center rounded-full px-6 py-2.5 text-sm font-medium transition-all",
          recommended
            ? "bg-foreground text-background hover:bg-foreground/90 shadow-sm"
            : "border border-border text-foreground hover:bg-muted"
        )}
      >
        {text}
      </Link>
    </div>
  )
}
