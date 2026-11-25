import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { afterEach, describe, expect, it } from 'vitest'
import type { PageShard, WorkspaceExternalChange, WorkspaceIndex } from '../src/workspace/workspace-format.js'
import { openWorkspaceFiles } from '../src/workspace/workspace-files.js'
import { watchWorkspace } from './workspace-watcher.js'

const directories: string[] = []
const id = '11111111-1111-4111-8111-111111111111'

afterEach(async () => {
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })))
})

function shard(text: string, updatedAt = 1): PageShard {
  return { id, content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] }, updatedAt }
}

function index(): WorkspaceIndex {
  return {
    version: 2,
    activePageId: id,
    pages: [{ id, parentId: null, title: '页面', icon: '📄', comments: [], createdAt: 1, updatedAt: 1, order: 0 }],
  }
}

async function until<T>(probe: () => T | undefined, message: string, timeout = 4_000): Promise<T> {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    const value = probe()
    if (value !== undefined) return value
    await delay(25)
  }
  throw new Error(message)
}

describe('Electron workspace watcher', { skip: process.platform === 'linux' }, () => {
  it('pushes external changes once and suppresses the app’s own writes', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'aiblock-watch-'))
    directories.push(directory)
    const files = openWorkspaceFiles(directory)
    await files.commit({ index: index(), pages: [shard('初稿')], removedPageIds: [] })
    await files.readIndexSnapshot()
    await files.readPageSnapshot(id)

    const changes: WorkspaceExternalChange[] = []
    const watcher = watchWorkspace(files, change => changes.push(change), 20)
    try {
      await delay(50)
      await writeFile(join(directory, 'pages', `${id}.json`), JSON.stringify(shard('外部修改', 2)))
      await writeFile(join(directory, 'index.json'), JSON.stringify({
        ...index(), pages: [{ ...index().pages[0]!, title: '外部标题', updatedAt: 2 }],
      }))
      const change = await until(() => changes[0], 'External change was not observed')
      expect(change).toEqual({ indexChanged: true, pageIds: [id] })

      await files.readIndexSnapshot()
      await files.readPageSnapshot(id)
      await files.commit({ pages: [shard('自身写入', 3)], removedPageIds: [] })
      await delay(250)
      expect(changes).toHaveLength(1)
    } finally {
      watcher.close()
    }
  })
})
