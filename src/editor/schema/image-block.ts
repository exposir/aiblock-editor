import { Node } from '@tiptap/core'
import { imageAttributes, imageDestination, readImageElement } from '../extensions/image-attributes'

export const ImageBlockSchema = Node.create({
  name: 'imageBlock',
  group: 'block',
  atom: true,
  draggable: false,

  addAttributes() {
    return {
      assetId: { default: null, rendered: false },
      src: { default: null, rendered: false },
      alt: { default: '', rendered: false },
      width: { default: 640, rendered: false },
      height: { default: 360, rendered: false },
      displayWidth: { default: null, rendered: false },
      align: { default: 'center', rendered: false },
    }
  },

  parseHTML() {
    return [{ tag: 'img[src]', getAttrs: readImageElement }]
  },

  renderHTML({ node, HTMLAttributes }) {
    const attrs = imageAttributes(node.attrs)
    return ['img', { ...HTMLAttributes, src: imageDestination(attrs), alt: attrs.alt,
      width: attrs.width, height: attrs.height, 'data-display-width': attrs.displayWidth, 'data-align': attrs.align,
      'data-fallback-src': attrs.assetId ? attrs.src : null }]
  },
})
