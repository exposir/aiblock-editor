import { Editor } from '@tiptap/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createEditorExtensions } from '../extensions'
import { downloadMarkdown, importedTitle, isMarkdownFile, markdownFile } from './markdown-files'

const editors: Editor[] = []
function editor(content = '<p>正文</p>') {
  const instance = new Editor({ extensions: createEditorExtensions(), content })
  editors.push(instance)
  return instance
}

afterEach(() => {
  for (const instance of editors.splice(0)) instance.destroy()
  vi.restoreAllMocks()
})

describe('Markdown 文件工具', () => {
  /*
   * Testing strategy
   * @partition extension: .md、.markdown、大小写、其他后缀
   * @partition title: 一级标题、文件名回退、空值
   * @partition blob: MIME 与正文
   * @partition download: 文件名清洗、点击、URL 回收
   */
  it('extension: 只接受 md/markdown 后缀且忽略大小写', () => {
    expect(isMarkdownFile(new File([''], 'note.md'))).toBe(true)
    expect(isMarkdownFile(new File([''], 'NOTE.MD'))).toBe(true)
    expect(isMarkdownFile(new File([''], 'long.markdown'))).toBe(true)
    expect(isMarkdownFile(new File([''], 'fake.md.txt'))).toBe(false)
    expect(isMarkdownFile(new File([''], 'note.txt'))).toBe(false)
  })

  it('title: 优先使用首个一级标题并去除两端空白', () => {
    expect(importedTitle('fallback.md', '#  发布记录  \n\n正文')).toBe('发布记录')
    expect(importedTitle('fallback.markdown', '## 二级标题')).toBe('fallback')
  })

  it('title: 无一级标题时去掉 md 后缀，空文件名使用默认标题', () => {
    expect(importedTitle('team-notes.MD', '普通正文')).toBe('team-notes')
    expect(importedTitle('.markdown', '普通正文')).toBe('未命名文档')
  })

  it('blob: 将当前文档序列化为 UTF-8 Markdown Blob', async () => {
    const blob = markdownFile(editor('<h1>标题</h1><p><strong>粗体</strong>正文</p>').state.doc)
    expect(blob.type).toBe('text/markdown;charset=utf-8')
    expect(blob.type).toBe('text/markdown;charset=utf-8')
    const text = await new Promise<string>(resolve => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result))
      reader.readAsText(blob)
    })
    expect(text).toBe('# 标题\n\n**粗体**正文\n')
  })

  it('download: 清理非法文件名并触发下载后回收 URL', () => {
    vi.useFakeTimers()
    const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:download')
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    try {
      downloadMarkdown(editor().state.doc, '发布/记录: v1')
      expect(create).toHaveBeenCalledOnce()
      expect(click).toHaveBeenCalledOnce()
      const anchor = document.querySelector('a')
      expect(anchor).not.toBeInTheDocument()
      vi.runAllTimers()
      expect(revoke).toHaveBeenCalledWith('blob:download')
    } finally {
      vi.useRealTimers()
    }
  })

  it('download: 空标题回退到未命名文档', () => {
    vi.useFakeTimers()
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      expect(this.download).toBe('未命名文档.md')
    })
    try {
      downloadMarkdown(editor().state.doc, '   ')
      expect(click).toHaveBeenCalledOnce()
    } finally {
      vi.useRealTimers()
    }
  })
})
