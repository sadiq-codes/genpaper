import { describe, expect, it } from 'vitest'
import JSZip from 'jszip'
import { parseDocument } from '@/lib/export/document-parser'
import { generateDocx } from '@/lib/export/docx-generator'
import type { ExportPaper, TipTapDocument } from '@/lib/export/types'

const PAPER_ID = '11111111-1111-1111-1111-111111111111'
const INSTANCE_ID = 'instance-42'

describe('export citation marker parsing', () => {
  it('parses inline marker text into citation refs', () => {
    const doc: TipTapDocument = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: `Alpha [@${PAPER_ID}#${INSTANCE_ID}] beta [CITE: ${PAPER_ID}] gamma`,
            },
          ],
        },
      ],
    }

    const parsed = parseDocument(doc, 'Marker Parse Test')
    const paragraph = parsed.sections[0]

    expect(paragraph?.type).toBe('paragraph')
    expect(paragraph?.content.map(item => item.type)).toEqual([
      'text',
      'citation',
      'text',
      'citation',
      'text',
    ])

    const firstCitation = paragraph?.content[1]
    const secondCitation = paragraph?.content[3]

    expect(firstCitation).toMatchObject({
      type: 'citation',
      paperId: PAPER_ID,
      instanceId: INSTANCE_ID,
      citationNumber: 1,
    })
    expect(secondCitation).toMatchObject({
      type: 'citation',
      paperId: PAPER_ID,
      citationNumber: 1,
    })
  })

  it('does not leak raw markers into DOCX output', async () => {
    const papers: ExportPaper[] = [
      {
        id: PAPER_ID,
        title: 'Sample Study',
        authors: ['Jane Doe'],
        year: 2024,
      },
    ]

    const doc: TipTapDocument = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: `Result [@${PAPER_ID}] and follow-up [CITE: ${PAPER_ID}]`,
            },
          ],
        },
      ],
    }

    const parsed = parseDocument(doc, 'DOCX Marker Test')
    const docxBuffer = await generateDocx(parsed, papers, 'apa')
    const zip = await JSZip.loadAsync(docxBuffer)
    const documentXml = await zip.file('word/document.xml')?.async('string')

    expect(documentXml).toBeTruthy()
    expect(documentXml!).not.toContain('[@')
    expect(documentXml!).not.toContain('[CITE:')
    expect(documentXml!).toContain('(Doe, 2024)')
  })
})
