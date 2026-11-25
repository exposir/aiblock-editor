import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ErrorBoundary } from './ErrorBoundary'

function Broken({ failed }: { failed: boolean }) {
  if (failed) throw new Error('正文读取失败')
  return <p>正文已就绪</p>
}

describe('渲染错误恢复', () => {
  // @partition lifecycle: normal rendering, error details, recovery after a retry
  it('在工作区正常渲染时直接显示正文', () => {
    render(<ErrorBoundary><Broken failed={false} /></ErrorBoundary>)
    expect(screen.getByText('正文已就绪')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('显示错误摘要，按需展开堆栈及复制诊断', async () => {
    const user = userEvent.setup()
    const copy = vi.spyOn(navigator.clipboard, 'writeText')
    render(<ErrorBoundary><Broken failed /></ErrorBoundary>, { onCaughtError: () => {} })
    expect(within(screen.getByRole('alert')).getByText('正文读取失败')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '刷新窗口' })).toBeEnabled()
    await user.click(screen.getByText('查看堆栈'))
    expect(screen.getByText(/^Error: 正文读取失败/)).toBeVisible()
    await user.click(screen.getByRole('button', { name: '复制诊断文本' }))
    expect(copy).toHaveBeenCalledWith(expect.stringContaining('Error: 正文读取失败'))
    expect(await screen.findByText('已复制诊断文本。')).toBeInTheDocument()
  })

  it('在故障消失后通过重试重新挂载正文', async () => {
    const user = userEvent.setup()
    const view = render(<ErrorBoundary><Broken failed /></ErrorBoundary>, { onCaughtError: () => {} })
    view.rerender(<ErrorBoundary><Broken failed={false} /></ErrorBoundary>)
    expect(screen.queryByText('正文已就绪')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '重试恢复' }))
    expect(screen.getByText('正文已就绪')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
