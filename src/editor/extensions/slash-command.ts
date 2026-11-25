import { chooseImages } from './image-block'
import { Extension } from '@tiptap/core'
import type { Editor, Range } from '@tiptap/core'
import { PluginKey } from '@tiptap/pm/state'
import { ReactRenderer } from '@tiptap/react'
import Suggestion from '@tiptap/suggestion'
import type { SuggestionMatch, SuggestionProps, Trigger } from '@tiptap/suggestion'
import { shift, size } from '@floating-ui/dom'
import { exampleFormula } from '../preview/math'
import { diagramTemplates } from '../preview/mermaid'
import { SlashMenu } from '../components/SlashMenu'
import type { SlashMenuProps } from '../components/SlashMenu'
import { searchSlashItems } from './slash-search'
import type { SlashItem } from './slash-search'

export const slashCommandKey = new PluginKey('slashCommand')

export function matchSlashCommand({ $position }: Trigger): SuggestionMatch {
  if (!$position.parent.isTextblock) return null
  const before = $position.parent.textBetween(0, $position.parentOffset, '\n', '\n')
  const match = /(?:^|\s)([/、][\p{L}\p{N}_ -]*)$/u.exec(before)
  const text = match?.[1]
  if (!text) return null
  return { range: { from: $position.pos - text.length, to: $position.pos }, query: text.slice(1), text }
}

export function openSlashMenu(editor: Editor, cursorPos: number): void {
  editor.chain().focus(cursorPos).insertContent('/').run()
}

function insertSlashBlock(editor: Editor, range: Range, item: SlashItem): void {
  const chain = editor.chain().focus().deleteRange(range)
  switch (item.id) {
    case 'paragraph': chain.setParagraph().run(); break
    case 'h1': chain.setHeading({ level: 1 }).run(); break
    case 'h2': chain.setHeading({ level: 2 }).run(); break
    case 'h3': chain.setHeading({ level: 3 }).run(); break
    case 'bulletList': (editor.isActive('bulletList') ? chain : chain.toggleBulletList()).run(); break
    case 'orderedList': (editor.isActive('orderedList') ? chain : chain.toggleOrderedList()).run(); break
    case 'taskList': (editor.isActive('taskList') ? chain : chain.toggleTaskList()).run(); break
    case 'blockquote': chain.setBlockquote().run(); break
    case 'horizontalRule': chain.setHorizontalRule().run(); break
    case 'callout': chain.insertCallout().run(); break
    case 'toggle': chain.insertToggle().run(); break
    case 'columns2': chain.insertColumns(2).run(); break
    case 'columns3': chain.insertColumns(3).run(); break
    case 'table': chain.insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(); break
    case 'mermaid':
    case 'math':
      chain.insertContent({
        type: 'codeBlock', attrs: { language: item.id },
        content: [{ type: 'text', text: item.id === 'mermaid' ? diagramTemplates[0].source : exampleFormula }],
      }).run()
      break
    case 'imageBlock': chooseImages(editor.view, range); break
    case 'codeBlock': chain.setCodeBlock().run(); break
  }
}

export const SlashCommand = Extension.create({
  name: 'slashCommand',
  priority: 120,

  addProseMirrorPlugins() {
    return [Suggestion<SlashItem, SlashItem>({
      editor: this.editor,
      pluginKey: slashCommandKey,
      findSuggestionMatch: matchSlashCommand,
      allow: ({ state }) => !state.selection.$from.parent.type.spec.code,
      items: ({ query }) => searchSlashItems(query),
      command: ({ editor, range, props }) => insertSlashBlock(editor, range, props),
      placement: 'bottom-start',
      floatingUi: {
        strategy: 'fixed',
        middleware: [
          shift({ padding: 8 }),
          size({ padding: 8, apply: ({ availableHeight, elements }) => {
            elements.floating.style.setProperty('--slash-height', `${Math.min(360, availableHeight)}px`)
          } }),
        ],
      },
      render: () => {
        let renderer: ReactRenderer<unknown, SlashMenuProps> | undefined
        let unmount: (() => void) | undefined
        let current: SuggestionProps<SlashItem, SlashItem> | undefined
        let activeIndex = 0

        function menuProps(props: SuggestionProps<SlashItem, SlashItem>): SlashMenuProps {
          return { items: props.items, activeIndex, choose: props.command }
        }

        return {
          onStart(props) {
            current = props
            activeIndex = 0
            renderer = new ReactRenderer(SlashMenu, { editor: props.editor, props: menuProps(props), className: 'slash-host' })
            unmount = props.mount(renderer.element)
          },
          onUpdate(props) {
            if (current?.query !== props.query) activeIndex = 0
            current = props
            renderer?.updateProps(menuProps(props))
          },
          onKeyDown({ event, view }) {
            if (!current || event.isComposing || view.composing || event.keyCode === 229) return false
            if (event.key === 'Enter') {
              const item = current.items[activeIndex]
              if (!item) return false
              current.command(item)
              return true
            }
            if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return false
            const { length } = current.items
            if (length) {
              const direction = event.key === 'ArrowDown' ? 1 : -1
              activeIndex = (activeIndex + direction + length) % length
              renderer?.updateProps(menuProps(current))
            }
            return true
          },
          onExit() {
            unmount?.()
            renderer?.destroy()
            current = undefined
            renderer = undefined
            unmount = undefined
          },
        }
      },
    })]
  },
})
