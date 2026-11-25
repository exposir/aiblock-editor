export interface DiffLine {
  readonly kind: 'context' | 'added' | 'removed'
  readonly text: string
}

export type MarkdownDiff =
  | { readonly truncated: true }
  | { readonly truncated: false; readonly lines: readonly DiffLine[]; readonly added: number; readonly removed: number }

const maxLines = 1_200
export const maxMarkdownDiffCharacters = 192_000
export const conflictPreviewPrefix = 'preview:'

function markdownLines(markdown: string) {
  const body = markdown.replace(/\r?\n$/, '')
  return body ? body.split(/\r?\n/) : []
}

export function markdownDiff(before: string, after: string): MarkdownDiff {
  if (before.length > maxMarkdownDiffCharacters || after.length > maxMarkdownDiffCharacters) return { truncated: true }
  const oldLines = markdownLines(before)
  const newLines = markdownLines(after)
  if (oldLines.length > maxLines || newLines.length > maxLines) return { truncated: true }

  const ids = new Map<string, number>()
  function lineId(text: string) {
    const known = ids.get(text)
    if (known !== undefined) return known
    const id = ids.size
    ids.set(text, id)
    return id
  }
  const oldIds = oldLines.map(lineId)
  const newIds = newLines.map(lineId)

  // Each cell holds the common subsequence length for the two remaining suffixes.
  const stride = newLines.length + 1
  const lengths = new Uint16Array((oldLines.length + 1) * stride)
  for (let old = oldLines.length - 1; old >= 0; old--) {
    const row = old * stride
    for (let next = newLines.length - 1; next >= 0; next--) {
      const cell = row + next
      lengths[cell] = oldIds[old] === newIds[next]
        ? 1 + lengths[cell + stride + 1]!
        : Math.max(lengths[cell + stride]!, lengths[cell + 1]!)
    }
  }

  const lines: DiffLine[] = []
  let added = 0
  let removed = 0
  let old = 0
  let next = 0
  while (old < oldLines.length || next < newLines.length) {
    const previous = oldLines[old]
    const current = newLines[next]
    const cell = old * stride + next
    if (previous !== undefined && previous === current) {
      lines.push({ kind: 'context', text: previous })
      old++
      next++
    } else if (previous !== undefined && (current === undefined || lengths[cell + stride]! >= lengths[cell + 1]!)) {
      lines.push({ kind: 'removed', text: previous })
      old++
      removed++
    } else {
      lines.push({ kind: 'added', text: current! })
      next++
      added++
    }
  }
  return { truncated: false, lines, added, removed }
}
