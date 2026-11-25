import { describe, expect, it } from 'vitest'
import { searchSlashItems } from './slash-search'

describe('slash search', () => {
  // @partition latin: English names, pinyin and abbreviations
  // @partition chinese: labels and synonyms
  // @partition boundary: complete catalogue and unmatched text
  it.each([
    ['gl', ['高亮块']], ['fl', ['双栏', '三栏']], ['zd', ['折叠块']],
    ['bg', ['表格']], ['dm', ['代码块']], ['db', ['待办列表']],
    ['gao liang', ['高亮块']], ['gāoliàng', ['高亮块']], ['fenlan', ['双栏', '三栏']],
    ['TABLE', ['表格']], ['Code block', ['代码块']], ['numbered', ['有序列表']],
  ])('latin: matches %s', (query, labels) => {
    expect(searchSlashItems(query).map(item => item.label)).toEqual(labels)
  })

  it.each([
    ['lct', 'mermaid'], ['mermaid', 'mermaid'], ['liuchengtu', 'mermaid'], ['tb', 'mermaid'],
    ['gs', 'math'], ['math', 'math'], ['gongshi', 'math'], ['latex', 'math'],
  ])('finds the native Markdown block for %s', (query, id) => {
    expect(searchSlashItems(query).map(item => item.id)).toEqual([id])
  })

  it('chinese: finds exact labels and the layout synonym', () => {
    expect(searchSlashItems('待办').map(item => item.id)).toEqual(['taskList'])
    expect(searchSlashItems('分栏').map(item => item.id)).toEqual(['columns2', 'columns3'])
  })

  it('boundary: lists all groups for an empty query and no items for a miss', () => {
    expect(new Set(searchSlashItems('').map(item => item.group))).toEqual(new Set(['基础块', '容器与布局', '高级块']))
    expect(searchSlashItems('无匹配的天体')).toEqual([])
    expect(searchSlashItems('???')).toEqual([])
  })
})
