import { mkdtemp, open, readFile, readdir, rm, stat, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { CommentThread } from '../editor/comments'
import { testImage } from '../test/image-fixture'
import { openWorkspaceFiles } from '../workspace/workspace-files'
import { runCli } from './main'
import type { CliIO } from './main'

const directories: string[] = []

async function tempWorkspace() {
  const directory = await mkdtemp(join(tmpdir(), 'aiblock-cli-'))
  directories.push(directory)
  return directory
}

function capture(stdin?: string): CliIO & { out(): string; err(): string } {
  let stdout = ''
  let stderr = ''
  return {
    stdout: text => { stdout += text },
    stderr: text => { stderr += text },
    stdin,
    out: () => stdout,
    err: () => stderr,
  }
}

async function cli(directory: string, args: string[], stdin?: string) {
  const io = capture(stdin)
  const code = await runCli(['--workspace', directory, ...args], io)
  return { code, stdout: io.out(), stderr: io.err(), json: () => JSON.parse(io.out()) }
}

async function create(directory: string, title: string, markdown = '# 标题\n') {
  const result = await cli(directory, ['create', '--title', title, '--markdown', '-'], markdown)
  expect(result.code).toBe(0)
  return result.json().data
}

function blockIds(content: { content?: { attrs?: { blockId?: unknown }; content?: unknown[] }[] }) {
  const ids: string[] = []
  const walk = (node: { attrs?: { blockId?: unknown }; content?: unknown[] }) => {
    if (node.attrs && Object.hasOwn(node.attrs, 'blockId')) ids.push(String(node.attrs.blockId))
    for (const child of node.content ?? []) walk(child as typeof node)
  }
  walk(content)
  return ids
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })))
})

describe('aiblock-doc CLI', () => {
  it('lists, reads markdown and JSON, and creates pages with unique block IDs', async () => {
    const directory = await tempWorkspace()
    const dry = await cli(directory, ['create', '--title', '预览页', '--dry-run'])
    expect(dry.code).toBe(0)
    expect(dry.json().data.dryRun).toBe(true)
    expect((await cli(directory, ['list'])).json().data.pages).toEqual([])

    const page = await create(directory, '测试页', [
      '# 标题', '', '- 项目', '  - 嵌套', '', '```ts', 'const x = 1', '```', '',
      '> [!NOTE]', '> 重点', '', '$$x^2$$', '',
    ].join('\n'))
    const list = await cli(directory, ['list'])
    expect(list.code).toBe(0)
    expect(list.json().data.activePageId).toBe(page.page.id)
    expect(list.json().data.pages[0]).toMatchObject({ id: page.page.id, title: '测试页', parentId: null })
    expect(list.json().data.indexEtag).toBe(page.indexEtag)

    const markdown = await cli(directory, ['get', page.page.id])
    expect(markdown.code).toBe(0)
    expect(markdown.json().data.format).toBe('markdown')
    expect(markdown.json().data.content).toContain('# 标题')
    expect(markdown.json().data.etag).toBe(page.etag)

    const json = await cli(directory, ['get', page.page.id, '--format', 'json'])
    expect(json.code).toBe(0)
    const content = json.json().data.content
    expect(content.content.map((node: { type: string }) => node.type)).toEqual(
      expect.arrayContaining(['heading', 'bulletList', 'codeBlock', 'callout']),
    )
    const ids = blockIds(content)
    expect(ids.length).toBeGreaterThan(5)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.every(Boolean)).toBe(true)

    const sourceFile = join(directory, 'note.md')
    await writeFile(sourceFile, '# 文件导入\n')
    const fromFile = await cli(directory, ['create', '--title', '文件页', '--markdown', sourceFile])
    expect(fromFile.code).toBe(0)
    expect((await cli(directory, ['get', fromFile.json().data.page.id])).json().data.content).toContain('# 文件导入')

    const child = await cli(directory, ['create', '--title', '子页', '--parent', page.page.id, '--activate'])
    expect(child.code).toBe(0)
    expect((await cli(directory, ['list'])).json().data.activePageId).toBe(child.json().data.page.id)
    expect((await cli(directory, ['list'])).json().data.pages.find((item: { id: string }) => item.id === child.json().data.page.id))
      .toMatchObject({ parentId: page.page.id, order: 0 })
  })

  it('appends losslessly, enforces if-match, and supports dry-run', async () => {
    const directory = await tempWorkspace()
    const page = await create(directory, '追加页', '# 原文\n')
    const before = await cli(directory, ['get', page.page.id, '--format', 'json'])
    const markdown = '## 追加\n\n- 一\n  - 二\n\n```ts\nconst ok = true\n```\n'

    const dry = await cli(directory, ['append', page.page.id, '--if-match', before.json().data.etag, '--dry-run', '--markdown', '-'], markdown)
    expect(dry.code).toBe(0)
    expect(dry.json().data.dryRun).toBe(true)
    expect((await cli(directory, ['get', page.page.id, '--format', 'json'])).json().data.content).toEqual(before.json().data.content)

    const append = await cli(directory, ['append', page.page.id, '--if-match', before.json().data.etag, '--markdown', '-'], markdown)
    expect(append.code).toBe(0)
    expect(append.json().data.etag).not.toBe(before.json().data.etag)
    const after = await cli(directory, ['get', page.page.id, '--format', 'json'])
    expect(after.json().data.content.content.length).toBeGreaterThan(before.json().data.content.content.length)
    expect(after.json().data.content.content.map((node: { type: string }) => node.type)).toEqual(
      expect.arrayContaining(['heading', 'bulletList', 'codeBlock']),
    )

    const stale = await cli(directory, ['append', page.page.id, '--if-match', before.json().data.etag, '--markdown', '-'], '不应写入')
    expect(stale.code).toBe(4)
    expect(JSON.parse(stale.stderr).ok).toBe(false)
    expect((await cli(directory, ['get', page.page.id, '--format', 'json'])).json().data.content)
      .toEqual(after.json().data.content)
  })

  it('renames by index etag and deletes subtrees with an active fallback', async () => {
    const directory = await tempWorkspace()
    const parent = await create(directory, '父页')
    const childResult = await cli(directory, ['create', '--title', '子页', '--parent', parent.page.id, '--activate'])
    expect(childResult.code).toBe(0)
    const child = childResult.json().data
    const indexEtag = (await cli(directory, ['list'])).json().data.indexEtag

    const renamed = await cli(directory, ['rename', parent.page.id, '--title', '新父页', '--if-match', indexEtag])
    expect(renamed.code).toBe(0)
    expect((await cli(directory, ['list'])).json().data.pages.find((item: { id: string }) => item.id === parent.page.id)?.title).toBe('新父页')
    expect((await cli(directory, ['rename', parent.page.id, '--title', '旧', '--if-match', indexEtag])).code).toBe(4)

    const afterRename = (await cli(directory, ['list'])).json().data.indexEtag
    const deletedChild = await cli(directory, ['delete', child.page.id, '--if-match', afterRename])
    expect(deletedChild.code).toBe(0)
    expect(deletedChild.json().data.activePageId).toBe(parent.page.id)
    expect((await cli(directory, ['list'])).json().data.pages.map((item: { id: string }) => item.id)).toEqual([parent.page.id])

    const afterChild = (await cli(directory, ['list'])).json().data.indexEtag
    const deletedLast = await cli(directory, ['delete', parent.page.id, '--if-match', afterChild])
    expect(deletedLast.code).toBe(0)
    const fallback = (await cli(directory, ['list'])).json().data
    expect(fallback.pages).toHaveLength(1)
    expect(fallback.activePageId).toBe(fallback.pages[0].id)
    expect(fallback.pages[0].title).toBe('无标题文档')
  })

  it('serializes concurrent appends and lets only one matching etag win', async () => {
    const directory = await tempWorkspace()
    const page = await create(directory, '并发页')
    const etag = (await cli(directory, ['get', page.page.id])).json().data.etag
    const [first, second] = await Promise.all([
      cli(directory, ['append', page.page.id, '--if-match', etag, '--markdown', '-'], '甲'),
      cli(directory, ['append', page.page.id, '--if-match', etag, '--markdown', '-'], '乙'),
    ])
    expect([first.code, second.code].sort()).toEqual([0, 4])
    const content = (await cli(directory, ['get', page.page.id, '--format', 'json'])).json().data.content
    const text = JSON.stringify(content)
    expect([text.includes('甲'), text.includes('乙')].filter(Boolean)).toHaveLength(1)
  })

  it('recovers a stale lock and returns semantic errors for bad input and missing pages', async () => {
    const directory = await tempWorkspace()
    const page = await create(directory, '锁页')
    await mkdir(directory, { recursive: true })
    await writeFile(join(directory, '.lock'), JSON.stringify({ token: 'stale', createdAt: 0 }))
    const etag = (await cli(directory, ['get', page.page.id])).json().data.etag
    const appended = await cli(directory, ['append', page.page.id, '--if-match', etag, '--markdown', '-'], '锁后追加')
    expect(appended.code).toBe(0)

    expect((await cli(directory, ['get'])).code).toBe(2)
    expect((await cli(directory, ['get', 'not-a-page'])).code).toBe(2)
    expect((await cli(directory, ['get', '33333333-3333-4333-8333-333333333333'])).code).toBe(3)
    expect((await cli(directory, ['append', page.page.id, '--markdown', '-'], 'x')).code).toBe(2)
    expect((await cli(directory, ['get', page.page.id, '--format', 'xml'])).code).toBe(2)
    const before = await stat(join(directory, 'index.json'))
    expect((await cli(directory, ['create', '--title', '预览', '--dry-run'])).code).toBe(0)
    expect((await stat(join(directory, 'index.json'))).mtimeMs).toBe(before.mtimeMs)
  })

  it('reports corrupt workspace files as invalid content', async () => {
    const directory = await tempWorkspace()
    await create(directory, '损坏页')
    await writeFile(join(directory, 'index.json'), '{not json')
    const listed = await cli(directory, ['list'])
    expect(listed.code).toBe(5)
    expect(JSON.parse(listed.stderr)).toMatchObject({ ok: false, error: { code: 'invalid_content' } })
    await expect(readFile(join(directory, 'index.json'), 'utf8')).resolves.toBe('{not json')
  })
})

async function moveToTrash(directory: string, id: string) {
  const files = openWorkspaceFiles(directory)
  await files.mutate(async transaction => {
    const index = (await transaction.readIndex())!
    const page = index.pages.find(page => page.id === id)!
    const pages = index.pages.filter(page => page.id !== id)
    await transaction.write({
      index: { ...index, activePageId: pages[0]!.id, pages, trash: [...index.trash ?? [], { ...page, deletedAt: Date.now() }] },
      pages: [], removedPageIds: [],
    })
  })
}

async function seedComments(directory: string, id: string, comments: readonly CommentThread[]) {
  const files = openWorkspaceFiles(directory)
  await files.mutate(async transaction => {
    const index = (await transaction.readIndex())!
    await transaction.write({
      index: { ...index, pages: index.pages.map(page => page.id === id ? { ...page, comments } : page) },
      pages: [], removedPageIds: [],
    })
  })
}

async function writeImage(directory: string, name: string, variant = 0) {
  const file = join(directory, name)
  const { bytes } = testImage()
  await writeFile(file, variant ? Uint8Array.from([...bytes, variant]) : bytes)
  return file
}

describe('CLI body replacement and search', () => {
  // @partition update: preview, replacement, validation and two kinds of conflict
  // @partition search: title precedence, snippets, limits and exclusion of trash
  it('update: previews replacement, then commits Markdown from a file while preserving page metadata', async () => {
    const directory = await tempWorkspace()
    const parent = await create(directory, '父页')
    const initial = (await cli(directory, ['create', '--title', '子页', '--parent', parent.page.id, '--icon', '📌',
      '--markdown', '-'], '# 原稿')).json().data
    const id = initial.page.id
    const path = join(directory, 'index.json')
    const before = await readFile(path, 'utf8')
    const dry = await cli(directory, ['update', id, '--if-match', initial.etag, '--dry-run'], '预演版本')
    expect(dry.json().data).toEqual({ dryRun: true, pageId: id, etag: initial.etag, indexEtag: initial.indexEtag })
    await expect(readFile(path, 'utf8')).resolves.toBe(before)
    expect((await cli(directory, ['get', id])).json().data.content).toContain('原稿')

    const markdown = join(directory, 'new.md')
    await writeFile(markdown, '# 新正文\n\n- [x] 核对')
    const result = await cli(directory, ['update', id, '--if-match', initial.etag, '--markdown', markdown])
    const after = (await cli(directory, ['get', id, '--format', 'json'])).json().data
    expect(result.json().data).toEqual({ pageId: id, etag: after.etag, indexEtag: after.indexEtag })
    expect(after.etag).not.toBe(initial.etag)
    expect(after.indexEtag).not.toBe(initial.indexEtag)
    expect(after.content.content.map((node: { type: string }) => node.type)).toEqual(['heading', 'taskList'])
    const original = JSON.parse(before).pages[1]
    const saved = JSON.parse(await readFile(path, 'utf8')).pages[1]
    expect(saved).toEqual({ ...original, updatedAt: after.page.updatedAt })
    expect(saved.updatedAt).toBeGreaterThan(original.updatedAt)
  })

  it('update: rejects missing arguments, whitespace, empty rendered content and invalid UTF-8', async () => {
    const directory = await tempWorkspace()
    const page = await create(directory, '原页')
    const body = ['update', page.page.id, '--if-match', page.etag]
    const invalid = join(directory, 'invalid.md')
    await writeFile(invalid, Uint8Array.of(0xff, 0xfe))
    for (const [args, stdin, code] of [
      [['update', page.page.id], 'text', 2],
      [body, '   \n', 5],
      [[...body, '--markdown', '-'], '<!-- no visible content -->', 5],
      [[...body, '--markdown', invalid], undefined, 5],
    ] as const) expect((await cli(directory, [...args], stdin)).code).toBe(code)
    expect((await cli(directory, ['get', page.page.id])).json().data.etag).toBe(page.etag)
  })

  it('update: concurrent replacements allow one writer and report stale etag and occupied lock as conflicts', async () => {
    const directory = await tempWorkspace()
    const { page: { id }, etag } = await create(directory, '竞态')
    const args = ['update', id, '--if-match', etag, '--markdown', '-']
    const updates = await Promise.all([cli(directory, args, '甲'), cli(directory, args, '乙')])
    const conflict = updates.find(result => result.code === 4)!
    expect(updates.map(result => result.code).sort()).toEqual([0, 4])
    expect(JSON.parse(conflict.stderr).error.code).toBe('conflict')
    const winner = (await cli(directory, ['get', id])).json().data
    await writeFile(join(directory, '.lock'), JSON.stringify({ token: 'held', pid: process.pid, createdAt: Date.now() }))
    const locked = await cli(directory, ['update', id, '--if-match', winner.etag], '丙')
    expect(locked.code).toBe(4)
    expect(JSON.parse(locked.stderr).error.message).toContain('占用')
    expect((await cli(directory, ['get', id])).json().data.etag).toBe(winner.etag)
  })

  it('search: returns title before body with the same metadata as list and skips trash', async () => {
    const directory = await tempWorkspace()
    expect((await cli(directory, ['search', '计划'])).json().data).toEqual({ query: '计划', matches: [] })
    const body = await create(directory, '备忘', '开始 RELEASE 计划。\n')
    const title = await create(directory, 'Release')
    const deleted = await create(directory, 'release 已删', 'release 历史')
    await moveToTrash(directory, deleted.page.id)
    const result = (await cli(directory, ['search', '  release  '])).json().data
    expect(result).toEqual({ query: 'release', matches: [
      { page: title.page, titleMatch: true, snippets: [] },
      { page: body.page, titleMatch: false, snippets: ['开始 RELEASE 计划。'] },
    ] })
    expect((await cli(directory, ['search', 'release', '--limit=1'])).json().data.matches).toEqual(result.matches.slice(0, 1))
  })

  it('search: rejects a missing or blank query and non-positive or non-integer limits', async () => {
    const directory = await tempWorkspace()
    for (const args of [['search'], ['search', '  '], ...['0', '-1', '1.5', '1e2', 'NaN', ''].map(
      limit => ['search', 'needle', '--limit', limit],
    )]) expect((await cli(directory, args)).code).toBe(2)
  })
})

describe('CLI assets and trash compatibility', () => {
  // @partition add-image: deterministic preview, shared storage, format and size failures
  // @partition gc: cutoff, preview counts, trash references and corruption
  // @partition legacy: all six original commands preserve a pre-existing trash array
  it('add-image: returns a deterministic reference without writing, deduplicates and embeds it in Markdown', async () => {
    const directory = await tempWorkspace()
    const file = await writeImage(directory, 'fixture.data')
    const dry = (await cli(directory, ['add-image', file, '--dry-run'])).json().data
    expect(dry).toMatchObject({ dryRun: true, created: true, asset: { mime: 'image/png', width: 1, height: 1 } })
    expect(await readdir(directory)).toEqual(['fixture.data'])
    const saved = (await cli(directory, ['add-image', file])).json().data
    expect(saved).toMatchObject({ created: true, asset: { id: dry.asset.id }, markdown: '![](asset:' + dry.asset.id + ')' })
    const again = (await cli(directory, ['add-image', file])).json().data
    expect(again).toEqual({ ...saved, created: false })
    expect(await readdir(join(directory, 'assets'))).toEqual([saved.asset.id, saved.asset.id + '.json'])
    const page = await create(directory, '图片', saved.markdown)
    expect((await cli(directory, ['get', page.page.id])).json().data.content).toContain(saved.markdown)
    expect((await cli(directory, ['get', page.page.id, '--format', 'json'])).json().data.content.content[0])
      .toMatchObject({ type: 'imageBlock', attrs: { assetId: saved.asset.id } })
  })

  it('add-image: rejects a missing file with exit 3 and invalid signature, dimensions or size with exit 5', async () => {
    const directory = await tempWorkspace()
    const bogus = join(directory, 'fake.png')
    await writeFile(bogus, 'text')
    const wrongSize = await writeImage(directory, 'huge-dimensions.png')
    const bytes = await readFile(wrongSize)
    bytes.writeUInt32BE(65_000, 16)
    await writeFile(wrongSize, bytes)
    const oversized = join(directory, 'oversized')
    const handle = await open(oversized, 'wx')
    try { await handle.truncate(32 * 1024 * 1024 + 1) } finally { await handle.close() }
    expect((await cli(directory, ['add-image'])).code).toBe(2)
    expect((await cli(directory, ['add-image', join(directory, 'missing.png')])).code).toBe(3)
    for (const file of [bogus, wrongSize, oversized]) expect((await cli(directory, ['add-image', file])).code).toBe(5)
    await expect(stat(join(directory, 'assets'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('gc: previews aged orphans and reclaims only those files, including when trash holds an image', async () => {
    const directory = await tempWorkspace()
    const [kept, orphan] = await Promise.all(['kept', 'orphan'].map(async (name, i) => {
      const file = await writeImage(directory, name, i)
      return (await cli(directory, ['add-image', file])).json().data
    }))
    await create(directory, '活页')
    const trashed = await create(directory, '回收站页', kept.markdown)
    await moveToTrash(directory, trashed.page.id)
    expect((await cli(directory, ['gc'])).json().data.orphanIds).toEqual([])
    const preview = (await cli(directory, ['gc', '--dry-run', '--grace-ms', '0'])).json().data
    expect(preview).toEqual({ scannedPages: 2, referencedCount: 1, orphanIds: [orphan.asset.id], removedCount: 0, reclaimedBytes: 0, dryRun: true })
    await expect(stat(join(directory, 'assets', orphan.asset.id))).resolves.toBeDefined()
    const result = (await cli(directory, ['gc', '--grace-ms=0'])).json().data
    expect(result).toEqual({ scannedPages: 2, referencedCount: 1, orphanIds: [orphan.asset.id], removedCount: 1, reclaimedBytes: orphan.asset.byteLength })
    expect(await readdir(join(directory, 'assets'))).toEqual([kept.asset.id, kept.asset.id + '.json'])
  })

  it.each(['missing', 'malformed', 'invalid document'])('gc: aborts with exit 5 on a %s shard before deleting any candidate', async damage => {
    const directory = await tempWorkspace()
    await create(directory, '活页')
    const { page } = await create(directory, '回收站')
    await moveToTrash(directory, page.id)
    const { asset } = (await cli(directory, ['add-image', await writeImage(directory, 'orphan')])).json().data
    const path = join(directory, 'pages', page.id + '.json')
    if (damage === 'missing') await rm(path)
    else await writeFile(path, damage === 'malformed' ? '{' : JSON.stringify({
      id: page.id, updatedAt: 0, content: { type: 'doc', content: [{ type: 'unknown' }] },
    }))
    const result = await cli(directory, ['gc', '--grace-ms', '0'])
    expect(result.code).toBe(5)
    expect(await readdir(join(directory, 'assets'))).toEqual([asset.id, asset.id + '.json'])
    expect((await cli(directory, ['gc', '--grace-ms', '-1'])).code).toBe(2)
  })

  it('legacy: list, get, create, append, rename and delete preserve existing trash and its shard', async () => {
    const directory = await tempWorkspace()
    const live = await create(directory, '活页')
    const deleted = await create(directory, '回收站页')
    await moveToTrash(directory, deleted.page.id)
    const indexPath = join(directory, 'index.json')
    const shardPath = join(directory, 'pages', deleted.page.id + '.json')
    const original = JSON.parse(await readFile(indexPath, 'utf8')).trash
    const originalShard = await readFile(shardPath, 'utf8')
    expect((await cli(directory, ['list'])).json().data.pages).toEqual([live.page])
    expect((await cli(directory, ['get', live.page.id])).code).toBe(0)
    expect((await cli(directory, ['get', deleted.page.id])).code).toBe(3)
    const newPage = await create(directory, '新增')
    const appended = (await cli(directory, ['append', newPage.page.id, '--if-match', newPage.etag], '追加')).json().data
    const renamed = (await cli(directory, ['rename', newPage.page.id, '--title', '改名', '--if-match', appended.indexEtag])).json().data
    expect((await cli(directory, ['delete', newPage.page.id, '--if-match', renamed.indexEtag, '--permanent'])).json().data.removedPageIds)
      .toEqual([newPage.page.id])
    expect(JSON.parse(await readFile(indexPath, 'utf8')).trash).toEqual(original)
    await expect(readFile(shardPath, 'utf8')).resolves.toBe(originalShard)
  })
})

describe('CLI progressive reading and @active', () => {
  // @partition outline: heading indexes, block summaries and legacy get output
  // @partition slices: single block, section, block comments and invalid targets
  // @partition active: read/write commands and uninitialized workspace
  it('outline and block or section slices expose stable block IDs without changing legacy get', async () => {
    const directory = await tempWorkspace()
    const page = await create(directory, '渐进页', '# 总览\n\n第一段\n\n## 小节\n\n第二段\n\n### 子节\n\n第三段\n\n## 下一节\n\n第四段\n')
    const legacy = (await cli(directory, ['get', page.page.id])).json().data
    expect(legacy.format).toBe('markdown')
    expect(legacy.content).not.toContain('<!-- block:')

    const outline = (await cli(directory, ['outline', '@active', '--blocks'])).json().data
    expect(outline.page.id).toBe(page.page.id)
    expect(outline.blockCount).toBe(8)
    expect(outline.outline.map((entry: { text: string }) => entry.text)).toEqual(['总览', '小节', '子节', '下一节'])
    expect(outline.blocks).toHaveLength(8)
    expect(outline.blocks[0]).toMatchObject({ type: 'heading', preview: '总览' })

    const sectionEntry = outline.outline.find((entry: { text: string }) => entry.text === '小节')
    const section = (await cli(directory, ['get', '@active', '--section', sectionEntry.blockId, '--with-block-ids'])).json().data
    expect(section.content).toContain(`<!-- block:${sectionEntry.blockId} -->`)
    expect(section.content).toContain('第二段')
    expect(section.content).toContain('第三段')
    expect(section.content).not.toContain('第四段')

    const paragraph = outline.blocks.find((block: { type: string; preview: string }) => block.type === 'paragraph' && block.preview === '第二段')
    expect((await cli(directory, ['get', '@active', '--block', paragraph.blockId])).json().data.content).toBe('第二段\n')
    expect((await cli(directory, ['get', '@active', '--format', 'json', '--block', paragraph.blockId])).json().data.content.content)
      .toHaveLength(1)

    expect((await cli(directory, ['get', '@active', '--block', paragraph.blockId, '--section', sectionEntry.blockId])).code).toBe(2)
    expect((await cli(directory, ['get', '@active', '--format', 'json', '--block', paragraph.blockId, '--with-block-ids'])).code).toBe(2)
    expect((await cli(directory, ['get', '@active', '--block', 'missing-block'])).code).toBe(3)
    expect((await cli(directory, ['get', '@active', '--section', paragraph.blockId])).code).toBe(5)
  })

  it('@active resolves reads and writes and returns 3 for an uninitialized workspace', async () => {
    const empty = await tempWorkspace()
    expect((await cli(empty, ['get', '@active'])).code).toBe(3)
    expect((await cli(empty, ['comments', '@active'])).code).toBe(3)

    const directory = await tempWorkspace()
    const page = await create(directory, '活动页', '# 活动\n\n正文\n')
    expect((await cli(directory, ['get', '@active'])).json().data.page.id).toBe(page.page.id)

    const appended = await cli(directory, ['append', '@active', '--if-match', page.etag, '--markdown', '-'], '追加')
    expect(appended.code).toBe(0)
    const afterAppend = (await cli(directory, ['get', '@active', '--format', 'json'])).json().data
    const updated = await cli(directory, ['update', '@active', '--if-match', afterAppend.etag, '--markdown', '-'], '# 新标题\n\n新正文\n')
    expect(updated.code).toBe(0)
    const renamed = await cli(directory, ['rename', '@active', '--title', '改名', '--if-match', updated.json().data.indexEtag])
    expect(renamed.code).toBe(0)
    expect((await cli(directory, ['outline', '@active'])).code).toBe(0)
    expect((await cli(directory, ['comments', '@active'])).code).toBe(0)

    const moved = await cli(directory, ['move', '@active', '--parent', 'root', '--if-match', renamed.json().data.indexEtag])
    expect(moved.code).toBe(0)
    expect(moved.json().data.parentId).toBeNull()

    const doc = (await cli(directory, ['get', '@active', '--format', 'json'])).json().data
    const target = doc.content.content.find((node: { type: string }) => node.type === 'paragraph')
    expect((await cli(directory, ['patch', '@active', '--if-match', doc.etag, '--replace-block', target.attrs.blockId, '--markdown', '-'], '替换段')).code).toBe(0)

    const beforeDelete = (await cli(directory, ['list'])).json().data
    const deleted = await cli(directory, ['delete', '@active', '--if-match', beforeDelete.indexEtag])
    expect(deleted.code).toBe(0)
    expect(deleted.json().data).toMatchObject({ trashed: true, removedPageIds: [page.page.id] })
  })
})

describe('CLI block patch and comment collaboration', () => {
  // @partition patch: preview, replacement, section, deletion, stale etag and invalid targets
  // @partition preserve: untouched block IDs, comments and rich Markdown behavior
  // @partition comments: unresolved filter, AI reply, resolve, dry-run and conflicts
  it('patches blocks and sections while preserving untouched block IDs and comments', async () => {
    const directory = await tempWorkspace()
    const page = await create(directory, '补丁页', '# 总览\n\n第一段\n\n## 小节\n\n第二段\n\n## 下一节\n\n第三段\n')
    await seedComments(directory, page.page.id, [
      { id: 'thread-1', quote: '第一段', messages: [], resolved: false },
    ])
    const outline = (await cli(directory, ['outline', page.page.id, '--blocks'])).json().data
    const first = outline.blocks.find((block: { preview: string }) => block.preview === '第一段')
    const sectionEntry = outline.outline.find((entry: { text: string }) => entry.text === '小节')
    const nextEntry = outline.outline.find((entry: { text: string }) => entry.text === '下一节')
    const before = (await cli(directory, ['get', page.page.id, '--format', 'json'])).json().data
    const headingId = before.content.content[0].attrs.blockId

    const dry = await cli(directory, ['patch', page.page.id, '--if-match', before.etag, '--replace-block', first.blockId, '--markdown', '-', '--dry-run'], '替换第一段')
    expect(dry.json().data).toEqual({
      dryRun: true, pageId: page.page.id, operation: 'replace-block', targetBlockId: first.blockId,
      etag: before.etag, indexEtag: before.indexEtag,
    })
    const patched = await cli(directory, ['patch', page.page.id, '--if-match', before.etag, '--replace-block', first.blockId, '--markdown', '-'], '替换第一段')
    const after = (await cli(directory, ['get', page.page.id, '--format', 'json'])).json().data
    expect(patched.json().data).toMatchObject({ pageId: page.page.id, operation: 'replace-block', targetBlockId: first.blockId })
    expect(after.content.content[0].attrs.blockId).toBe(headingId)
    expect(after.content.content[1].content[0].text).toBe('替换第一段')
    expect(after.content.content[1].attrs.blockId).toBeTruthy()
    expect(after.content.content[1].attrs.blockId).not.toBe(first.blockId)
    expect((await cli(directory, ['comments', page.page.id])).json().data.comments).toHaveLength(1)

    const section = await cli(directory, ['patch', page.page.id, '--if-match', after.etag, '--replace-section', sectionEntry.blockId, '--markdown', '-'], '## 替换小节\n\n新内容\n')
    expect(section.code).toBe(0)
    const sectionAfter = (await cli(directory, ['get', page.page.id, '--format', 'json'])).json().data
    expect(sectionAfter.content.content.some((node: { attrs?: { blockId?: string } }) => node.attrs?.blockId === nextEntry.blockId)).toBe(true)
    expect(JSON.stringify(sectionAfter.content)).toContain('替换小节')
    expect(JSON.stringify(sectionAfter.content)).toContain('新内容')

    const removable = sectionAfter.content.content.find((node: { content?: { text?: string }[] }) => node.content?.[0]?.text === '新内容')
    const deleted = await cli(directory, ['patch', page.page.id, '--if-match', sectionAfter.etag, '--delete-block', removable.attrs.blockId])
    expect(deleted.code).toBe(0)
    const afterDelete = (await cli(directory, ['get', page.page.id, '--format', 'json'])).json().data
    expect(JSON.stringify(afterDelete.content)).not.toContain(removable.attrs.blockId)

    expect((await cli(directory, ['patch', page.page.id, '--if-match', afterDelete.etag, '--replace-block', 'missing', '--markdown', '-'], 'x')).code).toBe(3)
    const paragraphId = afterDelete.content.content.find((node: { type: string }) => node.type === 'paragraph').attrs.blockId
    expect((await cli(directory, ['patch', page.page.id, '--if-match', afterDelete.etag, '--replace-section', paragraphId, '--markdown', '-'], 'x')).code).toBe(5)
    expect((await cli(directory, ['patch', page.page.id, '--if-match', afterDelete.etag, '--replace-block', paragraphId, '--delete-block', paragraphId])).code).toBe(2)
    expect((await cli(directory, ['patch', page.page.id, '--if-match', afterDelete.etag, '--delete-block', paragraphId, '--markdown', '-'], 'x')).code).toBe(2)
    expect((await cli(directory, ['patch', page.page.id, '--if-match', before.etag, '--replace-block', paragraphId, '--markdown', '-'], '过期')).code).toBe(4)
  })

  it('reads and replies to comment threads, resolves them and protects index etags', async () => {
    const directory = await tempWorkspace()
    const page = await create(directory, '评论页', '# 评论\n\n第一段\n\n第二段\n')
    await seedComments(directory, page.page.id, [
      { id: 'thread-1', quote: '第一段', messages: [{ id: 'message-1', author: '人', text: '请处理' }], resolved: false },
      { id: 'thread-2', quote: '第二段', messages: [], resolved: true },
    ])
    const all = (await cli(directory, ['comments', '@active'])).json().data
    expect(all.page.id).toBe(page.page.id)
    expect(all.comments).toHaveLength(2)
    expect((await cli(directory, ['comments', '@active', '--unresolved'])).json().data.comments.map((thread: { id: string }) => thread.id))
      .toEqual(['thread-1'])

    const dry = await cli(directory, ['comment-reply', '@active', 'thread-1', '--text', '已处理', '--if-match', all.indexEtag, '--dry-run'])
    expect(dry.json().data).toMatchObject({ dryRun: true, threadId: 'thread-1', resolved: false, message: { author: 'AI', text: '已处理' } })
    expect((await cli(directory, ['comments', '@active'])).json().data.indexEtag).toBe(all.indexEtag)

    const reply = await cli(directory, ['comment-reply', '@active', 'thread-1', '--text', '已处理，请复核。', '--author', 'Agent', '--if-match', all.indexEtag])
    expect(reply.json().data).toMatchObject({ pageId: page.page.id, threadId: 'thread-1', resolved: false, message: { author: 'Agent', text: '已处理，请复核。' } })
    expect(reply.json().data.indexEtag).not.toBe(all.indexEtag)
    expect((await cli(directory, ['comments', '@active', '--unresolved'])).json().data.comments).toHaveLength(1)

    const resolved = await cli(directory, ['comment-reply', page.page.id, 'thread-1', '--text', '完成', '--resolve', '--if-match', reply.json().data.indexEtag])
    expect(resolved.json().data.resolved).toBe(true)
    expect((await cli(directory, ['comments', '@active', '--unresolved'])).json().data.comments).toEqual([])
    const threads = (await cli(directory, ['comments', '@active'])).json().data.comments
    expect(threads.find((thread: { id: string }) => thread.id === 'thread-1').messages).toHaveLength(3)

    expect((await cli(directory, ['comment-reply', '@active', 'thread-1', '--text', 'x', '--if-match', all.indexEtag])).code).toBe(4)
    expect((await cli(directory, ['comment-reply', '@active', 'missing-thread', '--text', 'x', '--if-match', resolved.json().data.indexEtag])).code).toBe(3)
    expect((await cli(directory, ['comment-reply', '@active', 'thread-1', '--text', '', '--if-match', resolved.json().data.indexEtag])).code).toBe(2)
    expect((await cli(directory, ['comment-reply', '@active', 'thread-1', '--text', '   ', '--if-match', resolved.json().data.indexEtag])).code).toBe(5)
  })
})

describe('CLI page tree and recycle bin', () => {
  // @partition move: parent, root, dry-run, cycles and missing parents
  // @partition delete: soft trash, permanent purge, trash list and restore
  // @partition restore: subtree, promoted root, fallback page and etag guards
  it('moves pages to the end of a parent and rejects self or descendant cycles', async () => {
    const directory = await tempWorkspace()
    const a = await create(directory, 'A')
    const b = await create(directory, 'B')
    const c = (await cli(directory, ['create', '--title', 'C', '--parent', a.page.id])).json().data
    const firstIndex = (await cli(directory, ['list'])).json().data.indexEtag
    const moved = await cli(directory, ['move', b.page.id, '--parent', a.page.id, '--if-match', firstIndex])
    expect(moved.code).toBe(0)
    expect(moved.json().data).toMatchObject({ pageId: b.page.id, parentId: a.page.id, order: 1 })

    const movedIndex = moved.json().data.indexEtag
    expect((await cli(directory, ['move', a.page.id, '--parent', c.page.id, '--if-match', movedIndex])).code).toBe(5)
    expect((await cli(directory, ['move', a.page.id, '--parent', a.page.id, '--if-match', movedIndex])).code).toBe(5)
    expect((await cli(directory, ['move', b.page.id, '--parent', '33333333-3333-4333-8333-333333333333', '--if-match', movedIndex])).code).toBe(3)

    const dry = await cli(directory, ['move', b.page.id, '--parent', 'root', '--if-match', movedIndex, '--dry-run'])
    expect(dry.json().data).toMatchObject({ dryRun: true, parentId: null, order: 1 })
    const stillNested = (await cli(directory, ['list'])).json().data.pages.find((page: { id: string }) => page.id === b.page.id)
    expect(stillNested.parentId).toBe(a.page.id)

    const activeMove = await cli(directory, ['move', '@active', '--parent', 'root', '--if-match', movedIndex])
    expect(activeMove.code).toBe(0)
    expect(activeMove.json().data).toMatchObject({ pageId: a.page.id, parentId: null })
    expect((await cli(directory, ['move', b.page.id, '--parent', 'root', '--if-match', firstIndex])).code).toBe(4)
  })

  it('soft deletes into trash, restores subtrees and only purges shards with --permanent', async () => {
    const directory = await tempWorkspace()
    const parent = await create(directory, '父页')
    const child = (await cli(directory, ['create', '--title', '子页', '--parent', parent.page.id])).json().data
    const keep = (await cli(directory, ['create', '--title', '保留页', '--activate'])).json().data
    const indexEtag = (await cli(directory, ['list'])).json().data.indexEtag

    const deleted = await cli(directory, ['delete', parent.page.id, '--if-match', indexEtag])
    expect(deleted.code).toBe(0)
    expect(deleted.json().data).toMatchObject({ trashed: true, activePageId: keep.page.id })
    expect(deleted.json().data.removedPageIds).toEqual(expect.arrayContaining([parent.page.id, child.page.id]))
    expect((await cli(directory, ['list'])).json().data.pages.map((page: { id: string }) => page.id)).toEqual([keep.page.id])
    expect((await cli(directory, ['get', parent.page.id])).code).toBe(3)
    await expect(stat(join(directory, 'pages', parent.page.id + '.json'))).resolves.toBeDefined()
    await expect(stat(join(directory, 'pages', child.page.id + '.json'))).resolves.toBeDefined()

    const trash = (await cli(directory, ['trash-list'])).json().data
    expect(trash.trash).toHaveLength(2)
    expect(trash.trash.map((page: { id: string }) => page.id)).toEqual(expect.arrayContaining([parent.page.id, child.page.id]))
    expect(trash.trash.every((page: { deletedAt: number }) => Number.isFinite(page.deletedAt))).toBe(true)
    expect((await cli(directory, ['restore', '33333333-3333-4333-8333-333333333333', '--if-match', trash.indexEtag])).code).toBe(3)

    const restored = await cli(directory, ['restore', parent.page.id, '--if-match', trash.indexEtag])
    expect(restored.code).toBe(0)
    expect(restored.json().data.restoredPageIds).toEqual(expect.arrayContaining([parent.page.id, child.page.id]))
    expect(restored.json().data.page).toMatchObject({ id: parent.page.id, parentId: null })
    expect((await cli(directory, ['trash-list'])).json().data.trash).toEqual([])
    expect((await cli(directory, ['list'])).json().data.pages.map((page: { id: string }) => page.id))
      .toEqual(expect.arrayContaining([parent.page.id, child.page.id, keep.page.id]))

    const beforeDry = (await cli(directory, ['list'])).json().data.indexEtag
    const dry = await cli(directory, ['delete', child.page.id, '--if-match', beforeDry, '--dry-run'])
    expect(dry.json().data).toMatchObject({ dryRun: true, trashed: true, removedPageIds: [child.page.id] })
    expect((await cli(directory, ['list'])).json().data.indexEtag).toBe(beforeDry)

    const hardened = await cli(directory, ['delete', child.page.id, '--if-match', beforeDry, '--permanent'])
    expect(hardened.json().data).toMatchObject({ trashed: false, removedPageIds: [child.page.id] })
    await expect(stat(join(directory, 'pages', child.page.id + '.json'))).rejects.toMatchObject({ code: 'ENOENT' })
    expect((await cli(directory, ['trash-list'])).json().data.trash).toEqual([])
    expect((await cli(directory, ['delete', keep.page.id, '--if-match', trash.indexEtag])).code).toBe(4)
  })

  it('restores a child whose parent stays in trash as a root page', async () => {
    const directory = await tempWorkspace()
    const parent = await create(directory, '父页')
    const child = (await cli(directory, ['create', '--title', '子页', '--parent', parent.page.id])).json().data
    await create(directory, '保留页')
    const indexEtag = (await cli(directory, ['list'])).json().data.indexEtag
    await cli(directory, ['delete', parent.page.id, '--if-match', indexEtag])
    const trash = (await cli(directory, ['trash-list'])).json().data
    const restored = await cli(directory, ['restore', child.page.id, '--if-match', trash.indexEtag])
    expect(restored.code).toBe(0)
    expect(restored.json().data.restoredPageIds).toEqual([child.page.id])
    expect(restored.json().data.page).toMatchObject({ id: child.page.id, parentId: null })
    expect((await cli(directory, ['trash-list'])).json().data.trash.map((page: { id: string }) => page.id)).toEqual([parent.page.id])
  })

  it('soft deleting the last live page creates a blank fallback and keeps the old page restorable', async () => {
    const directory = await tempWorkspace()
    const page = await create(directory, '孤页')
    const indexEtag = (await cli(directory, ['list'])).json().data.indexEtag
    const deleted = await cli(directory, ['delete', page.page.id, '--if-match', indexEtag])
    expect(deleted.json().data).toMatchObject({ trashed: true, removedPageIds: [page.page.id] })
    const fallback = (await cli(directory, ['list'])).json().data
    expect(fallback.pages).toHaveLength(1)
    expect(fallback.pages[0].title).toBe('无标题文档')
    expect(fallback.pages[0].id).not.toBe(page.page.id)
    const trash = (await cli(directory, ['trash-list'])).json().data
    const restored = await cli(directory, ['restore', page.page.id, '--if-match', trash.indexEtag])
    expect(restored.json().data.restoredPageIds).toEqual([page.page.id])
    expect((await cli(directory, ['list'])).json().data.pages.map((item: { id: string }) => item.id))
      .toEqual(expect.arrayContaining([page.page.id, fallback.pages[0].id]))
  })
})
