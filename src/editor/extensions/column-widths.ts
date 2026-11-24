export const MIN_COLUMN_WIDTH = 15
export const MAX_COLUMNS = 5

const precision = 100
const totalUnits = 100 * precision
const minUnits = MIN_COLUMN_WIDTH * precision

export function normalizeColumnWidths(widths: readonly unknown[]): number[] {
  const count = widths.length
  if (!count) return []
  if (count > MAX_COLUMNS) throw new RangeError(`A column list supports at most ${MAX_COLUMNS} columns`)

  const weights = widths.map(width =>
    typeof width === 'number' && Number.isFinite(width) && width > 0 ? width : 100 / count,
  )
  const largest = Math.max(...weights)
  const scaled = weights.map(weight => weight / largest)
  const units = scaled.map(() => minUnits)
  let active = scaled.map((_, index) => index)
  let remaining = totalUnits

  // Fix narrow columns at the minimum, then redistribute space among the rest.
  while (active.length) {
    const sum = active.reduce((total, index) => total + scaled[index]!, 0)
    const share = (index: number) => remaining * (scaled[index]! / sum)
    const wider = active.filter(index => share(index) >= minUnits)
    if (wider.length === active.length) {
      for (const index of active) units[index] = Math.round(share(index))
      break
    }
    remaining -= (active.length - wider.length) * minUnits
    active = wider
  }

  const widest = units.indexOf(Math.max(...units))
  units[widest] = units[widest]! + totalUnits - units.reduce((sum, width) => sum + width, 0)
  return units.map(width => width / precision)
}

export function resizedColumnWidths(
  widths: readonly number[],
  leftIndex: number,
  delta: number,
): number[] | null {
  if (!Number.isInteger(leftIndex) || leftIndex < 0 || leftIndex + 1 >= widths.length ||
      !Number.isFinite(delta)) return null

  const left = Math.round(widths[leftIndex]! * precision)
  const right = Math.round(widths[leftIndex + 1]! * precision)
  const nextLeft = Math.min(left + right - minUnits, Math.max(minUnits, left + Math.round(delta * precision)))
  const next = [...widths]
  next[leftIndex] = nextLeft / precision
  next[leftIndex + 1] = (left + right - nextLeft) / precision
  return next
}
