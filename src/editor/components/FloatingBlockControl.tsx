import type { Editor } from '@tiptap/core'
import { NodeSelection } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'
import { findOverlayHost, nearbyOverlayRect, subscribeOverlayLayout } from './overlay-layout'
import { observeViewport } from './viewport'

type Pin = (active: boolean) => void
interface SelectionScope {
  controls: Map<Element, Set<Pin>>
  pins: Set<Pin>
  release(): void
}
const selectionScopes = new WeakMap<EditorView, SelectionScope>()

function retainSelected(editor: Editor, view: EditorView, block: HTMLElement, listener: Pin) {
  let scope = selectionScopes.get(view)
  if (!scope) {
    const controls = new Map<Element, Set<Pin>>()
    let previousHead: number | undefined
    let previousDoc = view.state.doc
    const refresh = () => {
      const { selection, doc } = view.state
      if (view.isDestroyed || previousHead === selection.head && previousDoc === doc) return
      previousHead = selection.head
      previousDoc = doc
      const dom = selection instanceof NodeSelection ? view.nodeDOM(selection.from) : view.domAtPos(selection.head).node
      const pins = new Set<Pin>()
      let element = dom instanceof Element ? dom : dom?.parentElement
      while (element && element !== view.dom) {
        controls.get(element)?.forEach(pin => pins.add(pin))
        element = element.parentElement
      }
      for (const pin of scope!.pins) if (!pins.has(pin)) pin(false)
      for (const pin of pins) if (!scope!.pins.has(pin)) pin(true)
      scope!.pins = pins
    }
    editor.on('transaction', refresh)
    scope = { controls, pins: new Set(), release: () => { editor.off('transaction', refresh) } }
    selectionScopes.set(view, scope)
    queueMicrotask(() => { if (scope!.controls.size) refresh() })
  }
  let pins = scope.controls.get(block)
  if (!pins) scope.controls.set(block, pins = new Set())
  pins.add(listener)
  return () => {
    pins.delete(listener)
    if (!pins.size) scope.controls.delete(block)
    scope.pins.delete(listener)
    if (!scope.controls.size) {
      scope.release()
      selectionScopes.delete(view)
    }
  }
}

export function floatingBlockControl(editor: Editor, view: EditorView, block: HTMLElement,
  className: string, configure: (button: HTMLButtonElement, signal: AbortSignal) => void,
  refresh: (button: HTMLButtonElement) => void,
) {
  const owner = block.ownerDocument
  const anchor = owner.createElement('span')
  anchor.className = `block-control-anchor ${className}`
  anchor.setAttribute('contenteditable', 'false')
  anchor.setAttribute('aria-hidden', 'true')
  let near = false
  let selected = false
  let bounds: DOMRectReadOnly | undefined
  let disposed = false
  let button: HTMLButtonElement | undefined
  let teardown: (() => void) | undefined

  function update() {
    if (disposed) return
    if (!near && !selected && button !== owner.activeElement) {
      teardown?.()
      return
    }
    if (button) return
    const host = findOverlayHost(anchor)
    if (!host) return
    const control = owner.createElement('button')
    button = control
    control.type = 'button'
    control.className = `floating-block-control ${className}`
    const listeners = new AbortController()
    configure(control, listeners.signal)
    refresh(control)
    control.addEventListener('blur', () => queueMicrotask(update), { signal: listeners.signal })
    const place = (values: { left: number; top: number; width: number; height: number }) => {
      const hidden = !values.width || !values.height || !!anchor.closest('[inert]')
      return () => {
        if (control.hidden !== hidden) control.hidden = hidden
        for (const property of ['left', 'top', 'width', 'height'] as const) {
          const value = `${values[property]}px`
          if (control.style[property] !== value) control.style[property] = value
        }
      }
    }
    const measure = (read: (element: Element) => DOMRect) => {
      const origin = read(host)
      const rect = read(anchor)
      return place({ left: rect.left - origin.left, top: rect.top - origin.top, width: rect.width, height: rect.height })
    }
    if (bounds && near) place(nearbyOverlayRect(host, bounds))()
    else measure(element => element.getBoundingClientRect())()
    host.append(control)
    const stop = subscribeOverlayLayout(view.dom, measure)
    teardown = () => {
      listeners.abort()
      stop()
      control.remove()
      button = undefined
      teardown = undefined
    }
  }

  const stop = observeViewport(anchor, 300, (available, rect) => {
    near = available
    bounds = rect
    if (near && !anchor.isConnected) queueMicrotask(update)
    else update()
  })
  const release = retainSelected(editor, view, block, active => { selected = active; update() })
  return {
    anchor,
    refresh() { if (button) refresh(button) },
    destroy() { disposed = true; stop(); release(); teardown?.() },
  }
}
