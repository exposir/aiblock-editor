import { createHash, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import type { FileHandle } from 'node:fs/promises'
import { mkdir, open, readFile, readdir, rename, rm, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import {
  isPageId, isPageShard, isWorkspaceCommit, isWorkspaceIndex, splitLegacyWorkspace,
} from './workspace-format.js'
import type {
  PageShard, WorkspaceBase, WorkspaceCommit, WorkspaceCommitOptions, WorkspaceExternalChange, WorkspaceIndex,
} from './workspace-format.js'

const MiB = 1024 * 1024
const maxIndexBytes = 32 * MiB
const maxPageBytes = 64 * MiB
const maxLegacyBytes = 256 * MiB
const lockName = '.lock'
const indexName = 'index.json'
const pagesName = 'pages'
const defaultLockTimeoutMs = 2_000
const defaultStaleLockMs = 30_000

export interface WorkspaceFileState {
  readonly hash: string
  readonly mtimeMs: number
  readonly size: number
}

export class WorkspaceConflictError extends Error {
  readonly files: readonly string[]
  constructor(files: readonly string[]) {
    super(`Workspace changed on disk: ${files.join(', ')}`)
    this.name = 'WorkspaceConflictError'
    this.files = files
  }
}

export class WorkspaceLockedError extends Error {
  constructor() {
    super('Workspace is locked by another writer')
    this.name = 'WorkspaceLockedError'
  }
}

export interface WorkspaceLockOptions {
  readonly timeoutMs?: number
  readonly staleMs?: number
  readonly pollMs?: number
}

export interface WorkspaceSnapshot<T> {
  readonly value: T | null
  readonly etag: string | null
}

export interface WorkspaceTransaction {
  readonly directory: string
  readIndex(): Promise<WorkspaceIndex | null>
  readPage(id: string): Promise<PageShard | null>
  readIndexSnapshot(): Promise<WorkspaceSnapshot<WorkspaceIndex>>
  readPageSnapshot(id: string): Promise<WorkspaceSnapshot<PageShard>>
  write(changes: unknown): Promise<void>
}

interface ReadFileResult {
  readonly bytes: Buffer
  readonly state: WorkspaceFileState
}

const knownKeys = {
  index: 'index',
  page: (id: string) => `page:${id}`,
}

export function etagBytes(bytes: Uint8Array | string): string {
  return createHash('sha256').update(bytes).digest('hex')
}

export async function readOptionalText(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

export async function writeAtomicFile(path: string, data: string | Uint8Array): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${randomUUID()}.tmp`
  const file = await open(temporary, 'wx', 0o600)
  try {
    try {
      await file.writeFile(data)
      await file.sync()
    } finally {
      await file.close()
    }
    await rename(temporary, path)
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => {})
    throw error
  }
}

export function writeAtomicText(path: string, text: string): Promise<void> {
  return writeAtomicFile(path, text)
}

async function openStoredFile(path: string): Promise<FileHandle | null> {
  try {
    return await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

async function readBoundedFile(path: string, limit: number): Promise<ReadFileResult | null> {
  const file = await openStoredFile(path)
  if (!file) return null
  try {
    const stats = await file.stat()
    if (!stats.isFile() || stats.size > limit) throw new Error('Invalid stored file size')
    const bytes = Buffer.alloc(stats.size)
    let offset = 0
    while (offset < bytes.length) {
      const { bytesRead } = await file.read(bytes, offset, bytes.length - offset)
      if (!bytesRead) throw new Error('Stored file changed while reading')
      offset += bytesRead
    }
    return { bytes, state: { hash: etagBytes(bytes), mtimeMs: stats.mtimeMs, size: stats.size } }
  } finally {
    await file.close()
  }
}

function parseJSON(bytes: Buffer): unknown {
  return JSON.parse(bytes.toString('utf8'))
}

function boundedJSON(value: unknown, limit: number) {
  const raw = JSON.stringify(value)
  if (Buffer.byteLength(raw) > limit) throw new TypeError('Workspace record exceeds its size limit')
  return raw
}

function sameState(a: WorkspaceFileState | null | undefined, b: WorkspaceFileState | null | undefined) {
  if (a === undefined || b === undefined) return a === b
  if (a === null || b === null) return a === b
  return a.hash === b.hash
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function lockAge(path: string) {
  const [raw, stats] = await Promise.all([
    readFile(path, 'utf8').catch(() => null),
    stat(path).catch(() => null),
  ])
  if (!stats) return null
  let createdAt = stats.mtimeMs
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as { createdAt?: unknown; pid?: unknown }
      if (typeof parsed.createdAt === 'number' && Number.isFinite(parsed.createdAt)) createdAt = parsed.createdAt
      if (typeof parsed.pid === 'number' && Number.isSafeInteger(parsed.pid) && parsed.pid > 0) {
        try {
          process.kill(parsed.pid, 0)
          return 0
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'EPERM') return 0
        }
      }
    } catch {
      // A fresh lock file may be observed between create and write.
    }
  }
  return Date.now() - createdAt
}

async function acquireWorkspaceLock(directory: string, options: WorkspaceLockOptions = {}) {
  await mkdir(directory, { recursive: true })
  const path = join(directory, lockName)
  const timeoutMs = options.timeoutMs ?? defaultLockTimeoutMs
  const staleMs = options.staleMs ?? defaultStaleLockMs
  const pollMs = options.pollMs ?? 25
  const deadline = Date.now() + timeoutMs
  const token = randomUUID()
  for (;;) {
    try {
      const file = await open(path, 'wx', 0o600)
      try {
        await file.writeFile(JSON.stringify({ token, pid: process.pid, createdAt: Date.now() }))
        await file.sync()
      } finally {
        await file.close()
      }
      return token
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      const age = await lockAge(path)
      if (age === null) continue
      if (age > staleMs) {
        await rm(path, { force: true }).catch(() => {})
        continue
      }
      if (Date.now() >= deadline) throw new WorkspaceLockedError()
      await sleep(pollMs)
    }
  }
}

async function releaseWorkspaceLock(directory: string, token: string) {
  const path = join(directory, lockName)
  try {
    const raw = await readFile(path, 'utf8')
    if ((JSON.parse(raw) as { token?: unknown }).token === token) await rm(path, { force: true })
  } catch {
    // A stale-lock recovery may already have removed the file.
  }
}

export async function withWorkspaceLock<T>(
  directory: string, operation: () => Promise<T>, options?: WorkspaceLockOptions,
): Promise<T> {
  const token = await acquireWorkspaceLock(directory, options)
  try {
    return await operation()
  } finally {
    await releaseWorkspaceLock(directory, token)
  }
}

export interface WorkspaceFiles {
  readonly directory: string
  readIndex(): Promise<WorkspaceIndex | null>
  readPage(id: unknown): Promise<PageShard | null>
  readIndexSnapshot(): Promise<WorkspaceSnapshot<WorkspaceIndex>>
  readPageSnapshot(id: string): Promise<WorkspaceSnapshot<PageShard>>
  commit(changes: unknown, options?: WorkspaceCommitOptions): Promise<void>
  mutate<T>(operation: (transaction: WorkspaceTransaction) => Promise<T>, options?: WorkspaceLockOptions): Promise<T>
  detectExternalChanges(): Promise<WorkspaceExternalChange>
  drain(): Promise<unknown>
}

export function openWorkspaceFiles(directory: string, legacyPath = join(dirname(directory), 'workspace.json')): WorkspaceFiles {
  let operations = Promise.resolve()
  const queue = {
    enqueue<T>(operation: () => Promise<T>): Promise<T> {
      const next = operations.then(operation)
      operations = next.then(() => {}, () => {})
      return next
    },
    drain: () => operations,
  }
  const indexPath = join(directory, indexName)
  const pagesDirectory = join(directory, pagesName)
  const pagePath = (id: string) => join(pagesDirectory, `${id.toLowerCase()}.json`)
  const known = new Map<string, WorkspaceFileState | null>()

  function remember(key: string, state: WorkspaceFileState | null) {
    known.set(key, state)
  }

  async function readIndexUnlocked(): Promise<WorkspaceSnapshot<WorkspaceIndex> & { exists: boolean }> {
    const current = await readBoundedFile(indexPath, maxIndexBytes)
    if (!current) {
      remember(knownKeys.index, null)
      return { value: null, etag: null, exists: false }
    }
    const value = parseJSON(current.bytes)
    if (!isWorkspaceIndex(value)) throw new Error('Invalid workspace index')
    remember(knownKeys.index, current.state)
    return { value, etag: current.state.hash, exists: true }
  }

  async function readPageUnlocked(id: string): Promise<WorkspaceSnapshot<PageShard>> {
    const current = await readBoundedFile(pagePath(id), maxPageBytes)
    if (!current) {
      remember(knownKeys.page(id), null)
      return { value: null, etag: null }
    }
    const value = parseJSON(current.bytes)
    if (!isPageShard(value) || value.id !== id) throw new Error('Invalid page shard')
    remember(knownKeys.page(id), current.state)
    return { value, etag: current.state.hash }
  }

  async function writeUnlocked({ index, pages, removedPageIds }: WorkspaceCommit) {
    const indexRaw = index && boundedJSON(index, maxIndexBytes)
    for (const page of pages) {
      await writeAtomicText(pagePath(page.id), boundedJSON(page, maxPageBytes))
      const current = await readBoundedFile(pagePath(page.id), maxPageBytes)
      remember(knownKeys.page(page.id), current?.state ?? null)
    }
    if (indexRaw) {
      await writeAtomicText(indexPath, indexRaw)
      const current = await readBoundedFile(indexPath, maxIndexBytes)
      remember(knownKeys.index, current?.state ?? null)
    }
    await Promise.all(removedPageIds.map(async id => {
      await rm(pagePath(id), { force: true })
      remember(knownKeys.page(id), null)
    }))
  }

  async function migrateLegacy(): Promise<WorkspaceSnapshot<WorkspaceIndex>> {
    const current = await readIndexUnlocked()
    if (current.value || current.exists) return { value: current.value, etag: current.etag }
    const legacyFile = await readBoundedFile(legacyPath, maxLegacyBytes)
    const legacy = legacyFile && splitLegacyWorkspace(legacyFile.bytes.toString('utf8'))
    if (!legacy) return { value: null, etag: null }
    return withWorkspaceLock(directory, async () => {
      const again = await readIndexUnlocked()
      if (again.value || again.exists) return { value: again.value, etag: again.etag }
      await writeUnlocked({ ...legacy, removedPageIds: [] })
      await rm(legacyPath, { force: true }).catch(() => {})
      return { value: legacy.index, etag: (await readIndexUnlocked()).etag }
    })
  }

  async function loadIndex(migrate: boolean) {
    const current = await readIndexUnlocked()
    if (current.value || current.exists || !migrate) return { value: current.value, etag: current.etag }
    return migrateLegacy()
  }

  async function currentState(path: string, limit: number, previous: WorkspaceFileState | null | undefined) {
    const info = await stat(path).catch(error => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    })
    if (!info) return null
    if (previous && previous.mtimeMs === info.mtimeMs && previous.size === info.size) return previous
    const current = await readBoundedFile(path, limit)
    return current?.state ?? null
  }

  async function detectExternalChanges(): Promise<WorkspaceExternalChange> {
    return queue.enqueue(async () => {
      let indexChanged = false
      const knownIndex = known.get(knownKeys.index)
      if (knownIndex !== undefined) {
        const current = await currentState(indexPath, maxIndexBytes, knownIndex)
        indexChanged = !sameState(current, knownIndex)
      }
      const pageIds: string[] = []
      for (const [key, previous] of known) {
        if (!key.startsWith('page:')) continue
        const id = key.slice('page:'.length)
        const current = await currentState(pagePath(id), maxPageBytes, previous)
        if (!sameState(current, previous)) pageIds.push(id)
      }
      return { indexChanged, pageIds: pageIds.sort() }
    })
  }

  function conflictFiles(changes: WorkspaceCommit, expected: WorkspaceBase | undefined) {
    return (async () => {
      const files: string[] = []
      if (changes.index) {
        const wanted = expected?.index !== undefined ? expected.index : known.get(knownKeys.index)?.hash ?? (known.has(knownKeys.index) ? null : undefined)
        if (wanted !== undefined) {
          const current = await currentState(indexPath, maxIndexBytes, known.get(knownKeys.index))
          if ((current?.hash ?? null) !== wanted) files.push('index')
        }
      }
      const pageIds = new Set([...changes.pages.map(page => page.id), ...changes.removedPageIds])
      for (const id of pageIds) {
        const key = knownKeys.page(id)
        const wanted = expected?.pages && Object.hasOwn(expected.pages, id)
          ? expected.pages[id]
          : known.get(key)?.hash ?? (known.has(key) ? null : undefined)
        if (wanted === undefined) continue
        const current = await currentState(pagePath(id), maxPageBytes, known.get(key))
        if ((current?.hash ?? null) !== wanted) files.push(id)
      }
      return files
    })()
  }

  const api: WorkspaceFiles = {
    directory,
    readIndex: () => queue.enqueue(async () => (await loadIndex(true)).value),
    readPage: (id: unknown) => queue.enqueue(async () => {
      if (!isPageId(id)) throw new TypeError('Invalid page ID')
      return (await readPageUnlocked(id)).value
    }),
    readIndexSnapshot: () => queue.enqueue(async () => {
      const snapshot = await loadIndex(true)
      return { value: snapshot.value, etag: snapshot.etag }
    }),
    readPageSnapshot: (id: string) => queue.enqueue(async () => {
      if (!isPageId(id)) throw new TypeError('Invalid page ID')
      return readPageUnlocked(id)
    }),
    commit: (changes: unknown, options: WorkspaceCommitOptions = {}) => queue.enqueue(async () => {
      if (!isWorkspaceCommit(changes)) throw new TypeError('Invalid workspace changes')
      await withWorkspaceLock(directory, async () => {
        if (!options.force) {
          const files = await conflictFiles(changes, options.base)
          if (files.length) throw new WorkspaceConflictError(files)
        }
        await writeUnlocked(changes)
      })
    }),
    mutate: <T>(operation: (transaction: WorkspaceTransaction) => Promise<T>, options?: WorkspaceLockOptions) =>
      queue.enqueue(() => withWorkspaceLock(directory, async () => {
        const transaction: WorkspaceTransaction = {
          directory,
          readIndex: async () => (await readIndexUnlocked()).value,
          readPage: async id => {
            if (!isPageId(id)) throw new TypeError('Invalid page ID')
            return (await readPageUnlocked(id)).value
          },
          readIndexSnapshot: async () => {
            const snapshot = await readIndexUnlocked()
            return { value: snapshot.value, etag: snapshot.etag }
          },
          readPageSnapshot: async id => {
            if (!isPageId(id)) throw new TypeError('Invalid page ID')
            return readPageUnlocked(id)
          },
          write: async changes => {
            if (!isWorkspaceCommit(changes)) throw new TypeError('Invalid workspace changes')
            await writeUnlocked(changes)
          },
        }
        return operation(transaction)
      }, options)),
    detectExternalChanges,
    drain: queue.drain,
  }
  return api
}

export function createWorkspaceFiles(userData: string): WorkspaceFiles {
  return openWorkspaceFiles(join(userData, 'workspace'), join(userData, 'workspace.json'))
}

