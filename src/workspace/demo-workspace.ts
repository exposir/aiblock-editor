import { DOMParser as ProseMirrorDOMParser } from '@tiptap/pm/model'
import type { Schema } from '@tiptap/pm/model'
import { demoComments, demoDocument, demoTitle } from '../editor/demo-document'
import { markdownToDoc } from '../editor/markdown/markdown-codec'
import { activatePage, addPage, createWorkspace } from './page-store'
import type { WorkspaceState } from './page-store'

const createdAt = Date.UTC(2026, 10, 24)
export const DEMO_HANDBOOK_ID = '430e9296-6acb-4b74-84c3-a4bd05a20701'
const checklistId = '430e9296-6acb-4b74-84c3-a4bd05a20702'
const checklistQuote = '确认两个试点团队都能访问模板库'

const checklist = `
  <h1 data-block-id="pilot-checklist">试点验收清单</h1>
  <p>先在预发走一遍创建、分享与评论流程。试点开放前，把核对结果和未完成项记在这里。</p>
  <aside data-callout data-icon="📌" data-theme="yellow">
    <p><strong>开放条件</strong></p>
    <p>模板创建成功率达到 99%，且只读与可编辑权限均通过抽查。</p>
  </aside>
  <h2 data-block-id="pilot-before">开放前核对</h2>
  <ul data-type="taskList">
    <li data-type="taskItem" data-checked="true"><div><p>在预发创建并复制模板</p></div></li>
    <li data-type="taskItem" data-checked="false"><div>
      <p><span data-comment-id="pilot-access">${checklistQuote}</span></p>
      <ul data-type="taskList">
        <li data-type="taskItem" data-checked="true"><div><p>设计团队核对只读权限</p></div></li>
        <li data-type="taskItem" data-checked="false"><div><p>运营团队核对编辑权限</p></div></li>
      </ul>
    </div></li>
    <li data-type="taskItem" data-checked="false"><div><p>将值班表与反馈入口发给支持团队</p></div></li>
  </ul>
  <h2 data-block-id="pilot-rollback">回滚预案</h2>
  <div data-toggle data-open="false">
    <div data-toggle-summary>展开查看回滚步骤</div>
    <div data-toggle-content>
      <ol><li><p>关闭模板库入口开关，暂停新增试点账号。</p></li><li><p>保留已有模板，记下异常请求并通知值班同事。</p></li></ol>
    </div>
  </div>
  <h2 data-block-id="pilot-after">开放后记录</h2>
  <p>观察 30 分钟的模板创建成功率和权限报错。周五汇总反馈，再决定下一批开放范围。</p>
`

const releaseRules = `# 接口与发布规则

发布服务根据试点报告决定是否扩大开放范围。两阶段共用同一套模板创建与权限校验接口。

## 开放策略

::::columns
:::column{width=50}
### 试点开放

账号白名单按团队维护。异常时先暂停新增账号，保留已创建模板。
:::
:::column{width=50}
### 全面开放

达到验收阈值后逐步放量。变更说明随发布同步，并保留一周回滚窗口。
:::
::::

## 放量判断

~~~typescript
type PilotReport = {
  creationRate: number
  permissionsVerified: boolean
}

export function canExpand(report: PilotReport): boolean {
  return report.creationRate >= 0.99 && report.permissionsVerified
}
~~~

## 接口约定

| 接口 | 校验 | 失败处理 |
| --- | --- | --- |
| POST /templates | 创建权限与模板名称 | 记录请求 ID 并返回错误 |
| GET /templates/:id | 当前账号的访问范围 | 返回查无此模板 |
| GET /release/pilot | 发布人员权限 | 继续保持试点范围 |
`

const architectureNotes = `# 架构设计备忘

## 页面与正文

页面树保存层级与标题。每页各自保存正文和评论，试点材料可以挂在对应的发布手册下面。

## Markdown 上手

- 在空行输入 \`# \` 新建一级标题，输入 \`- [ ] \` 新建待办事项。
- 在空行输入 \`>> \` 新建折叠块，输入 \`[! \` 新建高亮块。
- 复制下方示例并以纯文本粘贴到正文，编辑器会识别标题、待办与链接。

~~~markdown
## 下次设计评审

- [ ] 核对公开页和私有页的访问权限
- [x] 整理 [发布手册](#page=${DEMO_HANDBOOK_ID})
~~~

导入 Markdown 文件会在页面树中新建一页。顶栏可导出当前页，也可复制整页 Markdown。
`

export function createDemoWorkspace(schema: Schema): WorkspaceState {
  const parser = ProseMirrorDOMParser.fromSchema(schema)
  const html = (source: string) => parser.parse(new DOMParser().parseFromString(source, 'text/html').body).toJSON()
  const handbook = createWorkspace({ id: DEMO_HANDBOOK_ID, now: createdAt }, {
    title: demoTitle, icon: '📄', content: html(demoDocument), comments: demoComments,
  })
  const pilot = addPage(handbook, { id: checklistId, now: createdAt }, {
    parentId: DEMO_HANDBOOK_ID, title: '试点验收清单', icon: '🧪', content: html(checklist),
    comments: [{
      id: 'pilot-access', quote: checklistQuote, resolved: false,
      messages: [{ id: 'pilot-access-review', author: '测试同事', text: '设计团队已核对。运营账号补齐编辑权限后，再走一遍分享流程。' }],
    }],
  })
  const release = addPage(pilot, { id: '430e9296-6acb-4b74-84c3-a4bd05a20703', now: createdAt }, {
    parentId: DEMO_HANDBOOK_ID, title: '接口与发布规则', icon: '📐', content: markdownToDoc(schema, releaseRules).toJSON(),
  })
  const notes = addPage(release, { id: '430e9296-6acb-4b74-84c3-a4bd05a20704', now: createdAt }, {
    title: '架构设计备忘', icon: '🗂️', content: markdownToDoc(schema, architectureNotes).toJSON(),
  })
  return activatePage(notes, DEMO_HANDBOOK_ID)
}
