import type { JSONContent } from '@tiptap/core'
import { Check, ChevronRight, Copy } from 'lucide-react'
import { startTransition, useLayoutEffect, useReducer, useRef } from 'react'
import type { CSSProperties, ElementType, MouseEvent, ReactNode } from 'react'
import { normalizeColumnWidths } from '../extensions/column-widths'
import { codeLanguage, isPreviewLanguage } from '../extensions/code-languages'
import { highlightCode } from '../extensions/code-syntax'
import type { CodeToken } from '../extensions/code-syntax'
import { codeHighlightWorker } from '../extensions/long-code-highlight'
import { imageAttributes } from '../extensions/image-attributes'
import { watchImageSource } from '../extensions/image-assets'
import { observeViewport } from '../components/viewport'
import { sanitizeLinkHref } from '../markdown/markdown-codec'
import { calloutTheme } from '../types'
import { attachCodePreview } from './code-preview'
import { renderMath } from './math'

type JsonNode = JSONContent
type JsonMark = NonNullable<JsonNode['marks']>[number]

interface RenderContext {
  readonly activeComment: string | null
}

const previewChunkSize = 24
const cacheLimit = 256
const codeCache = new Map<string, readonly CodeToken[]>()
const mathCache = new Map<string, string | null>()

function cacheGet<T>(cache: Map<string, T>, key: string): T | undefined {
  const value = cache.get(key)
  if (value !== undefined) {
    cache.delete(key)
    cache.set(key, value)
  }
  return value
}

function cacheSet<T>(cache: Map<string, T>, key: string, value: T) {
  cache.delete(key)
  cache.set(key, value)
  if (cache.size > cacheLimit) cache.delete(cache.keys().next().value!)
}

function textContent(node: JsonNode): string {
  if (node.type === 'text') return node.text ?? ''
  if (node.type === 'hardBreak') return '\n'
  return (node.content ?? []).map(textContent).join('')
}

function stringAttr(node: JsonNode, name: string, fallback = ''): string {
  const value = node.attrs?.[name]
  return typeof value === 'string' ? value : fallback
}

function blockAttributes(node: JsonNode, className: string): {
  readonly className: string
  readonly 'data-block-id'?: string
  readonly 'data-block-bg'?: string
} {
  const blockId = stringAttr(node, 'blockId')
  const blockBg = stringAttr(node, 'blockBg')
  return {
    className,
    ...(blockId ? { 'data-block-id': blockId } : {}),
    ...(blockBg ? { 'data-block-bg': blockBg } : {}),
  }
}

function Nodes({ nodes, context }: { readonly nodes?: readonly JSONContent[]; readonly context: RenderContext }) {
  return <>{nodes?.map((node, index) => <NodeView key={`${node.type ?? 'node'}-${index}`} node={node} context={context} />)}</>
}

function PreviewChunks({ nodes, context }: { readonly nodes: readonly JSONContent[]; readonly context: RenderContext }) {
  const chunks: JSONContent[][] = []
  for (let index = 0; index < nodes.length; index += previewChunkSize) {
    chunks.push(nodes.slice(index, index + previewChunkSize))
  }
  return <>{chunks.map((chunk, index) =>
    <div className="preview-chunk" data-preview-chunk="" key={index}><Nodes nodes={chunk} context={context} /></div>,
  )}</>
}

function markContent(mark: JsonMark, content: ReactNode, context: RenderContext): ReactNode {
  const color = stringAttr({ type: 'mark', attrs: mark.attrs }, 'color')
  switch (mark.type) {
    case 'bold': return <strong>{content}</strong>
    case 'italic': return <em>{content}</em>
    case 'underline': return <u>{content}</u>
    case 'strike': return <s>{content}</s>
    case 'code': return <code>{content}</code>
    case 'highlight': return <mark data-color={color || undefined} style={color ? { backgroundColor: color } : undefined}>{content}</mark>
    case 'textStyle': return color ? <span data-color={color} style={{ color }}>{content}</span> : content
    case 'link': {
      const href = sanitizeLinkHref(stringAttr({ type: 'mark', attrs: mark.attrs }, 'href'))
      if (!href) return content
      const external = !href.startsWith('#')
      return <a href={href} {...(external ? { target: '_blank', rel: 'noreferrer noopener' } : {})}>{content}</a>
    }
    case 'comment': {
      const id = stringAttr({ type: 'mark', attrs: mark.attrs }, 'commentId')
      if (!id) return content
      return <span data-comment-id={id} className={`comment-mark${context.activeComment === id ? ' comment-active' : ''}`}>{content}</span>
    }
    default: return content
  }
}

function InlineNode({ node, context }: { readonly node: JsonNode; readonly context: RenderContext }) {
  if (node.type === 'hardBreak') return <br />
  let content: ReactNode = node.type === 'inlineMath'
    ? <span className="inline-math" data-preview-math={stringAttr(node, 'latex')} aria-label={`公式：${stringAttr(node, 'latex')}`}>
        {stringAttr(node, 'latex')}
      </span>
    : node.text ?? ''
  for (const mark of node.marks ?? []) content = markContent(mark, content, context)
  return <>{content}</>
}

function PreviewImage({ node }: { readonly node: JsonNode }) {
  const target = useRef<HTMLElement>(null)
  const stop = useRef<(() => void) | undefined>(undefined)
  const attrs = imageAttributes(node.attrs ?? {})
  const state = useRef({ url: null as string | null, resolved: false })
  const [, render] = useReducer((value: number) => value + 1, 0)

  useLayoutEffect(() => {
    if (!target.current) return
    return observeViewport(target.current, 800, visible => {
      if (!visible) return
      stop.current?.()
      stop.current = watchImageSource(attrs, next => {
        state.current = { url: next, resolved: true }
        render()
      })
    })
  }, [attrs.assetId, attrs.src])
  useLayoutEffect(() => () => stop.current?.(), [])

  return <figure {...blockAttributes(node, 'image-block')} data-align={attrs.align} ref={target}>
    <span className="image-block-frame" style={{ width: `${attrs.displayWidth ?? attrs.width}px`, aspectRatio: `${attrs.width} / ${attrs.height}` }}>
      {state.current.url ? <img src={state.current.url} alt={attrs.alt} decoding="async" draggable={false} referrerPolicy="no-referrer" /> : null}
      {state.current.resolved && !state.current.url ? <span className="image-unavailable" title={attrs.alt}>图片不可用</span> : null}
    </span>
  </figure>
}

function CopyButton() {
  return <button type="button" className="preview-copy" data-preview-copy="" aria-label="复制代码" title="复制代码">
    <Copy className="preview-copy-icon" size={13} aria-hidden="true" data-copy-icon="" />
    <span className="preview-copy-icon" data-copied-icon="" hidden><Check size={13} aria-hidden="true" /></span>
    <span data-copy-label="">复制</span>
  </button>
}

function highlightedCode(text: string, tokens: readonly CodeToken[] | null) {
  if (!tokens?.length) return text
  const parts: ReactNode[] = []
  let cursor = 0
  for (const [index, token] of tokens.entries()) {
    if (token.from > cursor) parts.push(text.slice(cursor, token.from))
    parts.push(<span key={index} className={token.className}>{text.slice(token.from, token.to)}</span>)
    cursor = token.to
  }
  if (cursor < text.length) parts.push(text.slice(cursor))
  return parts
}

function PreviewCodeBlock({ node }: { readonly node: JsonNode }) {
  const language = codeLanguage(stringAttr(node, 'language', 'plaintext'))
  const source = textContent(node)
  const cached = cacheGet(codeCache, `${language}\0${source}`)
  return <div {...blockAttributes(node, 'preview-code-block')}>
    <div className="preview-code-toolbar"><span>{language}</span><CopyButton /></div>
    <pre data-preview-code="" data-language={language} data-wrap={node.attrs?.wrap === true ? 'true' : undefined}>
      <code>{highlightedCode(source, cached ?? null)}</code>
    </pre>
  </div>
}

function PreviewRichCodeBlock({ node }: { readonly node: JsonNode }) {
  const language = codeLanguage(stringAttr(node, 'language', 'plaintext'))
  const source = textContent(node)
  return <div {...blockAttributes(node, 'rich-code-block')} data-view-mode="preview" data-preview-language={language}>
    <div className="preview-code-toolbar">
      <div className="preview-code-modes" role="group" aria-label="预览视图">
        <button type="button" data-preview-view="preview" aria-pressed="true">预览</button>
        <button type="button" data-preview-view="code" aria-pressed="false">源码</button>
      </div>
      <CopyButton />
    </div>
    <div className="rich-code-preview" data-preview-rich={language} />
    <pre data-code-source="" hidden><code>{source}</code></pre>
  </div>
}

function PreviewCode({ node }: { readonly node: JsonNode }) {
  return isPreviewLanguage(codeLanguage(stringAttr(node, 'language', 'plaintext')))
    ? <PreviewRichCodeBlock node={node} />
    : <PreviewCodeBlock node={node} />
}

function PreviewTaskItem({ node, context }: { readonly node: JsonNode; readonly context: RenderContext }) {
  const checked = node.attrs?.checked === true
  return <li {...blockAttributes(node, '')} data-type="taskItem" data-checked={checked}>
    <div className="task-item-view">
      <span className="task-checkbox preview-task-checkbox" role="checkbox" aria-checked={checked}
        aria-disabled="true" aria-label={checked ? '已完成任务' : '未完成任务'} />
      <div className="task-item-content"><Nodes nodes={node.content} context={context} /></div>
    </div>
  </li>
}

function PreviewToggle({ node, context }: { readonly node: JsonNode; readonly context: RenderContext }) {
  const open = node.attrs?.open !== false
  const summary = node.content?.find(child => child.type === 'toggleSummary')
  const body = node.content?.find(child => child.type === 'toggleContent')
  return <div {...blockAttributes(node, 'toggle preview-toggle')} data-toggle="" data-open={String(open)}>
    <button type="button" className="preview-toggle-button" aria-expanded={open}
      aria-label={open ? '收起折叠内容' : '展开折叠内容'}>
      <ChevronRight size={15} aria-hidden="true" />
    </button>
    <div className="toggle-content">
      <div data-toggle-summary="">{summary ? <Nodes nodes={summary.content} context={context} /> : null}</div>
      <div data-toggle-content="" inert={!open ? true : undefined} aria-hidden={!open}>
        <div className="toggle-body-inner">{body ? <Nodes nodes={body.content} context={context} /> : null}</div>
      </div>
    </div>
  </div>
}

function PreviewTable({ node, context }: { readonly node: JsonNode; readonly context: RenderContext }) {
  const rows = node.content ?? []
  const widths = rows[0]?.content?.flatMap(cell =>
    Array.isArray(cell.attrs?.colwidth) ? cell.attrs.colwidth.filter((width): width is number => typeof width === 'number' && width > 0) : []) ?? []
  return <div {...blockAttributes(node, 'tableWrapper')}>
    <table className="tiptap-table">
      {widths.length ? <colgroup>{widths.map((width, index) => <col key={index} style={{ width }} />)}</colgroup> : null}
      <tbody>{rows.map((row, index) => <NodeView key={`row-${index}`} node={row} context={context} />)}</tbody>
    </table>
  </div>
}

function PreviewColumns({ node, context }: { readonly node: JsonNode; readonly context: RenderContext }) {
  const columns = node.content ?? []
  const widths = normalizeColumnWidths(columns.map(column => typeof column.attrs?.width === 'number' ? column.attrs.width : null))
  return <div {...blockAttributes(node, 'column-layout')}>
    <div className="column-grid" style={{ '--column-tracks': widths.map(width => `${width}%`).join(' ') } as CSSProperties}>
      {columns.map((column, index) => <div key={index} data-column="" data-width={column.attrs?.width ?? widths[index]} style={{ gridColumn: index + 1 }}>
        <Nodes nodes={column.content} context={context} />
      </div>)}
    </div>
  </div>
}

function NodeView({ node, context }: { readonly node: JsonNode; readonly context: RenderContext }) {
  switch (node.type) {
    case 'doc': return <Nodes nodes={node.content} context={context} />
    case 'text': return <InlineNode node={node} context={context} />
    case 'paragraph': return <p {...blockAttributes(node, '')}><Nodes nodes={node.content} context={context} /></p>
    case 'heading': {
      const level = Math.min(6, Math.max(1, Number(node.attrs?.level) || 1))
      const Tag = `h${level}` as ElementType
      return <Tag {...blockAttributes(node, '')}><Nodes nodes={node.content} context={context} /></Tag>
    }
    case 'blockquote': return <blockquote {...blockAttributes(node, '')}><Nodes nodes={node.content} context={context} /></blockquote>
    case 'bulletList': return <ul {...blockAttributes(node, '')}><Nodes nodes={node.content} context={context} /></ul>
    case 'orderedList': return <ol {...blockAttributes(node, '')} start={Number(node.attrs?.start) || 1}><Nodes nodes={node.content} context={context} /></ol>
    case 'listItem': return <li {...blockAttributes(node, '')}><Nodes nodes={node.content} context={context} /></li>
    case 'taskList': return <ul {...blockAttributes(node, '')} data-type="taskList"><Nodes nodes={node.content} context={context} /></ul>
    case 'taskItem': return <PreviewTaskItem node={node} context={context} />
    case 'horizontalRule': return <hr {...blockAttributes(node, '')} />
    case 'table': return <PreviewTable node={node} context={context} />
    case 'tableRow': return <tr {...blockAttributes(node, '')}><Nodes nodes={node.content} context={context} /></tr>
    case 'tableHeader':
    case 'tableCell': {
      const Tag: ElementType = node.type === 'tableHeader' ? 'th' : 'td'
      const colwidth = Array.isArray(node.attrs?.colwidth) ? node.attrs.colwidth.join(',') : undefined
      return <Tag {...blockAttributes(node, '')} colSpan={Number(node.attrs?.colspan) || 1}
        rowSpan={Number(node.attrs?.rowspan) || 1} data-colwidth={colwidth}><Nodes nodes={node.content} context={context} /></Tag>
    }
    case 'callout': {
      const theme = calloutTheme(node.attrs?.theme)
      const icon = stringAttr(node, 'icon', '💡')
      return <aside {...blockAttributes(node, 'callout')} data-callout="" data-theme={theme} data-icon={icon}>
        <span className="callout-icon" aria-hidden="true">{icon}</span>
        <div className="callout-content"><Nodes nodes={node.content} context={context} /></div>
      </aside>
    }
    case 'toggle': return <PreviewToggle node={node} context={context} />
    case 'toggleSummary': return <div {...blockAttributes(node, '')} data-toggle-summary=""><Nodes nodes={node.content} context={context} /></div>
    case 'toggleContent': return <div {...blockAttributes(node, '')} data-toggle-content=""><div className="toggle-body-inner"><Nodes nodes={node.content} context={context} /></div></div>
    case 'columnList': return <PreviewColumns node={node} context={context} />
    case 'column': return <div {...blockAttributes(node, '')} data-column="" data-width={node.attrs?.width}><Nodes nodes={node.content} context={context} /></div>
    case 'codeBlock': return <PreviewCode node={node} />
    case 'inlineMath': return <InlineNode node={node} context={context} />
    case 'hardBreak': return <br />
    case 'imageBlock': return <PreviewImage node={node} />
    default: return node.content ? <Nodes nodes={node.content} context={context} /> : <>{node.text}</>
  }
}

function sourceOf(element: Element): string {
  return element.querySelector('code')?.textContent ?? ''
}

function applyCodeTokens(code: HTMLElement, source: string, tokens: readonly CodeToken[]) {
  const document = code.ownerDocument
  const fragment = document.createDocumentFragment()
  let cursor = 0
  for (const token of tokens) {
    if (token.from > cursor) fragment.append(document.createTextNode(source.slice(cursor, token.from)))
    const span = document.createElement('span')
    span.className = token.className
    span.textContent = source.slice(token.from, token.to)
    fragment.append(span)
    cursor = token.to
  }
  if (cursor < source.length) fragment.append(document.createTextNode(source.slice(cursor)))
  code.replaceChildren(fragment)
}

function attachLazyPreviews(root: HTMLElement) {
  const win = root.ownerDocument.defaultView
  if (!win) return
  const controllers = new WeakMap<Element, ReturnType<typeof attachCodePreview>>()
  const queue: Array<{ readonly kind: 'code' | 'math' | 'rich'; readonly element: HTMLElement }> = []
  let idleId: number | undefined
  let timer: number | undefined
  let running = false
  let disposed = false
  let scrollingUntil = 0
  const worker = codeHighlightWorker()
  type IdleWindow = Window & {
    requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number
    cancelIdleCallback?: (id: number) => void
  }
  const idle = win as IdleWindow

  function schedule() {
    if (disposed || running || !queue.length || idleId !== undefined || timer !== undefined) return
    const run = () => {
      idleId = undefined
      timer = undefined
      if (disposed || running) return
      const scrollWait = scrollingUntil - performance.now()
      if (scrollWait > 0) {
        timer = win!.setTimeout(run, Math.min(120, scrollWait))
        return
      }
      const task = queue.shift()
      if (!task) return
      if (!task.element.isConnected) {
        schedule()
        return
      }
      running = true
      const work = task.kind === 'code'
        ? (() => {
            const code = task.element.querySelector<HTMLElement>('code')
            if (!code) return Promise.resolve()
            const language = task.element.dataset.language ?? 'plaintext'
            const source = code.textContent ?? ''
            const key = `${language}\0${source}`
            const cached = cacheGet(codeCache, key)
            if (cached) {
              startTransition(() => applyCodeTokens(code, source, cached))
              return Promise.resolve()
            }
            const tokens = source.length > 16_384
              ? worker.color(language, source)
              : Promise.resolve().then(() => highlightCode(language, source))
            return tokens.then(next => {
              cacheSet(codeCache, key, next)
              if (code.isConnected) startTransition(() => applyCodeTokens(code, source, next))
            }).catch(() => {})
          })()
        : task.kind === 'math' ? (() => {
            const latex = task.element.dataset.previewMath ?? ''
            const cached = cacheGet(mathCache, latex)
            if (cached !== undefined) {
              if (cached) startTransition(() => { task.element.innerHTML = cached })
              return Promise.resolve()
            }
            return renderMath(latex, false).then(markup => {
              cacheSet(mathCache, latex, markup)
              if (markup && task.element.isConnected) startTransition(() => { task.element.innerHTML = markup })
            }).catch(() => {})
          })()
          : (() => {
              const rect = task.element.getBoundingClientRect()
              if (rect.bottom >= -900 && rect.top <= win!.innerHeight + 900) attachRich(task.element)
              else observer?.observe(task.element)
              return Promise.resolve()
            })()
      void work.finally(() => {
        running = false
        schedule()
      })
    }
    if (idle.requestIdleCallback) idleId = idle.requestIdleCallback(run, { timeout: 250 })
    else timer = win!.setTimeout(run, 0)
  }

  const observer = typeof win.IntersectionObserver === 'function'
    ? new win.IntersectionObserver(entries => {
        for (const entry of entries) {
          const target = entry.target
          if (target instanceof HTMLElement && target.matches('pre[data-preview-code]')) {
            if (!entry.isIntersecting) continue
            observer?.unobserve(target)
            queue.push({ kind: 'code', element: target })
            schedule()
            continue
          }
          if (target instanceof HTMLElement && target.matches('[data-preview-math]')) {
            if (!entry.isIntersecting) continue
            observer?.unobserve(target)
            const latex = target.dataset.previewMath ?? ''
            const cached = cacheGet(mathCache, latex)
            if (cached !== undefined) {
              if (cached) startTransition(() => { target.innerHTML = cached })
              continue
            }
            queue.push({ kind: 'math', element: target })
            schedule()
            continue
          }
          if (target instanceof HTMLElement && target.matches('[data-preview-rich]')) {
            if (entry.isIntersecting) {
              if (controllers.has(target)) continue
              observer?.unobserve(target)
              queue.push({ kind: 'rich', element: target })
              schedule()
            } else {
              controllers.get(target)?.destroy()
              controllers.delete(target)
              target.replaceChildren()
            }
          }
        }
      }, { rootMargin: '600px 0px' })
    : null

  function observeMath(target: HTMLElement) {
    const latex = target.dataset.previewMath ?? ''
    const cached = cacheGet(mathCache, latex)
    if (cached !== undefined) {
      if (cached) target.innerHTML = cached
      return
    }
    if (observer) {
      observer.observe(target)
      return
    }
    queue.push({ kind: 'math', element: target })
    schedule()
  }

  function attachRich(target: HTMLElement) {
    const block = target.closest<HTMLElement>('.rich-code-block')
    const language = block?.dataset.previewLanguage
    if (!block || (language !== 'mermaid' && language !== 'math')) return
    const preview = attachCodePreview(target)
    preview.update(language, sourceOf(block))
    controllers.set(target, preview)
  }

  for (const block of root.querySelectorAll<HTMLElement>('pre[data-preview-code]')) {
    const language = block.dataset.language ?? 'plaintext'
    if (language === 'plaintext') continue
    const source = sourceOf(block)
    const cached = cacheGet(codeCache, `${language}\0${source}`)
    if (cached) {
      const code = block.querySelector<HTMLElement>('code')
      if (code) applyCodeTokens(code, source, cached)
    } else if (observer) observer.observe(block)
    else {
      queue.push({ kind: 'code', element: block })
      schedule()
    }
  }
  for (const target of root.querySelectorAll<HTMLElement>('[data-preview-math]')) {
    observeMath(target)
  }
  for (const target of root.querySelectorAll<HTMLElement>('[data-preview-rich]')) {
    if (observer) observer.observe(target)
    else attachRich(target)
  }

  const followScroll = () => {
    scrollingUntil = performance.now() + 180
    schedule()
  }
  win.addEventListener('scroll', followScroll, { passive: true })

  return () => {
    disposed = true
    win.removeEventListener('scroll', followScroll)
    if (idleId !== undefined && idle.cancelIdleCallback) idle.cancelIdleCallback(idleId)
    if (timer !== undefined) win.clearTimeout(timer)
    observer?.disconnect()
    worker.destroy()
    for (const target of root.querySelectorAll<HTMLElement>('[data-preview-rich]')) {
      controllers.get(target)?.destroy()
      controllers.delete(target)
    }
  }
}

function togglePreview(button: HTMLButtonElement) {
  const toggle = button.closest<HTMLElement>('.preview-toggle')
  if (!toggle) return
  const open = toggle.dataset.open !== 'true'
  const content = toggle.querySelector<HTMLElement>('[data-toggle-content]')
  toggle.dataset.open = String(open)
  button.setAttribute('aria-expanded', String(open))
  button.setAttribute('aria-label', open ? '收起折叠内容' : '展开折叠内容')
  if (content) {
    content.setAttribute('aria-hidden', String(!open))
    if (open) content.removeAttribute('inert')
    else content.setAttribute('inert', '')
  }
}

function switchPreviewView(button: HTMLButtonElement) {
  const block = button.closest<HTMLElement>('.rich-code-block')
  const mode = button.dataset.previewView
  if (!block || (mode !== 'preview' && mode !== 'code')) return
  block.dataset.viewMode = mode
  const preview = block.querySelector<HTMLElement>('.rich-code-preview')
  const source = block.querySelector<HTMLElement>('pre[data-code-source]')
  if (preview) preview.hidden = mode === 'code'
  if (source) source.hidden = mode !== 'code'
  for (const option of block.querySelectorAll<HTMLButtonElement>('[data-preview-view]')) {
    option.setAttribute('aria-pressed', String(option.dataset.previewView === mode))
  }
}

async function copyPreviewCode(button: HTMLButtonElement, timer: { current?: ReturnType<typeof setTimeout> }) {
  const block = button.closest<HTMLElement>('.preview-code-block, .rich-code-block')
  const source = block?.querySelector<HTMLElement>('pre code')?.textContent
  if (source === undefined) return
  try {
    await navigator.clipboard.writeText(source)
  } catch {
    return
  }
  const icon = button.querySelector<HTMLElement>('[data-copy-icon]')
  const copied = button.querySelector<HTMLElement>('[data-copied-icon]')
  const label = button.querySelector<HTMLElement>('[data-copy-label]')
  button.setAttribute('aria-label', '已复制代码')
  if (icon) icon.hidden = true
  if (copied) copied.hidden = false
  if (label) label.textContent = '已复制'
  clearTimeout(timer.current)
  timer.current = setTimeout(() => {
    if (!button.isConnected) return
    button.setAttribute('aria-label', '复制代码')
    if (icon) icon.hidden = false
    if (copied) copied.hidden = true
    if (label) label.textContent = '复制'
  }, 1400)
}

export function DocumentPreview({ content, activeComment = null }: {
  readonly content: JSONContent
  readonly activeComment?: string | null
}) {
  const root = useRef<HTMLElement>(null)
  const copyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const nodes = content.type === 'doc' ? content.content ?? [] : [content]

  useLayoutEffect(() => {
    if (!root.current) return
    return attachLazyPreviews(root.current)
  }, [content])
  useLayoutEffect(() => () => clearTimeout(copyTimer.current), [])

  function onClick(event: MouseEvent<HTMLElement>) {
    if (!(event.target instanceof Element)) return
    const toggle = event.target.closest<HTMLButtonElement>('.preview-toggle-button')
    if (toggle) {
      togglePreview(toggle)
      return
    }
    const view = event.target.closest<HTMLButtonElement>('[data-preview-view]')
    if (view) {
      switchPreviewView(view)
      return
    }
    const copy = event.target.closest<HTMLButtonElement>('[data-preview-copy]')
    if (copy) void copyPreviewCode(copy, copyTimer)
  }

  return <article ref={root} className="document-editor document-preview" role="article" aria-label="文档预览" onClick={onClick}>
    <PreviewChunks nodes={nodes} context={{ activeComment }} />
  </article>
}

export interface PreviewOutlineEntry {
  readonly blockId: string
  readonly level: number
  readonly text: string
}

export function extractPreviewOutline(content: JSONContent): PreviewOutlineEntry[] {
  const entries: PreviewOutlineEntry[] = []
  function visit(node: JsonNode) {
    if (node.type === 'heading') {
      const blockId = stringAttr(node, 'blockId')
      const level = Number(node.attrs?.level)
      const text = textContent(node).trim()
      if (blockId && Number.isInteger(level) && text) entries.push({ blockId, level, text })
    }
    for (const child of node.content ?? []) visit(child)
  }
  visit(content)
  return entries
}
