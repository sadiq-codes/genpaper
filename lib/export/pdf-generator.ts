/**
 * PDF Generator
 * 
 * Generates PDF from parsed document using HTML rendering + Puppeteer.
 * Uses @sparticuz/chromium for serverless environments (Vercel).
 */

import type {
  ParsedDocument,
  DocumentSection,
  DocumentContent,
  ExportPaper,
  PdfOptions,
} from './types'
import {
  formatInlineCitation,
  formatBibliography,
} from './citation-formatter'

// =============================================================================
// MAIN GENERATOR
// =============================================================================

const DEFAULT_OPTIONS: PdfOptions = {
  fontSize: 12,
  fontFamily: "'Times New Roman', Times, serif",
  lineHeight: 1.5,
  margins: {
    top: '1in',
    bottom: '1in',
    left: '1in',
    right: '1in',
  },
  paperSize: 'letter',
}

/**
 * Generate PDF buffer from parsed document
 */
export async function generatePdf(
  parsed: ParsedDocument,
  papers: ExportPaper[],
  style: string,
  options: PdfOptions = {}
): Promise<Buffer> {
  const opts = { ...DEFAULT_OPTIONS, ...options }
  
  // Build paper lookup
  const paperLookup = new Map<string, ExportPaper>()
  for (const paper of papers) {
    paperLookup.set(paper.id, paper)
  }
  
  // Generate HTML
  const html = generateHtml(parsed, paperLookup, style, opts)
  
  // Render to PDF using Puppeteer
  const pdf = await renderPdf(html, opts)
  
  return pdf
}

/**
 * Render HTML to PDF using Puppeteer
 */
async function renderPdf(html: string, opts: PdfOptions): Promise<Buffer> {
  let browser = null
  
  try {
    // Dynamic import for serverless compatibility
    // In production (Vercel), use @sparticuz/chromium
    // In development, use regular puppeteer
    const isDev = process.env.NODE_ENV === 'development'
    
    // Use puppeteer-core everywhere with different executable paths
    const puppeteer = await import('puppeteer-core')
    
    if (isDev) {
      // Development: use local Chrome
      browser = await puppeteer.default.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      })
    } else {
      // Production (Vercel): use @sparticuz/chromium
      const chromium = await import('@sparticuz/chromium')
      
      browser = await puppeteer.default.launch({
        args: chromium.default.args,
        defaultViewport: { width: 1200, height: 800 },
        executablePath: await chromium.default.executablePath(),
        headless: true,
      })
    }
    
    const page = await browser.newPage()
    await page.setContent(html, { waitUntil: 'networkidle0' })
    
    const pdf = await page.pdf({
      format: opts.paperSize === 'a4' ? 'A4' : 'Letter',
      margin: opts.margins,
      printBackground: true,
    })
    
    return Buffer.from(pdf)
  } finally {
    if (browser) {
      await browser.close()
    }
  }
}

// =============================================================================
// HTML GENERATOR
// =============================================================================

function generateHtml(
  parsed: ParsedDocument,
  paperLookup: Map<string, ExportPaper>,
  style: string,
  opts: PdfOptions
): string {
  const citedPapers = Array.from(parsed.citedPaperIds)
    .map(id => paperLookup.get(id))
    .filter((p): p is ExportPaper => p !== undefined)
  
  const bibliography = formatBibliography(citedPapers, parsed.citationNumbers, style)
  
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    @page {
      size: ${opts.paperSize === 'a4' ? 'A4' : 'letter'};
      margin: ${opts.margins?.top} ${opts.margins?.right} ${opts.margins?.bottom} ${opts.margins?.left};
    }
    
    body {
      font-family: ${opts.fontFamily};
      font-size: ${opts.fontSize}pt;
      line-height: ${opts.lineHeight};
      color: #000;
      background: #fff;
      max-width: 100%;
      margin: 0;
      padding: 0;
    }
    
    h1 {
      font-size: 16pt;
      text-align: center;
      margin-bottom: 0.5em;
    }
    
    h2 {
      font-size: 14pt;
      margin-top: 1.5em;
      margin-bottom: 0.5em;
    }
    
    h3 {
      font-size: 12pt;
      margin-top: 1em;
      margin-bottom: 0.5em;
    }
    
    p {
      margin-bottom: 1em;
      text-align: justify;
    }
    
    .title {
      font-size: 18pt;
      font-weight: bold;
      text-align: center;
      margin-bottom: 0.3em;
    }
    
    .authors {
      text-align: center;
      margin-bottom: 1em;
    }
    
    .abstract {
      margin: 1em 2em;
      font-style: italic;
    }
    
    .abstract-title {
      font-weight: bold;
      font-style: normal;
    }
    
    blockquote {
      margin: 1em 2em;
      padding-left: 1em;
      border-left: 3px solid #ccc;
    }
    
    code {
      font-family: 'Courier New', monospace;
      font-size: 10pt;
      background: #f5f5f5;
      padding: 0.1em 0.3em;
    }
    
    pre {
      font-family: 'Courier New', monospace;
      font-size: 10pt;
      background: #f5f5f5;
      padding: 1em;
      overflow-x: auto;
      white-space: pre-wrap;
    }
    
    ul, ol {
      margin-bottom: 1em;
      padding-left: 2em;
    }
    
    li {
      margin-bottom: 0.3em;
    }
    
    table {
      border-collapse: collapse;
      margin: 1em 0;
      width: 100%;
    }
    
    th, td {
      border: 1px solid #000;
      padding: 0.5em;
      text-align: left;
    }
    
    th {
      background: #f0f0f0;
      font-weight: bold;
    }
    
    hr {
      border: none;
      border-top: 1px solid #000;
      margin: 1em 0;
    }
    
    .references {
      margin-top: 2em;
    }
    
    .references h2 {
      font-size: 14pt;
    }
    
    .reference {
      padding-left: 2em;
      text-indent: -2em;
      margin-bottom: 0.5em;
    }
    
    a {
      color: #000;
      text-decoration: underline;
    }
  </style>
</head>
<body>
  ${parsed.title ? `<div class="title">${escapeHtml(parsed.title)}</div>` : ''}
  ${parsed.authors.length > 0 ? `<div class="authors">${parsed.authors.map(escapeHtml).join(', ')}</div>` : ''}
  ${parsed.abstract ? `
    <div class="abstract">
      <span class="abstract-title">Abstract: </span>
      ${escapeHtml(parsed.abstract)}
    </div>
  ` : ''}
  
  ${parsed.sections.map(s => sectionToHtml(s, paperLookup, style)).join('\n')}
  
  ${citedPapers.length > 0 ? `
    <div class="references">
      <h2>References</h2>
      ${bibliography.map(entry => `<div class="reference">${escapeHtml(entry)}</div>`).join('\n')}
    </div>
  ` : ''}
</body>
</html>`
}

// =============================================================================
// SECTION CONVERTERS
// =============================================================================

function sectionToHtml(
  section: DocumentSection,
  paperLookup: Map<string, ExportPaper>,
  style: string
): string {
  switch (section.type) {
    case 'heading':
      const level = Math.min(section.level || 1, 6)
      return `<h${level}>${contentToHtml(section.content, paperLookup, style)}</h${level}>`
    
    case 'paragraph':
      return `<p>${contentToHtml(section.content, paperLookup, style)}</p>`
    
    case 'bulletList':
      return `<ul>${(section.items || []).map(items => 
        `<li>${items.map(s => sectionToHtml(s, paperLookup, style)).join('')}</li>`
      ).join('')}</ul>`
    
    case 'orderedList':
      return `<ol>${(section.items || []).map(items => 
        `<li>${items.map(s => sectionToHtml(s, paperLookup, style)).join('')}</li>`
      ).join('')}</ol>`
    
    case 'blockquote':
      return `<blockquote>${(section.items?.[0] || []).map(s => 
        sectionToHtml(s, paperLookup, style)
      ).join('')}</blockquote>`
    
    case 'codeBlock':
      const code = section.content.map(c => c.type === 'text' ? c.text : '').join('')
      return `<pre><code>${escapeHtml(code)}</code></pre>`
    
    case 'horizontalRule':
      return '<hr>'
    
    case 'table':
      return tableToHtml(section, paperLookup, style)
    
    default:
      return `<p>${contentToHtml(section.content, paperLookup, style)}</p>`
  }
}

function tableToHtml(
  section: DocumentSection,
  paperLookup: Map<string, ExportPaper>,
  style: string
): string {
  const rows = section.rows || []
  if (rows.length === 0) return ''
  
  const headerRow = rows[0]
  const bodyRows = rows.slice(1)
  
  return `<table>
    <thead>
      <tr>
        ${headerRow.map(cell => 
          `<th>${cell.map(s => contentToHtml(s.content, paperLookup, style)).join(' ')}</th>`
        ).join('')}
      </tr>
    </thead>
    <tbody>
      ${bodyRows.map(row => `
        <tr>
          ${row.map(cell => 
            `<td>${cell.map(s => contentToHtml(s.content, paperLookup, style)).join(' ')}</td>`
          ).join('')}
        </tr>
      `).join('')}
    </tbody>
  </table>`
}

// =============================================================================
// CONTENT CONVERTER
// =============================================================================

function contentToHtml(
  content: DocumentContent[],
  paperLookup: Map<string, ExportPaper>,
  style: string
): string {
  return content.map(item => {
    switch (item.type) {
      case 'text':
        let text = escapeHtml(item.text)
        if (item.bold) text = `<strong>${text}</strong>`
        if (item.italic) text = `<em>${text}</em>`
        if (item.strikethrough) text = `<s>${text}</s>`
        if (item.underline) text = `<u>${text}</u>`
        return text
      
      case 'citation':
        const paper = paperLookup.get(item.paperId)
        const citation = paper
          ? formatInlineCitation(paper, item.citationNumber, style)
          : `[${item.citationNumber}]`
        return escapeHtml(citation)
      
      case 'code':
        return `<code>${escapeHtml(item.text)}</code>`
      
      case 'link':
        return `<a href="${escapeHtml(item.href)}">${escapeHtml(item.text)}</a>`
      
      case 'hardBreak':
        return '<br>'
      
      default:
        return ''
    }
  }).join('')
}

// =============================================================================
// UTILITIES
// =============================================================================

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}
