import { getSchema } from '@tiptap/core'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { createEditorExtensions } from '../editor/extensions'
import { createDemoWorkspace } from './demo-workspace'
import { WorkspaceDialog } from './WorkspaceDialog'

const schema = getSchema(createEditorExtensions())
const workspace = createDemoWorkspace(schema)

function dialog(request: React.ComponentProps<typeof WorkspaceDialog>['request'], overrides = {}) {
  return <WorkspaceDialog request={request} workspace={workspace} onClose={vi.fn()} onConfirm={vi.fn()} {...overrides} />
}

describe('WorkspaceDialog', () => {
  /*
   * @partition rename: 预填、Enter 保存、空标题提交、Esc 取消
   * @partition move: 父/子/独立根作为目标，后代排除
   * @partition delete: 子页数量和取消
   * @partition reset: 清除警告和确认
   */
  it('rename: 显示当前标题，Enter 提交且 trim 后交给上层', async () => {
    const user = userEvent.setup()
    const confirm = vi.fn()
    render(dialog({ kind: 'rename', pageId: workspace.pages[1]!.id }, { onConfirm: confirm }))
    expect(screen.getByRole('dialog', { name: '重命名页面' })).toBeInTheDocument()
    const input = screen.getByRole('textbox', { name: '页面标题' })
    expect(input).toHaveFocus()
    await user.clear(input)
    await user.type(input, '  验收清单（修订）  {Enter}')
    expect(confirm).toHaveBeenCalledWith('验收清单（修订）')
  })

  it('rename: 空名仍提交，调用方以无标题兜底', async () => {
    const user = userEvent.setup()
    const confirm = vi.fn()
    render(dialog({ kind: 'rename', pageId: workspace.pages[0]!.id }, { onConfirm: confirm }))
    await user.clear(screen.getByRole('textbox', { name: '页面标题' }))
    await user.click(screen.getByRole('button', { name: '保存' }))
    expect(confirm).toHaveBeenCalledWith('')
  })

  it('rename: Esc 只关闭弹窗，不提交', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    const confirm = vi.fn()
    render(dialog({ kind: 'rename', pageId: workspace.pages[0]!.id }, { onClose, onConfirm: confirm }))
    const dialogElement = screen.getByRole('dialog', { name: '重命名页面' }) as HTMLDialogElement
    dialogElement.close()
    expect(confirm).not.toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })

  it('move: 提供顶层和合法页面，排除自身与后代', () => {
    render(dialog({ kind: 'move', pageId: workspace.pages.find(page => page.title === '试点验收清单')!.id }))
    const select = screen.getByRole('combobox', { name: '移动到' })
    const labels = within(select).getAllByRole('option').map(option => option.textContent)
    expect(labels).toContain('顶层页面')
    expect(labels).toContain('架构设计备忘')
    expect(labels).toContain('文档协作与发布手册 / 接口与发布规则')
    expect(labels).not.toContain('文档协作与发布手册 / 试点验收清单')
    expect(labels).not.toContain('文档协作与发布手册 / 试点验收清单 / 开放前核对')
  })

  it('delete: 说明级联子页，取消不提交', async () => {
    const user = userEvent.setup()
    const confirm = vi.fn()
    render(dialog({ kind: 'delete', pageId: workspace.pages[0]!.id }, { onConfirm: confirm }))
    expect(screen.getByRole('dialog', { name: '删除页面' })).toHaveAccessibleDescription('将永久删除「文档协作与发布手册」及其 2 个子页面。')
    await user.click(screen.getByRole('button', { name: '取消' }))
    expect(confirm).not.toHaveBeenCalled()
  })

  it('reset: 显示清除存储警告，确认回传空值', async () => {
    const user = userEvent.setup()
    const confirm = vi.fn()
    render(dialog({ kind: 'reset' }, { onConfirm: confirm }))
    expect(screen.getByRole('dialog', { name: '重置示例工作区' })).toHaveAccessibleDescription(
      '本地保存的页面和评论将被清除，并恢复五个示例页面。',
    )
    await user.click(screen.getByRole('button', { name: '确认重置' }))
    expect(confirm).toHaveBeenCalledWith('')
  })
})
