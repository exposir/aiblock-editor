import { posToDOMRect } from '@tiptap/core'
import type { Editor } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'
import { Bold, Code, Highlighter, Italic, Link2, MessageSquarePlus, Strikethrough, Underline } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useAnchoredPosition, useEditorSnapshot } from './editor-ui'

const marks = [
  ['bold', '加粗', Bold], ['italic', '斜体', Italic], ['underline', '下划线', Underline],
  ['strike', '删除线', Strikethrough], ['code', '行内代码', Code],
] as const

const ink = [
  ['墨黑', '#263043'], ['灰色', '#64748b'], ['蓝色', '#2459cc'], ['绿色', '#16734a'], ['红色', '#b73343'], ['紫色', '#713db6'],
] as const
const highlighters = [
  ['黄色', '#fff0a6'], ['蓝色', '#cfe1ff'], ['绿色', '#ccefd7'], ['粉色', '#f9d8e1'], ['紫色', '#e9dcfa'],
] as const

function formatBlock(editor: Editor, value: string) {
  const chain = editor.chain().focus()
  switch (value) {
    case 'h1': return chain.setHeading({ level: 1 }).run()
    case 'h2': return chain.setHeading({ level: 2 }).run()
    case 'h3': return chain.setHeading({ level: 3 }).run()
    case 'quote': return (editor.isActive('blockquote') ? chain : chain.setBlockquote()).run()
    default: return chain.setParagraph().run()
  }
}

function BubbleActions({ editor, onComment }: { editor: Editor; onComment: () => void }) {
  const [panel, setPanel] = useState<'ink' | 'highlight' | 'link' | null>(null)
  const [href, setHref] = useState('')
  const [linkError, setLinkError] = useState(false)
  const level: unknown = editor.getAttributes('heading').level
  const format = editor.isActive('heading') && typeof level === 'number' && level <= 3
    ? `h${level}` : editor.isActive('blockquote') ? 'quote' : 'paragraph'

  function show(next: typeof panel) {
    if (next === 'link') {
      setHref(editor.getAttributes('link').href ?? '')
      setLinkError(false)
    }
    setPanel(panel === next ? null : next)
  }

  return (
    <div onKeyDown={event => {
      if (event.key !== 'Escape' || !panel) return
      if (event.nativeEvent.isComposing || event.keyCode === 229) return
      event.preventDefault()
      setPanel(null)
      editor.view.focus()
    }}>
      <div className="bubble-actions" role="group" aria-label="选区格式"
        onMouseDown={event => {
          if (event.target instanceof Element && event.target.closest('button')) event.preventDefault()
        }}>
        <select aria-label="块类型" value={format} onChange={event => formatBlock(editor, event.target.value)}>
          <option value="paragraph">正文</option>
          <option value="h1">一级标题</option><option value="h2">二级标题</option><option value="h3">三级标题</option>
          <option value="quote">引用</option>
        </select>
        {marks.map(([name, label, Icon]) => (
          <button key={name} type="button" aria-label={label} title={label} aria-pressed={editor.isActive(name)}
            onClick={() => editor.chain().focus().toggleMark(name).run()}><Icon size={15} aria-hidden="true" /></button>
        ))}
        <button type="button" aria-label="文字色" title="文字色" aria-expanded={panel === 'ink'} onClick={() => show('ink')}>
          <span aria-hidden="true" className="ink-icon">A</span>
        </button>
        <button type="button" aria-label="高亮色" title="高亮色" aria-expanded={panel === 'highlight'}
          onClick={() => show('highlight')}><Highlighter size={15} aria-hidden="true" /></button>
        <button type="button" aria-label="编辑链接" title="编辑链接" aria-expanded={panel === 'link'}
          onClick={() => show('link')}><Link2 size={15} aria-hidden="true" /></button>
        <button type="button" className="bubble-comment" onClick={onComment}>
          <MessageSquarePlus size={15} aria-hidden="true" /> 评论
        </button>
      </div>
      {(panel === 'ink' || panel === 'highlight') && (
        <div className="bubble-palette" role="group" aria-label={panel === 'ink' ? '文字色色板' : '高亮色色板'}
          onMouseDown={event => event.preventDefault()}>
          {(panel === 'ink' ? ink : highlighters).map(([label, color]) => (
            <button key={color} type="button" aria-label={label} title={label} style={{ backgroundColor: color }}
              onClick={() => {
                const chain = editor.chain().focus()
                if (panel === 'ink') chain.setColor(color).run()
                else chain.setHighlight({ color }).run()
                setPanel(null)
              }} />
          ))}
          <button className="palette-clear" type="button" onClick={() => {
            const chain = editor.chain().focus()
            if (panel === 'ink') chain.unsetColor().run()
            else chain.unsetHighlight().run()
            setPanel(null)
          }}>清除</button>
        </div>
      )}
      {panel === 'link' && <form className="bubble-link"
        onMouseDown={event => {
          if (event.target instanceof Element && event.target.closest('button')) event.preventDefault()
        }}
        onSubmit={event => {
          event.preventDefault()
          if (href.trim() && editor.commands.setLink({ href: href.trim() })) {
            editor.view.focus()
            setPanel(null)
          } else setLinkError(true)
        }}>
        <input aria-label="链接地址" placeholder="https://…" value={href} autoFocus
          onChange={event => { setHref(event.target.value); setLinkError(false) }} />
        <button type="submit">应用</button>
        <button type="button" onClick={() => {
          editor.commands.unsetLink()
          editor.view.focus()
          setPanel(null)
        }}>移除</button>
        {linkError && <span role="status">请输入有效链接</span>}
      </form>}
    </div>
  )
}

export function BubbleToolbar({ editor, onComment }: { editor: Editor; onComment: () => void }) {
  const { selection, doc } = useEditorSnapshot(editor)
  const layer = useRef<HTMLDivElement>(null)
  const [focused, setFocused] = useState(false)
  const { from, to } = selection
  let hasCode = false
  if (selection instanceof TextSelection && !selection.empty) {
    doc.nodesBetween(from, to, node => {
      if (node.type.spec.code) hasCode = true
      return !hasCode
    })
  }
  const visible = editor.isEditable && focused && selection instanceof TextSelection && from < to && !hasCode
  const anchor = useMemo(() => visible ? {
    contextElement: editor.view.dom,
    getBoundingClientRect: () => posToDOMRect(editor.view, from, to),
  } : null, [editor, from, to, visible])
  useAnchoredPosition(layer, anchor, 'top')

  useEffect(() => {
    const dom = editor.view.dom
    const owner = dom.ownerDocument
    let alive = true
    const check = () => {
      if (alive) setFocused(dom.contains(owner.activeElement) || !!layer.current?.contains(owner.activeElement))
    }
    const afterBlur = () => queueMicrotask(check)
    check()
    owner.addEventListener('focusin', check)
    owner.addEventListener('focusout', afterBlur)
    return () => {
      alive = false
      owner.removeEventListener('focusin', check)
      owner.removeEventListener('focusout', afterBlur)
    }
  }, [editor])

  return visible ? createPortal(
    <div ref={layer} className="overlay-card bubble-toolbar" data-editor-overlay="">
      <BubbleActions key={`${from}:${to}`} editor={editor} onComment={onComment} />
    </div>, editor.view.dom.ownerDocument.body,
  ) : null
}
