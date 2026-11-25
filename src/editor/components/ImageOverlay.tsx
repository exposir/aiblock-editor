import type { Editor } from '@tiptap/core'
import { NodeSelection, Selection } from '@tiptap/pm/state'
import { AlignCenter, AlignLeft, AlignRight, Copy, Download, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { withImageSource } from '../extensions/image-assets'
import { imageAttributes } from '../extensions/image-attributes'
import type { ImageAttributes } from '../extensions/image-attributes'
import { downloadBlob } from '../markdown/markdown-files'
import { positionOfBlockId } from './block-geometry'
import { useEditorSelector, useOverlayRect } from './editor-ui'
import { observeViewport } from './viewport'

async function png(blob: Blob): Promise<Blob> {
  if (blob.type === 'image/png') return blob
  const image = await createImageBitmap(blob)
  try {
    const canvas = document.createElement('canvas')
    canvas.width = image.width
    canvas.height = image.height
    canvas.getContext('2d')?.drawImage(image, 0, 0)
    return await new Promise((resolve, reject) => canvas.toBlob(value =>
      value ? resolve(value) : reject(new Error('Unable to encode image')), 'image/png'))
  } finally {
    image.close()
  }
}

async function getImage(url: string) {
  const response = await fetch(url, { credentials: 'omit' })
  if (!response.ok) throw new Error('Image unavailable')
  return response.blob()
}

export function ImageOverlay({ editor, host }: { editor: Editor; host: HTMLElement }) {
  const root = editor.view.dom
  const tools = useRef<HTMLDivElement>(null)
  const [hover, setHover] = useState<string | null>(null)
  const [focused, setFocused] = useState<string | null>(null)
  const [near, setNear] = useState<HTMLElement | null>(null)
  const [notice, setNotice] = useState('')
  const id = useEditorSelector(editor, current => {
    const selection = current?.state.selection
    return selection instanceof NodeSelection && selection.node.type.name === 'imageBlock'
      ? selection.node.attrs.blockId as string | null : null
  })
  const target = focused ?? hover ?? id
  const match = useEditorSelector(editor, current => {
    if (!current || !target) return null
    const { selection, doc } = current.state
    const pos = selection instanceof NodeSelection && selection.node.attrs.blockId === target
      ? selection.from : positionOfBlockId(doc, target)
    const node = pos === null ? null : doc.nodeAt(pos)
    return node?.type.name === 'imageBlock' && pos !== null ? { node, anchor: current.view.nodeDOM(pos) } : null
  }, (a, b) => a?.node === b?.node && a?.anchor === b?.anchor)
  const image = match?.node
  const anchor = match?.anchor instanceof HTMLElement ? match.anchor : null
  const rect = useOverlayRect(near === anchor || focused === target ? anchor : null, host, root)

  useEffect(() => {
    if (!anchor) return
    return observeViewport(anchor, 300, visible => setNear(visible ? anchor : null))
  }, [anchor])

  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout> | undefined
    function move(event: Event) {
      const target = event.target
      if (!(target instanceof Element)) return
      clearTimeout(timeout)
      if (tools.current?.contains(target)) return
      const block = target.closest<HTMLElement>('[data-image-block]')
      if (block && root.contains(block)) setHover(block.dataset.blockId ?? null)
      else if (!tools.current?.contains(root.ownerDocument.activeElement)) timeout = setTimeout(() => setHover(null), 160)
    }
    const owner = root.ownerDocument
    owner.addEventListener('pointerover', move, { passive: true })
    return () => {
      clearTimeout(timeout)
      owner.removeEventListener('pointerover', move)
    }
  }, [root])

  useEffect(() => { setNotice('') }, [target])

  if (!image || !target || !rect?.width || !rect.height || !editor.isEditable) return null
  const attrs = imageAttributes(image.attrs)
  function edit(patch: Partial<ImageAttributes> | null) {
    const { doc, tr } = editor.state
    const pos = positionOfBlockId(doc, target!)
    if (pos === null || doc.nodeAt(pos)?.type.name !== 'imageBlock') return
    if (patch) {
      for (const [name, value] of Object.entries(patch)) tr.setNodeAttribute(pos, name, value)
    } else {
      tr.deleteRange(pos, pos + doc.nodeAt(pos)!.nodeSize)
      tr.setSelection(Selection.near(tr.doc.resolve(Math.min(pos, tr.doc.content.size))))
      setHover(null)
      setFocused(null)
    }
    editor.view.dispatch(tr)
  }

  async function copy() {
    setNotice('')
    try {
      await withImageSource(attrs, async url => {
        if (typeof ClipboardItem !== 'undefined' && navigator.clipboard.write) {
          try {
            await navigator.clipboard.write([new ClipboardItem({ 'image/png': getImage(url).then(png) })])
            return
          } catch (error) {
            if (!attrs.src) throw error
          }
        }
        if (!attrs.src) throw new Error('Clipboard unavailable')
        await navigator.clipboard.writeText(attrs.src)
      })
      setNotice('已复制')
    } catch { setNotice('复制图片失败') }
  }

  async function download() {
    try {
      await withImageSource(attrs, async url => {
        const bytes = await getImage(url)
        const suffix = bytes.type.split('/')[1]?.replace('jpeg', 'jpg') || 'png'
        const name = attrs.alt.trim().replace(/[\\/:*?"<>|]/g, '_') || '图片'
        downloadBlob(bytes, name.endsWith(`.${suffix}`) ? name : `${name}.${suffix}`)
      })
    } catch { setNotice('下载图片失败') }
  }

  return createPortal(
    <div ref={tools} className="image-controls" data-editor-overlay="" role="group" aria-label="图片工具"
      onFocus={() => setFocused(target)}
      onBlur={event => {
        if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) setFocused(null)
      }}
      style={{ left: rect.left, top: rect.top + 4 }}>
      {([
        ['left', '左对齐', AlignLeft], ['center', '居中', AlignCenter], ['right', '右对齐', AlignRight],
      ] as const).map(([align, label, Icon]) =>
        <button key={align} type="button" aria-label={label} title={label} aria-pressed={attrs.align === align}
          onMouseDown={event => event.preventDefault()} onClick={() => edit({ align })}><Icon size={15} aria-hidden="true" /></button>)}
      <select aria-label="图片显示宽度" value={attrs.displayWidth ?? 0}
        onChange={event => edit({ displayWidth: Number(event.target.value) || null })}>
        <option value={0}>原始尺寸</option>
        {[...new Set([240, 360, 480, 720, ...(attrs.displayWidth ? [attrs.displayWidth] : [])])].sort((a, b) => a - b)
          .map(width => <option key={width} value={width}>{width} px</option>)}
      </select>
      <input key={target} defaultValue={attrs.alt} aria-label="图片替代文本" placeholder="替代文本"
        onBlur={event => { if (event.currentTarget.value !== attrs.alt) edit({ alt: event.currentTarget.value.slice(0, 4096) }) }}
        onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) event.currentTarget.blur() }} />
      <button type="button" aria-label="复制图片" onClick={() => void copy()}><Copy size={15} aria-hidden="true" /></button>
      <button type="button" aria-label="下载图片" onClick={() => void download()}><Download size={15} aria-hidden="true" /></button>
      <button type="button" aria-label="删除图片" onClick={() => edit(null)}><Trash2 size={15} aria-hidden="true" /></button>
      {notice && <span role="status">{notice}</span>}
    </div>,
    host,
  )
}
