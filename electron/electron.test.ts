import { mkdtemp, mkdir, readFile, readdir, rm, stat, truncate, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import fc from 'fast-check'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { createMainLogger, createRendererRecovery } from './logger.js'
import { contentSecurityPolicy, decideNavigation, developmentUrl, externalUrl, isAppDocument } from './security.js'
import { assetRequestId, createImageAssetFiles, createWorkspaceFiles, isSaveFileOptions, pruneOrphanImageAssets, readMarkdownFile, writeAtomicText } from './storage.js'
import { testImage } from '../src/test/image-fixture.js'
import { splitLegacyWorkspace } from '../src/workspace/workspace-format.js'
import { parseWindowState, restoreWindowState } from './window-state.js'

const primary = { x: 0, y: 24, width: 1440, height: 876 }
const leftDisplay = { x: -1920, y: 24, width: 1920, height: 1056 }

describe('desktop window state', () => {
  // @partition geometry: default, valid, straddled, off-screen and sub-minimum displays
  // @partition parse: valid and damaged profile data
  it('maximizes on the recorded display and retains a fully visible normal rectangle', () => {
    const saved = { bounds: { x: -1780, y: 90, width: 1000, height: 800 }, maximized: true }
    expect(restoreWindowState(parseWindowState(JSON.stringify(saved)), primary, [leftDisplay])).toEqual(saved)
  })

  it('moves a straddled window entirely onto the display with the largest overlap', () => {
    const saved = { bounds: { x: -750, y: -40, width: 1000, height: 720 }, maximized: false }
    expect(restoreWindowState(saved, primary, [leftDisplay]).bounds).toEqual({
      x: -1000, y: 24, width: 1000, height: 720,
    })
  })

  it('centres a window whose previous monitor has been disconnected', () => {
    const saved = { bounds: { x: -1700, y: 70, width: 1000, height: 700 }, maximized: false }
    expect(restoreWindowState(saved, primary).bounds).toEqual({ x: 220, y: 112, width: 1000, height: 700 })
  })

  it('starts within a small screen even when the preferred and minimum sizes exceed it', () => {
    const small = { x: 1440, y: 24, width: 800, height: 570 }
    expect(restoreWindowState(null, small)).toEqual({ bounds: small, maximized: false })
  })

  it.each([null, '{', '[]', '{"bounds":null}', '{"bounds":{"x":0,"y":0,"width":0,"height":800}}',
    '{"bounds":{"x":1.5,"y":0,"width":1100,"height":800}}'])('ignores unreadable state %s and starts on screen', raw => {
    expect(parseWindowState(raw)).toBeNull()
    expect(restoreWindowState(parseWindowState(raw), primary).bounds).toEqual(primary)
  })

  it('restored bounds stay visible and applying restoration again preserves the result', () => {
    fc.assert(fc.property(fc.record({
      x: fc.integer({ min: -8000, max: 8000 }),
      y: fc.integer({ min: -3000, max: 3000 }),
      width: fc.integer({ min: 1, max: 5000 }),
      height: fc.integer({ min: 1, max: 5000 }),
    }), bounds => {
      const result = restoreWindowState({ bounds, maximized: false }, primary, [leftDisplay])
      const { x, y, width, height } = result.bounds
      expect(width).toBeGreaterThanOrEqual(900)
      expect(height).toBeGreaterThanOrEqual(620)
      expect([primary, leftDisplay].some(area =>
        x >= area.x && y >= area.y && x + width <= area.x + area.width && y + height <= area.y + area.height,
      )).toBe(true)
      expect(restoreWindowState(result, primary, [leftDisplay])).toEqual(result)
    }))
  })
})

describe('desktop navigation policy', () => {
  // @partition navigation: document, external links and denied paths
  // @partition development: only the local Vite server can host the bridge
  const file = 'file:///Applications/AIBlock%20Editor.app/Contents/Resources/app.asar/dist/index.html'

  it('recognizes only the loaded document and allows its page and block fragments', () => {
    const hash = `${file}#page=alpha&block=beta`
    expect(isAppDocument(hash, file)).toBe(true)
    expect(decideNavigation(hash, file)).toEqual({ kind: 'allow' })
    expect(decideNavigation(file + '?next=/tmp', file)).toEqual({ kind: 'deny' })
    expect(decideNavigation('file:///tmp/index.html', file)).toEqual({ kind: 'deny' })
  })

  it.each(['http://example.test/a', 'https://example.test/#block', 'mailto:help@example.test'])(
    'hands %s to the OS instead of replacing the editor', url => {
      expect(decideNavigation(url, file)).toEqual({ kind: 'external', url })
    },
  )

  it.each([
    'javascript:void(0)', 'data:text/plain,hello', 'file:///tmp/note.md', 'blob:https://example.test/id',
    'ftp://example.test/file', 'custom:action', 'https://someone@example.test/', '//example.test/',
    'ht\ttps://example.test/',
  ])('does not send %s to the OS', url => {
    expect(externalUrl(url)).toBeNull()
    expect(decideNavigation(url, file)).toEqual({ kind: 'deny' })
  })

  it('trusts the specific loopback document during development', () => {
    const url = 'http://127.0.0.1:52167/'
    expect(developmentUrl(url)).toBe(url)
    expect(decideNavigation(`${url}#page=alpha`, url)).toEqual({ kind: 'allow' })
    expect(decideNavigation('http://127.0.0.1:52168/', url)).toEqual({ kind: 'external', url: 'http://127.0.0.1:52168/' })
    expect(developmentUrl('https://example.test/')).toBeNull()
    expect(developmentUrl('http://127.0.0.1:52167/private')).toBeNull()
    expect(developmentUrl('http://127.0.0.1.attacker.test:52167/')).toBeNull()
  })
})

describe('desktop document CSP', () => {
  // @partition permissions: production resources and development loopback HMR
  function directives(dev: boolean) {
    return new Map(contentSecurityPolicy(dev).split('; ').map(directive => {
      const [name, ...sources] = directive.split(' ')
      return [name, sources]
    }))
  }

  it('permits packaged resources, blob workers and rich document images while denying unsafe scripts and frames', () => {
    const policy = directives(false)
    expect(policy.get('script-src')).toEqual(["'self'"])
    expect(policy.get('worker-src')).toEqual(["'self'", 'blob:'])
    expect(policy.get('style-src')).toContain("'unsafe-inline'")
    expect(policy.get('img-src')).toEqual(expect.arrayContaining(['aiblock-asset:', 'blob:', 'data:', 'https:', 'http:']))
    expect(policy.get('font-src')).toEqual(["'self'", 'data:'])
    expect(policy.get('connect-src')).toEqual(["'self'", 'aiblock-asset:', 'blob:'])
    for (const name of ['frame-ancestors', 'object-src']) expect(policy.get(name)).toEqual(["'none'"])
    expect(policy.get('base-uri')).toEqual(["'self'"])
    expect(policy.get('default-src')).toEqual(["'self'"])
  })

  it('opens only loopback script and HMR connections in development', () => {
    const dev = directives(true)
    expect(dev.get('script-src')).toEqual(["'self'", 'http://127.0.0.1:*'])
    expect(dev.get('connect-src')).toEqual(["'self'", 'aiblock-asset:', 'blob:', 'http://127.0.0.1:*', 'ws://127.0.0.1:*'])
    dev.delete('script-src')
    dev.delete('connect-src')
    const production = directives(false)
    production.delete('script-src')
    production.delete('connect-src')
    expect(dev).toEqual(production)
  })
})

async function profile() {
  const directory = await mkdtemp(join(tmpdir(), 'aiblock-editor-test-'))
  onTestFinished(() => rm(directory, { recursive: true, force: true }))
  return {
    directory, legacyPath: join(directory, 'workspace.json'),
    indexPath: join(directory, 'workspace', 'index.json'),
    pagesPath: join(directory, 'workspace', 'pages'),
    workspace: createWorkspaceFiles(directory),
  }
}

describe('desktop renderer recovery', () => {
  // @partition exits: clean, repeated, and outside the crash window
  // @partition choices: logs preserve a recovery path, reload and quit require a decision
  const crash = { reason: 'crashed', exitCode: 3 }

  async function recovery() {
    const { directory } = await profile()
    const logger = createMainLogger(directory)
    const actions = {
      available: vi.fn(() => true),
      prompt: vi.fn<(repeated: boolean) => Promise<'reload' | 'logs' | 'quit'>>().mockResolvedValue('reload'),
      openLogs: vi.fn(async () => {}),
      reload: vi.fn(),
      quit: vi.fn(),
    }
    let now = 0
    return {
      actions, handle: createRendererRecovery(logger, actions, () => now),
      time: (value: number) => { now = value },
      log: () => readFile(join(logger.directory, 'main.log'), 'utf8'),
    }
  }

  it('logs a clean exit and a crash but only prompts after the crash', async () => {
    const { actions, handle, log } = await recovery()
    await handle({ reason: 'clean-exit', exitCode: 0 })
    expect(actions.prompt).not.toHaveBeenCalled()
    await handle(crash)
    expect(actions.prompt).toHaveBeenCalledExactlyOnceWith(false)
    expect(actions.reload).toHaveBeenCalledOnce()
    expect((await log()).trimEnd().split('\n').map(line => JSON.parse(line))).toMatchObject([
      { context: 'render-process-gone', level: 'info', detail: expect.stringContaining('clean-exit') },
      { context: 'render-process-gone', level: 'error', detail: expect.stringContaining('exitCode: 3') },
    ])
  })

  it('marks a crash at ten seconds as repeated and resets the default after a quiet interval', async () => {
    const { actions, handle, time } = await recovery()
    await handle(crash)
    time(10_000)
    actions.prompt.mockResolvedValueOnce('quit')
    await handle(crash)
    expect(actions.prompt).toHaveBeenLastCalledWith(true)
    expect(actions.reload).toHaveBeenCalledOnce()
    expect(actions.quit).toHaveBeenCalledOnce()
    time(20_001)
    await handle(crash)
    expect(actions.prompt).toHaveBeenLastCalledWith(false)
  })

  it('opens logs and waits for another choice before reloading', async () => {
    const { actions, handle } = await recovery()
    actions.prompt.mockResolvedValueOnce('logs')
    await handle(crash)
    expect(actions.openLogs).toHaveBeenCalledOnce()
    expect(actions.prompt).toHaveBeenCalledTimes(2)
    expect(actions.reload).toHaveBeenCalledOnce()
    expect(actions.quit).not.toHaveBeenCalled()
  })

  it('does not stack crash dialogs or act on a response after the window closes', async () => {
    const { actions, handle, log } = await recovery()
    let answer!: (choice: 'reload') => void
    actions.prompt.mockImplementationOnce(() => new Promise(resolve => { answer = resolve }))
    const first = handle(crash)
    await handle(crash)
    expect(actions.prompt).toHaveBeenCalledOnce()
    actions.available.mockReturnValue(false)
    answer('reload')
    await first
    expect(actions.reload).not.toHaveBeenCalled()
    expect((await log()).trimEnd().split('\n')).toHaveLength(2)
  })
})

const a = 'ec6db70c-08ab-426f-ad6b-fa341659b64a'
const b = '861cf04e-ea85-41dc-af60-de823714fd21'
const richContent = {
  type: 'doc', content: [{ type: 'codeBlock', attrs: { language: 'mermaid', viewMode: 'split', blockId: 'keep' },
    content: [{ type: 'text', text: 'graph TB\nA-->B' }] }],
}
const legacyPages = [a, b].map((id, order) => ({
  id, title: `纸页 ${order}`, icon: '📄', parentId: order ? a : null, createdAt: 1, updatedAt: 2,
  order, content: richContent,
  comments: [{ id: 'review', quote: '原文', resolved: false, messages: [{ id: 'msg', author: '我', text: '保留' }] }],
}))
const legacy = JSON.stringify({ activePageId: b, pages: legacyPages, demoVersion: 2 })
const seed = splitLegacyWorkspace(legacy)!

describe('desktop asset pruning', () => {
  // @partition retention: live, trash, grace and suspended editor
  // @partition safety: missing or malformed shard aborts before removal
  it('retention: keeps references in trash and the editor, removes aged orphans after reference removal', async () => {
    const { directory, workspace } = await profile()
    const assets = createImageAssetFiles(directory)
    const image = testImage()
    const [live, trash, orphan, editing] = await Promise.all([0, 1, 2, 3].map(tag =>
      assets.save({ ...image, bytes: Uint8Array.from([...image.bytes, tag]) })))
    const index = { ...seed.index, activePageId: a, pages: [seed.index.pages[0]!], trash: [{ ...seed.index.pages[1]!, deletedAt: 3 }] }
    const pages = [live!, trash!].map((asset, i) => ({
      ...seed.pages[i]!, content: { type: 'doc', content: [{ type: 'imageBlock', attrs: { src: 'asset:' + asset.id } }] },
    }))
    await workspace.commit({ index, pages, removedPageIds: [] })
    await expect(pruneOrphanImageAssets(workspace, assets, undefined)).resolves.toEqual({ removedCount: 0, keptCount: 4 })
    await expect(pruneOrphanImageAssets(workspace, assets, { graceMs: 0, protectedIds: [editing!.id] }))
      .resolves.toEqual({ removedCount: 1, keptCount: 3 })
    expect(await assets.readMetadata([live!.id, trash!.id, orphan!.id, editing!.id])).toEqual([live, trash, null, editing])
    await workspace.commit({ index: { ...index, trash: [] }, pages: [], removedPageIds: [b] })
    await expect(pruneOrphanImageAssets(workspace, assets, { graceMs: 0, protectedIds: [editing!.id] }))
      .resolves.toEqual({ removedCount: 1, keptCount: 2 })
  })

  it.each(['missing', 'invalid JSON', 'invalid node'])('safety: preserves all images when a trash shard is %s', async damage => {
    const { directory, pagesPath, workspace } = await profile()
    const assets = createImageAssetFiles(directory)
    const orphan = await assets.save(testImage())
    const index = { ...seed.index, activePageId: a, pages: [seed.index.pages[0]!], trash: [{ ...seed.index.pages[1]!, deletedAt: 3 }] }
    await workspace.commit({ index, pages: [seed.pages[0]!], removedPageIds: [] })
    if (damage !== 'missing') await writeFile(join(pagesPath, b + '.json'), damage === 'invalid JSON'
      ? '{' : JSON.stringify({ ...seed.pages[1], content: { type: 'doc', content: [null] } }))
    await expect(pruneOrphanImageAssets(workspace, assets, { graceMs: 0 })).rejects.toThrow()
    expect(await assets.readMetadata([orphan.id])).toEqual([orphan])
  })
})

describe('desktop workspace and files', () => {
  it('migrates UTF-8 legacy data into a metadata index and independent shards without loss', async () => {
    const { legacyPath, indexPath, workspace, pagesPath, directory } = await profile()
    expect(await workspace.readIndex()).toBeNull()
    await writeFile(legacyPath, legacy)
    await expect(workspace.readIndex()).resolves.toEqual(seed.index)
    expect(JSON.parse(await readFile(indexPath, 'utf8'))).toEqual(seed.index)
    expect(await readdir(pagesPath)).toEqual([b, a].map(id => `${id}.json`))
    await expect(readFile(legacyPath)).rejects.toMatchObject({ code: 'ENOENT' })
    const reopened = createWorkspaceFiles(directory)
    await expect(reopened.readIndex()).resolves.toEqual(seed.index)
    await expect(reopened.readPage(a)).resolves.toEqual(seed.pages[0])
    await expect(reopened.readPage(b)).resolves.toEqual(seed.pages[1])
  })

  it('orders concurrent commits and deletion and leaves the untouched shard byte-for-byte unchanged', async () => {
    const { workspace, pagesPath, indexPath } = await profile()
    await workspace.commit({ ...seed, removedPageIds: [] })
    const bPath = join(pagesPath, `${b}.json`)
    const bBefore = await readFile(bPath)
    const changed = { ...seed.pages[0]!, updatedAt: 10, content: { type: 'doc', content: [{ type: 'paragraph' }] } }
    const order = [workspace.commit({ pages: [changed], removedPageIds: [] }),
      workspace.commit({ pages: [{ ...changed, updatedAt: 11 }], removedPageIds: [] })]
    const visible = workspace.readPage(a)
    await Promise.all(order)
    await expect(visible).resolves.toMatchObject({ updatedAt: 11, content: changed.content })
    expect(await readFile(bPath)).toEqual(bBefore)
    expect(JSON.parse(await readFile(indexPath, 'utf8'))).toEqual(seed.index)
    const index = { ...seed.index, activePageId: a, pages: [seed.index.pages[0]!] }
    await workspace.commit({ index, pages: [], removedPageIds: [b] })
    await expect(workspace.readPage(b)).resolves.toBeNull()
    expect(await readdir(pagesPath)).toEqual([`${a}.json`])
  })

  it('stores two thousands-of-block shards totaling more than 20 MiB', async () => {
    const { workspace, pagesPath } = await profile()
    const text = 'x'.repeat(3 * 1024)
    const content = { type: 'doc', content: Array.from({ length: 4000 }, () => ({
      type: 'paragraph', content: [{ type: 'text', text }],
    })) }
    const pages = seed.pages.map(page => ({ ...page, content }))
    await workspace.commit({ ...seed, pages, removedPageIds: [] })
    const sizes = await Promise.all([a, b].map(async id => (await stat(join(pagesPath, `${id}.json`))).size))
    expect(sizes[0]! + sizes[1]!).toBeGreaterThan(20 * 1024 * 1024)
    await expect(workspace.readIndex()).resolves.toEqual(seed.index)
    const loaded = await workspace.readPage(b)
    expect(loaded?.content.content).toHaveLength(4000)
    expect(loaded?.content.content?.[3999]?.content?.[0]?.text).toBe(text)
  })

  it.each(['{', 'null', '{"activePageId":"empty","pages":[]}'])('retains damaged legacy data %s for recovery', async raw => {
    const { legacyPath, workspace } = await profile()
    await writeFile(legacyPath, raw)
    expect(await workspace.readIndex()).toBeNull()
    expect(await readFile(legacyPath, 'utf8')).toBe(raw)
  })

  it('rejects path traversal, oversized shards and invalid batches while leaving other pages available', async () => {
    const { workspace, indexPath, pagesPath } = await profile()
    await workspace.commit({ ...seed, removedPageIds: [] })
    await expect(workspace.readPage('../index')).rejects.toThrow('Invalid page ID')
    await expect(workspace.readPage(a + '\n')).rejects.toThrow('Invalid page ID')
    await expect(workspace.commit({ pages: [{ ...seed.pages[0], id: '../../workspace' }], removedPageIds: [] }))
      .rejects.toThrow('Invalid workspace changes')
    await expect(workspace.commit({ index: seed.index, pages: [], removedPageIds: [a] })).rejects.toThrow('Invalid workspace changes')
    await truncate(join(pagesPath, `${b}.json`), 64 * 1024 * 1024 + 1)
    await expect(workspace.readPage(b)).rejects.toThrow('size')
    await expect(workspace.readIndex()).resolves.toEqual(seed.index)
    await expect(workspace.readPage(a)).resolves.toEqual(seed.pages[0])
    await writeFile(indexPath, '{')
    await expect(workspace.readIndex()).rejects.toThrow(SyntaxError)
    await expect(workspace.readPage(a)).resolves.toEqual(seed.pages[0])
  })

  it('reports I/O failures and preserves the legacy source if migration is interrupted', async () => {
    const { legacyPath, indexPath, workspace, directory } = await profile()
    await writeFile(legacyPath, legacy)
    await mkdir(indexPath, { recursive: true })
    await expect(workspace.readIndex()).rejects.toThrow()
    await expect(workspace.commit({ ...seed, removedPageIds: [] })).rejects.toThrow()
    expect(await readFile(legacyPath, 'utf8')).toBe(legacy)
    expect(await readdir(join(directory, 'workspace'))).toEqual(['index.json', 'pages'])
    await rm(indexPath, { recursive: true })
    await expect(workspace.readIndex()).resolves.toEqual(seed.index)
  })

  it('reads selected Markdown files and saves Markdown and JSON in UTF-8', async () => {
    const { directory } = await profile()
    const note = join(directory, '项目.MARKDOWN')
    const markdown = '# 设计笔记\n\n- 第一页\n'
    await writeAtomicText(note, markdown)
    expect(await readMarkdownFile(note)).toEqual({ name: '项目.MARKDOWN', contents: markdown })
    const json = join(directory, '项目.json')
    await writeAtomicText(json, '{"title":"设计笔记"}')
    expect(await readFile(json, 'utf8')).toBe('{"title":"设计笔记"}')
    await expect(readMarkdownFile(json)).rejects.toThrow('Expected a Markdown file')
  })

  it('rejects malformed IPC export options', () => {
    expect(isSaveFileOptions({ name: '文档', format: 'markdown', contents: '' })).toBe(true)
    expect(isSaveFileOptions({ name: '文档', format: 'json', contents: '{}' })).toBe(true)
    expect(isSaveFileOptions({ name: '图表', format: 'svg', contents: '<svg/>' })).toBe(true)
    expect(isSaveFileOptions({ name: '文档', format: 'exe', contents: '' })).toBe(false)
    expect(isSaveFileOptions({ name: '文档', format: 'markdown', contents: {} })).toBe(false)
  })
})

describe('desktop image assets', () => {
  it('deduplicates concurrent writes, serves original raster bytes and allows explicit offline cleanup', async () => {
    const { directory } = await profile()
    const assets = createImageAssetFiles(directory)
    const image = testImage()
    const [first, duplicate] = await Promise.all([assets.save(image), assets.save({ ...image, name: '副本.png' })])
    expect(duplicate).toEqual(first)
    expect(first).toMatchObject({ id: expect.stringMatching(/^[a-f0-9]{64}\.png$/), mime: 'image/png', width: 1, height: 1,
      byteLength: image.bytes.byteLength, name: image.name })
    expect(await readdir(join(directory, 'workspace', 'assets'))).toEqual([first.id, first.id + '.json'])
    const url = `aiblock-asset://media/${first.id}`
    const response = await assets.respond(new Request(url))
    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('image/png')
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff')
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(image.bytes)
    expect(await assets.readMetadata([first.id, '0'.repeat(64) + '.png', first.id])).toEqual([first, null, first])
    const head = await assets.respond(new Request(url, { method: 'HEAD' }))
    expect(head.status).toBe(200)
    expect(await head.text()).toBe('')
    expect((await assets.respond(new Request(url, { method: 'POST' }))).status).toBe(405)
    await assets.remove([first.id])
    expect((await assets.respond(new Request(url))).status).toBe(404)
  })

  it('returns a readable raster with a matching application Origin and withholds CORS for foreign origins', async () => {
    const { directory } = await profile()
    const assets = createImageAssetFiles(directory)
    const input = testImage()
    const image = await assets.save(input)
    const url = `aiblock-asset://media/${image.id}`
    for (const [application, origin, allowed] of [
      ['file:///Applications/AIBlock%20Editor.app/dist/index.html', 'null', 'null'],
      ['file:///Applications/AIBlock%20Editor.app/dist/index.html', 'file://', 'file://'],
      ['file:///Applications/AIBlock%20Editor.app/dist/index.html', 'https://foreign.test', null],
      ['http://127.0.0.1:58261/', 'http://127.0.0.1:58261', 'http://127.0.0.1:58261'],
      ['http://127.0.0.1:58261/', 'http://127.0.0.1:58262', null],
    ] as const) {
      const response = await assets.respond(new Request(url, { headers: { Origin: origin } }), application)
      expect(response.status).toBe(200)
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe(allowed)
      expect(response.headers.get('Vary')).toBe('Origin')
      expect(new Uint8Array(await response.arrayBuffer())).toEqual(input.bytes)
    }
  })

  it('rejects invalid MIME, mismatched bytes, sizes, dimensions and protocol paths', async () => {
    const { directory } = await profile()
    const assets = createImageAssetFiles(directory)
    const image = testImage()
    for (const invalid of [
      { ...image, mime: 'image/svg+xml' },
      { ...image, mime: 'image/jpeg' },
      { ...image, width: -1 },
      { ...image, bytes: new Uint8Array(32 * 1024 * 1024 + 1) },
    ]) await expect(assets.save(invalid)).rejects.toThrow('Invalid image')
    await expect(assets.readMetadata(['../../index.json'])).rejects.toThrow('Invalid asset IDs')
    await expect(assets.remove(['../../index.json'])).rejects.toThrow('Invalid asset IDs')
    const id = '0'.repeat(64) + '.png'
    const paths = [
      `aiblock-asset://elsewhere/${id}`, `aiblock-asset://name@media/${id}`, `aiblock-asset://media:30/${id}`,
      `aiblock-asset://media/%2e%2e%2f${id}`, `aiblock-asset://media/../${id}`, `aiblock-asset://media/${id}?q=1`,
      `aiblock-asset://media/${id}#x`, `aiblock-asset://media/${id}\n`, `aiblock-asset://media/${id}.svg`,
    ]
    for (const url of paths) expect(assetRequestId(url)).toBeNull()
    expect(decideNavigation(`aiblock-asset://media/${id}`, 'file:///app/index.html')).toEqual({ kind: 'deny' })
  })
})
