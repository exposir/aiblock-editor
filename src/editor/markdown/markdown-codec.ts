import { Fragment, Slice } from '@tiptap/pm/model'
import type { Fragment as PMFragment, Node as ProseMirrorNode, Schema } from '@tiptap/pm/model'
import { marked } from 'marked'
import type { Token, Tokens, TokensList } from 'marked'
import { normalizeColumnWidths } from '../extensions/column-widths'
import { calloutTheme } from '../types'

const DEFAULT_CALLOUT_ICON = '💡'
const alertThemes: Record<string, string> = {
  NOTE: 'blue',
  TIP: 'green',
  WARNING: 'yellow',
  CAUTION: 'red',
  IMPORTANT: 'purple',
  INFO: 'gray',
}
const themesForAlert: Record<string, string> = {
  blue: 'NOTE',
  green: 'TIP',
  yellow: 'WARNING',
  red: 'CAUTION',
  purple: 'IMPORTANT',
  gray: 'INFO',
}

const emptyFragment = Fragment.empty

function escapeHtml(value: string) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function escapeAttribute(value: string) {
  return encodeURIComponent(value)
}

const safeLinkSchemes = new Set(['http', 'https', 'mailto', 'tel'])

function decodeHtmlEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]+);/gi, (entity, body: string) => {
    if (body.startsWith('#')) {
      const code = body[1]?.toLowerCase() === 'x' ? Number.parseInt(body.slice(2), 16) : Number.parseInt(body.slice(1), 10)
      return Number.isInteger(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : entity
    }
    const named: Record<string, string> = {
      amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", colon: ':', tab: '\t', newline: '\n', nbsp: ' ', sol: '/', bsol: '\\',
    }
    return named[body.toLowerCase()] ?? entity
  })
}

export function sanitizeLinkHref(value: string): string | null {
  const href = value.trim()
  if (!href) return null
  if (href.startsWith('#')) return href
  const probe = decodeHtmlEntities(decodeURIComponentSafe(href)).replace(/[\u0000-\u0020\u007f]+/g, '')
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(probe)?.[1]?.toLowerCase()
  return scheme && !safeLinkSchemes.has(scheme) ? null : href
}

function escapeMarkdownPunctuation(value: string) {
  return value.replace(/\\([!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~])/g, '\\\\$1')
    .replace(/([\\`*_[\]<>])/g, '\\$1')
}

function escapeLinkDestination(value: string) {
  let balance = 0
  let valid = true
  for (const char of value) {
    if (char === '(') balance++
    else if (char === ')' && --balance < 0) {
      valid = false
      break
    }
  }
  if (balance !== 0) valid = false
  const encoded = valid ? value : value.replace(/</g, '%3C').replace(/>/g, '%3E')
  return valid
    ? encoded.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')
    : `<${encoded}>`
}

function escapeTableCell(value: string) {
  return value.replace(/\\/g, '\\\\').replace(/\|/g, '\\|')
}

function inlineCode(value: string) {
  const longest = Math.max(0, ...[...value.matchAll(/`+/g)].map(match => match[0].length))
  const fence = '`'.repeat(longest + 1)
  return `${fence}${value.startsWith('`') || value.endsWith('`') ? ' ' : ''}${value}${value.startsWith('`') || value.endsWith('`') ? ' ' : ''}${fence}`
}

function sortedMarks(node: ProseMirrorNode) {
  const priority = ['link', 'underline', 'strike', 'highlight', 'code', 'bold', 'italic']
  return [...node.marks].sort((left, right) =>
    (priority.indexOf(left.type.name) + 1 || 99) - (priority.indexOf(right.type.name) + 1 || 99))
}

function wrapMark(text: string, mark: ProseMirrorNode['marks'][number]) {
  switch (mark.type.name) {
    case 'bold': return `**${text}**`
    case 'italic': return `*${text}*`
    case 'strike': return `~~${text}~~`
    case 'underline': return `<u>${escapeHtml(text)}</u>`
    case 'highlight': return `==${text.replace(/==/g, '\\==')}==`
    case 'link': return `[${text}](${escapeLinkDestination(String(mark.attrs.href ?? ''))})`
    default: return text
  }
}

function inlineToMarkdown(node: ProseMirrorNode, mode: 'normal' | 'table' = 'normal'): string {
  if (node.isText) {
    let text = node.text ?? ''
    text = mode === 'table' ? escapeTableCell(escapeMarkdownPunctuation(text)) : escapeMarkdownPunctuation(text)
    if (node.marks.some(mark => mark.type.name === 'code')) {
      const code = node.marks.find(mark => mark.type.name === 'code')!
      const raw = mode === 'table' ? (node.text ?? '').replace(/\|/g, '\\|') : node.text ?? ''
      return wrapMark(inlineCode(raw), code)
    }
    return sortedMarks(node).reduce((value, mark) => wrapMark(value, mark), text)
  }
  if (node.type.name === 'hardBreak') return mode === 'table' ? '<br>' : '  \n'
  if (node.type.name === 'image') {
    const src = escapeAttribute(String(node.attrs.src ?? ''))
    return `![${escapeMarkdownPunctuation(String(node.attrs.alt ?? ''))}](${escapeLinkDestination(src)})`
  }
  return node.textContent
}

function inlineContent(node: ProseMirrorNode, mode: 'normal' | 'table' = 'normal') {
  const parts: string[] = []
  node.forEach(child => {
    parts.push(inlineToMarkdown(child, mode))
  })
  return parts.join('')
}

function blockToMarkdown(node: ProseMirrorNode): string {
  switch (node.type.name) {
    case 'heading': {
      const level = Math.min(6, Math.max(1, Number(node.attrs.level) || 1))
      return `${'#'.repeat(level)} ${inlineContent(node)}`
    }
    case 'paragraph': return inlineContent(node)
    case 'blockquote': return prefixLines(childrenToMarkdown(node), '> ')
    case 'codeBlock': {
      const fence = '`'.repeat(Math.max(3, longestBacktickRun(node.textContent) + 1))
      const language = String(node.attrs.language ?? '')
      return `${fence}${language}\n${node.textContent}\n${fence}`
    }
    case 'horizontalRule': return '---'
    case 'bulletList': return listToMarkdown(node, '-')
    case 'orderedList': {
      const start = Number(node.attrs.start) || 1
      return listToMarkdown(node, (index) => `${start + index}.`)
    }
    case 'taskList': return taskListToMarkdown(node)
    case 'table': return tableToMarkdown(node)
    case 'callout': return calloutToMarkdown(node)
    case 'toggle': return toggleToMarkdown(node)
    case 'columnList': return columnListToMarkdown(node)
    default: return node.isLeaf ? '' : childrenToMarkdown(node)
  }
}

function childrenToMarkdown(node: ProseMirrorNode): string {
  const blocks: string[] = []
  node.forEach(child => blocks.push(blockToMarkdown(child)))
  return blocks.filter(Boolean).join('\n\n')
}

function prefixLines(markdown: string, prefix: string) {
  return markdown.split('\n').map(line => `${prefix}${line}`).join('\n')
}

function listToMarkdown(node: ProseMirrorNode, marker: string | ((index: number) => string)): string {
  const lines: string[] = []
  node.forEach((item, _offset, index) => {
    const lead = typeof marker === 'function' ? marker(index) : marker
    const content = childrenToMarkdown(item)
    const [first = '', ...rest] = content.split('\n')
    lines.push(`${lead} ${first}`)
    lines.push(...rest.map(line => line ? `  ${line}` : ''))
  })
  return lines.join('\n')
}

function taskListToMarkdown(node: ProseMirrorNode): string {
  const lines: string[] = []
  node.forEach(item => {
    const checked = item.attrs.checked === true
    const content = childrenToMarkdown(item)
    const [first = '', ...rest] = content.split('\n')
    lines.push(`- [${checked ? 'x' : ' '}] ${first}`)
    lines.push(...rest.map(line => line ? `  ${line}` : ''))
  })
  return lines.join('\n')
}

function tableToMarkdown(node: ProseMirrorNode): string {
  const rows: ProseMirrorNode[] = []
  node.forEach(row => rows.push(row))
  if (!rows.length) return ''
  const cells = (row: ProseMirrorNode) => {
    const values: string[] = []
    row.forEach(cell => values.push(cellToMarkdown(cell)))
    return values
  }
  const width = Math.max(...rows.map(row => row.childCount), 1)
  const normalize = (values: string[]) => Array.from({ length: width }, (_, index) => values[index] ?? '')
  const header = normalize(cells(rows[0]!))
  const separator = header.map(() => '---')
  const body = rows.slice(1).map(row => normalize(cells(row)))
  const line = (values: string[]) => `| ${values.map(value => value.replace(/\n/g, '<br>')).join(' | ')} |`
  return [line(header), line(separator), ...body.map(line)].join('\n')
}

function cellToMarkdown(cell: ProseMirrorNode): string {
  const pieces: string[] = []
  cell.forEach(child => {
    if (child.type.name === 'paragraph' || child.type.name === 'heading') pieces.push(inlineContent(child, 'table'))
    else if (child.type.name === 'bulletList' || child.type.name === 'orderedList' || child.type.name === 'taskList') {
      const lines: string[] = []
      child.forEach(item => lines.push(inlineContent(item, 'table')))
      pieces.push(lines.join('<br>'))
    } else pieces.push(escapeTableCell(blockToMarkdown(child)).replace(/\n/g, '<br>'))
  })
  return pieces.filter(Boolean).join('<br>')
}

function calloutToMarkdown(node: ProseMirrorNode): string {
  const theme = calloutTheme(node.attrs.theme)
  const alert = themesForAlert[theme] ?? 'NOTE'
  const icon = String(node.attrs.icon ?? '')
  const children = childrenToMarkdown(node)
  return prefixLines(`[!${alert}]${icon && icon !== DEFAULT_CALLOUT_ICON ? ` ${icon}` : ''}\n\n${children}`, '> ')
}

function toggleToMarkdown(node: ProseMirrorNode): string {
  const summary = node.childCount > 0 ? inlineContent(node.child(0)) : ''
  const body = node.childCount > 1 ? childrenToMarkdown(node.child(1)) : ''
  return `<details${node.attrs.open === false ? '' : ' open'}>\n<summary>${escapeHtml(summary)}</summary>\n\n${body}\n\n</details>`
}

function columnListToMarkdown(node: ProseMirrorNode): string {
  const widths = normalizeColumnWidths(node.children.map(column => column.attrs.width))
  const parts: string[] = ['::::columns']
  node.forEach((column, _offset, index) => {
    parts.push(`:::column{width=${Number.isInteger(widths[index]) ? widths[index] : Math.round(100 / node.childCount)}}`)
    parts.push(childrenToMarkdown(column))
    parts.push(':::')
  })
  parts.push('::::')
  return parts.join('\n')
}

function longestBacktickRun(value: string): number {
  return Math.max(0, ...[...value.matchAll(/`+/g)].map(match => match[0].length))
}

export function docToMarkdown(doc: ProseMirrorNode): string {
  return childrenToMarkdown(doc).trimEnd() + '\n'
}

type CustomBlock =
  | { kind: 'callout'; theme: string; icon: string; source: string }
  | { kind: 'toggle'; open: boolean; summary: string; source: string }
  | { kind: 'columns'; source: string }

type CustomBlockWithEnd = CustomBlock & { readonly end: number }

function takeCallout(lines: string[], start: number): CustomBlockWithEnd | null {
  const first = lines[start]?.match(/^>(?:\s?)>?\s*\[!([A-Za-z]+)\](?:\s*([^\s].*?))?(?:\s*)$/)
  if (!first || !alertThemes[first[1]!.toUpperCase()]) return null
  const theme = alertThemes[first[1]!.toUpperCase()]!
  const icon = first[2]?.trim() || DEFAULT_CALLOUT_ICON
  const body: string[] = []
  let end = start + 1
  while (end < lines.length && (lines[end] === '' || lines[end]!.startsWith('>'))) {
    const line = lines[end]!
    body.push(line.startsWith('>') ? line.replace(/^>\s?/, '') : '')
    end++
  }
  while (body.length && body[body.length - 1] === '') body.pop()
  return { kind: 'callout', theme, icon, source: body.join('\n'), end }
}

function takeDetails(lines: string[], start: number): CustomBlockWithEnd | null {
  if (!/^<details(?:\s+open)?(?:\s*)>/i.test(lines[start] ?? '')) return null
  let end = start
  while (end < lines.length && !/^<\/details>/i.test(lines[end]!)) end++
  if (end >= lines.length) return null
  const header = lines.slice(start, end + 1)
  const summaryLine = header.find(line => /^<summary>/i.test(line))
  if (!summaryLine) return null
  const summary = summaryLine.replace(/^<summary>/i, '').replace(/<\/summary>(?:\s*)<\/details>$/, '')
    .replace(/<\/summary>/i, '')
  const open = !/<details>/i.test(lines[start]!) || /<details\s+open>/i.test(lines[start]!)
  const summaryIndex = header.indexOf(summaryLine)
  const source = header.slice(summaryIndex + 1).join('\n').replace(/^\n+/, '').replace(/\n+$/, '')
  return { kind: 'toggle', open, summary, source, end }
}

type ColumnBlock = CustomBlockWithEnd & { readonly kind: 'columns' }

function takeColumns(lines: string[], start: number): ColumnBlock | null {
  if (!/^\s*::::columns(?:\s*)$/.test(lines[start] ?? '')) return null
  let end = start
  for (end = start + 1; end < lines.length && !/^\s*::::\s*$/.test(lines[end]!); end++) { /* find the outer fence */ }
  if (end >= lines.length) return null
  return { kind: 'columns', source: lines.slice(start + 1, end).join('\n'), end } as ColumnBlock
}

interface ParsedCustomBlock {
  readonly token: string
  readonly value: CustomBlock
}

function customTokenPrefix(markdown: string): string {
  let prefix = '%%CODEX-'
  while (markdown.includes(prefix)) prefix = `%${prefix}%`
  return prefix
}

function extractCustomBlocks(markdown: string): { markdown: string; blocks: ParsedCustomBlock[] } {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n')
  const rendered: string[] = []
  const blocks: ParsedCustomBlock[] = []
  const prefix = customTokenPrefix(markdown)
  let index = 0
  while (index < lines.length) {
    const callout = takeCallout(lines, index)
    if (callout) {
      const token = `${prefix}${blocks.length}%%`
      blocks.push({ token, value: callout })
      rendered.push('', token, '')
      index = callout.end
      continue
    }
    const details = takeDetails(lines, index)
    if (details) {
      const token = `${prefix}${blocks.length}%%`
      blocks.push({ token, value: details })
      rendered.push('', token, '')
      index = details.end + 1
      continue
    }
    const columns = takeColumns(lines, index)
    if (columns) {
      const token = `${prefix}${blocks.length}%%`
      blocks.push({ token, value: columns })
      rendered.push('', token, '')
      index = columns.end + 1
      continue
    }
    rendered.push(lines[index]!)
    index++
  }
  return { markdown: rendered.join('\n'), blocks }
}

interface MarkdownContext {
  readonly blocks: ReadonlyMap<string, CustomBlock>
}

function blockChildren(node: ProseMirrorNode): PMFragment {
  return node.content
}

function makeParagraph(schema: Schema, content: PMFragment = emptyFragment) {
  return schema.nodes.paragraph!.create(null, content)
}

function parseHtmlInline(schema: Schema, text: string): PMFragment {
  const parts: PMFragment[] = []
  const stack: string[] = []
  const pattern = /<(u|mark)>|<\/(u|mark)>/gi
  let last = 0
  let match: RegExpExecArray | null
  while ((match = pattern.exec(text))) {
    const before = text.slice(last, match.index)
    if (before) parts.push(parseInlineMarks(schema, marked.Lexer.lexInline(before), stack.map(name => schema.marks[name]!.create())))
    if (match[1]) stack.push(match[1].toLowerCase() === 'u' ? 'underline' : 'highlight')
    else {
      const name = match[2]?.toLowerCase() === 'u' ? 'underline' : 'highlight'
      const index = stack.lastIndexOf(name)
      if (index >= 0) stack.splice(index, 1)
    }
    last = pattern.lastIndex
  }
  if (last < text.length) parts.push(parseInlineMarks(schema, marked.Lexer.lexInline(text.slice(last)), stack.map(name => schema.marks[name]!.create())))
  return Fragment.fromArray(parts.flatMap(fragment => fragment.content))
}

function parseInlineMarkdown(schema: Schema, text: string): PMFragment {
  return parseHtmlInline(schema, text)
}

function linkMark(schema: Schema, href: string) {
  const safe = sanitizeLinkHref(href)
  return safe === null ? null : schema.marks.link?.create({ href: safe, target: null, rel: null, class: null })
}

function decodeURIComponentSafe(value: string) {
  try { return decodeURIComponent(value) } catch { return value }
}

type HighlightPiece = { readonly text: string; readonly highlighted: boolean }

function splitHighlight(source: string): HighlightPiece[] {
  const pieces: HighlightPiece[] = []
  let highlighted = false
  let index = 0
  while (index < source.length) {
    const marker = source.indexOf('==', index)
    if (marker < 0) {
      pieces.push({ text: source.slice(index), highlighted })
      break
    }
    pieces.push({ text: source.slice(index, marker), highlighted })
    highlighted = !highlighted
    index = marker + 2
  }
  return pieces
}

function parseInlineMarks(schema: Schema, tokens: readonly Token[], inherited: ProseMirrorNode['marks'] = []): PMFragment {
  return Fragment.fromArray(tokens.flatMap(token => {
    switch (token.type) {
      case 'text':
      case 'escape': {
        if (!token.text) return []
        return splitHighlight(token.text).flatMap(piece => {
          if (!piece.text) return []
          const highlight = schema.marks.highlight?.create()
          return [schema.text(piece.text, piece.highlighted && highlight ? [...inherited, highlight] : inherited)]
        })
      }
      case 'strong': return parseInlineMarks(schema, token.tokens ?? [], [...inherited, schema.marks.bold!.create()]).content
      case 'em': return parseInlineMarks(schema, token.tokens ?? [], [...inherited, schema.marks.italic!.create()]).content
      case 'del': return parseInlineMarks(schema, token.tokens ?? [], [...inherited, schema.marks.strike!.create()]).content
      case 'codespan': return [schema.text(token.text, [schema.marks.code!.create()])]
      case 'link': {
        const mark = linkMark(schema, token.href)
        return parseInlineMarks(schema, token.tokens ?? [], mark ? [...inherited, mark] : inherited).content
      }
      case 'html': {
        if (/^<br\s*\/?>$/i.test(token.raw.trim())) return [schema.nodes.hardBreak!.create()]
        return 'tokens' in token && token.tokens ? parseInlineMarks(schema, token.tokens, inherited).content : []
      }
      case 'br': return [schema.nodes.hardBreak!.create()]
      default: return 'tokens' in token && token.tokens ? parseInlineMarks(schema, token.tokens, inherited).content : []
    }
  }))
}

function paragraphFromInline(schema: Schema, inline: string, attrs: Record<string, unknown> = {}) {
  return schema.nodes.paragraph!.create(attrs, parseInlineMarkdown(schema, inline))
}

function headingFromInline(schema: Schema, inline: string, level: number) {
  return schema.nodes.heading!.create({ level }, parseInlineMarkdown(schema, inline))
}

function parseList(schema: Schema, token: Tokens.List, ctx: MarkdownContext): ProseMirrorNode {
  const task = token.items.length > 0 && token.items.every(item => item.task)
  const type = schema.nodes[task ? 'taskList' : token.ordered ? 'orderedList' : 'bulletList']
  if (!type) return makeParagraph(schema)
  const items: ProseMirrorNode[] = []
  const itemType = schema.nodes[task ? 'taskItem' : 'listItem']!
  for (const item of token.items) {
    const blocks = tokenToBlocks(schema, item.tokens ?? [], ctx)
    const content = blocks.some(node => node.type.name === 'paragraph') ? blocks : [makeParagraph(schema), ...blocks]
    items.push(itemType.create(
      task ? { checked: item.checked === true } : null,
      Fragment.fromArray(content),
    ))
  }
  return type.create(token.ordered ? { start: Number(token.start) || 1 } : null, Fragment.fromArray(items))
}

function parseTableCell(schema: Schema, token: Tokens.TableCell, header: boolean): ProseMirrorNode {
  const paragraph = schema.nodes.paragraph!.create(null, parseInlineMarks(schema, token.tokens ?? []))
  return (header ? schema.nodes.tableHeader : schema.nodes.tableCell)!.create(null, Fragment.fromArray([paragraph]))
}

function parseTable(schema: Schema, token: Tokens.Table): ProseMirrorNode | null {
  const header = token.header.map(cell => parseTableCell(schema, cell, true))
  const rows: ProseMirrorNode[] = []
  const rowType = schema.nodes.tableRow
  if (!rowType) return null
  rows.push(rowType.create(null, Fragment.fromArray(header)))
  for (const row of token.rows) {
    rows.push(rowType.create(null, Fragment.fromArray(row.map(cell => parseTableCell(schema, cell, false)))))
  }
  return schema.nodes.table!.create(null, Fragment.fromArray(rows))
}

function tokenToBlocks(schema: Schema, tokens: readonly Token[], ctx: MarkdownContext): ProseMirrorNode[] {
  const blocks: ProseMirrorNode[] = []
  for (const token of tokens) {
    if (token.type === 'space' || token.type === 'def') continue
    if (token.type === 'text') {
      const custom = ctx.blocks.get(token.raw.trim())
      if (custom) {
        blocks.push(customBlockNode(schema, custom, ctx))
        continue
      }
    }
    switch (token.type) {
      case 'heading':
        blocks.push(headingFromInline(schema, token.text, token.depth))
        break
      case 'paragraph':
        if ((() => {
          const custom = ctx.blocks.get(token.text.trim())
          if (!custom) return false
          blocks.push(customBlockNode(schema, custom, ctx))
          return true
        })()) break
        blocks.push(paragraphFromInline(schema, token.text))
        break
      case 'hr':
        blocks.push(schema.nodes.horizontalRule!.create())
        break
      case 'blockquote': {
        const inner = tokenToBlocks(schema, token.tokens ?? [], ctx)
        blocks.push(schema.nodes.blockquote!.create(null, Fragment.fromArray(inner.length ? inner : [makeParagraph(schema)])))
        break
      }
      case 'list':
        blocks.push(parseList(schema, token as Tokens.List, ctx))
        break
      case 'code':
        blocks.push(schema.nodes.codeBlock!.create({ language: token.lang || 'plaintext' }, token.text ? schema.text(token.text) : null))
        break
      case 'table': {
        const table = parseTable(schema, token as Tokens.Table)
        if (table) blocks.push(table)
        break
      }
      case 'html': {
        const custom = ctx.blocks.get(token.raw.trim())
        if (custom) blocks.push(customBlockNode(schema, custom, ctx))
        else if (token.raw.trim()) {
          const text = token.raw.replace(/<[^>]+>/g, '').trim()
          if (text) blocks.push(paragraphFromInline(schema, text))
        }
        break
      }
      default:
        if ('tokens' in token && Array.isArray(token.tokens)) {
          const nested = tokenToBlocks(schema, token.tokens, ctx)
          blocks.push(...nested)
        } else if ('text' in token && typeof token.text === 'string' && token.text) {
          blocks.push(paragraphFromInline(schema, token.text))
        }
    }
  }
  return blocks
}

function customBlockNode(schema: Schema, custom: CustomBlock, ctx: MarkdownContext): ProseMirrorNode {
  switch (custom.kind) {
    case 'callout': {
      const inner = parseMarkdownBlocks(schema, custom.source, ctx)
      return schema.nodes.callout!.create(
        { theme: calloutTheme(custom.theme), icon: custom.icon },
        Fragment.fromArray(inner.length ? inner : [makeParagraph(schema)]),
      )
    }
    case 'toggle': {
      const inner = parseMarkdownBlocks(schema, custom.source, ctx)
      const summary = schema.nodes.toggleSummary!.create(null, parseInlineMarkdown(schema, custom.summary))
      const body = schema.nodes.toggleContent!.create(null, Fragment.fromArray(inner.length ? inner : [makeParagraph(schema)]))
      return schema.nodes.toggle!.create({ open: custom.open }, Fragment.fromArray([summary, body]))
    }
    case 'columns': return parseColumns(schema, custom.source, ctx)
  }
  const never: never = custom
  return never
}

function parseColumns(schema: Schema, source: string, ctx: MarkdownContext): ProseMirrorNode {
  const lines = source.split('\n')
  const columns: ProseMirrorNode[] = []
  let index = 0
  while (index < lines.length) {
    const header = lines[index]?.match(/^:::column\s*\{\s*width\s*=\s*(\d+(?:\.\d+)?)\s*\}\s*$/)
    if (!header) { index++; continue }
    const width = Number(header[1])
    const start = index + 1
    let end = start
    while (end < lines.length && !/^:::\s*$/.test(lines[end]!)) end++
    const body = lines.slice(start, end).join('\n')
    const blocks = parseMarkdownBlocks(schema, body, ctx)
    columns.push(schema.nodes.column!.create({ width }, Fragment.fromArray(blocks.length ? blocks : [makeParagraph(schema)])))
    index = end + 1
  }
  const widths = normalizeColumnWidths(columns.map(column => column.attrs.width))
  return schema.nodes.columnList!.create(null, Fragment.fromArray(columns.map((column, idx) => column.type.create({ width: widths[idx] }, column.content))))
}

function parseMarkdownBlocks(schema: Schema, markdown: string, ctx: MarkdownContext): ProseMirrorNode[] {
  const extracted = extractCustomBlocks(markdown)
  const merged = new Map<string, CustomBlock>(ctx.blocks)
  for (const block of extracted.blocks) merged.set(block.token, block.value)
  const tokens = marked.Lexer.lex(extracted.markdown) as TokensList
  return tokenToBlocks(schema, tokens, { blocks: merged })
}

export function markdownToSlice(schema: Schema, markdown: string): Slice {
  const blocks = parseMarkdownBlocks(schema, markdown, { blocks: new Map() })
  const doc = schema.topNodeType.create(null, Fragment.fromArray(blocks))
  const content = doc.content
  const openStart = content.firstChild?.isTextblock || content.firstChild?.type.name === 'heading' ? 1 : 0
  const openEnd = content.lastChild?.isTextblock || content.lastChild?.type.name === 'heading' ? 1 : 0
  return new Slice(content, openStart, openEnd)
}

export function markdownToDoc(schema: Schema, markdown: string): ProseMirrorNode {
  const blocks = parseMarkdownBlocks(schema, markdown, { blocks: new Map() })
  return schema.topNodeType.create(null, Fragment.fromArray(blocks.length ? blocks : [makeParagraph(schema)]))
}

