export interface Bounds {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export interface WindowState {
  readonly bounds: Bounds
  readonly maximized: boolean
}

export const minimumWindowSize = { width: 900, height: 620 }
const preferredWindowSize = { width: 1440, height: 900 }

export function parseWindowState(raw: string | null): WindowState | null {
  if (!raw) return null
  try {
    const value: unknown = JSON.parse(raw)
    if (!value || typeof value !== 'object' || !('bounds' in value)) return null
    const bounds = value.bounds
    if (!bounds || typeof bounds !== 'object') return null
    const { x, y, width, height } = bounds as Partial<Bounds>
    if (typeof x !== 'number' || typeof y !== 'number' || typeof width !== 'number' || typeof height !== 'number' ||
        ![x, y, width, height].every(Number.isSafeInteger) || width <= 0 || height <= 0) return null
    return { bounds: { x, y, width, height }, maximized: 'maximized' in value && value.maximized === true }
  } catch {
    return null
  }
}

function overlap(a: Bounds, b: Bounds): number {
  const width = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x))
  const height = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y))
  return width * height
}

function fit(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), high)
}

export function restoreWindowState(
  saved: WindowState | null,
  primary: Bounds,
  otherDisplays: readonly Bounds[] = [],
): WindowState {
  let workArea = primary
  let intersection = 0
  if (saved) {
    for (const display of [primary, ...otherDisplays]) {
      const area = overlap(saved.bounds, display)
      if (area > intersection) {
        intersection = area
        workArea = display
      }
    }
  }

  const size = saved?.bounds ?? preferredWindowSize
  const width = fit(size.width, minimumWindowSize.width, workArea.width)
  const height = fit(size.height, minimumWindowSize.height, workArea.height)
  const origin = saved && intersection > 0
    ? saved.bounds
    : { x: workArea.x + Math.floor((workArea.width - width) / 2), y: workArea.y + Math.floor((workArea.height - height) / 2) }
  return {
    bounds: {
      x: fit(origin.x, workArea.x, workArea.x + workArea.width - width),
      y: fit(origin.y, workArea.y, workArea.y + workArea.height - height),
      width,
      height,
    },
    maximized: saved?.maximized ?? false,
  }
}
