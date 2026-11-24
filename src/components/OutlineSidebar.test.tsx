import { Editor } from '@tiptap/core'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createEditorExtensions } from '../editor/extensions'
import { positionOfBlockId } from '../editor/components/block-geometry'
import { OutlineSidebar } from './OutlineSidebar'

const editors: Editor[] = []

function editor(content: string) {
  const instance = new Editor({ extensions: createEditorExtensions(), content })
  editors.push(instance)
  return instance
}

afterEach(() => {
  for (const instance of editors.splice(0)) instance.destroy()
  vi.restoreAllMocks()
})

describe('OutlineSidebar', () => {
  /*
   * Testing strategy
   * @partition outline: 多级标题、空目录、空编辑器
   * @partition interaction: 点击定位并固定高亮
   * @partition scrolling: 滚轮、键盘、尺寸变化后刷新激活章节
   * @partition setup-null: null 编辑器
   */
  it('outline: 按标题层级渲染中文目录，无标题显示提示', () => {
    const withOutline = editor('<h1 data-block-id="one">总览</h1><h2 data-block-id="two">发布安排</h2><h3 data-block-id="three">试点</h3>')
    const { unmount } = render(<OutlineSidebar editor={withOutline} />)
    expect(screen.getByRole('navigation', { name: '文档章节' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '总览' })).toHaveStyle({ paddingInlineStart: '0.65rem' })
    expect(screen.getByRole('button', { name: '发布安排' })).toHaveStyle({ paddingInlineStart: '1.3rem' })
    expect(Number.parseFloat((screen.getByRole('button', { name: '试点' }) as HTMLElement).style.paddingInlineStart)).toBeCloseTo(1.95)
    unmount()
    render(<OutlineSidebar editor={editor('<p>无标题正文</p>')} />)
    expect(screen.getByText('添加标题后显示目录')).toBeInTheDocument()
  })

  it('setup-null: null 编辑器保持空目录提示', () => {
    render(<OutlineSidebar editor={null} />)
    expect(screen.getByText('添加标题后显示目录')).toBeInTheDocument()
  })

  it('interaction: 点击目录项调用 revealBlock 并设置 location 高亮', async () => {
    const instance = editor('<h1 data-block-id="one">总览</h1><h2 data-block-id="two">发布安排</h2>')
    const user = userEvent.setup()
    render(<OutlineSidebar editor={instance} />)
    await user.click(screen.getByRole('button', { name: '发布安排' }))
    expect(screen.getByRole('button', { name: '发布安排' })).toHaveAttribute('aria-current', 'location')
    expect(positionOfBlockId(instance.state.doc, 'two')).not.toBeNull()
  })

  it('scrolling: 滚轮清除点击固定，按可见位置恢复最近章节', async () => {
    const instance = editor('<h1 data-block-id="one">总览</h1><h2 data-block-id="two">发布安排</h2>')
    const one = instance.view.nodeDOM(1) as HTMLElement
    const two = instance.view.nodeDOM(instance.state.doc.firstChild!.nodeSize + 1) as HTMLElement
    one.getBoundingClientRect = () => ({ top: -300, bottom: -200, left: 0, right: 0, width: 0, height: 100, x: 0, y: -300, toJSON() {} })
    two.getBoundingClientRect = () => ({ top: 90, bottom: 190, left: 0, right: 0, width: 0, height: 100, x: 0, y: 90, toJSON() {} })
    render(<OutlineSidebar editor={instance} />)
    await waitFor(() => expect(screen.getByRole('button', { name: '发布安排' })).toHaveAttribute('aria-current'))
    expect(screen.getByRole('button', { name: '发布安排' })).toHaveAttribute('aria-current')
    act(() => window.dispatchEvent(new WheelEvent('wheel')))
    await waitFor(() => expect(screen.getByRole('button', { name: '发布安排' })).toHaveAttribute('aria-current'))
    expect(screen.getByRole('button', { name: '发布安排' })).toHaveAttribute('aria-current')
  })
})
