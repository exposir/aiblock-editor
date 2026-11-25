import { Extension } from '@tiptap/core'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Transform } from '@tiptap/pm/transform'
import type { OutlineEntry } from '../types'
import { blockNodeTypes } from './block-range'
import { changedNodes, createNodeIndex, textEdits } from './document-changes'

const blockIdKey = new PluginKey<ReadonlyMap<string, number>>('blockId')

function readId(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}

function newBlockId(): string {
  return crypto.randomUUID?.() ?? Array.from(
    crypto.getRandomValues(new Uint32Array(4)),
    word => word.toString(16).padStart(8, '0'),
  ).join('')
}

const headings = createNodeIndex(node => node.type.name === 'heading')

export function extractOutline(doc: ProseMirrorNode): OutlineEntry[] {
  return headings(doc).flatMap(({ node, pos }) => {
    const blockId = readId(node.attrs.blockId)
    const level: unknown = node.attrs.level
    return blockId && typeof level === 'number' ? [{ blockId, level, text: node.textContent, pos }] : []
  })
}

export function assignMissingBlockIds(doc: ProseMirrorNode): ProseMirrorNode {
  const used = new Set<string>()
  const missing: number[] = []
  doc.descendants((node, pos) => {
    if (!Object.hasOwn(node.attrs, 'blockId')) return true
    const id = readId(node.attrs.blockId)
    if (id) used.add(id)
    else missing.push(pos)
    return true
  })
  if (!missing.length) return doc
  const tr = new Transform(doc)
  for (const pos of missing) {
    let id = newBlockId()
    while (used.has(id)) id = newBlockId()
    used.add(id)
    tr.setNodeAttribute(pos, 'blockId', id)
  }
  return tr.doc
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
      state: {
        init(_, state) {
          const counts = new Map<string, number>()
          state.doc.descendants(node => {
            const id = readId(node.attrs.blockId)
            if (id) counts.set(id, (counts.get(id) ?? 0) + 1)
            return !node.isTextblock
          })
          return counts
        },
        apply(tr, previous) {
          if (!tr.docChanged || textEdits(tr)) return previous
          const delta = new Map<string, number>()
          const track = (node: ProseMirrorNode, direction: number) => {
            const id = readId(node.attrs.blockId)
            if (id) delta.set(id, (delta.get(id) ?? 0) + direction)
          }
          changedNodes(tr.before, tr.doc, node => track(node, 1), node => track(node, -1))
          if ([...delta.values()].every(count => count === 0)) return previous
          const counts = new Map(previous)
          for (const [id, difference] of delta) {
            const total = (counts.get(id) ?? 0) + difference
            if (total > 0) counts.set(id, total)
            else counts.delete(id)
          }
          return counts
        },
      },
      appendTransaction(transactions, old, state) {
        const initial = transactions.some(tr => tr.getMeta(blockIdKey))
        if (!initial && !transactions.some(tr => tr.docChanged && textEdits(tr) === null)) return null
        const counts = blockIdKey.getState(state)!
        const missing: number[] = []
        const duplicates = new Map<string, number[]>()
        function inspect(node: ProseMirrorNode, pos: number) {
          if (!Object.hasOwn(node.attrs, 'blockId')) return
          const id = readId(node.attrs.blockId)
          if (!id) missing.push(pos)
          else if ((counts.get(id) ?? 0) > 1) {
            const found = duplicates.get(id)
            if (found) found.push(pos)
            else duplicates.set(id, [pos])
          }
        }
        if (initial) state.doc.descendants((node, pos) => { inspect(node, pos); return !node.isTextblock })
        else changedNodes(old.doc, state.doc, inspect)
        const scattered = new Set([...duplicates].filter(([id, positions]) => positions.length < counts.get(id)!).map(([id]) => id))
        if (scattered.size) {
          for (const id of scattered) duplicates.set(id, [])
          state.doc.descendants((node, pos) => {
            const id = readId(node.attrs.blockId)
            if (id && scattered.has(id)) duplicates.get(id)!.push(pos)
            return !node.isTextblock
          })
        }
        for (const positions of duplicates.values()) missing.push(...positions.slice(1))
        if (!missing.length) return null
        const tr = state.tr
        const generated = new Set<string>()
        for (const pos of missing) {
          let id = newBlockId()
          while (counts.has(id) || generated.has(id)) id = newBlockId()
          generated.add(id)
          tr.setNodeAttribute(pos, 'blockId', id)
        }
        return tr
      },
    })]
  },
})
