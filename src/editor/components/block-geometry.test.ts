import { describe, expect, it } from 'vitest'
import { hitBlock, marqueeEndpoints, marqueeRect } from './block-geometry'
import type { MeasuredBlock } from './block-geometry'

const rect = (left: number, top: number, right: number, bottom: number) => ({ left, top, right, bottom })

function block(pos: number, parentStart: number, bounds: MeasuredBlock['rect']): MeasuredBlock {
  return { pos, parentStart, rect: bounds, element: document.createElement('p'), id: null }
}

describe('block pointer geometry', () => {
  // @partition target: prefers the column block under the pointer and accepts a short vertical gap
  // @partition marquee: intersects visible rectangles within one scope and preserves direction
  const blocks = [
    block(0, 0, rect(100, 0, 600, 46)),
    block(8, 0, rect(100, 52, 600, 200)),
    block(10, 10, rect(100, 62, 350, 84)),
    block(15, 10, rect(100, 90, 350, 114)),
    block(23, 23, rect(360, 62, 600, 114)),
  ]

  it('target: favors a nested match and limits gap tolerance to the requested pixels', () => {
    expect(hitBlock(blocks, { x: 120, y: 80 })?.pos).toBe(10)
    expect(hitBlock(blocks, { x: 120, y: 50 }, 3)?.pos).toBe(8)
    expect(hitBlock(blocks, { x: 80, y: 50 }, 6)).toBeNull()
  })

  it('marquee: keeps reverse endpoints in the same parent while excluding other columns', () => {
    const area = marqueeRect({ x: 700, y: 120 }, { x: 80, y: 61 })
    expect(marqueeEndpoints(blocks, area, 10, true)).toEqual({ anchor: 15, head: 10 })
    expect(marqueeEndpoints(blocks, area, 0, false)).toEqual({ anchor: 8, head: 8 })
    expect(marqueeEndpoints(blocks, rect(0, 0, 20, 10), 10, false)).toBeNull()
  })
  it('finds a spanning column through overlapping rows and preserves document-order ties', () => {
    const spanning = block(6, 0, rect(100, 10, 250, 5000))
    const last = block(7000, 4, rect(260, 1500, 600, 1510))
    const rows = Array.from({ length: 4500 }, (_, index) => block(index + 20, 4, rect(260, index, 600, index + 10)))
    const blocks = [spanning, ...rows, last]
    expect(hitBlock(blocks, { x: 120, y: 1505 })).toBe(spanning)
    expect(hitBlock(blocks, { x: 300, y: 1505 })).toBe(last)
    expect(hitBlock(blocks, { x: 100, y: 5001 })).toBeNull()
  })
})
