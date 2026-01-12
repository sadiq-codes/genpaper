/**
 * TipTap JSON to Markdown serializer
 * 
 * Converts TipTap editor content back to clean markdown for storage.
 * Citation nodes are serialized as [CITE: paper_id] markers.
 */

interface TipTapNode {
  type: string
  attrs?: Record<string, any>
  marks?: Array<{ type: string; attrs?: Record<string, any> }>
  content?: TipTapNode[]
  text?: string
}

// Priority order for mark serialization (outermost to innermost)
const MARK_PRIORITY = ['link', 'code', 'bold', 'italic', 'strike']

/**
 * Serialize marks (bold, italic, etc.) around text
 * Marks are sorted by priority to ensure consistent output
 */
function serializeMarks(text: string, marks?: TipTapNode['marks']): string {
  if (!marks || marks.length === 0) return text
  
  // Sort marks by priority for consistent serialization
  const sorted = [...marks].sort(
    (a, b) => MARK_PRIORITY.indexOf(a.type) - MARK_PRIORITY.indexOf(b.type)
  )
  
  let result = text
  
  for (const mark of sorted) {
    switch (mark.type) {
      case 'bold':
        result = `**${result}**`
        break
      case 'italic':
        result = `*${result}*`
        break
      case 'strike':
        result = `~~${result}~~`
        break
      case 'code':
        result = `\`${result}\``
        break
      case 'link':
        result = `[${result}](${mark.attrs?.href || ''})`
        break
    }
  }
  
  return result
}

/**
 * Serialize inline/phrasing content to markdown
 */
function serializeInline(nodes: TipTapNode[] | undefined): string {
  if (!nodes || nodes.length === 0) return ''
  
  return nodes.map(node => {
    switch (node.type) {
      case 'text':
        return serializeMarks(node.text || '', node.marks)
      
      case 'citation':
        // Serialize citation back to marker format
        return `[CITE: ${node.attrs?.id || 'unknown'}]`
      
      case 'mathematics':
        const latex = node.attrs?.latex || ''
        const displayMode = node.attrs?.displayMode
        return displayMode ? `$$${latex}$$` : `$${latex}$`
      
      case 'hardBreak':
        return '  \n'
      
      case 'image':
        const alt = node.attrs?.alt || ''
        const src = node.attrs?.src || ''
        const title = node.attrs?.title
        return title ? `![${alt}](${src} "${title}")` : `![${alt}](${src})`
      
      default:
        // Unknown inline types - skip them
        return ''
    }
  }).join('')
}

/**
 * Serialize a block node to markdown
 */
function serializeBlock(node: TipTapNode, depth: number = 0): string {
  switch (node.type) {
    case 'doc':
      return (node.content || [])
        .map(child => serializeBlock(child, depth))
        .join('\n\n')
    
    case 'paragraph':
      return serializeInline(node.content)
    
    case 'heading': {
      const level = node.attrs?.level || 1
      const prefix = '#'.repeat(level)
      return `${prefix} ${serializeInline(node.content)}`
    }
    
    case 'bulletList':
      return (node.content || [])
        .map(item => serializeBlock(item, depth))
        .join('\n')
    
    case 'orderedList': {
      const start = node.attrs?.start || 1
      return (node.content || [])
        .map((item, i) => {
          const num = start + i
          return serializeBlock({ ...item, _listNum: num } as any, depth)
        })
        .join('\n')
    }
    
    case 'listItem': {
      const prefix = (node as any)._listNum ? `${(node as any)._listNum}. ` : '- '
      const indent = '  '.repeat(depth)
      const content = (node.content || [])
        .map((child, i) => {
          if (i === 0) {
            return `${indent}${prefix}${serializeBlock(child, depth + 1).trim()}`
          }
          return `${indent}  ${serializeBlock(child, depth + 1).trim()}`
        })
        .join('\n')
      return content
    }
    
    case 'taskItem': {
      const checked = node.attrs?.checked ? 'x' : ' '
      const indent = '  '.repeat(depth)
      const content = serializeInline(node.content?.[0]?.content)
      return `${indent}- [${checked}] ${content}`
    }
    
    case 'blockquote':
      return (node.content || [])
        .map(child => 
          serializeBlock(child, depth)
            .split('\n')
            .map(line => `> ${line}`)
            .join('\n')
        )
        .join('\n')
    
    case 'codeBlock': {
      const lang = node.attrs?.language || ''
      const code = node.content?.[0]?.text || ''
      return `\`\`\`${lang}\n${code}\n\`\`\``
    }
    
    case 'horizontalRule':
      return '---'
    
    case 'table': {
      const rows = node.content || []
      if (rows.length === 0) return ''
      
      const lines: string[] = []
      
      rows.forEach((row, rowIndex) => {
        const cells = (row.content || []).map(cell => {
          const content = serializeInline(cell.content?.[0]?.content)
          return content || ' '
        })
        lines.push(`| ${cells.join(' | ')} |`)
        
        // Add separator after header row
        if (rowIndex === 0) {
          lines.push(`| ${cells.map(() => '---').join(' | ')} |`)
        }
      })
      
      return lines.join('\n')
    }
    
    default:
      // For unknown block types, try to serialize content
      if (node.content) {
        return (node.content || [])
          .map(child => serializeBlock(child, depth))
          .join('\n\n')
      }
      return ''
  }
}

/**
 * Convert TipTap JSON document to markdown string
 */
export function tiptapToMarkdown(doc: TipTapNode): string {
  if (!doc || doc.type !== 'doc') {
    return ''
  }
  
  return serializeBlock(doc)
    .replace(/\n{3,}/g, '\n\n') // Collapse multiple newlines
    .trim()
}

/**
 * Convert TipTap editor instance to markdown
 */
export function editorToMarkdown(editor: { getJSON: () => any }): string {
  const json = editor.getJSON()
  return tiptapToMarkdown(json)
}
