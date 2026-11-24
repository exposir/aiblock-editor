import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import type { EditorView } from '@tiptap/pm/view'
import type { Point, Rect } from '../extensions/block-drag-logic'
import { blockAt, isBlock } from '../extensions/block-range'

export interface MeasuredBlock {
  readonly pos: number
  readonly id: string | null
  readonly parentStart: number
  readonly element: HTMLElement
  readonly rect: Rect
}

export function measureBlock(view: EditorView, pos: number): MeasuredBlock | null {
  const block = blockAt(view.state.doc, pos)
  if (!block) return null
  const element = view.nodeDOM(pos)
  if (!(element instanceof HTMLElement) || element.closest('[inert]')) return null
  const rect = element.getBoundingClientRect()
  if (!rect.width || !rect.height) return null
  const id: unknown = block.node.attrs.blockId
  return { pos, id: typeof id === 'string' ? id : null, rect, element, parentStart: block.$pos.start() }
}

export function measureBlocks(view: EditorView): MeasuredBlock[] {
  const blocks: MeasuredBlock[] = []
  view.state.doc.descendants((node, pos, parent) => {
    if (isBlock(node) && (parent === view.state.doc || parent?.type.name === 'column')) {
      const block = measureBlock(view, pos)
      if (block) blocks.push(block)
    }
  })
  return blocks
}

export function positionOfBlockId(doc: ProseMirrorNode, id: string): number | null {
  let found: number | null = null
  doc.descendants((node, pos) => {
    if (found !== null) return false
    if (node.attrs.blockId === id) {
      found = pos
      return false
    }
  })
  return found
}

const hiddenTextSelector = '[inert], [contenteditable="false"], [aria-hidden="true"]'
const textblockSelector = 'p, h1, h2, h3, h4, h5, h6, pre, [data-toggle-summary]'

export function firstLineCenter(element: HTMLElement): number {
  const doc = element.ownerDocument
  const walker = doc.createTreeWalker(element, NodeFilter.SHOW_TEXT)
  const range = doc.createRange()
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.nodeValue ?? ''
    const offset = text.search(/\S/)
    if (offset < 0 || node.parentElement?.closest(hiddenTextSelector)) continue
    range.setStart(node, offset)
    range.setEnd(node, offset + 1)
    const rect = range.getBoundingClientRect()
    if (rect.height <= 0) continue

    const glyphCenter = rect.top + rect.height / 2
    const textblock = node.parentElement?.closest<HTMLElement>(textblockSelector)
    const style = textblock && doc.defaultView?.getComputedStyle(textblock)
    const lineHeight = style ? Number.parseFloat(style.lineHeight) : Number.NaN
    if (!textblock || !style || !Number.isFinite(lineHeight) || lineHeight <= 0) return glyphCenter
    // Split the difference between the glyph box and the line box: browsers place
    // the inline box asymmetrically for some font sizes, so either alone can be ~1px off.
    const top = textblock.getBoundingClientRect().top +
      (Number.parseFloat(style.borderTopWidth) || 0) + (Number.parseFloat(style.paddingTop) || 0)
    return (glyphCenter + top + lineHeight / 2) / 2
  }

  const textblocks = element.matches(textblockSelector)
    ? [element, ...element.querySelectorAll<HTMLElement>(textblockSelector)]
    : [...element.querySelectorAll<HTMLElement>(textblockSelector)]
  for (const textblock of textblocks) {
    if (textblock.closest(hiddenTextSelector)) continue
    const rect = textblock.getBoundingClientRect()
    if (rect.height > 0) return rect.top + rect.height / 2
  }
  const rect = element.getBoundingClientRect()
  return rect.top + rect.height / 2
}

export function hitBlock(blocks: readonly MeasuredBlock[], point: Point, rowGap = 0): MeasuredBlock | null {
  let closest: MeasuredBlock | null = null
  let distance = rowGap
  for (const block of blocks) {
    const { rect } = block
    if (point.x < rect.left || point.x > rect.right) continue
    const vertical = Math.max(0, rect.top - point.y, point.y - rect.bottom)
    if (vertical <= distance) {
      closest = block
      distance = vertical
    }
  }
  return closest
}

export function marqueeRect(from: Point, to: Point): Rect {
  return {
    left: Math.min(from.x, to.x),
    top: Math.min(from.y, to.y),
    right: Math.max(from.x, to.x),
    bottom: Math.max(from.y, to.y),
  }
}

export function marqueeEndpoints(blocks: readonly MeasuredBlock[], rect: Rect, parentStart: number, backwards: boolean) {
  const hits = blocks.filter(block => block.parentStart === parentStart &&
    block.rect.right >= rect.left && block.rect.left <= rect.right &&
    block.rect.bottom >= rect.top && block.rect.top <= rect.bottom)
  const first = hits[0]?.pos
  const last = hits.at(-1)?.pos
  if (first === undefined || last === undefined) return null
  return backwards ? { anchor: last, head: first } : { anchor: first, head: last }
}
