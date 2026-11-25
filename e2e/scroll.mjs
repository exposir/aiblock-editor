// Run against a local Vite server: node e2e/scroll.mjs http://127.0.0.1:5197/
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
const profile = await mkdtemp(join(tmpdir(), 'lark-scroll-'))
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
const scrollY = () => page(() => window.scrollY)

async function openPage(title) {
  await page(title => [...document.querySelectorAll('.workspace-navigation button')]
    .find(button => button.textContent.trim() === title).click(), title)
  await until(() => page(title => document.querySelector('input[aria-label="文档标题"]')?.value === title, title), title)
}

async function target(selector) {
  await page(selector => {
    const element = document.querySelector(selector)
    if (!element) throw new Error('Missing ' + selector)
    element.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' })
  }, selector)
  await frame()
  const point = await page(selector => {
    const rect = document.querySelector(selector).getBoundingClientRect()
    const x = Math.floor(rect.left + rect.width / 2)
    const y = Math.floor(Math.min(innerHeight - 40, rect.bottom - 3, rect.top + rect.height / 2))
    return { x, y }
  }, selector)
  await move(point)
  await frame()
  const hit = await page(({ x, y, selector }) => {
    const element = document.elementFromPoint(x, y)
    return { matches: !!element?.closest(selector), path: element?.outerHTML.slice(0, 160) }
  }, { ...point, selector })
  assert.ok(hit.matches, 'Wheel target must be under the pointer: ' + selector + ' hit ' + hit.path)
  return point
}

async function wheelMovement(selector) {
  const moves = []
  for (const sign of [-1, 1]) {
    const point = await target(selector)
    const before = await scrollY()
    const room = await page(sign => sign < 0 ? scrollY :
      document.scrollingElement.scrollHeight - innerHeight - scrollY, sign)
    if (room <= 0) continue
    const expected = sign * Math.min(room, 120)
    await wheel(point, expected)
    await frame()
    moves.push({ expected, actual: await scrollY() - before })
  }
  assert.ok(moves.length, 'Target must have room to scroll: ' + selector)
  return moves
}

async function profileScroll(point, movingPointer) {
  await page(() => window.scrollTo(0, 0))
  await frame()
  const metrics = async () => Object.fromEntries((await send('Performance.getMetrics')).metrics.map(item => [item.name, item.value]))
  const before = await metrics()
  await page(() => {
    const o = document.querySelector('[data-document-overlays]')
    const sample = { frames: [], styles: 0, reads: 0, headings: 0 }
    const observer = new MutationObserver(records => { sample.styles += records.length })
    observer.observe(o, { subtree: true, attributes: true, attributeFilter: ['style'] })
    const original = Element.prototype.getBoundingClientRect
    Element.prototype.getBoundingClientRect = function () {
      if (this.closest('.ProseMirror, [data-document-overlays]')) sample.reads++
      if (this.matches('.ProseMirror :is(h1,h2,h3,h4,h5,h6)')) sample.headings++
      return original.call(this)
    }
    let last
    let raf
    function tick(t) {
      if (last !== undefined) sample.frames.push(t - last)
      last = t
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    window.finishScrollSample = () => {
      cancelAnimationFrame(raf)
      sample.styles += observer.takeRecords().length
      observer.disconnect()
      Element.prototype.getBoundingClientRect = original
      return { ...sample, scrollY }
    }
  })
  for (let step = 0; step < 45; step++) {
    if (movingPointer) await move({ x: point.x + step % 8, y: point.y })
    await wheel(point, 130)
    await delay(8)
  }
  await frame()
  const { frames, ...observed } = await page(() => window.finishScrollSample())
  const after = await metrics()
  frames.sort((a, b) => a - b)
  assert.equal(observed.scrollY, 45 * 130, 'Sustained wheel input lost page movement')
  return { ...observed, frames: frames.length, p95: frames[Math.floor(frames.length * 0.95)], max: frames.at(-1),
    layouts: after.LayoutCount - before.LayoutCount,
    layoutMs: Math.round(1000 * (after.LayoutDuration - before.LayoutDuration) * 10) / 10 }
}

async function assertWideDocumentScrollsHorizontally() {
  await page(() => {
    const columns = Array.from({ length: 16 }, (_, i) => '字段 ' + (i + 1))
    const row = cells => '| ' + cells.join(' | ') + ' |'
    const markdown = [
      '# 横向滚动测试', '', '~~~text', 'a'.repeat(220), '~~~', '',
      row(columns), row(columns.map(() => '---')), row(columns.map(() => '内容')),
    ].join('\n')
    const dataTransfer = new DataTransfer()
    dataTransfer.items.add(new File([markdown], 'wide.md', { type: 'text/markdown' }))
    document.querySelector('[data-document-surface]').dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer }))
  })
  await until(() => page(() => document.querySelector('.ProseMirror h1')?.textContent === '横向滚动测试'), 'Wide document did not import')
  for (const selector of ['.ProseMirror pre', '.ProseMirror .tableWrapper']) {
    const point = await target(selector)
    const width = await page(selector => {
      const element = document.querySelector(selector)
      return element.scrollWidth - element.clientWidth
    }, selector)
    assert.ok(width >= 120, selector + ' must overflow horizontally')
    const y = await scrollY()
    await wheel(point, 0, 120)
    await frame()
    assert.equal(await page(selector => document.querySelector(selector).scrollLeft, selector), 120)
    assert.equal(await scrollY(), y)
  }
}

async function activeFilters(selector) {
  return page(async selector => {
    return Promise.all([...document.querySelectorAll(selector)].map(async image => {
      // Check the displayed geometry. Mermaid can emit unreferenced filter definitions.
      const frame = document.createElement('iframe')
      frame.sandbox = 'allow-same-origin'
      frame.style.cssText = 'position:fixed;left:-2000px'
      const ready = new Promise(resolve => { frame.onload = resolve })
      frame.srcdoc = decodeURIComponent(image.src.split(',')[1])
      document.body.append(frame)
      await ready
      try {
        const { contentDocument, contentWindow } = frame
        if (!contentDocument.querySelector('svg')) throw new Error('Expected a rendered SVG')
        return [...contentDocument.querySelectorAll('svg, svg *')].filter(node =>
          !node.closest('defs') && contentWindow.getComputedStyle(node).filter !== 'none').length
      } finally {
        frame.remove()
      }
    }))
  }, selector)
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
  await send('Page.navigate', { url })
  await send('Performance.enable')
  await until(() => page(() => document.querySelector('.workspace-navigation button') !== null), 'Workspace did not load')
  await openPage('全图种与公式复杂示例')
  await page(() => document.querySelector('button[aria-label="目录侧栏"]').click())
  await renderGallery(page, until)
  const checks = {}
  const preview = '[data-preview-language="mermaid"] img'
  const toolbar = ':nth-child(2 of .code-control-strip[data-preview-tools]) button[aria-label="复制源码"]'
  checks.diagram = await wheelMovement(preview)
  checks.toolbar = await wheelMovement(toolbar)
  await move({ x: 700, y: 420 })
  await frame()
  const stationary = await profileScroll({ x: 700, y: 420 }, false)
  const moving = await profileScroll({ x: 700, y: 420 }, true)
  const maxAlignmentError = await page(() => {
    const previews = [...document.querySelectorAll('.ProseMirror .rich-code-block')]
    const toolbars = [...document.querySelectorAll('[data-document-overlays] .code-control-strip')]
    return Math.max(...previews.map((preview, index) => {
      const block = preview.getBoundingClientRect()
      const strip = toolbars[index].getBoundingClientRect()
      return Math.max(Math.abs(block.top + 1 - strip.top), Math.abs(block.left + 1 - strip.left))
    }))
  })
  assert.ok(maxAlignmentError <= 0.5, 'Toolbar moved out of alignment after scrolling')
  assert.deepEqual(await activeFilters(preview), Array(10).fill(0), 'Mermaid gallery applied an SVG filter')
  for (const edge of ['top', 'bottom']) {
    const before = await page(edge => {
      const limit = document.scrollingElement.scrollHeight - innerHeight
      scrollTo(0, edge === 'top' ? 0 : limit)
      return { y: scrollY, viewportTop: visualViewport.offsetTop, headerTop: document.querySelector('.workspace-header').getBoundingClientRect().top }
    }, edge)
    for (let tick = 0; tick < 5; tick++) await wheel({ x: 700, y: 420 }, edge === 'top' ? -180 : 180)
    await frame()
    const after = await page(() => ({
      y: scrollY, viewportTop: visualViewport.offsetTop, headerTop: document.querySelector('.workspace-header').getBoundingClientRect().top,
    }))
    assert.deepEqual(after, before, edge + ' boundary shifted')
  }
  await page(() => [...document.querySelectorAll('.code-control-strip button')].find(button => button.textContent === '源码').click())
  checks.source = await wheelMovement('.ProseMirror [data-view-mode="code"] pre')
  await page(() => document.querySelector('button[aria-label="页面侧栏"]').click())
  await openPage('接口与发布规则')
  await until(() => page(() => {
    const image = document.querySelector('[data-preview-language="mermaid"] img')
    return image?.complete && image.naturalWidth && document.querySelectorAll('.ProseMirror .katex').length === 3
  }), 'Release page previews did not settle')
  checks.code = await wheelMovement('.ProseMirror pre:not([hidden]):not([data-code-source])')
  checks.table = await wheelMovement('.ProseMirror .tableWrapper td')
  console.log(JSON.stringify({ wheelDeltas: checks, stationary, moving, maxAlignmentError }, null, 2))
  for (const [region, moves] of Object.entries(checks)) {
    for (const { expected, actual } of moves) assert.equal(actual, expected, region + ' swallowed a vertical wheel delta')
  }
  assert.equal(stationary.reads, 0, 'Page scroll causes document or overlay geometry reads')
  assert.equal(stationary.styles, 0, 'Page scrolling updated document overlay styles')
  await assertWideDocumentScrollsHorizontally()
  console.log('Vertical chaining, page edges and native horizontal scrolling passed')
} finally {
  socket?.close()
  chrome.kill()
  await exited
  await rm(profile, { force: true, recursive: true })
}
