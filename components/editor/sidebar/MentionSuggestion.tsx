'use client'

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useState,
  useCallback,
} from 'react'
import { SuggestionProps, SuggestionKeyDownProps } from '@tiptap/suggestion'
import { ReactRenderer } from '@tiptap/react'
import tippy, { Instance as TippyInstance } from 'tippy.js'
import { FileText, Loader2, Quote } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { MentionedPaper } from './PaperMention'

// =============================================================================
// TYPES
// =============================================================================

export interface MentionListRef {
  onKeyDown: (props: SuggestionKeyDownProps) => boolean
}

export interface MentionListProps {
  items: MentionedPaper[]
  command: (item: MentionedPaper) => void
  onCite?: (item: MentionedPaper) => void
  isLoading?: boolean
  query?: string
}

// =============================================================================
// MENTION LIST COMPONENT
// =============================================================================

export const MentionList = forwardRef<MentionListRef, MentionListProps>(
  ({ items, command, onCite, isLoading = false, query = '' }, ref) => {
    const [selectedIndex, setSelectedIndex] = useState(0)

    const selectItem = useCallback(
      (index: number) => {
        const item = items[index]
        if (item) {
          command(item)
        }
      },
      [items, command]
    )

    useImperativeHandle(ref, () => ({
      onKeyDown: ({ event }: SuggestionKeyDownProps) => {
        if (event.key === 'ArrowUp') {
          event.preventDefault()
          setSelectedIndex((selectedIndex + items.length - 1) % items.length)
          return true
        }

        if (event.key === 'ArrowDown') {
          event.preventDefault()
          setSelectedIndex((selectedIndex + 1) % items.length)
          return true
        }

        if (event.key === 'Enter') {
          event.preventDefault()
          if (items.length > 0) {
            selectItem(selectedIndex)
          }
          return true
        }

        if (event.key === 'Tab') {
          event.preventDefault()
          if (items.length > 0) {
            selectItem(selectedIndex)
          }
          return true
        }

        return false
      },
    }))

    useEffect(() => {
      setSelectedIndex(0)
    }, [items])

    // Loading state
    if (isLoading) {
      return (
        <div className="mention-suggestion-menu">
          <div className="mention-suggestion-loading">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            <span>Searching papers...</span>
          </div>
        </div>
      )
    }

    // Empty state
    if (items.length === 0) {
      return (
        <div className="mention-suggestion-menu">
          <div className="mention-suggestion-empty">
            {query.length > 0 
              ? `No papers found for "${query}"`
              : 'Type to search your project papers'
            }
          </div>
        </div>
      )
    }

    return (
      <div className="mention-suggestion-menu">
        <div className="mention-suggestion-header">
          Project Papers
        </div>
        {items.map((item, index) => (
          <div
            key={item.id}
            className={cn(
              'mention-suggestion-item',
              index === selectedIndex && 'is-selected'
            )}
            onMouseEnter={() => setSelectedIndex(index)}
          >
            <button
              type="button"
              className="mention-suggestion-main"
              onClick={() => selectItem(index)}
            >
              <div className="mention-suggestion-icon">
                <FileText className="h-3.5 w-3.5" />
              </div>
              <div className="mention-suggestion-content">
                <div className="mention-suggestion-title">
                  {item.title}
                </div>
                <div className="mention-suggestion-meta">
                  {item.authors.length > 0 && (
                    <span className="mention-suggestion-authors">
                      {item.authors.length === 1 
                        ? item.authors[0]
                        : `${item.authors[0]} et al.`
                      }
                    </span>
                  )}
                  {item.year && (
                    <span className="mention-suggestion-year">
                      {item.year}
                    </span>
                  )}
                </div>
              </div>
            </button>
            {onCite && (
              <button
                type="button"
                className="mention-suggestion-cite"
                onClick={(e) => {
                  e.stopPropagation()
                  onCite(item)
                }}
                title="Insert citation into document"
              >
                <Quote className="h-3 w-3" />
                <span>Cite</span>
              </button>
            )}
          </div>
        ))}
      </div>
    )
  }
)

MentionList.displayName = 'MentionList'

// =============================================================================
// SUGGESTION RENDER HELPER
// =============================================================================

export interface CreateMentionSuggestionOptions {
  onSearch: (query: string) => Promise<MentionedPaper[]>
  onCite?: (paper: MentionedPaper) => void
}

/**
 * Creates the render configuration for the TipTap Suggestion plugin
 */
export function createMentionSuggestionRender(options: CreateMentionSuggestionOptions) {
  return () => {
    let component: ReactRenderer<MentionListRef> | null = null
    let popup: TippyInstance[] | null = null
    let currentQuery = ''
    let isSearching = false
    let latestProps: SuggestionProps<MentionedPaper> | null = null

    // Wrap onCite to also close popup and remove @query text
    const handleCite = options.onCite
      ? (paper: MentionedPaper) => {
          options.onCite!(paper)
          // Remove the @query text from the chat input
          if (latestProps) {
            latestProps.editor.chain().focus().deleteRange(latestProps.range).run()
          }
          // Close popup
          popup?.[0]?.hide()
        }
      : undefined

    return {
      onStart: (props: SuggestionProps<MentionedPaper>) => {
        latestProps = props
        component = new ReactRenderer(MentionList, {
          props: {
            ...props,
            items: [],
            isLoading: true,
            query: '',
            onCite: handleCite,
          },
          editor: props.editor,
        })

        if (!props.clientRect) {
          return
        }

        popup = tippy('body', {
          getReferenceClientRect: props.clientRect as () => DOMRect,
          appendTo: () => document.body,
          content: component.element,
          showOnCreate: true,
          interactive: true,
          trigger: 'manual',
          placement: 'bottom-start',
          maxWidth: 400,
        })

        // Initial search with empty query
        currentQuery = props.query
        isSearching = true
        options.onSearch(props.query).then(items => {
          isSearching = false
          component?.updateProps({
            ...props,
            items,
            isLoading: false,
            query: props.query,
            onCite: handleCite,
          })
        }).catch(() => {
          isSearching = false
          component?.updateProps({
            ...props,
            items: [],
            isLoading: false,
            query: props.query,
            onCite: handleCite,
          })
        })
      },

      onUpdate: (props: SuggestionProps<MentionedPaper>) => {
        latestProps = props

        if (!props.clientRect) {
          return
        }

        popup?.[0]?.setProps({
          getReferenceClientRect: props.clientRect as () => DOMRect,
        })

        // Only search if query changed
        if (currentQuery !== props.query && !isSearching) {
          currentQuery = props.query
          isSearching = true
          
          component?.updateProps({
            ...props,
            isLoading: true,
            query: props.query,
            onCite: handleCite,
          })

          options.onSearch(props.query).then(items => {
            isSearching = false
            component?.updateProps({
              ...props,
              items,
              isLoading: false,
              query: props.query,
              onCite: handleCite,
            })
          }).catch(() => {
            isSearching = false
            component?.updateProps({
              ...props,
              items: [],
              isLoading: false,
              query: props.query,
              onCite: handleCite,
            })
          })
        }
      },

      onKeyDown: (props: SuggestionKeyDownProps) => {
        if (props.event.key === 'Escape') {
          popup?.[0]?.hide()
          return true
        }

        return component?.ref?.onKeyDown(props) ?? false
      },

      onExit: () => {
        popup?.[0]?.destroy()
        component?.destroy()
      },
    }
  }
}
