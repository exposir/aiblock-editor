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

const searchIndexes = new WeakMap<readonly MeasuredBlock[], {
  entries: { block: MeasuredBlock; order: number }[]
  maxBottom: number[]
}>()

export function hitBlock(blocks: readonly MeasuredBlock[], point: Point, rowGap = 0): MeasuredBlock | null {
  let index = searchIndexes.get(blocks)
  if (!index) {
    const entries = blocks.map((block, order) => ({ block, order }))
      .sort((a, b) => a.block.rect.top - b.block.rect.top)
    const maxBottom: number[] = []
    for (const [i, { block }] of entries.entries()) maxBottom.push(Math.max(maxBottom[i - 1] ?? -Infinity, block.rect.bottom))
    searchIndexes.set(blocks, index = { entries, maxBottom })
  }
  let low = 0
  let high = index.entries.length
  while (low < high) {
    const middle = (low + high) >>> 1
    if (index.entries[middle]!.block.rect.top <= point.y + rowGap) low = middle + 1
    else high = middle
  }
  let closest: MeasuredBlock | null = null
  let order = -1
  let distance = rowGap
  for (let i = low - 1; i >= 0 && index.maxBottom[i]! >= point.y - distance; i--) {
    const entry = index.entries[i]!
    const { rect } = entry.block
    if (point.x < rect.left || point.x > rect.right) continue
    const vertical = Math.max(0, rect.top - point.y, point.y - rect.bottom)
    if (vertical < distance || vertical === distance && entry.order > order) {
      closest = entry.block
      distance = vertical
      order = entry.order
    }
  }
  return closest
}

export function blockPositionAtElement(view: EditorView, element: HTMLElement): number | null {
  if (!view.dom.contains(element)) return null
  const position = view.posAtDOM(element, 0)
  if (position < 0 || position > view.state.doc.content.size) return null
  if (view.nodeDOM(position) === element) return position
  const $pos = view.state.doc.resolve(position)
  for (let depth = $pos.depth; depth > 0; depth--) {
    const pos = $pos.before(depth)
    if (view.nodeDOM(pos) === element) return pos
  }
  return null
}

export function blockAtPoint(view: EditorView, point: Point, gap = 0): MeasuredBlock | null {
  const root = view.dom
  const owner = root.ownerDocument
  if (!owner.elementFromPoint) return hitBlock(measureBlocks(view), point, gap)
  for (const delta of gap ? [0, -gap, gap] : [0]) {
    let element = owner.elementFromPoint(point.x, point.y + delta)
    while (element && element !== root && root.contains(element)) {
      if (element instanceof HTMLElement && (element.parentElement === root || element.parentElement?.matches('[data-column]'))) {
        const pos = blockPositionAtElement(view, element)
        const hit = pos === null ? null : measureBlock(view, pos)
        if (hit && hit.rect.top - gap <= point.y && hit.rect.bottom + gap >= point.y &&
            hit.rect.left <= point.x && hit.rect.right >= point.x) return hit
      }
      element = element.parentElement
    }
  }
  return null
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
