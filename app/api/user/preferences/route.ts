import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { 
  getUserPreferences, 
  updateUserCitationStyle 
} from '@/lib/citations/citation-settings'
import { isValidCitationStyle } from '@/lib/citations/unified-service'

/**
 * GET /api/user/preferences
 * Get user preferences including citation style
 */
export async function GET() {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    
    if (authError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }
    
    const preferences = await getUserPreferences(user.id)
    
    return NextResponse.json({
      preferences: {
        citation_style: preferences.citationStyle
      }
    })
  } catch (error) {
    console.error('Error getting user preferences:', error)
    return NextResponse.json(
      { error: 'Failed to get preferences' },
      { status: 500 }
    )
  }
}

/**
 * POST /api/user/preferences
 * Update user preferences
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    
    if (authError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }
    
    const body = await request.json()
    const { citation_style } = body
    
    // Validate citation style if provided
    if (citation_style !== undefined) {
      if (!isValidCitationStyle(citation_style)) {
        return NextResponse.json(
          { error: 'Invalid citation style. Must be one of: apa, mla, chicago, ieee, harvard' },
          { status: 400 }
        )
      }
      
      const result = await updateUserCitationStyle(user.id, citation_style)
      
      if (!result.success) {
        return NextResponse.json(
          { error: result.error || 'Failed to update citation style' },
          { status: 500 }
        )
      }
    }
    
    // Return updated preferences
    const preferences = await getUserPreferences(user.id)
    
    return NextResponse.json({
      success: true,
      preferences: {
        citation_style: preferences.citationStyle
      }
    })
  } catch (error) {
    console.error('Error updating user preferences:', error)
    return NextResponse.json(
      { error: 'Failed to update preferences' },
      { status: 500 }
    )
  }
}
