import { describe, expect, it } from 'vitest'
import JSZip from 'jszip'
import { generateDocx } from '@/lib/export/docx-generator'
import type { DocumentSection, ParsedDocument } from '@/lib/export/types'

describe('DOCX table export', () => {
  it('exports table sections as native DOCX tables', async () => {
    const tableSection: DocumentSection = {
      type: 'table',
      content: [],
      rows: [
        [
          [{ type: 'paragraph', content: [{ type: 'text', text: 'Study' }] }],
          [{ type: 'paragraph', content: [{ type: 'text', text: 'Result' }] }],
        ],
        [
          [{ type: 'paragraph', content: [{ type: 'text', text: 'Paper A' }] }],
          [{ type: 'paragraph', content: [{ type: 'text', text: '10%' }] }],
        ],
      ],
    }

    const parsed: ParsedDocument = {
      title: 'Table Export Test',
      authors: [],
      abstract: '',
      sections: [tableSection],
      citations: [],
      citedPaperIds: new Set<string>(),
      citationNumbers: new Map<string, number>(),
    }

    const docxBuffer = await generateDocx(parsed, [], 'apa')
    const zip = await JSZip.loadAsync(docxBuffer)
    const documentXml = await zip.file('word/document.xml')?.async('string')

    expect(documentXml).toBeTruthy()
    expect(documentXml!).toContain('<w:tbl>')
    expect(documentXml!).toContain('Study')
    expect(documentXml!).toContain('Result')
    expect(documentXml!).toContain('Paper A')
    // Legacy fallback emitted tab-delimited pseudo-table text.
    expect(documentXml!).not.toContain('\t|\t')
  })
})
