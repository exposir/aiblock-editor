import type { Node as ProseMirrorNode } from '@tiptap/pm/model'

export function syncBlockAttributes(dom: HTMLElement, node: ProseMirrorNode) {
  for (const [name, value] of [['data-block-id', node.attrs.blockId], ['data-block-bg', node.attrs.blockBg]]) {
    if (typeof value === 'string') {
      if (dom.getAttribute(name!) !== value) dom.setAttribute(name!, value)
    } else if (dom.hasAttribute(name!)) dom.removeAttribute(name!)
  }
}

export function controlIcon(button: HTMLButtonElement, path: string) {
  const owner = button.ownerDocument
  const namespace = 'http://www.w3.org/2000/svg'
  const svg = owner.createElementNS(namespace, 'svg')
  svg.setAttribute('width', '15')
  svg.setAttribute('height', '15')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('fill', 'none')
  svg.setAttribute('stroke', 'currentColor')
  svg.setAttribute('stroke-width', '2')
  svg.setAttribute('stroke-linecap', 'round')
  svg.setAttribute('stroke-linejoin', 'round')
  svg.setAttribute('aria-hidden', 'true')
  const shape = owner.createElementNS(namespace, 'path')
  shape.setAttribute('d', path)
  svg.append(shape)
  button.append(svg)
}
