import { NextRequest, NextResponse } from 'next/server'

/**
 * Polar Checkout Route
 * 
 * Creates a Polar checkout session and redirects to the checkout page.
 * 
 * Query params:
 * - products: Product ID (required) - e.g., ?products=xxx
 * - customerEmail: Pre-fill email (optional)
 * - customerExternalId: Link to our user ID (optional)
 */

const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://genpaper.ai'
const polarToken = process.env.POLAR_ACCESS_TOKEN || ''
const isProd = process.env.NODE_ENV === 'production'

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const productId = searchParams.get('products')
  const customerEmail = searchParams.get('customerEmail')
  const customerExternalId = searchParams.get('customerExternalId')

  // Validate required params
  if (!productId) {
    return NextResponse.json(
      { error: 'Missing products parameter' },
      { status: 400 }
    )
  }

  if (!polarToken) {
    console.error('[Checkout] POLAR_ACCESS_TOKEN not configured')
    return NextResponse.json(
      { error: 'Payment system not configured' },
      { status: 500 }
    )
  }

  try {
    const apiUrl = isProd 
      ? 'https://api.polar.sh/v1/checkouts/custom/'
      : 'https://sandbox-api.polar.sh/v1/checkouts/custom/'

    console.log(`[Checkout] Creating checkout session for product: ${productId}`)
    console.log(`[Checkout] API URL: ${apiUrl}`)
    console.log(`[Checkout] Success URL: ${appUrl}/settings?checkout=success#billing`)

    // Build request body - only include email if provided and valid
    const requestBody: Record<string, unknown> = {
      products: [productId],
      success_url: `${appUrl}/settings?checkout=success#billing`,
    }
    
    // Only add customer fields if they're provided
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
      console.error(`[Checkout] Polar API error: ${response.status} - ${errorText}`)
      return NextResponse.json(
        { error: 'Failed to create checkout session', details: errorText },
        { status: response.status }
      )
    }

    const checkout = await response.json()
    console.log(`[Checkout] Checkout created: ${checkout.id}`)

    // Redirect to the checkout URL
    if (checkout.url) {
      return NextResponse.redirect(checkout.url)
    }

    return NextResponse.json(
      { error: 'No checkout URL returned' },
      { status: 500 }
    )
  } catch (error) {
    console.error('[Checkout] Error creating checkout:', error)
    return NextResponse.json(
      { 
        error: 'Failed to create checkout session', 
        details: error instanceof Error ? error.message : 'Unknown error' 
      },
      { status: 500 }
    )
  }
}
