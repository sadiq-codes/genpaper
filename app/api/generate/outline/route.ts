import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { generateOutline } from '@/lib/prompts/generators'
import { getUserLocation } from '@/lib/utils/user-location'
import type { PaperTypeKey, OutlineConfig } from '@/lib/prompts/types'

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    
    // Check authentication
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { 
      topic, 
      paperType = 'researchArticle',
      selectedPapers = [], 
      localRegion,
      pageLength = 'medium'
    } = body

    if (!topic?.trim()) {
      return NextResponse.json({ error: 'Topic is required' }, { status: 400 })
    }

    if (!paperType) {
      return NextResponse.json({ error: 'Paper type is required' }, { status: 400 })
    }

    // Automatically detect user's location for regional boosting
    const userLocation = await getUserLocation(user.id, request)

    // Prepare configuration for outline generation
    const config: OutlineConfig = {
      topic,
      citationStyle: 'apa',
      localRegion: localRegion || userLocation || 'global',
      pageLength: pageLength ? parseInt(pageLength) : undefined,
      temperature: 0.3, // Lower temperature for more consistent outlines
      maxTokens: 2000
    }

    // Generate outline using the backend function
    const outline = await generateOutline(
      paperType as PaperTypeKey,
      topic,
      selectedPapers,
      config
    )

    return NextResponse.json({
      success: true,
      outline
    })

  } catch (error) {
    console.error('Error generating outline:', error)
    
    // Handle specific errors
    if (error instanceof Error) {
      if (error.message.includes('Invalid paper type')) {
        return NextResponse.json({ error: error.message }, { status: 400 })
      }
      if (error.message.includes('No outline template found')) {
        return NextResponse.json({ error: error.message }, { status: 400 })
      }
    }

    return NextResponse.json(
      { error: 'Failed to generate outline. Please try again.' }, 
      { status: 500 }
    )
  }
} 