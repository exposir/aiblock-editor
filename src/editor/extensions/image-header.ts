import type { ImageMime } from '../../workspace/asset-format.js'

/** Read the canvas dimensions before passing untrusted bytes to a bitmap decoder. */
export function imageHeaderSize(bytes: Uint8Array, mime: ImageMime): { width: number; height: number } | null {
  const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  switch (mime) {
    case 'image/png':
      return bytes.length >= 24 && data.getUint32(8) === 13 && data.getUint32(12) === 0x49484452
        ? { width: data.getUint32(16), height: data.getUint32(20) } : null
    case 'image/gif':
      return bytes.length >= 10 ? { width: data.getUint16(6, true), height: data.getUint16(8, true) } : null
    case 'image/webp': {
      if (bytes.length < 25) return null
      const chunk = data.getUint32(12)
      if (chunk === 0x5650384c && bytes[20] === 0x2f) {
        const packed = data.getUint32(21, true)
        return { width: (packed & 0x3fff) + 1, height: ((packed >>> 14) & 0x3fff) + 1 }
      }
      if (bytes.length < 30) return null
      if (chunk === 0x56503858) {
        const size = (offset: number) => 1 + data.getUint16(offset, true) + bytes[offset + 2]! * 65536
        return { width: size(24), height: size(27) }
      }
      if (chunk === 0x56503820 && bytes[23] === 0x9d && bytes[24] === 1 && bytes[25] === 0x2a) {
        return { width: data.getUint16(26, true) & 0x3fff, height: data.getUint16(28, true) & 0x3fff }
      }
      return null
    }
    case 'image/jpeg': {
      for (let offset = 2; offset + 3 < bytes.length;) {
        if (bytes[offset++] !== 0xff) return null
        while (bytes[offset] === 0xff) offset++
        const marker = bytes[offset++]!
        if (marker === 0xda || marker === 0xd9 || offset + 2 > bytes.length) return null
        if (marker === 1 || marker >= 0xd0 && marker <= 0xd7) continue
        const size = data.getUint16(offset)
        if (size < 2 || offset + size > bytes.length) return null
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          return size >= 7 ? { width: data.getUint16(offset + 5), height: data.getUint16(offset + 3) } : null
        }
        offset += size
      }
      return null
    }
  }
}
