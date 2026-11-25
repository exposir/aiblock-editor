import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import fc from 'fast-check'
import { describe, expect, it, onTestFinished } from 'vitest'
import { decideNavigation, developmentUrl, externalUrl, isAppDocument } from './security.js'
import { createWorkspaceFile, isSaveFileOptions, readMarkdownFile, writeAtomicText } from './storage.js'
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
  const file = 'file:///Applications/Lark%20Block%20Editor.app/Contents/Resources/app.asar/dist/index.html'

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

async function profile() {
  const directory = await mkdtemp(join(tmpdir(), 'lark-editor-test-'))
  onTestFinished(() => rm(directory, { recursive: true, force: true }))
  const path = join(directory, 'workspace.json')
  const workspace = createWorkspaceFile(path)
  return { directory, path, workspace }
}

const snapshot = (id: string) => JSON.stringify({ activePageId: id, pages: [{ id, title: '纸页' }] })

describe('desktop files', () => {
  // @partition persistence: atomic write, queue order, clear, invalid input and damaged data
  // @partition documents: Markdown input and exact Markdown/JSON output
  it('persists UTF-8 snapshots, replaces the previous file, and clears idempotently', async () => {
    const { directory, path, workspace } = await profile()
    expect(await workspace.load()).toBeNull()
    await workspace.save(snapshot('older'))
    await workspace.save(snapshot('newer'))
    expect(await workspace.load()).toBe(snapshot('newer'))
    expect(await readFile(path, 'utf8')).toBe(snapshot('newer'))
    expect(await readdir(directory)).toEqual(['workspace.json'])
    await workspace.clear()
    await workspace.clear()
    expect(await workspace.load()).toBeNull()
    expect(await readdir(directory)).toEqual([])
  })

  it('serializes concurrent saves, reset and load in arrival order', async () => {
    const { workspace } = await profile()
    const changes = [workspace.save(snapshot('older')), workspace.clear(), workspace.save(snapshot('after-reset'))]
    const visible = workspace.load()
    await Promise.all(changes)
    expect(await visible).toBe(snapshot('after-reset'))
  })

  it.each(['{', 'null', '{"activePageId":"empty","pages":[]}'])('falls back for damaged data %s', async raw => {
    const { path, workspace } = await profile()
    await writeFile(path, raw)
    expect(await workspace.load()).toBeNull()
    expect(await readFile(path, 'utf8')).toBe(raw)
  })

  it('rejects invalid writes without overwriting the last valid workspace', async () => {
    const { path, workspace } = await profile()
    await workspace.save(snapshot('valid'))
    await expect(workspace.save('{"pages":')).rejects.toThrow('Invalid workspace JSON')
    expect(await readFile(path, 'utf8')).toBe(snapshot('valid'))
    await workspace.save(snapshot('recovered'))
    expect(await workspace.load()).toBe(snapshot('recovered'))
  })

  it('preserves I/O failures as actionable errors and cleans up interrupted replacement files', async () => {
    const { directory, path, workspace } = await profile()
    await mkdir(path)
    await expect(workspace.load()).rejects.toThrow()
    await expect(workspace.save(snapshot('blocked'))).rejects.toThrow()
    expect(await readdir(directory)).toEqual(['workspace.json'])
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
