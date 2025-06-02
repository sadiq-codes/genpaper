import { openai } from '@/lib/ai/sdk'
import type { PaperWithAuthors } from '@/types/simplified'

interface GenerationConfig {
  length: 'short' | 'medium' | 'long' // 1000, 2000, 4000+ words
  style: 'academic' | 'review' | 'survey'
  citationStyle: 'apa' | 'mla' | 'chicago' | 'ieee'
  includeMethodology?: boolean
  includeFuture?: boolean
}

interface CitationInfo {
  paperId: string
  citationText: string
  positionStart: number
  positionEnd: number
  pageRange?: string
}

interface GeneratedPaper {
  content: string
  citations: CitationInfo[]
  wordCount: number
  structure: {
    sections: string[]
    outline: string
  }
}

const SECTION_PROMPTS = {
  introduction: `Write a comprehensive introduction that:
- Establishes the research context and motivation
- Clearly states the research problem and objectives
- Provides a brief overview of the approach
- Outlines the paper structure
Keep it engaging and accessible while maintaining academic rigor.`,

  literatureReview: `Write a thorough literature review that:
- Synthesizes key findings from the provided papers
- Identifies patterns, trends, and gaps in current research
- Groups related work thematically
- Critically evaluates methodologies and findings
- Positions the current research within the broader context
Ensure proper citation integration throughout.`,

  methodology: `Describe the research methodology including:
- Research design and approach
- Data collection methods
- Analysis techniques
- Tools and frameworks used
- Limitations and considerations
Be specific and detailed enough for reproducibility.`,

  results: `Present the key findings and results:
- Summarize main discoveries from the literature
- Highlight significant patterns or trends
- Present comparative analysis
- Include relevant statistics or metrics where applicable
Focus on clarity and logical organization.`,

  discussion: `Provide thoughtful discussion that:
- Interprets the significance of findings
- Compares results with existing literature
- Addresses limitations and potential biases
- Discusses practical implications
- Suggests areas for future research
Balance critical analysis with constructive insights.`,

  conclusion: `Write a strong conclusion that:
- Summarizes key findings and contributions
- Restates the significance of the research
- Highlights practical implications
- Suggests future research directions
- Ends with a memorable closing statement
Keep it concise but impactful.`
}

export async function generateResearchPaper(
  topic: string,
  papers: PaperWithAuthors[],
  config: GenerationConfig = {
    length: 'medium',
    style: 'academic',
    citationStyle: 'apa',
    includeMethodology: true,
    includeFuture: true
  }
): Promise<GeneratedPaper> {
  const targetWordCount = config.length === 'short' ? 1000 : 
                         config.length === 'medium' ? 2000 : 4000

  // Generate paper outline first
  const outline = await generateOutline(topic, papers, config)
  
  // Generate each section
  const sections: { [key: string]: string } = {}
  const allCitations: CitationInfo[] = []
  let currentPosition = 0

  // Introduction
  const intro = await generateSection('introduction', topic, papers, config)
  sections.introduction = intro.content
  updateCitationPositions(intro.citations, currentPosition, allCitations)
  currentPosition += intro.content.length

  // Literature Review
  const litReview = await generateSection('literatureReview', topic, papers, config)
  sections.literatureReview = litReview.content
  updateCitationPositions(litReview.citations, currentPosition, allCitations)
  currentPosition += litReview.content.length

  // Methodology (if requested)
  if (config.includeMethodology) {
    const methodology = await generateSection('methodology', topic, papers, config)
    sections.methodology = methodology.content
    updateCitationPositions(methodology.citations, currentPosition, allCitations)
    currentPosition += methodology.content.length
  }

  // Results/Findings
  const results = await generateSection('results', topic, papers, config)
  sections.results = results.content
  updateCitationPositions(results.citations, currentPosition, allCitations)
  currentPosition += results.content.length

  // Discussion
  const discussion = await generateSection('discussion', topic, papers, config)
  sections.discussion = discussion.content
  updateCitationPositions(discussion.citations, currentPosition, allCitations)
  currentPosition += discussion.content.length

  // Conclusion
  const conclusion = await generateSection('conclusion', topic, papers, config)
  sections.conclusion = conclusion.content
  updateCitationPositions(conclusion.citations, currentPosition, allCitations)

  // Combine all sections
  const fullContent = [
    `# ${topic}\n\n`,
    `## Abstract\n\n${await generateAbstract(topic, sections, papers)}\n\n`,
    `## Introduction\n\n${sections.introduction}\n\n`,
    `## Literature Review\n\n${sections.literatureReview}\n\n`,
    config.includeMethodology ? `## Methodology\n\n${sections.methodology}\n\n` : '',
    `## Results and Findings\n\n${sections.results}\n\n`,
    `## Discussion\n\n${sections.discussion}\n\n`,
    `## Conclusion\n\n${sections.conclusion}\n\n`,
    `## References\n\n${generateReferences(papers, config.citationStyle)}`
  ].filter(section => section.length > 0).join('')

  return {
    content: fullContent,
    citations: allCitations,
    wordCount: fullContent.split(/\s+/).length,
    structure: {
      sections: Object.keys(sections),
      outline
    }
  }
}

async function generateOutline(
  topic: string,
  papers: PaperWithAuthors[],
  config: GenerationConfig
): Promise<string> {
  const paperSummaries = papers.slice(0, 10).map(paper => 
    `- "${paper.title}" by ${paper.authors?.map(a => a.name).join(', ')} (${paper.venue})`
  ).join('\n')

  const response = await openai.chat.completions.create({
    model: 'gpt-4',
    messages: [
      {
        role: 'system',
        content: `Create a detailed outline for an academic research paper. The outline should be logical, comprehensive, and suitable for a ${config.length} ${config.style} paper.`
      },
      {
        role: 'user',
        content: `Topic: "${topic}"
        
Available research papers:
${paperSummaries}

Create a detailed outline with main sections and key subsections.`
      }
    ],
    max_tokens: 500,
    temperature: 0.3
  })

  return response.choices[0]?.message?.content || ''
}

async function generateSection(
  sectionType: keyof typeof SECTION_PROMPTS,
  topic: string,
  papers: PaperWithAuthors[],
  config: GenerationConfig
): Promise<{ content: string; citations: CitationInfo[] }> {
  const relevantPapers = papers.slice(0, 8) // Use top 8 papers for each section
  
  const paperDetails = relevantPapers.map((paper, index) => 
    `[${index + 1}] "${paper.title}" by ${paper.authors?.map(a => a.name).join(', ')} (${paper.venue}, ${paper.publication_date})\nAbstract: ${paper.abstract?.substring(0, 200)}...`
  ).join('\n\n')

  const response = await openai.chat.completions.create({
    model: 'gpt-4',
    messages: [
      {
        role: 'system',
        content: `You are writing a ${sectionType} section for an academic research paper on "${topic}".
        
${SECTION_PROMPTS[sectionType]}

When citing papers, use the format [AuthorYear] like [Smith2023] and integrate citations naturally into the text.
Write approximately ${config.length === 'short' ? '200-300' : config.length === 'medium' ? '400-600' : '800-1000'} words.
Use clear, academic language appropriate for a ${config.style} paper.`
      },
      {
        role: 'user',
        content: `Topic: "${topic}"

Available research papers to reference:
${paperDetails}

Write the ${sectionType} section, making sure to cite relevant papers naturally throughout the text.`
      }
    ],
    max_tokens: config.length === 'short' ? 400 : config.length === 'medium' ? 800 : 1200,
    temperature: 0.4
  })

  const content = response.choices[0]?.message?.content || ''
  
  // Extract citations from the content
  const citations = extractCitations(content, relevantPapers)
  
  return { content, citations }
}

async function generateAbstract(
  topic: string,
  sections: { [key: string]: string },
  papers: PaperWithAuthors[]
): Promise<string> {
  const response = await openai.chat.completions.create({
    model: 'gpt-4',
    messages: [
      {
        role: 'system',
        content: `Write a concise academic abstract (150-250 words) that summarizes the research paper. Include:
- Background and motivation
- Main findings from the literature review
- Key insights and contributions
- Practical implications
Do not include citations in the abstract.`
      },
      {
        role: 'user',
        content: `Topic: "${topic}"

Based on this paper content, write an abstract:
Introduction: ${sections.introduction?.substring(0, 300)}...
Literature Review: ${sections.literatureReview?.substring(0, 300)}...
Results: ${sections.results?.substring(0, 300)}...
Conclusion: ${sections.conclusion?.substring(0, 300)}...`
      }
    ],
    max_tokens: 300,
    temperature: 0.3
  })

  return response.choices[0]?.message?.content || ''
}

function extractCitations(content: string, papers: PaperWithAuthors[]): CitationInfo[] {
  const citations: CitationInfo[] = []
  const citationRegex = /\[([A-Za-z]+\d{4})\]/g
  let match

  while ((match = citationRegex.exec(content)) !== null) {
    const citationText = match[1]
    const positionStart = match.index
    const positionEnd = match.index + match[0].length

    // Try to match citation to a paper
    const paper = papers.find(p => {
      const firstAuthor = p.authors?.[0]?.name.split(' ').pop()
      const year = p.publication_date?.substring(0, 4)
      return citationText.toLowerCase().includes(firstAuthor?.toLowerCase() || '') && 
             citationText.includes(year || '')
    })

    if (paper) {
      citations.push({
        paperId: paper.id,
        citationText: match[0],
        positionStart,
        positionEnd
      })
    }
  }

  return citations
}

function updateCitationPositions(
  citations: CitationInfo[],
  offset: number,
  allCitations: CitationInfo[]
): void {
  citations.forEach(citation => {
    allCitations.push({
      ...citation,
      positionStart: citation.positionStart + offset,
      positionEnd: citation.positionEnd + offset
    })
  })
}

function generateReferences(papers: PaperWithAuthors[], style: string): string {
  return papers.map(paper => {
    const authors = paper.authors?.map(a => a.name).join(', ') || 'Unknown'
    const year = paper.publication_date?.substring(0, 4) || 'n.d.'
    const title = paper.title
    const venue = paper.venue || 'Unknown venue'

    switch (style) {
      case 'apa':
        return `${authors} (${year}). ${title}. *${venue}*.`
      case 'mla':
        return `${authors}. "${title}." *${venue}*, ${year}.`
      case 'chicago':
        return `${authors}. "${title}." *${venue}* (${year}).`
      case 'ieee':
        return `${authors}, "${title}," *${venue}*, ${year}.`
      default:
        return `${authors} (${year}). ${title}. *${venue}*.`
    }
  }).join('\n\n')
}

// Streaming version for real-time generation
export async function generatePaperStream(
  topic: string,
  papers: PaperWithAuthors[],
  config: GenerationConfig,
  onProgress: (content: string, progress: number, stage: string) => void
): Promise<GeneratedPaper> {
  const stages = ['outline', 'introduction', 'literature', 'methodology', 'results', 'discussion', 'conclusion']
  let currentStage = 0
  let fullContent = ''
  const allCitations: CitationInfo[] = []

  for (const stage of stages) {
    if (stage === 'methodology' && !config.includeMethodology) continue
    
    onProgress(fullContent, (currentStage / stages.length) * 100, stage)
    
    if (stage === 'outline') {
      const outline = await generateOutline(topic, papers, config)
      fullContent += `# ${topic}\n\n`
    } else {
      const section = await generateSection(stage as keyof typeof SECTION_PROMPTS, topic, papers, config)
      fullContent += `## ${stage.charAt(0).toUpperCase() + stage.slice(1)}\n\n${section.content}\n\n`
      
      // Update citation positions
      updateCitationPositions(section.citations, fullContent.length - section.content.length, allCitations)
    }
    
    currentStage++
    onProgress(fullContent, (currentStage / stages.length) * 100, stage)
  }

  // Add references
  fullContent += `## References\n\n${generateReferences(papers, config.citationStyle)}`
  
  onProgress(fullContent, 100, 'complete')

  return {
    content: fullContent,
    citations: allCitations,
    wordCount: fullContent.split(/\s+/).length,
    structure: {
      sections: stages.filter(s => s !== 'outline' && (s !== 'methodology' || config.includeMethodology)),
      outline: 'Generated with sections'
    }
  }
} 