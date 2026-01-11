'use client'

import { Extension } from '@tiptap/core'
import { ReactRenderer } from '@tiptap/react'
import Suggestion, { SuggestionProps, SuggestionKeyDownProps } from '@tiptap/suggestion'
import tippy, { Instance as TippyInstance } from 'tippy.js'
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useState,
  useCallback,
} from 'react'
import {
  Heading1,
  Heading2,
  Heading3,
  Type,
  List,
  ListOrdered,
  CheckSquare,
  Quote,
  Code,
  Minus,
  Table,
  ImageIcon,
  Sigma,
  AtSign,
} from 'lucide-react'
import { cn } from '@/lib/utils'

export interface CommandItem {
  title: string
  description: string
  icon: React.ReactNode
  command: (props: { editor: SuggestionProps['editor']; range: SuggestionProps['range'] }) => void
}

const commands: CommandItem[] = [
  {
    title: 'Heading 1',
    description: 'Large section heading',
    icon: <Heading1 className="h-4 w-4" />,
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).setNode('heading', { level: 1 }).run()
    },
  },
  {
    title: 'Heading 2',
    description: 'Medium section heading',
    icon: <Heading2 className="h-4 w-4" />,
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).setNode('heading', { level: 2 }).run()
    },
  },
  {
    title: 'Heading 3',
    description: 'Small section heading',
    icon: <Heading3 className="h-4 w-4" />,
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).setNode('heading', { level: 3 }).run()
    },
  },
  {
    title: 'Paragraph',
    description: 'Plain text paragraph',
    icon: <Type className="h-4 w-4" />,
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).setNode('paragraph').run()
    },
  },
  {
    title: 'Bullet List',
    description: 'Create a bullet list',
    icon: <List className="h-4 w-4" />,
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).toggleBulletList().run()
    },
  },
  {
    title: 'Numbered List',
    description: 'Create a numbered list',
    icon: <ListOrdered className="h-4 w-4" />,
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).toggleOrderedList().run()
    },
  },
  {
    title: 'Task List',
    description: 'Create a task list with checkboxes',
    icon: <CheckSquare className="h-4 w-4" />,
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).toggleTaskList().run()
    },
  },
  {
    title: 'Quote',
    description: 'Insert a blockquote',
    icon: <Quote className="h-4 w-4" />,
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).toggleBlockquote().run()
    },
  },
  {
    title: 'Code Block',
    description: 'Insert a code block',
    icon: <Code className="h-4 w-4" />,
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).toggleCodeBlock().run()
    },
  },
  {
    title: 'Divider',
    description: 'Insert a horizontal divider',
    icon: <Minus className="h-4 w-4" />,
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).setHorizontalRule().run()
    },
  },
  {
    title: 'Table',
    description: 'Insert a table',
    icon: <Table className="h-4 w-4" />,
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()
    },
  },
  {
    title: 'Image',
    description: 'Insert an image from URL',
    icon: <ImageIcon className="h-4 w-4" />,
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).run()
      const url = window.prompt('Enter image URL')
      if (url) {
        editor.chain().focus().setImage({ src: url }).run()
      }
    },
  },
  {
    title: 'Math Formula',
    description: 'Insert a LaTeX math formula',
    icon: <Sigma className="h-4 w-4" />,
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).run()
      const latex = window.prompt('Enter LaTeX formula (e.g., E = mc^2)')
      if (latex) {
        editor.chain().focus().insertMath(latex, false).run()
      }
    },
  },
  {
    title: 'Citation',
    description: 'Insert a citation from your library',
    icon: <AtSign className="h-4 w-4" />,
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).run()
      // Trigger citation picker - dispatch a custom event
      window.dispatchEvent(new CustomEvent('openCitationPicker'))
    },
  },
]

interface CommandListRef {
  onKeyDown: (props: SuggestionKeyDownProps) => boolean
}

interface CommandListProps {
  items: CommandItem[]
  command: (item: CommandItem) => void
}

const CommandList = forwardRef<CommandListRef, CommandListProps>(
  ({ items, command }, ref) => {
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
          setSelectedIndex((selectedIndex + items.length - 1) % items.length)
          return true
        }

        if (event.key === 'ArrowDown') {
          setSelectedIndex((selectedIndex + 1) % items.length)
          return true
        }

        if (event.key === 'Enter') {
          selectItem(selectedIndex)
          return true
        }

        return false
      },
    }))

    useEffect(() => {
      setSelectedIndex(0)
    }, [items])

    if (items.length === 0) {
      return (
        <div className="slash-command-menu">
          <div className="px-3 py-2 text-sm text-muted-foreground">
            No results found
          </div>
        </div>
      )
    }

    return (
      <div className="slash-command-menu">
        {items.map((item, index) => (
          <button
            key={item.title}
            className={cn(
              'slash-command-item',
              index === selectedIndex && 'is-selected'
            )}
            onClick={() => selectItem(index)}
            onMouseEnter={() => setSelectedIndex(index)}
          >
            <div className="slash-command-icon">{item.icon}</div>
            <div className="slash-command-content">
              <div className="slash-command-title">{item.title}</div>
              <div className="slash-command-description">{item.description}</div>
            </div>
          </button>
        ))}
      </div>
    )
  }
)

CommandList.displayName = 'CommandList'

export const SlashCommands = Extension.create({
  name: 'slashCommands',

  addOptions() {
    return {
      suggestion: {
        char: '/',
        command: ({ editor, range, props }: { editor: SuggestionProps['editor']; range: SuggestionProps['range']; props: CommandItem }) => {
          props.command({ editor, range })
        },
      },
    }
  },

  addProseMirrorPlugins() {
    return [
      Suggestion({
        editor: this.editor,
        ...this.options.suggestion,
        items: ({ query }: { query: string }) => {
          return commands.filter((item) =>
            item.title.toLowerCase().includes(query.toLowerCase())
          )
        },
        render: () => {
          let component: ReactRenderer<CommandListRef> | null = null
          let popup: TippyInstance[] | null = null

          return {
            onStart: (props: SuggestionProps) => {
              component = new ReactRenderer(CommandList, {
                props,
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
              })
            },

            onUpdate(props: SuggestionProps) {
              component?.updateProps(props)

              if (!props.clientRect) {
                return
              }

              popup?.[0]?.setProps({
                getReferenceClientRect: props.clientRect as () => DOMRect,
              })
            },

            onKeyDown(props: SuggestionKeyDownProps) {
              if (props.event.key === 'Escape') {
                popup?.[0]?.hide()
                return true
              }

              return component?.ref?.onKeyDown(props) ?? false
            },

            onExit() {
              popup?.[0]?.destroy()
              component?.destroy()
            },
          }
        },
      }),
    ]
  },
})
