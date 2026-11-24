import type { Editor } from '@tiptap/core'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { TextSelection } from '@tiptap/pm/state'
import { Copy, WrapText } from 'lucide-react'
import { useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { CODE_LANGUAGES, codeLanguage } from '../extensions/code-block'
import type { CodeLanguage } from '../extensions/code-block'
import { useEditorDocument, useOverlayRect } from './editor-ui'

const names: Record<CodeLanguage, string> = {
  plaintext: '纯文本', typescript: 'TypeScript', javascript: 'JavaScript', python: 'Python',
  rust: 'Rust', go: 'Go', sql: 'SQL', json: 'JSON', bash: 'Bash', css: 'CSS', html: 'HTML', markdown: 'Markdown',
}

function CodeControls({ editor, host, node, pos }: {
  editor: Editor
  host: HTMLElement
  node: ProseMirrorNode
  pos: number
}) {
  const [copy, setCopy] = useState<'idle' | 'copied' | 'error'>('idle')
  const copyRequest = useRef(0)
  const feedbackTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const text = node.textContent
  const source = editor.view.nodeDOM(pos)
  const anchor = source instanceof HTMLElement ? source : null
  const rect = useOverlayRect(anchor, host, editor.view.dom)
  const wrap = node.attrs.wrap === true
  const visible = rect && rect.width > 0 && rect.height > 0 && !anchor?.closest('[inert]')

  useLayoutEffect(() => {
    setCopy('idle')
    return () => {
      copyRequest.current++
      clearTimeout(feedbackTimer.current)
    }
  }, [text])

  async function copyCode() {
    const request = ++copyRequest.current
    clearTimeout(feedbackTimer.current)
    setCopy('idle')
    const clipboard = anchor?.ownerDocument.defaultView?.navigator.clipboard
    let result: 'copied' | 'error' = 'error'
    try {
      if (clipboard) {
        await clipboard.writeText(text)
        result = 'copied'
      }
    } catch {
      result = 'error'
    }
    if (request !== copyRequest.current) return
    setCopy(result)
    feedbackTimer.current = setTimeout(() => setCopy('idle'), 1500)
  }

  function changeLanguage(value: string) {
    const { doc, selection } = editor.state
    if (pos >= doc.content.size) return
    const current = doc.nodeAt(pos)
    if (current?.type.name !== 'codeBlock' || current.attrs.blockId !== node.attrs.blockId) return
    const from = pos + 1
    const to = from + current.content.size
    const chain = editor.chain().updateCodeBlock(pos, { language: codeLanguage(value) })
    if (!(selection instanceof TextSelection) || selection.from < from || selection.to > to) {
      chain.setTextSelection(from)
    }
    if (chain.run()) editor.view.focus()
  }

  return (
    <div className="code-control-strip" data-editor-overlay="" role="group" aria-label="代码块工具"
      style={rect ? { left: rect.left + 1, top: rect.top + 1, width: Math.max(0, rect.width - 2),
        visibility: visible ? 'visible' : 'hidden' } : undefined}>
      <select aria-label="代码语言" value={codeLanguage(node.attrs.language)}
        onChange={event => changeLanguage(event.target.value)}>
        {CODE_LANGUAGES.map(language => <option key={language} value={language}>{names[language]}</option>)}
      </select>
      <button type="button" aria-label="自动换行" title="自动换行" aria-pressed={wrap}
        onMouseDown={event => event.preventDefault()}
        onClick={() => editor.commands.updateCodeBlock(pos, { wrap: !wrap })}>
        <WrapText size={15} aria-hidden="true" />
      </button>
      <button type="button" aria-label="复制代码" title="复制代码" onClick={() => void copyCode()}>
        <Copy size={14} aria-hidden="true" />
      </button>
      {copy !== 'idle' && <span role="status">{copy === 'copied' ? '已复制' : '复制失败'}</span>}
    </div>
  )
}

export function CodeBlockOverlay({ editor, host }: { editor: Editor; host: HTMLElement }) {
  const doc = useEditorDocument(editor)
  const blocks: { node: ProseMirrorNode; pos: number }[] = []
  doc?.descendants((node, pos) => {
    if (node.type.name === 'codeBlock') blocks.push({ node, pos })
  })
  return createPortal(blocks.map(({ node, pos }) =>
    <CodeControls key={node.attrs.blockId ?? pos} node={node} pos={pos} host={host} editor={editor} />), host)
}
