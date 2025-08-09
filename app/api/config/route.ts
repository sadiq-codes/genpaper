import { NextRequest, NextResponse } from 'next/server'
import { isCitationsUnifiedEnabled, getEditorFlags } from '@/lib/config/feature-flags'

/**
 * Configuration API endpoint
 * Exposes feature flags and configuration to client-side code
 */
export async function GET(request: NextRequest) {
  try {
    const editor = getEditorFlags()
    const config = {
      features: {
        citationsUnified: isCitationsUnifiedEnabled(),
        editorDiffMode: editor.editorDiffMode,
        editsApiEnabled: editor.editsApiEnabled,
        citationOffsetMode: editor.citationOffsetMode,
      }
    }

    return NextResponse.json(config)
  } catch (error) {
    console.error('Error fetching config:', error)
    return NextResponse.json(
      { error: 'Failed to fetch configuration' },
      { status: 500 }
    )
  }
}