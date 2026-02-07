"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import Image from "next/image"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import {
  CheckCircle,
  ArrowRight,
  Sparkles,
  Zap,
  Crown,
  Menu,
  X,
} from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import type { User } from "@supabase/supabase-js"
import { TIER_CONFIG } from "@/types/subscription"
import type { SubscriptionTier, BillingInterval } from "@/types/subscription"
import { getCheckoutUrl } from "@/lib/hooks/use-subscription"
import { Switch } from "@/components/ui/switch"

export default function PricingPage() {
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

  const handleGetStarted = (tier: SubscriptionTier) => {
    if (tier === 'free') {
      window.location.href = '/signup'
      return
    }
    
    if (user) {
      // Redirect to checkout with user info
      window.location.href = getCheckoutUrl(tier as 'starter' | 'pro', {
        email: user.email || '',
        userId: user.id,
        interval: billingInterval,
      })
    } else {
      // Redirect to signup, they can upgrade after
      window.location.href = '/signup'
    }
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Navigation */}
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
              <Link
                href="/#features"
                className="text-muted-foreground hover:text-foreground transition-colors text-sm font-medium"
              >
                Features
              </Link>
              <Link
                href="/pricing"
                className="text-foreground font-medium text-sm"
              >
                Pricing
              </Link>
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
                <Link
                  href="/#features"
                  className="text-muted-foreground hover:text-foreground transition-colors font-medium px-2 py-2"
                  onClick={() => setMobileMenuOpen(false)}
                >
                  Features
                </Link>
                <Link
                  href="/pricing"
                  className="text-foreground font-medium px-2 py-2"
                  onClick={() => setMobileMenuOpen(false)}
                >
                  Pricing
                </Link>
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

      {/* Hero Section */}
      <section className="pt-32 pb-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h1 className="text-4xl sm:text-5xl font-bold text-foreground mb-4">
            Simple, transparent pricing
          </h1>
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
      </section>

      {/* Pricing Cards */}
      <section className="pb-24">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-5xl mx-auto">
            {/* Free Tier */}
            <PricingCard
              tier="free"
              icon={<Sparkles className="h-6 w-6" />}
              onGetStarted={() => handleGetStarted('free')}
              isLoggedIn={!!user}
              billingInterval={billingInterval}
            />
            
            {/* Starter Tier */}
            <PricingCard
              tier="starter"
              icon={<Zap className="h-6 w-6" />}
              onGetStarted={() => handleGetStarted('starter')}
              isLoggedIn={!!user}
              billingInterval={billingInterval}
            />
            
            {/* Pro Tier */}
            <PricingCard
              tier="pro"
              icon={<Crown className="h-6 w-6" />}
              onGetStarted={() => handleGetStarted('pro')}
              isLoggedIn={!!user}
              billingInterval={billingInterval}
              recommended
            />
          </div>
        </div>
      </section>

      {/* Feature Comparison */}
      <section className="py-24 bg-muted/30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-3xl font-bold text-center text-foreground mb-12">
            Compare plans
          </h2>
          
          <div className="overflow-x-auto">
            <table className="w-full max-w-4xl mx-auto">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-4 px-4 font-medium text-muted-foreground">Feature</th>
                  <th className="text-center py-4 px-4 font-medium">Free</th>
                  <th className="text-center py-4 px-4 font-medium">Starter</th>
                  <th className="text-center py-4 px-4 font-medium">Pro</th>
                </tr>
              </thead>
              <tbody className="text-sm">
                <ComparisonRow
                  feature="Papers per month"
                  free="1"
                  starter="5"
                  pro="15"
                />
                <ComparisonRow
                  feature="Paper types"
                  free="Literature Review"
                  starter="Reviews, Articles, Capstones"
                  pro="All types incl. Theses"
                />
                <ComparisonRow
                  feature="Paper length"
                  free="Short"
                  starter="Short & Medium"
                  pro="All lengths"
                />
                <ComparisonRow
                  feature="References visible"
                  free="3 (rest blurred)"
                  starter="All"
                  pro="All"
                />
                <ComparisonRow
                  feature="AI chat"
                  free="10/day"
                  starter="Unlimited"
                  pro="Unlimited"
                />
                <ComparisonRow
                  feature="Autocomplete"
                  free="10/day"
                  starter="Unlimited"
                  pro="Unlimited"
                />
                <ComparisonRow
                  feature="PDF export"
                  free={false}
                  starter={true}
                  pro={true}
                />
                <ComparisonRow
                  feature="Priority generation"
                  free={false}
                  starter={false}
                  pro={true}
                />
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* FAQ Section */}
      <section className="py-24">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-3xl font-bold text-center text-foreground mb-12">
            Frequently asked questions
          </h2>
          
          <div className="space-y-6">
            <FaqItem
              question="Can I cancel anytime?"
              answer="Yes, you can cancel your subscription at any time. You'll continue to have access to your current plan until the end of your billing period."
            />
            <FaqItem
              question="What payment methods do you accept?"
              answer="We accept all major credit cards (Visa, Mastercard, American Express) through our secure payment provider Polar."
            />
            <FaqItem
              question="What happens to my papers if I downgrade?"
              answer="All your papers are saved forever. If you downgrade, you'll still have access to view and edit your existing papers, but you'll be limited to the features of your new plan for new papers."
            />
            <FaqItem
              question="Can I upgrade mid-month?"
              answer="Yes! When you upgrade, you'll immediately get access to the new plan's features. You'll be charged the prorated difference for the remainder of your billing period."
            />
            <FaqItem
              question="Do you offer student discounts?"
              answer="We're working on student pricing. In the meantime, our Free tier is a great way to get started, and our Starter plan is designed to be affordable for students."
            />
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-24 bg-muted/30">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-3xl font-bold text-foreground mb-4">
            Ready to write better papers?
          </h2>
          <p className="text-lg text-muted-foreground mb-8">
            Start with our free plan. No credit card required.
          </p>
          <Button
            size="lg"
            className="bg-primary hover:bg-primary/90 text-primary-foreground px-8 py-6 text-base rounded-lg"
            asChild
          >
            <Link href="/signup">
              Get Started Free
              <ArrowRight className="ml-2 h-5 w-5" />
            </Link>
          </Button>
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

function PricingCard({
  tier,
  icon,
  onGetStarted,
  isLoggedIn,
  billingInterval,
  recommended,
}: {
  tier: SubscriptionTier
  icon: React.ReactNode
  onGetStarted: () => void
  isLoggedIn: boolean
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
  
  return (
    <Card className={`relative ${recommended ? 'border-primary border-2' : ''}`}>
      {recommended && (
        <Badge className="absolute -top-3 left-1/2 -translate-x-1/2">
          Most Popular
        </Badge>
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
                ${yearlyTotal} billed yearly
              </span>
              <span className="text-xs text-green-600 ml-2">
                Save ${savings}
              </span>
            </div>
          )}
          {tier !== 'free' && !isYearly && (
            <div className="mt-1">
              <span className="text-sm text-muted-foreground">
                billed monthly
              </span>
            </div>
          )}
        </div>
        
        <ul className="space-y-3">
          {config.features.map((feature, i) => (
            <li key={i} className="flex items-start gap-3 text-sm">
              <CheckCircle className="h-4 w-4 text-green-500 mt-0.5 shrink-0" />
              <span>{feature}</span>
            </li>
          ))}
        </ul>
        
        <Button
          onClick={onGetStarted}
          className="w-full"
          variant={recommended ? 'default' : 'outline'}
          size="lg"
        >
          {tier === 'free' 
            ? (isLoggedIn ? 'Current Plan' : 'Get Started Free')
            : `Get ${config.name}`
          }
        </Button>
      </CardContent>
    </Card>
  )
}

function ComparisonRow({
  feature,
  free,
  starter,
  pro,
}: {
  feature: string
  free: string | boolean
  starter: string | boolean
  pro: string | boolean
}) {
  const renderValue = (value: string | boolean) => {
    if (typeof value === 'boolean') {
      return value ? (
        <CheckCircle className="h-5 w-5 text-green-500 mx-auto" />
      ) : (
        <span className="text-muted-foreground">-</span>
      )
    }
    return <span>{value}</span>
  }
  
  return (
    <tr className="border-b border-border">
      <td className="py-4 px-4 text-muted-foreground">{feature}</td>
      <td className="py-4 px-4 text-center">{renderValue(free)}</td>
      <td className="py-4 px-4 text-center">{renderValue(starter)}</td>
      <td className="py-4 px-4 text-center">{renderValue(pro)}</td>
    </tr>
  )
}

function FaqItem({
  question,
  answer,
}: {
  question: string
  answer: string
}) {
  return (
    <div className="border-b border-border pb-6">
      <h3 className="font-semibold text-foreground mb-2">{question}</h3>
      <p className="text-muted-foreground">{answer}</p>
    </div>
  )
}
