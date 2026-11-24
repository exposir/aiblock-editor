import { describe, expect, it } from 'vitest'
import { calloutTheme } from './types'

describe('callout theme', () => {
  // @partition supported: palette values survive normalization
  // @partition invalid: missing and unsupported persisted values fall back to blue
  it.each(['blue', 'gray', 'yellow', 'green', 'red', 'purple'])('supported: preserves %s', theme => {
    expect(calloutTheme(theme)).toBe(theme)
  })

  it.each([undefined, null, 'pink', '', 2])('invalid: defaults %s to blue', value => {
    expect(calloutTheme(value)).toBe('blue')
  })
})
