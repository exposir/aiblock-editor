import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  observeViewport,
  viewportBandSize,
  viewportCoarseMargin,
  viewportOverviewMargin,
} from './viewport'

class TestObserver {
  static readonly all: TestObserver[] = []
  readonly targets = new Set<Element>()

  constructor(
    readonly callback: IntersectionObserverCallback,
    readonly options: IntersectionObserverInit,
  ) {
    TestObserver.all.push(this)
  }

  observe(target: Element) { this.targets.add(target) }
  unobserve(target: Element) { this.targets.delete(target) }
  disconnect() {
    this.targets.clear()
    const index = TestObserver.all.indexOf(this)
    if (index >= 0) TestObserver.all.splice(index, 1)
  }
}

function rect(top: number, height = 20): DOMRectReadOnly {
  return {
    x: 0,
    y: top,
    top,
    bottom: top + height,
    left: 0,
    right: 700,
    width: 700,
    height,
    toJSON: () => ({}),
  }
}

function enter(
  observer: TestObserver,
  target: Element,
  near: boolean,
  bounds = rect(0),
  rootBounds = rect(0, 900),
) {
  observer.callback([{
    target,
    isIntersecting: near,
    boundingClientRect: bounds,
    rootBounds,
  } as IntersectionObserverEntry], observer as unknown as IntersectionObserver)
}

function observers(margin: number) {
  return {
    overview: TestObserver.all.find(item => item.options.rootMargin === `${viewportOverviewMargin(margin)}px 0px`)!,
    coarse: TestObserver.all.find(item => item.options.rootMargin === `${viewportCoarseMargin(margin)}px 0px`)!,
    fine: TestObserver.all.find(item => item.options.rootMargin === `${margin}px 0px`)!,
  }
}

async function flush() {
  for (let attempt = 0; attempt < 3; attempt++) {
    await Promise.resolve()
    await new Promise(resolve => setTimeout(resolve, 0))
  }
}

afterEach(() => {
  document.body.replaceChildren()
  TestObserver.all.length = 0
  vi.unstubAllGlobals()
})

describe('hierarchical viewport observation', () => {
  it('keeps thousands of anchors below a few hundred active targets', async () => {
    vi.stubGlobal('IntersectionObserver', TestObserver)
    const elements = Array.from({ length: 8_192 }, () => document.createElement('span'))
    document.body.append(...elements)
    const listener = vi.fn()
    const stops = elements.map(element => observeViewport(element, 300, listener))
    await flush()
    const { overview, coarse, fine } = observers(300)

    expect(overview.targets.size).toBeLessThan(200)
    expect(coarse.targets.size).toBe(0)
    expect(fine.targets.size).toBe(0)

    enter(overview, [...overview.targets][0]!, true)
    expect(coarse.targets.size).toBeLessThanOrEqual(64)
    const bandLeader = [...coarse.targets][0]!
    enter(coarse, bandLeader, true)
    expect(fine.targets.size).toBeGreaterThan(0)
    expect(fine.targets.size).toBeLessThanOrEqual(viewportBandSize * 2)
    expect(overview.targets.size + coarse.targets.size + fine.targets.size).toBeLessThan(350)

    const visible = [...fine.targets][0]!
    enter(fine, visible, true)
    expect(listener).toHaveBeenLastCalledWith(true, expect.anything())

    const above = rect(-20_000)
    for (const target of [...overview.targets]) enter(overview, target, false, above)
    expect(coarse.targets.size).toBe(0)
    expect(fine.targets.size).toBe(0)
    expect(listener).toHaveBeenLastCalledWith(false, expect.anything())

    for (const stop of stops) stop()
    expect(TestObserver.all).toHaveLength(0)
  })

  it('reorders detached targets after they are inserted into the document', async () => {
    vi.stubGlobal('IntersectionObserver', TestObserver)
    const first = document.createElement('span')
    const middle = document.createElement('span')
    const last = document.createElement('span')
    const stops = [
      observeViewport(middle, 300, vi.fn()),
      observeViewport(last, 300, vi.fn()),
      observeViewport(first, 300, vi.fn()),
    ]
    document.body.append(first, middle, last)
    await flush()

    const { overview } = observers(300)
    expect(overview.targets).toEqual(new Set([first, last]))
    for (const stop of stops) stop()
  })

  it('cancels a detached registration before its insertion microtask', async () => {
    vi.stubGlobal('IntersectionObserver', TestObserver)
    const element = document.createElement('span')
    const stop = observeViewport(element, 300, vi.fn())
    stop()
    document.body.append(element)
    await flush()
    expect(TestObserver.all).toHaveLength(0)
  })

  it('keeps a tall band active when its first and last leaders both miss the fine viewport', async () => {
    vi.stubGlobal('IntersectionObserver', TestObserver)
    const elements = Array.from({ length: 30 }, () => document.createElement('span'))
    document.body.append(...elements)
    const stops = elements.map(element => observeViewport(element, 300, vi.fn()))
    await flush()
    const { overview, coarse, fine } = observers(300)

    enter(overview, elements[0]!, false, rect(-20_000))
    enter(overview, elements.at(-1)!, false, rect(20_000))
    expect(coarse.targets).toEqual(new Set([elements[0], elements.at(-1)]))
    enter(coarse, elements[0]!, false, rect(-20_000))
    enter(coarse, elements.at(-1)!, false, rect(20_000))
    expect(fine.targets.size).toBe(30)

    for (const stop of stops) stop()
  })

  it('reassigns a section leader when an anchor precedes its document band', async () => {
    vi.stubGlobal('IntersectionObserver', TestObserver)
    const tail = Array.from({ length: 80 }, () => document.createElement('span'))
    document.body.append(...tail)
    const stops = tail.map(element => observeViewport(element, 300, vi.fn()))
    const inserted = document.createElement('span')
    document.body.prepend(inserted)
    stops.push(observeViewport(inserted, 300, vi.fn()))
    await flush()
    const { overview, coarse } = observers(300)

    expect(overview.targets.has(inserted)).toBe(true)
    enter(overview, inserted, true)
    expect(coarse.targets.has(inserted)).toBe(true)

    for (const stop of stops) stop()
  })

  it('falls back to an always-near target when IntersectionObserver is unavailable', () => {
    vi.stubGlobal('IntersectionObserver', undefined)
    const element = document.createElement('span')
    document.body.append(element)
    const listener = vi.fn()
    const stop = observeViewport(element, 300, listener)
    expect(listener).toHaveBeenCalledWith(true)
    stop()
  })
})
