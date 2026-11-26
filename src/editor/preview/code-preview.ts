import { observeViewport } from '../components/viewport'
import { renderMath } from './math'
import { renderMermaid } from './mermaid'

import type { PreviewLanguage } from '../extensions/code-languages'

export function isDark(owner: Document): boolean {
  return owner.documentElement.dataset.theme === 'dark'
}

const themeWatchers = new WeakMap<Document, { observer: MutationObserver; listeners: Set<() => void> }>()
function subscribeTheme(owner: Document, listener: () => void): () => void {
  let watcher = themeWatchers.get(owner)
  if (!watcher) {
    const listeners = new Set<() => void>()
    const observer = new MutationObserver(() => { for (const notify of listeners) notify() })
    observer.observe(owner.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    watcher = { observer, listeners }
    themeWatchers.set(owner, watcher)
  }
  watcher.listeners.add(listener)
  return () => {
    watcher.listeners.delete(listener)
    if (!watcher.listeners.size) {
      watcher.observer.disconnect()
      themeWatchers.delete(owner)
    }
  }
}

function showMessage(panel: HTMLElement, message: string, error = false) {
  const span = panel.ownerDocument.createElement('span')
  span.className = error ? 'code-preview-error' : 'code-preview-loading'
  if (error) span.setAttribute('role', 'status')
  span.textContent = message
  panel.replaceChildren(span)
}

export function attachCodePreview(panel: HTMLElement) {
  const doc = panel.ownerDocument
  let language: PreviewLanguage | undefined
  let source = ''
  let timer: ReturnType<typeof setTimeout> | undefined
  let revision = 0
  let near = false
  let dirty = false
  let stopTheme: (() => void) | undefined
  let stopPreview: (() => void) | undefined

  function cancel() {
    revision++
    clearTimeout(timer)
  }

  async function draw() {
    const current = ++revision
    if (language === 'mermaid') {
      const result = await renderMermaid(source, isDark(doc), () => current === revision && near)
      if (current !== revision) return
      dirty = false
      panel.style.removeProperty('min-height')
      if (!result) {
        showMessage(panel, '无法预览图表，请切到分栏或源码检查 Mermaid 语法。', true)
        return
      }
      const image = doc.createElement('img')
      image.className = 'code-preview-image'
      image.alt = 'Mermaid 图表'
      // An SVG image cannot run script or navigate the editor when displayed.
      image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(result.svg)}`
      const viewBox = /\bviewBox="[^"]*?\s([\d.]+)\s([\d.]+)"/.exec(result.svg)
      if (viewBox) {
        image.width = Math.ceil(Number(viewBox[1]))
        image.height = Math.ceil(Number(viewBox[2]))
      }
      panel.replaceChildren(image)
      return
    }
    const markup = await renderMath(source, true)
    if (current !== revision) return
    if (markup) panel.innerHTML = markup
    else showMessage(panel, '无法预览公式，请切到分栏或源码检查 LaTeX 语法。', true)
  }

  return {
    update(nextLanguage: PreviewLanguage | undefined, nextSource: string) {
      if (language === nextLanguage && source === nextSource) return
      const previous = language
      cancel()
      if (previous === 'mermaid' && nextLanguage !== 'mermaid') {
        stopTheme?.()
        stopPreview?.()
        stopTheme = stopPreview = undefined
        near = false
        panel.style.removeProperty('min-height')
      }
      language = nextLanguage
      source = nextSource
      if (!language) return
      if (language === 'mermaid') {
        dirty = true
        if (previous !== 'mermaid') {
          if (!panel.querySelector('img')) {
            panel.style.minHeight = `${Math.max(180, Math.min(720, source.split('\n').length * 22))}px`
            showMessage(panel, '正在生成预览…')
          }
          stopTheme = subscribeTheme(doc, () => {
            cancel()
            dirty = true
            if (near) void draw()
          })
          stopPreview = observeViewport(panel, 300, visible => {
            if (visible === near) return
            near = visible
            if (!near) cancel()
            else if (dirty) void draw()
          })
        } else if (near) timer = setTimeout(() => void draw(), 140)
      } else if (!previous) {
        showMessage(panel, '正在生成预览…')
        void draw()
      } else {
        timer = setTimeout(() => void draw(), 140)
      }
    },
    destroy() {
      cancel()
      stopTheme?.()
      stopPreview?.()
    },
  }
}
