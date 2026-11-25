import type { Editor } from '@tiptap/core'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import type { Selection } from '@tiptap/pm/state'
import { GripVertical, Plus } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent, RefObject } from 'react'
import { createPortal } from 'react-dom'
import { allowsColumnDrop, createBlockMoveTransaction, getBlockDropSide } from '../extensions/block-drag-logic'
import type { BlockDragSource, BlockDropSide, Point, Rect } from '../extensions/block-drag-logic'
import { MultiBlockSelection } from '../extensions/multi-block-selection'
import { blockAtPoint, blockPositionAtElement, firstLineCenter, hitBlock, marqueeEndpoints, marqueeRect, measureBlock, measureBlocks, positionOfBlockId } from './block-geometry'
import type { MeasuredBlock } from './block-geometry'
import { BlockActionMenu } from './BlockActionMenu'
import { offsetRect, overlayOrigin } from './overlay-geometry'
import { subscribeOverlayLayout } from './overlay-layout'

interface BlockHandleOverlayProps {
  readonly editor: Editor
  readonly surface: RefObject<HTMLElement | null>
  readonly host: HTMLElement
  readonly blockHash: (blockId: string) => string
  readonly onQuickInsert?: (editor: Editor, cursorPos: number) => void
}

interface PointerGesture {
  readonly doc: ProseMirrorNode
  readonly capture: HTMLElement
  readonly pointerId: number
  readonly start: Point
  started: boolean
}

type Gesture =
  | (PointerGesture & { kind: 'handle'; blockPos: number; source: BlockDragSource })
  | (PointerGesture & { kind: 'marquee'; parentStart: number; original: Selection })

interface DropIndicator {
  readonly rect: Rect
  readonly side: BlockDropSide
}

interface ActiveBlock extends MeasuredBlock {
  readonly local: Rect
  readonly handleTop: number
}

const handleWidth = 48
const handleHeight = 26
const gestureThreshold = 5

function pointOf(event: Pick<PointerEvent, 'clientX' | 'clientY'>): Point {
  return { x: event.clientX, y: event.clientY }
}

function dropAt(editor: Editor, source: BlockDragSource, point: Point) {
  const block = blockAtPoint(editor.view, point, 6)
  if (!block) return null
  const side = getBlockDropSide(block.rect, point, allowsColumnDrop(editor.state.doc, source, block.pos))
  const transaction = createBlockMoveTransaction(editor.state, source, { blockPos: block.pos, side })
  return transaction ? { transaction, indicator: { rect: block.rect, side } } : null
}

function dropLine({ rect, side }: DropIndicator) {
  if (side === 'left' || side === 'right') {
    return { left: rect[side] - 1, top: rect.top, width: 2, height: rect.bottom - rect.top }
  }
  return { left: rect.left, top: rect[side] - 1, width: rect.right - rect.left, height: 2 }
}

function selectedSource(editor: Editor, pos: number): BlockDragSource {
  const { selection } = editor.state
  if (selection instanceof MultiBlockSelection && pos >= selection.from && pos < selection.to &&
      editor.state.doc.resolve(pos).sameParent(selection.$from)) return selection
  return { anchorBlockPos: pos, headBlockPos: pos }
}

export function BlockHandleOverlay({ editor, surface, host, blockHash, onQuickInsert }: BlockHandleOverlayProps) {
  const layer = useRef<HTMLDivElement>(null)
  const handle = useRef<HTMLButtonElement>(null)
  const gesture = useRef<Gesture | null>(null)
  const activeRef = useRef<ActiveBlock | null>(null)
  const menuRef = useRef(false)
  const [active, setActive] = useState<ActiveBlock | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [drop, setDrop] = useState<DropIndicator | null>(null)
  const [marquee, setMarquee] = useState<Rect | null>(null)
  const menuId = useId()

  function layerOrigin(): Point | null {
    return layer.current ? overlayOrigin(layer.current) : null
  }

  function measureActive(block: MeasuredBlock | null) {
    if (!block && !activeRef.current) return
    const origin = layerOrigin()
    if (!origin) return
    const next = block ? {
      ...block,
      local: offsetRect(block.rect, origin),
      handleTop: firstLineCenter(block.element) - origin.y - handleHeight / 2,
    } : null
    return () => {
      const current = activeRef.current
      if (next?.element === current?.element && next?.pos === current?.pos &&
          next?.local.left === current?.local.left && next?.handleTop === current?.handleTop) return
      activeRef.current = next
      setActive(next)
    }
  }

  function showBlock(block: MeasuredBlock | null) {
    measureActive(block)?.()
  }

  function setMenu(open: boolean) {
    menuRef.current = open
    setMenuOpen(open)
  }

  function blockPosition(block: ActiveBlock) {
    return blockPositionAtElement(editor.view, block.element) ??
      (block.id ? positionOfBlockId(editor.state.doc, block.id) : null)
  }

  function activateHandle(pos: number) {
    if (menuRef.current) {
      setMenu(false)
      return
    }
    const source = selectedSource(editor, pos)
    if (editor.commands.selectBlockRange(source.anchorBlockPos, source.headBlockPos)) setMenu(true)
  }

  function beginHandle(event: ReactPointerEvent<HTMLButtonElement>, block: ActiveBlock) {
    if (event.button !== 0 || !event.isPrimary || gesture.current || !editor.isEditable) return
    const pos = blockPosition(block)
    if (pos === null) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    gesture.current = {
      kind: 'handle',
      blockPos: pos,
      source: selectedSource(editor, pos),
      doc: editor.state.doc,
      capture: event.currentTarget,
      pointerId: event.pointerId,
      start: pointOf(event),
      started: false,
    }
  }

  useEffect(() => {
    const shell = surface.current
    const dom = editor.view.dom
    const doc = dom.ownerDocument
    const win = doc.defaultView
    if (!shell || !win) return
    let lastMove: PointerEvent | null = null
    let frame = 0
    let marqueeBlocks: MeasuredBlock[] | undefined

    function setSelection(selection: Selection) {
      if (!editor.state.selection.eq(selection)) editor.view.dispatch(editor.state.tr.setSelection(selection))
    }

    function marqueeSelection(current: Extract<Gesture, { kind: 'marquee' }>, point: Point) {
      const rect = marqueeRect(current.start, point)
      const endpoints = marqueeEndpoints(marqueeBlocks ??= measureBlocks(editor.view), rect, current.parentStart, point.y < current.start.y)
      const selection = endpoints && MultiBlockSelection.tryCreate(editor.state.doc, endpoints.anchor, endpoints.head)
      setSelection(selection ?? current.original)
      const origin = layerOrigin()
      setMarquee(origin ? offsetRect(rect, origin) : null)
    }

    function stop(current: Gesture, canceled: boolean) {
      gesture.current = null
      invalidateGeometry()
      if (current.capture.hasPointerCapture(current.pointerId)) current.capture.releasePointerCapture(current.pointerId)
      if (canceled && current.kind === 'marquee' && current.started && current.doc === editor.state.doc) {
        setSelection(current.original)
      }
      setDrop(null)
      setMarquee(null)
    }

    function hasMoved(current: Gesture, point: Point): boolean {
      return Math.hypot(point.x - current.start.x, point.y - current.start.y) >= gestureThreshold
    }

    function renderPointer(event: PointerEvent) {
      const current = gesture.current
      const point = pointOf(event)
      if (current) {
        if (event.pointerId !== current.pointerId) return
        if (current.doc !== editor.state.doc) {
          stop(current, true)
          return
        }
        if (!current.started && !hasMoved(current, point)) return
        if (!current.started) {
          current.started = true
          setMenu(false)
          if (current.kind === 'marquee') editor.view.focus()
        }
        if (current.kind === 'handle') {
          const result = dropAt(editor, current.source, point)
          const origin = layerOrigin()
          setDrop(result && origin ? { rect: offsetRect(result.indicator.rect, origin), side: result.indicator.side } : null)
        } else marqueeSelection(current, point)
        return
      }

      if (!editor.isEditable || menuRef.current) return
      const target = event.target
      if (target instanceof Node && layer.current?.contains(target)) return
      const block = blockAtPoint(editor.view, point)
      const prior = activeRef.current
      if (block) {
        if (block.element !== prior?.element || block.pos !== prior.pos) showBlock(block)
        return
      }
      const rect = prior?.element.getBoundingClientRect()
      if (!rect || point.x < rect.left - handleWidth - 8 || point.x > rect.left ||
          point.y < rect.top || point.y > Math.max(rect.bottom, rect.top + 28)) showBlock(null)
    }

    function queuePointer(event: PointerEvent) {
      lastMove = event
      if (frame) return
      frame = win!.requestAnimationFrame(() => {
        frame = 0
        if (lastMove) renderPointer(lastMove)
      })
    }

    function invalidateGeometry() {
      marqueeBlocks = undefined
    }

    function refreshLayout() {
      const prior = activeRef.current
      const pos = prior ? blockPosition(prior) : null
      const commit = prior && measureActive(pos === null ? null : measureBlock(editor.view, pos))
      return () => {
        invalidateGeometry()
        commit?.()
        if (gesture.current && lastMove) queuePointer(lastMove)
      }
    }

    function followDragScroll() {
      if (gesture.current && lastMove) {
        invalidateGeometry()
        queuePointer(lastMove)
      }
    }

    function startMarquee(event: PointerEvent) {
      const target = event.target
      if (!(target instanceof HTMLElement) || layer.current?.contains(target)) return
      if (menuRef.current) setMenu(false)
      if (event.button !== 0 || !event.isPrimary || gesture.current || !editor.isEditable ||
          target.closest('button, a, input, [contenteditable="false"]')) return

      const bounds = shell!.getBoundingClientRect()
      const pageGutter = target === doc.body || target.parentElement === doc.body
      if (!shell!.contains(target) && !(pageGutter && event.clientY >= bounds.top && event.clientY <= bounds.bottom)) return
      const point = pointOf(event)
      const blocks = measureBlocks(editor.view)
      const insideEditor = dom.contains(target)
      const column = target.matches('[data-column]') ? target : null
      if (insideEditor && ((target !== dom && !column) || (target === dom && hitBlock(blocks, point)))) return
      const parentStart = column ? blocks.find(block => block.element.parentElement === column)?.parentStart : 0
      if (parentStart === undefined) return

      event.preventDefault()
      shell!.setPointerCapture(event.pointerId)
      gesture.current = {
        kind: 'marquee',
        doc: editor.state.doc,
        capture: shell!,
        pointerId: event.pointerId,
        start: point,
        started: false,
        original: editor.state.selection,
        parentStart,
      }
    }

    function finish(event: PointerEvent) {
      const current = gesture.current
      if (!current || event.pointerId !== current.pointerId) return
      const canceled = event.type !== 'pointerup' || current.doc !== editor.state.doc
      const point = pointOf(event)
      const moved = current.started || hasMoved(current, point)
      stop(current, canceled)
      if (canceled) return
      if (current.kind === 'handle') {
        if (!moved) activateHandle(current.blockPos)
        else {
          const result = dropAt(editor, current.source, point)
          if (result) {
            editor.view.dispatch(result.transaction)
            editor.view.focus()
          }
        }
      } else if (moved) {
        if (!current.started) editor.view.focus()
        marqueeSelection(current, point)
        setMarquee(null)
      }
    }

    function escape(event: KeyboardEvent) {
      const current = gesture.current
      if (event.key !== 'Escape' || !current) return
      event.preventDefault()
      event.stopPropagation()
      stop(current, true)
    }

    function showSelected() {
      if (gesture.current || menuRef.current) return
      const { selection } = editor.state
      if (selection instanceof MultiBlockSelection) showBlock(measureBlock(editor.view, selection.headBlockPos))
    }

    const stopLayout = subscribeOverlayLayout(dom, refreshLayout)
    doc.addEventListener('pointerdown', startMarquee, true)
    doc.addEventListener('pointermove', queuePointer, { passive: true })
    doc.addEventListener('pointerup', finish)
    doc.addEventListener('pointercancel', finish)
    doc.addEventListener('lostpointercapture', finish)
    doc.addEventListener('keydown', escape, true)
    win.addEventListener('scroll', followDragScroll, { capture: true, passive: true })
    editor.on('selectionUpdate', showSelected)
    editor.on('update', invalidateGeometry)
    return () => {
      win.cancelAnimationFrame(frame)
      stopLayout()
      doc.removeEventListener('pointerdown', startMarquee, true)
      doc.removeEventListener('pointermove', queuePointer)
      doc.removeEventListener('pointerup', finish)
      doc.removeEventListener('pointercancel', finish)
      doc.removeEventListener('lostpointercapture', finish)
      doc.removeEventListener('keydown', escape, true)
      win.removeEventListener('scroll', followDragScroll, true)
      editor.off('selectionUpdate', showSelected)
      editor.off('update', invalidateGeometry)
    }
  }, [editor, surface])

  return createPortal(
    <div ref={layer} className="block-overlay" data-block-overlay="">
      {active && editor.isEditable && (
        <div className="block-handles"
          style={{ left: Math.max(0, active.local.left - handleWidth - 4), top: active.handleTop }}>
          <button type="button" className="block-control" aria-label="在下方插入段落"
            onMouseDown={event => event.preventDefault()}
            onClick={() => {
              const pos = blockPosition(active)
              if (pos !== null && editor.commands.insertParagraphAfterBlock(pos)) {
                editor.view.focus()
                onQuickInsert?.(editor, editor.state.selection.from)
              }
            }}>
            <Plus size={16} aria-hidden="true" />
          </button>
          <button ref={handle} type="button" className="block-control block-drag-handle"
            aria-label="拖动块或打开块操作" aria-haspopup="dialog" aria-expanded={menuOpen}
            aria-controls={menuOpen ? menuId : undefined}
            onPointerDown={event => beginHandle(event, active)}
            onClick={event => {
              if (event.detail !== 0) return
              const pos = blockPosition(active)
              if (pos !== null) activateHandle(pos)
            }}>
            <GripVertical size={16} aria-hidden="true" />
          </button>
        </div>
      )}
      {menuOpen && handle.current && (
        <BlockActionMenu editor={editor} id={menuId} anchor={handle.current} blockHash={blockHash} onClose={focus => {
          setMenu(false)
          if (focus === 'editor') editor.view.focus()
          else handle.current?.focus()
        }} />
      )}
      {drop && <div aria-hidden="true" className="block-drop-indicator" data-side={drop.side} style={dropLine(drop)} />}
      {marquee && <div aria-hidden="true" className="block-marquee" style={{
        left: marquee.left, top: marquee.top, width: marquee.right - marquee.left, height: marquee.bottom - marquee.top,
      }} />}
    </div>,
    host,
  )
}
