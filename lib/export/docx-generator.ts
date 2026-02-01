/**
 * DOCX Generator
 * 
 * Generates Word documents from parsed document structure.
 * Uses the docx library for proper formatting.
 */

import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
  ExternalHyperlink,
  TabStopType,
  TabStopPosition,
  convertInchesToTwip,
} from 'docx'
import type {
  ParsedDocument,
  DocumentSection,
  DocumentContent,
  ExportPaper,
  DocxOptions,
} from './types'
import {
  formatInlineCitation,
  formatBibliography,
  isNumericCitationStyle,
} from './citation-formatter'

// =============================================================================
// MAIN GENERATOR
// =============================================================================

const DEFAULT_OPTIONS: DocxOptions = {
  fontSize: 24, // 12pt in half-points
  fontFamily: 'Times New Roman',
  lineSpacing: 276, // 1.15 line spacing
  margins: {
    top: 1440, // 1 inch in twips
    bottom: 1440,
    left: 1440,
    right: 1440,
  },
}

export async function generateDocx(
  parsed: ParsedDocument,
  papers: ExportPaper[],
  style: string,
  options: DocxOptions = {}
): Promise<Buffer> {
  const opts = { ...DEFAULT_OPTIONS, ...options }
  
  // Build paper lookup
  const paperLookup = new Map<string, ExportPaper>()
  for (const paper of papers) {
    paperLookup.set(paper.id, paper)
  }
  
  // Create document sections
  const children: Paragraph[] = []
  
  // Title
  if (parsed.title) {
    children.push(
      new Paragraph({
        children: [
          new TextRun({
            text: parsed.title,
            bold: true,
            size: 32, // 16pt
            font: opts.fontFamily,
          }),
        ],
        alignment: AlignmentType.CENTER,
        spacing: { after: 400 },
      })
    )
  }
  
  // Authors
  if (parsed.authors.length > 0) {
    children.push(
      new Paragraph({
        children: [
          new TextRun({
            text: parsed.authors.join(', '),
            size: opts.fontSize,
            font: opts.fontFamily,
          }),
        ],
        alignment: AlignmentType.CENTER,
        spacing: { after: 400 },
      })
    )
  }
  
  // Abstract
  if (parsed.abstract) {
    children.push(
      new Paragraph({
        children: [
          new TextRun({
            text: 'Abstract',
            bold: true,
            size: opts.fontSize,
            font: opts.fontFamily,
          }),
        ],
        spacing: { before: 400, after: 200 },
      }),
      new Paragraph({
        children: [
          new TextRun({
            text: parsed.abstract,
            italics: true,
            size: opts.fontSize,
            font: opts.fontFamily,
          }),
        ],
        spacing: { after: 400 },
      })
    )
  }
  
  // Content sections
  for (const section of parsed.sections) {
    const paragraphs = sectionToParagraphs(section, paperLookup, parsed.citationNumbers, style, opts)
    children.push(...paragraphs)
  }
  
  // References section
  const citedPapers = papers.filter(p => parsed.citedPaperIds.has(p.id))
  if (citedPapers.length > 0) {
    children.push(
      new Paragraph({
        children: [
          new TextRun({
            text: 'References',
            bold: true,
            size: 28, // 14pt
            font: opts.fontFamily,
          }),
        ],
        heading: HeadingLevel.HEADING_1,
        spacing: { before: 600, after: 300 },
      })
    )
    
    const bibEntries = formatBibliography(citedPapers, parsed.citationNumbers, style)
    for (const entry of bibEntries) {
      children.push(
        new Paragraph({
          children: [
            new TextRun({
              text: entry,
              size: opts.fontSize,
              font: opts.fontFamily,
            }),
          ],
          // Hanging indent for bibliography
          indent: {
            left: convertInchesToTwip(0.5),
            hanging: convertInchesToTwip(0.5),
          },
          spacing: { after: 200 },
        })
      )
    }
  }
  
  // Create document
  const doc = new Document({
    sections: [
      {
        properties: {
          page: {
            margin: opts.margins,
          },
        },
        children,
      },
    ],
  })
  
  return await Packer.toBuffer(doc)
}

// =============================================================================
// SECTION CONVERTERS
// =============================================================================

function sectionToParagraphs(
  section: DocumentSection,
  paperLookup: Map<string, ExportPaper>,
  citationNumbers: Map<string, number>,
  style: string,
  opts: DocxOptions
): Paragraph[] {
  switch (section.type) {
    case 'heading':
      return [headingToParagraph(section, paperLookup, citationNumbers, style, opts)]
    
    case 'paragraph':
      return [paragraphToParagraph(section, paperLookup, citationNumbers, style, opts)]
    
    case 'bulletList':
      return listToParagraphs(section, false, paperLookup, citationNumbers, style, opts)
    
    case 'orderedList':
      return listToParagraphs(section, true, paperLookup, citationNumbers, style, opts)
    
    case 'blockquote':
      return blockquoteToParagraphs(section, paperLookup, citationNumbers, style, opts)
    
    case 'codeBlock':
      return [codeBlockToParagraph(section, opts)]
    
    case 'horizontalRule':
      return [
        new Paragraph({
          children: [new TextRun({ text: '─'.repeat(50) })],
          alignment: AlignmentType.CENTER,
          spacing: { before: 200, after: 200 },
        }),
      ]
    
    case 'table':
      // Tables are complex - flatten to text for now
      return tableToParagraphs(section, paperLookup, citationNumbers, style, opts)
    
    default:
      return [paragraphToParagraph(section, paperLookup, citationNumbers, style, opts)]
  }
}

function headingToParagraph(
  section: DocumentSection,
  paperLookup: Map<string, ExportPaper>,
  citationNumbers: Map<string, number>,
  style: string,
  opts: DocxOptions
): Paragraph {
  const level = section.level || 1
  const headingLevel = level === 1 ? HeadingLevel.HEADING_1
    : level === 2 ? HeadingLevel.HEADING_2
    : HeadingLevel.HEADING_3
  
  const fontSize = level === 1 ? 28 : level === 2 ? 26 : 24
  
  return new Paragraph({
    children: contentToTextRuns(section.content, paperLookup, citationNumbers, style, {
      ...opts,
      fontSize,
    }, true),
    heading: headingLevel,
    spacing: { before: 400, after: 200 },
  })
}

function paragraphToParagraph(
  section: DocumentSection,
  paperLookup: Map<string, ExportPaper>,
  citationNumbers: Map<string, number>,
  style: string,
  opts: DocxOptions
): Paragraph {
  return new Paragraph({
    children: contentToTextRuns(section.content, paperLookup, citationNumbers, style, opts, false),
    spacing: { after: 200, line: opts.lineSpacing },
  })
}

function listToParagraphs(
  section: DocumentSection,
  ordered: boolean,
  paperLookup: Map<string, ExportPaper>,
  citationNumbers: Map<string, number>,
  style: string,
  opts: DocxOptions
): Paragraph[] {
  const paragraphs: Paragraph[] = []
  const items = section.items || []
  
  for (let i = 0; i < items.length; i++) {
    const itemSections = items[i]
    const bullet = ordered ? `${i + 1}. ` : '• '
    
    for (let j = 0; j < itemSections.length; j++) {
      const itemSection = itemSections[j]
      const runs = contentToTextRuns(
        itemSection.content,
        paperLookup,
        citationNumbers,
        style,
        opts,
        false
      )
      
      // Add bullet/number only to first paragraph of item
      if (j === 0) {
        runs.unshift(new TextRun({ text: bullet, font: opts.fontFamily, size: opts.fontSize }))
      }
      
      paragraphs.push(
        new Paragraph({
          children: runs,
          indent: { left: convertInchesToTwip(0.5) },
          spacing: { after: 100 },
        })
      )
    }
  }
  
  return paragraphs
}

function blockquoteToParagraphs(
  section: DocumentSection,
  paperLookup: Map<string, ExportPaper>,
  citationNumbers: Map<string, number>,
  style: string,
  opts: DocxOptions
): Paragraph[] {
  const paragraphs: Paragraph[] = []
  const items = section.items?.[0] || []
  
  for (const itemSection of items) {
    paragraphs.push(
      new Paragraph({
        children: contentToTextRuns(itemSection.content, paperLookup, citationNumbers, style, opts, false),
        indent: { left: convertInchesToTwip(0.5) },
        spacing: { after: 100 },
        shading: { fill: 'F0F0F0' },
      })
    )
  }
  
  return paragraphs
}

function codeBlockToParagraph(section: DocumentSection, opts: DocxOptions): Paragraph {
  const text = section.content.map(c => c.type === 'text' ? c.text : '').join('')
  
  return new Paragraph({
    children: [
      new TextRun({
        text,
        font: 'Courier New',
        size: opts.fontSize! - 2,
      }),
    ],
    shading: { fill: 'F5F5F5' },
    spacing: { before: 200, after: 200 },
  })
}

function tableToParagraphs(
  section: DocumentSection,
  paperLookup: Map<string, ExportPaper>,
  citationNumbers: Map<string, number>,
  style: string,
  opts: DocxOptions
): Paragraph[] {
  // Simplified table rendering - convert to text
  const paragraphs: Paragraph[] = []
  const rows = section.rows || []
  
  for (const row of rows) {
    const cells: string[] = []
    for (const cell of row) {
      const cellText = cell.map(s => 
        s.content.map(c => {
          if (c.type === 'text') return c.text
          if (c.type === 'citation') {
            const paper = paperLookup.get(c.paperId)
            return paper 
              ? formatInlineCitation(paper, c.citationNumber, style)
              : `[${c.citationNumber}]`
          }
          return ''
        }).join('')
      ).join(' ')
      cells.push(cellText)
    }
    
    paragraphs.push(
      new Paragraph({
        children: [
          new TextRun({
            text: cells.join('\t|\t'),
            font: opts.fontFamily,
            size: opts.fontSize,
          }),
        ],
        tabStops: [
          { type: TabStopType.LEFT, position: TabStopPosition.MAX },
        ],
        spacing: { after: 100 },
      })
    )
  }
  
  return paragraphs
}

// =============================================================================
// CONTENT CONVERTER
// =============================================================================

function contentToTextRuns(
  content: DocumentContent[],
  paperLookup: Map<string, ExportPaper>,
  citationNumbers: Map<string, number>,
  style: string,
  opts: DocxOptions,
  isHeading: boolean
): (TextRun | ExternalHyperlink)[] {
  const runs: (TextRun | ExternalHyperlink)[] = []
  
  for (const item of content) {
    switch (item.type) {
      case 'text':
        runs.push(
          new TextRun({
            text: item.text,
            bold: item.bold || isHeading,
            italics: item.italic,
            strike: item.strikethrough,
            font: opts.fontFamily,
            size: opts.fontSize,
          })
        )
        break
      
      case 'citation':
        const paper = paperLookup.get(item.paperId)
        const citationText = paper
          ? formatInlineCitation(paper, item.citationNumber, style)
          : `[${item.citationNumber}]`
        
        runs.push(
          new TextRun({
            text: citationText,
            font: opts.fontFamily,
            size: opts.fontSize,
          })
        )
        break
      
      case 'code':
        runs.push(
          new TextRun({
            text: item.text,
            font: 'Courier New',
            size: opts.fontSize! - 2,
          })
        )
        break
      
      case 'link':
        runs.push(
          new ExternalHyperlink({
            children: [
              new TextRun({
                text: item.text,
                style: 'Hyperlink',
                font: opts.fontFamily,
                size: opts.fontSize,
              }),
            ],
            link: item.href,
          })
        )
        break
      
      case 'hardBreak':
        runs.push(new TextRun({ text: '', break: 1 }))
        break
    }
  }
  
  return runs
}
