import { describe, expect, it } from 'vitest'
import { markdownToTipTap } from '@/components/editor/utils/markdown-to-tiptap'
import { tiptapToMarkdown } from '@/components/editor/utils/tiptap-to-markdown'

type AnyNode = {
  type: string
  attrs?: Record<string, unknown>
  content?: AnyNode[]
  text?: string
}

function findFirstTableNode(doc: AnyNode): AnyNode | null {
  if (doc.type === 'table') return doc
  for (const child of doc.content || []) {
    const table = findFirstTableNode(child)
    if (table) return table
  }
  return null
}

describe('table markdown utils', () => {
  it('escapes table cell pipes and normalizes newlines on export', () => {
    const doc: AnyNode = {
      type: 'doc',
      content: [
        {
          type: 'table',
          content: [
            {
              type: 'tableRow',
              content: [
                {
                  type: 'tableHeader',
                  content: [
                    {
                      type: 'paragraph',
                      content: [{ type: 'text', text: 'Study | Name' }],
                    },
                  ],
                },
                {
                  type: 'tableHeader',
                  content: [
                    {
                      type: 'paragraph',
                      content: [{ type: 'text', text: 'Notes' }],
                    },
                  ],
                },
              ],
            },
            {
              type: 'tableRow',
              content: [
                {
                  type: 'tableCell',
                  content: [
                    {
                      type: 'paragraph',
                      content: [{ type: 'text', text: 'Line 1\nLine 2' }],
                    },
                  ],
                },
                {
                  type: 'tableCell',
                  content: [
                    {
                      type: 'paragraph',
                      content: [{ type: 'text', text: 'A | B' }],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    }

    const markdown = tiptapToMarkdown(doc)

    expect(markdown).toContain('| Study \\| Name | Notes |')
    expect(markdown).toContain('Line 1<br>Line 2')
    expect(markdown).toContain('A \\| B')
  })

  it('exports alignment separators from table header paragraph attrs', () => {
    const doc: AnyNode = {
      type: 'doc',
      content: [
        {
          type: 'table',
          content: [
            {
              type: 'tableRow',
              content: [
                {
                  type: 'tableHeader',
                  content: [
                    {
                      type: 'paragraph',
                      attrs: { textAlign: 'left' },
                      content: [{ type: 'text', text: 'A' }],
                    },
                  ],
                },
                {
                  type: 'tableHeader',
                  content: [
                    {
                      type: 'paragraph',
                      attrs: { textAlign: 'center' },
                      content: [{ type: 'text', text: 'B' }],
                    },
                  ],
                },
                {
                  type: 'tableHeader',
                  content: [
                    {
                      type: 'paragraph',
                      attrs: { textAlign: 'right' },
                      content: [{ type: 'text', text: 'C' }],
                    },
                  ],
                },
              ],
            },
            {
              type: 'tableRow',
              content: [
                {
                  type: 'tableCell',
                  content: [{ type: 'paragraph', content: [{ type: 'text', text: '1' }] }],
                },
                {
                  type: 'tableCell',
                  content: [{ type: 'paragraph', content: [{ type: 'text', text: '2' }] }],
                },
                {
                  type: 'tableCell',
                  content: [{ type: 'paragraph', content: [{ type: 'text', text: '3' }] }],
                },
              ],
            },
          ],
        },
      ],
    }

    const markdown = tiptapToMarkdown(doc)
    expect(markdown).toContain('| :--- | :---: | ---: |')
  })

  it('imports markdown table alignment into paragraph textAlign attrs', () => {
    const markdown = [
      '| Col A | Col B | Col C |',
      '| :--- | :---: | ---: |',
      '| a1 | b1 | c1 |',
    ].join('\n')

    const doc = markdownToTipTap(markdown) as AnyNode
    const table = findFirstTableNode(doc)

    expect(table).not.toBeNull()

    const headerRow = table?.content?.[0]
    const headerCells = headerRow?.content || []

    const col1Align = headerCells[0]?.content?.[0]?.attrs?.textAlign
    const col2Align = headerCells[1]?.content?.[0]?.attrs?.textAlign
    const col3Align = headerCells[2]?.content?.[0]?.attrs?.textAlign

    expect(col1Align).toBe('left')
    expect(col2Align).toBe('center')
    expect(col3Align).toBe('right')
  })

  it('preserves alignment through markdown -> tiptap -> markdown roundtrip', () => {
    const input = [
      '| H1 | H2 |',
      '| :--- | ---: |',
      '| v1 | v2 |',
    ].join('\n')

    const doc = markdownToTipTap(input)
    const output = tiptapToMarkdown(doc as AnyNode)

    expect(output).toContain('| :--- | ---: |')
  })
})
