import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { isValidCitationStyle } from '@/lib/citations/unified-service'

/**
 * User Preferences API
 * 
 * Handles all user preference updates including:
 * - Citation style
 * - Default paper type
 * - Editor settings (autocomplete)
 * - Appearance settings
 * - Profile updates
 */

interface UserPreferencesUpdate {
  // Writing preferences
  citationStyle?: string
  defaultPaperType?: string
  // Editor preferences
  autoSuggestions?: boolean
  includeCitations?: boolean
  acceptKey?: 'tab' | 'ctrlEnter'
  // Appearance preferences
  fontSize?: string
  // Profile
  fullName?: string
}

/**
 * GET /api/user/preferences
 * Get all user preferences
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
    
    // Fetch preferences and profile in parallel
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
    
    return NextResponse.json({
      preferences: {
        // Writing
        citationStyle: prefs?.citation_style || 'apa',
        defaultPaperType: prefs?.default_paper_type || 'literatureReview',
        // Editor
        autoSuggestions: prefs?.auto_suggestions || false,
        includeCitations: prefs?.include_citations || false,
        acceptKey: prefs?.accept_key || 'tab',
        // Appearance
        fontSize: prefs?.font_size || 'medium',
      },
      user: {
        id: user.id,
        email: user.email || '',
        fullName: profile?.full_name || null,
        createdAt: profile?.created_at || user.created_at || new Date().toISOString()
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
 * Update user preferences (partial update supported)
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
    
    const body: UserPreferencesUpdate = await request.json()
    const serviceClient = createServiceClient()
    
    // Build the update object for user_preferences
    const prefsUpdate: Record<string, unknown> = {}
    
    // Validate and add citation style
    if (body.citationStyle !== undefined) {
      if (!isValidCitationStyle(body.citationStyle)) {
        return NextResponse.json(
          { error: 'Invalid citation style' },
          { status: 400 }
        )
      }
      prefsUpdate.citation_style = body.citationStyle
    }
    
    // Validate and add default paper type
    if (body.defaultPaperType !== undefined) {
      const validTypes = ['literatureReview', 'researchArticle', 'capstoneProject', 'mastersThesis', 'phdDissertation']
      if (!validTypes.includes(body.defaultPaperType)) {
        return NextResponse.json(
          { error: 'Invalid paper type' },
          { status: 400 }
        )
      }
      prefsUpdate.default_paper_type = body.defaultPaperType
    }
    
    // Add editor settings
    if (body.autoSuggestions !== undefined) {
      prefsUpdate.auto_suggestions = body.autoSuggestions
    }
    
    if (body.includeCitations !== undefined) {
      prefsUpdate.include_citations = body.includeCitations
    }
    
    if (body.acceptKey !== undefined) {
      if (!['tab', 'ctrlEnter'].includes(body.acceptKey)) {
        return NextResponse.json(
          { error: 'Invalid accept key' },
          { status: 400 }
        )
      }
      prefsUpdate.accept_key = body.acceptKey
    }
    
    // Add appearance settings
    if (body.fontSize !== undefined) {
      if (!['small', 'medium', 'large'].includes(body.fontSize)) {
        return NextResponse.json(
          { error: 'Invalid font size' },
          { status: 400 }
        )
      }
      prefsUpdate.font_size = body.fontSize
    }
    
    // Update preferences if any changes
    if (Object.keys(prefsUpdate).length > 0) {
      prefsUpdate.updated_at = new Date().toISOString()
      
      // Upsert preferences
      const { error: prefsError } = await serviceClient
        .from('user_preferences')
        .upsert({
          user_id: user.id,
          ...prefsUpdate
        }, {
          onConflict: 'user_id'
        })
      
      if (prefsError) {
        console.error('Error updating preferences:', prefsError)
        return NextResponse.json(
          { error: 'Failed to update preferences' },
          { status: 500 }
        )
      }
    }
    
    // Update profile if fullName provided
    if (body.fullName !== undefined) {
      const { error: profileError } = await serviceClient
        .from('profiles')
        .update({ full_name: body.fullName })
        .eq('id', user.id)
      
      if (profileError) {
        console.error('Error updating profile:', profileError)
        return NextResponse.json(
          { error: 'Failed to update profile' },
          { status: 500 }
        )
      }
    }
    
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error updating user preferences:', error)
    return NextResponse.json(
      { error: 'Failed to update preferences' },
      { status: 500 }
    )
  }
}
