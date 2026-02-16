import { NextRequest, NextResponse } from 'next/server'

const STYLE_CACHE_TTL_MS = 24 * 60 * 60 * 1000
const REMOTE_FETCH_TIMEOUT_MS = 4000
const MAX_STYLE_ID_LENGTH = 128

const REMOTE_STYLE_URLS = [
  (styleId: string) => `https://raw.githubusercontent.com/citation-style-language/styles/master/${styleId}.csl`,
  (styleId: string) => `https://cdn.jsdelivr.net/gh/citation-style-language/styles@master/${styleId}.csl`,
]

const styleCache = new Map<string, { xml: string; fetchedAt: number }>()

function isValidStyleId(styleId: string): boolean {
  if (!styleId || styleId.length > MAX_STYLE_ID_LENGTH) return false
  // CSL IDs are typically kebab-case tokens (letters, numbers, underscore, dot, dash).
  return /^[a-z0-9][a-z0-9._-]*$/i.test(styleId)
}

function isLikelyCslXml(xml: string): boolean {
  if (!xml) return false
  const trimmed = xml.trim()
  if (!trimmed) return false

  // CSL files start with a <style> root element (optionally after XML declaration).
  const withoutDeclaration = trimmed.replace(/^<\?xml[\s\S]*?\?>\s*/i, '')
  if (!withoutDeclaration.startsWith('<style')) return false

  const lowered = withoutDeclaration.toLowerCase()
  return (
    lowered.includes('purl.org/net/xbiblio/csl') ||
    lowered.includes('<citation') ||
    lowered.includes('<bibliography')
  )
}

async function fetchRemoteStyleXml(styleId: string): Promise<string | null> {
  for (const buildUrl of REMOTE_STYLE_URLS) {
    const url = buildUrl(styleId)
    try {
      const response = await fetch(url, {
        headers: {
          Accept: 'application/xml, text/xml;q=0.9, */*;q=0.8',
          'User-Agent': 'genpaper',
        },
        next: { revalidate: 60 * 60 },
        signal: AbortSignal.timeout(REMOTE_FETCH_TIMEOUT_MS),
      })

      if (!response.ok) continue

      const xml = await response.text()
      if (!isLikelyCslXml(xml)) continue
      return xml
    } catch {
      // Try next upstream.
    }
  }

  return null
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const styleId = (searchParams.get('id') || '').trim().toLowerCase()

  if (!isValidStyleId(styleId)) {
    return NextResponse.json({ error: 'Invalid style ID' }, { status: 400 })
  }

  const cached = styleCache.get(styleId)
  const isFresh = cached && Date.now() - cached.fetchedAt < STYLE_CACHE_TTL_MS
  if (cached && isFresh) {
    return new NextResponse(cached.xml, {
      status: 200,
      headers: {
        'Content-Type': 'application/xml; charset=utf-8',
        'Cache-Control': 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800',
      },
    })
  }

  const xml = await fetchRemoteStyleXml(styleId)
  if (xml) {
    styleCache.set(styleId, { xml, fetchedAt: Date.now() })
    return new NextResponse(xml, {
      status: 200,
      headers: {
        'Content-Type': 'application/xml; charset=utf-8',
        'Cache-Control': 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800',
      },
    })
  }

  // Serve stale cache if upstream is temporarily unavailable.
  if (cached) {
    return new NextResponse(cached.xml, {
      status: 200,
      headers: {
        'Content-Type': 'application/xml; charset=utf-8',
        'Cache-Control': 'public, max-age=60, stale-while-revalidate=604800',
      },
    })
  }

  return NextResponse.json({ error: 'Style not found' }, { status: 404 })
}

