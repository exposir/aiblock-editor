import { Extension } from '@tiptap/core'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import type { OutlineEntry } from '../types'
import { blockNodeTypes } from './block-range'

const blockIdKey = new PluginKey('blockId')

function readId(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}

function newBlockId(): string {
  return crypto.randomUUID?.() ?? Array.from(
    crypto.getRandomValues(new Uint32Array(4)),
    word => word.toString(16).padStart(8, '0'),
  ).join('')
}

export function extractOutline(doc: ProseMirrorNode): OutlineEntry[] {
  const outline: OutlineEntry[] = []
  doc.descendants((node, pos) => {
    const blockId = readId(node.attrs.blockId)
    const level: unknown = node.attrs.level
    if (node.type.name === 'heading' && blockId && typeof level === 'number') {
      outline.push({ blockId, level, text: node.textContent, pos })
    }
  })
  return outline
}

export const BlockIdExtension = Extension.create({
  name: 'blockId',
  // Assign IDs after document structure has been repaired.
  priority: 90,

  addGlobalAttributes() {
    return [{
      types: blockNodeTypes(this.extensions),
      attributes: {
        blockId: {
          default: null,
          parseHTML: element => readId(element.getAttribute('data-block-id')),
          renderHTML: attrs => {
            const id = readId(attrs.blockId)
            return id ? { 'data-block-id': id } : {}
          },
        },
      },
    }]
  },

  onBeforeCreate() {
    this.editor.on('mount', ({ editor }) => {
      editor.view.dispatch(editor.state.tr.setMeta(blockIdKey, true).setMeta('addToHistory', false))
    })
  },

  addProseMirrorPlugins() {
    return [new Plugin({
      key: blockIdKey,
      appendTransaction(transactions, _oldState, state) {
        if (!transactions.some(tr => tr.docChanged || tr.getMeta(blockIdKey))) return null

        const reserved = new Set<string>()
        const missing: number[] = []
        state.doc.descendants((node, pos) => {
          if (!Object.hasOwn(node.attrs, 'blockId')) return
          const id = readId(node.attrs.blockId)
          if (id && !reserved.has(id)) reserved.add(id)
          else missing.push(pos)
        })

        if (!missing.length) return null
        const tr = state.tr
        for (const pos of missing) {
          let id = newBlockId()
          while (reserved.has(id)) id = newBlockId()
          reserved.add(id)
          tr.setNodeAttribute(pos, 'blockId', id)
        }
        return tr
      },
    })]
  },
})
