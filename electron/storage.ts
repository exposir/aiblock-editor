import { randomUUID } from 'node:crypto'
import { mkdir, open, readFile, rename, rm } from 'node:fs/promises'
import { basename, dirname, extname } from 'node:path'
import type { MarkdownFile, SaveFileOptions } from '../src/desktop/bridge.js'

export async function readOptionalText(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

export async function writeAtomicText(path: string, text: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${randomUUID()}.tmp`
  const file = await open(temporary, 'wx', 0o600)
  try {
    try {
      await file.writeFile(text, 'utf8')
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

function isWorkspaceJSON(raw: string): boolean {
  try {
    const value: unknown = JSON.parse(raw)
    return !!value && typeof value === 'object' && 'activePageId' in value &&
      typeof value.activePageId === 'string' && 'pages' in value && Array.isArray(value.pages) && value.pages.length > 0
  } catch {
    return false
  }
}

export function createWorkspaceFile(path: string) {
  let operations = Promise.resolve()
  function enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const next = operations.then(operation)
    operations = next.then(() => {}, () => {})
    return next
  }

  return {
    load: () => enqueue(async () => {
      const raw = await readOptionalText(path)
      return raw && isWorkspaceJSON(raw) ? raw : null
    }),
    save: (raw: string) => enqueue(async () => {
      if (!isWorkspaceJSON(raw)) throw new TypeError('Invalid workspace JSON')
      await writeAtomicText(path, raw)
    }),
    clear: () => enqueue(() => rm(path, { force: true })),
    drain: () => operations,
  }
}

export async function readMarkdownFile(path: string): Promise<MarkdownFile> {
  if (!['.md', '.markdown'].includes(extname(path).toLowerCase())) throw new TypeError('Expected a Markdown file')
  return { name: basename(path), contents: await readFile(path, 'utf8') }
}

export function isSaveFileOptions(value: unknown): value is SaveFileOptions {
  return !!value && typeof value === 'object' && 'format' in value &&
    (value.format === 'markdown' || value.format === 'json' || value.format === 'svg') &&
    'name' in value && typeof value.name === 'string' && 'contents' in value && typeof value.contents === 'string'
}
