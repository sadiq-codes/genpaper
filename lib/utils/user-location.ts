/**
 * User Location Detection System
 * Automatically detects and stores user location for regional boosting
 */

import { createClient } from '@/lib/supabase/server'
import { detectRegion } from './global-region-detection'

export interface UserLocation {
  country: string
  region?: string
  city?: string
  latitude?: number
  longitude?: number
  timezone?: string
  detected_at: string
  ip_address?: string
  source: 'ip' | 'browser' | 'manual'
}

/**
 * Detect user location from IP address using free IP geolocation APIs
 */
async function detectLocationFromIP(ipAddress: string): Promise<UserLocation | null> {
  try {
    // Try multiple free services for reliability
    const services = [
      `https://ipapi.co/${ipAddress}/json/`,
      `https://ip-api.com/json/${ipAddress}`,
    ]

    for (const service of services) {
      try {
        const response = await fetch(service, {
          headers: { 'User-Agent': 'GenPaper-Location-Detection' },
          signal: AbortSignal.timeout(5000) // 5 second timeout
        })

        if (!response.ok) continue

        const data = await response.json()

        // Handle different API response formats
        let country: string | undefined
        let region: string | undefined
        let city: string | undefined
        let latitude: number | undefined
        let longitude: number | undefined
        let timezone: string | undefined

        if (service.includes('ipapi.co')) {
          country = data.country_name
          region = data.region
          city = data.city
          latitude = data.latitude
          longitude = data.longitude
          timezone = data.timezone
        } else if (service.includes('ip-api.com')) {
          country = data.country
          region = data.regionName
          city = data.city
          latitude = data.lat
          longitude = data.lon
          timezone = data.timezone
        }

        if (country) {
          return {
            country,
            region,
            city,
            latitude,
            longitude,
            timezone,
            detected_at: new Date().toISOString(),
            ip_address: ipAddress,
            source: 'ip'
          }
        }
      } catch (error) {
        console.warn(`Failed to get location from ${service}:`, error)
        continue
      }
    }

    return null
  } catch (error) {
    console.error('Error detecting location from IP:', error)
    return null
  }
}

/**
 * Get user's IP address from request headers
 */
export function getUserIP(request: Request): string {
  // Check various headers for IP address
  const headers = [
    'x-forwarded-for',
    'x-real-ip',
    'cf-connecting-ip', // Cloudflare
    'x-client-ip',
    'x-cluster-client-ip'
  ]

  for (const header of headers) {
    const value = request.headers.get(header)
    if (value) {
      // Handle comma-separated IPs (x-forwarded-for can have multiple IPs)
      const ip = value.split(',')[0].trim()
      if (ip && ip !== '127.0.0.1' && ip !== '::1') {
        return ip
      }
    }
  }

  return '127.0.0.1' // fallback
}

/**
 * Get or detect user location and store in profile
 */
export async function getUserLocation(userId: string, request?: Request): Promise<string | null> {
  try {
    const supabase = await createClient()

    // First, try to get existing location from user profile
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('metadata')
      .eq('id', userId)
      .single()

    if (!profileError && profile?.metadata) {
      const metadata = profile.metadata as any
      if (metadata.location?.country) {
        // Use existing location if it's recent (within 30 days)
        const detectedAt = new Date(metadata.location.detected_at)
        const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
        
        if (detectedAt > thirtyDaysAgo) {
          return metadata.location.country
        }
      }
    }

    // If no recent location or request provided, try to detect new location
    if (request) {
      const userIP = getUserIP(request)
      
      if (userIP && userIP !== '127.0.0.1') {
        const location = await detectLocationFromIP(userIP)
        
        if (location) {
          // Store the detected location in user profile
          await supabase
            .from('profiles')
            .update({
              metadata: {
                location,
                location_updated_at: new Date().toISOString()
              }
            })
            .eq('id', userId)

          return location.country
        }
      }
    }

    return null
  } catch (error) {
    console.error('Error getting user location:', error)
    return null
  }
}

/**
 * Update user location manually (for user preferences)
 */
export async function setUserLocation(userId: string, location: Partial<UserLocation>): Promise<void> {
  try {
    const supabase = await createClient()

    const userLocation: UserLocation = {
      country: location.country || '',
      region: location.region,
      city: location.city,
      latitude: location.latitude,
      longitude: location.longitude,
      timezone: location.timezone,
      detected_at: new Date().toISOString(),
      source: 'manual'
    }

    await supabase
      .from('profiles')
      .update({
        metadata: {
          location: userLocation,
          location_updated_at: new Date().toISOString()
        }
      })
      .eq('id', userId)

  } catch (error) {
    console.error('Error setting user location:', error)
    throw error
  }
}

/**
 * Clear user location data
 */
export async function clearUserLocation(userId: string): Promise<void> {
  try {
    const supabase = await createClient()

    await supabase
      .from('profiles')
      .update({
        metadata: {}
      })
      .eq('id', userId)

  } catch (error) {
    console.error('Error clearing user location:', error)
    throw error
  }
} 