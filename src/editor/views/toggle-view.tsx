import type { NodeViewRendererProps } from '@tiptap/core'
import type { ViewMutationRecord } from '@tiptap/pm/view'
import { floatingBlockControl } from '../components/FloatingBlockControl'
import { controlIcon, syncBlockAttributes } from './attached-node-view'

export function toggleBodyId(editorId: string, blockId: unknown): string | undefined {
  return typeof blockId === 'string' ? `toggle-${editorId}-${encodeURIComponent(blockId)}` : undefined
}

export function ToggleView({ editor, view, node: initial, getPos }: NodeViewRendererProps) {
  const owner = view.dom.ownerDocument
  const dom = owner.createElement('div')
  dom.className = 'toggle'
  dom.dataset.toggle = ''
  const contentDOM = owner.createElement('div')
  contentDOM.className = 'toggle-content'
  let node = initial
  const control = floatingBlockControl(editor, view, dom, 'block-control toggle-button', (button, signal) => {
    button.setAttribute('aria-label', '折叠块内容')
    controlIcon(button, 'm9 18 6-6-6-6')
    button.addEventListener('mousedown', event => event.preventDefault(), { signal })
    button.addEventListener('click', () => {
      const pos = getPos()
      if (typeof pos === 'number') editor.commands.setToggleOpen(pos, node.attrs.open === false)
    }, { signal })
  }, button => {
    button.setAttribute('aria-expanded', String(node.attrs.open !== false))
    const id = toggleBodyId(editor.instanceId, node.attrs.blockId)
    if (id) button.setAttribute('aria-controls', id)
    else button.removeAttribute('aria-controls')
  })
  dom.append(control.anchor, contentDOM)
  function sync() {
    syncBlockAttributes(dom, node)
    dom.dataset.open = String(node.attrs.open !== false)
    control.refresh()
  }
  sync()
  return {
    dom, contentDOM,
    update(next: typeof node) {
      if (next.type !== node.type) return false
      const markup = next.sameMarkup(node)
      node = next
      if (!markup) sync()
      return true
    },
    ignoreMutation: (mutation: ViewMutationRecord) =>
      mutation.type !== 'selection' && !contentDOM.contains(mutation.target),
    destroy: control.destroy,
  }
}
