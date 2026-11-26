import { execFile } from 'node:child_process'
import { constants, existsSync, watch } from 'node:fs'
import { access, readFile, readdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { delimiter, join } from 'node:path'
import { promisify } from 'node:util'
import type {
  PaseoAgent,
  PaseoAgentLogs,
  PaseoLogsOptions,
  PaseoProject,
  PaseoTreeSnapshot,
  PaseoWorkspace,
} from '../src/paseo/paseo-types.js'

const execFileAsync = promisify(execFile)
const agentIdPattern = /^[a-zA-Z0-9_-]+$/
const cacheLimit = 32
const customPaseoBin = '/Applications/Paseo.app/Contents/Resources/bin/paseo'

export type PaseoExecFile = (
  file: string,
  args: readonly string[],
  options: { readonly maxBuffer: number; readonly timeout: number },
) => Promise<{ readonly stdout: string | Buffer }>

export interface PaseoService {
  readTree(): Promise<PaseoTreeSnapshot>
  readLogs(agentId: string, options?: PaseoLogsOptions): Promise<PaseoAgentLogs>
}

export interface PaseoServiceOptions {
  readonly home?: string
  readonly execFile?: PaseoExecFile
}

export interface PaseoWatcher {
  close(): void
}

export interface PaseoDirectoryWatch {
  close(): void
  on(event: 'error', listener: (error: Error) => void): unknown
}

export type PaseoWatchDirectory = (
  directory: string,
  options: { readonly recursive: true },
  listener: () => void,
) => PaseoDirectoryWatch

export interface PaseoLogsRequest {
  readonly agentId: string
  readonly options?: PaseoLogsOptions
}

const nodeWatchDirectory: PaseoWatchDirectory = (directory, options, listener) =>
  watch(directory, options, listener)

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function parsePaseoLogsRequest(agentId: unknown, options: unknown): PaseoLogsRequest {
  if (typeof agentId !== 'string' || !agentIdPattern.test(agentId)) throw new TypeError('Invalid Paseo agent ID')
  if (options !== undefined && !isRecord(options)) throw new TypeError('Invalid Paseo log options')
  const force = options?.force
  if (force !== undefined && typeof force !== 'boolean') throw new TypeError('Invalid Paseo log options')
  return { agentId, ...(force === undefined ? {} : { options: { force } }) }
}

function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function timestamp(value: unknown): number {
  if (typeof value !== 'string') return 0
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function defaultHome(): string {
  return join(homedir(), '.paseo')
}

export function paseoHome(): string {
  return process.env.PASEO_HOME?.trim() || defaultHome()
}

async function readJsonArray(path: string): Promise<unknown[]> {
  try {
    const value: unknown = JSON.parse(await readFile(path, 'utf8'))
    return Array.isArray(value) ? value : []
  } catch {
    return []
  }
}

function project(raw: unknown): PaseoProject | null {
  if (!isRecord(raw) || typeof raw.projectId !== 'string' || raw.archivedAt) return null
  return {
    projectId: raw.projectId,
    name: text(raw.customName) || text(raw.displayName) || text(raw.projectKey) || raw.projectId,
    path: text(raw.rootPath),
    workspaces: [],
  }
}

function workspace(raw: unknown): PaseoWorkspace | null {
  if (!isRecord(raw) || typeof raw.workspaceId !== 'string' || typeof raw.projectId !== 'string' ||
      raw.archivedAt || raw.background === true) return null
  return {
    workspaceId: raw.workspaceId,
    projectId: raw.projectId,
    title: text(raw.title),
    displayName: text(raw.displayName),
    cwd: text(raw.cwd),
    pinnedAt: typeof raw.pinnedAt === 'string' ? raw.pinnedAt : null,
    updatedAt: text(raw.updatedAt),
    agents: [],
  }
}

function agent(raw: unknown): PaseoAgent | null {
  if (!isRecord(raw) || typeof raw.id !== 'string' || typeof raw.workspaceId !== 'string' ||
      raw.archivedAt || raw.internal === true) return null
  const config = isRecord(raw.config) ? raw.config : null
  return {
    id: raw.id,
    title: text(raw.title),
    workspaceId: raw.workspaceId,
    cwd: text(raw.cwd),
    provider: text(raw.provider),
    model: text(config?.model) || text(raw.model),
    lastStatus: text(raw.lastStatus, 'idle'),
    requiresAttention: raw.requiresAttention === true,
    updatedAt: text(raw.updatedAt),
  }
}

async function readAgents(home: string): Promise<PaseoAgent[]> {
  let directories
  try {
    directories = await readdir(join(home, 'agents'), { withFileTypes: true })
  } catch {
    return []
  }
  const files: string[] = []
  for (const directory of directories) {
    if (!directory.isDirectory()) continue
    let entries
    try {
      entries = await readdir(join(home, 'agents', directory.name), { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith('.json')) {
        files.push(join(home, 'agents', directory.name, entry.name))
      }
    }
  }
  const parsed = await Promise.all(files.map(async path => {
    try {
      return agent(JSON.parse(await readFile(path, 'utf8')))
    } catch {
      return null
    }
  }))
  const unique = new Map<string, PaseoAgent>()
  for (const value of parsed) if (value) unique.set(value.id, value)
  return [...unique.values()].sort((left, right) => timestamp(right.updatedAt) - timestamp(left.updatedAt))
}

function workspaceOrder(left: PaseoWorkspace, right: PaseoWorkspace): number {
  const pinned = Number(Boolean(left.pinnedAt)) - Number(Boolean(right.pinnedAt))
  return pinned ? -pinned : timestamp(right.updatedAt) - timestamp(left.updatedAt)
}

export async function readPaseoTree(home = paseoHome()): Promise<PaseoTreeSnapshot> {
  if (!existsSync(home)) {
    return { available: false, projects: [], workspaces: [], orphanAgents: [] }
  }
  const [rawProjects, rawWorkspaces, agents] = await Promise.all([
    readJsonArray(join(home, 'projects', 'projects.json')),
    readJsonArray(join(home, 'projects', 'workspaces.json')),
    readAgents(home),
  ])
  const projects = rawProjects.flatMap(raw => {
    const value = project(raw)
    return value ? [value] : []
  })
  const workspaces = rawWorkspaces.flatMap(raw => {
    const value = workspace(raw)
    return value ? [value] : []
  }).sort(workspaceOrder)
  const activeWorkspaceIds = new Set(workspaces.map(value => value.workspaceId))
  const orphanAgents = agents.filter(value => !activeWorkspaceIds.has(value.workspaceId))
  const byWorkspace = new Map<string, PaseoAgent[]>()
  for (const value of agents) {
    if (!activeWorkspaceIds.has(value.workspaceId)) continue
    const siblings = byWorkspace.get(value.workspaceId)
    if (siblings) siblings.push(value)
    else byWorkspace.set(value.workspaceId, [value])
  }
  const attached = workspaces.map(value => ({ ...value, agents: byWorkspace.get(value.workspaceId) ?? [] }))
  const byProject = new Map<string, PaseoWorkspace[]>()
  for (const value of attached) {
    const siblings = byProject.get(value.projectId)
    if (siblings) siblings.push(value)
    else byProject.set(value.projectId, [value])
  }
  return {
    available: true,
    projects: projects.map(value => ({ ...value, workspaces: byProject.get(value.projectId) ?? [] })),
    workspaces: attached,
    orphanAgents,
  }
}

async function executable(path: string): Promise<string | null> {
  try {
    await access(path, constants.X_OK)
    return path
  } catch {
    return null
  }
}

export async function resolvePaseoBinary(): Promise<string> {
  const configured = process.env.PASEO_BIN?.trim()
  if (configured) return configured
  const candidates: string[] = []
  for (const directory of process.env.PATH?.split(delimiter) ?? []) {
    if (directory) candidates.push(join(directory, process.platform === 'win32' ? 'paseo.exe' : 'paseo'))
  }
  candidates.push(join(homedir(), '.local', 'bin', 'paseo'), customPaseoBin)
  for (const candidate of candidates) {
    const found = await executable(candidate)
    if (found) return found
  }
  throw new Error('Paseo CLI was not found')
}

function logItems(raw: unknown): PaseoAgentLogs['items'] {
  if (!isRecord(raw) || !Array.isArray(raw.items)) throw new Error('Invalid Paseo logs response')
  return raw.items.flatMap(value => isRecord(value) && typeof value.type === 'string'
    ? [value as unknown as PaseoAgentLogs['items'][number]]
    : [])
}

function cachedAgent(snapshot: PaseoTreeSnapshot, agentId: string): PaseoAgent | undefined {
  return snapshot.projects.flatMap(project => project.workspaces).flatMap(value => value.agents)
    .find(value => value.id === agentId) ??
    snapshot.workspaces.flatMap(value => value.agents).find(value => value.id === agentId) ??
    snapshot.orphanAgents.find(value => value.id === agentId)
}

export function createPaseoService(options: PaseoServiceOptions = {}): PaseoService {
  const home = options.home ?? paseoHome()
  const run = options.execFile ?? (async (file, args, commandOptions) => {
    const result = await execFileAsync(file, [...args], commandOptions)
    return { stdout: result.stdout }
  })
  const cache = new Map<string, PaseoAgentLogs>()
  const inFlight = new Map<string, Promise<PaseoAgentLogs>>()
  const passHome = home !== defaultHome() || Boolean(process.env.PASEO_HOME?.trim())

  function remember(key: string, value: PaseoAgentLogs) {
    cache.delete(key)
    cache.set(key, value)
    if (cache.size > cacheLimit) cache.delete(cache.keys().next().value!)
  }

  async function readLogs(agentId: string, logOptions: PaseoLogsOptions = {}): Promise<PaseoAgentLogs> {
    if (!agentIdPattern.test(agentId)) throw new TypeError('Invalid Paseo agent ID')
    const tree = await readPaseoTree(home)
    const agent = cachedAgent(tree, agentId)
    const key = `${agentId}\0${agent?.updatedAt ?? 'missing'}`
    if (logOptions.force !== true) {
      const value = cache.get(key)
      if (value) {
        cache.delete(key)
        cache.set(key, value)
        return value
      }
      const pending = inFlight.get(key)
      if (pending) return pending
    }
    const loading = (async () => {
      const binary = await resolvePaseoBinary()
      const args = ['logs', agentId, '--json', ...(passHome ? ['--home', home] : [])]
      let stdout: string | Buffer
      try {
        ({ stdout } = await run(binary, args, { maxBuffer: 32 * 1024 * 1024, timeout: 15_000 }))
      } catch (error) {
        const message = error instanceof Error ? error.message : 'unknown error'
        throw new Error(`Unable to read Paseo logs: ${message}`)
      }
      const value = { agentId, items: logItems(JSON.parse(String(stdout))) }
      remember(key, value)
      return value
    })()
    inFlight.set(key, loading)
    try {
      return await loading
    } finally {
      inFlight.delete(key)
    }
  }

  return {
    readTree: () => readPaseoTree(home),
    readLogs,
  }
}

export function watchPaseo(
  home: string,
  onChange: () => void,
  debounceMs = 1200,
  watchDirectory: PaseoWatchDirectory = nodeWatchDirectory,
): PaseoWatcher {
  let timer: ReturnType<typeof setTimeout> | undefined
  let closed = false
  const watchers: PaseoDirectoryWatch[] = []
  const notify = () => {
    if (closed) return
    clearTimeout(timer)
    timer = setTimeout(onChange, debounceMs)
  }
  for (const directory of [join(home, 'projects'), join(home, 'agents')]) {
    if (!existsSync(directory)) continue
    try {
      const watcher = watchDirectory(directory, { recursive: true }, notify)
      watcher.on('error', () => {})
      watchers.push(watcher)
    } catch {
      // A read-only Paseo tree remains usable without live refresh.
    }
  }
  return {
    close() {
      closed = true
      clearTimeout(timer)
      for (const watcher of watchers) watcher.close()
      watchers.length = 0
    },
  }
}
