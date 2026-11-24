import { getSchema } from '@tiptap/core'
import { describe, expect, it } from 'vitest'
import { createEditorExtensions, extractOutline } from '../editor/extensions'
import { createDemoWorkspace, DEMO_HANDBOOK_ID } from './demo-workspace'
import { pageAncestors, pagesByParent } from './page-store'

const schema = getSchema(createEditorExtensions())

describe('示例页面工作区', () => {
  /*
   * Testing strategy
   * @partition hierarchy: 一个根页、两个直属子页、一个独立根页
   * @partition content: 每页正文可被编辑器 schema 解析
   * @partition comments: 手册与清单评论相互独立
   * @partition outline: 中文标题形成目录
   */
  it('hierarchy: 建立四个页面，并只激活手册根页', () => {
    const workspace = createDemoWorkspace(schema)
    const roots = pagesByParent(workspace).get(null)?.map(page => page.title)
    const children = pagesByParent(workspace).get(DEMO_HANDBOOK_ID)?.map(page => page.title)
    expect(workspace.pages).toHaveLength(4)
    expect(workspace.activePageId).toBe(DEMO_HANDBOOK_ID)
    expect(roots).toEqual(['文档协作与发布手册', '架构设计备忘'])
    expect(children).toEqual(['试点验收清单', '接口与发布规则'])
  })

  it('hierarchy: 接口页的祖先路径反映手册层级', () => {
    const workspace = createDemoWorkspace(schema)
    const release = workspace.pages.find(page => page.title === '接口与发布规则')!
    expect(pageAncestors(workspace, release.id).map(page => page.title)).toEqual(['文档协作与发布手册'])
  })

  it('content: 四页正文都解析为有效的 ProseMirror 文档', () => {
    const workspace = createDemoWorkspace(schema)
    for (const page of workspace.pages) {
      expect(schema.nodeFromJSON(page.content).check()).toBeUndefined()
    }
  })

  it('content: 每一项都包含高级块和 Markdown 示例所需的节点类型', () => {
    const workspace = createDemoWorkspace(schema)
    const types = (title: string, names: Set<string>) => {
      const page = workspace.pages.find(candidate => candidate.title === title)!
      schema.nodeFromJSON(page.content).descendants(node => {
        names.add(node.type.name)
      })
    }
    const handbook = new Set<string>()
    types('文档协作与发布手册', handbook)
    expect([...handbook]).toEqual(expect.arrayContaining(['callout', 'taskList', 'toggle', 'columnList', 'table', 'codeBlock']))
    const checklist = new Set<string>()
    types('试点验收清单', checklist)
    expect([...checklist]).toEqual(expect.arrayContaining(['taskList', 'toggle', 'callout']))
    const release = new Set<string>()
    types('接口与发布规则', release)
    expect([...release]).toEqual(expect.arrayContaining(['columnList', 'codeBlock', 'table']))
    const notes = new Set<string>()
    types('架构设计备忘', notes)
    expect([...notes]).toEqual(expect.arrayContaining(['bulletList', 'codeBlock']))
  })

  it('comments: 每条评论只出现在所属页面，引用文本与正文标记一致', () => {
    const workspace = createDemoWorkspace(schema)
    const handbook = workspace.pages.find(page => page.id === DEMO_HANDBOOK_ID)!
    const checklist = workspace.pages.find(page => page.title === '试点验收清单')!
    expect(handbook.comments).toHaveLength(1)
    expect(checklist.comments).toHaveLength(1)
    for (const page of workspace.pages.filter(candidate => ![handbook.id, checklist.id].includes(candidate.id))) {
      expect(page.comments).toEqual([])
    }
    for (const page of [handbook, checklist]) {
      const doc = schema.nodeFromJSON(page.content)
      let markId: string | null = null
      doc.descendants(node => {
        const mark = node.marks.find(candidate => candidate.type.name === 'comment')
        if (mark) markId = mark.attrs.commentId
      })
      expect(markId).toBe(page.comments[0]?.id)
    }
  })

  it('outline: 中文标题形成有层级的目录条目', () => {
    const workspace = createDemoWorkspace(schema)
    const checklist = schema.nodeFromJSON(workspace.pages.find(page => page.title === '试点验收清单')!.content)
    expect(extractOutline(checklist).map(entry => [entry.level, entry.text])).toEqual([
      [1, '试点验收清单'],
      [2, '开放前核对'],
      [2, '回滚预案'],
      [2, '开放后记录'],
    ])
  })
})
