# 架构与实测

编辑器使用 TipTap 和 ProseMirror 管理正文与选区。Web、桌面端和 CLI 共享文档 Schema。CLI 从纯 Node 入口调用 Markdown 编解码器和桌面文件存储。预览模式不创建 ProseMirror 实例，而是用独立 React 渲染器直接消费页面 JSON。

## 运行边界

```text
           src/editor/schema/ + src/editor/markdown/markdown-codec.ts
          ^                      ^                               ^
          |                      |                               |
    Web renderer          Electron renderer                aiblock-doc CLI
          |                      |                               |
      IndexedDB             IPC / preload                        |
  (meta/pages/assets)            |                               |
                           Electron main                         |
                             |   |                               |
    fs.watch -> renderer <---+   +--> aiblock-asset:// -> assets/ |
                             |                                   |
                             +----------------+------------------+
                                              v
                                src/workspace/workspace-files.ts
                                              |
                                    .lock + SHA-256 etag
                                              v
                               workspace/index.json + pages/
```

浏览器与桌面渲染进程使用同一套编辑器和文档格式。CLI 加载纯 Node 可用的 schema 和 Markdown 编解码器。桌面主进程与 CLI 共享页面文件的读写和并发校验，主进程另行提供图片协议与外部变更通知。

## 工作区存储

| 层级 | 保存内容 |
| --- | --- |
| 工作区索引 | v2 索引保存活动页、页面树、页面元数据与评论。 |
| 页面分片 | 每个 UUID 对应一份 ProseMirror JSON 正文。启动只校验活动页正文，其他页按需读取。 |
| 图片资产 | 通过 SHA-256 标识去重。正文记录图片 ID 和布局数据，图片字节单独存储。 |

Web 使用 IndexedDB 的 `meta`、`pages` 和 `assets`。桌面端使用 `index.json`、`pages/<uuid>.json` 和 `assets/`。打开已有工作区时可迁移有效的旧版数据。正文和标题采用 350 ms 防抖保存，读页和写盘都按分片处理。CLI 与桌面端共享文件锁和版本校验。文件读写实现位于 `src/workspace/workspace-files.ts`。

## 编辑与浮层

正文由连续的 ProseMirror DOM 渲染，保留跨块选区和浏览器查找。交互按钮、输入框和下拉菜单在正文之外。贴合正文的控件挂在编辑器的兄弟节点 `[data-document-overlays]`，使用文档局部坐标。布局变化时先批量测量，再应用有变化的坐标。页面滚动带动正文和浮层一起移动。布局调度实现位于 `src/editor/components/overlay-layout.ts`。

块控件、代码工具条和 Mermaid 在靠近视口时加载，行内公式也在滚近后渲染。图片用固有比例预留高度，近视口挂载位图，离屏释放 URL 租约。长代码超过 120 行或 4096 个文本字符时，在内联 Blob Worker 中计算语法高亮。Worker 超时会终止，后续编辑可以重试，旧文档结果会被丢弃。Worker 调度位于 `src/editor/extensions/long-code-highlight.ts`。

## 零 ProseMirror 静态预览

`src/workspace/PagePreview.tsx` 在预览模式替代 `PageEditor`。正文由 `src/editor/preview/DocumentPreview.tsx` 直接按 JSON 节点和 Mark 生成 React DOM，不挂载 EditorView、contentEditable 或编辑浮层。预览页把顶层块每 24 个包入一个 `.preview-chunk`，通过 `content-visibility: auto` 与固有高度跳过离屏布局。

折叠、复制、代码源码切换统一由 `.document-preview` 的单个 click 委托处理，不保存逐块 React state。普通代码高亮使用有界 LRU 缓存和空闲帧队列；滚动期间暂停增强任务，避免在输入帧内做语法分析。Mermaid、KaTeX、图片和行内公式共享一个容器级观察器，只在近视口时激活。目录和评论定位直接查询 `[data-block-id]` / `[data-comment-id]`。

## Chromium 实测

这组历史基准在 Apple M5 Pro 的 macOS arm64 环境上，用无头 Chromium 运行仓库生产构建。下表来自同一次 `e2e/perf.mjs --xl --images` 和随后的 `e2e/scroll.mjs` 测量，时延随设备和负载变化。

| 场景 | 测量结果 |
| --- | --- |
| XL 文档，4,500 个顶层块、17,074 个 ProseMirror 节点 | 首开 **347 ms**，切回 **216 ms**。 |
| XL 连续 20 次 Enter | 事务 P95 **10.7 ms**，帧间隔 P95 **33.3 ms**。 |
| XL 快速滚动 | 帧间隔 P95 **16.8 ms**，超过 20 ms 的帧 **2** 个，浮层样式写入 **0** 次。 |
| 2,500 行 TypeScript，12 次键入 | 编辑事务 P95 **1.4 ms**。 |
| 一次粘贴 100 张 PNG / WebP，共 6,893,623 字节 | 插入 **51 ms**，确认正文和资产落盘 **262 ms**。 |
| 滚过百图 | **100/100** 张解码，峰值挂载 **16** 张，帧间隔 P95 **16.7 ms**，长帧 **0**，CLS **0**。 |
| 独立滚动验收 | 静止鼠标时 **0** 次几何读取与样式写入，浮层对齐误差 **0 px**。 |

连续 Enter 的帧间隔仍可超过 60 Hz 的一帧预算。滚动与键入分别采样，P95 也与单次最大耗时不同。

### XL 预览与编辑对比

当前生产构建在 Apple M5 Pro、无头 Chromium、同一份 4,500 个顶层块 / 18,121 个节点文档上测量。两边使用相同视口、滚动距离和采样器；预览模式不创建 ProseMirror。

| 指标 | 编辑模式 | 预览模式 |
| --- | ---: | ---: |
| 冷开 | 534 ms | **152 ms** |
| 切页返回 | 399 ms | **83 ms** |
| 模式切换（预览→编辑 / 编辑→预览） | — | 477 ms / **164 ms** |
| 快速滚动帧 P95 | 16.7 ms | 16.8 ms |
| 快速滚动最大帧 | 33.4 ms（1 个长帧） | 50 ms（1 个长帧） |
| 首次 Hover 几何读取 | 3 次 | **0 次** |
| DOM 节点 | 35,437 | **29,056** |
| JS Event Listeners | 471 | **193** |
| JS Heap | 24.01 MiB | **21.85 MiB** |
| ProseMirror / contentEditable / textbox | 1 / 1 / 1 | **0 / 0 / 0** |

测量入口为 `node e2e/perf.mjs <vite-preview-url> --xl`。预览滚动把高亮和富预览增强推迟到滚动结束后，允许最多 1 个调度边界长帧。

复测的启动命令、浏览器设置和各场景说明见[浏览器滚动与压测](./development#浏览器滚动与压测)。
