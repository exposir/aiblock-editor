type Listener = () => void

interface SharedLayout {
  readonly listeners: Set<Listener>
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
export function subscribeOverlayLayout(root: HTMLElement, listener: Listener): () => void {
  let entry = sharedLayouts.get(root)
  if (!entry) {
    const listeners = new Set<Listener>()
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
      for (const notify of [...listeners]) notify()
    }
    const schedule = () => {
      if (pending || disposed) return
      pending = true
      if (raf) rafId = raf(flush)
      else timer = setTimeout(flush, 16)
    }

    const mutation = new MutationObserver(schedule)
    mutation.observe(root, { subtree: true, childList: true, characterData: true, attributes: true })
    const resize = typeof ResizeObserver === 'function' ? new ResizeObserver(schedule) : null
    resize?.observe(root)
    root.addEventListener('scroll', schedule, true)
    root.addEventListener('transitionend', schedule)
    root.addEventListener('animationend', schedule)
    win?.addEventListener('resize', schedule)
    root.ownerDocument.fonts?.ready.then(schedule).catch(() => {})

    const disconnect = () => {
      disposed = true
      mutation.disconnect()
      resize?.disconnect()
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
