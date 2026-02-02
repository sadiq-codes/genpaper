import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { redirect } from 'next/navigation'
import { PageContainer } from '@/components/ui/page-container'
import { PageHeader } from '@/components/ui/page-header'
import { SettingsPage as SettingsPageClient } from '@/components/settings/settings-page'

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

  // Fetch preferences and profile in parallel using service client
  const serviceClient = createServiceClient()
  
  const [prefsResult, profileResult] = await Promise.all([
    serviceClient
      .from('user_preferences')
      .select('*')
      .eq('user_id', user.id)
      .single(),
    serviceClient
      .from('profiles')
      .select('full_name, created_at')
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
    autoSuggestions: prefs?.auto_suggestions || false,
    includeCitations: prefs?.include_citations || false,
    acceptKey: (prefs?.accept_key || 'tab') as 'tab' | 'ctrlEnter',
    fontSize: prefs?.font_size || 'medium',
  }

  return (
    <PageContainer>
      <PageHeader
        title="Settings"
        description="Manage your account settings and preferences"
      />
      
      <SettingsPageClient 
        user={userData}
        preferences={preferences}
      />
    </PageContainer>
  )
}
