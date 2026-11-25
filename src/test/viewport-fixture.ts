import { vi } from 'vitest'
import { viewportCoarseMargin, viewportOverviewMargin } from '../editor/components/viewport'

export function mockViewport() {
  const observers: Viewport[] = []
  class Viewport {
    targets = new Set<Element>()
    constructor(readonly callback: IntersectionObserverCallback, readonly options: IntersectionObserverInit) {
      observers.push(this)
    }
    observe(element: Element) { this.targets.add(element) }
    unobserve(element: Element) { this.targets.delete(element) }
    disconnect() {
      this.targets.clear()
      const index = observers.indexOf(this)
      if (index >= 0) observers.splice(index, 1)
    }
  }
  vi.stubGlobal('IntersectionObserver', Viewport)
  const notify = (observer: Viewport, element: Element, near: boolean) => {
    observer.callback([{
      target: element,
      isIntersecting: near,
      boundingClientRect: element.getBoundingClientRect(),
      rootBounds: document.documentElement.getBoundingClientRect(),
    } as IntersectionObserverEntry], observer as unknown as IntersectionObserver)
  }
  return {
    async flush() {
      for (let attempt = 0; attempt < 3; attempt++) {
        await Promise.resolve()
        await new Promise(resolve => setTimeout(resolve, 0))
      }
    },
    show(element: Element, near: boolean, margin: number) {
      if (![...observers].some(item => item.targets.has(element))) {
        throw new Error('Target is not registered yet; await viewport.flush() before show()')
      }
      let fine = observers.find(item => item.options.rootMargin === `${margin}px 0px` && item.targets.has(element))
      if (!fine) {
        const overviews = observers.filter(item => item.options.rootMargin === `${viewportOverviewMargin(margin)}px 0px`)
        for (const overview of overviews) {
          for (const leader of [...overview.targets]) {
            notify(overview, leader, true)
            const coarseObservers = observers.filter(item =>
              item.options.rootMargin === `${viewportCoarseMargin(margin)}px 0px`)
            for (const coarse of coarseObservers) {
              for (const bandLeader of [...coarse.targets]) {
                notify(coarse, bandLeader, true)
                fine = observers.find(item => item.options.rootMargin === `${margin}px 0px` && item.targets.has(element))
                if (fine) break
              }
              if (fine) break
            }
            if (fine) break
          }
          if (fine) break
        }
      }
      if (!fine) throw new Error('Target is not observed')
      notify(fine, element, near)
    },
  }
}
