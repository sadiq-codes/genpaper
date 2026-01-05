import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { Document, Packer, Paragraph, TextRun, HeadingLevel } from 'docx'

interface ExportRequest {
  format: 'pdf' | 'docx' | 'latex'
  content: string
  title: string
}

// Convert HTML to plain text structure
function parseHtmlToSections(html: string): Array<{ type: 'heading' | 'paragraph'; level?: number; text: string }> {
  const sections: Array<{ type: 'heading' | 'paragraph'; level?: number; text: string }> = []
  
  // Simple regex-based parsing (for production, use a proper HTML parser)
  const tagRegex = /<(h[1-3]|p)[^>]*>([\s\S]*?)<\/\1>/gi
  let match
  
  while ((match = tagRegex.exec(html)) !== null) {
    const tag = match[1].toLowerCase()
    const text = match[2]
      .replace(/<[^>]+>/g, '') // Remove nested tags
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .trim()
    
    if (!text) continue
    
    if (tag.startsWith('h')) {
      const level = parseInt(tag[1])
      sections.push({ type: 'heading', level, text })
    } else {
      sections.push({ type: 'paragraph', text })
    }
  }
  
  return sections
}

// Generate DOCX
async function generateDocx(content: string, title: string): Promise<Buffer> {
  const sections = parseHtmlToSections(content)
  
  const children = sections.map(section => {
    if (section.type === 'heading') {
      const headingLevel = section.level === 1 
        ? HeadingLevel.HEADING_1 
        : section.level === 2 
          ? HeadingLevel.HEADING_2 
          : HeadingLevel.HEADING_3
      
      return new Paragraph({
        text: section.text,
        heading: headingLevel,
      })
    } else {
      return new Paragraph({
        children: [new TextRun(section.text)],
      })
    }
  })

  const doc = new Document({
    sections: [{
      properties: {},
      children: [
        new Paragraph({
          text: title,
          heading: HeadingLevel.TITLE,
        }),
        ...children,
      ],
    }],
  })

  return await Packer.toBuffer(doc)
}

// Generate LaTeX
function generateLatex(content: string, title: string): string {
  const sections = parseHtmlToSections(content)
  
  let latex = `\\documentclass[12pt]{article}
\\usepackage[utf8]{inputenc}
\\usepackage[T1]{fontenc}
\\usepackage{amsmath}
\\usepackage{hyperref}
\\usepackage{natbib}

\\title{${escapeLatex(title)}}
\\author{}
\\date{\\today}

\\begin{document}

\\maketitle

`

  for (const section of sections) {
    if (section.type === 'heading') {
      const cmd = section.level === 1 ? 'section' : section.level === 2 ? 'subsection' : 'subsubsection'
      latex += `\\${cmd}{${escapeLatex(section.text)}}\n\n`
    } else {
      latex += `${escapeLatex(section.text)}\n\n`
    }
  }

  latex += `\\end{document}\n`
  
  return latex
}

function escapeLatex(text: string): string {
  return text
    .replace(/\\/g, '\\textbackslash{}')
    .replace(/[&%$#_{}]/g, '\\$&')
    .replace(/~/g, '\\textasciitilde{}')
    .replace(/\^/g, '\\textasciicircum{}')
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    
    // Verify user is authenticated
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body: ExportRequest = await request.json()
    const { format, content, title } = body

    let result: Buffer | string
    let contentType: string
    let filename: string

    switch (format) {
      case 'docx':
        result = await generateDocx(content, title)
        contentType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        filename = `${title}.docx`
        break
        
      case 'latex':
        result = generateLatex(content, title)
        contentType = 'application/x-tex'
        filename = `${title}.tex`
        break
        
      case 'pdf':
        // For PDF, we'll return the LaTeX and let the client handle it
        // In production, you'd use a service like Overleaf API or a LaTeX compiler
        result = generateLatex(content, title)
        contentType = 'application/x-tex'
        filename = `${title}.tex`
        break
        
      default:
        return NextResponse.json({ error: 'Invalid format' }, { status: 400 })
    }

    const buffer = typeof result === 'string' ? Buffer.from(result, 'utf-8') : result

    return new NextResponse(buffer, {
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    })

  } catch (error) {
    console.error('Export error:', error)
    return NextResponse.json(
      { error: 'Failed to export document' },
      { status: 500 }
    )
  }
}
