import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { pdfQueue } from '@/lib/services/pdf-queue'

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { paperId, pdfUrl, title, priority = 'normal' } = body

    if (!paperId || !pdfUrl || !title) {
      return NextResponse.json({ 
        error: 'Missing required fields: paperId, pdfUrl, title' 
      }, { status: 400 })
    }

    console.log(`📄 Queueing PDF processing for: ${title}`)
    
    const jobId = await pdfQueue.addJob(
      paperId, 
      pdfUrl, 
      title, 
      user.id,
      priority
    )
    
    console.log(`✅ PDF processing queued: ${jobId}`)

    return NextResponse.json({
      success: true,
      jobId,
      message: 'PDF processing queued successfully'
    })

  } catch (error) {
    console.error('PDF queue API error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to queue PDF processing' },
      { status: 500 }
    )
  }
} 