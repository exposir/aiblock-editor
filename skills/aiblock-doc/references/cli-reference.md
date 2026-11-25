# aiblock-doc CLI 参考

CLI 操作本地 Electron v2 工作区。运行 `aiblock-doc --help` 查看当前二进制的用法。以下 JSON 来自同一个隔离工作区的一次实际运行，示例中的 UUID、时间和标签只能用于理解输出。实际调用总是读取当前工作区的值。

<!-- #region command-contract -->

## 命令与参数

| 命令 | 参数与默认行为 | 成功返回的 `data` |
| --- | --- | --- |
| `list` | 无位置参数。读取索引，返回存储顺序的平面列表，可用 `parentId` 和同级 `order` 组树。 | `activePageId`、`pages`、`indexEtag` |
| `get <id>` | UUID。可选 `--format markdown\|json`，默认 `markdown`。 | `page`、`etag`、`indexEtag`、`format`、`content` |
| `create --title <title>` | `--parent <id>` 默认根页，`--icon <emoji>` 默认 `📄`，`--markdown -\|<file>` 默认空页。`--activate` 默认关闭。 | `page`、`etag`、`indexEtag` |
| `append <id> --if-match <etag>` | 使用页面 `etag` 追加非空 Markdown。`--markdown -\|<file>` 省略时读 stdin。 | `pageId`、`etag`、`indexEtag` |
| `rename <id> --title <title> --if-match <indexEtag>` | 使用索引 `indexEtag` 更新标题，正文分片保持原样。 | `pageId`、`title`、`indexEtag` |
| `delete <id> --if-match <indexEtag>` | 使用索引 `indexEtag` 删除整棵子树。删光时补一个空白根页。 | `removedPageIds`、`activePageId`、`indexEtag` |

`page` 和 `pages[]` 的元数据包含 `id`、`parentId`、`title`、`icon`、`order`、`updatedAt`。时间戳单位为 Unix 毫秒，根页的 `parentId` 为 `null`。标题去除首尾空白，空标题报错。图标为空白时回退到 `📄`。

`--workspace <dir>` 优先于 `$AIBLOCK_WORKSPACE`，两者缺省时自动使用系统默认的桌面工作区。macOS 的默认路径是 `~/Library/Application Support/aiblock-editor/workspace`。Windows 使用 `%APPDATA%\aiblock-editor\workspace`，缺少 `APPDATA` 时使用用户目录下的 `AppData\Roaming`。Linux 使用 `$XDG_CONFIG_HOME/aiblock-editor/workspace`，缺少变量时使用 `~/.config`。相对路径以命令的执行目录为准。给已有旧桌面工作区写入前，先用 `list` 打开它。读取索引时会尝试把有效的旧 `workspace.json` 迁移为 v2。

`--markdown -` 显式走 stdin，文件输入按 UTF-8 读取，路径相对于执行目录。`append` 在交互终端且无输入时返回参数错误。创建已有工作区的页面时，只有 `--activate` 会切换活动页，首次创建自动激活。若删除当前活动页，CLI 优先选择目标节点的后一个同级页，其次是前一个同级页、父页或首个剩余页。

`--dry-run` 校验写命令并预演结果，正文和索引保持原样。它会短暂持有文件锁，工作区目录尚不存在时可能被创建。`create` 预演返回 `dryRun: true` 和临时 `page`，两个标签为 `null`。其他预演增加 `dryRun: true` 并返回当前标签。预演删除末页时生成的替补 ID 仅供查看。`list` 和 `get` 接受该选项但执行正常读取。

## JSON 信封与退出码

正常数据响应是一行 stdout JSON `{"ok":true,"data":{...}}`。失败是一行 stderr JSON `{"ok":false,"error":{"code":"...","message":"...","hint":"..."}}`，`hint` 可以为空。`--help` 和 `-h` 在 stdout 输出纯文本并退出 0。省略命令同样输出纯文本帮助并退出 2。通过包管理器调用时，包管理器可能在 stderr 添加日志。

| 退出码 | `error.code` | 含义与处理 |
| --- | --- | --- |
| 0 | 空 | 成功。读取 `data`。 |
| 1 | `io_error` | 读取、写入或其他运行错误。核对路径和权限。 |
| 1 | `workspace_error` | 错误类型已预留。当前命令通常以 `io_error` 报告 I/O 问题。 |
| 2 | `usage` | 未知命令、缺少参数、非法 UUID 或非法格式选项。用 `--help` 核对。 |
| 3 | `not_found` | 缺少工作区、页面或父页。重新列出页面。 |
| 4 | `conflict` | 页面或索引标签过期、磁盘变化或锁竞争。重读对应数据后确认再试。 |
| 5 | `invalid_content` | 空标题、空追加、无效文档或损坏的存储格式。修正内容，保留损坏文件供恢复。 |

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
    "indexEtag": "ceee60b9d0adb6ce54d58a3a440dd8cef78dd9bed68e756cc9f1e738e4bce569"
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

未初始化的工作区可执行 `list`，返回 `{"ok":true,"data":{"activePageId":null,"pages":[],"indexEtag":null}}`。创建预演的 `page` 仍包含上述元数据，两个标签均为 `null`。

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

### 图片

```markdown
![发布流程](https://example.com/release.png)
![本地截图](asset:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef.png)
```

本地资产 ID 必须已存在于同一个工作区。Markdown 引用只存地址。CLI 当前没有上传图片命令。编辑器支持用 `<img>` 保留宽高、展示宽度和对齐。纯 Node CLI 的 Markdown 导入缺少 DOM，该 HTML 图片分支会跳过图片。CLI 输入用 `![…](…)`，检查原生图像布局用 `get --format json`。

Markdown 保留这里列出的块和文本标记。评论、块 ID 等内部字段在 Markdown 中省略，导出也可能规范化语法。`get --format json` 的 `content` 是正文对象，评论线程仍在工作区索引中。

<!-- #endregion markdown-extensions -->

## Electron 热同步和冲突

<!-- #region desktop-sync -->

CLI 与桌面端共用磁盘写锁。两种标签分别是正文分片与工作区索引字节的 SHA-256。CLI 在持锁期间比较当前标签，再提交分片。索引与单页文件分别原子替换。桌面主进程对目录变动做 150 ms 防抖检测，并在窗口获得焦点时再检查一次。

没有本地待写状态时，界面重读外部数据。CLI 的 `--activate` 随索引生效。若界面还有防抖草稿、脏页、脏索引或正在保存，收到外部变更会显示冲突，即使两次操作涉及不同页。冲突时先把需要保留的编辑复制出来，再在桌面端选择 **从磁盘重载** 或 **用本地覆盖保存**。前者丢弃未保存编辑，后者可覆盖外部版本。

CLI 遇到退出码 4 时先重读，再检查原操作是否仍然合适。追加重读目标页的 `etag`。改名或删除重读索引的 `indexEtag`，删除还要核对后代。一次命令意外退出时先检查磁盘结果，以免重复追加。保留锁文件，由 CLI 与桌面程序管理。

<!-- #endregion desktop-sync -->
