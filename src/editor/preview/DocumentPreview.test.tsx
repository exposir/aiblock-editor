import type { JSONContent } from '@tiptap/core'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { DocumentPreview } from './DocumentPreview'

const codePreview = vi.hoisted(() => ({
  attach: vi.fn(() => ({ update: vi.fn(), destroy: vi.fn() })),
}))
const math = vi.hoisted(() => ({
  renderMath: vi.fn(async (latex: string) => `<span data-math="${latex}">${latex}</span>`),
}))

vi.mock('./code-preview', () => ({ attachCodePreview: codePreview.attach }))
vi.mock('./math', () => ({ renderMath: math.renderMath }))

const content: JSONContent = {
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 2, blockId: 'intro', blockBg: 'yellow' }, content: [{ type: 'text', text: '预览标题' }] },
    {
      type: 'paragraph',
      attrs: { blockId: 'marks' },
      content: [
        { type: 'text', text: '粗体', marks: [{ type: 'bold' }] },
        { type: 'text', text: '斜体', marks: [{ type: 'italic' }] },
        { type: 'text', text: '下划线', marks: [{ type: 'underline' }] },
        { type: 'text', text: '删除', marks: [{ type: 'strike' }] },
        { type: 'text', text: '行内代码', marks: [{ type: 'code' }] },
        { type: 'text', text: '颜色', marks: [{ type: 'textStyle', attrs: { color: '#16734a' } }] },
        { type: 'text', text: '高亮', marks: [{ type: 'highlight', attrs: { color: '#fff0a6' } }] },
        { type: 'text', text: '评论', marks: [{ type: 'comment', attrs: { commentId: 'thread-1' } }] },
        { type: 'text', text: '安全链接', marks: [{ type: 'link', attrs: { href: 'https://example.com/docs' } }] },
        { type: 'text', text: '危险链接', marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }] },
        { type: 'hardBreak' },
        { type: 'inlineMath', attrs: { latex: 'x^2' } },
      ],
    },
    { type: 'blockquote', attrs: { blockId: 'quote' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: '引用' }] }] },
    {
      type: 'bulletList',
      content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: '项目' }] }] }],
    },
    {
      type: 'orderedList',
      attrs: { start: 3 },
      content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: '第三项' }] }] }],
    },
    {
      type: 'taskList',
      content: [{ type: 'taskItem', attrs: { checked: true }, content: [{ type: 'paragraph', content: [{ type: 'text', text: '完成事项' }] }] }],
    },
    { type: 'horizontalRule' },
    {
      type: 'table',
      attrs: { blockId: 'table' },
      content: [
        {
          type: 'tableRow',
          content: [
            { type: 'tableHeader', attrs: { colspan: 2, rowspan: 1, colwidth: [120, 180] }, content: [{ type: 'paragraph', content: [{ type: 'text', text: '表头' }] }] },
          ],
        },
        {
          type: 'tableRow',
          content: [
            { type: 'tableCell', attrs: { colspan: 1, rowspan: 1 }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'A' }] }] },
            { type: 'tableCell', attrs: { colspan: 1, rowspan: 1 }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'B' }] }] },
          ],
        },
      ],
    },
    {
      type: 'callout',
      attrs: { theme: 'green', icon: '📌', blockId: 'callout' },
      content: [{ type: 'paragraph', content: [{ type: 'text', text: '提示内容' }] }],
    },
    {
      type: 'toggle',
      attrs: { open: false, blockId: 'toggle' },
      content: [
        { type: 'toggleSummary', content: [{ type: 'text', text: '折叠标题' }] },
        { type: 'toggleContent', content: [{ type: 'paragraph', content: [{ type: 'text', text: '折叠正文' }] }] },
      ],
    },
    {
      type: 'columnList',
      content: [
        { type: 'column', attrs: { width: 35 }, content: [{ type: 'paragraph', content: [{ type: 'text', text: '左栏' }] }] },
        { type: 'column', attrs: { width: 65 }, content: [{ type: 'paragraph', content: [{ type: 'text', text: '右栏' }] }] },
      ],
    },
    {
      type: 'codeBlock',
      attrs: { language: 'typescript', blockId: 'code' },
      content: [{ type: 'text', text: 'const answer = 42' }],
    },
    {
      type: 'codeBlock',
      attrs: { language: 'mermaid', blockId: 'diagram' },
      content: [{ type: 'text', text: 'flowchart LR\nA-->B' }],
    },
    {
      type: 'codeBlock',
      attrs: { language: 'math', blockId: 'formula' },
      content: [{ type: 'text', text: '\\sum_{i=1}^n i' }],
    },
    {
      type: 'imageBlock',
      attrs: { src: 'https://example.com/image.png', alt: '示意图', width: 640, height: 360, displayWidth: 320, align: 'right', blockId: 'image' },
    },
  ],
}

describe('DocumentPreview', () => {
  it('renders every schema node and mark without editable ProseMirror state', async () => {
    const mutable = structuredClone(content)
    const copy = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: copy } })
    const { container } = render(<DocumentPreview content={mutable} activeComment="thread-1" />)

    expect(screen.getByRole('article', { name: '文档预览' })).toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(container.querySelector('[contenteditable]')).toBeNull()
    expect(container.querySelector('.ProseMirror')).toBeNull()
    expect(container.querySelector('h2')).toHaveAttribute('data-block-id', 'intro')
    expect(container.querySelector('h2')).toHaveAttribute('data-block-bg', 'yellow')
    expect(container.querySelector('ol')).toHaveAttribute('start', '3')
    expect(container.querySelector('strong')).toHaveTextContent('粗体')
    expect(container.querySelector('em')).toHaveTextContent('斜体')
    expect(container.querySelector('u')).toHaveTextContent('下划线')
    expect(container.querySelector('s')).toHaveTextContent('删除')
    expect(container.querySelector('p code')).toHaveTextContent('行内代码')
    expect(screen.getByText('颜色')).toHaveStyle({ color: '#16734a' })
    expect(container.querySelector('mark')).toHaveAttribute('data-color', '#fff0a6')
    expect(container.querySelector('[data-comment-id="thread-1"]')).toHaveClass('comment-active')
    expect(container.querySelector('a[href="https://example.com/docs"]')).toHaveAttribute('target', '_blank')
    expect(container.querySelector('a[href^="javascript"]')).toBeNull()
    expect(container.querySelector('br')).toBeInTheDocument()
    await waitFor(() => expect(container.querySelector('[data-math="x^2"]')).toBeInTheDocument())
    expect(container.querySelector('th')).toHaveAttribute('colspan', '2')
    expect(container.querySelector('th')).toHaveAttribute('data-colwidth', '120,180')
    expect(container.querySelector('.callout')).toHaveAttribute('data-theme', 'green')
    expect(container.querySelector('.callout-icon')).toHaveTextContent('📌')
    expect(container.querySelector('.column-grid')).toHaveStyle({ '--column-tracks': '35% 65%' })
    expect(screen.getByRole('checkbox', { name: '已完成任务' })).toHaveAttribute('aria-disabled', 'true')
    expect(await screen.findByRole('img', { name: '示意图' })).toHaveAttribute('src', 'https://example.com/image.png')
    await waitFor(() => expect(codePreview.attach).toHaveBeenCalledTimes(2))
    expect(math.renderMath).toHaveBeenCalledWith('x^2', false)

    const toggle = screen.getByRole('button', { name: '展开折叠内容' })
    fireEvent.click(toggle)
    expect(screen.getByRole('button', { name: '收起折叠内容' })).toHaveAttribute('aria-expanded', 'true')
    expect(structuredClone(mutable)).toEqual(content)

    const codeBlock = container.querySelector<HTMLElement>('.preview-code-block')!
    await waitFor(() => expect(codeBlock.querySelector('.hljs-keyword')).toBeInTheDocument())
    fireEvent.click(within(codeBlock).getByRole('button', { name: '复制代码' }))
    await waitFor(() => expect(copy).toHaveBeenCalledWith('const answer = 42'))
    expect(within(codeBlock).getByRole('button', { name: '已复制代码' })).toBeInTheDocument()

    const rich = container.querySelector<HTMLElement>('[data-preview-language="mermaid"]')!
    fireEvent.click(within(rich).getByRole('button', { name: '源码' }))
    expect(rich).toHaveAttribute('data-view-mode', 'code')
    expect(rich.querySelector<HTMLElement>('pre[data-code-source]')).toBeVisible()
    expect(within(rich).getByRole('button', { name: '源码' })).toHaveAttribute('aria-pressed', 'true')
  })
})
