import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import type { Transaction } from '@tiptap/pm/state'
import { ReplaceStep } from '@tiptap/pm/transform'

export interface LocatedNode {
  readonly node: ProseMirrorNode
  readonly pos: number
}

// Positions in a cached subtree are relative, so the subtree can move without a rescan.
export function createNodeIndex(matches: (node: ProseMirrorNode) => boolean) {
  const cache = new WeakMap<ProseMirrorNode, readonly LocatedNode[]>()
  function index(root: ProseMirrorNode): readonly LocatedNode[] {
    const prior = cache.get(root)
    if (prior) return prior
    const entries: LocatedNode[] = []
    root.forEach((node, pos) => {
      if (matches(node)) entries.push({ node, pos })
      if (!node.isLeaf && !node.isTextblock) {
        for (const child of index(node)) entries.push({ node: child.node, pos: child.pos + pos + 1 })
      }
    })
    cache.set(root, entries)
    return entries
  }
  return index
}

export function textEdits(tr: Transaction): LocatedNode[] | null {
  const blocks = new Map<number, ProseMirrorNode>()
  for (const [i, step] of tr.steps.entries()) {
    if (!(step instanceof ReplaceStep) || step.slice.openStart || step.slice.openEnd) return null
    for (let child = 0; child < step.slice.content.childCount; child++) {
      if (!step.slice.content.child(child).isText) return null
    }
    const doc = tr.docs[i]!
    const from = doc.resolve(step.from)
    if (!from.parent.isTextblock || !from.sameParent(doc.resolve(step.to))) return null
    const pos = tr.mapping.slice(i).map(from.before(), -1)
    const node = tr.doc.nodeAt(pos)
    if (!node?.isTextblock) return null
    blocks.set(pos, node)
  }
  return Array.from(blocks, ([pos, node]) => ({ node, pos }))
}
