import { NextRequest, NextResponse } from 'next/server'
import { CSL_STYLES } from '@/lib/citations/csl-styles'

const CSL_STYLES_TREE_API = 'https://api.github.com/repos/citation-style-language/styles/git/trees/master?recursive=1'
const CACHE_TTL_MS = 24 * 60 * 60 * 1000
const REMOTE_FETCH_TIMEOUT_MS = 4000

let cachedStyleIds: string[] | null = null
let cachedAt = 0

function getFallbackStyleIds(): string[] {
  return Array.from(new Set(CSL_STYLES.map(s => s.id))).sort()
}

async function fetchAllStyleIds(): Promise<string[]> {
  if (cachedStyleIds && Date.now() - cachedAt < CACHE_TTL_MS) {
    return cachedStyleIds
  }

  const response = await fetch(CSL_STYLES_TREE_API, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'genpaper'
    },
    next: { revalidate: 3600 },
    signal: AbortSignal.timeout(REMOTE_FETCH_TIMEOUT_MS),
  })

  if (!response.ok) {
    throw new Error(`Failed to fetch CSL styles list: ${response.status}`)
  }

  const data = await response.json() as {
    tree?: Array<{ path: string; type: string }>
  }

  // Only include root-level .csl files, exclude subdirectories like 'dependent/'
  const ids = (data.tree || [])
    .filter(item => item.type === 'blob' && item.path.endsWith('.csl') && !item.path.includes('/'))
    .map(item => item.path.replace(/\.csl$/i, ''))

  const unique = Array.from(new Set(ids)).sort()
  cachedStyleIds = unique
  cachedAt = Date.now()
  return unique
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const query = (searchParams.get('q') || '').trim().toLowerCase()
  const limit = Math.min(parseInt(searchParams.get('limit') || '200', 10) || 200, 1000)

  let allStyles: string[] = []
  let source: 'github' | 'stale-cache' | 'fallback' = 'github'

  try {
    allStyles = await fetchAllStyleIds()
  } catch (error) {
    console.error('[CSL Styles] Failed to fetch remote list:', error)

    if (cachedStyleIds && cachedStyleIds.length > 0) {
      // Serve stale cache rather than failing the dropdown.
      allStyles = cachedStyleIds
      source = 'stale-cache'
    } else {
      // Final fallback: built-in curated styles.
      allStyles = getFallbackStyleIds()
      source = 'fallback'
    }
  }

  const filtered = query
    ? allStyles.filter(id => id.toLowerCase().includes(query))
    : allStyles

  return NextResponse.json({
    styles: filtered.slice(0, limit),
    total: allStyles.length,
    filteredTotal: filtered.length,
    source,
  })
}
