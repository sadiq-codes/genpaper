import type { JSONContent } from '@tiptap/core'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'

export type DocumentChangeType = 'added' | 'modified' | 'deleted'

export interface DocumentChangeRange {
  id: string
  type: DocumentChangeType
  from: number
  to: number
  presentation?: 'table'
  oldContent?: string
  newContent?: string
}

interface CurrentTopLevelNode {
  from: number
  to: number
  type: string
  signature: string
  textContent: string
}

function nodeTextFromJson(node: unknown): string {
  if (!node || typeof node !== 'object') return ''
  const nodeRecord = node as Record<string, unknown>

  let text = ''
  if (typeof nodeRecord.text === 'string') {
    text += nodeRecord.text
  }

  if (Array.isArray(nodeRecord.content)) {
    for (const child of nodeRecord.content) {
      text += nodeTextFromJson(child)
    }
  }

  return text
}

function normalizeTopLevelNodes(docJson: JSONContent): JSONContent[] {
  if (!docJson || typeof docJson !== 'object') return []
  if (!Array.isArray(docJson.content)) return []
  return docJson.content as JSONContent[]
}

function getTopLevelCurrentNodes(doc: ProseMirrorNode): CurrentTopLevelNode[] {
  const nodes: CurrentTopLevelNode[] = []
  doc.forEach((node, offset) => {
    nodes.push({
      from: offset,
      to: offset + node.nodeSize,
      type: node.type.name,
      signature: JSON.stringify(node.toJSON()),
      textContent: node.textContent || '',
    })
  })
  return nodes
}

export function docsAreEqualJSON(a: JSONContent, b: JSONContent): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

/**
 * Compute coarse document change ranges between an original JSON snapshot
 * and the current ProseMirror doc. This is intentionally node-level (top-level
 * blocks) for fast, stable visual highlighting.
 */
export function computeDocumentChangeRanges(
  originalDocJson: JSONContent,
  currentDoc: ProseMirrorNode
): DocumentChangeRange[] {
  const oldNodes = normalizeTopLevelNodes(originalDocJson)
  const currentNodes = getTopLevelCurrentNodes(currentDoc)

  const oldSignatures = oldNodes.map(node => JSON.stringify(node))
  const currentSignatures = currentNodes.map(node => node.signature)

  const ranges: DocumentChangeRange[] = []
  let i = 0
  let j = 0
  let idCounter = 0

  while (i < oldNodes.length || j < currentNodes.length) {
    const oldSig = i < oldNodes.length ? oldSignatures[i] : null
    const currentSig = j < currentNodes.length ? currentSignatures[j] : null

    // Unchanged block
    if (oldSig !== null && currentSig !== null && oldSig === currentSig) {
      i += 1
      j += 1
      continue
    }

    const oldNextMatchesCurrent =
      i + 1 < oldNodes.length &&
      j < currentNodes.length &&
      oldSignatures[i + 1] === currentSignatures[j]

    const currentNextMatchesOld =
      j + 1 < currentNodes.length &&
      i < oldNodes.length &&
      currentSignatures[j + 1] === oldSignatures[i]

    // Deleted block
    if (i < oldNodes.length && (j >= currentNodes.length || (oldNextMatchesCurrent && !currentNextMatchesOld))) {
      const insertPos = j < currentNodes.length ? currentNodes[j].from : currentDoc.content.size
      ranges.push({
        id: `change-${++idCounter}`,
        type: 'deleted',
        from: insertPos,
        to: insertPos,
        oldContent: nodeTextFromJson(oldNodes[i]).trim(),
      })
      i += 1
      continue
    }

    // Added block
    if (j < currentNodes.length && (i >= oldNodes.length || (currentNextMatchesOld && !oldNextMatchesCurrent))) {
      const currentNode = currentNodes[j]
      ranges.push({
        id: `change-${++idCounter}`,
        type: 'added',
        from: currentNode.from,
        to: currentNode.to,
        newContent: currentNode.textContent.trim(),
      })
      j += 1
      continue
    }

    // Modified block (fallback when we cannot classify as pure add/delete)
    if (i < oldNodes.length && j < currentNodes.length) {
      const currentNode = currentNodes[j]
      const oldNodeType = (oldNodes[i] as Record<string, unknown>).type
      const isTableChange = oldNodeType === 'table' || currentNode.type === 'table'
      ranges.push({
        id: `change-${++idCounter}`,
        type: 'modified',
        from: currentNode.from,
        to: currentNode.to,
        ...(isTableChange ? { presentation: 'table' as const } : {}),
        oldContent: nodeTextFromJson(oldNodes[i]).trim(),
        newContent: currentNode.textContent.trim(),
      })
      i += 1
      j += 1
      continue
    }
  }

  return ranges
}
