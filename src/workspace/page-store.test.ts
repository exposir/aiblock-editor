import { getSchema } from '@tiptap/core'
import fc from 'fast-check'
import { beforeEach, describe, expect, it } from 'vitest'
import { createEditorExtensions } from '../editor/extensions'
import { createDemoWorkspace } from './demo-workspace'
import {
  DEFAULT_PAGE_TITLE, WORKSPACE_STORAGE_KEY, activatePage, addPage, clearWorkspace, copyPage,
  createWorkspace, formatPageHash, hasPageContent, importMarkdownPage, loadWorkspace, movePage, pageAncestors,
  parseLegacyBlockHash, parsePageHash, removePage, saveWorkspace, updatePage,
} from './page-store'

const schema = getSchema(createEditorExtensions())
const identity = (index: number) => ({ id: `3a32ec65-f076-4830-8110-${String(index).padStart(12, '0')}`, now: index })
const root = identity(1).id
const child = identity(2).id
const note = {
  id: 'review', quote: '正文', resolved: false,
  messages: [{ id: 'message', author: '我', text: '请核对' }],
}
const content = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '正文' }] }] }

function twoPages() {
  return addPage(createWorkspace(identity(1)), identity(2), { parentId: root, title: '验收清单' })
}

describe('页面操作', () => {
  /*
   * @partition create: 根页、子页及无效父级
   * @partition edit: 元数据、正文、评论和当前页的隔离
   * @partition copy: 单页副本和源数据独立
   * @partition move: 合法移动与自环、后代、无效父级
   * @partition delete: 激活页保留、选择兄弟或父页、末页保底
   * @partition import: 建立独立 Markdown 页面
   */
  it('create: 创建有序根页和子页，新建页立即激活', () => {
    const top = identity(3).id
    const workspace = addPage(twoPages(), identity(3), { title: '设计笔记' })
    expect(workspace.activePageId).toBe(top)
    expect(workspace.pages).toMatchObject([
      { id: root, parentId: null, order: 0, title: DEFAULT_PAGE_TITLE, icon: '📄', createdAt: 1, updatedAt: 1 },
      { id: child, parentId: root, order: 0, title: '验收清单', createdAt: 2 },
      { id: top, parentId: null, order: 1, title: '设计笔记', createdAt: 3 },
    ])
    expect(addPage(workspace, identity(4), { parentId: 'missing' })).toBe(workspace)
    expect(addPage(workspace, identity(3))).toBe(workspace)
  })

  it('edit: 更新指定页面，保留其他页面和激活状态', () => {
    const workspace = twoPages()
    const edited = updatePage(workspace, root, { title: '发布手册', icon: '🗂️', content, comments: [note] }, 6)
    expect(edited.pages[0]).toMatchObject({ title: '发布手册', icon: '🗂️', content, comments: [note], createdAt: 1, updatedAt: 6 })
    expect(edited.pages[1]).toBe(workspace.pages[1])
    expect(edited.activePageId).toBe(child)
    expect(activatePage(edited, 'missing')).toBe(edited)
  })

  it('edit: 空白文档可直接删除，有评论或样式的文档需要保护', () => {
    const workspace = twoPages()
    expect(hasPageContent(workspace.pages[0]!)).toBe(false)
    const commented = updatePage(workspace, root, { comments: [note] }, 4)
    expect(hasPageContent(commented.pages[0]!)).toBe(true)
    const colored = updatePage(workspace, root, { content: { type: 'doc', content: [
      { type: 'paragraph', attrs: { blockBg: 'yellow' } },
    ] } }, 4)
    expect(hasPageContent(colored.pages[0]!)).toBe(true)
  })

  it('copy: 复制正文与评论到独立同级页面，子页仍归原页', () => {
    const original = updatePage(twoPages(), root, { title: '发布手册', icon: '🗂️', content, comments: [note] }, 5)
    const duplicate = copyPage(original, root, identity(9))
    expect(duplicate.activePageId).toBe(identity(9).id)
    expect(duplicate.pages[2]).toMatchObject({ parentId: null, title: '发布手册（副本）', icon: '🗂️', content, comments: [note], order: 1 })
    expect(duplicate.pages[2]?.content).not.toBe(original.pages[0]?.content)
    expect(duplicate.pages[2]?.comments[0]?.messages).not.toBe(original.pages[0]?.comments[0]?.messages)
    expect(duplicate.pages[1]?.parentId).toBe(root)
  })

  it('move: 禁止挂到自身、后代或无效父级，允许移动整支树', () => {
    const grandchild = identity(3).id
    const top = identity(4).id
    const nested = addPage(twoPages(), identity(3), { parentId: child })
    const workspace = addPage(nested, identity(4))
    expect(movePage(workspace, root, root, 5)).toBe(workspace)
    expect(movePage(workspace, root, grandchild, 5)).toBe(workspace)
    expect(movePage(workspace, root, 'missing', 5)).toBe(workspace)
    const moved = movePage(workspace, child, top, 5)
    expect(moved.pages[1]).toMatchObject({ parentId: top, order: 0, updatedAt: 5 })
    expect(pageAncestors(moved, grandchild).map(page => page.id)).toEqual([top, child])
  })

  it('delete: 级联删除整支树，优先切到右侧兄弟，其次左侧兄弟', () => {
    const right = identity(3).id
    const workspace = addPage(twoPages(), identity(3))
    const removed = removePage(activatePage(workspace, child), root, identity(4))
    expect(removed.pages.map(page => page.id)).toEqual([right])
    expect(removed.activePageId).toBe(right)
    expect(removePage(workspace, right, identity(4)).activePageId).toBe(root)
  })

  it('delete: 无兄弟时回到父页，删除非激活页面时保留当前页', () => {
    const workspace = twoPages()
    const active = removePage(workspace, child, identity(3))
    expect(active.activePageId).toBe(root)
    const other = addPage(workspace, identity(4))
    const removed = removePage(other, child, identity(3))
    expect(removed.activePageId).toBe(identity(4).id)
  })

  it('delete: 删除最后一棵树后激活新建的空文档', () => {
    const empty = removePage(twoPages(), root, identity(3))
    expect(empty.activePageId).toBe(identity(3).id)
    expect(empty.pages).toMatchObject([{
      id: identity(3).id, parentId: null, title: DEFAULT_PAGE_TITLE,
      content: { type: 'doc', content: [{ type: 'paragraph' }] }, comments: [],
    }])
  })

  it('import: Markdown 建立独立根页并保留已编辑的旧页', () => {
    const previous = updatePage(twoPages(), child, { content, comments: [note] }, 3)
    const imported = importMarkdownPage(previous, schema, identity(4), '归档.md', '# 发布记录\n\n- [x] 完成预发')
    expect(imported.pages[1]).toBe(previous.pages[1])
    expect(imported.activePageId).toBe(identity(4).id)
    expect(imported.pages[2]).toMatchObject({ parentId: null, title: '发布记录', comments: [] })
    const doc = schema.nodeFromJSON(imported.pages[2]!.content)
    expect(doc.child(1).type.name).toBe('taskList')
    expect(doc.child(1).child(0).attrs.checked).toBe(true)
  })
})

function invalidWorkspacePayloads() {
  const workspace = twoPages()
  const [parent, leaf] = workspace.pages
  return [
    '{invalid',
    JSON.stringify({ ...workspace, pages: [] }),
    JSON.stringify({ ...workspace, pages: [leaf] }),
    JSON.stringify({ ...workspace, pages: [{ ...parent, parentId: child }, leaf] }),
    JSON.stringify({ ...workspace, pages: [parent, { ...leaf, content: { type: 'doc' } }] }),
    JSON.stringify({ ...workspace, pages: [parent, { ...leaf, comments: [{ quote: '损坏' }] }] }),
    JSON.stringify({ ...workspace, activePageId: 'unknown' }),
  ]
}

describe('浏览器存储与页面地址', () => {
  /*
   * @partition storage: 有效往返、包含高级块与评论
   * @partition invalid: 缺失、损坏、违背树或文档结构
   * @partition clear: 重置只清除工作区
   * @partition hash: 激活页与可选块锚点
   * @partition invariant: 操作序列保持非空、可达、无环
   */
  beforeEach(() => clearWorkspace(localStorage))

  it('storage: 恢复最后激活页、正文属性和全部评论', () => {
    const demo = createDemoWorkspace(schema)
    expect(demo.pages.map(page => page.title)).toEqual([
      '文档协作与发布手册', '试点验收清单', '接口与发布规则', '架构设计备忘', '全图种与公式复杂示例',
    ])
    const workspace = activatePage(demo, demo.pages[1]!.id)
    expect(saveWorkspace(localStorage, workspace)).toBe(true)
    expect(loadWorkspace(localStorage, schema, () => createWorkspace(identity(1)))).toEqual(workspace)
  })

  it('invalid: 缺失、畸形 JSON、空树、孤儿、环、无效正文回退示例', () => {
    const fallback = createDemoWorkspace(schema)
    expect(loadWorkspace(localStorage, schema, () => fallback)).toBe(fallback)
    for (const value of invalidWorkspacePayloads()) {
      localStorage.setItem(WORKSPACE_STORAGE_KEY, value)
      expect(loadWorkspace(localStorage, schema, () => fallback)).toBe(fallback)
    }
  })

  it('clear: 重置清除工作区数据并保留同源其他数据', () => {
    saveWorkspace(localStorage, twoPages())
    localStorage.setItem('other-setting', 'keep')
    try {
      clearWorkspace(localStorage)
      expect(localStorage.getItem(WORKSPACE_STORAGE_KEY)).toBeNull()
      expect(localStorage.getItem('other-setting')).toBe('keep')
    } finally {
      localStorage.removeItem('other-setting')
    }
  })

  it('hash: 编解码页地址及含特殊字符的块锚点', () => {
    expect(formatPageHash(root)).toBe(`#page=${root}`)
    expect(parsePageHash(`#page=${root}&block=section%2B%E9%AA%8C%E6%94%B6`)).toEqual({ pageId: root, blockId: 'section+验收' })
    expect(parsePageHash(formatPageHash(child, '块 & 2'))).toEqual({ pageId: child, blockId: '块 & 2' })
    expect(parsePageHash('#block=orphan')).toEqual({ pageId: null, blockId: null })
  })

  it('hash: 保留单页版块锚点，忽略损坏的编码', () => {
    expect(parseLegacyBlockHash('#block-%E9%AA%8C%E6%94%B6')).toBe('验收')
    expect(parseLegacyBlockHash('#block-%ZZ')).toBeNull()
    expect(parseLegacyBlockHash(formatPageHash(root, 'section'))).toBeNull()
  })

  it('invariant: 任意增删挂接后，激活页存在且所有页面能沿父链到根', () => {
    fc.assert(fc.property(fc.array(fc.tuple(fc.constantFrom('add', 'move', 'delete'), fc.nat(), fc.nat()), { maxLength: 30 }), steps => {
      let workspace = createWorkspace(identity(1))
      for (const [index, [action, a, b]] of steps.entries()) {
        const target = workspace.pages[a % workspace.pages.length]!
        const parentId = workspace.pages[b % (workspace.pages.length + 1)]?.id ?? null
        const next = identity(index + 2)
        if (action === 'add') workspace = addPage(workspace, next, { parentId })
        else if (action === 'move') workspace = movePage(workspace, target.id, parentId, next.now)
        else workspace = removePage(workspace, target.id, next)
        const byId = new Map(workspace.pages.map(page => [page.id, page]))
        expect(byId.has(workspace.activePageId)).toBe(true)
        for (const page of workspace.pages) {
          const visited = new Set([page.id])
          let parent = page.parentId
          while (parent !== null) {
            expect(visited.has(parent)).toBe(false)
            expect(byId.has(parent)).toBe(true)
            visited.add(parent)
            parent = byId.get(parent)!.parentId
          }
        }
      }
    }), { seed: 19 })
  })
})
