import { vi } from 'vitest'

export function mockViewport() {
  const observers = new Set<Viewport>()
  class Viewport {
    targets = new Set<Element>()
    constructor(readonly callback: IntersectionObserverCallback, readonly options: IntersectionObserverInit) {
      observers.add(this)
    }
    observe(element: Element) { this.targets.add(element) }
    unobserve(element: Element) { this.targets.delete(element) }
    disconnect() { this.targets.clear(); observers.delete(this) }
  }
  vi.stubGlobal('IntersectionObserver', Viewport)
  return {
    show(element: Element, near: boolean, margin: number) {
      const observer = [...observers].find(item => item.options.rootMargin === `${margin}px 0px` && item.targets.has(element))
      if (!observer) throw new Error('Target is not observed')
      observer.callback([{ target: element, isIntersecting: near } as IntersectionObserverEntry], observer as unknown as IntersectionObserver)
    },
  }
}
