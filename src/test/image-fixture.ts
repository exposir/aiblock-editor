// One transparent 1×1 PNG.
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a/oQAAAAASUVORK5CYII='

export function testImage() {
  return { bytes: new Uint8Array(Buffer.from(png, 'base64')), mime: 'image/png', width: 1, height: 1, name: '像素.png' }
}
