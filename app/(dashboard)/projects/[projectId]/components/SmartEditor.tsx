'use client'

import React, { forwardRef, useImperativeHandle, useRef, useState, useEffect, useCallback, useMemo } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import CharacterCount from '@tiptap/extension-character-count'
import Placeholder from '@tiptap/extension-placeholder'
import { Button } from '@/components/ui/button'
import {
  Bold,
  Italic,
  Underline,
  Link,
  List,
  Quote,
  Undo,
  Redo,
  Type,
  Palette,
  Zap,
  X
} from 'lucide-react'
import { debounce } from 'lodash-es'

interface OptimizedSmartEditorProps {
  content: string
  onChange: (content: string, wordCount: number, charCount: number) => void
  onBlur?: () => void
  placeholder?: string
  className?: string
  projectId: string
  isLoading?: boolean
  disabled?: boolean
}

interface FloatingMenuPosition {
  x: number
  y: number
}

const SmartEditor = forwardRef<HTMLDivElement, OptimizedSmartEditorProps>(
  ({ 
    content, 
    onChange, 
    onBlur, 
    placeholder = "Start writing your research paper...", 
    className, 
    projectId,
    isLoading = false,
    disabled = false
  }, ref) => {
    
    const [selectedText, setSelectedText] = useState<string | null>(null)
    const [showCitationMenu, setShowCitationMenu] = useState(false)
    const [menuPosition, setMenuPosition] = useState<FloatingMenuPosition>({ x: 0, y: 0 })
    const editorRef = useRef<HTMLDivElement>(null)
    const lastContentRef = useRef<string>(content)
    const changeTimeoutRef = useRef<NodeJS.Timeout>()

    // Memoized editor configuration to prevent unnecessary re-initializations
    const editorConfig = useMemo(() => ({
      extensions: [
        StarterKit.configure({
          // Optimize by disabling unused features
          heading: { levels: [1, 2, 3] },
          blockquote: false, // Disable if not needed
          horizontalRule: false, // Disable if not needed
          codeBlock: false, // Disable if not needed
        }),
        CharacterCount.configure({
          limit: 50000, // Set reasonable limit
        }),
        Placeholder.configure({
          placeholder,
          showOnlyWhenEditable: true,
          showOnlyCurrent: true,
        }),
      ],
      editorProps: {
        attributes: {
          class: 'prose prose-sm sm:prose lg:prose-lg xl:prose-2xl mx-auto focus:outline-none min-h-[600px] p-4',
          spellcheck: 'true',
        },
        // Optimize selection handling
        handleTextInput: (view, from, to, text) => {
          // Clear selection menu on typing
          if (showCitationMenu) {
            setShowCitationMenu(false)
            setSelectedText(null)
          }
          return false
        },
      },
      immediatelyRender: false, // Improve initial render performance
      shouldRerenderOnTransaction: false, // Reduce unnecessary re-renders
    }), [placeholder, showCitationMenu])

    // Debounced onChange to prevent excessive updates
    const debouncedOnChange = useCallback(
      debounce((editor) => {
        const html = editor.getHTML()
        const words = editor.storage.characterCount.words()
        const chars = editor.storage.characterCount.characters()
        
        // Only call onChange if content actually changed
        if (html !== lastContentRef.current) {
          lastContentRef.current = html
          onChange(html, words, chars)
        }
      }, 250), // 250ms debounce
      [onChange]
    )

    // Optimized selection handler
    const handleSelectionUpdate = useCallback(
      debounce((editor) => {
        const { from, to } = editor.state.selection
        const text = editor.state.doc.textBetween(from, to, ' ')
        
        if (text && text.length > 15 && text.length < 500) { // Reasonable selection size
          setSelectedText(text)
          
          // Calculate position more efficiently
          const selection = window.getSelection()
          if (selection && selection.rangeCount > 0 && editorRef.current) {
            try {
              const range = selection.getRangeAt(0)
              const rect = range.getBoundingClientRect()
              const editorRect = editorRef.current.getBoundingClientRect()
              
              setMenuPosition({
                x: Math.min(rect.left - editorRect.left + rect.width / 2, editorRect.width - 200),
                y: Math.max(rect.top - editorRect.top - 50, 10)
              })
              setShowCitationMenu(true)
            } catch (error) {
              console.warn('Selection position calculation failed:', error)
            }
          }
        } else {
          setSelectedText(null)
          setShowCitationMenu(false)
        }
      }, 150), // 150ms debounce for selection
      []
    )

    const editor = useEditor({
      ...editorConfig,
      content,
      editable: !disabled && !isLoading,
      onUpdate: ({ editor }) => {
        debouncedOnChange(editor)
      },
      onBlur: () => {
        // Clear floating menu on blur
        setShowCitationMenu(false)
        setSelectedText(null)
        onBlur?.()
      },
      onSelectionUpdate: ({ editor }) => {
        handleSelectionUpdate(editor)
      },
    })

    // Optimized content synchronization
    useEffect(() => {
      if (!editor || disabled) return
      
      const currentContent = editor.getHTML()
      
      // Only update if content is different and not from user input
      if (currentContent !== content && content !== lastContentRef.current) {
        // Clear timeout to prevent race conditions
        if (changeTimeoutRef.current) {
          clearTimeout(changeTimeoutRef.current)
        }
        
        // Debounce content updates to prevent cursor jumping
        changeTimeoutRef.current = setTimeout(() => {
          editor.commands.setContent(content, false, { preserveWhitespace: 'full' })
          lastContentRef.current = content
        }, 100)
      }
    }, [editor, content, disabled])

    // Cleanup timeouts
    useEffect(() => {
      return () => {
        if (changeTimeoutRef.current) {
          clearTimeout(changeTimeoutRef.current)
        }
      }
    }, [])

    // Memoized toolbar to prevent unnecessary re-renders
    const toolbar = useMemo(() => (
      <div className="border-b border-gray-200 p-3 bg-white sticky top-0 z-10 shadow-sm">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1">
            <Button
              variant={editor?.isActive('bold') ? 'default' : 'ghost'}
              size="sm"
              onClick={() => editor?.chain().focus().toggleBold().run()}
              disabled={!editor?.can().chain().focus().toggleBold().run() || isLoading}
              className="h-8 w-8 p-0"
            >
              <Bold className="w-4 h-4" />
            </Button>
            
            <Button
              variant={editor?.isActive('italic') ? 'default' : 'ghost'}
              size="sm"
              onClick={() => editor?.chain().focus().toggleItalic().run()}
              disabled={!editor?.can().chain().focus().toggleItalic().run() || isLoading}
              className="h-8 w-8 p-0"
            >
              <Italic className="w-4 h-4" />
            </Button>

            <div className="w-px h-6 bg-gray-300 mx-2" />

            <Button
              variant={editor?.isActive('bulletList') ? 'default' : 'ghost'}
              size="sm"
              onClick={() => editor?.chain().focus().toggleBulletList().run()}
              disabled={isLoading}
              className="h-8 w-8 p-0"
            >
              <List className="w-4 h-4" />
            </Button>

            <Button
              variant={editor?.isActive('blockquote') ? 'default' : 'ghost'}
              size="sm"
              onClick={() => editor?.chain().focus().toggleBlockquote().run()}
              disabled={isLoading}
              className="h-8 w-8 p-0"
            >
              <Quote className="w-4 h-4" />
            </Button>

            <div className="w-px h-6 bg-gray-300 mx-2" />

            <Button
              variant="ghost"
              size="sm"
              onClick={() => editor?.chain().focus().undo().run()}
              disabled={!editor?.can().chain().focus().undo().run() || isLoading}
              className="h-8 w-8 p-0"
            >
              <Undo className="w-4 h-4" />
            </Button>

            <Button
              variant="ghost"
              size="sm"
              onClick={() => editor?.chain().focus().redo().run()}
              disabled={!editor?.can().chain().focus().redo().run() || isLoading}
              className="h-8 w-8 p-0"
            >
              <Redo className="w-4 h-4" />
            </Button>
          </div>

          {/* Word count and status */}
          <div className="flex items-center gap-4 text-sm text-gray-500">
            {editor && (
              <>
                <span>{editor.storage.characterCount.words()} words</span>
                <span>{editor.storage.characterCount.characters()} chars</span>
                {isLoading && (
                  <div className="flex items-center gap-2">
                    <div className="animate-spin rounded-full h-4 w-4 border-2 border-blue-500 border-t-transparent" />
                    <span>AI Writing...</span>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    ), [editor, isLoading])

    const handleClickOutside = useCallback((event: MouseEvent) => {
      const target = event.target as Element
      if (!target.closest('.citation-menu') && !target.closest('.ProseMirror')) {
        setShowCitationMenu(false)
        setSelectedText(null)
      }
    }, [])

    useEffect(() => {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }, [handleClickOutside])

    useImperativeHandle(ref, () => editorRef.current!, [])

    if (!editor) {
      return (
        <div className="min-h-[600px] p-8 text-gray-500 animate-pulse flex items-center justify-center">
          <div className="text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-2 border-blue-500 border-t-transparent mx-auto mb-2" />
            <p>Loading editor...</p>
          </div>
        </div>
      )
    }

    return (
      <div ref={editorRef} className={`relative ${className}`}>
        {toolbar}
        
        {/* Editor Content */}
        <div className="relative bg-white min-h-[600px]">
          <EditorContent 
            editor={editor} 
            className="h-full"
          />
          
          {/* Loading Overlay */}
          {isLoading && (
            <div className="absolute inset-0 bg-white/50 flex items-center justify-center pointer-events-none">
              <div className="bg-white rounded-lg shadow-lg p-4 flex items-center gap-3">
                <div className="animate-spin rounded-full h-5 w-5 border-2 border-blue-500 border-t-transparent" />
                <span className="text-sm font-medium text-gray-700">AI is writing...</span>
              </div>
            </div>
          )}

          {/* Citation Floating Menu */}
          {showCitationMenu && selectedText && (
            <div
              className="citation-menu absolute z-50 bg-white rounded-lg shadow-xl border p-3 max-w-xs"
              style={{
                left: menuPosition.x,
                top: menuPosition.y,
                transform: 'translateX(-50%)'
              }}
            >
              <div className="text-xs text-gray-600 mb-2">
                "{selectedText.substring(0, 50)}{selectedText.length > 50 ? '...' : ''}"
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" className="text-xs h-7">
                  <Zap className="w-3 h-3 mr-1" />
                  Find Sources
                </Button>
                <Button 
                  size="sm" 
                  variant="ghost" 
                  onClick={() => setShowCitationMenu(false)}
                  className="text-xs h-7 w-7 p-0"
                >
                  <X className="w-3 h-3" />
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    )
  }
)

SmartEditor.displayName = 'SmartEditor'

export default SmartEditor 