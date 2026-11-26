# aiblock-doc CLI 参考

CLI 操作本地 Electron v2 工作区。运行 `aiblock-doc --help` 查看当前二进制的用法。以下 JSON 是响应结构示例，UUID、时间、标签和资产哈希随工作区变化，只能用于理解输出。实际调用总是读取当前工作区的值。

<!-- #region command-contract -->

## 命令与参数

| 命令 | 参数与默认行为 | 成功返回的 `data` |
| --- | --- | --- |
| `list` | 无位置参数。读取索引，返回存储顺序的平面列表，可用 `parentId` 和同级 `order` 组树。 | `activePageId`、`pages`、`indexEtag` |
| `get <id\|@active>` | 可选 `--format markdown\|json`，默认 `markdown`；`--block <id>` 与 `--section <heading-id>` 互斥；`--with-block-ids` 仅用于 Markdown。 | `page`、`etag`、`indexEtag`、`format`、`content` |
| `outline <id\|@active>` | `--blocks` 同时返回每个顶层块的类型和摘要。标题按顶层顺序排列。 | `page`、`etag`、`indexEtag`、`blockCount`、`outline`，可选 `blocks` |
| `search <query>` | 关键词必填。`--limit <n>` 为正整数，默认 20。检索全部活页，标题命中优先，正文命中带片段。 | `query`、`matches`（`page`、`titleMatch`、`snippets`） |
| `create --title <title>` | `--parent <id>` 默认根页，`--icon <emoji>` 默认 `📄`，`--markdown -\|<file>` 默认空页。`--activate` 默认关闭。 | `page`、`etag`、`indexEtag` |
| `append <id\|@active> --if-match <etag>` | 使用页面 `etag` 追加非空 Markdown。`--markdown -\|<file>` 省略时读 stdin。 | `pageId`、`etag`、`indexEtag` |
| `update <id\|@active> --if-match <etag>` | 使用页面 `etag` 整页替换正文，保留标题、图标、父页、同级顺序和创建时间。输入方式与 `append` 相同。 | `pageId`、`etag`、`indexEtag` |
| `patch <id\|@active> --if-match <etag>` | 五种操作互斥：`--replace-block`、`--insert-before`、`--insert-after`、`--delete-block`、`--replace-section`。除 `--delete-block` 外读取非空 Markdown。 | `pageId`、`operation`、`targetBlockId`、`etag`、`indexEtag` |
| `rename <id\|@active> --title <title> --if-match <indexEtag>` | 使用索引 `indexEtag` 更新标题，正文分片保持原样。 | `pageId`、`title`、`indexEtag` |
| `move <id\|@active> --parent <id\|root> --if-match <indexEtag>` | 移至目标父页末尾；`root` 表示根级。禁止移入自身或后代。 | `pageId`、`parentId`、`order`、`indexEtag` |
| `delete <id\|@active> --if-match <indexEtag>` | 默认把子树软删入回收站并保留分片；`--permanent` 才物理删除分片。 | `removedPageIds`、`activePageId`、`indexEtag`、`trashed` |
| `trash-list` | 无位置参数。列出回收站页面及其删除时间。 | `trash`、`indexEtag` |
| `restore <trash-id> --if-match <indexEtag>` | 恢复回收站页面及其回收站后代；原父页不在活页时自动提根。 | `restoredPageIds`、`page`、`indexEtag` |
| `comments <id\|@active>` | `--unresolved` 只返回未解决线程。评论保存在索引中，不改正文分片。 | `page`、`indexEtag`、`comments` |
| `comment-reply <id\|@active> <thread-id> --text <text> --if-match <indexEtag>` | `--author` 默认 `AI`；`--resolve` 同时标记线程已解决。 | `pageId`、`threadId`、`message`、`resolved`、`indexEtag` |
| `add-image <file>` | 导入 PNG、JPEG、GIF 或 WebP，单文件上限 32 MiB。按 SHA-256 去重写入工作区 `assets/`。 | `asset`、`markdown`、`created` |
| `gc [--grace-ms <n>]` | 扫描活页和回收站分片的图片引用。默认宽限 300000 ms；`--grace-ms 0` 立即回收。 | `scannedPages`、`referencedCount`、`orphanIds`、`removedCount`、`reclaimedBytes` |

页面位置参数接受 UUID 或别名 `@active`，后者解析为 `index.json` 的 `activePageId`。工作区未初始化或没有活动页时返回退出码 3。`restore` 只接受回收站页面 ID。

`page` 和 `pages[]` 的元数据包含 `id`、`parentId`、`title`、`icon`、`order`、`updatedAt`。时间戳单位为 Unix 毫秒，根页的 `parentId` 为 `null`。标题去除首尾空白，空标题报错。图标为空白时回退到 `📄`。

`get` 的 `--block` 按顶层块 ID 导出局部内容，`--section` 从标题块导出到下一个同级或更高级标题之前。`--with-block-ids` 在每个顶层块前插入 `<!-- block:<id> -->`，只在 Markdown 格式有效。不带这些选项时输出与旧契约完全一致。`outline` 的 `outline[]` 包含 `blockId`、`level`、`text`、`blockIndex`，`blocks[]` 包含 `blockId`、`type`、`preview`（最多 80 字符）。

`patch` 只替换目标范围内的顶层块，未触及块保留原节点、`blockId`、评论 Mark 和图片/表格/代码视图属性。`--replace-section` 的目标必须是标题块。目标块或标题不存在返回 3；小节目标不是标题、空内容或循环移动返回 5。`comment-reply` 的 `message` 包含 `id`、`author`、`text`，线程不存在返回 3。

`search` 返回的 `page` 与 `list` 相同。关键词去除首尾空白；空白关键词、非正整数的 `--limit` 或小于 0 的 `--grace-ms` 返回参数错误。`titleMatch` 为 `true` 时 `snippets` 为空；正文命中时 `snippets` 含一段上下文。回收站页面不参与检索，但其中的图片引用仍会被 `gc` 视为存活引用。

`--workspace <dir>` 优先于 `$AIBLOCK_WORKSPACE`，两者缺省时自动使用系统默认的桌面工作区。macOS 的默认路径是 `~/Library/Application Support/aiblock-editor/workspace`。Windows 使用 `%APPDATA%\aiblock-editor\workspace`，缺少 `APPDATA` 时使用用户目录下的 `AppData\Roaming`。Linux 使用 `$XDG_CONFIG_HOME/aiblock-editor/workspace`，缺少变量时使用 `~/.config`。相对路径以命令的执行目录为准。给已有旧桌面工作区写入前，先用 `list` 打开它。读取索引时会尝试把有效的旧 `workspace.json` 迁移为 v2。

`--markdown -` 显式走 stdin，文件输入按严格 UTF-8 读取，路径相对于执行目录。`append` 与 `update` 在交互终端且无输入时返回参数错误。`update` 还拒绝空白 Markdown、非 UTF-8 文件和渲染后没有任何可见块的内容。创建已有工作区的页面时，只有 `--activate` 会切换活动页，首次创建自动激活。若删除当前活动页，CLI 优先选择目标节点的后一个同级页，其次是前一个同级页、父页或首个剩余页。

`--dry-run` 校验写命令并预演结果，正文和索引保持原样。工作区写命令的预演会短暂持有文件锁，目录尚不存在时可能被创建。`create` 预演返回 `dryRun: true` 和临时 `page`，两个标签为 `null`。`append`、`update`、`patch`、`rename`、`move`、`delete`、`comment-reply` 和 `restore` 预演增加 `dryRun: true` 并返回当前标签；`delete` 预演仍报告真实的 `trashed` 结果。`add-image` 预演只校验文件并计算确定性资产元数据，不创建 `assets/`。`gc` 预演只报告候选，不删除文件。`list`、`get`、`outline`、`search`、`comments` 和 `trash-list` 接受该选项但执行正常读取。

## JSON 信封与退出码

正常数据响应是一行 stdout JSON `{"ok":true,"data":{...}}`。失败是一行 stderr JSON `{"ok":false,"error":{"code":"...","message":"...","hint":"..."}}`，`hint` 可以为空。`--help` 和 `-h` 在 stdout 输出纯文本并退出 0。省略命令同样输出纯文本帮助并退出 2。通过包管理器调用时，包管理器可能在 stderr 添加日志。

| 退出码 | `error.code` | 含义与处理 |
| --- | --- | --- |
| 0 | 空 | 成功。读取 `data`。 |
| 1 | `io_error` | 读取、写入或其他运行错误。核对路径和权限。 |
| 1 | `workspace_error` | 错误类型已预留。当前命令通常以 `io_error` 报告 I/O 问题。 |
| 2 | `usage` | 未知命令、缺少参数、非法 UUID、非法格式、互斥选项冲突或缺少块操作。用 `--help` 核对。 |
| 3 | `not_found` | 缺少工作区、页面、父页、块、评论线程、回收站页面或图片文件。重新列出页面或检查文件路径。 |
| 4 | `conflict` | 页面或索引标签过期、磁盘变化或锁竞争。重读对应数据后确认再试。 |
| 5 | `invalid_content` | 空标题、空追加或替换、无可见内容、无效图片、损坏的存储格式、非标题的小节目标或页面树循环。`gc` 发现任何分片缺失或损坏时中止，不删除资产。修正内容，保留损坏文件供恢复。 |

<!-- #endregion command-contract -->

<!-- #region response-examples -->

## 实际响应样例

### `list`

```json
{
  "ok": true,
  "data": {
    "activePageId": "ee1d824e-1ee6-4ca3-9df3-cd79a9798d82",
    "pages": [{"id": "ee1d824e-1ee6-4ca3-9df3-cd79a9798d82", "parentId": null, "title": "发布记录", "icon": "📝", "order": 0, "updatedAt": 1795592789650}],
    "indexEtag": "31af79f8671bee23fc240529d4de129d9ba2d0e1b96ea33579dd10aebd207b34"
  }
}
```

### `get（默认 Markdown）`

```json
{
  "ok": true,
  "data": {
    "page": {"id": "ee1d824e-1ee6-4ca3-9df3-cd79a9798d82", "parentId": null, "title": "发布记录", "icon": "📝", "order": 0, "updatedAt": 1795592789650},
    "etag": "6e366d8fbfc6f43ccb2b6c4e685051584e4a1478e9c920873a830f491e8efd9c",
    "indexEtag": "31af79f8671bee23fc240529d4de129d9ba2d0e1b96ea33579dd10aebd207b34",
    "format": "markdown",
    "content": "## 上线记录\n"
  }
}
```

### `get --format json`

```json
{
  "ok": true,
  "data": {
    "page": {"id": "ee1d824e-1ee6-4ca3-9df3-cd79a9798d82", "parentId": null, "title": "发布记录", "icon": "📝", "order": 0, "updatedAt": 1795592789650},
    "etag": "6e366d8fbfc6f43ccb2b6c4e685051584e4a1478e9c920873a830f491e8efd9c",
    "indexEtag": "31af79f8671bee23fc240529d4de129d9ba2d0e1b96ea33579dd10aebd207b34",
    "format": "json",
    "content": {"type": "doc", "content": [{"type": "heading", "attrs": {"blockBg": "default", "blockId": "3876c47c-556c-408a-a3d8-bc0d870f3662", "level": 2}, "content": [{"type": "text", "text": "上线记录"}]}]}
  }
}
```

### `create`

```json
{
  "ok": true,
  "data": {
    "page": {"id": "ee1d824e-1ee6-4ca3-9df3-cd79a9798d82", "parentId": null, "title": "发布记录", "icon": "📝", "order": 0, "updatedAt": 1795592789650},
    "etag": "6e366d8fbfc6f43ccb2b6c4e685051584e4a1478e9c920873a830f491e8efd9c",
    "indexEtag": "31af79f8671bee23fc240529d4de129d9ba2d0e1b96ea33579dd10aebd207b34"
  }
}
```

### `append`

```json
{
  "ok": true,
  "data": {
    "pageId": "ee1d824e-1ee6-4ca3-9df3-cd79a9798d82",
    "etag": "26855490a609943367a4c6e2dce37862c46c883873bf268da51a9e6bfeba0ad0",
    "indexEtag": "18316393bc3cdefd8d7dc3bd447750020cec1e406af6799d94115e48f531dd67"
  }
}
```

### `rename`

```json
{
  "ok": true,
  "data": {
    "pageId": "ee1d824e-1ee6-4ca3-9df3-cd79a9798d82",
    "title": "发布与回滚",
    "indexEtag": "2facfed2e10526a46b5e7218a7bbe954aa405cbc70f11f3ffe86b74ccb05c5a2"
  }
}
```

### `delete`

```json
{
  "ok": true,
  "data": {
    "removedPageIds": ["ee1d824e-1ee6-4ca3-9df3-cd79a9798d82"],
    "activePageId": "bec6266d-9ff3-43b2-b418-7b21466e8e6c",
    "indexEtag": "ceee60b9d0adb6ce54d58a3a440dd8cef78dd9bed68e756cc9f1e738e4bce569",
    "trashed": true
  }
}
```

`--permanent` 的响应把 `trashed` 设为 `false`，并物理删除分片。

### `outline`

```json
{
  "ok": true,
  "data": {
    "page": {"id": "ee1d824e-1ee6-4ca3-9df3-cd79a9798d82", "parentId": null, "title": "发布记录", "icon": "📝", "order": 0, "updatedAt": 1795592789650},
    "etag": "6e366d8fbfc6f43ccb2b6c4e685051584e4a1478e9c920873a830f491e8efd9c",
    "indexEtag": "31af79f8671bee23fc240529d4de129d9ba2d0e1b96ea33579dd10aebd207b34",
    "blockCount": 3,
    "outline": [{"blockId": "8d8a1d0e-7e7d-4d8a-9e03-53ac74fb7219", "level": 2, "text": "上线记录", "blockIndex": 0}],
    "blocks": [{"blockId": "8d8a1d0e-7e7d-4d8a-9e03-53ac74fb7219", "type": "heading", "preview": "上线记录"}]
  }
}
```

### `patch`

```json
{
  "ok": true,
  "data": {
    "pageId": "ee1d824e-1ee6-4ca3-9df3-cd79a9798d82",
    "operation": "replace-section",
    "targetBlockId": "8d8a1d0e-7e7d-4d8a-9e03-53ac74fb7219",
    "etag": "26855490a609943367a4c6e2dce37862c46c883873bf268da51a9e6bfeba0ad0",
    "indexEtag": "18316393bc3cdefd8d7dc3bd447750020cec1e406af6799d94115e48f531dd67"
  }
}
```

`patch --dry-run` 增加 `dryRun: true`，并返回替换前的两个标签。

### `comments` 与 `comment-reply`

```json
{
  "ok": true,
  "data": {
    "page": {"id": "ee1d824e-1ee6-4ca3-9df3-cd79a9798d82", "parentId": null, "title": "发布记录", "icon": "📝", "order": 0, "updatedAt": 1795592789650},
    "indexEtag": "31af79f8671bee23fc240529d4de129d9ba2d0e1b96ea33579dd10aebd207b34",
    "comments": [{"id": "0e38a55b-0e5e-4ec5-9417-dcc89b5fd6e1", "quote": "上线记录", "messages": [], "resolved": false}]
  }
}
```

```json
{
  "ok": true,
  "data": {
    "pageId": "ee1d824e-1ee6-4ca3-9df3-cd79a9798d82",
    "threadId": "0e38a55b-0e5e-4ec5-9417-dcc89b5fd6e1",
    "message": {"id": "cb59178d-9aa2-4a5f-babc-c71e49b8c621", "author": "AI", "text": "已处理，请复核。"},
    "resolved": true,
    "indexEtag": "18316393bc3cdefd8d7dc3bd447750020cec1e406af6799d94115e48f531dd67"
  }
}
```

### `trash-list` 与 `restore`

```json
{
  "ok": true,
  "data": {
    "trash": [{"id": "bec6266d-9ff3-43b2-b418-7b21466e8e6c", "parentId": null, "title": "旧备忘", "icon": "📄", "deletedAt": 1795592789650}],
    "indexEtag": "ceee60b9d0adb6ce54d58a3a440dd8cef78dd9bed68e756cc9f1e738e4bce569"
  }
}
```

```json
{
  "ok": true,
  "data": {
    "restoredPageIds": ["bec6266d-9ff3-43b2-b418-7b21466e8e6c"],
    "page": {"id": "bec6266d-9ff3-43b2-b418-7b21466e8e6c", "parentId": null, "title": "旧备忘", "icon": "📄", "order": 1, "updatedAt": 1795592789650},
    "indexEtag": "2facfed2e10526a46b5e7218a7bbe954aa405cbc70f11f3ffe86b74ccb05c5a2"
  }
}
```

### `move`

```json
{
  "ok": true,
  "data": {
    "pageId": "ee1d824e-1ee6-4ca3-9df3-cd79a9798d82",
    "parentId": "bec6266d-9ff3-43b2-b418-7b21466e8e6c",
    "order": 2,
    "indexEtag": "18316393bc3cdefd8d7dc3bd447750020cec1e406af6799d94115e48f531dd67"
  }
}
```

### `append --dry-run`

```json
{
  "ok": true,
  "data": {
    "dryRun": true,
    "pageId": "ee1d824e-1ee6-4ca3-9df3-cd79a9798d82",
    "etag": "6e366d8fbfc6f43ccb2b6c4e685051584e4a1478e9c920873a830f491e8efd9c",
    "indexEtag": "31af79f8671bee23fc240529d4de129d9ba2d0e1b96ea33579dd10aebd207b34"
  }
}
```

### `search`

```json
{
  "ok": true,
  "data": {
    "query": "发布",
    "matches": [
      {"page": {"id": "ee1d824e-1ee6-4ca3-9df3-cd79a9798d82", "parentId": null, "title": "发布记录", "icon": "📝", "order": 0, "updatedAt": 1795592789650}, "titleMatch": true, "snippets": []},
      {"page": {"id": "bec6266d-9ff3-43b2-b418-7b21466e8e6c", "parentId": null, "title": "备忘", "icon": "📄", "order": 1, "updatedAt": 1795592789650}, "titleMatch": false, "snippets": ["上线前完成发布清单。"]}
    ]
  }
}
```

### `update`

```json
{
  "ok": true,
  "data": {
    "pageId": "ee1d824e-1ee6-4ca3-9df3-cd79a9798d82",
    "etag": "26855490a609943367a4c6e2dce37862c46c883873bf268da51a9e6bfeba0ad0",
    "indexEtag": "18316393bc3cdefd8d7dc3bd447750020cec1e406af6799d94115e48f531dd67"
  }
}
```

`update --dry-run` 返回 `dryRun: true`，并带上替换前的 `etag` 和 `indexEtag`。

### `add-image`

```json
{
  "ok": true,
  "data": {
    "asset": {"id": "9f2c4d1e7a8b3c5d6e0f1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f.png", "mime": "image/png", "width": 1280, "height": 720, "byteLength": 48213, "name": "screenshot.png", "createdAt": 1795592789650},
    "markdown": "![](asset:9f2c4d1e7a8b3c5d6e0f1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f.png)",
    "created": true
  }
}
```

再次导入相同字节时 `created` 为 `false`。`--dry-run` 额外返回 `dryRun: true`，`asset` 不含 `createdAt`，且不写入 `assets/`。

### `gc`

```json
{
  "ok": true,
  "data": {
    "scannedPages": 3,
    "referencedCount": 2,
    "orphanIds": ["9f2c4d1e7a8b3c5d6e0f1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f.png"],
    "removedCount": 1,
    "reclaimedBytes": 48213
  }
}
```

`gc --dry-run` 仍列出 `orphanIds`，但 `removedCount` 和 `reclaimedBytes` 为 0。`scannedPages` 包含活页和回收站页面，`referencedCount` 是这些页面正文里实际引用的资产数。

未初始化的工作区可执行 `list`，返回 `{"ok":true,"data":{"activePageId":null,"pages":[],"indexEtag":null}}`。创建预演的 `page` 仍包含上述元数据，两个标签均为 `null`。未初始化的工作区执行 `search` 返回 `{"ok":true,"data":{"query":"…","matches":[]}}`。

页面标签过期时，stderr 的一行示例为

```json
{"ok":false,"error":{"code":"conflict","message":"页面 etag 已变化。","hint":"重新读取页面后使用新的 etag 重试。"}}
```

<!-- #endregion response-examples -->

<!-- #region markdown-extensions -->

## Markdown 扩展块

`[! ` 和 `>> ` 是**桌面编辑器的键入快捷键**，末尾都有一个空格。用于导入、导出和 CLI 输入的持久语法如下。

### Callout 和 Toggle

```markdown
> [!NOTE] 📌
> 这里写操作说明。

<details open>
<summary>回滚步骤</summary>

1. 恢复上一版。
2. 检查关键指标。

</details>
```

Callout 类型为 `NOTE`、`TIP`、`WARNING`、`CAUTION`、`IMPORTANT` 和 `INFO`。图标可省略。Toggle 使用 `<details open>` 表示展开，`<details>` 表示折叠。

### 多栏

```markdown
::::columns
:::column{width=60}
左栏
:::
:::column{width=40}
右栏
:::
::::
```

可编辑多栏最多五列。列宽归一化为百分比，导出可能规范化数值。

### Mermaid 和 KaTeX

````markdown
```mermaid
flowchart LR
  A[草稿] --> B[评审]
  B --> C[发布]
```

行内公式 $O(n \log n)$。

$$
\sum_{i=1}^{n} i = \frac{n(n+1)}{2}
$$
````

块公式也接受 `math` 围栏。CLI 读写源码，预览与语法错误提示由编辑器提供。

### 图片与本地资产

```markdown
![发布流程](https://example.com/release.png)
![本地截图](asset:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef.png)
```

用 `aiblock-doc add-image <file>` 导入本地图片。支持 PNG、JPEG、GIF 和 WebP，按文件头识别格式与尺寸，单文件上限 32 MiB。文件按字节的 SHA-256 去重，写入 `<workspace>/assets/<sha256>.<ext>`，元数据写入同名 `.json`。返回的 `markdown` 可以直接交给 `create`、`update` 或 `append`：

```sh
aiblock-doc add-image screenshot.png
printf '## 截图\n\n%s\n' '![](asset:<id>)' |
  aiblock-doc append "$page_id" --if-match "$etag" --markdown -
```

`add-image --dry-run` 只校验文件并计算确定性元数据，不创建 `assets/`。图片文件不存在退出 3；格式、尺寸或大小不合法退出 5。`asset:` 引用只在同一工作区有效，把 Markdown 交给另一个工作区时需要一并复制 `assets/`。本地资产 ID 必须已存在。Markdown 引用只存地址。编辑器支持用 `<img>` 保留宽高、展示宽度和对齐。纯 Node CLI 的 Markdown 导入缺少 DOM，该 HTML 图片分支会跳过图片。CLI 输入用 `![…](…)`，检查原生图像布局用 `get --format json`。

`gc` 在锁内读取活页和回收站的全部分片，任何分片缺失、JSON 损坏或文档不符合 schema 都会中止，且不删除资产。默认保留 5 分钟内新写入的未引用资产，避免与正在进行的保存竞争。

Markdown 保留这里列出的块和文本标记。评论、块 ID 等内部字段在 Markdown 中省略，导出也可能规范化语法。`get --format json` 的 `content` 是正文对象，评论线程仍在工作区索引中。

<!-- #endregion markdown-extensions -->

## Electron 热同步和冲突

<!-- #region desktop-sync -->

CLI 与桌面端共用磁盘写锁。两种标签分别是正文分片与工作区索引字节的 SHA-256。CLI 在持锁期间比较当前标签，再提交分片。索引与单页文件分别原子替换。桌面主进程对目录变动做 150 ms 防抖检测，并在窗口获得焦点时再检查一次。

没有本地待写状态时，界面重读外部数据。CLI 的 `--activate` 随索引生效。`comments` 和 `comment-reply` 直接修改索引中的评论，`move`、`trash-list`、`restore` 与默认软删也只改动索引，桌面端会感知索引变化。若界面还有防抖草稿、脏页、脏索引或正在保存，收到外部变更会显示冲突，即使两次操作涉及不同页。冲突时先把需要保留的编辑复制出来，再在桌面端选择 **从磁盘重载** 或 **用本地覆盖保存**。前者丢弃未保存编辑，后者可覆盖外部版本。

CLI 遇到退出码 4 时先重读，再检查原操作是否仍然合适。追加、整页替换或局部 `patch` 前重读目标页的 `etag`。改名、移动、软删、恢复和评论回复重读索引的 `indexEtag`，删除还要核对后代。一次命令意外退出时先检查磁盘结果，以免重复追加或替换。保留锁文件，由 CLI 与桌面程序管理。

<!-- #endregion desktop-sync -->
