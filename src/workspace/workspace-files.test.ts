import { mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { PageShard, WorkspaceIndex } from './workspace-format'
import {
  openWorkspaceFiles, withWorkspaceLock, WorkspaceConflictError, WorkspaceLockedError,
} from './workspace-files'

const idA = '11111111-1111-4111-8111-111111111111'
const directories: string[] = []

async function workspace() {
  const directory = await mkdtemp(join(tmpdir(), 'lark-workspace-'))
  directories.push(directory)
  return { directory, files: openWorkspaceFiles(directory) }
}

function shard(id: string, text: string, updatedAt = 1): PageShard {
  return { id, content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] }, updatedAt }
}

function index(activePageId = idA): WorkspaceIndex {
  return {
    version: 2,
    activePageId,
    pages: [{
      id: idA, parentId: null, title: 'A', icon: '📄', comments: [], createdAt: 1, updatedAt: 1, order: 0,
    }],
  }
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })))
})

describe('workspace file concurrency primitives', () => {
  it('round-trips page shards with stable etags and suppresses self writes', async () => {
    const { files } = await workspace()
    await files.commit({ index: index(), pages: [shard(idA, '初稿')], removedPageIds: [] })
    const page = await files.readPageSnapshot(idA)
    const savedIndex = await files.readIndexSnapshot()
    expect(page.etag).toMatch(/^[a-f0-9]{64}$/)
    expect(savedIndex.etag).toMatch(/^[a-f0-9]{64}$/)
    expect(await files.detectExternalChanges()).toEqual({ indexChanged: false, pageIds: [] })
    expect(await files.readPage(idA)).toEqual(shard(idA, '初稿'))
  })

  it('detects external shard and index writes, then clears after reads', async () => {
    const { directory, files } = await workspace()
    await files.commit({ index: index(), pages: [shard(idA, '初稿')], removedPageIds: [] })
    await files.readIndexSnapshot()
    await files.readPageSnapshot(idA)

    await writeFile(join(directory, 'pages', `${idA}.json`), JSON.stringify(shard(idA, '外部修改', 2)))
    await writeFile(join(directory, 'index.json'), JSON.stringify({
      ...index(), pages: [{ ...index().pages[0]!, title: '外部标题', updatedAt: 2 }],
    }))
    expect(await files.detectExternalChanges()).toEqual({ indexChanged: true, pageIds: [idA] })

    await files.readIndexSnapshot()
    await files.readPageSnapshot(idA)
    expect(await files.detectExternalChanges()).toEqual({ indexChanged: false, pageIds: [] })
  })

  it('rejects stale base hashes and can explicitly force an overwrite', async () => {
    const { directory, files } = await workspace()
    await files.commit({ index: index(), pages: [shard(idA, '初稿')], removedPageIds: [] })
    const before = await files.readPageSnapshot(idA)
    await files.readIndexSnapshot()
    await writeFile(join(directory, 'pages', `${idA}.json`), JSON.stringify(shard(idA, '外部修改', 2)))

    await expect(files.commit({ pages: [shard(idA, '本地覆盖', 3)], removedPageIds: [] }))
      .rejects.toBeInstanceOf(WorkspaceConflictError)
    await files.commit(
      { pages: [shard(idA, '本地覆盖', 3)], removedPageIds: [] },
      { base: { pages: { [idA]: before.etag! } }, force: true },
    )
    expect((await files.readPage(idA))?.content).toMatchObject({
      content: [{ content: [{ text: '本地覆盖' }] }],
    })
  })

  it('recovers a corrupt lock whose mtime is stale', async () => {
    const { directory, files } = await workspace()
    await files.commit({ index: index(), pages: [shard(idA, '初稿')], removedPageIds: [] })
    const lock = join(directory, '.lock')
    await writeFile(lock, 'not-json')
    await utimes(lock, new Date(0), new Date(0))
    await expect(files.commit({ pages: [shard(idA, '恢复写入', 2)], removedPageIds: [] })).resolves.toBeUndefined()
    expect((await files.readPage(idA))?.content).toMatchObject({ content: [{ content: [{ text: '恢复写入' }] }] })
  })

  it('recovers an old lock and refuses a live lock with a semantic error', async () => {
    const { directory, files } = await workspace()
    await files.commit({ index: index(), pages: [shard(idA, '初稿')], removedPageIds: [] })
    await writeFile(join(directory, '.lock'), JSON.stringify({ token: 'stale', createdAt: 0 }))
    await expect(files.commit({ pages: [shard(idA, '重试成功', 2)], removedPageIds: [] })).resolves.toBeUndefined()

    let release!: () => void
    const held = withWorkspaceLock(directory, () => new Promise<void>(resolve => { release = resolve }))
    await new Promise(resolve => setTimeout(resolve, 20))
    await expect(withWorkspaceLock(directory, async () => undefined, { timeoutMs: 20, pollMs: 5 }))
      .rejects.toBeInstanceOf(WorkspaceLockedError)
    release()
    await held
    expect((await files.readPage(idA))?.content).toMatchObject({
      content: [{ content: [{ text: '重试成功' }] }],
    })
    expect(JSON.parse(await readFile(join(directory, 'index.json'), 'utf8'))).toMatchObject({ version: 2 })
  })
})
