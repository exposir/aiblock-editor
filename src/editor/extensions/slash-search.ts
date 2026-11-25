import { pinyin } from 'pinyin-pro'

export interface SlashItem {
  readonly id: string
  readonly label: string
  readonly group: '基础块' | '容器与布局' | '高级块'
  readonly english: string
  readonly keywords?: readonly string[]
}

export const SLASH_ITEMS = [
  { id: 'paragraph', label: '正文', group: '基础块', english: 'Paragraph', keywords: ['文本', 'text'] },
  { id: 'h1', label: '一级标题', group: '基础块', english: 'Heading 1', keywords: ['H1', '标题'] },
  { id: 'h2', label: '二级标题', group: '基础块', english: 'Heading 2', keywords: ['H2', '标题'] },
  { id: 'h3', label: '三级标题', group: '基础块', english: 'Heading 3', keywords: ['H3', '标题'] },
  { id: 'bulletList', label: '无序列表', group: '基础块', english: 'Bulleted list', keywords: ['bullet', 'unordered'] },
  { id: 'orderedList', label: '有序列表', group: '基础块', english: 'Numbered list', keywords: ['ordered'] },
  { id: 'taskList', label: '待办列表', group: '基础块', english: 'To-do list', keywords: ['待办', 'task', 'todo'] },
  { id: 'blockquote', label: '引用', group: '基础块', english: 'Quote', keywords: ['blockquote'] },
  { id: 'horizontalRule', label: '分割线', group: '基础块', english: 'Divider', keywords: ['horizontal rule', 'separator'] },
  { id: 'callout', label: '高亮块', group: '容器与布局', english: 'Callout', keywords: ['高亮', 'highlight'] },
  { id: 'toggle', label: '折叠块', group: '容器与布局', english: 'Toggle', keywords: ['折叠', 'collapse'] },
  { id: 'columns2', label: '双栏', group: '容器与布局', english: 'Two columns', keywords: ['分栏', '两栏', 'column', '2 columns'] },
  { id: 'columns3', label: '三栏', group: '容器与布局', english: 'Three columns', keywords: ['分栏', 'column', '3 columns'] },
  { id: 'table', label: '表格', group: '高级块', english: 'Table', keywords: ['grid'] },
  { id: 'mermaid', label: '流程图 / 图表', group: '高级块', english: 'Mermaid', keywords: ['流程图', '图表', 'lct', 'tb', 'liuchengtu', 'diagram', 'flowchart'] },
  { id: 'math', label: '数学公式', group: '高级块', english: 'LaTeX', keywords: ['math', 'latex', '公式', 'gs', 'gongshi'] },
  { id: 'imageBlock', label: '图片', group: '高级块', english: 'Image', keywords: ['图片', 'tupian', '照片', 'photo'] },
  { id: 'codeBlock', label: '代码块', group: '高级块', english: 'Code block', keywords: ['代码', 'code'] },
] as const satisfies readonly SlashItem[]

export type SlashCommandId = (typeof SLASH_ITEMS)[number]['id']

function normalize(text: string) {
  return text.normalize('NFKD').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')
}

const index = SLASH_ITEMS.map((item: SlashItem) => ({
  item,
  terms: [item.label, item.english, ...(item.keywords ?? [])].flatMap(term => {
    if (!/\p{Script=Han}/u.test(term)) return [normalize(term)]
    return [
      normalize(term),
      normalize(pinyin(term, { toneType: 'none' })),
      normalize(pinyin(term, { toneType: 'none', pattern: 'first', type: 'array' }).join('')),
    ]
  }),
}))

export function searchSlashItems(query: string): SlashItem[] {
  const key = normalize(query)
  if (!query.trim()) return index.map(entry => entry.item)
  if (!key) return []
  const exact = index.filter(({ terms }) => terms.includes(key))
  if (exact.length) return exact.map(({ item }) => item)
  const prefixes = index.filter(({ terms }) => terms.some(term => term.startsWith(key)))
  const matches = prefixes.length ? prefixes : index.filter(({ terms }) => terms.some(term => term.includes(key)))
  return matches.map(({ item }) => item)
}
