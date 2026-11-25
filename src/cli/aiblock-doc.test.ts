import { mkdtemp, readFile, rm, stat, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
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
