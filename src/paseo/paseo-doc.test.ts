// @vitest-environment node
import { getSchema } from '@tiptap/core'
import type { JSONContent } from '@tiptap/core'
import { describe, expect, it } from 'vitest'
import { createEditorExtensions } from '../editor/extensions'
import { extractPreviewOutline } from '../editor/preview/DocumentPreview'
import { paseoLogsToDocument, paseoLogsToMarkdown } from './paseo-doc'
import type { PaseoAgent, PaseoLogItem } from './paseo-types'

const schema = getSchema(createEditorExtensions())
const agent: PaseoAgent = {
  id: 'agent-1',
  title: 'Paseo 会话',
  workspaceId: 'workspace-1',
  cwd: '/tmp/project',
  provider: 'codex',
  model: 'gpt-5',
  lastStatus: 'running',
  requiresAttention: false,
  updatedAt: '2026-11-26T10:00:00.000Z',
}

function nodeTypes(content: JSONContent): string[] {
  return [content.type ?? '', ...(content.content ?? []).flatMap(nodeTypes)]
}

describe('Paseo Markdown conversion', () => {
  it('renders clean conversation turns and omits reasoning/tool details by default', () => {
    const items: PaseoLogItem[] = [
      { type: 'user_message', text: '第一行问题\n\n第二段补充' },
      {
        type: 'reasoning',
        text: '这段思考默认不展示。',
      },
      {
        type: 'tool_call',
        name: 'shell',
        status: 'completed',
        detail: { type: 'shell', command: 'pnpm test', output: 'ok' },
      },
      {
        type: 'assistant_message',
        text: '这是回答。\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n```mermaid\ngraph TD\nA-->B\n```',
      },
    ]
    const markdown = paseoLogsToMarkdown('发布窗口', agent, items, { includeDetails: false })
    expect(markdown).toContain('# 发布窗口')
    expect(markdown).toContain('> [!NOTE]')
    expect(markdown).toContain('Provider / Model：codex / gpt-5')
    expect(markdown).toContain('工作目录：`/tmp/project`')
    expect(markdown).toContain('## 1. 第一行问题')
    expect(markdown).toContain('> [!INFO]')
    expect(markdown).toContain('> 第一行问题\n>\n> 第二段补充')
    expect(markdown).toContain('这是回答。')
    expect(markdown).toContain('| A | B |')
    expect(markdown).toContain('```mermaid')
    expect(markdown).not.toContain('这段思考默认不展示')
    expect(markdown).not.toContain('pnpm test')
  })

  it('groups consecutive reasoning and tool calls into one closed details block', () => {
    const items: PaseoLogItem[] = [
      { type: 'user_message', text: '检查项目' },
      { type: 'reasoning', text: '先检查文件。' },
      {
        type: 'tool_call',
        name: 'read_file',
        detail: { type: 'read', filePath: '/tmp/project/README.md' },
      },
      { type: 'assistant_message', text: '检查完成。' },
      { type: 'reasoning', text: '最后复核。' },
    ]
    const markdown = paseoLogsToMarkdown('检查窗口', agent, items, { includeDetails: true })
    expect(markdown).toContain('<details>')
    expect(markdown).toContain('思考与工具调用（2 项）')
    expect(markdown).toContain('先检查文件。')
    expect(markdown).toContain('/tmp/project/README.md')
    expect(markdown).toContain('思考与工具调用（1 项）')
    expect(markdown).toContain('最后复核。')
    expect(markdown).toContain('</details>')
  })

  it('preserves assistant Markdown as schema nodes and assigns outline anchors', () => {
    const items: PaseoLogItem[] = [
      { type: 'user_message', text: '给我一个包含表格、代码和图表的方案' },
      {
        type: 'assistant_message',
        text: '## 实施细节\n\n| 名称 | 状态 |\n| --- | --- |\n| API | 完成 |\n\n```typescript\nconst ok = true\n```\n\n```mermaid\nflowchart LR\nA-->B\n```',
      },
    ]
    const document = paseoLogsToDocument(schema, '复杂回答', agent, items)
    const types = nodeTypes(document.content)
    expect(types).toContain('table')
    expect(types).toContain('codeBlock')
    expect(document.content).toMatchObject({
      type: 'doc',
      content: expect.arrayContaining([
        expect.objectContaining({ type: 'heading', attrs: expect.objectContaining({ blockId: expect.any(String) }) }),
      ]),
    })
    const outline = extractPreviewOutline(document.content)
    expect(outline.map(entry => entry.text)).toEqual(['复杂回答', '1. 给我一个包含表格、代码和图表的方案', '实施细节'])
    expect(outline.every(entry => Boolean(entry.blockId))).toBe(true)
    expect(document.markdown).toContain('```typescript')
    expect(document.markdown).toContain('```mermaid')
  })

  it('limits turn summaries and returns a clear placeholder for empty or failed reads', () => {
    const long = '这是一个超过四十八个字符的提问标题，需要在目录中保持简洁并避免撑破侧栏布局，同时保留可辨识的语义。'
    const markdown = paseoLogsToMarkdown('长问题', agent, [{ type: 'user_message', text: long }])
    const heading = markdown.split('\n').find(line => line.startsWith('## 1. '))!
    expect(Array.from(heading.slice('## 1. '.length))).toHaveLength(48)

    const empty = paseoLogsToMarkdown('空窗口', agent, [], { emptyMessage: '日志读取失败，请刷新。' })
    expect(empty).toContain('## 暂无消息')
    expect(empty).toContain('日志读取失败，请刷新。')
  })

  it('upgrades code fences when tool output contains backtick runs', () => {
    const triple = '`'.repeat(3)
    const items: PaseoLogItem[] = [
      { type: 'user_message', text: '检查脚本' },
      {
        type: 'tool_call',
        name: 'shell',
        detail: {
          type: 'shell',
          command: `printf '${triple}'`,
          output: `before\n${triple}\ninside\n${triple}\nafter`,
        },
      },
    ]
    const markdown = paseoLogsToMarkdown('围栏窗口', agent, items, { includeDetails: true })
    expect(markdown).toContain('````shell')
    expect(markdown).toContain('````text')
    expect(markdown).toContain(`printf '\`\`\``)
    const document = paseoLogsToDocument(schema, '围栏窗口', agent, items, { includeDetails: true })
    expect(nodeTypes(document.content)).toContain('codeBlock')
    expect(nodeTypes(document.content)).toContain('toggle')
    expect(document.content.content).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'toggle' }),
    ]))
  })

  it('keeps detail-only sessions empty by default and visible when details are enabled', () => {
    const items: PaseoLogItem[] = [
      { type: 'reasoning', text: '只包含内部推理。' },
      {
        type: 'tool_call',
        name: 'read',
        detail: { type: 'read', filePath: '/tmp/project/file.ts' },
      },
    ]
    const compact = paseoLogsToMarkdown('详情窗口', agent, items, { includeDetails: false })
    expect(compact).toContain('## 暂无消息')
    expect(compact).not.toContain('<details>')

    const detailed = paseoLogsToMarkdown('详情窗口', agent, items, { includeDetails: true })
    expect(detailed).toContain('<details>')
    expect(detailed).toContain('思考与工具调用（2 项）')
    expect(detailed).not.toContain('## 暂无消息')
  })

  it('renders tool variants, errors and empty reasoning without losing content', () => {
    const items: PaseoLogItem[] = [
      { type: 'reasoning', text: '' },
      {
        type: 'tool_call',
        name: 'arbitrary',
        error: '工具执行失败',
        detail: { alpha: 1, nested: { beta: true } },
      },
      {
        type: 'tool_call',
        name: 'scalar',
        detail: 'plain detail',
      },
    ]
    const markdown = paseoLogsToMarkdown('工具窗口', agent, items, { includeDetails: true })
    expect(markdown).toContain('(无思考内容)')
    expect(markdown).toContain('工具执行失败')
    expect(markdown).toContain('"alpha": 1')
    expect(markdown).toContain('"nested": {')
    expect(markdown).toContain('"plain detail"')
    expect(() => paseoLogsToDocument(schema, '工具窗口', agent, items, { includeDetails: true })).not.toThrow()
  })

  it('uses attention and closed status labels and falls back through title choices', () => {
    const attention = paseoLogsToMarkdown('', {
      ...agent,
      lastStatus: 'running',
      requiresAttention: true,
    }, [], {})
    expect(attention).toContain('# Paseo 会话')
    expect(attention).toContain('状态：等待处理')
    expect(attention).not.toContain('状态：运行中')

    const closed = paseoLogsToMarkdown('', {
      ...agent,
      lastStatus: 'closed',
      requiresAttention: false,
    }, [], {})
    expect(closed).toContain('状态：已关闭')

    const anonymous = paseoLogsToMarkdown('', null, [], {})
    expect(anonymous).toContain('# Paseo 窗口')
  })

  it('preserves KaTeX, Callout and Toggle blocks with top-level anchors', () => {
    const items: PaseoLogItem[] = [
      { type: 'user_message', text: '请检查富文本' },
      {
        type: 'assistant_message',
        text: [
          '> [!TIP]',
          '> Callout 内容',
          '',
          '<details open>',
          '<summary>折叠内容</summary>',
          '',
          'Toggle 正文',
          '',
          '</details>',
          '',
          '```math',
          'E = mc^2',
          '```',
        ].join('\n'),
      },
    ]
    const document = paseoLogsToDocument(schema, '富文本窗口', agent, items)
    const types = nodeTypes(document.content)
    expect(types).toContain('callout')
    expect(types).toContain('toggle')
    expect(types).toContain('codeBlock')
    expect(document.content.content?.every(node => typeof node.attrs?.blockId === 'string' && node.attrs.blockId.length > 0))
      .toBe(true)
    const math = document.content.content?.find(node => node.type === 'codeBlock' && node.attrs?.language === 'math')
    expect(math?.content?.[0]?.text).toContain('E = mc^2')
  })
})
