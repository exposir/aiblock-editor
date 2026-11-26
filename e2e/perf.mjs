// Run against a local Vite server: node e2e/perf.mjs http://127.0.0.1:5197/
// Set CHROME_BIN to use a different Chromium installation.
import assert from 'node:assert/strict'
import { renderGallery } from './gallery.mjs'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

const url = process.argv[2]
assert.ok(url, 'Pass the URL of a running Vite server')
const binary = process.env.CHROME_BIN ?? (process.platform === 'darwin'
  ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : 'chromium')
const profile = await mkdtemp(join(tmpdir(), 'aiblock-perf-'))
const chrome = spawn(binary, [
  '--headless', '--window-size=1440,900', '--remote-debugging-port=0',
  '--no-first-run', '--no-default-browser-check', '--user-data-dir=' + profile, 'about:blank',
], { stdio: 'ignore' })
const exited = once(chrome, 'exit').catch(() => {})
let socket

async function until(probe, message, timeout = 15000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    const result = await probe()
    if (result) return result
    await delay(40)
  }
  throw new Error(message)
}

const pending = new Map()
let nextId = 0
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++nextId
    pending.set(id, { resolve, reject })
    socket.send(JSON.stringify({ id, method, params }))
  })
}

async function page(fn, arg) {
  const { result, exceptionDetails } = await send('Runtime.evaluate', {
    expression: '(' + fn.toString() + ')(' + JSON.stringify(arg) + ')',
    awaitPromise: true, returnByValue: true,
  })
  if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text)
  return result.value
}

const frame = () => page(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
const wheel = ({ x, y }, deltaY, deltaX = 0) =>
  send('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX, deltaY })
const move = ({ x, y }) => send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })

const gallery = '全图种与公式复杂示例'
const stress = '性能基准长文档'
const editorReady = () => page(() => !!document.querySelector('.ProseMirror')?.editor?.isInitialized)

async function openPage(title, mode = 'edit') {
  const start = await page(title => {
    const now = performance.now()
    const button = [...document.querySelectorAll('.workspace-navigation button')]
      .find(button => button.textContent.trim() === title)
    if (!button) throw new Error('Missing page: ' + title)
    button.click()
    return now
  }, title)
  await until(async () => page(({ title, mode }) =>
    (mode === 'preview'
      ? !!document.querySelector('article[aria-label="文档预览"]') &&
        document.querySelector('[aria-label="文档标题"]')?.textContent === title
      : !!document.querySelector('.ProseMirror')?.editor?.isInitialized &&
        document.querySelector('input[aria-label="文档标题"]')?.value === title), { title, mode }), title)
  await frame()
  return Math.round(await page(() => performance.now()) - start)
}

function startMeasurements() {
  const root = document.querySelector('.ProseMirror')
  const view = root?.editor?.view
  const editor = root?.editor
  const result = { rects: 0, writes: 0, json: 0, keys: [], frames: [] }
  const rect = Element.prototype.getBoundingClientRect
  Element.prototype.getBoundingClientRect = function () {
    result.rects++
    return rect.call(this)
  }
  const json = editor?.getJSON
  if (editor) {
    editor.getJSON = function () {
      result.json++
      return json.call(this)
    }
  }
  const dispatch = view?.props.dispatchTransaction
  if (view) {
    view.setProps({ dispatchTransaction(tr) {
      const start = performance.now()
      dispatch.call(view, tr)
      if (tr.docChanged) result.keys.push(performance.now() - start)
    } })
  }
  const observer = new MutationObserver(records => { result.writes += records.length })
  observer.observe(document.querySelector('[data-document-overlays]') ?? document.body, {
    subtree: true, attributes: true, attributeFilter: ['style'],
  })
  let previous, raf
  function tick(now) {
    if (previous !== undefined) result.frames.push(now - previous)
    previous = now
    raf = requestAnimationFrame(tick)
  }
  raf = requestAnimationFrame(tick)
  window.finishPerfSample = () => {
    cancelAnimationFrame(raf)
    observer.disconnect()
    Element.prototype.getBoundingClientRect = rect
    if (editor) editor.getJSON = json
    if (view) view.setProps({ dispatchTransaction: dispatch })
    delete window.finishPerfSample
    return result
  }
}

function percentile(values, p) {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  return Number(sorted[Math.ceil(sorted.length * p) - 1].toFixed(2))
}

async function typeSample() {
  await page(() => {
    const root = document.querySelector('.ProseMirror')
    const paragraph = root.querySelector('p')
    root.focus()
    const selection = getSelection()
    selection.collapse(paragraph.firstChild, 2)
  })
  await frame()
  await page(startMeasurements)
  for (let i = 0; i < 50; i++) await send('Input.insertText', { text: 'a' })
  await frame()
  const { keys, json, rects, writes } = await page(() => window.finishPerfSample())
  assert.ok(keys.length >= 50, 'Expected 50 native text insertions')
  return { transactions: keys.length, p50Ms: percentile(keys, .5), p95Ms: percentile(keys, .95), json, rects, writes }
}

async function scrollSample(selector, { steps = 25, delta = 140 } = {}) {
  const point = await page(selector => {
    const element = document.querySelector(selector)
    element.scrollIntoView({ block: 'center', behavior: 'instant' })
    const rect = element.getBoundingClientRect()
    return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) }
  }, selector)
  await move(point)
  await frame()
  await page(startMeasurements)
  for (let i = 0; i < steps; i++) {
    await wheel(point, delta)
    await delay(8)
  }
  await frame()
  const { frames, rects, writes } = await page(() => window.finishPerfSample())
  return {
    p95Ms: percentile(frames, .95),
    maxMs: frames.length ? Number(Math.max(...frames).toFixed(2)) : null,
    longFrames: frames.filter(ms => ms > 20).length,
    rects,
    writes,
  }
}

async function checkboxAlignment() {
  return page(() => {
    const anchors = [...document.querySelectorAll('.ProseMirror .block-control-anchor.task-checkbox')]
      .filter(anchor => !anchor.closest('[inert]'))
      .map(anchor => anchor.getBoundingClientRect())
    const buttons = [...document.querySelectorAll('[data-document-overlays] button.task-checkbox:not([hidden])')]
      .map(button => button.getBoundingClientRect())
    if (!buttons.length) throw new Error('Missing visible task controls')
    const distance = (a, b) => Math.max(Math.abs(a.top - b.top), Math.abs(a.left - b.left))
    return Math.max(...buttons.map(button => anchors.reduce((nearest, anchor) => Math.min(nearest, distance(anchor, button)), Infinity)))
  })
}

async function waitPreview() {
  await until(() => page(() => {
    const image = document.querySelector('[data-preview-language="mermaid"] img')
    return image?.complete && image.naturalWidth > 0
  }), 'First SVG preview', 30000)
}

async function themeSample(mode) {
  await page(() => scrollTo(0, 0))
  await frame()
  const start = await page(mode => {
    const old = document.querySelector('[data-preview-language="mermaid"] img').src
    window.perfPreviousSvg = old
    const button = document.querySelector(`button.theme-option[aria-label="${mode}"]`)
    if (!button) throw new Error('Missing theme option: ' + mode)
    const start = performance.now()
    button.click()
    return start
  }, mode)
  await frame()
  const firstPaint = Math.round(await page(() => performance.now()) - start)
  await until(() => page(() => {
    const image = document.querySelector('[data-preview-language="mermaid"] img')
    return image?.complete && image.naturalWidth && image.src !== window.perfPreviousSvg
  }), 'Visible theme preview did not refresh')
  await page(() => { delete window.perfPreviousSvg })
  return { firstPaintMs: firstPaint, visibleSvgMs: Math.round(await page(() => performance.now()) - start) }
}

async function setDocumentMode(mode) {
  return page(mode => {
    const key = Object.keys(localStorage).find(key => key.endsWith('.mode.v1'))
    if (!key) throw new Error('Missing document mode storage key')
    localStorage.setItem(key, mode)
  }, mode)
}

async function switchDocumentMode(mode) {
  const label = mode === 'preview' ? '预览' : '编辑'
  const start = await page(label => {
    const button = document.querySelector(`button.mode-option[aria-label="${label}"]`)
    if (!button) throw new Error('Missing mode option: ' + label)
    const at = performance.now()
    button.click()
    return at
  }, label)
  await until(() => page(mode => mode === 'preview'
    ? !!document.querySelector('article[aria-label="文档预览"]')
    : !!document.querySelector('.ProseMirror')?.editor?.isInitialized, mode), 'Document mode did not switch', 15000)
  await frame()
  return Math.round(await page(() => performance.now()) - start)
}

async function counters() {
  await send('HeapProfiler.collectGarbage')
  const dom = await send('Memory.getDOMCounters')
  const { usedSize } = await send('Runtime.getHeapUsage')
  const mountedNodes = await page(() => document.querySelectorAll('*').length)
  return { ...dom, mountedNodes, heapMiB: Number((usedSize / 2 ** 20).toFixed(2)) }
}

async function reloadCurrentDocument(mode) {
  await setDocumentMode(mode)
  await send('Page.reload')
  await until(() => page(mode => mode === 'preview'
    ? !!document.querySelector('article[aria-label="文档预览"]')
    : !!document.querySelector('.ProseMirror')?.editor?.isInitialized, mode), 'Document did not reload in ' + mode, 30000)
  await frame()
  return Math.round(await page(() => performance.now()))
}

async function seedAndOpen(mode, documentMode = 'edit') {
  await delay(550) // Allow the current editor's mount normalization to reach storage before replacing the fixture.
  const id = await page(async ({ mode, documentMode }) => {
    let idCounter = 0
    const block = (type, content, attrs = {}) => ({ type, attrs: { ...attrs, blockId: 'perf-' + ++idCounter }, ...(content ? { content } : {}) })
    const text = (value, marks) => ({ type: 'text', text: value, ...(marks ? { marks } : {}) })
    const bold = value => text(value, [{ type: 'bold' }])
    const p = (value, strong = false) => block('paragraph', [strong ? bold(value) : text(value)])
    const tasks = i => block('taskList', [0, 1].map(n => block('taskItem', [p(`验收 ${i}.${n}`)], { checked: n === 0 })))
    const table = i => block('table', [
      block('tableRow', [
        block('tableHeader', [p('检查项')], { colspan: 1, rowspan: 1, colwidth: [120] }),
        block('tableHeader', [p('状态')], { colspan: 1, rowspan: 1, colwidth: [120] }),
      ]),
      block('tableRow', [
        block('tableCell', [p('版本 ' + i)], { colspan: 1, rowspan: 1 }),
        block('tableCell', [p('通过')], { colspan: 1, rowspan: 1 }),
      ]),
    ])
    const callout = i => block('callout', [
      p('发布须经复核 ' + i, true), ...(i % 10 === 0 ? [table(i)] : []),
    ], { theme: 'blue', icon: '💡' })
    const toggle = i => block('toggle', [
      block('toggleSummary', [text('回滚 ' + i)]), block('toggleContent', [p('恢复上一版本 ' + i)]),
    ], { open: i % 2 === 0 })
    const columns = i => block('columnList', [50, 50].map(width => block('column', [p('步骤 ' + i)], { width })))
    const shortCode = i => block('codeBlock', [text('const value = { deploy: true, revision: ' + i + ' };')], { language: 'typescript' })
    const richCode = (i, language, source) => block('codeBlock', [text(source + i)], { language })
    const content = mode === 'xl'
      ? Array.from({ length: 900 }, (_, i) => [
        p('编辑起点与正文。' + i, i % 2 === 0),
        i % 3 === 0 ? block('heading', [text('回归测试 ' + i)], { level: 2 }) : p('阅读连续正文与标记。', i % 4 === 0),
        tasks(i), i % 3 ? callout(i) : columns(i),
        i % 2 ? toggle(i)
          : i % 4 === 0 ? shortCode(i)
            : i % 8 === 0 ? richCode(i, 'mermaid', 'flowchart LR\nA-->B\n') : richCode(i, 'math', '\\sum_{j=1}^{n} j\n'),
      ]).flat()
      : mode === 'code'
        ? [block('codeBlock', [text(Array.from({ length: 500 }, (_, i) => [
          `export interface Revision${i} { readonly id: string; metadata: Record<string, number> }`,
          `const item${i}: Revision${i} = { id: "release-${i}", metadata: { attempts: 1 } };`,
          `const names${i} = [item${i}.id, 'next'].map((name) => name.trim());`,
          `if (names${i}.length > 0) console.log(names${i}.join(", "));`,
          '// 发布记录与回滚快照',
        ].join('\n')).join('\n'))], { language: 'typescript' })]
        : Array.from({ length: 200 }, (_, i) => p('图片压测混合正文 ' + i))
    if (mode === 'xl') {
      const omitted = 18121 - countNodes({ content })
      if (omitted < 0) {
        const plain = content.filter(node => node.type === 'paragraph' && node.content[0]?.text === '阅读连续正文与标记。')
        for (const node of plain.slice(0, -omitted)) delete node.content
      }
      for (let i = 0; i < omitted; i++) {
        const paragraph = content[Math.floor(i / 2) * 5]
        if (!paragraph) break
        paragraph.content.push(i % 2 ? text(' 说明。') : { type: 'hardBreak' })
      }
    }
    function countNodes(node) { return 1 + (node.content ?? []).reduce((count, child) => count + countNodes(child), 0) }
    const id = crypto.randomUUID()
    const db = await new Promise((resolve, reject) => {
      const open = indexedDB.open('aiblock-editor')
      open.onsuccess = () => resolve(open.result)
      open.onerror = () => reject(open.error)
    })
    await new Promise((resolve, reject) => {
      const transaction = db.transaction(['meta', 'pages'], 'readwrite')
      transaction.oncomplete = resolve
      transaction.onabort = () => reject(transaction.error)
      const meta = transaction.objectStore('meta')
      const request = meta.get('workspace')
      request.onsuccess = () => {
        const index = request.result
        const now = Date.now()
        const title = mode === 'xl' ? 'XL 性能工作区' : mode === 'code' ? '超长 TypeScript' : '百图压测'
        const record = { id, title, parentId: null, icon: '📄', order: index.pages.length, createdAt: now, updatedAt: now, comments: [] }
        meta.put({ ...index, activePageId: id, pages: [...index.pages, record] }, 'workspace')
        transaction.objectStore('pages').put({ id, content: { type: 'doc', content }, updatedAt: now }, id)
      }
    })
    db.close()
    history.replaceState(null, '', '#page=' + id)
    const modeKey = Object.keys(localStorage).find(key => key.endsWith('.mode.v1'))
    if (modeKey) localStorage.setItem(modeKey, documentMode)
    return id
  }, { mode, documentMode })
  await send('Page.reload')
  await until(() => page(({ id, documentMode }) => location.hash === '#page=' + id &&
    (documentMode === 'preview'
      ? !!document.querySelector('article[aria-label="文档预览"]')
      : !!document.querySelector('.ProseMirror')?.editor?.isInitialized), { id, documentMode }), 'Seeded document did not open', 30000)
    .catch(async error => {
      const state = await page(() => ({ hash: location.hash,
        title: document.querySelector('input[aria-label="文档标题"]')?.value ?? document.querySelector('[aria-label="文档标题"]')?.textContent,
        status: [...document.querySelectorAll('[role=status]')].map(node => node.textContent),
        blocks: document.querySelector('.ProseMirror')?.children.length,
        preview: !!document.querySelector('article[aria-label="文档预览"]') }))
      throw new Error(error.message + ' (' + await page(() => location.hash) + '): ' + JSON.stringify(state))
    })
  await frame()
  return page(documentMode => ({ mode: documentMode, ms: Math.round(performance.now()) }), documentMode)
}

function ceiling(value, max, metric) {
  assert.ok(Number.isFinite(value) && value <= max, `${metric}: ${value}, maximum ${max}`)
}

async function xlSample() {
  const firstOpenMs = (await seedAndOpen('xl', 'edit')).ms
  const shape = await page(() => {
    const doc = document.querySelector('.ProseMirror').editor.state.doc
    let nodes = 1
    doc.descendants(() => { nodes++ })
    return { blocks: doc.childCount, nodes }
  })
  assert.deepEqual(shape, { blocks: 4500, nodes: 18121 })
  const editLoaded = await counters()
  const editControls = await page(() => document.querySelectorAll('.floating-block-control, .code-control-strip').length)
  await openPage('文档协作与发布手册', 'edit')
  const editSwitchBackMs = await openPage('XL 性能工作区', 'edit')
  await page(() => {
    document.querySelector('button[aria-label="目录侧栏"]').click()
    const root = document.querySelector('.ProseMirror')
    root.editor.commands.setTextSelection(2)
    root.focus()
  })
  await frame()
  await page(startMeasurements)
  for (let i = 0; i < 20; i++) {
    await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
  }
  await frame()
  const enter = await page(() => window.finishPerfSample())
  assert.equal(enter.keys.length, 20)
  const point = await page(() => {
    const paragraph = document.querySelectorAll('.ProseMirror > p')[26]
    paragraph.scrollIntoView({ block: 'center' })
    const rect = paragraph.getBoundingClientRect()
    return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) }
  })
  await frame()
  await page(startMeasurements)
  const tick = await page(() => performance.now())
  await move(point)
  await frame()
  const hover = await page(start => ({ ms: +(performance.now() - start).toFixed(2),
    visible: !!document.querySelector('.block-handles'), ...window.finishPerfSample() }), tick)
  const editScroll = await scrollSample('.ProseMirror pre')
  const editableControls = await page(() => document.querySelectorAll('.ProseMirror :is(button,input,select,textarea)').length)
  assert.equal(editableControls, 0)
  const edit = { shape, firstOpenMs, switchBackMs: editSwitchBackMs, loaded: editLoaded, controls: editControls, editableControls,
    enter: { p50Ms: percentile(enter.keys, .5), p95Ms: percentile(enter.keys, .95), frameP95Ms: percentile(enter.frames, .95), rects: enter.rects },
    hover: { ms: hover.ms, rects: hover.rects, visible: hover.visible }, scroll: editScroll }
  ceiling(firstOpenMs, 1500, 'XL first open (ms)')
  ceiling(editSwitchBackMs, 1000, 'XL edit switch back (ms)')
  ceiling(editControls, 100, 'XL mounted edit tools')
  ceiling(editLoaded.jsEventListeners, 2000, 'XL edit event listeners')
  ceiling(edit.enter.p95Ms, 30, 'XL Enter transaction P95 (ms)')
  ceiling(edit.enter.frameP95Ms, 55, 'XL Enter frame P95 (ms)')
  ceiling(edit.enter.rects, 2500, 'XL Enter geometry reads')
  assert.ok(hover.visible, 'The first pointer move must reveal the block handle')
  ceiling(hover.rects, 1200, 'XL first hover geometry reads')
  ceiling(hover.ms, 160, 'XL first hover (ms)')
  ceiling(editScroll.p95Ms, 24, 'XL edit scroll frame P95 (ms)')
  ceiling(editScroll.longFrames, 6, 'XL edit scroll long frames')
  assert.equal(editScroll.writes, 0, 'Stationary XL wheel must not write overlay styles')

  const modeToPreviewMs = await switchDocumentMode('preview')
  const previewColdOpenMs = await reloadCurrentDocument('preview')
  const previewLoaded = await counters()
  await openPage('文档协作与发布手册', 'preview')
  const previewSwitchBackMs = await openPage('XL 性能工作区', 'preview')
  const previewPoint = await page(() => {
    const paragraph = document.querySelectorAll('.document-preview p')[26]
    if (!paragraph) throw new Error('Missing preview paragraph')
    paragraph.scrollIntoView({ block: 'center', behavior: 'instant' })
    const rect = paragraph.getBoundingClientRect()
    return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) }
  })
  await frame()
  await page(startMeasurements)
  const previewHoverStart = await page(() => performance.now())
  await move(previewPoint)
  await frame()
  const previewHover = await page(start => ({
    ms: +(performance.now() - start).toFixed(2), ...window.finishPerfSample(),
  }), previewHoverStart)
  const previewScroll = await scrollSample('.document-preview pre', { steps: 60, delta: 330 })
  const previewDom = await page(() => ({
    article: document.querySelectorAll('article[aria-label="文档预览"]').length,
    proseMirror: document.querySelectorAll('.ProseMirror').length,
    contentEditable: document.querySelectorAll('[contenteditable]').length,
    textboxes: document.querySelectorAll('[role="textbox"]').length,
    overlays: document.querySelectorAll('[data-document-overlays], .bubble-toolbar, .table-controls-layer, .image-controls, .inline-math-editor').length,
    chunks: document.querySelectorAll('.preview-chunk').length,
  }))
  const modeToEditMs = await switchDocumentMode('edit')
  const modeBackToPreviewMs = await switchDocumentMode('preview')
  const preview = {
    coldOpenMs: previewColdOpenMs,
    switchBackMs: previewSwitchBackMs,
    loaded: previewLoaded,
    modeToPreviewMs,
    modeToEditMs,
    modeBackToPreviewMs,
    hover: { ms: previewHover.ms, rects: previewHover.rects },
    scroll: previewScroll,
    dom: previewDom,
  }
  ceiling(previewColdOpenMs, 230, 'XL preview cold open (ms)')
  ceiling(previewSwitchBackMs, 130, 'XL preview switch back (ms)')
  ceiling(previewLoaded.jsEventListeners, 300, 'XL preview event listeners')
  assert.ok(previewLoaded.heapMiB < editLoaded.heapMiB,
    `XL preview heap ${previewLoaded.heapMiB} MiB must be below edit ${editLoaded.heapMiB} MiB`)
  assert.ok(previewLoaded.mountedNodes < editLoaded.mountedNodes,
    `XL preview DOM ${previewLoaded.mountedNodes} must be below edit ${editLoaded.mountedNodes}`)
  assert.equal(previewHover.rects, 0, 'XL preview hover must not read geometry')
  ceiling(previewScroll.p95Ms, 17.5, 'XL preview scroll frame P95 (ms)')
  ceiling(previewScroll.maxMs, 50, 'XL preview scroll max frame (ms)')
  ceiling(previewScroll.longFrames, 1, 'XL preview scroll long frames')
  assert.equal(previewScroll.writes, 0, 'XL preview scroll must not write styles')
  assert.deepEqual({ ...previewDom, chunks: undefined },
    { article: 1, proseMirror: 0, contentEditable: 0, textboxes: 0, overlays: 0, chunks: undefined })
  assert.ok(previewDom.chunks >= Math.ceil(shape.blocks / 128))
  const summary = { edit, preview }
  if (process.argv.includes('--geometry-only')) return summary
  const codeOpenMs = (await seedAndOpen('code', 'edit')).ms
  await page(() => {
    const root = document.querySelector('.ProseMirror')
    root.editor.commands.setTextSelection(8)
    root.focus()
  })
  await frame()
  await page(startMeasurements)
  const keys = 12
  for (let i = 0; i < keys; i++) await send('Input.insertText', { text: 'a' })
  await frame()
  const code = await page(() => window.finishPerfSample())
  assert.equal(code.keys.length, keys)
  await until(() => page(() => !!document.querySelector('.ProseMirror .hljs-keyword')), 'Long code highlight did not settle')
  const longCode = { lines: 2500, codeOpenMs, keys, p50Ms: percentile(code.keys, .5),
    p95Ms: percentile(code.keys, .95), frameP95Ms: percentile(code.frames, .95) }
  ceiling(codeOpenMs, 1200, 'Long code first open (ms)')
  ceiling(longCode.p95Ms, 20, 'Long code typing transaction P95 (ms)')
  ceiling(longCode.frameP95Ms, 40, 'Long code typing frame P95 (ms)')
  return { ...summary, longCode }
}

async function imageSample() {
  const mixedTextOpenMs = (await seedAndOpen('images', 'edit')).ms
  const bytes = await page(async () => {
    const dt = new DataTransfer()
    const canvas = document.createElement('canvas')
    const context = canvas.getContext('2d')
    let bytes = 0
    let seed = 997
    for (let i = 0; i < 100; i++) {
      canvas.width = 160 + (i * 17) % 330
      canvas.height = 92 + (i * 9) % 240
      const pixels = context.createImageData(canvas.width, canvas.height)
      for (let at = 0; at < pixels.data.length; at += 4) {
        seed = Math.imul(seed, 1664525) + 1013904223 | 0
        pixels.data[at] = seed >>> 24
        pixels.data[at + 1] = seed >>> 16
        pixels.data[at + 2] = seed >>> 8
        pixels.data[at + 3] = 255
      }
      context.putImageData(pixels, 0, 0)
      const blob = await new Promise(resolve => canvas.toBlob(resolve, i % 2 ? 'image/webp' : 'image/png', .8))
      bytes += blob.size
      dt.items.add(new File([blob], '压测-' + i + '.' + (i % 2 ? 'webp' : 'png'), { type: blob.type }))
    }
    const root = document.querySelector('.ProseMirror')
    root.editor.commands.setTextSelection(2)
    root.focus()
    window.imagePasteStart = performance.now()
    root.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt }))
    return bytes
  })
  await until(() => page(() => document.querySelectorAll('[data-image-block]').length === 100), '100 images did not insert', 60000)
  const { insertedMs, id, remaining, restored } = await page(() => {
    const started = performance.now()
    const id = new URLSearchParams(location.hash.slice(1)).get('page')
    const root = document.querySelector('.ProseMirror')
    const imageIds = () => root.editor.state.doc.children.filter(node => node.type.name === 'imageBlock').map(node => node.attrs.assetId)
    const initial = imageIds()
    root.editor.commands.undo()
    const remaining = imageIds().length
    root.editor.commands.redo()
    return { insertedMs: Math.round(started - window.imagePasteStart), id, remaining,
      restored: JSON.stringify(imageIds()) === JSON.stringify(initial) }
  })
  assert.equal(remaining, 0, 'One undo must remove the entire paste')
  assert.ok(restored, 'One redo must restore the original 100 asset IDs in order')
  await openPage('文档协作与发布手册')
  await until(() => page(async id => {
    const db = await new Promise(resolve => {
      const request = indexedDB.open('aiblock-editor')
      request.onsuccess = () => resolve(request.result)
    })
    try {
      const tx = db.transaction(['pages', 'assets'])
      const read = request => new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
      const [shard, keys] = await Promise.all([read(tx.objectStore('pages').get(id)), read(tx.objectStore('assets').getAllKeys())])
      const images = shard?.content.content.filter(node => node.type === 'imageBlock')
      const saved = new Set(keys)
      return images?.length === 100 && images.every(node => saved.has(node.attrs.assetId))
    } finally { db.close() }
  }, id), 'Assets and their page shard did not persist after switching away', 90000)
  const durableMs = await page(() => Math.round(performance.now() - window.imagePasteStart))
  const switchBackMs = await openPage('百图压测')
  await send('Page.reload')
  await until(() => page(() => !!document.querySelector('.ProseMirror')?.editor?.isInitialized &&
    document.querySelectorAll('[data-image-block]').length === 100), 'Reload lost images', 60000)
  await frame()
  const reopenMs = await page(() => Math.round(performance.now()))
  await until(() => page(() => {
    const first = document.querySelector('[data-image-block] img')
    return first?.complete && first.naturalWidth > 0
  }), 'The first visible image did not load')
  await page(() => {
    const frames = [...document.querySelectorAll('.image-block-frame')]
    const firstMounted = !!frames[0].querySelector('img')
    const initialMounted = frames.filter(frame => frame.querySelector('img')).length
    const initialOutside = frames.filter(frame => {
      const rect = frame.getBoundingClientRect()
      return (rect.top >= innerHeight + 801 || rect.bottom <= -801) && frame.querySelector('img')
    }).length
    const baseline = frames.map(element => element.getBoundingClientRect().height)
    let resized = 0
    let shifts = 0
    const resize = new ResizeObserver(entries => {
      for (const entry of entries) if (Math.abs(entry.contentRect.height - baseline[frames.indexOf(entry.target)]) > .1) resized++
    })
    for (const frame of frames) resize.observe(frame)
    const layout = new PerformanceObserver(list => {
      for (const entry of list.getEntries()) if (!entry.hadRecentInput) shifts += entry.value
    })
    layout.observe({ type: 'layout-shift' })
    let peak = 0, decoded = 0, seen = new Set(), id
    function sample() {
      const images = [...document.querySelectorAll('[data-image-block] img')]
      peak = Math.max(peak, images.length)
      decoded = Math.max(decoded, images.filter(img => img.complete && img.naturalWidth).length)
      for (const img of images) if (img.complete && img.naturalWidth) seen.add(img.closest('[data-image-block]'))
      id = requestAnimationFrame(sample)
    }
    sample()
    window.imageSample = () => {
      cancelAnimationFrame(id)
      resize.disconnect()
      layout.disconnect()
      return { peak, decoded, everDecoded: seen.size, resized, cls: +shifts.toFixed(5),
        firstMounted, initialMounted, initialOutside, firstReleased: !frames[0].querySelector('img'),
        mountedAtEnd: document.querySelectorAll('[data-image-block] img').length,
        maxHeightDelta: Math.max(...frames.map((frame, index) => Math.abs(frame.getBoundingClientRect().height - baseline[index]))),
        controls: document.querySelectorAll('.ProseMirror :is(button,input,select,textarea)').length }
    }
  })
  await page(startMeasurements)
  const inPaper = { x: 760, y: 660 }
  for (let i = 0; i < 115; i++) await wheel(inPaper, 330)
  await frame()
  const sample = await page(() => ({ ...window.finishPerfSample(), ...window.imageSample() }))
  assert.equal(sample.firstMounted, true)
  assert.equal(sample.initialOutside, 0)
  assert.ok(sample.initialMounted > 0 && sample.initialMounted < 25)
  assert.equal(sample.firstReleased, true)
  assert.equal(sample.everDecoded, 100, 'Each image must decode while scrolling')
  ceiling(sample.peak, 24, 'Image scroll simultaneous mounted bitmaps')
  ceiling(insertedMs, 1500, '100-image batch insert (ms)')
  ceiling(durableMs, 5000, '100-image body and binary durability (ms)')
  ceiling(reopenMs, 1000, '100-image reload (ms)')
  ceiling(switchBackMs, 750, '100-image switch back (ms)')
  ceiling(percentile(sample.frames, .95), 24, '100-image scroll frame P95 (ms)')
  ceiling(sample.frames.filter(ms => ms > 20).length, 8, '100-image scroll long frames')
  assert.equal(sample.writes, 0)
  assert.equal(sample.controls, 0)
  assert.equal(sample.resized, 0)
  assert.equal(sample.maxHeightDelta, 0)
  assert.equal(sample.cls, 0)
  return { images: 100, bytes, insertedMs, durableMs, mixedTextOpenMs, reopenMs, switchBackMs,
    p95Ms: percentile(sample.frames, .95), longFrames: sample.frames.filter(ms => ms > 20).length,
    peak: sample.peak, decoded: sample.decoded, everDecoded: sample.everDecoded, mountedAtEnd: sample.mountedAtEnd,
    firstMounted: sample.firstMounted, initialMounted: sample.initialMounted, initialOutside: sample.initialOutside,
    cls: sample.cls, resized: sample.resized, maxHeightDelta: sample.maxHeightDelta, overlayWrites: sample.writes }
}

try {
  const portFile = await until(() => readFile(join(profile, 'DevToolsActivePort'), 'utf8').catch(() => null),
    'Chromium did not start. Check CHROME_BIN.', 5000)
  const tabs = await (await fetch('http://127.0.0.1:' + portFile.split('\n')[0] + '/json/list')).json()
  socket = new WebSocket(tabs.find(tab => tab.type === 'page').webSocketDebuggerUrl)
  await once(socket, 'open')
  socket.addEventListener('message', event => {
    const reply = JSON.parse(event.data)
    const request = pending.get(reply.id)
    if (!request) return
    pending.delete(reply.id)
    if (reply.error) request.reject(new Error(reply.error.message))
    else request.resolve(reply.result)
  })
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] })
  await send('Page.navigate', { url })
  await until(editorReady, 'First editor not interactive')
  await frame()
  const custom = process.argv.includes('--xl') || process.argv.includes('--images')
  if (custom) {
    const result = {}
    if (process.argv.includes('--xl')) result.xl = await xlSample()
    if (process.argv.includes('--images')) result.images = await imageSample()
    console.log(JSON.stringify(result, null, 2))
  } else {
  const initialMs = Math.round(await page(() => performance.now()))
  const galleryStart = await page(() => performance.now())
  const galleryMs = await openPage(gallery)
  await waitPreview()
  const firstSvgMs = await page(() => performance.now())
  const initialPreviews = await page(() => document.querySelectorAll('[data-preview-language="mermaid"] img').length)
  const galleryReadyMs = firstSvgMs - galleryStart
  const dark = await themeSample('深色')
  await renderGallery(page, until, 'dark')
  const light = await themeSample('浅色')
  await renderGallery(page, until, 'light')
  const diagram = await scrollSample('[data-preview-language="mermaid"] img')
  const toolbar = await scrollSample('.code-control-strip[data-preview-tools] button[aria-label="复制源码"]')
  await page(() => {
    const content = [
      '# 性能基准长文档',
      '输入起点。',
      ...Array.from({ length: 72 }, (_, i) => {
        const text = 'UTF-8 文字测量与段落换行。' + '内容与标记 '.repeat(10)
        return [
          '## 标题 ' + i, text, '- [ ] 待办 ' + i,
          '~~~typescript\nconst value = { ready: true, message: "sample" };\nconst items = [1, 2, 3];\nfunction run() {\n  return items.map(item => item * 2);\n}\nrun();\n~~~',
          '| 列一 | 列二 |\n| --- | --- |\n| 数据 | 状态 |',
        ].join('\n\n')
      }),
    ].join('\n\n')
    const dataTransfer = new DataTransfer()
    dataTransfer.items.add(new File([content], 'perf.md', { type: 'text/markdown' }))
    document.querySelector('[data-document-surface]').dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer }))
  })
  await until(async () => await editorReady() && await page(stress =>
    document.querySelector('.ProseMirror h1')?.textContent === stress, stress), stress, 30000)
  await page(() => {
    if (!document.querySelector('nav[aria-label="文档章节"]')) document.querySelector('button[aria-label="目录侧栏"]').click()
  })
  await frame()
  const blocks = await page(() => document.querySelector('.ProseMirror').children.length)
  assert.ok(blocks >= 300)
  const typing = await typeSample()
  const code = await scrollSample('.ProseMirror pre')
  const table = await scrollSample('.ProseMirror td')
  const checkboxErrorPx = await checkboxAlignment()
  assert.ok(checkboxErrorPx <= 0.5)
  await page(() => {
    const code = document.querySelector('.ProseMirror pre')
    window.perfEditedCode = new WeakRef(code)
  })
  await page(() => document.querySelector('button[aria-label="页面侧栏"]').click())
  await openPage(gallery)
  await waitPreview()
  await frame()
  const before = await counters()
  for (let i = 0; i < 10; i++) {
    await page(() => {
      const root = document.querySelector('.ProseMirror')
      const previous = window.perfPreviousEditors ??= []
      previous.push({ editor: new WeakRef(root.editor), root: new WeakRef(root) })
    })
    await openPage(i % 2 === 0 ? stress : gallery)
  }
  await waitPreview()
  await frame()
  const after = await counters()
  const retained = await page(() => {
    const { perfPreviousEditors } = window
    const retired = {
      editors: perfPreviousEditors.filter(ref => ref.editor.deref() !== undefined).length,
      roots: perfPreviousEditors.filter(ref => ref.root.deref() !== undefined).length,
      editedCode: Number(window.perfEditedCode.deref() !== undefined),
    }
    delete window.perfPreviousEditors
    delete window.perfEditedCode
    return retired
  })
  const dom = await page(() => ({
    editors: document.querySelectorAll('.ProseMirror').length,
    overlays: document.querySelectorAll('[data-document-overlays]').length,
    editableControls: document.querySelectorAll('.ProseMirror :is(button,input,select,textarea)').length,
  }))
  assert.deepEqual(dom, { editors: 1, overlays: 1, editableControls: 0 })
  const { editableControls } = dom
  assert.equal(editableControls, 0)
  console.log(JSON.stringify({ blocks, initialMs, galleryMs, initialPreviews, galleryFirstSvgMs: Math.round(galleryReadyMs),
    typing, scroll: { diagram, toolbar, code, table }, theme: { light, dark },
    memory: { before, after, retained }, checkboxErrorPx, editableControls }, null, 2))
  }
} finally {
  socket?.close()
  chrome.kill()
  await exited
  await rm(profile, { force: true, recursive: true })
}
