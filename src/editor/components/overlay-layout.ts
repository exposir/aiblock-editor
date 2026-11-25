import { toOverlayRect } from './overlay-geometry'

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

const pageOrigins = new WeakMap<Element, { x: number; y: number }>()

function rememberHost(host: Element, rect: DOMRectReadOnly) {
  const win = host.ownerDocument.defaultView
  const origin = { x: rect.left + (win?.scrollX ?? 0), y: rect.top + (win?.scrollY ?? 0) }
  pageOrigins.set(host, origin)
  return origin
}

export function nearbyOverlayRect(host: HTMLElement, bounds: DOMRectReadOnly) {
  const win = host.ownerDocument.defaultView
  const origin = pageOrigins.get(host) ?? rememberHost(host, host.getBoundingClientRect())
  return toOverlayRect(bounds, { x: origin.x - (win?.scrollX ?? 0), y: origin.y - (win?.scrollY ?? 0) })
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
      const host = findOverlayHost(root)
      if (host && pageOrigins.has(host)) rememberHost(host, rect(host))
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
    function add(block: Element) {
      if (observed.has(block)) return
      observed.add(block)
      resize?.observe(block)
    }
    function remove(block: Element) {
      if (root.contains(block) && (block.parentElement === root || block.parentElement?.matches('[data-column]'))) return
      if (observed.delete(block)) resize?.unobserve?.(block)
    }
    function childrenOfColumns(element: Element, visit: (block: Element) => void) {
      if (element.matches('[data-column]')) for (const child of element.children) visit(child)
      for (const block of element.querySelectorAll('[data-column] > *')) visit(block)
    }
    resize?.observe(root)
    for (const block of root.children) {
      add(block)
      childrenOfColumns(block, add)
    }
    const mutation = new MutationObserver(records => {
      let changed = false
      for (const record of records) {
        const target = record.target
        // Fixed-ratio images can replace their pixels without changing document geometry.
        if (target instanceof Element && target.closest('[data-image-block]') &&
            !target.matches('[data-image-block], .image-block-frame[style]')) continue
        if (target instanceof Element && target.matches('.image-block-frame') && record.type === 'childList') continue
        if (record.type === 'childList') {
          const direct = target === root || target instanceof Element && target.matches('[data-column]')
          for (const node of record.removedNodes) {
            if (!(node instanceof Element)) continue
            remove(node)
            childrenOfColumns(node, remove)
            changed = true
          }
          for (const node of record.addedNodes) {
            if (!(node instanceof Element)) continue
            if (direct && root.contains(node)) add(node)
            if (root.contains(node)) childrenOfColumns(node, add)
            changed = true
          }
        } else if (record.type === 'attributes' && (target !== root || record.attributeName !== 'class')) {
          changed = true
        }
      }
      if (changed || (!resize && records.length)) schedule()
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
