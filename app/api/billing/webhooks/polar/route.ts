import { Webhooks } from '@polar-sh/nextjs'
import {
  updateSubscription,
  linkPolarCustomer,
  resetPaperUsage,
  downgradeToFree,
  logSubscriptionEvent,
  getUserIdByPolarCustomerId,
  getUserIdByEmail,
  getUserSubscription,
  getTierFromPolarProduct,
} from '@/lib/billing/subscription-service'
import type { SubscriptionTier } from '@/types/subscription'
import { info, warn, error as logError } from '@/lib/utils/logger'

/**
 * Polar Webhook Handler
 * 
 * Handles all Polar subscription lifecycle events.
 * Updates our database to reflect subscription changes.
 */
export const POST = Webhooks({
  webhookSecret: process.env.POLAR_WEBHOOK_SECRET!,
  
  // ==========================================================================
  // Subscription Created
  // ==========================================================================
  onSubscriptionCreated: async (payload) => {
    info({ payload: payload.type }, 'Polar webhook: subscription created')
    
    const subscription = payload.data
    const customerId = subscription.customerId
    const customerEmail = subscription.customer?.email
    
    // Find user by Polar customer ID or email
    let userId = await getUserIdByPolarCustomerId(customerId)
    
    if (!userId && customerEmail) {
      userId = await getUserIdByEmail(customerEmail)
      if (userId) {
        // Link Polar customer to our user
        await linkPolarCustomer(userId, customerId)
      }
    }
    
    if (!userId) {
      warn({ customerId, customerEmail }, 'Could not find user for subscription')
      return
    }
    
    // Determine tier from product
    const productId = subscription.productId
    const tier = getTierFromPolarProduct(productId)
    
    // Update subscription
    await updateSubscription({
      userId,
      tier,
      status: 'active',
      polarCustomerId: customerId,
      polarSubscriptionId: subscription.id,
      periodEndsAt: subscription.currentPeriodEnd 
        ? new Date(subscription.currentPeriodEnd)
        : undefined,
    })
    
    // Log event
    await logSubscriptionEvent({
      userId,
      eventType: 'subscription_created',
      tier,
      polarSubscriptionId: subscription.id,
      polarEventId: payload.type,
      metadata: { productId },
    })
  },
  
  // ==========================================================================
  // Subscription Active (becomes active after payment)
  // ==========================================================================
  onSubscriptionActive: async (payload) => {
    info({ payload: payload.type }, 'Polar webhook: subscription active')
    
    const subscription = payload.data
    const customerId = subscription.customerId
    
    const userId = await getUserIdByPolarCustomerId(customerId)
    if (!userId) {
      warn({ customerId }, 'Could not find user for subscription activation')
      return
    }
    
    const productId = subscription.productId
    const tier = getTierFromPolarProduct(productId)
    
    await updateSubscription({
      userId,
      tier,
      status: 'active',
      polarSubscriptionId: subscription.id,
      periodEndsAt: subscription.currentPeriodEnd 
        ? new Date(subscription.currentPeriodEnd)
        : undefined,
    })
    
    // Reset paper usage for new period
    if (subscription.currentPeriodEnd) {
      await resetPaperUsage(userId, new Date(subscription.currentPeriodEnd))
    }
    
    await logSubscriptionEvent({
      userId,
      eventType: 'subscription_activated',
      tier,
      polarSubscriptionId: subscription.id,
    })
  },
  
  // ==========================================================================
  // Subscription Updated (plan change, renewal, etc.)
  // ==========================================================================
  onSubscriptionUpdated: async (payload) => {
    info({ payload: payload.type }, 'Polar webhook: subscription updated')
    
    const subscription = payload.data
    const customerId = subscription.customerId
    
    const userId = await getUserIdByPolarCustomerId(customerId)
    if (!userId) {
      warn({ customerId }, 'Could not find user for subscription update')
      return
    }
    
    const productId = subscription.productId
    const tier = getTierFromPolarProduct(productId)
    const previous = await getUserSubscription(userId)
    
    // Determine status
    let status: 'active' | 'canceled' | 'past_due' = 'active'
    if (subscription.status === 'canceled') {
      status = 'canceled'
    } else if (subscription.status === 'past_due') {
      status = 'past_due'
    }
    
    await updateSubscription({
      userId,
      tier,
      status,
      polarSubscriptionId: subscription.id,
      periodEndsAt: subscription.currentPeriodEnd 
        ? new Date(subscription.currentPeriodEnd)
        : undefined,
    })
    
    // Reset usage only when billing period advances (renewal), not every update.
    if (subscription.currentPeriodEnd) {
      const nextPeriodEnd = new Date(subscription.currentPeriodEnd)
      const prevPeriodEndMs = previous?.periodEndsAt ? new Date(previous.periodEndsAt).getTime() : 0
      if (!prevPeriodEndMs || nextPeriodEnd.getTime() > prevPeriodEndMs) {
        await resetPaperUsage(userId, nextPeriodEnd)
      }
    }
  },
  
  // ==========================================================================
  // Subscription Canceled (user requested cancellation, still active until period end)
  // ==========================================================================
  onSubscriptionCanceled: async (payload) => {
    info({ payload: payload.type }, 'Polar webhook: subscription canceled')
    
    const subscription = payload.data
    const customerId = subscription.customerId
    
    const userId = await getUserIdByPolarCustomerId(customerId)
    if (!userId) {
      warn({ customerId }, 'Could not find user for subscription cancellation')
      return
    }
    
    const productId = subscription.productId
    const tier = getTierFromPolarProduct(productId)
    
    // Mark as canceled but keep tier until period ends
    await updateSubscription({
      userId,
      tier,
      status: 'canceled',
      polarSubscriptionId: subscription.id,
      periodEndsAt: subscription.currentPeriodEnd 
        ? new Date(subscription.currentPeriodEnd)
        : undefined,
    })
    
    await logSubscriptionEvent({
      userId,
      eventType: 'subscription_canceled',
      tier,
      polarSubscriptionId: subscription.id,
    })
  },
  
  // ==========================================================================
  // Subscription Revoked (immediate cancellation, e.g., payment failed)
  // ==========================================================================
  onSubscriptionRevoked: async (payload) => {
    info({ payload: payload.type }, 'Polar webhook: subscription revoked')
    
    const subscription = payload.data
    const customerId = subscription.customerId
    
    const userId = await getUserIdByPolarCustomerId(customerId)
    if (!userId) {
      warn({ customerId }, 'Could not find user for subscription revocation')
      return
    }
    
    // Immediately downgrade to free
    await downgradeToFree(userId)
    
    await logSubscriptionEvent({
      userId,
      eventType: 'subscription_revoked',
      tier: 'free',
      polarSubscriptionId: subscription.id,
    })
  },
  
  // ==========================================================================
  // Subscription Uncanceled (user reactivated)
  // ==========================================================================
  onSubscriptionUncanceled: async (payload) => {
    info({ payload: payload.type }, 'Polar webhook: subscription uncanceled')
    
    const subscription = payload.data
    const customerId = subscription.customerId
    
    const userId = await getUserIdByPolarCustomerId(customerId)
    if (!userId) {
      warn({ customerId }, 'Could not find user for subscription reactivation')
      return
    }
    
    const productId = subscription.productId
    const tier = getTierFromPolarProduct(productId)
    
    await updateSubscription({
      userId,
      tier,
      status: 'active',
      polarSubscriptionId: subscription.id,
    })
  },
  
  // ==========================================================================
  // Customer Created (new customer in Polar)
  // ==========================================================================
  onCustomerCreated: async (payload) => {
    info({ payload: payload.type }, 'Polar webhook: customer created')
    
    const customer = payload.data
    const email = customer.email
    
    if (!email) return
    
    const userId = await getUserIdByEmail(email)
    if (userId) {
      await linkPolarCustomer(userId, customer.id)
      info({ userId, polarCustomerId: customer.id }, 'Linked new Polar customer to existing user')
    }
  },
  
  // ==========================================================================
  // Order Paid (successful payment)
  // ==========================================================================
  onOrderPaid: async (payload) => {
    info({ payload: payload.type }, 'Polar webhook: order paid')
    
    const order = payload.data
    const customerId = order.customerId
    
    const userId = await getUserIdByPolarCustomerId(customerId)
    if (!userId) return
    
    await logSubscriptionEvent({
      userId,
      eventType: 'payment_succeeded',
      metadata: {
        orderId: order.id,
      },
    })
  },
  
  // ==========================================================================
  // Catch-all for debugging
  // ==========================================================================
  onPayload: async (payload) => {
    // Log all events for debugging (in development)
    if (process.env.NODE_ENV !== 'production') {
      info({ type: payload.type }, 'Polar webhook received')
    }
  },
})
