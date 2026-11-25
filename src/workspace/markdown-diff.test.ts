import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { markdownDiff } from './markdown-diff'

describe('Markdown line comparison', () => {
  // @partition edits: ordering, empty files and line endings
  // @partition safety: bounded input and reconstruction of both versions
  it('keeps common lines and orders a replacement as disk removal then local addition', () => {
    expect(markdownDiff('# Notes\n\nold\n\nEnd\n', '# Notes\n\nnew\n\nEnd\n')).toEqual({
      truncated: false, added: 1, removed: 1,
      lines: [
        { kind: 'context', text: '# Notes' }, { kind: 'context', text: '' },
        { kind: 'removed', text: 'old' }, { kind: 'added', text: 'new' },
        { kind: 'context', text: '' }, { kind: 'context', text: 'End' },
      ],
    })
  })

  it('counts lines in newly written and cleared documents', () => {
    expect(markdownDiff('', 'first\nsecond\n')).toMatchObject({ added: 2, removed: 0 })
    expect(markdownDiff('first\nsecond\n', '\n')).toMatchObject({ added: 0, removed: 2 })
  })

  it('treats LF and CRLF as the same lines without inventing a final blank line', () => {
    expect(markdownDiff('first\r\n\r\nsecond\r\n', 'first\n\nsecond')).toMatchObject({
      added: 0, removed: 0, lines: [
        { kind: 'context', text: 'first' }, { kind: 'context', text: '' }, { kind: 'context', text: 'second' },
      ],
    })
  })

  it('declines to compare an oversized document or a single oversized line', () => {
    expect(markdownDiff('word\n'.repeat(5_000), 'short')).toEqual({ truncated: true })
    expect(markdownDiff('word', 'x'.repeat(1_000_000))).toEqual({ truncated: true })
  })

  it('reconstructs both inputs when the opposite side’s changes are removed', () => {
    const lines = fc.array(fc.constantFrom('alpha', 'beta', 'gamma'), { maxLength: 15 })
    fc.assert(fc.property(lines, lines, (before, after) => {
      const diff = markdownDiff(before.join('\n'), after.join('\n'))
      expect(diff.truncated).toBe(false)
      if (diff.truncated) return
      expect(diff.lines.filter(line => line.kind !== 'added').map(line => line.text)).toEqual(before)
      expect(diff.lines.filter(line => line.kind !== 'removed').map(line => line.text)).toEqual(after)
    }))
  })
})
