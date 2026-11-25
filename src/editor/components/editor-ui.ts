import { autoUpdate, computePosition, flip, offset, shift } from '@floating-ui/dom'
import type { Placement, ReferenceElement } from '@floating-ui/dom'
import type { Editor } from '@tiptap/core'
import { useCallback, useLayoutEffect, useMemo, useState, useSyncExternalStore } from 'react'
import type { RefObject } from 'react'
import { overlayOrigin, toOverlayRect } from './overlay-geometry'
import type { OverlayRect } from './overlay-geometry'
import { subscribeOverlayLayout } from './overlay-layout'

export function useEditorSelector<T>(editor: Editor | null, select: (editor: Editor | null) => T,
  equal: (a: T, b: T) => boolean = Object.is) {
  const subscribe = useCallback((refresh: () => void) => {
    editor?.on('transaction', refresh)
    return () => { editor?.off('transaction', refresh) }
  }, [editor])
  const snapshot = useMemo(() => {
    let lastState: Editor['state'] | undefined
    let result: { value: T } | undefined
    return () => {
      const state = editor?.state
      if (result && state === lastState) return result.value
      const value = select(editor)
      lastState = state
      if (!result || !equal(result.value, value)) result = { value }
      return result.value
    }
  }, [editor, select, equal])
  return useSyncExternalStore(subscribe, snapshot, snapshot)
}

export function overlayTop(header: HTMLElement | null) {
  return Math.max(0, header?.getBoundingClientRect().bottom ?? 0) + 8
}

/** Transient popups stay viewport-fixed so flip/shift can dodge the viewport and sticky header. */
export function useAnchoredPosition(
  floating: RefObject<HTMLElement | null>,
  anchor: ReferenceElement | null,
  placement: Placement,
  distance = 6,
  onPositioned?: () => void,
) {
  useLayoutEffect(() => {
    const panel = floating.current
    if (!panel || !anchor) return
    let alive = true
    let positioned = false
    const header = panel.ownerDocument.querySelector<HTMLElement>('[data-editor-sticky-header]')
    const update = () => {
      const padding = { top: overlayTop(header), right: 8, bottom: 8, left: 8 }
      void computePosition(anchor, panel, {
        strategy: 'fixed', placement, middleware: [offset(distance), flip({ padding }), shift({ padding, crossAxis: true })],
      }).then(({ x, y }) => {
        if (!alive) return
        panel.style.left = `${x}px`
        panel.style.top = `${y}px`
        panel.style.visibility = 'visible'
        if (!positioned) {
          positioned = true
          onPositioned?.()
        }
      })
    }
    const stop = autoUpdate(anchor, panel, update)
    const observer = header && typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null
    if (header) observer?.observe(header)
    return () => { alive = false; stop(); observer?.disconnect() }
  }, [anchor, distance, floating, placement, onPositioned])
}

export function useOverlayRect(
  anchor: HTMLElement | null,
  host: HTMLElement | null,
  editorRoot: HTMLElement | null,
  initial?: OverlayRect,
) {
  const [rect, setRect] = useState<OverlayRect | null>(() => {
    if (initial) return initial
    if (!anchor || !host) return null
    return toOverlayRect(anchor.getBoundingClientRect(), overlayOrigin(host))
  })
  useLayoutEffect(() => {
    if (!anchor || !host || !editorRoot) {
      setRect(null)
      return
    }
    const measure = (read: (element: Element) => DOMRect) => {
      const origin = read(host)
      const next = toOverlayRect(read(anchor), { x: origin.left, y: origin.top })
      return () => setRect(previous => previous && previous.left === next.left && previous.top === next.top &&
        previous.width === next.width && previous.height === next.height ? previous : next)
    }
    if (!initial) measure(element => element.getBoundingClientRect())()
    return subscribeOverlayLayout(editorRoot, measure)
  }, [anchor, editorRoot, host, initial])
  return rect
}
