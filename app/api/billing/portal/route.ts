import { CustomerPortal } from '@polar-sh/nextjs'
import { type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getUserSubscription } from '@/lib/billing/subscription-service'

/**
 * Polar Customer Portal Route
 * 
 * Redirects authenticated users to Polar's customer portal
 * where they can manage their subscription, view invoices, etc.
 */
export const GET = CustomerPortal({
  accessToken: process.env.POLAR_ACCESS_TOKEN!,
  server: process.env.NODE_ENV === 'production' ? 'production' : 'sandbox',
  getCustomerId: async (req: NextRequest) => {
    // Get authenticated user
    const supabase = await createClient()
    const { data: { user }, error } = await supabase.auth.getUser()
    
    if (error || !user) {
      throw new Error('Unauthorized')
    }
    
    // Get their Polar customer ID
    const subscription = await getUserSubscription(user.id)
    
    if (!subscription?.polarCustomerId) {
      throw new Error('No subscription found')
    }
    
    return subscription.polarCustomerId
  },
})
