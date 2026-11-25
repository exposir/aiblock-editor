import type { NodeViewRendererProps } from '@tiptap/core'
import type { ViewMutationRecord } from '@tiptap/pm/view'
import { floatingBlockControl } from '../components/FloatingBlockControl'
import { MAX_COLUMNS, MIN_COLUMN_WIDTH, normalizeColumnWidths, resizedColumnWidths } from '../extensions/column-widths'
import { syncBlockAttributes } from './attached-node-view'

export function ColumnListView({ node: initial, getPos, editor, view }: NodeViewRendererProps) {
  const owner = view.dom.ownerDocument
  const dom = owner.createElement('div')
  dom.className = 'column-layout'
  dom.dataset.columnList = ''
  const contentDOM = owner.createElement('div')
  contentDOM.className = 'column-grid'
  dom.append(contentDOM)
  let node = initial
  let widths = normalizeColumnWidths(node.children.slice(0, MAX_COLUMNS).map(column => column.attrs.width))
  let visible = widths
  const controls: ReturnType<typeof floatingBlockControl>[] = []
  let drag: { index: number; pointerId: number; startX: number; width: number } | null = null

  function draw(next: number[]) {
    visible = next
    const tracks = next.map(width => `${width}%`).join(' ')
    if (dom.style.getPropertyValue('--column-tracks') !== tracks) dom.style.setProperty('--column-tracks', tracks)
    let offset = 0
    for (const [index, control] of controls.entries()) {
      offset += visible[index]!
      const left = `${offset}%`
      if (control.anchor.style.left !== left) control.anchor.style.left = left
      control.refresh()
    }
  }

  function resize(index: number, delta: number) {
    const pos = getPos()
    if (editor.isEditable && typeof pos === 'number' && delta) editor.commands.resizeColumns(pos, index, delta)
  }

  function separator(index: number) {
    return floatingBlockControl(editor, view, dom, 'column-separator', (button, signal) => {
      button.setAttribute('role', 'separator')
      button.setAttribute('aria-label', `调整第 ${index + 1} 和第 ${index + 2} 列的宽度`)
      button.setAttribute('aria-orientation', 'vertical')
      button.setAttribute('aria-valuemin', String(MIN_COLUMN_WIDTH))
      button.addEventListener('pointerdown', event => {
        if (event.button !== 0 || drag) return
        const width = dom.getBoundingClientRect().width
        if (!width) return
        event.preventDefault()
        button.setPointerCapture(event.pointerId)
        drag = { index, pointerId: event.pointerId, startX: event.clientX, width }
      }, { signal })
      function delta(event: PointerEvent) {
        return drag?.pointerId === event.pointerId ? (event.clientX - drag.startX) / drag.width * 100 : null
      }
      button.addEventListener('pointermove', event => {
        const offset = delta(event)
        if (offset !== null) draw(resizedColumnWidths(widths, index, offset) ?? widths)
      }, { signal })
      function clear(event: PointerEvent) {
        if (drag?.pointerId !== event.pointerId) return
        drag = null
        draw(widths)
      }
      button.addEventListener('pointerup', event => {
        const offset = delta(event)
        clear(event)
        if (offset !== null) resize(index, offset)
      }, { signal })
      button.addEventListener('pointercancel', clear, { signal })
      button.addEventListener('lostpointercapture', clear, { signal })
      button.addEventListener('keydown', event => {
        const step = event.shiftKey ? 5 : 1
        const offset = ({
          ArrowLeft: -step, ArrowRight: step, Home: MIN_COLUMN_WIDTH - widths[index]!,
          End: widths[index + 1]! - MIN_COLUMN_WIDTH,
        } as Record<string, number>)[event.key]
        if (offset === undefined) return
        event.preventDefault()
        resize(index, offset)
      }, { signal })
      signal.addEventListener('abort', () => {
        if (drag?.index !== index) return
        drag = null
        draw(widths)
      }, { once: true })
    }, button => {
      button.setAttribute('aria-valuemax', String(widths[index]! + widths[index + 1]! - MIN_COLUMN_WIDTH))
      button.setAttribute('aria-valuenow', String(visible[index]!))
    })
  }

  function sync() {
    syncBlockAttributes(dom, node)
    const count = editor.isEditable ? Math.max(0, widths.length - 1) : 0
    while (controls.length > count) {
      const control = controls.pop()!
      control.destroy()
      control.anchor.remove()
    }
    while (controls.length < count) {
      const control = separator(controls.length)
      controls.push(control)
      dom.append(control.anchor)
    }
    draw(widths)
  }
  sync()
  return {
    dom, contentDOM,
    update(next: typeof node) {
      if (next.type !== node.type) return false
      const current = normalizeColumnWidths(next.children.slice(0, MAX_COLUMNS).map(column => column.attrs.width))
      const changed = !next.sameMarkup(node) || current.length !== widths.length || current.some((width, i) => width !== widths[i])
      node = next
      if (changed) { widths = current; sync() }
      return true
    },
    ignoreMutation: (mutation: ViewMutationRecord) =>
      mutation.type !== 'selection' && !contentDOM.contains(mutation.target),
    destroy() { for (const control of controls) control.destroy() },
  }
}
