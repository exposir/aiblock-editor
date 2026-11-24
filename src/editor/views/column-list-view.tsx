import { useRef, useState } from 'react'
import type { CSSProperties, PointerEvent } from 'react'
import { NodeViewContent, NodeViewWrapper } from '@tiptap/react'
import type { NodeViewProps } from '@tiptap/core'
import { FloatingBlockControl } from '../components/FloatingBlockControl'
import { MIN_COLUMN_WIDTH, normalizeColumnWidths, resizedColumnWidths } from '../extensions/column-widths'

interface Drag {
  index: number
  pointerId: number
  startX: number
  width: number
}

export function ColumnListView({ node, getPos, editor }: NodeViewProps) {
  const layout = useRef<HTMLDivElement>(null)
  const drag = useRef<Drag | null>(null)
  const [preview, setPreview] = useState<{ index: number; delta: number } | null>(null)
  const widths = normalizeColumnWidths(node.children.map(column => column.attrs.width))
  const visible = preview ? resizedColumnWidths(widths, preview.index, preview.delta) ?? widths : widths
  const style: CSSProperties & { '--column-tracks': string } = {
    '--column-tracks': visible.map(width => `${width}%`).join(' '),
  }
  let offset = 0

  function resize(index: number, delta: number) {
    const pos = getPos()
    if (editor.isEditable && typeof pos === 'number' && delta !== 0) {
      editor.commands.resizeColumns(pos, index, delta)
    }
  }

  function startDrag(event: PointerEvent<HTMLButtonElement>, index: number) {
    if (event.button !== 0 || drag.current) return
    const width = layout.current?.getBoundingClientRect().width ?? 0
    if (!width) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = { index, pointerId: event.pointerId, startX: event.clientX, width }
  }

  function dragOffset(event: PointerEvent<HTMLButtonElement>) {
    const current = drag.current
    return current?.pointerId === event.pointerId
      ? { index: current.index, delta: (event.clientX - current.startX) / current.width * 100 }
      : null
  }

  function clearDrag(event: PointerEvent<HTMLButtonElement>) {
    if (drag.current?.pointerId !== event.pointerId) return
    drag.current = null
    setPreview(null)
  }

  return (
    <NodeViewWrapper className="column-layout" style={style} ref={layout}>
      <NodeViewContent className="column-grid" />
      {editor.isEditable && visible.slice(0, -1).map((width, index) => {
        offset += width
        const max = widths[index]! + widths[index + 1]! - MIN_COLUMN_WIDTH
        return (
          <FloatingBlockControl
            key={index}
            className="column-separator"
            role="separator"
            aria-label={`调整第 ${index + 1} 和第 ${index + 2} 列的宽度`}
            aria-orientation="vertical"
            aria-valuemin={MIN_COLUMN_WIDTH}
            aria-valuemax={max}
            aria-valuenow={width}
            style={{ left: `${offset}%` }}
            onPointerDown={event => startDrag(event, index)}
            onPointerMove={event => {
              const next = dragOffset(event)
              if (next) setPreview(next)
            }}
            onPointerUp={event => {
              const next = dragOffset(event)
              clearDrag(event)
              if (next) resize(next.index, next.delta)
            }}
            onLostPointerCapture={clearDrag}
            onPointerCancel={clearDrag}
            onKeyDown={event => {
              const step = event.shiftKey ? 5 : 1
              const delta = {
                ArrowLeft: -step,
                ArrowRight: step,
                Home: MIN_COLUMN_WIDTH - width,
                End: max - width,
              }[event.key]
              if (delta === undefined) return
              event.preventDefault()
              resize(index, delta)
            }}
          />
        )
      })}
    </NodeViewWrapper>
  )
}
