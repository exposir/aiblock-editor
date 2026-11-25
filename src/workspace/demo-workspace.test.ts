import { getSchema } from '@tiptap/core'
import { describe, expect, it } from 'vitest'
import { createEditorExtensions, extractOutline } from '../editor/extensions'
import { createDemoWorkspace, DEMO_HANDBOOK_ID } from './demo-workspace'
import { pageAncestors, pagesByParent } from './page-store'

const schema = getSchema(createEditorExtensions())

describe('示例页面工作区', () => {
  /*
   * Testing strategy
   * @partition hierarchy: 手册根页、两个直属子页、两个独立根页
   * @partition content: 每页正文可被编辑器 schema 解析
   * @partition comments: 手册与清单评论相互独立
   * @partition outline: 中文标题形成目录
   */
  it('hierarchy: 建立五个页面，并只激活手册根页', () => {
    const workspace = createDemoWorkspace(schema)
    const roots = pagesByParent(workspace).get(null)?.map(page => page.title)
    const children = pagesByParent(workspace).get(DEMO_HANDBOOK_ID)?.map(page => page.title)
    expect(workspace.pages).toHaveLength(5)
    expect(workspace.activePageId).toBe(DEMO_HANDBOOK_ID)
    expect(roots).toEqual(['文档协作与发布手册', '架构设计备忘', '全图种与公式复杂示例'])
    expect(children).toEqual(['试点验收清单', '接口与发布规则'])
  })

  it('hierarchy: 接口页的祖先路径反映手册层级', () => {
    const workspace = createDemoWorkspace(schema)
    const release = workspace.pages.find(page => page.title === '接口与发布规则')!
    expect(pageAncestors(workspace, release.id).map(page => page.title)).toEqual(['文档协作与发布手册'])
  })

  it('content: 五页正文都解析为有效的 ProseMirror 文档', () => {
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

  it('content: 图表示例提供十个可导航的图种和三类块级公式', () => {
    const workspace = createDemoWorkspace(schema)
    const page = workspace.pages.find(candidate => candidate.title === '全图种与公式复杂示例')!
    expect(page).toMatchObject({ parentId: null, icon: '📊' })
    const doc = schema.nodeFromJSON(page.content)
    const headings = doc.children.filter(node => node.type.name === 'heading' && node.attrs.level === 2)
    const diagrams = doc.children.filter(node => node.attrs.language === 'mermaid')
    const formulas = doc.children.filter(node => node.attrs.language === 'math')
    expect(headings.map(node => node.textContent)).toEqual([
      '系统架构流程图', '协同与发布时序图', '编辑与回滚状态机', '领域模型类图', '工作区实体关系图',
      '三阶段研发排期', '编辑器架构思维导图', '多分支协作流', '研发耗时占比', '性能指标双系列', '复杂 LaTeX 公式',
    ])
    expect(diagrams.map(node => node.textContent.match(/^(?:flowchart TB|sequenceDiagram|stateDiagram-v2|classDiagram|erDiagram|gantt|mindmap|gitGraph|pie showData|xychart-beta)$/m)?.[0])).toEqual([
      'flowchart TB', 'sequenceDiagram', 'stateDiagram-v2', 'classDiagram', 'erDiagram',
      'gantt', 'mindmap', 'gitGraph', 'pie showData', 'xychart-beta',
    ])
    expect(formulas.map(node => node.textContent.match(/\\begin\{(\w+)\}/)?.[1])).toEqual(['aligned', 'bmatrix', 'cases'])
    const inline: string[] = []
    doc.descendants(node => {
      if (node.type.name === 'inlineMath') inline.push(node.attrs.latex)
    })
    expect(inline).toEqual([String.raw`\sum_{i=1}^{n} w_i = 100\%`, String.raw`O(n \log n)`])
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
