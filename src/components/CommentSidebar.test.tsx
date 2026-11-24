import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { CommentThread } from '../editor/comments'
import { CommentSidebar } from './CommentSidebar'

const threads: readonly CommentThread[] = [
  {
    id: 'draft', quote: '试点范围', resolved: false,
    messages: [],
  },
  {
    id: 'active', quote: '回滚步骤', resolved: false,
    messages: [{ id: 'm1', author: '测试同事', text: '请补充失败样例。' }],
  },
  {
    id: 'done', quote: '权限核对', resolved: true,
    messages: [{ id: 'm2', author: '产品同事', text: '已经确认。' }],
  },
]

function setup(selected: string | null = null) {
  const actions = {
    onLocate: vi.fn(), onReply: vi.fn(), onResolve: vi.fn(), onDelete: vi.fn(), onClose: vi.fn(),
  }
  render(<CommentSidebar threads={threads} active={selected} onLocate={actions.onLocate} onReply={actions.onReply}
    onResolve={actions.onResolve} onDelete={actions.onDelete} onClose={actions.onClose} />)
  return actions
}

describe('CommentSidebar', () => {
  /*
   * Testing strategy
   * @partition list: 无评论、草稿、已回复、已解决
   * @partition actions: 定位、回复、解决、删除、关闭
   * @partition input: 空白禁提、trim 后提交、自动聚焦当前草稿
   */
  it('list: 无评论显示空状态，并可收起侧栏', async () => {
    const user = userEvent.setup()
    const actions = {
      onLocate: vi.fn(), onReply: vi.fn(), onResolve: vi.fn(), onDelete: vi.fn(), onClose: vi.fn(),
    }
    render(<CommentSidebar threads={[]} active={null} onLocate={actions.onLocate} onReply={actions.onReply}
      onResolve={actions.onResolve} onDelete={actions.onDelete} onClose={actions.onClose} />)
    expect(screen.getByText('选中文字后可发表评论')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '收起评论' }))
    expect(actions.onClose).toHaveBeenCalledOnce()
  })

  it('list: 草稿、未解决和已解决评论显示各自状态', () => {
    setup()
    expect(screen.getByRole('button', { name: '试点范围' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '回滚步骤' })).toBeInTheDocument()
    expect(screen.getByText('请补充失败样例。')).toBeInTheDocument()
    expect(screen.getByText('已解决')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '权限核对' })).toBeDisabled()
  })

  it('actions: 点击引用、解决、删除都带上对应线程 id', async () => {
    const user = userEvent.setup()
    const actions = setup('active')
    await user.click(screen.getByRole('button', { name: '回滚步骤' }))
    expect(actions.onLocate).toHaveBeenCalledWith(threads[1])
    await user.click(screen.getByRole('button', { name: '解决评论' }))
    expect(actions.onResolve).toHaveBeenCalledWith('active')
    const activeThread = screen.getByRole('button', { name: '回滚步骤' }).closest('article')!
    await user.click(within(activeThread).getByRole('button', { name: '删除评论' }))
    expect(actions.onDelete).toHaveBeenCalledWith('active')
    await user.click(screen.getByRole('button', { name: '取消评论' }))
    expect(actions.onDelete).toHaveBeenCalledWith('draft')
  })

  it('input: 空白回复禁用，有效回复去掉两端空白后提交并清空', async () => {
    const user = userEvent.setup()
    const actions = setup('active')
    const input = screen.getByRole('textbox', { name: '回复内容' })
    const submit = screen.getByRole('button', { name: '回复' })
    expect(submit).toBeDisabled()
    await user.type(input, '  已经验证  ')
    expect(submit).toBeEnabled()
    await user.click(submit)
    expect(actions.onReply).toHaveBeenCalledWith('active', '已经验证')
    expect(input).toHaveValue('')
  })

  it('input: 当前草稿自动聚焦，可发表首条评论', async () => {
    const user = userEvent.setup()
    const actions = setup('draft')
    const input = screen.getByRole('textbox', { name: '评论内容' })
    expect(input).toHaveFocus()
    await user.type(input, '建议周四开放')
    await user.click(screen.getByRole('button', { name: '发表评论' }))
    expect(actions.onReply).toHaveBeenCalledWith('draft', '建议周四开放')
  })
})
