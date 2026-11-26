type Listener = (near: boolean, bounds?: DOMRectReadOnly) => void

interface TargetState {
  readonly target: Element
  readonly listeners: Set<Listener>
  band: Band
  near?: boolean
  bounds?: DOMRectReadOnly
}

interface PendingState {
  readonly target: Element
  readonly listeners: Set<Listener>
  timer?: ReturnType<typeof setTimeout>
}

interface SpanState {
  first?: Element
  last?: Element
  firstNear: boolean
  lastNear: boolean
  firstRect?: DOMRectReadOnly
  lastRect?: DOMRectReadOnly
  rootBounds?: DOMRectReadOnly | null
}

interface Band extends SpanState {
  readonly members: TargetState[]
  active: boolean
  section?: Section
}

interface Section extends SpanState {
  readonly bands: Band[]
  active: boolean
}

interface Viewport {
  readonly overview: IntersectionObserver
  readonly coarse: IntersectionObserver
  readonly fine: IntersectionObserver
  readonly targets: Map<Element, TargetState>
  readonly pending: Map<Element, PendingState>
  readonly bands: Band[]
  readonly sections: Section[]
  readonly observe: (target: Element, listener: Listener) => () => void
  readonly disconnect: () => void
}

export const viewportBandSize = 32
export const viewportBandExtra = 300
export const viewportOverviewExtra = 600
const sectionBandLimit = 8

export const viewportCoarseMargin = (margin: number) => margin + viewportBandExtra
export const viewportOverviewMargin = (margin: number) => margin + viewportOverviewExtra

const viewports = new WeakMap<Document, Map<number, Viewport>>()
const pendingPollLimit = 8
const pendingPollDelay = (attempt: number) => Math.min(250, 8 * 2 ** attempt)

function follows(left: Element, right: Element): boolean {
  return left !== right && Boolean(left.compareDocumentPosition(right) & 4)
}

function spanState(): SpanState {
  return { firstNear: false, lastNear: false }
}

function createBand(members: TargetState[] = []): Band {
  return { ...spanState(), members, active: false }
}

function createSection(bands: Band[] = []): Section {
  return { ...spanState(), bands, active: false }
}

function createViewport(owner: Document, Observer: typeof IntersectionObserver, margin: number): Viewport {
  const targets = new Map<Element, TargetState>()
  const pending = new Map<Element, PendingState>()
  const bands: Band[] = []
  const sections: Section[] = []
  const overviewTargets = new Map<Element, Section>()
  let disposed = false
  let sectionsScheduled = false

  function leaderTargets(state: SpanState): Set<Element> {
    return new Set([state.first, state.last].filter((target): target is Element => !!target))
  }

  function setBandLeaders(band: Band) {
    const first = band.members[0]?.target
    const last = band.members.at(-1)?.target
    const previous = leaderTargets(band)
    const next = new Set([first, last].filter((target): target is Element => !!target))
    if (band.section?.active) {
      for (const target of previous) if (!next.has(target)) coarse.unobserve(target)
      for (const target of next) if (!previous.has(target)) coarse.observe(target)
    }
    if (band.first !== first) {
      band.firstNear = false
      band.firstRect = undefined
    }
    if (band.last !== last) {
      band.lastNear = false
      band.lastRect = undefined
    }
    band.first = first
    band.last = last
  }

  function setSectionLeaders(section: Section) {
    const first = section.bands[0]?.members[0]?.target
    const last = section.bands.at(-1)?.members.at(-1)?.target
    const previous = leaderTargets(section)
    const next = new Set([first, last].filter((target): target is Element => !!target))
    for (const target of previous) if (!next.has(target)) {
      overview.unobserve(target)
      overviewTargets.delete(target)
    }
    for (const target of next) if (!previous.has(target)) {
      overviewTargets.set(target, section)
      overview.observe(target)
    }
    if (section.first !== first) {
      section.firstNear = false
      section.firstRect = undefined
    }
    if (section.last !== last) {
      section.lastNear = false
      section.lastRect = undefined
    }
    section.first = first
    section.last = last
  }

  function activateBand(band: Band, active: boolean) {
    if (band.active === active) return
    band.active = active
    if (active) {
      for (const entry of band.members) fine.observe(entry.target)
      return
    }
    for (const entry of band.members) {
      fine.unobserve(entry.target)
      if (entry.near !== true) continue
      entry.near = false
      for (const notify of entry.listeners) notify(false, entry.bounds)
    }
  }

  function activateSection(section: Section, active: boolean) {
    if (section.active === active) return
    section.active = active
    if (active) {
      for (const band of section.bands) {
        if (band.first) coarse.observe(band.first)
        if (band.last && band.last !== band.first) coarse.observe(band.last)
      }
      return
    }
    for (const band of section.bands) {
      activateBand(band, false)
      if (band.first) coarse.unobserve(band.first)
      if (band.last && band.last !== band.first) coarse.unobserve(band.last)
    }
  }

  function spansViewport(state: SpanState) {
    if (state.firstNear || state.lastNear) return true
    if (!state.firstRect || !state.lastRect) return false
    const root = state.rootBounds ?? {
      top: 0,
      bottom: owner.defaultView?.innerHeight ?? 0,
    }
    return state.firstRect.bottom <= root.bottom && state.lastRect.top >= root.top
  }

  function refreshBands() {
    const desired = new Set<Band>()
    for (const section of sections) {
      if (!section.active) continue
      for (let index = 0; index < section.bands.length; index++) {
        const band = section.bands[index]!
        if (!spansViewport(band)) continue
        desired.add(band)
        if (index > 0) desired.add(section.bands[index - 1]!)
        if (index + 1 < section.bands.length) desired.add(section.bands[index + 1]!)
      }
    }
    for (const band of bands) if (band.active && !desired.has(band)) activateBand(band, false)
    for (const band of desired) activateBand(band, true)
  }

  function refreshSections() {
    const desired = new Set<Section>()
    for (let index = 0; index < sections.length; index++) {
      const section = sections[index]!
      if (!spansViewport(section)) continue
      desired.add(section)
      if (index > 0) desired.add(sections[index - 1]!)
      if (index + 1 < sections.length) desired.add(sections[index + 1]!)
    }
    for (const section of sections) if (section.active && !desired.has(section)) activateSection(section, false)
    for (const section of desired) activateSection(section, true)
    refreshBands()
  }

  function rebuildSections() {
    sectionsScheduled = false
    if (disposed) return
    for (const section of sections) activateSection(section, false)
    for (const section of sections) {
      for (const target of leaderTargets(section)) {
        overview.unobserve(target)
        overviewTargets.delete(target)
      }
    }
    sections.length = 0
    for (let start = 0; start < bands.length; start += sectionBandLimit) {
      const section = createSection(bands.slice(start, start + sectionBandLimit))
      for (const band of section.bands) band.section = section
      sections.push(section)
    }
    for (const section of sections) setSectionLeaders(section)
    refreshSections()
  }

  function scheduleSections() {
    if (sectionsScheduled || disposed) return
    sectionsScheduled = true
    queueMicrotask(rebuildSections)
  }

  function insert(target: Element): TargetState {
    let low = 0
    let high = bands.length
    while (low < high) {
      const middle = (low + high) >>> 1
      const first = bands[middle]!.members[0]!.target
      if (follows(first, target)) low = middle + 1
      else high = middle
    }

    if (!bands.length) bands.push(createBand())
    const index = low ? low - 1 : 0
    const band = bands[index]!
    let memberIndex = band.members.length
    for (let i = 0; i < band.members.length; i++) {
      if (!follows(band.members[i]!.target, target)) {
        memberIndex = i
        break
      }
    }
    const entry = { target, listeners: new Set<Listener>(), band } satisfies TargetState
    band.members.splice(memberIndex, 0, entry)
    targets.set(target, entry)
    setBandLeaders(band)
    trim(band, index)
    if (entry.band.active) fine.observe(target)
    scheduleSections()
    return entry
  }

  function trim(band: Band, index: number) {
    if (band.members.length <= viewportBandSize) return
    const right = createBand(band.members.splice(Math.ceil(band.members.length / 2)))
    bands.splice(index + 1, 0, right)
    for (const entry of right.members) entry.band = right
    rebalance(index)
  }

  function rebalance(index: number) {
    const left = bands[index]
    const right = bands[index + 1]
    if (!left || !right) return
    if (left.active) activateBand(left, false)
    if (right.active) activateBand(right, false)
    const combined = [...left.members, ...right.members]
    if (combined.length <= viewportBandSize) {
      bands.splice(index + 1, 1)
      left.members.splice(0, left.members.length, ...combined)
      for (const entry of left.members) entry.band = left
    } else {
      const split = Math.ceil(combined.length / 2)
      left.members.splice(0, left.members.length, ...combined.slice(0, split))
      right.members.splice(0, right.members.length, ...combined.slice(split))
      for (const entry of left.members) entry.band = left
      for (const entry of right.members) entry.band = right
    }
    setBandLeaders(left)
    if (bands[index + 1] === right) setBandLeaders(right)
  }

  function remove(target: Element, listener: Listener) {
    const waiting = pending.get(target)
    if (waiting) {
      waiting.listeners.delete(listener)
      if (!waiting.listeners.size) {
        clearTimeout(waiting.timer)
        pending.delete(target)
      }
      return
    }
    const entry = targets.get(target)
    if (!entry) return
    entry.listeners.delete(listener)
    if (entry.listeners.size) return
    const band = entry.band
    const index = band.members.indexOf(entry)
    if (index >= 0) band.members.splice(index, 1)
    targets.delete(target)
    fine.unobserve(target)
    if (band.first === target || band.last === target) setBandLeaders(band)
    if (!band.members.length) {
      activateBand(band, false)
      const at = bands.indexOf(band)
      if (at >= 0) bands.splice(at, 1)
    } else {
      const at = bands.indexOf(band)
      if (at >= 0) {
        rebalance(at)
        if (at > 0) rebalance(at - 1)
      }
    }
    scheduleSections()
  }

  const overview = new Observer(entries => {
    if (disposed) return
    let changed = false
    for (const { target, isIntersecting, boundingClientRect, rootBounds } of entries) {
      const section = overviewTargets.get(target)
      if (!section) continue
      if (section.first === target) {
        section.firstNear = isIntersecting
        section.firstRect = boundingClientRect
        section.rootBounds = rootBounds
        changed = true
      }
      if (section.last === target) {
        section.lastNear = isIntersecting
        section.lastRect = boundingClientRect
        section.rootBounds = rootBounds
        changed = true
      }
    }
    if (changed) refreshSections()
  }, { rootMargin: `${viewportOverviewMargin(margin)}px 0px` })

  const coarse = new Observer(entries => {
    if (disposed) return
    let changed = false
    for (const { target, isIntersecting, boundingClientRect, rootBounds } of entries) {
      const entry = targets.get(target)
      const band = entry?.band
      if (!band?.section?.active) continue
      if (band.first === target) {
        band.firstNear = isIntersecting
        band.firstRect = boundingClientRect
        band.rootBounds = rootBounds
        changed = true
      }
      if (band.last === target) {
        band.lastNear = isIntersecting
        band.lastRect = boundingClientRect
        band.rootBounds = rootBounds
        changed = true
      }
    }
    if (changed) refreshBands()
  }, { rootMargin: `${viewportCoarseMargin(margin)}px 0px` })

  const fine = new Observer(entries => {
    if (disposed) return
    for (const { target, isIntersecting, boundingClientRect } of entries) {
      const entry = targets.get(target)
      if (!entry || !entry.band.active || entry.near === isIntersecting) continue
      entry.near = isIntersecting
      entry.bounds = boundingClientRect
      for (const notify of entry.listeners) notify(isIntersecting, boundingClientRect)
    }
  }, { rootMargin: `${margin}px 0px` })

  function attach(target: Element) {
    const state = pending.get(target)
    if (!state) return
    pending.delete(target)
    clearTimeout(state.timer)
    if (!target.isConnected) {
      for (const listener of state.listeners) listener(true)
      return
    }
    const entry = insert(target)
    for (const listener of state.listeners) {
      entry.listeners.add(listener)
      if (entry.near !== undefined) listener(entry.near, entry.bounds)
    }
  }

  return {
    overview,
    coarse,
    fine,
    targets,
    pending,
    bands,
    sections,
    observe(target, listener) {
      const entry = targets.get(target)
      if (entry) {
        entry.listeners.add(listener)
        if (entry.near !== undefined) listener(entry.near, entry.bounds)
      } else if (target.isConnected) {
        const attached = insert(target)
        attached.listeners.add(listener)
        if (attached.near !== undefined) listener(attached.near, attached.bounds)
      } else {
        let waiting = pending.get(target)
        if (!waiting) {
          waiting = { target, listeners: new Set() }
          pending.set(target, waiting)
          const current = waiting
          let attempt = 0
          const connect = () => {
            current.timer = undefined
            if (disposed || pending.get(target) !== current) return
            if (target.isConnected) {
              attach(target)
              return
            }
            attempt++
            if (attempt >= pendingPollLimit) {
              pending.delete(target)
              for (const listener of current.listeners) listener(true)
              return
            }
            current.timer = setTimeout(connect, pendingPollDelay(attempt))
          }
          queueMicrotask(connect)
        }
        waiting.listeners.add(listener)
      }
      return () => remove(target, listener)
    },
    disconnect() {
      if (disposed) return
      disposed = true
      overview.disconnect()
      coarse.disconnect()
      fine.disconnect()
      for (const state of pending.values()) clearTimeout(state.timer)
      targets.clear()
      pending.clear()
      overviewTargets.clear()
      bands.length = 0
      sections.length = 0
    },
  }
}

export function observeViewport(target: Element, margin: number, listener: Listener): () => void {
  const owner = target.ownerDocument
  const Observer = owner.defaultView?.IntersectionObserver
  if (!Observer) {
    listener(true)
    return () => {}
  }

  let pools = viewports.get(owner)
  if (!pools) viewports.set(owner, pools = new Map())
  let viewport = pools.get(margin)
  if (!viewport) {
    viewport = createViewport(owner, Observer, margin)
    pools.set(margin, viewport)
  }

  const current = viewport
  const stop = current.observe(target, listener)
  return () => {
    stop()
    if (current.targets.size || current.pending.size) return
    current.disconnect()
    pools.delete(margin)
  }
}
