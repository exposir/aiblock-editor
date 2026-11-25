import { isAssetId, parseImageAssetId } from '../../workspace/asset-format'

export interface ImageAttributes {
  assetId: string | null
  src: string | null
  alt: string
  width: number
  height: number
  displayWidth: number | null
  align: 'left' | 'center' | 'right'
}

export function imageSource(value: unknown): Pick<ImageAttributes, 'assetId' | 'src'> | null {
  if (typeof value !== 'string' || /[\u0000-\u0020\u007f]/.test(value)) return null
  const id = parseImageAssetId(value)
  if (id) return { assetId: id, src: null }
  const authority = /^https?:\/\/([^/?#]+)/i.exec(value)?.[1]
  if (!authority || authority.includes('@') || value.includes('\\')) return null
  try {
    new URL(value)
    return { assetId: null, src: value }
  } catch {
    return null
  }
}

function pixel(value: unknown): number | null {
  const number = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value
  return typeof number === 'number' && Number.isInteger(number) && number > 0 && number <= 32768 ? number : null
}

export function imageAttributes(source: Partial<Record<keyof ImageAttributes, unknown>>): ImageAttributes {
  const parsed = imageSource(source.src)
  return {
    assetId: isAssetId(source.assetId) ? source.assetId : parsed?.assetId ?? null,
    src: parsed?.src ?? null,
    alt: typeof source.alt === 'string' ? source.alt.slice(0, 4096) : '',
    width: pixel(source.width) ?? 640,
    height: pixel(source.height) ?? 360,
    displayWidth: pixel(source.displayWidth),
    align: source.align === 'left' || source.align === 'right' ? source.align : 'center',
  }
}

export function readImageElement(element: HTMLElement): ImageAttributes | false {
  const primary = imageSource(element.getAttribute('src'))
  if (!primary) return false
  return imageAttributes({
    assetId: primary.assetId,
    src: primary.src ?? element.getAttribute('data-fallback-src'),
    alt: element.getAttribute('alt'),
    width: element.getAttribute('width'),
    height: element.getAttribute('height'),
    displayWidth: element.getAttribute('data-display-width'),
    align: element.getAttribute('data-align'),
  })
}

export function imageDestination(attrs: ImageAttributes) {
  return attrs.assetId ? `asset:${attrs.assetId}` : attrs.src
}
