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
const profile = await mkdtemp(join(tmpdir(), 'lark-perf-'))
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

async function openPage(title) {
  const start = await page(title => {
    const now = performance.now()
    const button = [...document.querySelectorAll('.workspace-navigation button')]
      .find(button => button.textContent.trim() === title)
    if (!button) throw new Error('Missing page: ' + title)
    button.click()
    return now
  }, title)
  await until(async () => await editorReady() && await page(title =>
    document.querySelector('input[aria-label="文档标题"]')?.value === title, title), title)
  await frame()
  return Math.round(await page(() => performance.now()) - start)
}

function startMeasurements() {
  const root = document.querySelector('.ProseMirror')
  const view = root.editor.view
  const editor = root.editor
  const result = { rects: 0, writes: 0, json: 0, keys: [], frames: [] }
  const rect = Element.prototype.getBoundingClientRect
  Element.prototype.getBoundingClientRect = function () {
    result.rects++
    return rect.call(this)
  }
  const json = editor.getJSON
  editor.getJSON = function () {
    result.json++
    return json.call(this)
  }
  const dispatch = view.props.dispatchTransaction
  view.setProps({ dispatchTransaction(tr) {
    const start = performance.now()
    dispatch.call(view, tr)
    if (tr.docChanged) result.keys.push(performance.now() - start)
  } })
  const observer = new MutationObserver(records => { result.writes += records.length })
  observer.observe(document.querySelector('[data-document-overlays]'), {
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
    editor.getJSON = json
    view.setProps({ dispatchTransaction: dispatch })
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

async function scrollSample(selector) {
  const point = await page(selector => {
    const element = document.querySelector(selector)
    element.scrollIntoView({ block: 'center', behavior: 'instant' })
    const rect = element.getBoundingClientRect()
    return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) }
  }, selector)
  await move(point)
  await frame()
  await page(startMeasurements)
  for (let i = 0; i < 25; i++) {
    await wheel(point, 140)
    await delay(8)
  }
  await frame()
  const { frames, rects, writes } = await page(() => window.finishPerfSample())
  return { p95Ms: percentile(frames, .95), longFrames: frames.filter(ms => ms > 20).length, rects, writes }
}

async function checkboxAlignment() {
  return page(() => {
    const centers = selector => [...document.querySelectorAll(selector)].map(element => {
      const rect = element.getBoundingClientRect()
      return [rect.top + rect.height / 2, rect.left + rect.width / 2]
    }).sort((a, b) => a[0] - b[0] || a[1] - b[1])
    const anchors = centers('.ProseMirror .block-control-anchor.task-checkbox')
    const buttons = centers('[data-document-overlays] button.task-checkbox:not([hidden])')
    if (anchors.length < 70 || anchors.length !== buttons.length) throw new Error('Missing task controls')
    return Math.max(...anchors.map(([y, x], i) => Math.max(Math.abs(y - buttons[i][0]), Math.abs(x - buttons[i][1]))))
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
    const button = [...document.querySelectorAll('button[aria-label^="外观："]')]
      .find(button => button.getAttribute('aria-label').endsWith('切换为' + mode))
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

async function counters() {
  await send('HeapProfiler.collectGarbage')
  const dom = await send('Memory.getDOMCounters')
  const { usedSize } = await send('Runtime.getHeapUsage')
  const mountedNodes = await page(() => document.querySelectorAll('*').length)
  return { ...dom, mountedNodes, heapMiB: Number((usedSize / 2 ** 20).toFixed(2)) }
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
  const initialMs = Math.round(await page(() => performance.now()))
  const galleryStart = await page(() => performance.now())
  const galleryMs = await openPage(gallery)
  await waitPreview()
  const firstSvgMs = await page(() => performance.now())
  const initialPreviews = await page(() => document.querySelectorAll('[data-preview-language="mermaid"] img').length)
  const galleryReadyMs = firstSvgMs - galleryStart
  await page(() => document.querySelector('button[aria-label^="外观："]').click())
  await frame()
  const dark = await themeSample('深色')
  await renderGallery(page, until, 'dark')
  const light = await themeSample('跟随系统')
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
} finally {
  socket?.close()
  chrome.kill()
  await exited
  await rm(profile, { force: true, recursive: true })
}
