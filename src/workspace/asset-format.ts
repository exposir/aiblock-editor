const extensions = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp',
} as const

export type ImageMime = keyof typeof extensions

export interface ImageAssetInput {
  readonly bytes: Uint8Array<ArrayBuffer>
  readonly mime: string
  readonly width: number
  readonly height: number
  readonly name?: string
}

export interface ImageAssetMetadata {
  readonly id: string
  readonly mime: ImageMime
  readonly width: number
  readonly height: number
  readonly byteLength: number
  readonly name?: string
}

export const maxImageBytes = 32 * 1024 * 1024

export function isAssetId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}\.(png|jpg|gif|webp)(?![\s\S])/.test(value)
}

export function validImageDimensions(width: number, height: number) {
  return [width, height].every(size => Number.isSafeInteger(size) && size > 0 && size <= 32768) &&
    width * height <= 100_000_000
}

function validName(name: unknown) {
  return name === undefined || typeof name === 'string' && name.length <= 255
}

function knownMime(mime: string): mime is ImageMime {
  return Object.hasOwn(extensions, mime)
}

export function isImageAssetMetadata(value: unknown): value is ImageAssetMetadata {
  if (!value || typeof value !== 'object') return false
  const { id, mime, width, height, byteLength, name } = value as ImageAssetMetadata
  return isAssetId(id) && typeof mime === 'string' && knownMime(mime) && id.endsWith(`.${extensions[mime]}`) &&
    validImageDimensions(width, height) && Number.isSafeInteger(byteLength) && byteLength > 0 && byteLength <= maxImageBytes &&
    validName(name)
}

export function hasImageSignature(bytes: Uint8Array, mime: string): mime is ImageMime {
  const at = (offset: number, ...signature: number[]) =>
    signature.every((byte, index) => bytes[offset + index] === byte)
  switch (mime) {
    case 'image/png': return at(0, 137, 80, 78, 71, 13, 10, 26, 10)
    case 'image/jpeg': return at(0, 255, 216, 255)
    case 'image/gif': return at(0, 71, 73, 70, 56) && (bytes[4] === 55 || bytes[4] === 57) && bytes[5] === 97
    case 'image/webp': return at(0, 82, 73, 70, 70) && at(8, 87, 69, 66, 80)
    default: return false
  }
}

export function validateImageInput(value: unknown): asserts value is ImageAssetInput & { mime: ImageMime } {
  if (!value || typeof value !== 'object') throw new TypeError('Invalid image asset')
  const { bytes, mime, width, height, name } = value as ImageAssetInput
  if (!ArrayBuffer.isView(bytes) || Object.prototype.toString.call(bytes) !== '[object Uint8Array]' ||
      bytes.byteLength > maxImageBytes || typeof mime !== 'string' || !knownMime(mime) ||
      !validImageDimensions(width, height) || !validName(name) || !hasImageSignature(bytes, mime)) {
    throw new TypeError('Invalid image type, signature, size or dimensions')
  }
}

export function imageAssetMetadata(input: ImageAssetInput & { mime: ImageMime }, sha256: string): ImageAssetMetadata {
  const { mime, width, height, name, bytes } = input
  return { id: `${sha256}.${extensions[mime]}`, mime, width, height, byteLength: bytes.byteLength,
    ...(name === undefined ? {} : { name }) }
}
