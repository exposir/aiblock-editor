import type { Editor } from '@tiptap/core'
import { positionOfBlockId } from './block-geometry'

export function revealBlock(editor: Editor, id: string) {
  const pos = positionOfBlockId(editor.state.doc, id)
  if (pos === null) return
  const inside = editor.state.doc.nodeAt(pos)?.isLeaf ? pos : pos + 1
  return revealAnchor(editor, inside, () => {
    const current = positionOfBlockId(editor.state.doc, id)
    const node = current === null ? null : editor.view.nodeDOM(current)
    return node instanceof HTMLElement ? node : null
  })
}

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
  let cancelled = false
  let highlight: Animation | undefined
  function scroll() {
    if (cancelled || editor.isDestroyed) return
    const element = target()
    if (!element?.isConnected) return
    element.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'start' })
    highlight = element.animate?.([
      { boxShadow: '0 0 0 4px var(--terracotta-border)' }, { boxShadow: '0 0 0 4px transparent' },
    ], { duration: reducedMotion ? 450 : 1000 })
  }
  const frame = win.requestAnimationFrame(() => {
    if (cancelled || editor.isDestroyed) return
    const body = target()?.closest('[data-toggle-content]')
    const animations = opened ? body?.getAnimations() ?? [] : []
    if (animations.length) void Promise.allSettled(animations.map(animation => animation.finished)).then(scroll)
    else scroll()
  })
  return () => {
    cancelled = true
    win.cancelAnimationFrame(frame)
    highlight?.cancel()
  }
}
