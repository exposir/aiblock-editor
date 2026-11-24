import type { Editor } from '@tiptap/core'
import { docToMarkdown } from './markdown-codec'

export function markdownFile(doc: Editor['state']['doc']): Blob {
  return new Blob([docToMarkdown(doc)], { type: 'text/markdown;charset=utf-8' })
}

export function downloadMarkdown(doc: Editor['state']['doc'], title: string) {
  const name = title.trim() || '未命名文档'
  const url = URL.createObjectURL(markdownFile(doc))
  const link = document.createElement('a')
  link.href = url
  link.download = `${name.replace(/[\\/:*?"<>|]/g, '_')}.md`
  document.body.append(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

export function isMarkdownFile(file: File): boolean {
  return /\.(?:md|markdown)$/i.test(file.name)
}

export function importedTitle(fileName: string, markdown: string): string {
  const firstHeading = markdown.match(/^#\s+(.+)$/m)?.[1]?.trim()
  if (firstHeading) return firstHeading
  return fileName.replace(/\.(?:md|markdown)$/i, '').trim() || '未命名文档'
}
