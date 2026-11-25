import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import type { EditorView } from '@tiptap/pm/view'

interface AnchorRegistry {
  readonly byId: Map<string, HTMLElement>
  readonly byNode: WeakMap<ProseMirrorNode, HTMLElement>
}

const registries = new WeakMap<EditorView, AnchorRegistry>()

function registry(view: EditorView): AnchorRegistry {
  let entry = registries.get(view)
  if (!entry) {
    entry = { byId: new Map(), byNode: new WeakMap() }
    registries.set(view, entry)
  }
  return entry
}

function blockId(node: ProseMirrorNode): string | null {
  const value: unknown = node.attrs.blockId
  return typeof value === 'string' && value ? value : null
}

export function registerCodeBlockAnchor(
  view: EditorView,
  node: ProseMirrorNode,
  element: HTMLElement,
): () => void {
  const anchors = registry(view)
  const id = blockId(node)
  if (id) anchors.byId.set(id, element)
  anchors.byNode.set(node, element)

  return () => {
    if (id && anchors.byId.get(id) === element) anchors.byId.delete(id)
    if (anchors.byNode.get(node) === element) anchors.byNode.delete(node)
  }
}

export function codeBlockAnchor(view: EditorView, node: ProseMirrorNode): HTMLElement | null {
  const anchors = registries.get(view)
  if (!anchors) return null
  const id = blockId(node)
  return (id ? anchors.byId.get(id) : undefined) ?? anchors.byNode.get(node) ?? null
}
