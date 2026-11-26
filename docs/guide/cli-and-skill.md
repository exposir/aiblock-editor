# CLI 与 Agent Skill

`aiblock-doc` 用于从终端搜索本地桌面文档，阅读大纲和局部小节，精准替换块或小节，读写划词评论，整理页面树，并通过回收站安全删除或恢复。也可以写入整页 Markdown、导入图片和清理未引用资产。配套 Skill 说明如何定位页面、使用正确的版本标签以及处理冲突。CLI 可以在桌面应用关闭时运行。桌面端打开同一工作区时，会感知外部写入。

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

不知道页面 UUID 时先用 `search` 按标题和正文查找。标题命中排在前面，正文命中带上下文片段；回收站页面不参与搜索。

```sh
aiblock-doc search '发布计划' --limit 5
```

页面位置参数也可以写 `@active`，直接使用索引中的当前活动页，省去重复 `list` 查 UUID。

再用 `list` 确认页面树，用 `get` 读取正文与标签。输出是一行 JSON，下例使用 `jq` 只读取标准输出中的字段。

```sh
aiblock-doc list
aiblock-doc get @active
etag=$(aiblock-doc get @active | jq -er '.data.etag')
printf '## 决议\n\n上线前完成回归。\n' |
  aiblock-doc append @active --if-match "$etag" --markdown -
```

长文档先读结构，再按块或小节取局部 Markdown，避免整页内容消耗 token：

```sh
aiblock-doc outline @active --blocks
aiblock-doc get @active --section "$heading_block_id" --with-block-ids
printf '## 修订\n\n只替换这一节。\n' |
  aiblock-doc patch @active --if-match "$etag" --replace-section "$heading_block_id" --markdown -
```

`patch` 还支持 `--replace-block`、`--insert-before`、`--insert-after` 和 `--delete-block`。未触及的块保留原 `blockId`、评论 Mark、图片宽高、表格列宽和代码视图模式。`append` 只把 Markdown 加到页尾；需要整体重写时用 `update`，它同样使用页面 `etag`，并保留页面元数据。

```sh
aiblock-doc update @active --if-match "$etag" --markdown rewritten.md
```

`create --title <title> --markdown -` 从 stdin 新建页，可用 `--parent` 归入某个父页，或用 `--activate` 设为活动页。新增、追加、替换、`patch`、改名、移动、删除、评论回复、恢复、图片导入和资产回收都支持 `--dry-run`。

## 评论协作

评论线程保存在索引中。`comments` 读取全部线程，`--unresolved` 只看未解决项。`comment-reply` 追加一条消息，`--author` 默认 `AI`；加 `--resolve` 后线程立即标记为已解决。回复使用 `indexEtag`，桌面端会通过热同步看到新消息。

```sh
aiblock-doc comments @active --unresolved
aiblock-doc comment-reply @active "$thread_id" --text '已处理，请复核。' --resolve --if-match "$index_etag"
```

## 页面树与回收站

`move` 把页面移到目标父页末尾，`--parent root` 表示根级；移入自身或后代会被拒绝。`delete` 默认把目标和后代软删进回收站，正文分片和图片引用都保留。确认需要不可逆清理时才加 `--permanent`。

```sh
aiblock-doc move @active --parent root --if-match "$index_etag"
aiblock-doc delete @active --if-match "$index_etag"
aiblock-doc trash-list
aiblock-doc restore "$trashed_page_id" --if-match "$index_etag"
```

`restore` 恢复目标及回收站中的后代。原父页不在活页时，目标页自动提根。恢复前用 `trash-list` 核对页面和 `deletedAt`。

图片先导入，再把返回的 `markdown` 交给 `create`、`update`、`patch` 或 `append`。支持 PNG、JPEG、GIF 和 WebP，单张上限 32 MiB，按 SHA-256 去重。

```sh
aiblock-doc add-image screenshot.png
# data.markdown 形如 ![](asset:<id>)
aiblock-doc gc --dry-run
```

`asset:` 引用只在同一工作区有效。未引用的图片可以用 `gc` 回收：默认保留 5 分钟内新写入的资产，`--grace-ms 0` 立即回收。`gc` 在锁内读取活页和回收站，任何分片缺失或损坏都会中止，且不删除资产。

追加、整页替换和局部 `patch` 使用 `get` 返回的页面 `etag`。改名、移动、默认软删、恢复和评论回复使用 `list` / `comments` 返回的 `indexEtag`。返回退出码 4 时，根据操作重读正文、目标块或页面树，对照当前数据再决定是否重试。完整参数、输出和退出码见 [CLI 参考](../reference/cli-api)。

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
