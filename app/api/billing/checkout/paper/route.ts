import { NextRequest, NextResponse } from 'next/server'
import { handleError, requireAuth } from '@/lib/api/helpers'

/**
 * Single Paper Purchase Checkout
 * 
 * Creates a Polar checkout session for purchasing a single paper credit at $7.99.
 * After successful payment, the webhook will add a paper credit to the user's account.
 */

const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://genpaper.ai'
const polarToken = process.env.POLAR_ACCESS_TOKEN || ''
const isProd = process.env.NODE_ENV === 'production'

// Paper credit product ID from Polar
const paperProductId = process.env.POLAR_PRODUCT_PAPER_CREDIT

export async function GET(request: NextRequest) {
  try {
    const user = await requireAuth()
    const searchParams = request.nextUrl.searchParams
    
    // Optional: redirect to a specific project after purchase
    const redirectProjectId = searchParams.get('projectId')
    const customerEmail = user.email || null
    const customerExternalId = user.id

    if (!paperProductId) {
      console.error('[Paper Checkout] POLAR_PRODUCT_PAPER_CREDIT not configured')
      return NextResponse.json(
        { error: 'Paper purchase not configured. Please contact support.' },
        { status: 500 }
      )
    }

    if (!polarToken) {
      console.error('[Paper Checkout] POLAR_ACCESS_TOKEN not configured')
      return NextResponse.json(
        { error: 'Payment system not configured' },
        { status: 500 }
      )
    }

    const apiUrl = isProd 
      ? 'https://api.polar.sh/v1/checkouts/custom/'
      : 'https://sandbox-api.polar.sh/v1/checkouts/custom/'

    // Build success URL - optionally redirect to project
    let successUrl = `${appUrl}/settings?checkout=paper_success#billing`
    if (redirectProjectId) {
      successUrl = `${appUrl}/projects/${redirectProjectId}?checkout=paper_success`
    }

    console.log(`[Paper Checkout] Creating checkout for paper credit`)
    console.log(`[Paper Checkout] Product: ${paperProductId}`)
    console.log(`[Paper Checkout] Success URL: ${successUrl}`)

    const requestBody: Record<string, unknown> = {
      products: [paperProductId],
      success_url: successUrl,
      // Metadata to identify this as a paper credit purchase
      metadata: {
        type: 'paper_credit',
        quantity: 1,
      },
    }
    
    if (customerEmail) {
      requestBody.customer_email = customerEmail
    }
    if (customerExternalId) {
      requestBody.customer_external_id = customerExternalId
    }

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${polarToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error(`[Paper Checkout] Polar API error: ${response.status} - ${errorText}`)
      return NextResponse.json(
        { error: 'Failed to create checkout session', details: errorText },
        { status: response.status }
      )
    }

    const checkout = await response.json()
    console.log(`[Paper Checkout] Checkout created: ${checkout.id}`)

    if (checkout.url) {
      return NextResponse.redirect(checkout.url)
    }

    return NextResponse.json(
      { error: 'No checkout URL returned' },
      { status: 500 }
    )
  } catch (error) {
    return handleError(error, '[Paper Checkout] Error creating checkout')
  }
}
