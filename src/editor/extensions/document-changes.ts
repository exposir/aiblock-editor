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

// Walk changed siblings, preserving each side's ownership of reused nodes.
export function changedNodes(previous: ProseMirrorNode, next: ProseMirrorNode,
  visit: (node: ProseMirrorNode, pos: number) => void,
  removed?: (node: ProseMirrorNode, pos: number) => void, start = 0, previousStart = 0): void {
  if (previous.content === next.content) return
  let first = 0
  let from = previousStart
  let to = start
  let oldEnd = previous.childCount
  let newEnd = next.childCount
  while (first < Math.min(oldEnd, newEnd) && previous.child(first) === next.child(first)) {
    const size = next.child(first++).nodeSize
    from += size
    to += size
  }
  while (oldEnd > first && newEnd > first && previous.child(oldEnd - 1) === next.child(newEnd - 1)) {
    oldEnd--
    newEnd--
  }
  function emit(node: ProseMirrorNode, pos: number, callback: typeof visit) {
    callback(node, pos)
    if (!node.isTextblock) node.descendants((child, at) => { callback(child, pos + 1 + at); return !child.isTextblock })
  }
  function matching(parent: ProseMirrorNode, at: number, end: number, node: ProseMirrorNode) {
    for (let index = at + 1; index < Math.min(end, at + 9); index++) if (parent.child(index) === node) return index - at
    return Infinity
  }
  for (let oldIndex = first, newIndex = first; oldIndex < oldEnd || newIndex < newEnd;) {
    const old = oldIndex < oldEnd ? previous.child(oldIndex) : null
    const current = newIndex < newEnd ? next.child(newIndex) : null
    const afterRemoval = old && current && old !== current ? matching(previous, oldIndex, oldEnd, current) : Infinity
    const afterAddition = old && current && old !== current ? matching(next, newIndex, newEnd, old) : Infinity
    if (old && (!current || afterRemoval < Infinity && afterRemoval <= afterAddition)) {
      if (removed) emit(old, from, removed)
      oldIndex++; from += old.nodeSize
    } else if (current && (!old || afterAddition < Infinity)) {
      emit(current, to, visit)
      newIndex++; to += current.nodeSize
    } else if (old && current) {
      if (old !== current) {
        if (old.type === current.type) {
          removed?.(old, from)
          visit(current, to)
          if (!current.isTextblock) changedNodes(old, current, visit, removed, to + 1, from + 1)
        } else {
          if (removed) emit(old, from, removed)
          emit(current, to, visit)
        }
      }
      oldIndex++; newIndex++
      from += old.nodeSize; to += current.nodeSize
    }
  }
}
