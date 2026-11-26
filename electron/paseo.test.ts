// @vitest-environment node
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { createPaseoService, parsePaseoLogsRequest, readPaseoTree, watchPaseo } from './paseo.js'
import type { PaseoDirectoryWatch, PaseoExecFile, PaseoWatchDirectory } from './paseo.js'

let previousHome: string | undefined
let previousBin: string | undefined

beforeEach(() => {
  previousHome = process.env.PASEO_HOME
  previousBin = process.env.PASEO_BIN
  process.env.PASEO_BIN = '/tmp/test-paseo'
})

afterEach(() => {
  vi.useRealTimers()
  if (previousHome === undefined) delete process.env.PASEO_HOME
  else process.env.PASEO_HOME = previousHome
  if (previousBin === undefined) delete process.env.PASEO_BIN
  else process.env.PASEO_BIN = previousBin
})

async function writeJson(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, JSON.stringify(value, null, 2))
}

async function tempHome(prefix: string) {
  const home = await mkdtemp(join(tmpdir(), prefix))
  process.env.PASEO_HOME = home
  onTestFinished(() => rm(home, { recursive: true, force: true }))
  return home
}

function fakeWatchDirectory() {
  const entries: {
    readonly directory: string
    readonly emit: () => void
    readonly fail: (error: Error) => void
    readonly close: ReturnType<typeof vi.fn>
  }[] = []
  const watchDirectory = vi.fn<PaseoWatchDirectory>((directory, _options, listener) => {
    const errors: ((error: Error) => void)[] = []
    const close = vi.fn()
    let handle!: PaseoDirectoryWatch
    handle = {
      close,
      on(event, errorListener) {
        if (event === 'error') errors.push(errorListener)
        return handle
      },
    }
    entries.push({
      directory,
      emit: listener,
      fail: error => {
        if (!errors.length) throw new Error('No error listener registered')
        for (const errorListener of errors) errorListener(error)
      },
      close,
    })
    return handle
  })
  return { watchDirectory, entries }
}

async function fixture() {
  const home = await tempHome('aiblock-paseo-test-')
  await mkdir(join(home, 'projects'), { recursive: true })
  await mkdir(join(home, 'agents', 'alpha'), { recursive: true })
  await writeFile(join(home, 'agents', 'alpha', 'broken.json'), '{')
  await writeJson(join(home, 'projects', 'projects.json'), [
    {
      projectId: 'prj_a', rootPath: '/work/a', displayName: 'Alpha', archivedAt: null,
    },
    {
      projectId: 'prj_old', rootPath: '/work/old', displayName: 'Old', archivedAt: '2026-01-01T00:00:00.000Z',
    },
  ])
  await writeJson(join(home, 'projects', 'workspaces.json'), [
    {
      workspaceId: 'wks_a1', projectId: 'prj_a', cwd: '/work/a', displayName: 'main', title: 'Pinned',
      pinnedAt: '2026-11-26T09:00:00.000Z', updatedAt: '2026-11-26T08:00:00.000Z', archivedAt: null, background: false,
    },
    {
      workspaceId: 'wks_a2', projectId: 'prj_a', cwd: '/work/a/feature', displayName: 'feature', title: 'Feature',
      pinnedAt: null, updatedAt: '2026-11-26T10:00:00.000Z', archivedAt: null, background: false,
    },
    {
      workspaceId: 'wks_bg', projectId: 'prj_a', cwd: '/work/a', displayName: 'background', title: 'Background',
      pinnedAt: null, updatedAt: '2026-11-26T11:00:00.000Z', archivedAt: null, background: true,
    },
    {
      workspaceId: 'wks_old', projectId: 'prj_a', cwd: '/work/a', displayName: 'archived', title: 'Archived',
      pinnedAt: null, updatedAt: '2026-11-26T12:00:00.000Z', archivedAt: '2026-11-26T12:00:00.000Z', background: false,
    },
  ])
  const agents = [
    {
      id: 'agent-a1', title: 'Older task', workspaceId: 'wks_a1', cwd: '/work/a', provider: 'codex',
      config: { model: 'gpt-5' }, lastStatus: 'idle', requiresAttention: false,
      updatedAt: '2026-11-26T08:00:00.000Z', archivedAt: null, internal: false,
    },
    {
      id: 'agent-a2', title: 'Newer task', workspaceId: 'wks_a1', cwd: '/work/a', provider: 'claude',
      model: 'sonnet', lastStatus: 'running', requiresAttention: true,
      updatedAt: '2026-11-26T10:00:00.000Z', archivedAt: null, internal: false,
    },
    {
      id: 'agent-orphan', title: 'Orphan task', workspaceId: 'wks_missing', cwd: '/tmp', provider: 'qoder',
      config: { model: 'qwen' }, lastStatus: 'closed', requiresAttention: false,
      updatedAt: '2026-11-26T09:00:00.000Z', archivedAt: null, internal: false,
    },
    {
      id: 'agent-internal', title: 'Internal', workspaceId: 'wks_a1', cwd: '/work/a', provider: 'internal',
      lastStatus: 'running', requiresAttention: false, updatedAt: '2026-11-26T12:00:00.000Z', internal: true,
    },
    {
      id: 'agent-archived', title: 'Archived', workspaceId: 'wks_a1', cwd: '/work/a', provider: 'codex',
      lastStatus: 'closed', requiresAttention: false, updatedAt: '2026-11-26T13:00:00.000Z',
      archivedAt: '2026-11-26T13:00:00.000Z', internal: false,
    },
  ]
  await Promise.all(agents.map((agent, index) =>
    writeJson(join(home, 'agents', 'alpha', `agent-${index}.json`), agent)))
  return home
}

async function cacheFixture(count: number) {
  const home = await tempHome('aiblock-paseo-cache-test-')
  const workspace = {
    workspaceId: 'wks_cache', projectId: 'prj_cache', cwd: '/cache', displayName: 'main', title: 'Cache',
    pinnedAt: null, updatedAt: '2026-11-26T10:00:00.000Z', archivedAt: null, background: false,
  }
  await writeJson(join(home, 'projects', 'projects.json'), [{
    projectId: 'prj_cache', rootPath: '/cache', displayName: 'Cache', archivedAt: null,
  }])
  await writeJson(join(home, 'projects', 'workspaces.json'), [workspace])
  await mkdir(join(home, 'agents', 'cache'), { recursive: true })
  const ids = Array.from({ length: count }, (_, index) => `agent-${index}`)
  await Promise.all(ids.map((id, index) => writeJson(join(home, 'agents', 'cache', `${id}.json`), {
    id, title: `Agent ${index}`, workspaceId: 'wks_cache', cwd: '/cache', provider: 'codex',
    config: { model: 'gpt-5' }, lastStatus: 'idle', requiresAttention: false,
    updatedAt: `2026-11-26T10:${String(index).padStart(2, '0')}:00.000Z`, archivedAt: null, internal: false,
  })))
  return { home, ids }
}

function logsStdout(agentId: string) {
  return JSON.stringify({
    agentId,
    items: [
      { type: 'user_message', text: `request for ${agentId}` },
      { type: 'assistant_message', text: `response for ${agentId}` },
    ],
  })
}

describe('Paseo tree adapter', () => {
  it('assembles active projects, pinned workspaces and sorted multi-agent children', async () => {
    await fixture()
    const tree = await readPaseoTree()
    expect(tree.available).toBe(true)
    expect(tree.projects.map(project => project.name)).toEqual(['Alpha'])
    expect(tree.projects[0]?.workspaces.map(workspace => workspace.title)).toEqual(['Pinned', 'Feature'])
    const pinned = tree.projects[0]?.workspaces[0]
    expect(pinned?.agents.map(agent => agent.id)).toEqual(['agent-a2', 'agent-a1'])
    expect(pinned?.agents[0]).toMatchObject({
      provider: 'claude', model: 'sonnet', lastStatus: 'running', requiresAttention: true,
    })
    expect(tree.workspaces.map(workspace => workspace.workspaceId)).toEqual(['wks_a1', 'wks_a2'])
    expect(tree.orphanAgents.map(agent => agent.id)).toEqual(['agent-orphan'])
    expect(tree.workspaces.flatMap(workspace => workspace.agents).map(agent => agent.id))
      .not.toContain('agent-internal')
  })

  it('degrades to an unavailable empty snapshot when the home directory is missing', async () => {
    const missing = join(tmpdir(), `aiblock-paseo-missing-${Date.now()}`)
    await expect(readPaseoTree(missing)).resolves.toEqual({
      available: false, projects: [], workspaces: [], orphanAgents: [],
    })
  })

  it('treats damaged project registries as empty and recovers after valid JSON is restored', async () => {
    const home = await tempHome('aiblock-paseo-damaged-test-')
    await mkdir(join(home, 'projects'), { recursive: true })
    await writeFile(join(home, 'projects', 'projects.json'), '{')
    await writeFile(join(home, 'projects', 'workspaces.json'), '[] trailing')
    await expect(readPaseoTree()).resolves.toEqual({
      available: true, projects: [], workspaces: [], orphanAgents: [],
    })
    await writeJson(join(home, 'projects', 'projects.json'), [{
      projectId: 'prj_restored', rootPath: '/restored', displayName: 'Restored', archivedAt: null,
    }])
    await writeJson(join(home, 'projects', 'workspaces.json'), [])
    const tree = await readPaseoTree()
    expect(tree.projects.map(project => project.name)).toEqual(['Restored'])
  })

  it('deduplicates an agent ID found in multiple agent subdirectories', async () => {
    const home = await fixture()
    await writeJson(join(home, 'agents', 'beta', 'duplicate.json'), {
      id: 'agent-a1', title: 'Duplicate copy', workspaceId: 'wks_a1', cwd: '/work/a', provider: 'codex',
      config: { model: 'gpt-5' }, lastStatus: 'idle', requiresAttention: false,
      updatedAt: '2026-11-26T08:30:00.000Z', archivedAt: null, internal: false,
    })
    const tree = await readPaseoTree()
    const ids = tree.workspaces.flatMap(workspace => workspace.agents).map(agent => agent.id)
    expect(ids.filter(id => id === 'agent-a1')).toHaveLength(1)
  })

  it('rejects unsafe agent IDs and serves cached logs until force explicitly refreshes', async () => {
    const home = await fixture()
    const exec = vi.fn<PaseoExecFile>(async (_file, args) => ({
      stdout: JSON.stringify({
        agentId: args[1],
        items: [
          { type: 'user_message', text: `request for ${args[1]}` },
          { type: 'assistant_message', text: 'response' },
        ],
      }),
    }))
    const service = createPaseoService({ home, execFile: exec })
    await expect(service.readLogs('../agent')).rejects.toThrow('Invalid Paseo agent ID')
    expect(exec).not.toHaveBeenCalled()

    const first = await service.readLogs('agent-a1')
    expect(first.items).toHaveLength(2)
    expect(exec).toHaveBeenCalledOnce()
    expect(exec.mock.calls[0]?.[1]).toEqual(['logs', 'agent-a1', '--json', '--home', home])

    await service.readLogs('agent-a1')
    expect(exec).toHaveBeenCalledOnce()

    await writeJson(join(home, 'agents', 'alpha', 'agent-0.json'), {
      id: 'agent-a1', title: 'Older task', workspaceId: 'wks_a1', cwd: '/work/a', provider: 'codex',
      config: { model: 'gpt-5' }, lastStatus: 'idle', requiresAttention: false,
      updatedAt: '2026-11-26T11:00:00.000Z', archivedAt: null, internal: false,
    })
    await service.readLogs('agent-a1')
    expect(exec).toHaveBeenCalledTimes(2)

    await service.readLogs('agent-a1', { force: true })
    expect(exec).toHaveBeenCalledTimes(3)
  })

  it('deduplicates concurrent reads for the same agent', async () => {
    const home = await fixture()
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const exec = vi.fn<PaseoExecFile>(async (_file, args) => {
      await gate
      return { stdout: logsStdout(args[1]!) }
    })
    const service = createPaseoService({ home, execFile: exec })
    const first = service.readLogs('agent-a1')
    const second = service.readLogs('agent-a1')
    await vi.waitFor(() => expect(exec).toHaveBeenCalledOnce(), { timeout: 1000 })
    release()
    const [left, right] = await Promise.all([first, second])
    expect(left).toEqual(right)
    expect(left).toBe(right)
    expect(exec).toHaveBeenCalledOnce()
  })

  it('evicts the least recently used entry and refreshes recency on cache hits', async () => {
    const { home, ids } = await cacheFixture(33)
    const exec = vi.fn<PaseoExecFile>(async (_file, args) => ({ stdout: logsStdout(args[1]!) }))
    const service = createPaseoService({ home, execFile: exec })
    for (const id of ids.slice(0, 32)) await service.readLogs(id)
    expect(exec).toHaveBeenCalledTimes(32)

    await service.readLogs(ids[0]!)
    expect(exec).toHaveBeenCalledTimes(32)

    await service.readLogs(ids[32]!)
    expect(exec).toHaveBeenCalledTimes(33)

    await service.readLogs(ids[0]!)
    expect(exec).toHaveBeenCalledTimes(33)

    await service.readLogs(ids[1]!)
    expect(exec).toHaveBeenCalledTimes(34)
  })

  it('does not cache failed exec, malformed JSON or missing items and retries cleanly', async () => {
    const home = await fixture()
    const cases = [
      {
        prepare: (exec: ReturnType<typeof vi.fn<PaseoExecFile>>) => exec.mockRejectedValueOnce(new Error('disk failure')),
        message: 'Unable to read Paseo logs: disk failure',
      },
      {
        prepare: (exec: ReturnType<typeof vi.fn<PaseoExecFile>>) => exec.mockResolvedValueOnce({ stdout: '{' }),
        message: 'JSON',
      },
      {
        prepare: (exec: ReturnType<typeof vi.fn<PaseoExecFile>>) =>
          exec.mockResolvedValueOnce({ stdout: JSON.stringify({ agentId: 'agent-a1' }) }),
        message: 'Invalid Paseo logs response',
      },
    ]
    for (const testCase of cases) {
      const exec = vi.fn<PaseoExecFile>()
      const service = createPaseoService({ home, execFile: exec })
      testCase.prepare(exec)
      await expect(service.readLogs('agent-a1')).rejects.toThrow(testCase.message)
      exec.mockResolvedValueOnce({ stdout: logsStdout('agent-a1') })
      await expect(service.readLogs('agent-a1')).resolves.toMatchObject({ agentId: 'agent-a1' })
      expect(exec).toHaveBeenCalledTimes(2)
    }
  })

  it.each(['', ' ', 'a;id', '$(whoami)', 'a/b', '../agent'])(
    'rejects invalid agent ID before spawning Paseo: %j',
    async agentId => {
      await fixture()
      const exec = vi.fn<PaseoExecFile>()
      const service = createPaseoService({ execFile: exec })
      await expect(service.readLogs(agentId)).rejects.toThrow('Invalid Paseo agent ID')
      expect(exec).not.toHaveBeenCalled()
    },
  )

  it('validates the IPC-shaped Paseo logs request before reaching the service', () => {
    expect(() => parsePaseoLogsRequest(42, undefined)).toThrow('Invalid Paseo agent ID')
    expect(() => parsePaseoLogsRequest('', undefined)).toThrow('Invalid Paseo agent ID')
    expect(() => parsePaseoLogsRequest('agent-a1', [])).toThrow('Invalid Paseo log options')
    expect(() => parsePaseoLogsRequest('agent-a1', { force: 'yes' })).toThrow('Invalid Paseo log options')
    expect(parsePaseoLogsRequest('agent-a1', { force: true })).toEqual({
      agentId: 'agent-a1', options: { force: true },
    })
    expect(parsePaseoLogsRequest('agent-a1', undefined)).toEqual({ agentId: 'agent-a1' })
  })
})

describe('Paseo watcher', () => {
  it('deterministically debounces, resets the timer, closes cleanly and survives watcher errors', async () => {
    const home = await tempHome('aiblock-paseo-watch-test-')
    await mkdir(join(home, 'projects'), { recursive: true })
    vi.useFakeTimers()
    const debounce = 40
    const onChange = vi.fn()
    const fake = fakeWatchDirectory()
    const watcher = watchPaseo(home, onChange, debounce, fake.watchDirectory)
    expect(fake.watchDirectory).toHaveBeenCalledExactlyOnceWith(
      join(home, 'projects'), { recursive: true }, expect.any(Function),
    )
    const events = fake.entries[0]!

    for (let index = 0; index < 5; index++) events.emit()
    await vi.advanceTimersByTimeAsync(20)
    expect(onChange).not.toHaveBeenCalled()
    events.emit()
    events.emit()
    await vi.advanceTimersByTimeAsync(20)
    expect(onChange).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(20)
    expect(onChange).toHaveBeenCalledOnce()

    events.emit()
    await vi.advanceTimersByTimeAsync(10)
    watcher.close()
    expect(events.close).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(debounce * 3)
    expect(onChange).toHaveBeenCalledOnce()
    events.emit()
    await vi.advanceTimersByTimeAsync(debounce * 3)
    expect(onChange).toHaveBeenCalledOnce()

    expect(() => events.fail(new Error('watch failed'))).not.toThrow()
  })

  it('does not throw when watched directories are missing', () => {
    const home = join(tmpdir(), `aiblock-paseo-missing-watch-${Date.now()}`)
    const onChange = vi.fn()
    expect(() => watchPaseo(home, onChange).close()).not.toThrow()
    expect(onChange).not.toHaveBeenCalled()
  })
})
