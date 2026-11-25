import { TextSelection, Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { Node as ProseMirrorNode, ResolvedPos } from '@tiptap/pm/model'
import { changedNodes, textEdits } from './document-changes'
import type { ToggleAttributes } from '../types'
import { ToggleView, toggleBodyId } from '../views/toggle-view'
import { ToggleSchema, ToggleSummarySchema, ToggleContentSchema } from '../schema/toggle'

export { ToggleSummarySchema as ToggleSummary, ToggleContentSchema as ToggleContent }

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

export const Toggle = ToggleSchema.extend({
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
    const key = new PluginKey<{ stable: DecorationSet; display: DecorationSet }>('toggleDecorations')

    function makeBody(node: ProseMirrorNode, pos: number) {
      if (node.type !== type || node.childCount !== 2) return null
      const at = pos + 1 + node.child(0).nodeSize
      const attrs: Record<string, string> = {}
      const id = toggleBodyId(instanceId, node.attrs.blockId)
      if (id) attrs.id = id
      if (node.attrs.open === false) attrs.inert = ''
      return Decoration.node(at, at + node.child(1).nodeSize, attrs)
    }

    function withEditing(stable: DecorationSet, { $head }: { $head: ResolvedPos }) {
      const items: Decoration[] = []
      for (let depth = 2; depth <= $head.depth; depth++) {
        const node = $head.node(depth)
        if (node.type.name !== 'toggleContent' || $head.node(depth - 1).attrs.open === false) continue
        const pos = $head.before(depth)
        items.push(Decoration.node(pos, pos + node.nodeSize, { 'data-toggle-editing': '' }))
      }
      return items.length ? stable.add($head.doc, items) : stable
    }

    return [new Plugin({
      key,
      state: {
        init(_, { doc, selection }) {
          const items: Decoration[] = []
          doc.descendants((node, pos) => {
            const decoration = makeBody(node, pos)
            if (decoration) items.push(decoration)
            return !node.isTextblock
          })
          const stable = DecorationSet.create(doc, items)
          return { stable, display: withEditing(stable, selection) }
        },
        apply(tr, previous, old) {
          if (!tr.docChanged && old.selection.eq(tr.selection)) return previous
          let stable = tr.docChanged ? previous.stable.map(tr.mapping, tr.doc) : previous.stable
          if (tr.docChanged && !textEdits(tr)) {
            const added: Decoration[] = []
            const removed: Decoration[] = []
            changedNodes(old.doc, tr.doc, (node, pos) => {
              const decoration = makeBody(node, pos)
              if (!decoration) return
              removed.push(...stable.find(decoration.from, decoration.to).filter(item => item.from === decoration.from))
              added.push(decoration)
            })
            stable = stable.remove(removed).add(tr.doc, added)
          }
          return { stable, display: withEditing(stable, tr.selection) }
        },
      },
      props: { decorations: state => key.getState(state)?.display },
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
    return ToggleView
  },
})
