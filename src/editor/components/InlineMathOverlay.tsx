import type { Editor } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'
import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { inlineMathEditKey } from '../extensions/inline-math'
import { useAnchoredPosition, useEditorSelector } from './editor-ui'

function FormulaEditor({ editor, anchor, initial, pos }: {
  editor: Editor; anchor: HTMLElement; initial: string; pos: number
}) {
  const panel = useRef<HTMLFormElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const [latex, setLatex] = useState(initial)

  const focusInput = useCallback(() => input.current?.focus({ preventScroll: true }), [])
  useAnchoredPosition(panel, anchor, 'bottom-start', 6, focusInput)

  function finish(save: boolean, focus: boolean) {
    const tr = editor.state.tr.setMeta(inlineMathEditKey, null)
    const node = tr.doc.nodeAt(pos)
    if (node?.type.name === 'inlineMath') {
      if (save && latex !== initial) tr.setNodeAttribute(pos, 'latex', latex)
      if (focus) tr.setSelection(TextSelection.create(tr.doc, pos + node.nodeSize))
    }
    editor.view.dispatch(tr)
    if (focus) editor.view.focus()
  }

  useEffect(() => {
    const owner = anchor.ownerDocument
    function dismiss(event: PointerEvent) {
      if (event.target instanceof Node && !panel.current?.contains(event.target) && !anchor.contains(event.target)) {
        editor.view.dispatch(editor.state.tr.setMeta(inlineMathEditKey, null))
      }
    }
    owner.addEventListener('pointerdown', dismiss, true)
    return () => owner.removeEventListener('pointerdown', dismiss, true)
  }, [anchor, editor])

  return createPortal(
    <form ref={panel} className="overlay-card inline-math-editor bubble-link" role="dialog" aria-label="编辑数学公式"
      onSubmit={event => { event.preventDefault(); if (latex.trim()) finish(true, true) }}
      onKeyDown={event => {
        if (event.nativeEvent.isComposing || event.keyCode === 229) {
          if (event.key === 'Enter') event.preventDefault()
          return
        }
        if (event.key === 'Escape') {
          event.preventDefault()
          event.stopPropagation()
          finish(false, true)
        }
      }}>
      <input ref={input} aria-label="LaTeX 源码" value={latex} onChange={event => setLatex(event.target.value)} />
      <button type="submit" disabled={!latex.trim()}>保存</button>
      <button type="button" onClick={() => finish(false, true)}>取消</button>
    </form>, anchor.ownerDocument.body,
  )
}

function editingFormula(editor: Editor | null) {
  const state = editor?.state
  return state && inlineMathEditKey.getState(state) != null ? state : null
}

export function InlineMathOverlay({ editor }: { editor: Editor }) {
  const state = useEditorSelector(editor, editingFormula)
  if (!state) return null
  const pos = inlineMathEditKey.getState(state)
  if (pos == null) return null
  const node = state.doc.nodeAt(pos)
  const anchor = editor.view.nodeDOM(pos)
  return node?.type.name === 'inlineMath' && anchor instanceof HTMLElement
    ? <FormulaEditor key={pos} editor={editor} anchor={anchor} initial={String(node.attrs.latex)} pos={pos} />
    : null
}
