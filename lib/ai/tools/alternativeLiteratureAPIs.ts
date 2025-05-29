// Alternative literature search APIs as fallbacks
import { LiteratureSearchResult } from './literatureSearch'

// arXiv API search (for computer science, physics, mathematics papers)
export async function searchArXiv(query: string, maxResults: number = 5): Promise<LiteratureSearchResult[]> {
  try {
    const url = `http://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(query)}&start=0&max_results=${maxResults}`
    
    const response = await fetch(url)
    if (!response.ok) throw new Error(`arXiv API error: ${response.status}`)
    
    const xmlText = await response.text()
    
    // Basic XML parsing for arXiv response
    const entries = xmlText.match(/<entry>(.*?)<\/entry>/gs) || []
    
    const results: LiteratureSearchResult[] = entries.map(entry => {
      const title = entry.match(/<title>(.*?)<\/title>/s)?.[1]?.trim() || 'N/A'
      const summary = entry.match(/<summary>(.*?)<\/summary>/s)?.[1]?.trim() || 'No abstract available.'
      const authors = entry.match(/<name>(.*?)<\/name>/g)?.map(name => ({
        name: name.replace(/<\/?name>/g, '').trim()
      })) || [{ name: 'N/A' }]
      const published = entry.match(/<published>(.*?)<\/published>/)?.[1]
      const year = published ? new Date(published).getFullYear() : null
      const id = entry.match(/<id>(.*?)<\/id>/)?.[1] || null
      
      return {
        title: title.replace(/\s+/g, ' '),
        authors,
        year,
        abstract_snippet: summary.replace(/\s+/g, ' ').substring(0, 500),
        source_url: id,
        doi: null // arXiv doesn't use DOIs
      }
    })
    
    console.log(`Successfully retrieved ${results.length} results from arXiv API`)
    return results
    
  } catch (error) {
    console.error('Error fetching from arXiv API:', error)
    return []
  }
}

// PubMed API search (for biomedical literature)
export async function searchPubMed(query: string, maxResults: number = 5): Promise<LiteratureSearchResult[]> {
  try {
    // Step 1: Search for PMIDs
    const searchUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=${encodeURIComponent(query)}&retmax=${maxResults}&retmode=json`
    
    const searchResponse = await fetch(searchUrl)
    if (!searchResponse.ok) throw new Error(`PubMed search error: ${searchResponse.status}`)
    
    const searchData = await searchResponse.json()
    const pmids = searchData.esearchresult?.idlist || []
    
    if (pmids.length === 0) return []
    
    // Step 2: Fetch details for PMIDs
    const detailsUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&id=${pmids.join(',')}&retmode=json`
    
    const detailsResponse = await fetch(detailsUrl)
    if (!detailsResponse.ok) throw new Error(`PubMed details error: ${detailsResponse.status}`)
    
    const detailsData = await detailsResponse.json()
    const articles = detailsData.result || {}
    
    const results: LiteratureSearchResult[] = pmids.map((pmid: string) => {
      const article = articles[pmid]
      if (!article) return null
      
      const title = article.title || 'N/A'
      const authors = article.authors?.map((author: any) => ({
        name: author.name || 'N/A'
      })) || [{ name: 'N/A' }]
      const year = article.pubdate ? new Date(article.pubdate).getFullYear() : null
      
      return {
        title,
        authors,
        year,
        abstract_snippet: 'Abstract available on PubMed', // PubMed summary doesn't include full abstract
        source_url: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`,
        doi: article.elocationid?.startsWith('doi:') ? article.elocationid.replace('doi:', '') : null
      }
    }).filter(Boolean) as LiteratureSearchResult[]
    
    console.log(`Successfully retrieved ${results.length} results from PubMed API`)
    return results
    
  } catch (error) {
    console.error('Error fetching from PubMed API:', error)
    return []
  }
}

// CORE API search (for open access academic papers)
export async function searchCORE(query: string, maxResults: number = 5): Promise<LiteratureSearchResult[]> {
  try {
    // Note: CORE API requires an API key for higher rate limits
    const apiKey = process.env.CORE_API_KEY
    const url = `https://api.core.ac.uk/v3/search/works?q=${encodeURIComponent(query)}&limit=${maxResults}${apiKey ? `&api_key=${apiKey}` : ''}`
    
    const response = await fetch(url)
    if (!response.ok) throw new Error(`CORE API error: ${response.status}`)
    
    const data = await response.json()
    const works = data.results || []
    
    const results: LiteratureSearchResult[] = works.map((work: any) => ({
      title: work.title || 'N/A',
      authors: work.authors?.map((author: any) => ({
        name: author.name || 'N/A'
      })) || [{ name: 'N/A' }],
      year: work.yearPublished || null,
      abstract_snippet: work.abstract || 'No abstract available.',
      source_url: work.downloadUrl || work.sourceFulltextUrls?.[0] || null,
      doi: work.doi || null
    }))
    
    console.log(`Successfully retrieved ${results.length} results from CORE API`)
    return results
    
  } catch (error) {
    console.error('Error fetching from CORE API:', error)
    return []
  }
}

// Fallback search that tries multiple APIs
export async function fallbackLiteratureSearch(query: string, maxResults: number = 5): Promise<LiteratureSearchResult[]> {
  const apis = [
    { name: 'arXiv', fn: () => searchArXiv(query, Math.min(maxResults, 3)) },
    { name: 'PubMed', fn: () => searchPubMed(query, Math.min(maxResults, 3)) },
    { name: 'CORE', fn: () => searchCORE(query, Math.min(maxResults, 3)) }
  ]
  
  for (const api of apis) {
    try {
      console.log(`Trying ${api.name} API as fallback...`)
      const results = await api.fn()
      if (results.length > 0) {
        console.log(`Successfully got ${results.length} results from ${api.name}`)
        return results.slice(0, maxResults)
      }
    } catch (error) {
      console.error(`${api.name} API failed:`, error)
      continue
    }
  }
  
  console.log('All fallback APIs failed, returning empty results')
  return []
} 