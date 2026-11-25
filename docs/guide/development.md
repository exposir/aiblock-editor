# 开发、测试与排查

先按[快速开始](./getting-started)安装依赖。以下命令在仓库根目录运行。

## 目录结构

```text
.
├── .github/workflows/      # CI、macOS 发布与文档发布
├── build/                  # 应用图标源文件、PNG 和 macOS .icns
├── docs/
│   ├── .vitepress/         # 站点配置和主题
│   ├── guide/              # 使用与开发指南
│   ├── public/             # 站点图标和产品截图
│   ├── reference/          # CLI 参考页
│   └── index.md            # 首页
├── e2e/                    # Chromium 滚动、性能与图表检查
├── electron/               # 主进程、preload、存储、导航安全与文件监听
├── public/                 # 编辑器 favicon
├── scripts/                # CLI 与 Electron 构建和启动脚本
├── skills/aiblock-doc/     # Agent Skill 与 CLI 契约原文
├── src/
│   ├── cli/                # Node CLI 入口、参数和工作区操作
│   ├── components/         # 大纲、评论侧栏
│   ├── desktop/            # Web 与 Electron 桥接
│   ├── editor/
│   │   ├── components/     # 块工具和浮层布局
│   │   ├── extensions/     # TipTap 编辑扩展
│   │   ├── markdown/       # 编解码、智能粘贴与文件导入导出
│   │   ├── preview/        # Mermaid 与 KaTeX 渲染
│   │   ├── schema/         # 编辑器与 CLI 共用的文档定义
│   │   └── views/          # 自定义 NodeView
│   ├── test/               # Vitest 环境与通用夹具
│   ├── theme/              # 主题解析与持久化
│   ├── workspace/          # 工作区分片、索引、图片资产和状态
│   ├── App.tsx             # 工作区界面
│   ├── app-identity.ts     # 桌面端与 CLI 共用的应用标识
│   ├── main.tsx            # Web 入口
│   └── styles.css          # 编辑器样式
├── .gitignore
├── LICENSE
├── README.md
├── index.html
├── package.json
├── pnpm-lock.yaml
├── pnpm-workspace.yaml
├── postcss.config.js
├── tailwind.config.js
├── tsconfig.electron.json
├── tsconfig.json
└── vite.config.ts
```

Web、CLI 和 Electron 构建分别输出到 `dist/`、`dist-cli/` 和 `dist-electron/`。桌面打包写入 `release/`，覆盖率报告写入 `coverage/`，文档构建写入 `docs/.vitepress/dist/`。这些目录由命令生成。

VitePress 通过 `<!--@include-->` 读取 `skills/aiblock-doc/references/cli-reference.md` 的指定小节。CLI 参数、返回值或冲突说明有变更时，在这份原文更新，站点构建会同步引用。

## 修改代码时要守住的约束

| 约束 | 检查重点 |
| --- | --- |
| 正文是连续的 ProseMirror 内容 | `contenteditable` 内应有 0 个原生交互控件（`button`、`input`、`select`、`textarea`），保留浏览器查找和跨块选区。 |
| 浮层属于当前文档 | Document-local Portal 挂在 `[data-document-overlays]`，使用局部坐标。滚动漂移须为 0 px，单纯滚动须有 0 次浮层样式写入。 |
| 工作区使用 v2 按页分片 | 索引保存元数据，正文按页保存。图片原始字节放在资产库，正文 JSON 禁止存入 Base64 图像。 |
| 桌面与 CLI 并发写入 | 使用工作区 `.lock` 串行化写入，以内容的 SHA-256 `etag` 检测读写期间的改动。 |

## 开发、构建与单测

```sh
pnpm dev                              # Web 开发
pnpm electron:dev                     # Electron 与独立 Vite 开发服务
pnpm build                            # Web 生产构建
pnpm electron:build                   # 生产渲染器、主进程和 preload
pnpm electron:pack                    # macOS 应用目录包
pnpm cli:build                        # Node CLI 单文件构建

pnpm tsc --noEmit                     # Web 与共享代码类型检查
pnpm tsc --noEmit -p tsconfig.electron.json
pnpm test                             # Vitest 单测
pnpm test:coverage                    # Vitest V8 覆盖率
pnpm test src/workspace/page-store.test.ts

pnpm docs:dev                         # 文档开发，默认端口 4174
pnpm docs:build                       # 构建站点并检查 Markdown 链接
pnpm docs:preview                     # 预览构建产物
```

文档站的部署路径是 `/aiblock-editor/`。本地预览用终端输出的站点地址。工作流在 `main` 收到推送或手动触发时构建并发布 GitHub Pages。

## CI 与发布

`.github/workflows/ci.yml` 在推送到 `main` 和针对 `main` 的拉取请求上运行，使用 Node.js 24 和 pnpm 12.21.0。依次执行冻结安装、渲染器与 Electron 两套类型检查、`pnpm test`、渲染器/CLI/Electron/文档四种构建，最后扫描旧品牌字符串。任一阶段失败都会终止流水线。

`.github/workflows/release.yml` 由 `v*` 标签推送或手动触发。`verify` job 复跑类型检查与测试；`build-mac` 在 `macos-14` 上生成 arm64 DMG、CLI 单文件和 Skill 归档，并写入 `SHA256SUMS.txt`。没有 `CSC_LINK` 时使用 ad-hoc 签名；提供 `CSC_LINK` 和 `CSC_KEY_PASSWORD` 后使用 Developer ID 签名；同时提供 `APPLE_ID`、`APPLE_APP_SPECIFIC_PASSWORD` 和 `APPLE_TEAM_ID` 才启用公证。签名权限在 `build/entitlements.mac.plist`。标签发布会通过 `gh release` 创建或更新 Release。

## 主进程日志与错误恢复

主进程把结构化日志写到 `<userData>/logs/main.log`，每行一个 JSON 对象，包含时间、级别、上下文和截断后的详情。日志超过 1 MiB 时轮转为 `main.log.1`。目录权限为 `0700`，文件权限为 `0600`。

渲染进程崩溃会记录 `render-process-gone`，并弹出「工作区显示中断」。可以选择重新加载窗口、打开日志目录或退出。10 秒内再次崩溃会标记为连续崩溃，默认选项变为退出，窗口不会自动重启。未捕获异常、未处理的 Promise 拒绝和图片清理失败也会写入同一日志。排查时先打开日志目录，保留 `main.log` 与轮转文件。

## CSP 与导航边界

桌面窗口只允许加载应用自身文档。主进程拦截导航：HTTP、HTTPS 和 `mailto:` 链接交给系统浏览器，其余目标直接拒绝，子 frame 导航一律阻止。

应用文档会附加 CSP：默认只允许同源资源；脚本只允许同源，开发模式额外允许 `127.0.0.1` 的 Vite 服务和 HMR WebSocket；`worker-src` 允许 `blob:`；样式允许内联；图片允许同源、`aiblock-asset:`、`blob:`、`data:` 和 HTTP(S)；连接允许同源、`aiblock-asset:`、`blob:` 和开发模式回环；`object-src` 为 `none`，并禁止被其他页面嵌入。图片资产响应另带 `Content-Security-Policy: default-src 'none'` 和 `X-Content-Type-Options: nosniff`。

## 浏览器滚动与压测

在一个终端启动生产构建的预览服务。使用空闲端口和 `--strictPort`，避免误测其他服务。

```sh
pnpm build
pnpm exec vite preview --host 127.0.0.1 --port 5197 --strictPort
```

在另一个终端运行无头浏览器检查。

```sh
node e2e/scroll.mjs http://127.0.0.1:5197/
node e2e/perf.mjs http://127.0.0.1:5197/
node e2e/perf.mjs http://127.0.0.1:5197/ --xl --images
```

- `scroll.mjs` 检查鼠标停在图表、工具条、代码和表格上时的滚轮传递，以及浮层对齐、滚动漂移和样式写入。它复用 `gallery.mjs` 检查示例图表。
- `perf.mjs` 默认测示例页与合成长文档的加载、编辑和滚动。`--xl` 运行 4,500 块长文档与长代码检查，`--images` 运行百图场景。可以单独运行其中一项。对比结果时记录 Chromium 版本、设备和参数。
- macOS 默认查找 `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`，其他平台默认从 PATH 查找 `chromium`。用 `CHROME_BIN` 指定可执行文件。脚本使用临时浏览器配置。跑完后在预览终端按 `Ctrl+C`。

## 常见问题排查

### Web 与桌面看到的文档不同

浏览器按站点地址和浏览器配置隔离 IndexedDB。换端口、浏览器配置或域名会看到不同工作区。Electron 在应用数据目录里保存页面，CLI 默认读取同一目录。在两端交换正文时，从一端导出 Markdown，再在另一端导入。Markdown 里的 `asset:` 引用需要相应图片资源。

### macOS 提示无法打开本地构建

`pnpm electron:pack` 使用本地 ad-hoc 签名。先确认应用是自己从可信源码构建的，再用 Finder 打开 `release/` 里的 `AIBlock Editor.app`。如果 Gatekeeper 拦截，按 macOS 提示在「系统设置 → 隐私与安全性」中检查是否可为该应用选择「仍要打开」。面向他人分发时，使用 Developer ID 签名并完成 Apple 公证。

### 找不到 aiblock-doc，或 pnpm 没有传递参数

先用 `pnpm cli:build` 生成 `dist-cli/aiblock-doc.mjs`。仓内用 `pnpm cli -- list` 调用，`--` 之后的参数交给 CLI。也可运行 `node dist-cli/aiblock-doc.mjs list`。需要从任意目录调用时，把构建产物软链为 PATH 中的 `aiblock-doc`，并在实际使用的终端或 Agent 环境运行 `aiblock-doc --help` 检查。[CLI 安装示例](./cli-and-skill#安装-cli)

### 桌面出现变更冲突条，或 CLI 以 4 退出

桌面冲突条提供「从磁盘重载」和「用本地覆盖保存」。先核对磁盘内容和界面上未保存的编辑，明确保留哪一份再选。退出码 `4` 涵盖版本冲突和工作区锁冲突。追加前用 `get` 重新读取正文和 `etag`，改名或删除前用 `list` 重新读取页面树和 `indexEtag`。若另一个写入方仍持有锁，等写入结束后再检查与重试。[桌面同步说明](./cli-and-skill#桌面热同步)
