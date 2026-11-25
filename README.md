# Lark Block Editor

面向长文档与本地知识库的类飞书块级编辑器（Web + macOS Electron 桌面端 + Agent-First CLI）。

基于 TipTap 3、ProseMirror、React 19、TypeScript（strict）、Vite 7 与 Electron 45 构建，核心编辑体验保持零 `contenteditable` 内置交互控件、按页分片存储、资产二进制分离，并提供与桌面工作区实时热同步的 `lark-doc` CLI 与 `SKILL.md`。

---

## 核心能力

- **块级编辑与排版**
  - 六大核心扩展：全局唯一 `blockId` 与大纲提取、容器块（Callout 提示块 / Toggle 折叠块 / 最多 5 列可拖拽调宽 ColumnList 且单列自动解包）、4 向拖拽与边缘自动建栏、多块选区与框选、支持中文拼音检索的 `/` 斜杠菜单与划词悬浮工具条、增强表格与代码块。
  - **Markdown 双向无损编解码**：支持粘贴自动识别、导入/导出 `.md` 与 JSON，覆盖标题、嵌套列表、任务列表、表格、公式、图表、图片及自定义块语法（`>> ` 折叠、`[! ` 提示块、多栏）。
  - **图表与公式（对齐 GitHub 能力）**：支持 Mermaid 全图种（按需加载、`securityLevel: 'strict'`、Preview/Split/Code 三视图、6 套常用模板与 SVG 导出）以及 KaTeX 行内 `$...$` / 块级 `$$...$$` / ```` ```math ```` 公式。
  - **批量贴图与资产分离**：支持剪贴板多图粘贴（单批最多 200 张）、文档拖放、`/图片`、安全 HTML 与 Markdown 往返；单次原子事务支持一步 `Ctrl+Z` 整批撤销。图片按 SHA-256 去重落盘（PNG/JPEG/GIF/WebP，单张上限 32 MiB），严禁 Base64 进正文 JSON；粘贴前先预检魔数与二进制头尺寸并用 `aspect-ratio` 锁定高度，近视口（`±800px`）异步解码，离屏自动卸载并回收租约。
- **多页面工作区与深色模式**
  - 支持多级嵌套页面树、面包屑导航、大纲目录跳转与划词评论侧栏。
  - 支持浅色 / 暖炭黑深色 / 跟随系统三态无闪烁切换，桌面端同步 macOS `nativeTheme` 与窗口背景色。
- **超大文档性能优化**
  - **外层按页分片**：工作区拆为轻量索引（`index.json`）+ 按页正文分片（`pages/<uuid>.json`）+ 二进制资产库（`assets/<sha256>.<ext>`）；Web 端使用 IndexedDB（自动迁移旧 `localStorage`），桌面端按文件原子写盘，保存与改标题仅落脏页/索引。
  - **内层视口懒加载与增量热路径**：浮层控件、代码工具条、Mermaid 与 `InlineMath` 均受 `IntersectionObserver` 视口门控；长代码块（>120 行或 >4KB）走内联 Blob Worker 异步高亮；Overlay 同帧 Read→Write 批处理；`hitBlock` 采用 Y 轴排序前缀 `maxBottom` 二分查找。
- **AI 友好（CLI + Skill + 热同步）**
  - 提供纯 Node 单文件 CLI `lark-doc`，与桌面端共享跨进程文件锁（`.lock`）及内容 SHA-256 `etag` 乐观并发检查。
  - Electron 主进程通过 150ms 防抖 `fs.watch` 与窗口焦点对账感知外部改动：干净页自动热刷新（支持 `--activate` 实时切页），脏页/脏标题绝不静默覆盖并展示冲突处理条。

---

## 快速开始

环境要求：Node.js `^22.12.0 || ^24.0.0 || >=26.0.0`，`pnpm`（推荐 `pnpm@12`）。

```bash
# 安装依赖
pnpm install

# Web 开发（默认 http://localhost:5173/）
pnpm dev

# Electron 桌面端开发联动
pnpm electron:dev

# 构建 Web 与 Electron 主进程产物
pnpm electron:build

# 打包 macOS 桌面应用（产物位于 release/mac-arm64/Lark Block Editor.app）
pnpm electron:pack

# 构建单文件 CLI（产物位于 dist-cli/lark-doc.mjs）
pnpm cli:build
```

---

## `lark-doc` CLI 与 Agent Skill

CLI 采用统一 JSON 契约（成功写入 stdout：`{"ok":true,"data":...}`，失败写入 stderr：`{"ok":false,"error":{...}}`），语义退出码：`0` 成功、`1` I/O、`2` 参数错误、`3` 不存在、`4` `etag`/锁冲突、`5` 格式校验失败。

工作区解析顺序：`--workspace <dir>` → `$LARK_WORKSPACE` → 默认桌面端 `userData/workspace`（macOS 为 `~/Library/Application Support/lark-block-editor/workspace`）。

```bash
# 列出页面树与当前 indexEtag
pnpm cli -- list

# 读取单页 Markdown 与页面 etag
pnpm cli -- get <page-id>

# 从 stdin 创建并立即在已打开的桌面窗口激活展示
printf '### 结论\n\n- 已完成验证\n' | pnpm cli -- create --title '会议记录' --icon '📝' --markdown - --activate

# 带乐观锁在页尾追加 Markdown（支持 --dry-run 预检）
pnpm cli -- append <page-id> --if-match <etag> --markdown notes.md

# 重命名或删除页面（使用 indexEtag 防止并发误改）
pnpm cli -- rename <page-id> --title '新标题' --if-match <index-etag>
pnpm cli -- delete <page-id> --if-match <index-etag>
```

配套 Agent Skill 位于 [`skills/lark-doc/SKILL.md`](skills/lark-doc/SKILL.md)，包含工作流约束、退出码处理和安全红线，可直接挂载到支持 Agent Skills 的 AI 工具中使用。

---

## 测试与压测

```bash
# 类型检查（前端 + Electron 主进程）
pnpm tsc --noEmit
pnpm tsc --noEmit -p tsconfig.electron.json

# 运行全量单元测试（Vitest + jsdom + fake-indexeddb）
pnpm test

# 覆盖率报告
pnpm test:coverage

# 浏览器级性能、百图与滚动验收脚本（需先 pnpm build）
node e2e/scroll.mjs
node e2e/perf.mjs --xl --images
```

---

## 目录结构

```text
.
├── build/                 # 应用图标矢量源文件与 macOS .icns / 1024px PNG
├── e2e/                   # 无头 Chromium 性能、滚动与画廊验收脚本
├── electron/              # Electron 主进程、preload、安全策略、原子分片存储与外部变更监听
├── public/                # 浏览器端精简 favicon.svg
├── scripts/               # Electron 主进程、开发联动与 CLI esbuild 构建脚本
├── skills/lark-doc/       # 供 AI Agent 调用的 lark-doc SKILL.md
└── src/
    ├── cli/               # 纯 Node CLI 入口、参数解析与工作区操作实现
    ├── components/        # 大纲目录、评论侧栏等通用界面组件
    ├── desktop/           # Web / Electron 双端桥接抽象层
    ├── editor/
    │   ├── components/    # Document-local Portal 浮层、视口观察与二分几何命中
    │   ├── extensions/    # 六大核心块插件、ImageBlock、InlineMath、长代码 Worker 高亮
    │   ├── markdown/      # Markdown 双向编解码、智能粘贴与文件导入导出
    │   ├── preview/       # Mermaid / KaTeX 惰性渲染器
    │   ├── schema/        # 零 DOM / 零 React 依赖的共享 ProseMirror Schema
    │   └── views/         # React NodeView 壳层
    ├── theme/             # 三态主题解析与持久化
    └── workspace/         # v2 分片格式、IndexedDB 存储、SHA-256 资产库与状态钩子
```

---

## 许可

本项目源码采用 [MIT License](LICENSE)。打包分发时注意 Electron/Chromium 运行时、Mermaid（含 `elkjs`）及 `electron-builder` 传递依赖各自的开源许可声明。
