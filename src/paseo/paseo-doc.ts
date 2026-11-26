import type { JSONContent } from '@tiptap/core'
import type { Schema } from '@tiptap/pm/model'
import { assignMissingBlockIds } from '../editor/extensions/block-id'
import { markdownToDoc } from '../editor/markdown/markdown-codec'
import type { PaseoAgent, PaseoLogItem } from './paseo-types'

export interface PaseoDocumentOptions {
  readonly includeDetails?: boolean
  readonly emptyMessage?: string
}

export interface PaseoDocument {
  readonly markdown: string
  readonly content: JSONContent
}

function oneLine(value: string, limit: number): string {
  const normalized = (value.split(/\r?\n/).find(line => line.trim()) ?? '').replace(/\s+/g, ' ').trim()
  const characters = Array.from(normalized)
  return characters.length <= limit ? normalized : `${characters.slice(0, limit - 1).join('')}…`
}

function quote(value: string): string {
  return value.split(/\r?\n/).map(line => line ? `> ${line}` : '>').join('\n')
}

function statusLabel(agent: PaseoAgent): string {
  if (agent.requiresAttention) return '等待处理'
  switch (agent.lastStatus.toLowerCase()) {
    case 'running': return '运行中'
    case 'closed': return '已关闭'
    case 'idle': return '空闲'
    default: return agent.lastStatus || '未知'
  }
}

function markdownFence(value: string): string {
  const longest = Math.max(0, ...[...value.matchAll(/`+/g)].map(match => match[0].length))
  return '`'.repeat(Math.max(3, longest + 1))
}

function codeBlock(value: string, language = ''): string {
  const fence = markdownFence(value)
  return `${fence}${language}\n${value}\n${fence}`
}

function toolDetail(item: PaseoLogItem): string {
  const parts = [`**工具调用 · ${item.name || '未命名工具'}**`]
  if (item.status) parts.push(`状态：${item.status}`)
  if (item.detail && typeof item.detail === 'object' && !Array.isArray(item.detail)) {
    const detail = item.detail as Record<string, unknown>
    if (typeof detail.filePath === 'string') parts.push(`文件：\`${detail.filePath}\``)
    if (typeof detail.command === 'string') {
      parts.push('命令：', codeBlock(detail.command, 'shell'))
    }
    if (typeof detail.output === 'string' && detail.output) {
      parts.push('输出：', codeBlock(detail.output, 'text'))
    }
    if (!('filePath' in detail) && !('command' in detail) && !('output' in detail)) {
      parts.push(codeBlock(JSON.stringify(item.detail, null, 2), 'json'))
    }
  } else if (item.detail !== undefined) {
    parts.push(codeBlock(JSON.stringify(item.detail, null, 2)))
  }
  if (item.error) parts.push(`错误：\n\n${item.error}`)
  return parts.join('\n\n')
}

function detailsBlock(items: readonly PaseoLogItem[]): string {
  const body = items.map(item => item.type === 'reasoning'
    ? `**思考**\n\n${item.text || '(无思考内容)'}`
    : toolDetail(item)).join('\n\n')
  return `<details>\n<summary>思考与工具调用（${items.length} 项）</summary>\n\n${body}\n\n</details>`
}

export function paseoLogsToMarkdown(
  workspaceTitle: string,
  agent: PaseoAgent | null,
  items: readonly PaseoLogItem[],
  options: PaseoDocumentOptions = {},
): string {
  const title = oneLine(workspaceTitle || agent?.title || 'Paseo 窗口', 120) || 'Paseo 窗口'
  const userMessages = items.filter(item => item.type === 'user_message')
  const assistantMessages = items.filter(item => item.type === 'assistant_message')
  const reasoning = items.filter(item => item.type === 'reasoning').length
  const tools = items.filter(item => item.type === 'tool_call').length
  const metadata = [
    agent ? `Provider / Model：${agent.provider || '未知'} / ${agent.model || '未指定'}` : null,
    agent ? `状态：${statusLabel(agent)}` : null,
    agent ? `工作目录：\`${agent.cwd || '未知'}\`` : null,
    `消息：${userMessages.length} 条提问 · ${assistantMessages.length} 条回复` +
      (reasoning || tools ? ` · ${reasoning} 条思考 · ${tools} 次工具调用` : ''),
  ].filter((line): line is string => Boolean(line))
  const parts = [
    `# ${title}`,
    quote(['[!NOTE]', '', ...metadata].join('\n')),
  ]

  let turn = 0
  let hasVisibleContent = false
  let pendingDetails: PaseoLogItem[] = []
  const flushDetails = () => {
    if (pendingDetails.length && options.includeDetails === true) {
      parts.push(detailsBlock(pendingDetails))
      hasVisibleContent = true
    }
    pendingDetails = []
  }

  for (const item of items) {
    if (item.type === 'user_message') {
      flushDetails()
      turn++
      const text = item.text ?? ''
      const summary = oneLine(text, 48) || '用户消息'
      parts.push(`## ${turn}. ${summary}`)
      parts.push(quote(`[!INFO]\n\n${text || '(空消息)'}`))
      hasVisibleContent = true
      continue
    }
    if (item.type === 'assistant_message') {
      flushDetails()
      if (item.text?.trim()) {
        parts.push(item.text)
        hasVisibleContent = true
      }
      continue
    }
    if (item.type === 'reasoning' || item.type === 'tool_call') pendingDetails.push(item)
  }
  flushDetails()

  if (!hasVisibleContent) {
    parts.push('## 暂无消息', options.emptyMessage ||
      '此窗口还没有可显示的消息。可以稍后刷新，或检查 Paseo 是否正在运行。')
  }
  return `${parts.join('\n\n').trimEnd()}\n`
}

export function paseoLogsToDocument(
  schema: Schema,
  workspaceTitle: string,
  agent: PaseoAgent | null,
  items: readonly PaseoLogItem[],
  options: PaseoDocumentOptions = {},
): PaseoDocument {
  const markdown = paseoLogsToMarkdown(workspaceTitle, agent, items, options)
  const content = assignMissingBlockIds(markdownToDoc(schema, markdown)).toJSON()
  return { markdown, content }
}
