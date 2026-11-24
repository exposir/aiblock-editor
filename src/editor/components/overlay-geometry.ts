import type { Point, Rect } from '../extensions/block-drag-logic'

export interface OverlayRect extends Rect {
  readonly width: number
  readonly height: number
}

export interface RectLike {
  readonly left: number
  readonly top: number
  readonly width: number
  readonly height: number
}

export function overlayOrigin(element: Element): Point {
  const rect = element.getBoundingClientRect()
  return { x: rect.left, y: rect.top }
}

export function offsetRect(rect: Rect, origin: Point): Rect {
  return {
    left: rect.left - origin.x,
    right: rect.right - origin.x,
    top: rect.top - origin.y,
    bottom: rect.bottom - origin.y,
  }
}

export function toOverlayRect(rect: RectLike, origin: Point): OverlayRect {
  return {
    left: rect.left - origin.x,
    top: rect.top - origin.y,
    right: rect.left - origin.x + rect.width,
    bottom: rect.top - origin.y + rect.height,
    width: rect.width,
    height: rect.height,
  }
}
