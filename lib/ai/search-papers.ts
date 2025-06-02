import { openai } from '@/lib/ai/sdk'
import { createPaper } from '@/lib/db/papers'
import type { Paper, PaperWithAuthors } from '@/types/simplified'

// Mock paper databases for demonstration
// In production, you'd integrate with arXiv, PubMed, Google Scholar APIs
interface PaperSearchResult {
  title: string
  authors: string[]
  abstract?: string
  publication_date?: string
  venue?: string
  doi?: string
  url?: string
  pdf_url?: string
  source: string
  citation_count?: number
  relevance_score?: number
}

// Mock arXiv API search
async function searchArxiv(query: string, limit = 10): Promise<PaperSearchResult[]> {
  // In production, this would make an actual API call to arXiv
  const mockResults: PaperSearchResult[] = [
    {
      title: "Attention Is All You Need",
      authors: ["Ashish Vaswani", "Noam Shazeer", "Niki Parmar"],
      abstract: "The dominant sequence transduction models are based on complex recurrent or convolutional neural networks...",
      publication_date: "2017-06-12",
      venue: "NIPS 2017",
      doi: "10.48550/arXiv.1706.03762",
      url: "https://arxiv.org/abs/1706.03762",
      pdf_url: "https://arxiv.org/pdf/1706.03762.pdf",
      source: "arxiv",
      citation_count: 85000,
      relevance_score: 0.95
    },
    {
      title: "BERT: Pre-training of Deep Bidirectional Transformers",
      authors: ["Jacob Devlin", "Ming-Wei Chang", "Kenton Lee"],
      abstract: "We introduce a new language representation model called BERT...",
      publication_date: "2018-10-11",
      venue: "NAACL 2019",
      doi: "10.48550/arXiv.1810.04805",
      url: "https://arxiv.org/abs/1810.04805",
      pdf_url: "https://arxiv.org/pdf/1810.04805.pdf",
      source: "arxiv",
      citation_count: 65000,
      relevance_score: 0.88
    },
    {
      title: "Isolation and Characterization of Novel Microorganisms from Extreme Environments",
      authors: ["Maria Rodriguez", "John Smith", "Ana Garcia"],
      abstract: "This study presents methods for isolation and characterization of microorganisms from extreme environments including hypersaline lakes and thermal springs...",
      publication_date: "2023-01-15",
      venue: "Applied and Environmental Microbiology",
      doi: "10.1128/AEM.02345-22",
      url: "https://journals.asm.org/doi/10.1128/AEM.02345-22",
      pdf_url: "https://journals.asm.org/doi/pdf/10.1128/AEM.02345-22",
      source: "arxiv",
      citation_count: 125,
      relevance_score: 0.92
    },
    {
      title: "Modern Techniques for Microbial Isolation and Identification",
      authors: ["David Wilson", "Sarah Chen", "Michael Johnson"],
      abstract: "A comprehensive review of current methodologies for microbial isolation including culture-dependent and culture-independent approaches...",
      publication_date: "2022-08-20",
      venue: "Microbiology Reviews",
      doi: "10.1099/mic.0.001234",
      url: "https://www.microbiologyresearch.org/content/journal/micro/10.1099/mic.0.001234",
      source: "arxiv",
      citation_count: 89,
      relevance_score: 0.94
    },
    {
      title: "Phylogenetic Analysis and Biochemical Characterization of Marine Bacteria",
      authors: ["Lisa Thompson", "Robert Brown", "Jennifer Lee"],
      abstract: "This paper describes the isolation of marine bacteria from coastal waters and their characterization using 16S rRNA sequencing and biochemical assays...",
      publication_date: "2022-11-10",
      venue: "Marine Microbiology",
      doi: "10.1016/j.marmic.2022.11.003",
      source: "arxiv",
      citation_count: 67,
      relevance_score: 0.89
    }
  ]

  // Filter by relevance to query (simplified)
  return mockResults.filter(paper => 
    paper.title.toLowerCase().includes(query.toLowerCase()) ||
    paper.abstract?.toLowerCase().includes(query.toLowerCase()) ||
    query.toLowerCase().split(' ').some(term => 
      paper.title.toLowerCase().includes(term) ||
      paper.abstract?.toLowerCase().includes(term)
    )
  ).slice(0, limit)
}

// Mock PubMed API search
async function searchPubMed(query: string, limit = 10): Promise<PaperSearchResult[]> {
  // In production, this would make an actual API call to PubMed
  const mockResults: PaperSearchResult[] = [
    {
      title: "Machine learning in healthcare: A systematic review",
      authors: ["Sarah Johnson", "Michael Chen", "Emily Davis"],
      abstract: "Machine learning has shown tremendous potential in healthcare applications...",
      publication_date: "2023-03-15",
      venue: "Nature Medicine",
      doi: "10.1038/s41591-023-02246-3",
      url: "https://pubmed.ncbi.nlm.nih.gov/example",
      source: "pubmed",
      citation_count: 450,
      relevance_score: 0.92
    },
    {
      title: "Isolation and Molecular Characterization of Antibiotic-Resistant Bacteria",
      authors: ["Elena Petrov", "Carlos Martinez", "Yuki Tanaka"],
      abstract: "We report the isolation and characterization of antibiotic-resistant bacterial strains from hospital environments using molecular techniques...",
      publication_date: "2023-05-20",
      venue: "Journal of Clinical Microbiology",
      doi: "10.1128/JCM.00456-23",
      url: "https://pubmed.ncbi.nlm.nih.gov/37123456",
      source: "pubmed",
      citation_count: 78,
      relevance_score: 0.91
    },
    {
      title: "Cultivation-Independent Methods for Microbial Community Analysis",
      authors: ["Ahmed Hassan", "Priya Sharma", "Klaus Mueller"],
      abstract: "This review discusses cultivation-independent approaches for studying microbial communities including metagenomics and single-cell sequencing...",
      publication_date: "2022-12-08",
      venue: "Nature Reviews Microbiology",
      doi: "10.1038/s41579-022-00789-2",
      url: "https://pubmed.ncbi.nlm.nih.gov/36234567",
      source: "pubmed",
      citation_count: 156,
      relevance_score: 0.88
    },
    {
      title: "Characterization of Soil Microorganisms Using High-Throughput Sequencing",
      authors: ["Rachel Green", "Thomas Anderson", "Maria Gonzalez"],
      abstract: "We characterized soil microbial communities from agricultural fields using 16S rRNA gene sequencing and functional gene analysis...",
      publication_date: "2023-02-14",
      venue: "Applied Soil Ecology",
      doi: "10.1016/j.apsoil.2023.02.014",
      url: "https://pubmed.ncbi.nlm.nih.gov/36789012",
      source: "pubmed",
      citation_count: 43,
      relevance_score: 0.85
    }
  ]

  return mockResults.filter(paper => 
    paper.title.toLowerCase().includes(query.toLowerCase()) ||
    paper.abstract?.toLowerCase().includes(query.toLowerCase()) ||
    query.toLowerCase().split(' ').some(term => 
      paper.title.toLowerCase().includes(term) ||
      paper.abstract?.toLowerCase().includes(term)
    )
  ).slice(0, limit)
}

// Main paper search function
export async function searchOnlinePapers(
  query: string,
  sources: string[] = ['arxiv', 'pubmed'],
  limit = 20
): Promise<PaperWithAuthors[]> {
  const allResults: PaperSearchResult[] = []

  // Search each source
  if (sources.includes('arxiv')) {
    const arxivResults = await searchArxiv(query, Math.ceil(limit / sources.length))
    allResults.push(...arxivResults)
  }

  if (sources.includes('pubmed')) {
    const pubmedResults = await searchPubMed(query, Math.ceil(limit / sources.length))
    allResults.push(...pubmedResults)
  }

  // Sort by relevance score and citation count
  allResults.sort((a, b) => {
    const scoreA = (a.relevance_score || 0) * 0.6 + (Math.log(a.citation_count || 1) / 20) * 0.4
    const scoreB = (b.relevance_score || 0) * 0.6 + (Math.log(b.citation_count || 1) / 20) * 0.4
    return scoreB - scoreA
  })

  // Convert to our Paper format and save to database
  const savedPapers: PaperWithAuthors[] = []
  
  for (const result of allResults.slice(0, limit)) {
    try {
      // Check if paper already exists by DOI
      if (result.doi) {
        const { getPaperByDOI } = await import('@/lib/db/papers')
        const existingPaper = await getPaperByDOI(result.doi)
        if (existingPaper) {
          savedPapers.push(existingPaper as PaperWithAuthors)
          continue
        }
      }

      // Create new paper in database
      const paperData: Omit<Paper, 'id' | 'created_at'> = {
        title: result.title,
        abstract: result.abstract,
        publication_date: result.publication_date,
        venue: result.venue,
        doi: result.doi,
        url: result.url,
        pdf_url: result.pdf_url,
        source: result.source,
        citation_count: result.citation_count,
        impact_score: result.relevance_score,
        metadata: {
          search_query: query,
          found_at: new Date().toISOString(),
          relevance_score: result.relevance_score
        }
      }

      const savedPaper = await createPaper(paperData, result.authors)
      savedPapers.push(savedPaper)
    } catch (error) {
      console.error('Error saving paper:', error)
      // Continue with other papers
    }
  }

  return savedPapers
}

// AI-powered query expansion
export async function expandSearchQuery(originalQuery: string): Promise<string[]> {
  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4',
      messages: [
        {
          role: 'system',
          content: `You are a research assistant helping to expand academic search queries. 
          Given a research topic, provide 3-5 related search terms or alternative phrasings 
          that would help find relevant academic papers. Return only the search terms, 
          one per line, without numbering or explanations.`
        },
        {
          role: 'user',
          content: `Original search query: "${originalQuery}"`
        }
      ],
      max_tokens: 200,
      temperature: 0.3
    })

    const expandedTerms = response.choices[0]?.message?.content
      ?.split('\n')
      .map(term => term.trim())
      .filter(term => term.length > 0) || []

    return [originalQuery, ...expandedTerms]
  } catch (error) {
    console.error('Error expanding search query:', error)
    return [originalQuery]
  }
}

// Smart paper selection for research generation
export async function selectRelevantPapers(
  searchResults: PaperWithAuthors[],
  researchTopic: string,
  maxPapers = 10
): Promise<PaperWithAuthors[]> {
  if (searchResults.length <= maxPapers) {
    return searchResults
  }

  try {
    // Create summaries of papers for AI evaluation
    const paperSummaries = searchResults.map((paper, index) => ({
      index,
      title: paper.title,
      abstract: paper.abstract?.substring(0, 300) + '...',
      authors: paper.authors?.map(a => a.name).join(', '),
      venue: paper.venue,
      citation_count: paper.citation_count
    }))

    const response = await openai.chat.completions.create({
      model: 'gpt-4',
      messages: [
        {
          role: 'system',
          content: `You are a research assistant helping to select the most relevant papers for a research topic.
          Given a research topic and a list of papers, select the ${maxPapers} most relevant papers.
          Consider relevance to the topic, paper quality (venue, citations), and diversity of perspectives.
          Return only the indices of selected papers as a comma-separated list (e.g., "0,2,5,7").`
        },
        {
          role: 'user',
          content: `Research topic: "${researchTopic}"
          
          Available papers:
          ${paperSummaries.map((p, i) => 
            `${i}. "${p.title}" by ${p.authors} (${p.venue}, ${p.citation_count} citations)\n${p.abstract}`
          ).join('\n\n')}`
        }
      ],
      max_tokens: 100,
      temperature: 0.2
    })

    const selectedIndices = response.choices[0]?.message?.content
      ?.split(',')
      .map(i => parseInt(i.trim()))
      .filter(i => !isNaN(i) && i >= 0 && i < searchResults.length) || []

    if (selectedIndices.length > 0) {
      return selectedIndices.map(i => searchResults[i])
    }
  } catch (error) {
    console.error('Error selecting relevant papers:', error)
  }

  // Fallback: return top papers by citation count and relevance
  return searchResults
    .sort((a, b) => (b.citation_count || 0) - (a.citation_count || 0))
    .slice(0, maxPapers)
}

// Generate search keywords from research topic
export async function generateSearchKeywords(topic: string): Promise<string[]> {
  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4',
      messages: [
        {
          role: 'system',
          content: `Extract key search terms from a research topic. Return 5-8 specific keywords 
          or phrases that would be effective for searching academic databases. Focus on technical 
          terms, methodologies, and domain-specific vocabulary. Return one term per line.`
        },
        {
          role: 'user',
          content: `Research topic: "${topic}"`
        }
      ],
      max_tokens: 150,
      temperature: 0.3
    })

    const keywords = response.choices[0]?.message?.content
      ?.split('\n')
      .map(term => term.trim())
      .filter(term => term.length > 0) || []

    return keywords
  } catch (error) {
    console.error('Error generating search keywords:', error)
    return [topic]
  }
} 