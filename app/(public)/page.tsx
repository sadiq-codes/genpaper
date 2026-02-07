"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  BookOpen,
  Zap,
  Users,
  CheckCircle,
  ArrowRight,
  FileText,
  Search,
  Brain,
  Clock,
  Shield,
  Menu,
  X,
  Sparkles,
  Crown,
} from "lucide-react"
import { TIER_CONFIG } from "@/types/subscription"
import type { SubscriptionTier, BillingInterval } from "@/types/subscription"
import { Switch } from "@/components/ui/switch"
import { Badge } from "@/components/ui/badge"
import { getCheckoutUrl } from "@/lib/hooks/use-subscription"
import Image from "next/image"
import { createClient } from "@/lib/supabase/client"
import type { User } from "@supabase/supabase-js"

export default function LandingPage() {
  const [user, setUser] = useState<User | null>(null)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [billingInterval, setBillingInterval] = useState<BillingInterval>('yearly')
  const supabase = createClient()

  useEffect(() => {
    const getUser = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      setUser(user)
    }
    getUser()
  }, [supabase.auth])

  return (
    <div className="min-h-screen bg-background">
      <nav className="fixed top-0 left-0 right-0 z-50 bg-background/95 backdrop-blur-md border-b border-border">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <Link href="/" className="flex items-center space-x-2 group">
              <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center p-1.5">
                <Image 
                  src="/favicon-32x32.png" 
                  alt="GenPaper" 
                  width={20} 
                  height={20} 
                  className="w-full h-full"
                />
              </div>
              <span className="text-xl font-bold text-foreground">GenPaper</span>
            </Link>

            <div className="hidden md:flex items-center space-x-8">
              <a
                href="#features"
                className="text-muted-foreground hover:text-foreground transition-colors text-sm font-medium"
              >
                Features
              </a>
              <a
                href="#pricing"
                className="text-muted-foreground hover:text-foreground transition-colors text-sm font-medium"
              >
                Pricing
              </a>
              <a
                href="#benefits"
                className="text-muted-foreground hover:text-foreground transition-colors text-sm font-medium"
              >
                How it Works
              </a>
              {user ? (
                <Button className="bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg px-6" asChild>
                  <Link href="/projects">
                    Dashboard
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Link>
                </Button>
              ) : (
                <>
                  <Link
                    href="/login"
                    className="text-muted-foreground hover:text-foreground transition-colors text-sm font-medium"
                  >
                    Sign In
                  </Link>
                  <Button className="bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg px-6" asChild>
                    <Link href="/signup">Get Started</Link>
                  </Button>
                </>
              )}
            </div>

            <button
              className="md:hidden p-2 rounded-lg hover:bg-muted transition-colors"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            >
              {mobileMenuOpen ? (
                <X className="h-6 w-6 text-foreground" />
              ) : (
                <Menu className="h-6 w-6 text-foreground" />
              )}
            </button>
          </div>

          {mobileMenuOpen && (
            <div className="md:hidden py-4 border-t border-border">
              <div className="flex flex-col space-y-4">
                <a
                  href="#features"
                  className="text-muted-foreground hover:text-foreground transition-colors font-medium px-2 py-2"
                  onClick={() => setMobileMenuOpen(false)}
                >
                  Features
                </a>
                <a
                  href="#pricing"
                  className="text-muted-foreground hover:text-foreground transition-colors font-medium px-2 py-2"
                  onClick={() => setMobileMenuOpen(false)}
                >
                  Pricing
                </a>
                <a
                  href="#benefits"
                  className="text-muted-foreground hover:text-foreground transition-colors font-medium px-2 py-2"
                  onClick={() => setMobileMenuOpen(false)}
                >
                  How it Works
                </a>
                {user ? (
                  <Button className="bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg" asChild>
                    <Link href="/projects">
                      Dashboard
                      <ArrowRight className="ml-2 h-4 w-4" />
                    </Link>
                  </Button>
                ) : (
                  <>
                    <Link
                      href="/login"
                      className="text-muted-foreground hover:text-foreground transition-colors font-medium px-2 py-2"
                      onClick={() => setMobileMenuOpen(false)}
                    >
                      Sign In
                    </Link>
                    <Button className="bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg" asChild>
                      <Link href="/signup">Get Started</Link>
                    </Button>
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      </nav>

      <section className="relative pt-24">
        <div className="bg-background relative overflow-hidden min-h-[85vh] flex items-center pt-8">
          <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20 w-full">
            <div className="text-center" style={{ animation: "fade-in-up 0.8s ease-out" }}>
              <div className="mb-8 flex justify-center">
                <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/5 border border-primary/20">
                  <Zap className="h-4 w-4 text-primary" />
                  <span className="text-sm font-medium text-primary">Powered by AI</span>
                </div>
              </div>

              <h1 className="text-5xl sm:text-6xl lg:text-7xl font-bold text-foreground mb-6 leading-[1.2] tracking-tight">
                Write better research papers in minutes
              </h1>

              <p className="text-lg sm:text-xl text-muted-foreground mb-12 max-w-2xl mx-auto leading-relaxed">
                GenPaper helps you create well-structured, properly cited papers — with sources you can trust. From
                topic to finished paper, effortlessly.
              </p>

              <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-12">
                {user ? (
                  <Button
                    size="lg"
                    className="bg-primary hover:bg-primary/90 text-primary-foreground px-8 py-6 text-base rounded-lg shadow-lg transition-all duration-300 hover:shadow-xl"
                    asChild
                  >
                    <Link href="/projects">
                      Start New Paper
                      <ArrowRight className="ml-2 h-5 w-5" />
                    </Link>
                  </Button>
                ) : (
                  <>
                    <Button
                      size="lg"
                      className="bg-primary hover:bg-primary/90 text-primary-foreground px-8 py-6 text-base rounded-lg shadow-lg transition-all duration-300 hover:shadow-xl"
                      asChild
                    >
                      <Link href="/signup">
                        Get Started
                        <ArrowRight className="ml-2 h-5 w-5" />
                      </Link>
                    </Button>
                    <Button
                      size="lg"
                      variant="outline"
                      className="px-8 py-6 text-base rounded-lg border border-border text-foreground hover:bg-muted transition-all duration-300 bg-transparent"
                      asChild
                    >
                      <Link href="/login">Sign In</Link>
                    </Button>
                  </>
                )}
              </div>

              <div className="flex flex-wrap items-center justify-center gap-6 text-sm text-muted-foreground">
                <div className="flex items-center gap-2">
                  <CheckCircle className="w-4 h-4 text-primary" />
                  <span>No credit card required</span>
                </div>
                <div className="flex items-center gap-2">
                  <CheckCircle className="w-4 h-4 text-primary" />
                  <span>Instant results</span>
                </div>
                <div className="flex items-center gap-2">
                  <CheckCircle className="w-4 h-4 text-primary" />
                  <span>Perfect citations</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="features" className="py-24 bg-muted/30 scroll-mt-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-4xl font-bold text-foreground mb-4">Everything for research excellence</h2>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
              Comprehensive AI-powered tools designed to streamline your academic writing workflow.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            <Card className="border border-border hover:border-primary/30 bg-card transition-colors duration-200 rounded-lg">
              <CardHeader>
                <div className="w-12 h-12 bg-primary/10 rounded-lg flex items-center justify-center mb-4">
                  <Brain className="h-6 w-6 text-primary" />
                </div>
                <CardTitle className="text-foreground">Write Full Papers</CardTitle>
                <CardDescription className="text-muted-foreground">
                  Just enter your topic. GenPaper writes complete papers with introduction, analysis, and conclusion.
                </CardDescription>
              </CardHeader>
            </Card>

            <Card className="border border-border hover:border-primary/30 bg-card transition-colors duration-200 rounded-lg">
              <CardHeader>
                <div className="w-12 h-12 bg-primary/10 rounded-lg flex items-center justify-center mb-4">
                  <Search className="h-6 w-6 text-primary" />
                </div>
                <CardTitle className="text-foreground">Find Trusted Sources</CardTitle>
                <CardDescription className="text-muted-foreground">
                  Access real academic papers and journals. No more unreliable search results.
                </CardDescription>
              </CardHeader>
            </Card>

            <Card className="border border-border hover:border-primary/30 bg-card transition-colors duration-200 rounded-lg">
              <CardHeader>
                <div className="w-12 h-12 bg-primary/10 rounded-lg flex items-center justify-center mb-4">
                  <FileText className="h-6 w-6 text-primary" />
                </div>
                <CardTitle className="text-foreground">Perfect Citations</CardTitle>
                <CardDescription className="text-muted-foreground">
                  Automatic APA, MLA, and Chicago formatting — correct every time.
                </CardDescription>
              </CardHeader>
            </Card>

            <Card className="border border-border hover:border-primary/30 bg-card transition-colors duration-200 rounded-lg">
              <CardHeader>
                <div className="w-12 h-12 bg-primary/10 rounded-lg flex items-center justify-center mb-4">
                  <BookOpen className="h-6 w-6 text-primary" />
                </div>
                <CardTitle className="text-foreground">Organize Everything</CardTitle>
                <CardDescription className="text-muted-foreground">
                  Save, organize, and revisit all your papers and sources in one place.
                </CardDescription>
              </CardHeader>
            </Card>

            <Card className="border border-border hover:border-primary/30 bg-card transition-colors duration-200 rounded-lg">
              <CardHeader>
                <div className="w-12 h-12 bg-primary/10 rounded-lg flex items-center justify-center mb-4">
                  <Clock className="h-6 w-6 text-primary" />
                </div>
                <CardTitle className="text-foreground">Version History</CardTitle>
                <CardDescription className="text-muted-foreground">
                  Go back to any draft. GenPaper keeps all versions safe and organized.
                </CardDescription>
              </CardHeader>
            </Card>

            <Card className="border border-border hover:border-primary/30 bg-card transition-colors duration-200 rounded-lg">
              <CardHeader>
                <div className="w-12 h-12 bg-primary/10 rounded-lg flex items-center justify-center mb-4">
                  <Shield className="h-6 w-6 text-primary" />
                </div>
                <CardTitle className="text-foreground">Private & Secure</CardTitle>
                <CardDescription className="text-muted-foreground">
                  Your work stays private. We never share or train on your content.
                </CardDescription>
              </CardHeader>
            </Card>
          </div>
        </div>
      </section>

      <section id="benefits" className="py-24 bg-background scroll-mt-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
            <div>
              <h2 className="text-4xl font-bold text-foreground mb-6">Focus on your ideas</h2>
              <p className="text-lg text-muted-foreground mb-8">
                Let GenPaper handle the technical work while you focus on what matters most — your research and
                arguments.
              </p>

              <div className="space-y-6">
                <div className="flex items-start gap-4">
                  <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center flex-shrink-0 mt-1">
                    <Zap className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-foreground mb-2">Save Hours of Work</h3>
                    <p className="text-muted-foreground">Generate complete research papers in minutes, not days.</p>
                  </div>
                </div>

                <div className="flex items-start gap-4">
                  <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center flex-shrink-0 mt-1">
                    <Users className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-foreground mb-2">For Any Assignment</h3>
                    <p className="text-muted-foreground">
                      Essays, reports, literature reviews, theses — GenPaper adapts to your needs.
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-4">
                  <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center flex-shrink-0 mt-1">
                    <Shield className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-foreground mb-2">Trustworthy & Transparent</h3>
                    <p className="text-muted-foreground">
                      All sources are verified. You can see exactly where information comes from.
                    </p>
                  </div>
                </div>
              </div>
            </div>

            <div className="relative">
              <div className="bg-gradient-to-br from-primary/5 to-primary/10 rounded-2xl p-8 border border-border">
                <div className="space-y-6">
                  <div className="bg-background/80 backdrop-blur-sm rounded-lg p-4 border border-border">
                    <div className="flex items-center gap-3 mb-3">
                      <div className="w-3 h-3 bg-primary rounded-full"></div>
                      <span className="text-sm font-medium text-foreground">Research Complete</span>
                    </div>
                    <div className="bg-muted rounded-full h-2 mb-2 overflow-hidden">
                      <div className="bg-primary h-2 rounded-full w-full"></div>
                    </div>
                    <p className="text-sm text-muted-foreground">Found 47 relevant sources</p>
                  </div>

                  <div className="bg-background/80 backdrop-blur-sm rounded-lg p-4 border border-border">
                    <div className="flex items-center gap-3 mb-3">
                      <div className="w-3 h-3 bg-primary rounded-full animate-pulse"></div>
                      <span className="text-sm font-medium text-foreground">Formatting...</span>
                    </div>
                    <div className="bg-muted rounded-full h-2 mb-2 overflow-hidden">
                      <div className="bg-primary h-2 rounded-full w-3/4 animate-pulse"></div>
                    </div>
                    <p className="text-sm text-muted-foreground">Processing APA format</p>
                  </div>

                  <div className="text-center pt-4">
                    <p className="text-sm text-muted-foreground">Your paper will be ready shortly...</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Pricing Section */}
      <section id="pricing" className="py-24 bg-muted/30 scroll-mt-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <h2 className="text-4xl font-bold text-foreground mb-4">Simple, transparent pricing</h2>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto mb-8">
              Choose the plan that fits your research needs. Start free, upgrade anytime.
            </p>
            
            {/* Billing Interval Toggle */}
            <div className="flex items-center justify-center gap-3">
              <span className={`text-sm font-medium ${billingInterval === 'monthly' ? 'text-foreground' : 'text-muted-foreground'}`}>
                Monthly
              </span>
              <Switch
                checked={billingInterval === 'yearly'}
                onCheckedChange={(checked) => setBillingInterval(checked ? 'yearly' : 'monthly')}
              />
              <span className={`text-sm font-medium ${billingInterval === 'yearly' ? 'text-foreground' : 'text-muted-foreground'}`}>
                Yearly
              </span>
              <Badge variant="secondary" className="ml-2">
                Save 33%
              </Badge>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-5xl mx-auto">
            {/* Free Tier */}
            <PricingCard tier="free" icon={<Sparkles className="h-6 w-6" />} user={user} billingInterval={billingInterval} />
            
            {/* Starter Tier */}
            <PricingCard tier="starter" icon={<Zap className="h-6 w-6" />} user={user} billingInterval={billingInterval} />
            
            {/* Pro Tier */}
            <PricingCard tier="pro" icon={<Crown className="h-6 w-6" />} user={user} billingInterval={billingInterval} recommended />
          </div>

          <div className="text-center mt-8">
            <Link href="/pricing" className="text-sm text-primary hover:underline">
              View full comparison →
            </Link>
          </div>
        </div>
      </section>

      <section className="py-24 bg-background">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-4xl font-bold text-foreground mb-6">
            {user ? "Ready to continue?" : "Start writing smarter today"}
          </h2>
          <p className="text-lg text-muted-foreground mb-12">
            {user
              ? "Pick up where you left off or start a new project."
              : "No setup required. Free to start — no credit card needed."}
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-8">
            {user ? (
              <>
                <Button
                  size="lg"
                  className="bg-primary hover:bg-primary/90 text-primary-foreground px-8 py-6 text-base rounded-lg shadow-lg transition-all duration-300"
                  asChild
                >
                  <Link href="/projects">
                    Start New Paper
                    <ArrowRight className="ml-2 h-5 w-5" />
                  </Link>
                </Button>
                <Button
                  size="lg"
                  variant="outline"
                  className="px-8 py-6 text-base rounded-lg border border-border text-foreground hover:bg-muted transition-all duration-300 bg-transparent"
                  asChild
                >
                  <Link href="/projects">View Projects</Link>
                </Button>
              </>
            ) : (
              <>
                <Button
                  size="lg"
                  className="bg-primary hover:bg-primary/90 text-primary-foreground px-8 py-6 text-base rounded-lg shadow-lg transition-all duration-300"
                  asChild
                >
                  <Link href="/signup">
                    Write Your First Paper
                    <ArrowRight className="ml-2 h-5 w-5" />
                  </Link>
                </Button>
                <Button
                  size="lg"
                  variant="outline"
                  className="px-8 py-6 text-base rounded-lg border border-border text-foreground hover:bg-muted transition-all duration-300 bg-transparent"
                  asChild
                >
                  <Link href="/login">Sign In</Link>
                </Button>
              </>
            )}
          </div>

          <p className="text-sm text-muted-foreground">
            {user ? "All work is automatically saved." : "Join thousands of researchers worldwide"}
          </p>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border bg-background">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <div className="flex flex-col md:flex-row justify-between items-center">
            <div className="flex items-center space-x-3 mb-4 md:mb-0">
              <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center p-1.5">
                <Image 
                  src="/favicon-32x32.png" 
                  alt="GenPaper" 
                  width={20} 
                  height={20} 
                  className="w-full h-full"
                />
              </div>
              <div>
                <span className="text-lg font-bold text-foreground block">GenPaper</span>
                <span className="text-xs text-muted-foreground">AI-Powered Research Assistant</span>
              </div>
            </div>

            <div className="flex items-center space-x-6 text-sm text-muted-foreground">
              <Link href="/pricing" className="hover:text-foreground transition-colors">
                Pricing
              </Link>
              <a href="#" className="hover:text-foreground transition-colors">
                Privacy
              </a>
              <a href="#" className="hover:text-foreground transition-colors">
                Terms
              </a>
              <a href="#" className="hover:text-foreground transition-colors">
                Support
              </a>
            </div>
          </div>

          <div className="border-t border-border mt-8 pt-8 text-center text-sm text-muted-foreground">
            <p>&copy; 2025 GenPaper. Built for researchers, by researchers.</p>
          </div>
        </div>
      </footer>
    </div>
  )
}

// Pricing Card Component for landing page
function PricingCard({
  tier,
  icon,
  user,
  billingInterval,
  recommended,
}: {
  tier: SubscriptionTier
  icon: React.ReactNode
  user: User | null
  billingInterval: BillingInterval
  recommended?: boolean
}) {
  const config = TIER_CONFIG[tier]
  
  // Calculate display price based on billing interval
  const isYearly = billingInterval === 'yearly'
  const displayPrice = tier === 'free' 
    ? 0 
    : isYearly 
      ? Math.round(config.yearlyPrice / 12) // Effective monthly price
      : config.price
  const yearlyTotal = config.yearlyPrice
  const monthlyTotal = config.price * 12
  const savings = monthlyTotal - yearlyTotal
  
  const getButtonProps = () => {
    if (tier === 'free') {
      return {
        href: user ? '/projects' : '/signup',
        text: user ? 'Current Plan' : 'Get Started Free',
      }
    }
    
    // For paid tiers, go directly to checkout (works for both logged in and out)
    const checkoutUrl = getCheckoutUrl(tier as 'starter' | 'pro', {
      email: user?.email || undefined,
      userId: user?.id || undefined,
      interval: billingInterval,
    })
    
    return {
      href: checkoutUrl,
      text: `Get ${config.name}`,
    }
  }
  
  const { href, text } = getButtonProps()
  
  return (
    <Card className={`relative ${recommended ? 'border-primary border-2' : 'border-border'}`}>
      {recommended && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2">
          <span className="bg-primary text-primary-foreground text-xs font-medium px-3 py-1 rounded-full">
            Most Popular
          </span>
        </div>
      )}
      <CardHeader className="text-center pb-2">
        <div className={`w-12 h-12 mx-auto rounded-lg flex items-center justify-center mb-4 ${
          recommended ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'
        }`}>
          {icon}
        </div>
        <CardTitle className="text-xl">{config.name}</CardTitle>
        <CardDescription>{config.description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="text-center">
          <span className="text-4xl font-bold">${displayPrice}</span>
          {displayPrice > 0 && (
            <span className="text-muted-foreground">/month</span>
          )}
          {tier !== 'free' && isYearly && (
            <div className="mt-1">
              <span className="text-sm text-muted-foreground">
                ${yearlyTotal}/yr
              </span>
              <span className="text-xs text-green-600 ml-2">
                Save ${savings}
              </span>
            </div>
          )}
        </div>
        
        <ul className="space-y-3">
          {config.features.slice(0, 4).map((feature, i) => (
            <li key={i} className="flex items-start gap-3 text-sm">
              <CheckCircle className="h-4 w-4 text-green-500 mt-0.5 shrink-0" />
              <span>{feature}</span>
            </li>
          ))}
        </ul>
        
        <Button
          className="w-full"
          variant={recommended ? 'default' : 'outline'}
          size="lg"
          asChild
        >
          <Link href={href}>{text}</Link>
        </Button>
      </CardContent>
    </Card>
  )
}
