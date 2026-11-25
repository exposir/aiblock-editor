# 快速开始

| 入口 | 适合什么场景 | 数据存放位置 |
| --- | --- | --- |
| Web 端 | 在浏览器里试用或编辑文档 | 当前站点和浏览器配置对应的 IndexedDB |
| Electron 桌面端 | 在 macOS 上编辑本地文档，或和 CLI 共用页面 | 应用用户数据目录下的 `workspace/` |
| CLI | 从终端、脚本或 AI 工具读取、创建和追加文档 | 默认读写 Electron 桌面工作区，可显式指定其他路径 |

第一次打开编辑器时，可以在页面树里进入示例文档，也可以从空白页开始。

## 环境要求

- Node.js 版本范围为 `^22.12.0 || ^24.0.0 || >=26.0.0`，包管理器使用仓库声明的 `pnpm@12.21.0`。
- 下文的桌面打包路径以 Apple Silicon macOS 为例。CLI 的独立构建产物只需要 Node.js。

在终端克隆仓库并安装依赖。Electron 安装脚本会下载与项目版本匹配的运行时。

```sh
git clone https://github.com/exposir/aiblock-editor.git && cd aiblock-editor
pnpm install --frozen-lockfile
```

## Web 端

```sh
pnpm dev
```

打开 Vite 输出的本地地址，默认端口为 5173。用 `pnpm build` 生成 `dist/`。浏览器工作区保存在当前站点和浏览器配置对应的 IndexedDB 中，换站点或配置会切换存储。

## Electron 桌面端

```sh
pnpm electron:dev
pnpm electron:build
pnpm electron:pack
```

开发命令同时启动 Vite 和桌面应用。`electron:build` 生成渲染器及主进程产物。`electron:pack` 构建可运行的目录包，Apple Silicon 的默认产物为 `release/mac-arm64/AIBlock Editor.app`。仓库使用本地 ad-hoc 签名，发布给其他用户时需按 macOS 的分发流程另行签名与公证。

桌面数据保存在应用用户数据目录。macOS 的默认工作区是 `~/Library/Application Support/aiblock-editor/workspace`。桌面版和 Web 版各自保存页面。要交换正文，可以在编辑器里导出 Markdown 再导入。

## CLI

```sh
pnpm cli:build
pnpm cli -- list
node dist-cli/aiblock-doc.mjs --help
```

`list` 在工作区未初始化时返回空列表。打开桌面端可访问示例页。也可以用 `create` 初始化一个空工作区，例如在指定目录下做试验。查看 [CLI 与 Agent Skill](./cli-and-skill) 了解安装、输入方式和冲突处理。
