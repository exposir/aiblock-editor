import { Component } from 'react'
import type { ReactNode } from 'react'

interface BoundaryState {
  error: Error | null
  copyStatus: string
}

const buttonClass = 'rounded-md border border-[var(--line-strong)] px-3 py-1.5 hover:bg-[var(--bg-selected)]'

export class ErrorBoundary extends Component<{ children: ReactNode }, BoundaryState> {
  state: BoundaryState = { error: null, copyStatus: '' }

  static getDerivedStateFromError(cause: unknown): BoundaryState {
    const error = cause instanceof Error ? cause : new Error(typeof cause === 'string' ? cause : '未知渲染错误')
    return { error, copyStatus: '' }
  }

  async copyDiagnostics(diagnostics: string) {
    try {
      await navigator.clipboard.writeText(diagnostics)
      this.setState({ copyStatus: '已复制诊断文本。' })
    } catch {
      this.setState({ copyStatus: '无法访问剪贴板。可以展开堆栈手动复制。' })
    }
  }

  render() {
    const { error, copyStatus } = this.state
    if (!error) return this.props.children
    const diagnostics = error.stack || error.toString()

    return <main className="mx-auto mt-[12vh] w-[calc(100%-2rem)] max-w-xl rounded-2xl border border-[var(--border-paper)] bg-[var(--bg-paper)] p-6 shadow-[var(--shadow-paper)]">
      <div role="alert">
        <h1 className="text-lg font-semibold">工作区显示出错</h1>
        <p className="my-2 break-words text-sm text-[var(--ink-secondary)]">{error.message.slice(0, 400) || error.name}</p>
      </div>
      <details className="my-4 text-sm">
        <summary className="cursor-pointer">查看堆栈</summary>
        <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-md bg-[var(--bg-code)] p-3 text-xs">{diagnostics}</pre>
      </details>
      <div className="flex flex-wrap gap-2 text-sm">
        <button type="button" className={buttonClass} onClick={() => this.setState({ error: null, copyStatus: '' })}>重试恢复</button>
        <button type="button" className={buttonClass} onClick={() => window.location.reload()}>刷新窗口</button>
        <button type="button" className={buttonClass} onClick={() => void this.copyDiagnostics(diagnostics)}>复制诊断文本</button>
      </div>
      {copyStatus && <p role="status" className="mt-3 text-sm text-[var(--ink-secondary)]">{copyStatus}</p>}
    </main>
  }
}
