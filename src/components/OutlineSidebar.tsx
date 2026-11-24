import type { Editor } from '@tiptap/core'
import { List, PanelLeftClose } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { positionOfBlockId } from '../editor/components/block-geometry'
import { useEditorDocument } from '../editor/components/editor-ui'
import { revealAnchor } from '../editor/components/reveal-anchor'
import { extractOutline } from '../editor/extensions/block-id'

export function OutlineSidebar({ editor, onClose }: { editor: Editor | null; onClose: () => void }) {
  const doc = useEditorDocument(editor)
  const outline = useMemo(() => doc ? extractOutline(doc).filter(entry => entry.text.trim()) : [], [doc])
  const [active, setActive] = useState<string | null>(null)
  const clicked = useRef<string | null>(null)

  useEffect(() => {
    if (!editor) return
    const win = editor.view.dom.ownerDocument.defaultView
    if (!win) return
    let frame = 0
    const refresh = () => {
      if (frame) return
      frame = win.requestAnimationFrame(() => {
        frame = 0
        let closest: { id: string; top: number } | null = null
        let first: string | null = null
        let lastVisible: string | null = null
        for (const entry of outline) {
          const element = editor.view.nodeDOM(entry.pos)
          if (!(element instanceof HTMLElement) || element.closest('[inert]')) continue
          first ??= entry.blockId
          const { top, bottom } = element.getBoundingClientRect()
          if (top <= 128 && (closest === null || top >= closest.top)) closest = { top, id: entry.blockId }
          if (top < win.innerHeight && bottom >= 56) lastVisible = entry.blockId
        }
        const atBottom = win.scrollY > 0 && win.scrollY + win.innerHeight >= win.document.documentElement.scrollHeight - 2
        const pinned = outline.some(entry => entry.blockId === clicked.current) ? clicked.current : null
        setActive(pinned ?? (atBottom ? lastVisible : null) ?? closest?.id ?? first)
      })
    }
    const followScroll = () => {
      clicked.current = null
      refresh()
    }
    const followKeys = (event: KeyboardEvent) => {
      if (['PageUp', 'PageDown', 'Home', 'End', 'ArrowUp', 'ArrowDown'].includes(event.key)) followScroll()
    }
    refresh()
    win.addEventListener('scroll', refresh, { passive: true, capture: true })
    win.addEventListener('resize', refresh)
    win.addEventListener('wheel', followScroll, { passive: true })
    win.addEventListener('touchmove', followScroll, { passive: true })
    win.addEventListener('keydown', followKeys)
    return () => {
      win.cancelAnimationFrame(frame)
      win.removeEventListener('scroll', refresh, true)
      win.removeEventListener('resize', refresh)
      win.removeEventListener('wheel', followScroll)
      win.removeEventListener('touchmove', followScroll)
      win.removeEventListener('keydown', followKeys)
    }
  }, [editor, outline])

  function locate(id: string) {
    if (!editor) return
    const pos = positionOfBlockId(editor.state.doc, id)
    if (pos === null) return
    clicked.current = id
    setActive(id)
    revealAnchor(editor, pos + 1, () => {
      const current = positionOfBlockId(editor.state.doc, id)
      const node = current === null ? null : editor.view.nodeDOM(current)
      return node instanceof HTMLElement ? node : null
    })
  }

  return (
    <aside className="workspace-sidebar outline-sidebar" id="document-outline" aria-label="目录">
      <div className="sidebar-heading"><List size={16} aria-hidden="true" /><h2>目录</h2>
        <button type="button" className="icon-control" aria-label="收起目录" onClick={onClose}>
          <PanelLeftClose size={16} aria-hidden="true" />
        </button>
      </div>
      {outline.length ? <nav aria-label="文档章节">
        {outline.map(entry => <button type="button" key={entry.blockId}
          aria-current={active === entry.blockId ? 'location' : undefined}
          style={{ paddingInlineStart: `${0.65 + (entry.level - 1) * 0.65}rem` }}
          onClick={() => locate(entry.blockId)}>{entry.text}</button>)}
      </nav> : <p className="sidebar-empty">添加标题后显示目录</p>}
    </aside>
  )
}
