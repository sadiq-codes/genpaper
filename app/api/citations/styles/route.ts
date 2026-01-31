import { NextRequest, NextResponse } from 'next/server'

const CSL_STYLES_REPO_API = 'https://api.github.com/repos/citation-style-language/styles/contents'
const CACHE_TTL_MS = 24 * 60 * 60 * 1000

let cachedStyleIds: string[] | null = null
let cachedAt = 0

async function fetchAllStyleIds(): Promise<string[]> {
  if (cachedStyleIds && Date.now() - cachedAt < CACHE_TTL_MS) {
    return cachedStyleIds
  }

  const ids: string[] = []
  let page = 1

  while (true) {
    const url = new URL(CSL_STYLES_REPO_API)
    url.searchParams.set('per_page', '100')
    url.searchParams.set('page', String(page))

    const response = await fetch(url.toString(), {
      headers: {
        Accept: 'application/vnd.github+json',
      },
      next: { revalidate: 3600 }
    })

    if (!response.ok) {
      throw new Error(`Failed to fetch CSL styles list: ${response.status}`)
    }

    const data = await response.json() as Array<{ name: string; type: string }>
    const pageIds = data
      .filter(item => item.type === 'file' && item.name.endsWith('.csl'))
      .map(item => item.name.replace(/\.csl$/i, ''))

    ids.push(...pageIds)

    if (data.length < 100) break
    page += 1
  }

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
