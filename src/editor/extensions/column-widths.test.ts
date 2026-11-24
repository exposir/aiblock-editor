import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { normalizeColumnWidths, resizedColumnWidths } from './column-widths'

const weights = fc.array(fc.oneof(fc.constant(undefined), fc.double()), { minLength: 2, maxLength: 5 })

describe('normalizeColumnWidths', () => {
  // @partition invalid: absent and nonpositive inputs, minimum and impossible counts
  // @partition invariant: arbitrary valid and invalid weights across supported column counts
  it('invalid: defaults invalid weights, supports a singleton and rejects an impossible count', () => {
    expect(normalizeColumnWidths([])).toEqual([])
    expect(normalizeColumnWidths([undefined])).toEqual([100])
    expect(normalizeColumnWidths([NaN, -2, Infinity, 0])).toEqual([25, 25, 25, 25])
    expect(normalizeColumnWidths([97, 1, 1, 1])).toEqual([55, 15, 15, 15])
    expect(() => normalizeColumnWidths([1, 1, 1, 1, 1, 1])).toThrow(RangeError)
  })

  it('invariant: sums to 100, honors minimum widths and is idempotent', () => {
    fc.assert(fc.property(weights, values => {
      const widths = normalizeColumnWidths(values)
      expect(widths).toHaveLength(values.length)
      expect(widths.every(width => width >= 15)).toBe(true)
      expect(widths.reduce((sum, width) => sum + width, 0)).toBeCloseTo(100, 8)
      expect(normalizeColumnWidths(widths)).toEqual(widths)
    }), { seed: 240611, numRuns: 300 })
  })
})

describe('resizedColumnWidths', () => {
  // @partition pair: only the named adjacent pair changes and its total width is stable
  // @partition invalid: fractional or out-of-range boundaries and nonfinite movement
  it('pair: maintains the combined width and minimum for either direction', () => {
    fc.assert(fc.property(weights, fc.nat(), fc.double({ noNaN: true, noDefaultInfinity: true }), (values, edge, delta) => {
      const widths = normalizeColumnWidths(values)
      const left = edge % (widths.length - 1)
      const next = resizedColumnWidths(widths, left, delta)!
      expect(next.slice(0, left)).toEqual(widths.slice(0, left))
      expect(next.slice(left + 2)).toEqual(widths.slice(left + 2))
      expect(next[left]!).toBeGreaterThanOrEqual(15)
      expect(next[left + 1]!).toBeGreaterThanOrEqual(15)
      expect(next[left]! + next[left + 1]!).toBeCloseTo(widths[left]! + widths[left + 1]!, 8)
    }), { seed: 240612, numRuns: 300 })
  })

  it('invalid: rejects a missing adjacent pair or invalid movement', () => {
    expect(resizedColumnWidths([100], 0, 1)).toBeNull()
    expect(resizedColumnWidths([50, 50], -1, 1)).toBeNull()
    expect(resizedColumnWidths([50, 50], 0.5, 1)).toBeNull()
    expect(resizedColumnWidths([50, 50], 0, Infinity)).toBeNull()
  })
})
