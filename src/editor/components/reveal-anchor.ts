import type { Editor } from '@tiptap/core'

export function revealAnchor(editor: Editor, pos: number, target: () => HTMLElement | null) {
  const { doc } = editor.state
  const $pos = doc.resolve(pos)
  const chain = editor.chain()
  let opened = false
  for (let depth = 1; depth <= $pos.depth; depth++) {
    const node = $pos.node(depth)
    if (node.type.name === 'toggle' && node.attrs.open === false) {
      chain.setToggleOpen($pos.before(depth), true)
      opened = true
    }
  }
  if (opened) chain.run()
  const win = editor.view.dom.ownerDocument.defaultView
  if (!win) return
  const reducedMotion = win.matchMedia('(prefers-reduced-motion: reduce)').matches
  function scroll() {
    const element = target()
    if (!element?.isConnected) return
    element.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'start' })
    element.animate?.([
      { boxShadow: '0 0 0 4px #7da6ff8c' }, { boxShadow: '0 0 0 4px #7da6ff00' },
    ], { duration: reducedMotion ? 450 : 1000 })
  }
  win.requestAnimationFrame(() => {
    const body = target()?.closest('[data-toggle-content]')
    const animations = opened ? body?.getAnimations() ?? [] : []
    if (animations.length) void Promise.allSettled(animations.map(animation => animation.finished)).then(scroll)
    else scroll()
  })
}
