import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

/**
 * Middleware to refresh Supabase auth session on every request.
 * 
 * This is critical because:
 * 1. Supabase auth tokens expire and need periodic refresh
 * 2. Without this, users get logged out after server restarts/hot reloads
 * 3. The middleware updates the session cookie before the request is processed
 */
export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          // Note: request.cookies.set only accepts (name, value) - options are applied on the response
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({
            request,
          })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  try {
    // IMPORTANT: This refreshes the session if it's expired and updates the cookies
    // The getUser() call is what triggers the session refresh
    await supabase.auth.getUser()
  } catch (error) {
    // If Supabase is unreachable, don't clear the session
    // Just pass through the request with existing cookies
    console.error('Middleware: Supabase auth check failed:', error)
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public folder files
     * Feel free to modify this pattern to include more paths.
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
