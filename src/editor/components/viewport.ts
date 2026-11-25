type Listener = (near: boolean, bounds?: DOMRectReadOnly) => void

interface Viewport {
  observer: IntersectionObserver
  targets: Map<Element, { listeners: Set<Listener>; near?: boolean; bounds?: DOMRectReadOnly }>
}

const viewports = new WeakMap<Document, Map<number, Viewport>>()

export function observeViewport(target: Element, margin: number, listener: Listener): () => void {
  const owner = target.ownerDocument
  const Observer = owner.defaultView?.IntersectionObserver
  if (!Observer) {
    listener(true)
    return () => {}
  }

  let pools = viewports.get(owner)
  if (!pools) viewports.set(owner, pools = new Map())
  let pool = pools.get(margin)
  if (!pool) {
    const targets: Viewport['targets'] = new Map()
    const observer = new Observer(entries => {
      for (const { target, isIntersecting, boundingClientRect } of entries) {
        const entry = targets.get(target)
        if (!entry || entry.near === isIntersecting) continue
        entry.near = isIntersecting
        entry.bounds = boundingClientRect
        for (const notify of entry.listeners) notify(isIntersecting, boundingClientRect)
      }
    }, { rootMargin: `${margin}px 0px` })
    pools.set(margin, pool = { observer, targets })
  }

  const { observer, targets } = pool
  let entry = targets.get(target)
  if (!entry) {
    entry = { listeners: new Set() }
    targets.set(target, entry)
    observer.observe(target)
  }
  entry.listeners.add(listener)
  if (entry.near !== undefined) listener(entry.near, entry.bounds)
  return () => {
    entry.listeners.delete(listener)
    if (entry.listeners.size || targets.get(target) !== entry) return
    targets.delete(target)
    observer.unobserve(target)
    if (targets.size) return
    observer.disconnect()
    pools.delete(margin)
  }
}
