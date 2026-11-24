import { Extension, InputRule } from '@tiptap/core'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { TextSelection } from '@tiptap/pm/state'

function nearestNode(doc: ProseMirrorNode, type: string, around: number): number | null {
  let nearest: number | null = null
  doc.descendants((node, pos) => {
    if (node.type.name !== type) return
    if (nearest === null || Math.abs(pos - around) < Math.abs(nearest - around)) nearest = pos
  })
  return nearest
}

export const MarkdownInputRules = Extension.create({
  name: 'markdownInputRules',
  priority: 130,

  addInputRules() {
    const { callout, toggle } = this.editor.schema.nodes
    if (!callout || !toggle) return []
    return [
      new InputRule({
        find: /^>>\s$/,
        handler: ({ state, range }) => {
          const paragraph = state.schema.nodes.paragraph!.create()
          const { tr } = state
          tr.delete(range.from, range.to).replaceSelectionWith(
            state.schema.nodes.toggle!.create({ open: true }, [
              state.schema.nodes.toggleSummary!.create(),
              state.schema.nodes.toggleContent!.create(null, paragraph),
            ]),
          )
          const nodePos = nearestNode(tr.doc, 'toggle', range.from)
          if (nodePos !== null) tr.setSelection(TextSelection.create(tr.doc, nodePos + 2))
        },
      }),
      new InputRule({
        find: /^\[!\s$/,
        handler: ({ state, range }) => {
          const { tr } = state
          tr.delete(range.from, range.to).replaceSelectionWith(
            state.schema.nodes.callout!.create({ theme: 'blue', icon: '💡' }, state.schema.nodes.paragraph!.create()),
          )
          const nodePos = nearestNode(tr.doc, 'callout', range.from)
          if (nodePos !== null) tr.setSelection(TextSelection.create(tr.doc, nodePos + 2))
        },
      }),
    ]
  },
})
