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
  vi.unstubAllGlobals()
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

  it('scrolling: 滚轮清除点击固定，页面滚动更新当前章节', async () => {
    const instance = editor('<h1 data-block-id="one">总览</h1><h2 data-block-id="two">发布安排</h2>')
    const one = instance.view.dom.querySelector('h1')!
    const two = instance.view.dom.querySelector('h2')!
    one.getBoundingClientRect = () => new DOMRect(0, 90 - window.scrollY, 300, 30)
    two.getBoundingClientRect = () => new DOMRect(0, 650 - window.scrollY, 300, 30)
    vi.spyOn(document.documentElement, 'scrollHeight', 'get').mockReturnValue(4000)
    const user = userEvent.setup()
    render(<OutlineSidebar editor={instance} />)
    const overview = screen.getByRole('button', { name: '总览' })
    const release = screen.getByRole('button', { name: '发布安排' })
    await user.click(release)
    expect(release).toHaveAttribute('aria-current', 'location')
    act(() => { window.dispatchEvent(new WheelEvent('wheel', { deltaY: -1 })) })
    await waitFor(() => expect(overview).toHaveAttribute('aria-current', 'location'))
    act(() => {
      vi.stubGlobal('scrollY', 560)
      window.dispatchEvent(new Event('scroll'))
    })
    await waitFor(() => expect(release).toHaveAttribute('aria-current', 'location'))
  })

  it('scrolling: 图表撑开正文时按新位置更新当前章节', async () => {
    const instance = editor('<h1>总览</h1><p>图表预览</p><h2>发布安排</h2>')
    const heading = instance.view.dom.querySelector('h2')!
    const preview = instance.view.dom.querySelector('p')!
    instance.view.dom.querySelector('h1')!.getBoundingClientRect = () => new DOMRect(0, 70, 300, 20)
    heading.getBoundingClientRect = () => new DOMRect(0, preview.hasAttribute('data-expanded') ? 460 : 110, 300, 20)
    render(<OutlineSidebar editor={instance} />)
    await waitFor(() => expect(screen.getByRole('button', { name: '发布安排' })).toHaveAttribute('aria-current', 'location'))
    preview.setAttribute('data-expanded', '')
    await waitFor(() => expect(screen.getByRole('button', { name: '总览' })).toHaveAttribute('aria-current', 'location'))
  })
})
