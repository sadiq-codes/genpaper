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
import { FileText, Loader2 } from 'lucide-react'
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
  isLoading?: boolean
  query?: string
}

// =============================================================================
// MENTION LIST COMPONENT
// =============================================================================

export const MentionList = forwardRef<MentionListRef, MentionListProps>(
  ({ items, command, isLoading = false, query = '' }, ref) => {
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
            <Loader2 className="h-4 w-4 animate-spin" />
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
          <button
            key={item.id}
            type="button"
            className={cn(
              'mention-suggestion-item',
              index === selectedIndex && 'is-selected'
            )}
            onClick={() => selectItem(index)}
            onMouseEnter={() => setSelectedIndex(index)}
          >
            <div className="mention-suggestion-icon">
              <FileText className="h-4 w-4" />
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

    return {
      onStart: (props: SuggestionProps<MentionedPaper>) => {
        component = new ReactRenderer(MentionList, {
          props: {
            ...props,
            items: [],
            isLoading: true,
            query: '',
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
          })
        }).catch(() => {
          isSearching = false
          component?.updateProps({
            ...props,
            items: [],
            isLoading: false,
            query: props.query,
          })
        })
      },

      onUpdate: (props: SuggestionProps<MentionedPaper>) => {
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
          })

          options.onSearch(props.query).then(items => {
            isSearching = false
            component?.updateProps({
              ...props,
              items,
              isLoading: false,
              query: props.query,
            })
          }).catch(() => {
            isSearching = false
            component?.updateProps({
              ...props,
              items: [],
              isLoading: false,
              query: props.query,
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
