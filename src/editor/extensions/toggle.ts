import { Node, mergeAttributes } from '@tiptap/core'
import { TextSelection, Plugin } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { Node as ProseMirrorNode, ResolvedPos } from '@tiptap/pm/model'
import { ReactNodeViewRenderer } from '@tiptap/react'
import { createNodeIndex } from './document-changes'
import type { ToggleAttributes } from '../types'
import { ToggleView, toggleBodyId } from '../views/toggle-view'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    toggle: {
      insertToggle: (attributes?: Partial<ToggleAttributes>) => ReturnType
      setToggleOpen: (pos: number, open: boolean) => ReturnType
    }
  }
}

function closedToggleSummaryEnd($pos: ResolvedPos): number | null {
  for (let depth = 2; depth <= $pos.depth; depth++) {
    if ($pos.node(depth).type.name !== 'toggleContent') continue
    const toggle = $pos.node(depth - 1)
    if (toggle.attrs.open === false && toggle.firstChild) {
      return $pos.start(depth - 1) + toggle.firstChild.nodeSize - 1
    }
  }
  return null
}

export const Toggle = Node.create({
  name: 'toggle',
  group: 'block',
  content: 'toggleSummary toggleContent',
  defining: true,
  isolating: true,

  addAttributes() {
    return {
      open: {
        default: true,
        parseHTML: element => element.getAttribute('data-open') !== 'false',
        renderHTML: attrs => ({ 'data-open': String(attrs.open !== false) }),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-toggle]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-toggle': '' }), 0]
  },

  addCommands() {
    return {
      insertToggle: attributes => ({ commands }) => commands.insertContent({
        type: this.name,
        attrs: attributes,
        content: [
          { type: 'toggleSummary' },
          { type: 'toggleContent', content: [{ type: 'paragraph' }] },
        ],
      }),
      setToggleOpen: (pos, open) => ({ tr, dispatch }) => {
        if (!Number.isInteger(pos) || pos < 0 || pos >= tr.doc.content.size) return false
        const node = tr.doc.nodeAt(pos)
        if (node?.type !== this.type) return false
        if (dispatch && node.attrs.open !== open) tr.setNodeAttribute(pos, 'open', open)
        return true
      },
    }
  },

  addKeyboardShortcuts() {
    return {
      Enter: () => {
        const { selection, doc } = this.editor.state
        const { $from, $to } = selection
        if (this.editor.view.composing || $from.parent.type.name !== 'toggleSummary' || !$from.sameParent($to)) {
          return false
        }
        const pos = $from.before($from.depth - 1)
        const bodyStart = $from.after()
        const next = TextSelection.findFrom(doc.resolve(bodyStart), 1, true)
        return this.editor.chain().setToggleOpen(pos, true).setTextSelection(next?.from ?? $from.end()).run()
      },
    }
  },

  addProseMirrorPlugins() {
    const { instanceId } = this.editor
    const type = this.type
    const toggles = createNodeIndex(node => node.type === type && node.childCount === 2)
    let cachedDoc: ProseMirrorNode | undefined
    let cachedEditingBodies = ''
    let decorations = DecorationSet.empty

    return [new Plugin({
      props: {
        decorations({ doc, selection }) {
          const editingBodies = new Set<number>()
          const { $head } = selection
          for (let depth = 1; depth <= $head.depth; depth++) {
            if ($head.node(depth).type.name === 'toggleContent') editingBodies.add($head.before(depth))
          }
          const editingKey = [...editingBodies].join(',')
          if (doc === cachedDoc && editingKey === cachedEditingBodies) return decorations
          cachedDoc = doc
          cachedEditingBodies = editingKey
          const items: Decoration[] = []
          for (const { node, pos } of toggles(doc)) {
            const bodyAt = pos + 1 + node.child(0).nodeSize
            const attrs: Record<string, string> = {}
            const id = toggleBodyId(instanceId, node.attrs.blockId)
            if (id) attrs.id = id
            if (node.attrs.open === false) attrs.inert = ''
            // Scrolling or typing into the body needs its final layout immediately.
            else if (editingBodies.has(bodyAt)) attrs['data-toggle-editing'] = ''
            items.push(Decoration.node(bodyAt, bodyAt + node.child(1).nodeSize, attrs))
          }
          decorations = DecorationSet.create(doc, items)
          return decorations
        },
      },
      appendTransaction(_transactions, _oldState, state) {
        const { selection, doc } = state
        const head = closedToggleSummaryEnd(selection.$head)
        const anchor = closedToggleSummaryEnd(selection.$anchor)
        if (head === null && anchor === null) return null
        return state.tr.setSelection(TextSelection.between(
          doc.resolve(anchor ?? selection.anchor),
          doc.resolve(head ?? selection.head),
        ))
      },
    })]
  },

  addNodeView() {
    return ReactNodeViewRenderer(ToggleView, { attrs: ({ HTMLAttributes }) => HTMLAttributes })
  },
})

export const ToggleSummary = Node.create({
  name: 'toggleSummary',
  content: 'inline*',
  defining: true,

  parseHTML() {
    return [{ tag: 'div[data-toggle-summary]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-toggle-summary': '' }), 0]
  },
})

export const ToggleContent = Node.create({
  name: 'toggleContent',
  content: 'block+',

  parseHTML() {
    return [{
      tag: 'div[data-toggle-content]',
      contentElement: element => element.querySelector<HTMLElement>(':scope > .toggle-body-inner') ?? element,
    }]
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div', mergeAttributes(HTMLAttributes, { 'data-toggle-content': '' }),
      ['div', { class: 'toggle-body-inner' }, 0],
    ]
  },
})
