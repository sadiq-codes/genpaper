import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { getUserPreferences } from '@/lib/citations/citation-settings'
import { PageContainer } from '@/components/ui/page-container'
import { PageHeader } from '@/components/ui/page-header'
import { SettingsForm } from '@/components/settings/settings-form'

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

  // Get user preferences
  const preferences = await getUserPreferences(user.id)

  return (
    <PageContainer>
      <PageHeader
        title="Settings"
        description="Manage your account settings and preferences"
      />
      
      <div className="max-w-2xl">
        <SettingsForm 
          initialCitationStyle={preferences.citationStyle}
        />
      </div>
    </PageContainer>
  )
}
