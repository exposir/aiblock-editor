import { describe, expect, it } from 'vitest'
import { offsetRect, toOverlayRect } from './overlay-geometry'

const clientRect = (left: number, top: number, width: number, height: number) => ({ left, top, width, height })

describe('document overlay geometry', () => {
  // @partition offsetRect: shifts edges into the document overlay layer
  // @partition toOverlayRect: keeps width/height while shifting the origin
  it('converts client rectangles into overlay-local rectangles', () => {
    expect(toOverlayRect(clientRect(340, 780, 120, 24), { x: 200, y: 300 })).toEqual({
      left: 140, top: 480, right: 260, bottom: 504, width: 120, height: 24,
    })
    expect(offsetRect({ left: 340, top: 780, right: 460, bottom: 804 }, { x: 200, y: 300 })).toEqual({
      left: 140, top: 480, right: 260, bottom: 504,
    })
  })

  // @partition scroll invariance: anchor and overlay layer move together in the compositor
  it('stays scroll invariant because anchor and layer share the same scroll delta', () => {
    const anchor = clientRect(340, 780, 120, 24)
    const layer = { x: 200, y: 300 }
    const expected = toOverlayRect(anchor, layer)
    const scrolled = 512
    expect(toOverlayRect({ ...anchor, top: anchor.top - scrolled }, { x: 200, y: 300 - scrolled }))
      .toEqual(expected)
    expect(offsetRect({ left: 40, top: 80, right: 440, bottom: 160 }, { x: 0, y: -scrolled }))
      .toEqual(offsetRect({ left: 40, top: 80 + scrolled, right: 440, bottom: 160 + scrolled }, { x: 0, y: 0 }))
  })
})
