import { autoUpdate, computePosition, flip, offset, shift, size } from '@floating-ui/dom'
import type { Editor } from '@tiptap/core'
import { Copy, Link2, Trash2 } from 'lucide-react'
import { useLayoutEffect, useRef, useState } from 'react'
import { MultiBlockSelection } from '../extensions/multi-block-selection'
import { BLOCK_BACKGROUNDS } from '../types'
import type { BlockBackground, BlockConversion } from '../types'
import { overlayTop } from './editor-ui'

const conversions: readonly { label: string; target: BlockConversion }[] = [
  { label: '段落', target: { type: 'paragraph' } },
  { label: '一级标题', target: { type: 'heading', level: 1 } },
  { label: '二级标题', target: { type: 'heading', level: 2 } },
  { label: '三级标题', target: { type: 'heading', level: 3 } },
  { label: '无序列表', target: { type: 'bulletList' } },
  { label: '有序列表', target: { type: 'orderedList' } },
  { label: '待办列表', target: { type: 'taskList' } },
  { label: '引用', target: { type: 'blockquote' } },
  { label: '高亮块', target: { type: 'callout' } },
  { label: '折叠块', target: { type: 'toggle' } },
  { label: '代码块', target: { type: 'codeBlock' } },
]

const backgroundNames: Record<BlockBackground, string> = {
  default: '默认背景', gray: '灰色背景', blue: '蓝色背景', green: '绿色背景',
  yellow: '黄色背景', red: '红色背景', purple: '紫色背景',
}

interface BlockActionMenuProps {
  readonly editor: Editor
  readonly anchor: HTMLButtonElement
  readonly id: string
  readonly blockHash: (blockId: string) => string
  readonly onClose: (focus: 'editor' | 'handle') => void
}

export function BlockActionMenu({ editor, anchor, id, blockHash, onClose }: BlockActionMenuProps) {
  const panel = useRef<HTMLDivElement>(null)
  const [copyError, setCopyError] = useState(false)
  const { selection } = editor.state
  const blocks = selection instanceof MultiBlockSelection ? selection.blockRange.blocks : []
  const can = editor.can()

  useLayoutEffect(() => {
    const menu = panel.current
    if (!menu) return
    let focused = false
    const header = menu.ownerDocument.querySelector<HTMLElement>('[data-editor-sticky-header]')
    const stop = autoUpdate(anchor, menu, () => {
      const padding = { top: overlayTop(header), right: 8, bottom: 8, left: 8 }
      void computePosition(anchor, menu, {
        strategy: 'fixed',
        placement: 'right-start',
        middleware: [
          offset(8),
          flip({ padding }),
          shift({ padding }),
          size({ padding, apply: ({ availableHeight }) => { menu.style.maxHeight = `${availableHeight}px` } }),
        ],
      }).then(({ x, y }) => {
        if (!menu.isConnected) return
        menu.style.left = `${x}px`
        menu.style.top = `${y}px`
        menu.style.visibility = 'visible'
        if (!focused) {
          menu.focus({ preventScroll: true })
          focused = true
        }
      })
    })
    return stop
  }, [anchor])

  function run(command: () => boolean) {
    if (command()) onClose('editor')
  }

  async function copyLinks() {
    const win = anchor.ownerDocument.defaultView
    const ids = blocks.map(block => block.attrs.blockId).filter((id): id is string => typeof id === 'string')
    if (!win || !ids.length) return
    try {
      const links = ids.map(id => {
        const url = new URL(win.location.href)
        url.hash = blockHash(id)
        return url.href
      })
      await win.navigator.clipboard.writeText(links.join('\n'))
      if (panel.current) onClose('editor')
    } catch {
      setCopyError(true)
    }
  }

  return (
    <div
      id={id}
      ref={panel}
      className="block-action-menu"
      role="dialog"
      aria-label="块操作"
      tabIndex={-1}
      onKeyDown={event => {
        if (event.key !== 'Escape') return
        event.preventDefault()
        onClose('handle')
      }}
    >
      <section aria-label="转换为">
        <h2>转换为</h2>
        <div className="block-conversions">
          {conversions.map(({ label, target }) => (
            <button key={label} type="button" disabled={!can.convertSelectedBlocks(target)}
              onClick={() => run(() => editor.commands.convertSelectedBlocks(target))}>
              {label}
            </button>
          ))}
        </div>
      </section>
      <section aria-label="块背景">
        <h2>块背景</h2>
        <div className="block-color-options">
          {BLOCK_BACKGROUNDS.map(bg => (
            <button key={bg} type="button" title={backgroundNames[bg]}
              aria-label={backgroundNames[bg]} aria-pressed={blocks.length > 0 && blocks.every(block => block.attrs.blockBg === bg)}
              data-block-bg={bg} onClick={() => run(() => editor.commands.setSelectedBlocksBg(bg))} />
          ))}
        </div>
      </section>
      <div className="block-menu-actions">
        <button type="button" disabled={!can.duplicateSelectedBlocks()}
          onClick={() => run(() => editor.commands.duplicateSelectedBlocks())}>
          <Copy size={15} aria-hidden="true" /> 复制副本
        </button>
        <button type="button" disabled={!blocks.length} onClick={() => void copyLinks()}>
          <Link2 size={15} aria-hidden="true" /> 复制块链接
        </button>
        <button type="button" className="block-delete" disabled={!can.deleteSelectedBlocks()}
          onClick={() => run(() => editor.commands.deleteSelectedBlocks())}>
          <Trash2 size={15} aria-hidden="true" /> 删除
        </button>
      </div>
      {copyError && <p role="status">剪贴板不可用，未能复制链接。</p>}
    </div>
  )
}
