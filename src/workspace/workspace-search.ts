import type { JSONContent } from '@tiptap/core'
import type { PageMetadata } from './workspace-format.js'

export interface WorkspaceSearchHit {
  readonly pageId: string
  readonly title: string
  readonly match: 'title' | 'body'
  readonly snippet: string
}

export function extractPlainText(doc: JSONContent): string {
  const parts: string[] = []
  const pending: (JSONContent | string)[] = [doc]
  while (pending.length) {
    const node = pending.pop()!
    if (typeof node === 'string') { parts.push(node); continue }
    if (typeof node.text === 'string') { parts.push(node.text); continue }
    if (node.type === 'inlineMath') {
      if (typeof node.attrs?.latex === 'string') parts.push(' ', node.attrs.latex, ' ')
      continue
    }
    if (node.type === 'imageBlock' || node.type === 'image') {
      if (typeof node.attrs?.alt === 'string') parts.push('\n', node.attrs.alt, '\n')
      continue
    }
    parts.push('\n')
    if (node.content) {
      pending.push('\n')
      for (let i = node.content.length - 1; i >= 0; i--) pending.push(node.content[i]!)
    }
  }
  return parts.join('').replace(/\n{2,}/g, '\n').trim()
}

async function readUntilAborted(read: () => Promise<JSONContent | null>, signal?: AbortSignal) {
  if (!signal) return read()
  signal.throwIfAborted()
  let abort!: () => void
  const aborted = new Promise<never>((_resolve, reject) => {
    abort = () => reject(signal.reason)
    signal.addEventListener('abort', abort, { once: true })
  })
  try { return await Promise.race([aborted, read()]) }
  finally { signal.removeEventListener('abort', abort) }
}

export async function searchWorkspacePages(
  pages: readonly PageMetadata[], readContent: (id: string) => Promise<JSONContent | null>, query: string,
  options: { limit?: number; signal?: AbortSignal } = {},
): Promise<WorkspaceSearchHit[]> {
  const { signal } = options
  signal?.throwIfAborted()
  const needle = query.trim().toLowerCase()
  const limit = Math.floor(options.limit ?? 50)
  if (!needle || !(limit > 0)) return []

  const hits: WorkspaceSearchHit[] = []
  const candidates: PageMetadata[] = []
  for (const page of pages) {
    const title = page.title.trim() || '无标题文档'
    if (title.toLowerCase().includes(needle)) {
      hits.push({ pageId: page.id, title, match: 'title', snippet: '' })
      if (hits.length === limit) return hits
    } else candidates.push(page)
  }
  for (const page of candidates) {
    const content = await readUntilAborted(() => readContent(page.id), signal)
    signal?.throwIfAborted()
    if (!content) continue
    const plain = extractPlainText(content).replace(/\s+/gu, ' ')
    const at = plain.toLowerCase().indexOf(needle)
    if (at < 0) continue
    const start = Math.max(0, at - 36)
    const end = Math.min(plain.length, Math.max(at + 44, Math.min(at + needle.length + 24, at + 84)))
    const snippet = (start ? '…' : '') + plain.slice(start, end).trim() + (end < plain.length ? '…' : '')
    hits.push({ pageId: page.id, title: page.title.trim() || '无标题文档', match: 'body', snippet })
    if (hits.length === limit) break
  }
  return hits
}
