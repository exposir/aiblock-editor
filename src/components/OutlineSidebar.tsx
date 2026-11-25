import type { Editor } from '@tiptap/core'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { useEffect, useRef, useState } from 'react'
import { useEditorSelector } from '../editor/components/editor-ui'
import { subscribeOverlayLayout } from '../editor/components/overlay-layout'
import { revealBlock } from '../editor/components/reveal-anchor'
import { extractOutline } from '../editor/extensions/block-id'
import type { OutlineEntry } from '../editor/types'

const EMPTY: readonly OutlineEntry[] = []
const labels = new WeakMap<ProseMirrorNode, readonly OutlineEntry[]>()

function selectOutline(editor: Editor | null) {
  if (!editor) return EMPTY
  const doc = editor.state.doc
  let entries = labels.get(doc)
  if (!entries) {
    entries = extractOutline(doc).filter(entry => entry.text.trim())
    labels.set(doc, entries)
  }
  return entries
}

function sameLabels(a: readonly OutlineEntry[], b: readonly OutlineEntry[]) {
  return a.length === b.length && a.every((entry, i) =>
    entry.blockId === b[i]?.blockId && entry.text === b[i]?.text && entry.level === b[i]?.level)
}

export function OutlineSidebar({ editor }: { editor: Editor | null }) {
  const outline = useEditorSelector(editor, selectOutline, sameLabels)
  const [active, setActive] = useState<string | null>(null)
  const clicked = useRef<string | null>(null)
  const cancelReveal = useRef<(() => void) | undefined>(undefined)

  useEffect(() => () => cancelReveal.current?.(), [])

  useEffect(() => {
    if (!editor) return
    const root = editor.view.dom
    const win = root.ownerDocument.defaultView
    if (!win) return
    let headings: { id: string; top: number; bottom: number }[] = []
    let scrollHeight = 0
    let frame = 0
    let settle: ReturnType<typeof setTimeout> | undefined
    const refresh = () => {
      if (frame) return
      frame = win.requestAnimationFrame(() => {
        frame = 0
        if (editor.isDestroyed) return
        const scrollY = win.scrollY
        const viewportBottom = scrollY + win.innerHeight
        let closest: { id: string; top: number } | null = null
        let lastVisible: string | null = null
        for (const heading of headings) {
          if (heading.top <= scrollY + 128 && (closest === null || heading.top >= closest.top)) closest = heading
          if (heading.top < viewportBottom && heading.bottom >= scrollY + 56) lastVisible = heading.id
        }
        const atBottom = scrollY > 0 && viewportBottom >= scrollHeight - 2
        const pinned = outline.some(entry => entry.blockId === clicked.current) ? clicked.current : null
        setActive(pinned ?? (atBottom ? lastVisible : null) ?? closest?.id ?? headings[0]?.id ?? null)
      })
    }
    const measure = (read: (element: Element) => DOMRect) => {
      if (editor.isDestroyed) return
      const scrollY = win.scrollY
      scrollHeight = win.document.documentElement.scrollHeight
      headings = selectOutline(editor).flatMap(entry => {
        const element = editor.view.nodeDOM(entry.pos)
        if (!(element instanceof HTMLElement) || element.closest('[inert]')) return []
        const { top, bottom } = read(element)
        return [{ id: entry.blockId, top: top + scrollY, bottom: bottom + scrollY }]
      })
      return refresh
    }
    const followScroll = () => {
      clicked.current = null
      refresh()
    }
    const followKeys = (event: KeyboardEvent) => {
      if (['PageUp', 'PageDown', 'Home', 'End', 'ArrowUp', 'ArrowDown'].includes(event.key)) followScroll()
    }
    const stopLayout = subscribeOverlayLayout(root, () => {
      clearTimeout(settle)
      settle = setTimeout(() => measure(element => element.getBoundingClientRect())?.(), 120)
    })
    measure(element => element.getBoundingClientRect())?.()
    win.addEventListener('scroll', refresh, { passive: true })
    win.addEventListener('wheel', followScroll, { passive: true })
    win.addEventListener('touchmove', followScroll, { passive: true })
    win.addEventListener('keydown', followKeys)
    return () => {
      win.cancelAnimationFrame(frame)
      clearTimeout(settle)
      stopLayout()
      win.removeEventListener('scroll', refresh)
      win.removeEventListener('wheel', followScroll)
      win.removeEventListener('touchmove', followScroll)
      win.removeEventListener('keydown', followKeys)
    }
  }, [editor, outline])

  function locate(id: string) {
    if (!editor) return
    cancelReveal.current?.()
    cancelReveal.current = revealBlock(editor, id)
    clicked.current = id
    setActive(id)
  }

  return (
    <div className="workspace-navigation-body outline-sidebar" id="document-outline">
      {outline.length ? <nav aria-label="文档章节">
        {outline.map(entry => <button type="button" key={entry.blockId}
          aria-current={active === entry.blockId ? 'location' : undefined}
          style={{ paddingInlineStart: `${0.65 + (entry.level - 1) * 0.65}rem` }}
          onClick={() => locate(entry.blockId)}>{entry.text}</button>)}
      </nav> : <p className="sidebar-empty">添加标题后显示目录</p>}
    </div>
  )
}
