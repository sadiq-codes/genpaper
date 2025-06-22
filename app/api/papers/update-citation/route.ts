import { NextRequest, NextResponse } from 'next/server'
import { updatePaperCitationFields } from '@/lib/db/papers'

export async function POST(request: NextRequest) {
  try {
    const { paperId, citationData } = await request.json()

    if (!paperId) {
      return NextResponse.json(
        { error: 'Paper ID is required' },
        { status: 400 }
      )
    }

    if (!citationData || typeof citationData !== 'object') {
      return NextResponse.json(
        { error: 'Citation data is required' },
        { status: 400 }
      )
    }

    // Update citation fields in database
    await updatePaperCitationFields(paperId, citationData)

    return NextResponse.json({ 
      success: true,
      message: 'Citation fields updated successfully' 
    })

  } catch (error) {
    console.error('Error updating citation fields:', error)
    return NextResponse.json(
      { error: 'Failed to update citation fields' },
      { status: 500 }
    )
  }
} 