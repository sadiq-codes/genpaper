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
import { TIER_CONFIG, PAPER_PRICE } from "@/types/subscription"
import type { SubscriptionTier, BillingInterval } from "@/types/subscription"
import { getCheckoutUrl, getPaperCreditCheckoutUrl } from "@/lib/hooks/use-subscription"
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
    
    // Go directly to checkout (Polar handles auth)
    window.location.href = getCheckoutUrl(tier as 'starter' | 'pro', {
      email: user?.email || undefined,
      userId: user?.id || undefined,
      interval: billingInterval,
    })
  }

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
                className="text-foreground font-medium text-sm"
              >
                Pricing
              </Link>
              {user ? (
                <Link href="/projects" className="bg-foreground text-background hover:bg-foreground/90 rounded-full px-5 py-2 text-sm font-medium transition-colors inline-flex items-center gap-1.5">
                    Dashboard
                    <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              ) : (
                <>
                  <Link
                    href="/login"
                    className="text-muted-foreground hover:text-foreground transition-colors text-sm font-medium"
                  >
                    Sign In
                  </Link>
                  <Link href="/signup" className="bg-foreground text-background hover:bg-foreground/90 rounded-full px-5 py-2 text-sm font-medium transition-colors">
                    Get Started
                  </Link>
                </>
              )}
            </div>

            <button
              className="md:hidden p-2 rounded-lg hover:bg-muted transition-colors"
              aria-label="Toggle menu"
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
                  <Link href="/projects" className="bg-foreground text-background hover:bg-foreground/90 rounded-full px-5 py-2 text-sm font-medium transition-colors inline-flex items-center gap-1.5 w-fit">
                    Dashboard
                    <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                ) : (
                  <>
                    <Link
                      href="/login"
                      className="text-muted-foreground hover:text-foreground transition-colors font-medium px-2 py-2"
                      onClick={() => setMobileMenuOpen(false)}
                    >
                      Sign In
                    </Link>
                    <Link href="/signup" className="bg-foreground text-background hover:bg-foreground/90 rounded-full px-5 py-2 text-sm font-medium transition-colors w-fit">
                      Get Started
                    </Link>
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
          <h1 className="font-instrument text-4xl sm:text-5xl tracking-tight text-foreground mb-4">
            Simple, transparent pricing
          </h1>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto mb-8">
            Pay per paper or subscribe for more value. No hidden fees.
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

      {/* Pay Per Paper - Hero Card */}
      <section className="pb-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <Card className="max-w-2xl mx-auto border-2 border-amber-500/50 bg-gradient-to-br from-amber-500/5 to-transparent">
            <CardContent className="p-8">
              <div className="flex flex-col md:flex-row items-center justify-between gap-6">
                <div className="text-center md:text-left">
                  <Badge className="bg-amber-500/10 text-amber-600 hover:bg-amber-500/20 mb-3">
                    Pay As You Go
                  </Badge>
                  <h3 className="text-2xl font-bold mb-2">Single Paper</h3>
                  <p className="text-muted-foreground mb-4">
                    One-time purchase for a single paper generation. No commitment.
                  </p>
                  <ul className="text-sm text-muted-foreground space-y-1">
                    <li className="flex items-center gap-2">
                      <CheckCircle className="h-4 w-4 text-green-500" />
                      All paper types available
                    </li>
                    <li className="flex items-center gap-2">
                      <CheckCircle className="h-4 w-4 text-green-500" />
                      Full references & export
                    </li>
                    <li className="flex items-center gap-2">
                      <CheckCircle className="h-4 w-4 text-green-500" />
                      Never expires
                    </li>
                  </ul>
                </div>
                <div className="text-center">
                  <div className="text-4xl font-bold mb-1">${PAPER_PRICE}</div>
                  <div className="text-sm text-muted-foreground mb-4">per paper</div>
                  <Button 
                    size="lg" 
                    className="bg-amber-500 hover:bg-amber-600 text-white"
                    onClick={() => {
                      if (!user) {
                        // Redirect to signup first
                        window.location.href = '/signup'
                      } else {
                        window.location.href = getPaperCreditCheckoutUrl()
                      }
                    }}
                  >
                    {user ? 'Buy Paper' : 'Sign Up to Purchase'}
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </section>

      {/* Subscription Plans */}
      <section className="pb-24">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-8">
            <h2 className="text-xl font-semibold text-foreground mb-2">Or subscribe for more value</h2>
            <p className="text-muted-foreground">Best for researchers who generate multiple papers</p>
          </div>
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
          <h2 className="font-instrument text-3xl text-center tracking-tight text-foreground mb-12">
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
                  feature="Papers included"
                  free="0 (buy credits)"
                  starter="5/month"
                  pro="15/month"
                />
                <ComparisonRow
                  feature="Cost per paper"
                  free={`$${PAPER_PRICE}`}
                  starter="~$4/paper"
                  pro="~$3.30/paper"
                />
                <ComparisonRow
                  feature="Paper types"
                  free="All types"
                  starter="All types"
                  pro="All types"
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
                  free={true}
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
          <h2 className="font-instrument text-3xl text-center tracking-tight text-foreground mb-12">
            Frequently asked questions
          </h2>
          
          <div className="space-y-6">
            <FaqItem
              question="How does pay-per-paper work?"
              answer={`You can buy individual papers for $${PAPER_PRICE} each. Purchased papers never expire and can be used anytime you're ready to generate.`}
            />
            <FaqItem
              question="What's the difference between buying papers and subscribing?"
              answer="Buying papers is a one-time purchase with no commitment - great for occasional use. Subscriptions give you monthly papers plus unlimited AI chat and autocomplete - better value if you generate papers regularly."
            />
            <FaqItem
              question="Can I cancel my subscription anytime?"
              answer="Yes, you can cancel your subscription at any time. You'll continue to have access to your plan until the end of your billing period. Any purchased papers will remain in your account."
            />
            <FaqItem
              question="What payment methods do you accept?"
              answer="We accept all major credit cards (Visa, Mastercard, American Express) through our secure payment provider Polar."
            />
            <FaqItem
              question="What happens to my papers if I downgrade?"
              answer="All your papers are saved forever. If you downgrade, you'll still have access to view and edit your existing papers. Any purchased papers remain available."
            />
            <FaqItem
              question="Do you offer student discounts?"
              answer={`Our pay-per-paper option at $${PAPER_PRICE} is designed to be accessible for students who only need occasional papers. For regular use, our Starter plan offers better value.`}
            />
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-24 bg-muted/30">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="font-instrument text-3xl tracking-tight text-foreground mb-4">
            Ready to write better papers?
          </h2>
          <p className="text-lg text-muted-foreground mb-8">
            Create an account and generate your first paper for just ${PAPER_PRICE}.
          </p>
          <Link href="/signup" className="bg-foreground text-background hover:bg-foreground/90 rounded-full px-8 py-3 text-base font-medium transition-colors inline-flex items-center gap-2">
            Get Started
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border bg-background">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <div className="flex flex-col md:flex-row justify-between items-center">
            <div className="flex items-center gap-2.5 mb-4 md:mb-0">
              <Image
                src="/favicon-32x32.png"
                alt="GenPaper"
                width={20}
                height={20}
                className="dark:invert"
              />
              <span className="text-sm font-medium text-foreground/80">GenPaper</span>
              <span className="text-xs text-muted-foreground/50 ml-1">— AI Research Assistant</span>
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
            <p>&copy; {new Date().getFullYear()} GenPaper</p>
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
    <Card className={`relative ${recommended ? 'border-accent border-2' : ''}`}>
      {recommended && (
        <Badge className="absolute -top-3 left-1/2 -translate-x-1/2 bg-accent text-accent-foreground hover:bg-accent/90">
          Most Popular
        </Badge>
      )}
      <CardHeader className="text-center pb-2">
        <div className={`w-12 h-12 mx-auto rounded-lg flex items-center justify-center mb-4 ${
          recommended ? 'bg-accent/10 text-accent' : 'bg-muted text-muted-foreground'
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
            ? (isLoggedIn ? 'Current Plan' : 'Create Free Account')
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
