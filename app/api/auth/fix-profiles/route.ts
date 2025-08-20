import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function POST() {
  try {
    const supabase = await createClient()
    
    // Check if user is authenticated
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    console.log('🔧 Fixing profiles for current user:', user.id)
    
    // Ensure profile exists for current user
    const { error: profileError } = await supabase
      .from('profiles')
      .upsert({
        id: user.id,
        email: user.email || '',
        full_name: user.user_metadata?.full_name || user.user_metadata?.name || '',
        created_at: new Date().toISOString()
      }, {
        onConflict: 'id',
        ignoreDuplicates: false
      })
    
    if (profileError) {
      console.error('Error creating/updating profile:', profileError)
      return NextResponse.json({ 
        error: 'Failed to create profile',
        details: profileError.message 
      }, { status: 500 })
    }

    console.log('✅ Profile ensured for user:', user.id)
    
    return NextResponse.json({ 
      success: true,
      message: 'Profile created/updated successfully',
      userId: user.id
    })

  } catch (error) {
    console.error('Error in fix-profiles endpoint:', error)
    return NextResponse.json({ 
      error: 'Internal server error',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 })
  }
}
