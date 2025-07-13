'use client'

import { BubbleMenu, Editor } from '@tiptap/react'
import { Button } from '@/components/ui/button'
import { Quote, Bold, Italic, Underline } from 'lucide-react'
import { useState, useCallback } from 'react'
import CitationSearchPopover from './CitationSearchPopover'

interface CitationBubbleMenuProps {
  editor: Editor
}

export default function CitationBubbleMenu({ editor }: CitationBubbleMenuProps) {
  const [showCitationSearch, setShowCitationSearch] = useState(false)
  const [menuPosition, setMenuPosition] = useState({ x: 0, y: 0 })

  const shouldShow = useCallback(() => {
    if (!editor) return false
    
    const { selection } = editor.state
    const { from, to } = selection
    
    // Show when there's text selected (not just cursor position)
    return from !== to
  }, [editor])

  const handleCiteClick = useCallback(() => {
    if (!editor) return
    
    // Get selection position for popover placement
    const { selection } = editor.state
    const { from } = selection
    const coords = editor.view.coordsAtPos(from)
    
    setMenuPosition({ x: coords.left, y: coords.bottom })
    setShowCitationSearch(true)
  }, [editor])

  const handleCitationSelect = useCallback((paperId: string, displayText: string) => {
    if (!editor) return
    
    // Insert citation at current selection
    const { selection } = editor.state
    const { from, to } = selection
    
    // If text is selected, we'll insert citation after it
    if (from !== to) {
      editor.chain()
        .focus()
        .setTextSelection(to) // Move cursor to end of selection
        .insertContent(' ') // Add space
        .insertCitation(paperId, displayText)
        .run()
    } else {
      // No selection, just insert at cursor
      editor.chain()
        .focus()
        .insertCitation(paperId, displayText)
        .run()
    }
    
    setShowCitationSearch(false)
  }, [editor])

  if (!editor) return null

  return (
    <>
      <BubbleMenu
        editor={editor}
        shouldShow={shouldShow}
        tippyOptions={{
          duration: 100,
          placement: 'top',
          arrow: false,
        }}
        className="flex items-center gap-1 p-1 bg-white border border-gray-200 rounded-lg shadow-lg"
      >
        {/* Text Formatting */}
        <Button
          variant="ghost"
          size="sm"
          onClick={() => editor.chain().focus().toggleBold().run()}
          className={`h-8 w-8 p-0 ${editor.isActive('bold') ? 'bg-gray-100' : ''}`}
        >
          <Bold className="h-4 w-4" />
        </Button>
        
        <Button
          variant="ghost"
          size="sm"
          onClick={() => editor.chain().focus().toggleItalic().run()}
          className={`h-8 w-8 p-0 ${editor.isActive('italic') ? 'bg-gray-100' : ''}`}
        >
          <Italic className="h-4 w-4" />
        </Button>

        <Button
          variant="ghost"
          size="sm"
          onClick={() => editor.chain().focus().toggleUnderline().run()}
          className={`h-8 w-8 p-0 ${editor.isActive('underline') ? 'bg-gray-100' : ''}`}
        >
          <Underline className="h-4 w-4" />
        </Button>

        <div className="w-px h-6 bg-gray-200 mx-1" />

        {/* Citation Button */}
        <Button
          variant="ghost"
          size="sm"
          onClick={handleCiteClick}
          className="h-8 px-3 gap-1.5 text-blue-600 hover:text-blue-700 hover:bg-blue-50"
        >
          <Quote className="h-4 w-4" />
          <span className="text-xs font-medium">Cite</span>
        </Button>
      </BubbleMenu>

      {/* Citation Search Popover */}
      {showCitationSearch && (
        <CitationSearchPopover
          position={menuPosition}
          onSelect={handleCitationSelect}
          onClose={() => setShowCitationSearch(false)}
        />
      )}
    </>
  )
} 