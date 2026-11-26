import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { getSchema } from '@tiptap/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createEditorExtensions } from '../editor/extensions'
import type { DesktopBridge } from '../desktop/bridge'
import { PaseoWorkspace, PASEO_MESSAGE_ORDER_STORAGE_KEY, PASEO_SELECTION_STORAGE_KEY } from './PaseoWorkspace'
import type { PaseoAgent, PaseoAgentLogs, PaseoTreeSnapshot, PaseoWorkspace as PaseoWorkspaceRecord } from './paseo-types'

const schema = getSchema(createEditorExtensions())
const appearance = { mode: 'light' as const, setMode: vi.fn() }

function agent(id: string, title: string, updatedAt = '2026-11-26T10:00:00.000Z', workspaceId = 'workspace-1'): PaseoAgent {
  return {
    id,
    title,
    workspaceId,
    cwd: '/tmp/project',
    provider: 'codex',
    model: 'gpt-5',
    lastStatus: 'idle',
    requiresAttention: false,
    createdAt: '2026-11-26T09:00:00.000Z',
    lastActivityAt: updatedAt,
    updatedAt,
  }
}

function workspaceRecord(agents: PaseoAgent[], updatedAt = '2026-11-26T10:00:00.000Z'): PaseoWorkspaceRecord {
  return {
    workspaceId: 'workspace-1',
    projectId: 'project-1',
    title: '发布窗口',
    displayName: 'main',
    cwd: '/tmp/project',
    parentWorkspaceId: null,
    pinnedAt: null,
    createdAt: '2026-11-26T09:00:00.000Z',
    lastActivityAt: updatedAt,
    updatedAt,
    agents,
  }
}

function tree(agents: PaseoAgent[], updatedAt = '2026-11-26T10:00:00.000Z'): PaseoTreeSnapshot {
  const workspace = workspaceRecord(agents, updatedAt)
  return {
    available: true,
    projects: [{ projectId: 'project-1', name: 'ai-home', path: '/tmp/project', workspaces: [workspace] }],
    workspaces: [workspace],
    orphanAgents: [],
  }
}

function logs(text: string, agentId = 'agent-a'): PaseoAgentLogs {
  return {
    agentId,
    items: [
      { type: 'user_message', text: `问 ${agentId}` },
      { type: 'assistant_message', text },
    ],
  }
}

function bridgeWith(
  readTree: () => Promise<PaseoTreeSnapshot>,
  readLogs: (agentId: string, options?: { force?: boolean }) => Promise<PaseoAgentLogs>,
  registerChange?: (listener: () => void) => () => void,
) {
  const base: DesktopBridge = {
    platform: 'darwin',
    setTheme: async () => {},
    readIndex: async () => null,
    readPage: async () => null,
    commit: async () => ({ conflict: false }),
    saveImageAsset: async () => { throw new Error('unused') },
    readImageAssets: async () => [],
    openMarkdownFile: async () => null,
    saveFile: async () => false,
    onMenuCommand: () => () => {},
  }
  const readPaseoTree = vi.fn(readTree)
  const readPaseoLogs = vi.fn(readLogs)
  return {
    bridge: {
      ...base,
      readPaseoTree,
      readPaseoLogs,
      ...(registerChange ? {
        onPaseoChange(listener: () => void) {
          return registerChange(listener)
        },
      } : {}),
    },
    readPaseoTree,
    readPaseoLogs,
  }
}

function renderWorkspace(bridge: ReturnType<typeof bridgeWith>['bridge']) {
  const onSourceChange = vi.fn()
  const onSaveDocument = vi.fn()
  const view = render(<PaseoWorkspace bridge={bridge} schema={schema} appearance={appearance}
    onSourceChange={onSourceChange} onSaveDocument={onSaveDocument} />)
  return { ...view, onSourceChange, onSaveDocument }
}

async function previewHas(text: string) {
  await waitFor(() => expect(screen.getByRole('article', { name: '文档预览' })).toHaveTextContent(text))
}

beforeEach(() => {
  localStorage.clear()
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
})

afterEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
  Reflect.deleteProperty(navigator, 'clipboard')
})

describe('PaseoWorkspace', () => {
  it('ignores a stale agent response after switching quickly to another agent', async () => {
    const agents = [agent('agent-a', 'Agent A'), agent('agent-b', 'Agent B')]
    let resolveA!: (value: PaseoAgentLogs) => void
    const slowA = new Promise<PaseoAgentLogs>(resolve => { resolveA = resolve })
    const bridge = bridgeWith(
      async () => tree(agents),
      async agentId => agentId === 'agent-a' ? slowA : logs('Agent B content', 'agent-b'),
    )
    const user = userEvent.setup()
    renderWorkspace(bridge.bridge)
    await screen.findByRole('navigation', { name: 'Paseo 窗口树' })
    await waitFor(() => expect(bridge.readPaseoLogs).toHaveBeenCalledWith('agent-a', undefined))

    await user.click(screen.getByRole('button', { name: /Agent B/ }))
    await previewHas('Agent B content')
    await act(async () => { resolveA(logs('Agent A late content', 'agent-a')) })
    expect(screen.getByRole('article', { name: '文档预览' })).toHaveTextContent('Agent B content')
    expect(screen.getByRole('article', { name: '文档预览' })).not.toHaveTextContent('Agent A late content')
  })

  it('silently refreshes the current window and restores its scroll position', async () => {
    let changeListener: (() => void) | undefined
    let currentTree = tree([agent('agent-a', 'Agent A')])
    let currentLogs = logs('Old content', 'agent-a')
    const bridge = bridgeWith(
      async () => currentTree,
      async () => currentLogs,
      listener => {
        changeListener = listener
        return () => { changeListener = undefined }
      },
    )
    renderWorkspace(bridge.bridge)
    await previewHas('Old content')
    vi.spyOn(window, 'scrollY', 'get').mockReturnValue(420)
    vi.mocked(window.scrollTo).mockClear()
    currentTree = tree([agent('agent-a', 'Agent A', '2026-11-26T10:01:00.000Z')], '2026-11-26T10:01:00.000Z')
    currentLogs = logs('Refreshed content', 'agent-a')
    act(() => changeListener?.())
    await waitFor(() => expect(screen.getByRole('article', { name: '文档预览' })).toHaveTextContent('Refreshed content'), {
      timeout: 2000,
    })
    expect(window.scrollTo).toHaveBeenCalledWith(0, 420)
  })

  it('keeps rendered content and reports an error when a silent refresh fails', async () => {
    let changeListener: (() => void) | undefined
    let failing = false
    const bridge = bridgeWith(
      async () => tree([agent('agent-a', 'Agent A', failing ? '2026-11-26T10:01:00.000Z' : undefined)]),
      async () => {
        if (failing) throw new Error('refresh failed')
        return logs('Original content', 'agent-a')
      },
      listener => {
        changeListener = listener
        return () => { changeListener = undefined }
      },
    )
    renderWorkspace(bridge.bridge)
    await previewHas('Original content')
    failing = true
    act(() => changeListener?.())
    expect(await screen.findByText(/无法刷新这个 Paseo 窗口，当前仍显示上一次的内容：refresh failed/, {}, { timeout: 2000 }))
      .toBeInTheDocument()
    expect(screen.getByRole('article', { name: '文档预览' })).toHaveTextContent('Original content')
  })

  it('forces a logs refresh from the manual refresh button', async () => {
    const bridge = bridgeWith(async () => tree([agent('agent-a', 'Agent A')]), async () => logs('Current content', 'agent-a'))
    const user = userEvent.setup()
    renderWorkspace(bridge.bridge)
    await previewHas('Current content')
    await user.click(screen.getByRole('button', { name: '刷新 Paseo 窗口' }))
    await waitFor(() => expect(bridge.readPaseoLogs).toHaveBeenLastCalledWith('agent-a', { force: true }))
    expect(bridge.readPaseoTree).toHaveBeenCalledTimes(2)
  })

  it('degrades when Paseo is unavailable or the tree read fails', async () => {
    const unavailable = bridgeWith(async () => ({
      available: false, projects: [], workspaces: [], orphanAgents: [],
    }), async () => logs('never'))
    const first = renderWorkspace(unavailable.bridge)
    expect(await screen.findByText('未找到本机 Paseo 数据（~/.paseo）。')).toBeInTheDocument()
    expect(unavailable.readPaseoLogs).not.toHaveBeenCalled()
    first.unmount()

    const failed = bridgeWith(async () => { throw new Error('tree down') }, async () => logs('never'))
    renderWorkspace(failed.bridge)
    expect(await screen.findByText('无法读取 Paseo 目录树，请确认本机 Paseo 是否可用。')).toBeInTheDocument()
  })

  it('recovers from an initial log failure with the refresh button', async () => {
    let attempts = 0
    const bridge = bridgeWith(
      async () => tree([agent('agent-a', 'Agent A')]),
      async () => {
        attempts++
        if (attempts === 1) throw new Error('logs down')
        return logs('Recovered content', 'agent-a')
      },
    )
    const user = userEvent.setup()
    renderWorkspace(bridge.bridge)
    expect(await screen.findByText(/无法读取这个 Paseo 窗口的日志：logs down/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '刷新 Paseo 窗口' }))
    await previewHas('Recovered content')
    expect(bridge.readPaseoLogs).toHaveBeenLastCalledWith('agent-a', { force: true })
  })

  it('reports a clipboard failure without replacing the preview', async () => {
    const bridge = bridgeWith(async () => tree([agent('agent-a', 'Agent A')]), async () => logs('Clipboard content', 'agent-a'))
    const user = userEvent.setup()
    renderWorkspace(bridge.bridge)
    await previewHas('Clipboard content')
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
    })
    await user.click(screen.getByRole('button', { name: '复制 Paseo Markdown' }))
    expect(await screen.findByText('无法将 Paseo Markdown 写入剪贴板。')).toBeInTheDocument()
    expect(screen.getByRole('article', { name: '文档预览' })).toHaveTextContent('Clipboard content')
  })

  it('restores the remembered agent and falls back to the first active agent when it disappears', async () => {
    const agents = [agent('agent-a', 'Agent A'), agent('agent-b', 'Agent B')]
    const bridge = bridgeWith(
      async () => tree(agents),
      async agentId => logs(agentId === 'agent-b' ? 'Remembered B content' : 'Fallback A content', agentId),
    )
    localStorage.setItem(PASEO_SELECTION_STORAGE_KEY, 'agent-b')
    const first = renderWorkspace(bridge.bridge)
    await previewHas('Remembered B content')
    await waitFor(() => expect(screen.getByRole('button', { name: /Agent B/ })).toHaveAttribute('aria-current', 'page'))
    first.unmount()

    localStorage.setItem(PASEO_SELECTION_STORAGE_KEY, 'agent-archived')
    renderWorkspace(bridge.bridge)
    await previewHas('Fallback A content')
    await waitFor(() => expect(screen.getByRole('button', { name: /Agent A/ })).toHaveAttribute('aria-current', 'page'))
    expect(localStorage.getItem(PASEO_SELECTION_STORAGE_KEY)).toBe('agent-a')
  })

  it('switches message order to newest-first and reorders the outline immediately', async () => {
    const items: PaseoAgentLogs = {
      agentId: 'agent-a',
      items: [
        { type: 'user_message', text: '旧的问题' },
        { type: 'assistant_message', text: '旧的回答' },
        { type: 'user_message', text: '新的问题' },
        { type: 'assistant_message', text: '新的回答' },
      ],
    }
    const bridge = bridgeWith(async () => tree([agent('agent-a', 'Agent A')]), async () => items)
    const user = userEvent.setup()
    const first = renderWorkspace(bridge.bridge)
    await previewHas('旧的回答')
    const previewOrder = () => {
      const text = screen.getByRole('article', { name: '文档预览' }).textContent ?? ''
      return [text.indexOf('旧的回答'), text.indexOf('新的回答')] as const
    }
    const [oldIndex, newIndex] = previewOrder()
    expect(oldIndex).toBeLessThan(newIndex)
    const toggle = screen.getByRole('button', { name: '切换消息顺序' })
    expect(toggle).toHaveTextContent('正序')
    await user.click(toggle)
    await waitFor(() => {
      const [latest, oldest] = previewOrder()
      expect(latest).toBeGreaterThan(oldest)
    })
    expect(toggle).toHaveTextContent('最新在前')
    expect(localStorage.getItem(PASEO_MESSAGE_ORDER_STORAGE_KEY)).toBe('desc')
    expect(window.scrollTo).toHaveBeenLastCalledWith(0, 0)

    await user.click(screen.getByRole('button', { name: '目录侧栏' }))
    const outline = await screen.findByRole('navigation', { name: '文档章节' })
    expect(within(outline).getAllByRole('button').map(button => button.textContent).filter(text => /^\d\./.test(text ?? '')))
      .toEqual(['2. 新的问题', '1. 旧的问题'])
    first.unmount()
    renderWorkspace(bridge.bridge)
    await previewHas('新的回答')
    expect(screen.getByRole('button', { name: '切换消息顺序' })).toHaveTextContent('最新在前')
    const [oldest, latest] = previewOrder()
    expect(latest).toBeLessThan(oldest)
  })

  it('surfaces a concise provider error instead of the Electron IPC wrapper', async () => {
    const bridge = bridgeWith(
      async () => tree([agent('agent-dsh', 'DSH Agent')]),
      async () => {
        throw new Error(
          "Error invoking remote method 'paseo:logs': Unable to read Paseo logs: " +
          "Command failed: paseo logs agent-dsh --json\n" +
          "Agent agent-dsh references unavailable provider 'dsh'",
        )
      },
    )
    renderWorkspace(bridge.bridge)
    expect(await screen.findByText(/Provider 'dsh' 不可用/)).toBeInTheDocument()
    expect(screen.queryByText(/Error invoking remote method/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Unable to read Paseo logs/)).not.toBeInTheDocument()
  })
})
