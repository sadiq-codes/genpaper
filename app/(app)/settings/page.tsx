import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { redirect } from 'next/navigation'
import { PageContainer } from '@/components/ui/page-container'
import { PageHeader } from '@/components/ui/page-header'
import { SettingsPage as SettingsPageClient } from '@/components/settings/settings-page'
import { TIER_CONFIG } from '@/types/subscription'
import type { SubscriptionTier } from '@/types/subscription'

export const metadata = {
  title: 'Settings | GenPaper',
  description: 'Manage your account settings and preferences',
}

export default async function SettingsPage() {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  
  if (authError || !user) {
    redirect('/login')
  }

  // Fetch preferences and profile (with subscription fields) in parallel
  // Include subscription fields to avoid a second profiles query when billing section loads
  const serviceClient = createServiceClient()
  
  const [prefsResult, profileResult] = await Promise.all([
    serviceClient
      .from('user_preferences')
      .select('*')
      .eq('user_id', user.id)
      .single(),
    serviceClient
      .from('profiles')
      .select('full_name, created_at, subscription_tier, papers_used_this_period, period_ends_at')
      .eq('id', user.id)
      .single()
  ])
  
  const prefs = prefsResult.data
  const profile = profileResult.data

  // Build user data
  const userData = {
    id: user.id,
    email: user.email || '',
    fullName: profile?.full_name || null,
    createdAt: profile?.created_at || user.created_at || new Date().toISOString()
  }

  // Build preferences with defaults
  const preferences = {
    citationStyle: prefs?.citation_style || 'apa',
    defaultPaperType: prefs?.default_paper_type || 'literatureReview',
    autoSuggestions: prefs?.auto_suggestions ?? true,
    includeCitations: prefs?.include_citations || false,
    acceptKey: (prefs?.accept_key || 'tab') as 'tab' | 'ctrlEnter',
    useExternalSources: prefs?.use_external_sources ?? false,
    fontSize: prefs?.font_size || 'medium',
  }

  // Build subscription data from the same profiles query (no extra round-trip)
  const tier = (profile?.subscription_tier || 'free') as SubscriptionTier
  const tierConfig = TIER_CONFIG[tier]
  const papersUsed = profile?.papers_used_this_period || 0
  const subscriptionData = {
    tier,
    tierName: tierConfig.name,
    papersUsed,
    papersLimit: tierConfig.limits.papersPerMonth,
    papersRemaining: Math.max(0, tierConfig.limits.papersPerMonth - papersUsed),
    periodEndsAt: profile?.period_ends_at || null,
    features: tierConfig.features,
  }

  return (
    <PageContainer>
      <PageHeader title="Settings" />
      
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-5xl mx-auto space-y-6">
          <div className="space-y-1">
            <h2 className="font-instrument text-3xl tracking-tight">Settings</h2>
            <p className="text-[13px] text-muted-foreground">
              Manage your account, preferences, and billing.
            </p>
          </div>
          <SettingsPageClient 
            user={userData}
            preferences={preferences}
            subscription={subscriptionData}
          />
        </div>
      </div>
    </PageContainer>
  )
}
