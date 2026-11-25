import type { NodeViewRendererProps } from '@tiptap/core'
import { floatingBlockControl } from '../components/FloatingBlockControl'
import { CALLOUT_THEMES, calloutTheme } from '../types'
import { controlIcon, syncBlockAttributes } from './attached-node-view'

const themeNames = { blue: '蓝色', gray: '灰色', yellow: '黄色', green: '绿色', red: '红色', purple: '紫色' }

export function CalloutView({ editor, view, node: initial, getPos }: NodeViewRendererProps) {
  const owner = view.dom.ownerDocument
  const dom = owner.createElement('aside')
  dom.className = 'callout'
  dom.dataset.callout = ''
  const icon = owner.createElement('span')
  icon.className = 'callout-icon'
  icon.setAttribute('contenteditable', 'false')
  icon.setAttribute('aria-hidden', 'true')
  const contentDOM = owner.createElement('div')
  contentDOM.className = 'callout-content'
  let node = initial
  const nextTheme = () => CALLOUT_THEMES[(CALLOUT_THEMES.indexOf(calloutTheme(node.attrs.theme)) + 1) % CALLOUT_THEMES.length]!
  const control = editor.isEditable && floatingBlockControl(editor, view, dom, 'block-control callout-theme', (button, signal) => {
    controlIcon(button, 'M12 3a9 9 0 1 0 0 18c1 0 2-.7 2-2s-1-1.7-1-3 1-2 2-2h3a3 3 0 0 0 3-3c0-4-4-8-9-8ZM7 11h.01M10 7h.01M15 7h.01M18 10h.01')
    let timer: ReturnType<typeof setTimeout> | undefined
    const show = () => { clearTimeout(timer); button.classList.add('is-revealed') }
    const hide = () => { clearTimeout(timer); timer = setTimeout(() => button.classList.remove('is-revealed'), 140) }
    dom.addEventListener('pointerenter', show, { signal, passive: true })
    dom.addEventListener('pointerleave', hide, { signal, passive: true })
    button.addEventListener('pointerenter', show, { signal, passive: true })
    button.addEventListener('pointerleave', hide, { signal, passive: true })
    button.addEventListener('focus', show, { signal })
    button.addEventListener('blur', hide, { signal })
    signal.addEventListener('abort', () => clearTimeout(timer), { once: true })
    if (dom.matches(':hover')) show()
    button.addEventListener('mousedown', event => event.preventDefault(), { signal })
    button.addEventListener('click', () => {
      const pos = getPos()
      if (typeof pos === 'number' && editor.isEditable) view.dispatch(view.state.tr.setNodeAttribute(pos, 'theme', nextTheme()))
    }, { signal })
  }, button => {
    button.title = `切换至${themeNames[nextTheme()]}`
    button.setAttribute('aria-label', `将高亮块主题切换至${themeNames[nextTheme()]}`)
  })
  dom.append(icon, contentDOM)
  if (control) dom.append(control.anchor)
  function sync() {
    syncBlockAttributes(dom, node)
    dom.dataset.theme = calloutTheme(node.attrs.theme)
    icon.textContent = node.attrs.icon
    if (control) control.refresh()
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
    ignoreMutation: (mutation: import('@tiptap/pm/view').ViewMutationRecord) =>
      mutation.type !== 'selection' && !contentDOM.contains(mutation.target),
    destroy() { if (control) control.destroy() },
  }
}
