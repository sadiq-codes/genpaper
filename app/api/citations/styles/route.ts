import { NextRequest, NextResponse } from 'next/server'

const CSL_STYLES_TREE_API = 'https://api.github.com/repos/citation-style-language/styles/git/trees/master?recursive=1'
const CACHE_TTL_MS = 24 * 60 * 60 * 1000

let cachedStyleIds: string[] | null = null
let cachedAt = 0

async function fetchAllStyleIds(): Promise<string[]> {
  if (cachedStyleIds && Date.now() - cachedAt < CACHE_TTL_MS) {
    return cachedStyleIds
  }

  const response = await fetch(CSL_STYLES_TREE_API, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'genpaper'
    },
    next: { revalidate: 3600 }
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
  try {
    const { searchParams } = new URL(request.url)
    const query = (searchParams.get('q') || '').trim().toLowerCase()
    const limit = Math.min(parseInt(searchParams.get('limit') || '200', 10) || 200, 1000)

    const allStyles = await fetchAllStyleIds()
    const filtered = query
      ? allStyles.filter(id => id.toLowerCase().includes(query))
      : allStyles

    return NextResponse.json({
      styles: filtered.slice(0, limit),
      total: allStyles.length,
      filteredTotal: filtered.length
    })
  } catch (error) {
    console.error('[CSL Styles] Failed to list styles:', error)
    return NextResponse.json(
      { error: 'Failed to load CSL styles list' },
      { status: 500 }
    )
  }
}
