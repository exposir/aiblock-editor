import type { Editor } from '@tiptap/core'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { TextSelection } from '@tiptap/pm/state'
import { Copy, Download, WrapText } from 'lucide-react'
import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { saveDocumentFile, suggestedFileName } from '../../desktop/bridge'
import { CODE_LANGUAGES, codeLanguage, isPreviewLanguage, viewModeFor } from '../extensions/code-languages'
import type { CodeLanguage, CodeViewMode } from '../extensions/code-languages'
import { createNodeIndex } from '../extensions/document-changes'
import { downloadBlob } from '../markdown/markdown-files'
import { isDark } from '../preview/code-preview'
import { diagramTemplates, renderMermaid } from '../preview/mermaid'
import { positionOfBlockId } from './block-geometry'
import { useEditorSelector, useOverlayRect } from './editor-ui'
import type { OverlayRect } from './overlay-geometry'
import { nearbyOverlayRect } from './overlay-layout'
import { observeViewport } from './viewport'

const names: Record<CodeLanguage, string> = {
  plaintext: '纯文本', typescript: 'TypeScript', javascript: 'JavaScript', python: 'Python',
  rust: 'Rust', go: 'Go', sql: 'SQL', json: 'JSON', bash: 'Bash', css: 'CSS', html: 'HTML', markdown: 'Markdown',
  mermaid: 'Mermaid', math: 'LaTeX',
}

const views: readonly [CodeViewMode, string][] = [
  ['preview', '预览'], ['split', '分栏'], ['code', '源码'],
]

function CodeControls({ editor, host, node, pos, anchor, onFocus, initial }: {
  editor: Editor
  host: HTMLElement
  node: ProseMirrorNode
  pos: number
  anchor: HTMLElement | null
  onFocus: (anchor: HTMLElement | null) => void
  initial?: OverlayRect
}) {
  const [exportError, setExportError] = useState('')
  const language = codeLanguage(node.attrs.language)
  const previewLanguage = isPreviewLanguage(language)
  const mode = viewModeFor(language, node.attrs.viewMode)
  const [copy, setCopy] = useState<'idle' | 'copied' | 'error'>('idle')
  const copyRequest = useRef(0)
  const feedbackTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const text = node.textContent
  const rect = useOverlayRect(anchor, host, editor.view.dom, initial)
  const wrap = node.attrs.wrap === true
  const visible = rect && rect.width > 0 && rect.height > 0 && !anchor?.closest('[inert]')

  function currentPosition() {
    const id: unknown = node.attrs.blockId
    return typeof id === 'string' ? positionOfBlockId(editor.state.doc, id) : pos
  }

  useLayoutEffect(() => {
    setCopy('idle')
    setExportError('')
    return () => {
      copyRequest.current++
      clearTimeout(feedbackTimer.current)
    }
  }, [language, text])

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
    const pos = currentPosition()
    if (pos === null) return
    const { doc, selection } = editor.state
    if (pos >= doc.content.size) return
    const current = doc.nodeAt(pos)
    if (current?.type.name !== 'codeBlock' || current.attrs.blockId !== node.attrs.blockId) return
    const from = pos + 1
    const to = from + current.content.size
    const next = codeLanguage(value)
    const chain = editor.chain().updateCodeBlock(pos, { language: next })
    if (isPreviewLanguage(next)) {
      chain.run()
      return
    }
    if (!(selection instanceof TextSelection) || selection.from < from || selection.to > to) {
      chain.setTextSelection(from)
    }
    if (chain.run()) editor.view.focus()
  }

  function applyTemplate(id: string) {
    const pos = currentPosition()
    if (pos === null) return
    const template = diagramTemplates.find(item => item.id === id)
    const current = editor.state.doc.nodeAt(pos)
    if (!template || current?.type.name !== 'codeBlock' || codeLanguage(current.attrs.language) !== 'mermaid') return
    editor.view.dispatch(editor.state.tr.insertText(template.source, pos + 1, pos + current.nodeSize - 1))
  }

  function changeView(attributes: { viewMode?: CodeViewMode; wrap?: boolean }) {
    const pos = currentPosition()
    if (pos !== null) editor.commands.updateCodeBlock(pos, attributes)
  }

  async function exportDiagram() {
    if (!anchor) return
    setExportError('')
    const result = await renderMermaid(text, isDark(anchor.ownerDocument))
    if (!result) {
      setExportError('无法导出，请检查图表源码。')
      return
    }
    try {
      await saveDocumentFile({ name: 'Mermaid 图表', format: 'svg', contents: result.svg }, file => {
        downloadBlob(new Blob([file.contents], { type: 'image/svg+xml;charset=utf-8' }), suggestedFileName(file.name, file.format))
      })
    } catch {
      setExportError('无法保存 SVG 文件。')
    }
  }

  const copyLabel = previewLanguage ? '复制源码' : '复制代码'
  return (
    <div onFocus={() => onFocus(anchor)} onBlur={event => {
      if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) onFocus(null)
    }} className="code-control-strip" data-code-anchor={node.attrs.blockId} data-preview-tools={previewLanguage || undefined} data-editor-overlay="" role="group" aria-label="代码块工具"
      style={rect ? { left: rect.left + 1, top: rect.top + 1, width: Math.max(0, rect.width - 2),
        visibility: visible ? 'visible' : 'hidden' } : undefined}>
      <select aria-label="代码语言" value={language}
        onChange={event => changeLanguage(event.target.value)}>
        {CODE_LANGUAGES.map(language => <option key={language} value={language}>{names[language]}</option>)}
      </select>
      {previewLanguage && <div className="code-view-modes" role="group" aria-label="代码块视图">
        {views.map(([value, label]) => <button type="button" key={value} aria-pressed={mode === value}
          onClick={() => changeView({ viewMode: value })}>{label}</button>)}
      </div>}
      {language === 'mermaid' && <select aria-label="图种模板" title="套用图种模板，可撤销" value=""
        onChange={event => applyTemplate(event.target.value)}>
        <option value="" disabled>图种模板</option>
        {diagramTemplates.map(template => <option key={template.id} value={template.id}>{template.label}</option>)}
      </select>}
      {mode !== 'preview' && <button type="button" aria-label="自动换行" title="自动换行" aria-pressed={wrap}
        onMouseDown={event => event.preventDefault()}
        onClick={() => changeView({ wrap: !wrap })}>
        <WrapText size={15} aria-hidden="true" />
      </button>}
      <button type="button" aria-label={copyLabel} title={copyLabel} onClick={() => void copyCode()}>
        <Copy size={14} aria-hidden="true" />
      </button>
      {language === 'mermaid' && <button type="button" aria-label="导出 SVG" title="导出 SVG" onClick={() => void exportDiagram()}>
        <Download size={15} aria-hidden="true" />
      </button>}
      {exportError && <span role="status" className="code-preview-error">{exportError}</span>}
      {copy !== 'idle' && <span role="status">{copy === 'copied' ? '已复制' : '复制失败'}</span>}
    </div>
  )
}

const codeNodes = createNodeIndex(node => node.type.name === 'codeBlock')
type Control = { node: ProseMirrorNode; pos: number; anchor: HTMLElement | null }

function createCodeControlsSelector() {
  let previousDoc: ProseMirrorNode | undefined
  let controls: Control[] = []
  return (editor: Editor | null) => {
    if (!editor) return []
    const doc = editor.state.doc
    if (previousDoc !== doc) {
      previousDoc = doc
      controls = codeNodes(doc).map(({ node, pos }) => {
        const element = editor.view.nodeDOM(pos)
        return { node, pos, anchor: element instanceof HTMLElement ? element : null }
      })
    }
    return controls
  }
}

function sameControls(a: Control[], b: Control[]) {
  return a.length === b.length && a.every(({ node, pos, anchor }, i) => {
    const next = b[i]
    return next?.node === node && next.anchor === anchor && (node.attrs.blockId || pos === next.pos)
  })
}

export function CodeBlockOverlay({ editor, host }: { editor: Editor; host: HTMLElement }) {
  const selectControls = useMemo(createCodeControlsSelector, [editor])
  const blocks = useEditorSelector(editor, selectControls, sameControls)
  const [focused, setFocused] = useState<HTMLElement | null>(null)
  const [visible, setVisible] = useState<ReadonlyMap<HTMLElement, OverlayRect | undefined>>(new Map())
  const observers = useRef(new Map<HTMLElement, () => void>())
  const selected = useEditorSelector(editor, current => {
    if (!current) return null
    const { selection } = current.state
    const { $head } = selection
    for (let depth = $head.depth; depth > 0; depth--) {
      if ($head.node(depth).type.name === 'codeBlock') return current.view.nodeDOM($head.before(depth))
    }
    return selection.$from.nodeAfter?.type.name === 'codeBlock' ? current.view.nodeDOM(selection.from) : null
  })

  useLayoutEffect(() => {
    const anchors = new Set(blocks.flatMap(({ anchor }) => anchor ? [anchor] : []))
    for (const [element, stop] of observers.current) {
      if (anchors.has(element)) continue
      stop()
      observers.current.delete(element)
    }
    setVisible(previous => {
      const next = [...previous].filter(([element]) => anchors.has(element))
      return next.length === previous.size ? previous : new Map(next)
    })
    for (const element of anchors) {
      if (observers.current.has(element)) continue
      observers.current.set(element, observeViewport(element, 300, (near, bounds) => {
        const rect = near && bounds ? nearbyOverlayRect(host, bounds) : undefined
        setVisible(previous => {
          if (previous.has(element) === near) return previous
          const next = new Map(previous)
          if (near) next.set(element, rect)
          else next.delete(element)
          return next
        })
      }))
    }
  }, [blocks, host])

  useLayoutEffect(() => () => {
    for (const stop of observers.current.values()) stop()
    observers.current.clear()
  }, [])

  return createPortal(blocks.flatMap(({ node, pos, anchor }) => {
    if (!anchor || !visible.has(anchor) && anchor !== selected && anchor !== focused) return []
    return [<CodeControls key={node.attrs.blockId ?? pos} node={node} pos={pos} anchor={anchor}
      host={host} editor={editor} onFocus={setFocused} initial={visible.get(anchor)} />]
  }), host)
}
