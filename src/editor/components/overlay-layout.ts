type LayoutRead = (rect: (element: Element) => DOMRect) => void | (() => void)

interface SharedLayout {
  readonly listeners: Set<LayoutRead>
  readonly disconnect: () => void
}

const sharedLayouts = new WeakMap<Element, SharedLayout>()

export function findOverlayHost(element: Element): HTMLElement | null {
  const surface = element.closest('[data-document-surface]')
  const host = surface?.querySelector<HTMLElement>('[data-document-overlays]')
  return host ?? null
}

/**
 * Re-measures document-attached overlays only when layout can change: document
 * mutations, editor/viewport resizes, inner scrollers (.tableWrapper, <pre>),
 * font swaps and collapse transitions. Page scroll never runs any of this.
 */
export function subscribeOverlayLayout(root: HTMLElement, listener: LayoutRead): () => void {
  let entry = sharedLayouts.get(root)
  if (!entry) {
    const listeners = new Set<LayoutRead>()
    const win = root.ownerDocument.defaultView
    const raf = win?.requestAnimationFrame?.bind(win)
    const cancelRaf = win?.cancelAnimationFrame?.bind(win)
    let pending = false
    let disposed = false
    let rafId = 0
    let timer: ReturnType<typeof setTimeout> | undefined

    const flush = () => {
      pending = false
      rafId = 0
      timer = undefined
      const rects = new Map<Element, DOMRect>()
      const rect = (element: Element) => {
        let value = rects.get(element)
        if (!value) {
          value = element.getBoundingClientRect()
          rects.set(element, value)
        }
        return value
      }
      const writes = Array.from(listeners, read => read(rect))
      for (const write of writes) write?.()
    }
    const schedule = () => {
      if (pending || disposed) return
      pending = true
      if (raf) rafId = raf(flush)
      else timer = setTimeout(flush, 16)
    }

    const resize = typeof ResizeObserver === 'function' ? new ResizeObserver(schedule) : null
    const observed = new Set<Element>()
    const syncBlocks = () => {
      const blocks = new Set([...root.children, ...root.querySelectorAll('[data-column] > *')])
      for (const block of observed) if (!blocks.has(block)) resize?.unobserve?.(block)
      for (const block of blocks) if (!observed.has(block)) resize?.observe(block)
      observed.clear()
      for (const block of blocks) observed.add(block)
    }
    resize?.observe(root)
    syncBlocks()
    const mutation = new MutationObserver(records => {
      const structural = records.some(record => record.type === 'childList' &&
        [...record.addedNodes, ...record.removedNodes].some(node => node.nodeType === Node.ELEMENT_NODE))
      if (structural) syncBlocks()
      if (structural || records.some(record => record.type === 'attributes' &&
          (record.target !== root || record.attributeName !== 'class')) || (!resize && records.length)) schedule()
    })
    mutation.observe(root, { subtree: true, childList: true, attributes: true, characterData: !resize })
    root.addEventListener('scroll', schedule, { capture: true, passive: true })
    root.addEventListener('transitionend', schedule)
    root.addEventListener('animationend', schedule)
    win?.addEventListener('resize', schedule)
    root.ownerDocument.fonts?.ready.then(schedule).catch(() => {})

    const disconnect = () => {
      disposed = true
      mutation.disconnect()
      resize?.disconnect()
      observed.clear()
      root.removeEventListener('scroll', schedule, true)
      root.removeEventListener('transitionend', schedule)
      root.removeEventListener('animationend', schedule)
      win?.removeEventListener('resize', schedule)
      if (rafId) cancelRaf?.(rafId)
      if (timer !== undefined) clearTimeout(timer)
      pending = false
      rafId = 0
      timer = undefined
    }

    entry = { listeners, disconnect }
    sharedLayouts.set(root, entry)
  }

  entry.listeners.add(listener)
  const current = entry
  return () => {
    current.listeners.delete(listener)
    if (current.listeners.size) return
    current.disconnect()
    sharedLayouts.delete(root)
  }
}
