# CLI 与 Agent Skill

`aiblock-doc` 用于从终端读取本地桌面文档和写入 Markdown。配套 Skill 说明如何定位页面、使用正确的版本标签以及处理冲突。CLI 可以在桌面应用关闭时运行。桌面端打开同一工作区时，会感知外部写入。

## 安装 CLI

在仓库根目录运行 `pnpm install` 和 `pnpm cli:build`。仓内可执行 `pnpm cli -- list`，或者直接用 Node.js 运行单文件产物 `node dist-cli/aiblock-doc.mjs list`。

想从任意目录通过 `aiblock-doc` 调用时，可将产物链接到 PATH 上的目录。以下以 `~/.local/bin` 为例。

```sh
mkdir -p "$HOME/.local/bin"
ln -s "$PWD/dist-cli/aiblock-doc.mjs" "$HOME/.local/bin/aiblock-doc"
aiblock-doc --help
```

当前 Shell 或 AI 工具的运行环境需要将 `~/.local/bin` 放入 PATH。也可以直接传给 Agent 构建产物的绝对路径。

## 选择工作区

直接运行 `aiblock-doc list` 即可使用系统默认的桌面工作区。macOS 的默认目录是 `~/Library/Application Support/aiblock-editor/workspace`。使用自定义配置目录或隔离测试目录时，用 `--workspace <dir>`，也可在环境中设定 `AIBLOCK_WORKSPACE`。命令行路径优先于环境变量。

## 从读取到写入

先通过 `list` 获取页面 UUID 并确认标题和父页。再用 `get` 读取正文与标签。输出是一行 JSON，下例使用 `jq` 只读取标准输出中的字段。

```sh
aiblock-doc list
aiblock-doc get "$page_id"
etag=$(aiblock-doc get "$page_id" | jq -er '.data.etag')
printf '## 决议\n\n上线前完成回归。\n' |
  aiblock-doc append "$page_id" --if-match "$etag" --markdown -
```

`create --title <title> --markdown -` 从 stdin 新建页，可用 `--parent` 归入某个父页，或用 `--activate` 设为活动页。新增、追加、改名和删除都支持 `--dry-run`。删除会带走所有后代，先检查预演的 `removedPageIds`。

正文追加使用 `get` 返回的页面 `etag`。改名和删除使用 `list` 或 `get` 返回的 `indexEtag`。返回退出码 4 时，根据操作重读正文或页面树，对照当前数据再决定是否重试。完整参数、输出和退出码见 [CLI 参考](../reference/cli-api)。

## 安装 Skill

复制或软链整个 `skills/aiblock-doc` 目录，保留 `SKILL.md` 和 `references/`。路径如下。

| 工具 | 用户级目录 | 仓库级目录 |
| --- | --- | --- |
| Claude Code | `~/.claude/skills/` | `.claude/skills/` |
| Codex | `~/.agents/skills/` | `.agents/skills/` |
| Antigravity | `~/.gemini/config/skills/` | `.agents/skills/` |
| Cursor | `~/.cursor/skills/` | `.cursor/skills/` |

从仓库根目录执行。为其他工具安装时替换 `skills_dir`。AI 工具若要求技能位于可读范围内，可以复制目录。

```sh
skills_dir="$HOME/.agents/skills"
mkdir -p "$skills_dir"
ln -s "$PWD/skills/aiblock-doc" "$skills_dir/aiblock-doc"
```

在新会话里让工具使用 `aiblock-doc` 列出本地知识库页面，或明确要求追加到已选中的页面。将编辑内容、目标页面及工作区交给 Agent 即可开始。CLI 和 Skill 分别安装，确认 Agent 的终端可运行 `aiblock-doc --help`。

## 桌面热同步

<!--@include: ../../skills/aiblock-doc/references/cli-reference.md#desktop-sync-->
