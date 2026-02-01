/**
 * LaTeX Generator
 * 
 * Generates LaTeX (.tex) and BibTeX (.bib) files from parsed document.
 * Returns a ZIP buffer containing both files.
 */

import JSZip from 'jszip'
import type {
  ParsedDocument,
  DocumentSection,
  DocumentContent,
  ExportPaper,
  LatexOptions,
} from './types'
import { getLatexBibStyle } from './types'
import { paperToBibtex, generateBibtexKey } from './citation-formatter'

// =============================================================================
// MAIN GENERATOR
// =============================================================================

const DEFAULT_OPTIONS: LatexOptions = {
  documentClass: 'article',
  fontSize: 12,
  packages: [
    'inputenc',
    'fontenc',
    'amsmath',
    'amssymb',
    'graphicx',
    'hyperref',
    'natbib',
    'geometry',
  ],
  bibliographyStyle: 'apalike',
}

export interface LatexOutput {
  tex: string
  bib: string
}

/**
 * Generate LaTeX and BibTeX content
 */
export function generateLatex(
  parsed: ParsedDocument,
  papers: ExportPaper[],
  style: string,
  options: LatexOptions = {}
): LatexOutput {
  const opts = { ...DEFAULT_OPTIONS, ...options }
  
  // Build paper lookup and bibtex key mapping
  const paperLookup = new Map<string, ExportPaper>()
  const bibtexKeys = new Map<string, string>()
  
  for (const paper of papers) {
    paperLookup.set(paper.id, paper)
    if (parsed.citedPaperIds.has(paper.id)) {
      bibtexKeys.set(paper.id, generateBibtexKey(paper))
    }
  }
  
  // Generate .tex content
  const tex = generateTexContent(parsed, paperLookup, bibtexKeys, style, opts)
  
  // Generate .bib content
  const citedPapers = papers.filter(p => parsed.citedPaperIds.has(p.id))
  const bib = citedPapers.map(p => paperToBibtex(p)).join('\n\n')
  
  return { tex, bib }
}

/**
 * Generate LaTeX files as a ZIP buffer
 */
export async function generateLatexZip(
  parsed: ParsedDocument,
  papers: ExportPaper[],
  style: string,
  options: LatexOptions = {}
): Promise<Buffer> {
  const { tex, bib } = generateLatex(parsed, papers, style, options)
  
  const zip = new JSZip()
  zip.file('paper.tex', tex)
  zip.file('references.bib', bib)
  
  // Add a README for Overleaf users
  const readme = `# LaTeX Export

This folder contains:
- paper.tex - Main document
- references.bib - Bibliography file

## To compile:
1. Upload to Overleaf, or
2. Run locally:
   pdflatex paper.tex
   bibtex paper
   pdflatex paper.tex
   pdflatex paper.tex
`
  zip.file('README.md', readme)
  
  return await zip.generateAsync({ type: 'nodebuffer' })
}

// =============================================================================
// TEX CONTENT GENERATOR
// =============================================================================

function generateTexContent(
  parsed: ParsedDocument,
  paperLookup: Map<string, ExportPaper>,
  bibtexKeys: Map<string, string>,
  style: string,
  opts: LatexOptions
): string {
  const lines: string[] = []
  
  // Document class
  lines.push(`\\documentclass[${opts.fontSize}pt]{${opts.documentClass}}`)
  lines.push('')
  
  // Packages
  for (const pkg of opts.packages || []) {
    if (pkg === 'inputenc') {
      lines.push('\\usepackage[utf8]{inputenc}')
    } else if (pkg === 'fontenc') {
      lines.push('\\usepackage[T1]{fontenc}')
    } else if (pkg === 'geometry') {
      lines.push('\\usepackage[margin=1in]{geometry}')
    } else {
      lines.push(`\\usepackage{${pkg}}`)
    }
  }
  lines.push('')
  
  // Hyperref setup
  lines.push('\\hypersetup{')
  lines.push('  colorlinks=true,')
  lines.push('  linkcolor=blue,')
  lines.push('  citecolor=blue,')
  lines.push('  urlcolor=blue')
  lines.push('}')
  lines.push('')
  
  // Title, author
  lines.push(`\\title{${escapeLatex(parsed.title)}}`)
  if (parsed.authors.length > 0) {
    lines.push(`\\author{${parsed.authors.map(escapeLatex).join(' \\and ')}}`)
  }
  lines.push('\\date{\\today}')
  lines.push('')
  
  // Begin document
  lines.push('\\begin{document}')
  lines.push('')
  lines.push('\\maketitle')
  lines.push('')
  
  // Abstract
  if (parsed.abstract) {
    lines.push('\\begin{abstract}')
    lines.push(escapeLatex(parsed.abstract))
    lines.push('\\end{abstract}')
    lines.push('')
  }
  
  // Content
  for (const section of parsed.sections) {
    const sectionLines = sectionToLatex(section, paperLookup, bibtexKeys, style)
    lines.push(...sectionLines)
  }
  
  // Bibliography
  lines.push('')
  lines.push(`\\bibliographystyle{${getLatexBibStyle(style)}}`)
  lines.push('\\bibliography{references}')
  lines.push('')
  lines.push('\\end{document}')
  
  return lines.join('\n')
}

// =============================================================================
// SECTION CONVERTERS
// =============================================================================

function sectionToLatex(
  section: DocumentSection,
  paperLookup: Map<string, ExportPaper>,
  bibtexKeys: Map<string, string>,
  style: string
): string[] {
  switch (section.type) {
    case 'heading':
      return [headingToLatex(section, paperLookup, bibtexKeys, style)]
    
    case 'paragraph':
      return [paragraphToLatex(section, paperLookup, bibtexKeys, style), '']
    
    case 'bulletList':
      return listToLatex(section, 'itemize', paperLookup, bibtexKeys, style)
    
    case 'orderedList':
      return listToLatex(section, 'enumerate', paperLookup, bibtexKeys, style)
    
    case 'blockquote':
      return blockquoteToLatex(section, paperLookup, bibtexKeys, style)
    
    case 'codeBlock':
      return codeBlockToLatex(section)
    
    case 'horizontalRule':
      return ['\\noindent\\rule{\\textwidth}{0.4pt}', '']
    
    case 'table':
      return tableToLatex(section, paperLookup, bibtexKeys, style)
    
    default:
      return [paragraphToLatex(section, paperLookup, bibtexKeys, style), '']
  }
}

function headingToLatex(
  section: DocumentSection,
  paperLookup: Map<string, ExportPaper>,
  bibtexKeys: Map<string, string>,
  style: string
): string {
  const level = section.level || 1
  const command = level === 1 ? '\\section'
    : level === 2 ? '\\subsection'
    : '\\subsubsection'
  
  const content = contentToLatex(section.content, paperLookup, bibtexKeys, style)
  return `${command}{${content}}`
}

function paragraphToLatex(
  section: DocumentSection,
  paperLookup: Map<string, ExportPaper>,
  bibtexKeys: Map<string, string>,
  style: string
): string {
  return contentToLatex(section.content, paperLookup, bibtexKeys, style)
}

function listToLatex(
  section: DocumentSection,
  env: 'itemize' | 'enumerate',
  paperLookup: Map<string, ExportPaper>,
  bibtexKeys: Map<string, string>,
  style: string
): string[] {
  const lines: string[] = [`\\begin{${env}}`]
  
  for (const itemSections of section.items || []) {
    const itemContent = itemSections
      .map(s => contentToLatex(s.content, paperLookup, bibtexKeys, style))
      .join(' ')
    lines.push(`  \\item ${itemContent}`)
  }
  
  lines.push(`\\end{${env}}`)
  lines.push('')
  
  return lines
}

function blockquoteToLatex(
  section: DocumentSection,
  paperLookup: Map<string, ExportPaper>,
  bibtexKeys: Map<string, string>,
  style: string
): string[] {
  const lines: string[] = ['\\begin{quote}']
  
  for (const itemSection of section.items?.[0] || []) {
    lines.push(contentToLatex(itemSection.content, paperLookup, bibtexKeys, style))
  }
  
  lines.push('\\end{quote}')
  lines.push('')
  
  return lines
}

function codeBlockToLatex(section: DocumentSection): string[] {
  const text = section.content.map(c => c.type === 'text' ? c.text : '').join('')
  const lang = section.language || ''
  
  return [
    '\\begin{verbatim}',
    text,
    '\\end{verbatim}',
    '',
  ]
}

function tableToLatex(
  section: DocumentSection,
  paperLookup: Map<string, ExportPaper>,
  bibtexKeys: Map<string, string>,
  style: string
): string[] {
  const rows = section.rows || []
  if (rows.length === 0) return []
  
  const numCols = rows[0]?.length || 1
  const colSpec = 'l'.repeat(numCols)
  
  const lines: string[] = [
    '\\begin{table}[h]',
    '\\centering',
    `\\begin{tabular}{${colSpec}}`,
    '\\hline',
  ]
  
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    const cells = row.map(cell => {
      return cell.map(s => 
        contentToLatex(s.content, paperLookup, bibtexKeys, style)
      ).join(' ')
    })
    
    lines.push(cells.join(' & ') + ' \\\\')
    
    // Add hline after header row
    if (i === 0) {
      lines.push('\\hline')
    }
  }
  
  lines.push('\\hline')
  lines.push('\\end{tabular}')
  lines.push('\\end{table}')
  lines.push('')
  
  return lines
}

// =============================================================================
// CONTENT CONVERTER
// =============================================================================

function contentToLatex(
  content: DocumentContent[],
  paperLookup: Map<string, ExportPaper>,
  bibtexKeys: Map<string, string>,
  style: string
): string {
  return content.map(item => {
    switch (item.type) {
      case 'text':
        let text = escapeLatex(item.text)
        if (item.bold) text = `\\textbf{${text}}`
        if (item.italic) text = `\\textit{${text}}`
        if (item.strikethrough) text = `\\sout{${text}}`
        return text
      
      case 'citation':
        const key = bibtexKeys.get(item.paperId)
        if (key) {
          return `\\cite{${key}}`
        }
        return `[${item.citationNumber}]`
      
      case 'code':
        return `\\texttt{${escapeLatex(item.text)}}`
      
      case 'link':
        return `\\href{${item.href}}{${escapeLatex(item.text)}}`
      
      case 'hardBreak':
        return '\\\\'
      
      default:
        return ''
    }
  }).join('')
}

// =============================================================================
// UTILITIES
// =============================================================================

function escapeLatex(text: string): string {
  return text
    .replace(/\\/g, '\\textbackslash{}')
    .replace(/[&]/g, '\\&')
    .replace(/[%]/g, '\\%')
    .replace(/[$]/g, '\\$')
    .replace(/[#]/g, '\\#')
    .replace(/[_]/g, '\\_')
    .replace(/[{]/g, '\\{')
    .replace(/[}]/g, '\\}')
    .replace(/[~]/g, '\\textasciitilde{}')
    .replace(/[\^]/g, '\\textasciicircum{}')
}
