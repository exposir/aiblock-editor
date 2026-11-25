import { DOMParser as ProseMirrorDOMParser } from '@tiptap/pm/model'
import type { Schema } from '@tiptap/pm/model'
import { demoComments, demoDocument, demoTitle } from '../editor/demo-document'
import { markdownToDoc } from '../editor/markdown/markdown-codec'
import { activatePage, addPage, createWorkspace, findPage } from './page-store'
import type { WorkspaceState } from './page-store'

const createdAt = Date.UTC(2026, 10, 24)
export const DEMO_HANDBOOK_ID = '430e9296-6acb-4b74-84c3-a4bd05a20701'
const checklistId = '430e9296-6acb-4b74-84c3-a4bd05a20702'
const releaseId = '430e9296-6acb-4b74-84c3-a4bd05a20703'
const notesId = '430e9296-6acb-4b74-84c3-a4bd05a20704'
const galleryId = '430e9296-6acb-4b74-84c3-a4bd05a20705'
const galleryTitle = '全图种与公式复杂示例'
const demoVersion = 1
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

## 发布流程

~~~mermaid
flowchart LR
  A[提交试点报告] --> B{通过验收?}
  B -->|通过| C[逐步放量]
  B -->|待确认| D[补齐校验并复核]
  D --> A
~~~

## 验收指标

以模板创建成功率 $p$ 为放量指标，要求 $p \\ge 0.99$。

$$
p = \\frac{N_{\\mathrm{success}}}{N_{\\mathrm{total}}}
$$

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

const diagramGallery = String.raw`# ${galleryTitle}

以块级编辑器的协同发布为例。可从目录直达每张图，在图表工具条切换为源码查看 Mermaid 或 LaTeX。

## 系统架构流程图

~~~mermaid
---
config:
  flowchart:
    nodeSpacing: 22
    rankSpacing: 28
    padding: 8
---
flowchart TB
  subgraph Client["客户端编辑层"]
    direction LR
    Editor([编辑内容]) --> Tx[生成事务]
    Tx --> Dirty{正文变更?}
    Dirty -.->|仅移动光标| Editor
  end
  subgraph Sync["本地同步引擎"]
    direction LR
    Queue([合并待写]) --> Log[(增量日志)] --> Snapshot[提交快照]
  end
  subgraph Desktop["桌面壳层"]
    direction LR
    Bridge([安全 IPC]) --> Disk[(工作区文件)]
    Disk --> Result{落盘成功?}
  end
  Client -->|提交正文事务| Sync
  Sync -->|写入版本快照| Desktop
  Desktop -.->|失败后重试| Sync
~~~

## 协同与发布时序图

~~~mermaid
sequenceDiagram
  autonumber
  participant E as 编辑器
  participant Q as 同步队列
  participant H as 主进程
  participant R as 发布服务

  E->>Q: 提交文档变更
  activate Q
  Note over E,Q: 正文编辑继续进行
  Q->>H: 保存当前快照
  activate H
  H-->>Q: 返回本地修订号
  deactivate H

  loop 校验每个待发布页面
    Q->>R: 检查权限与版本
    R-->>Q: 返回校验结果
  end

  alt 所有页面通过校验
    Q->>R: 发布试点版本
    R-->>Q: 返回发布记录
  else 权限或版本冲突
    Q-->>E: 标出冲突页
  end
  Q-->>E: 刷新发布状态
  deactivate Q
~~~

## 编辑与回滚状态机

~~~mermaid
stateDiagram-v2
  [*] --> Editing
  state Editing {
    [*] --> Idle
    Idle --> Composing: 开始输入
    Composing --> Idle: 提交候选字
    Idle --> Dragging: 按住块手柄
    Dragging --> Idle: 放置或取消
  }
  note right of Editing
    拖拽与输入法组合态独立处理
  end note
  Editing --> Saving: 提交版本
  Saving --> Published: 校验通过
  Saving --> Rollback: 校验失败
  Rollback --> Editing: 恢复上次快照
  Published --> [*]
~~~

## 领域模型类图

~~~mermaid
classDiagram
  class Page~T~ {
    +string id
    +List~T~ blocks
    +append(T block) int
    +snapshot() Revision
  }
  class Block {
    +string id
    +string kind
    +move(int index) void
  }
  class Revision {
    +int version
    +restore() Page
  }
  class RevisionStore {
    <<interface>>
    +save(Revision revision) bool
    +load(int version) Revision
  }
  class LocalRevisionStore {
    +string path
    +save(Revision revision) bool
    +load(int version) Revision
  }
  Page "1" *-- "0..*" Block : 拥有
  Page "1" *-- "1..*" Revision : 记录
  LocalRevisionStore ..|> RevisionStore : 实现
  RevisionStore ..> Revision : 读写
~~~

## 工作区实体关系图

~~~mermaid
erDiagram
  WORKSPACE ||--o{ PAGE : contains
  PAGE |o--o{ PAGE : parents
  PAGE ||--o{ BLOCK : owns
  BLOCK ||--o{ COMMENT_THREAD : anchors
  PAGE ||--o{ REVISION : records

  WORKSPACE {
    uuid id PK
    string title
  }
  PAGE {
    uuid id PK
    uuid workspace_id FK
    uuid parent_id FK
    string title
  }
  BLOCK {
    uuid id PK
    uuid page_id FK
    string kind
    int position
  }
  COMMENT_THREAD {
    uuid id PK
    uuid block_id FK
    bool resolved
  }
  REVISION {
    uuid id PK
    uuid page_id FK
    int version
  }
~~~

## 三阶段研发排期

~~~mermaid
---
config:
  gantt:
    useWidth: 640
    fontSize: 13
    sectionFontSize: 13
    leftPadding: 104
    barHeight: 22
---
gantt
  title 编辑器试点排期
  dateFormat YYYY-MM-DD
  axisFormat %m/%d
  tickInterval 1week
  todayMarker off
  excludes weekends

  section 基础能力
    事务存储       :done, storage, 2026-11-02, 4d
    工作区导航     :done, nav, after storage, 3d

  section 图表与公式
    Markdown 往返  :active, codec, after nav, 4d
    主题渲染       :crit, render, after codec, 4d
    联调完成       :milestone, integration, after render, 0d

  section 试点验收
    双端回归       :crit, check, after integration, 4d
    开放试点       :milestone, pilot, after check, 0d
~~~

## 编辑器架构思维导图

~~~mermaid
mindmap
  root((块级编辑器))
    内容模型
      文档树
        块属性
        选区映射
      Markdown
        导入解码
        导出编码
    交互层
      编辑手势
        拖拽建栏
        多块框选
      附着工具
        块操作
        表格编辑
    工作区
      页面管理
        层级导航
        划词评论
      持久化
        浏览器存储
        桌面快照
~~~

## 多分支协作流

~~~mermaid
gitGraph
  commit id: "基础编辑器" tag: "v0.8"
  branch "feature/drag"
  checkout "feature/drag"
  commit id: "块重排"
  checkout main
  branch "feature/markdown"
  checkout "feature/markdown"
  commit id: "Markdown 往返"
  checkout main
  branch hotfix
  checkout hotfix
  commit id: "修复落盘"
  checkout main
  merge hotfix tag: "v0.8.1"
  merge "feature/drag"
  merge "feature/markdown" tag: "v0.9"
~~~

## 研发耗时占比

~~~mermaid
pie showData
  title 试点迭代工时分布
  "编辑交互" : 28
  "Markdown 与渲染" : 24
  "工作区与持久化" : 18
  "桌面集成" : 12
  "验收与回归" : 18
~~~

## 性能指标双系列

横轴是文档块数，纵轴是耗时。柱表示首次渲染，折线表示单块更新。

~~~mermaid
xychart-beta
  title "文档块数与渲染耗时"
  x-axis "文档块数" [100, 500, 1000, 2000, 5000]
  y-axis "耗时（ms）" 0 --> 100
  bar [8, 16, 27, 46, 82]
  line [3, 5, 7, 11, 18]
~~~

## 复杂 LaTeX 公式

每个验收项按权重计分，满足 $\sum_{i=1}^{n} w_i = 100\%$。调度器按优先级排序，时间复杂度为 $O(n \log n)$。

**多行对齐方程组**。分别计算通过率、平均耗时及加权得分。

$$
\begin{aligned}
p &= \frac{N_{\mathrm{pass}}}{N_{\mathrm{total}}},\\
\bar t &= \frac{1}{n}\sum_{i=1}^{n} t_i,\\
S &= \sum_{i=1}^{n} w_i s_i,\qquad \sum_{i=1}^{n}w_i=1.
\end{aligned}
$$

**矩阵**。三轮评审分别给出稳定性、性能和易用性的得分。

$$
A=\begin{bmatrix}
0.98 & 0.95 & 0.92\\
0.99 & 0.96 & 0.94\\
1.00 & 0.97 & 0.96
\end{bmatrix},
\qquad \mathbf{s}=A\mathbf{w}.
$$

**分段函数**。按验收通过率和延迟门槛决定发布策略。

$$
R(p,t)=
\begin{cases}
\text{扩大试点}, & p\ge 0.99,\ t\le 50\,\mathrm{ms},\\
\text{继续观察}, & p\ge 0.95 \ \text{且未达上档门槛},\\
\text{回滚}, & p<0.95.
\end{cases}
$$
`

function addDiagramGallery(schema: Schema, workspace: WorkspaceState): WorkspaceState {
  const gallery = addPage(workspace, { id: galleryId, now: createdAt }, {
    title: galleryTitle, icon: '📊', content: markdownToDoc(schema, diagramGallery).toJSON(),
  })
  return { ...activatePage(gallery, workspace.activePageId), demoVersion }
}

export function upgradeDemoWorkspace(schema: Schema, workspace: WorkspaceState): WorkspaceState {
  if (workspace.demoVersion !== undefined ||
      ![DEMO_HANDBOOK_ID, checklistId, releaseId, notesId].every(id => findPage(workspace, id))) return workspace
  return addDiagramGallery(schema, workspace)
}

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
  const release = addPage(pilot, { id: releaseId, now: createdAt }, {
    parentId: DEMO_HANDBOOK_ID, title: '接口与发布规则', icon: '📐', content: markdownToDoc(schema, releaseRules).toJSON(),
  })
  const notes = addPage(release, { id: notesId, now: createdAt }, {
    title: '架构设计备忘', icon: '🗂️', content: markdownToDoc(schema, architectureNotes).toJSON(),
  })
  return addDiagramGallery(schema, activatePage(notes, DEMO_HANDBOOK_ID))
}
