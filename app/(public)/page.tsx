import { createClient } from '@/lib/supabase/server'
import { LandingPageClient } from '@/components/landing/LandingPageClient'

export default async function LandingPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  return <LandingPageClient user={user} />
}
