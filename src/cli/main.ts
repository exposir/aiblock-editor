import { resolve } from 'node:path'
import { assetGraceMs } from '../workspace/asset-gc'
import { isPageId } from '../workspace/workspace-format'
import { WorkspaceConflictError, WorkspaceLockedError } from '../workspace/workspace-files'
import { allowedFlags, parseArguments, required } from './args'
import { CliError, conflictError, usageError } from './errors'
import {
  addImageAsset, appendPage, collectGarbage, createPage, deletePage, getPage, listPages, openCliWorkspace,
  readMarkdownInput, renamePage, resolveWorkspacePath, searchPages, updatePage,
} from './workspace'

export interface CliIO {
  stdout(text: string): void
  stderr(text: string): void
  stdin?: string
  cwd?: string
}

const helpText = `aiblock-doc — 操作本地 aiblock-editor 桌面工作区

用法:
  aiblock-doc list
  aiblock-doc get <page-id> [--format markdown|json]
  aiblock-doc search <query> [--limit <n>]
  aiblock-doc create --title <title> [--parent <page-id>] [--icon <emoji>] [--markdown -|<file>] [--activate]
  aiblock-doc append <page-id> --if-match <etag> [--markdown -|<file>]
  aiblock-doc update <page-id> --if-match <etag> [--markdown -|<file>]
  aiblock-doc rename <page-id> --title <title> --if-match <index-etag>
  aiblock-doc delete <page-id> --if-match <index-etag>
  aiblock-doc add-image <file>
  aiblock-doc gc [--grace-ms <n>]

全局参数:
  --workspace <dir>   工作区目录（含 index.json）；默认 Electron userData/workspace
  --dry-run           只校验和预览写入，不落盘
  --help, -h          显示本帮助

输出:
  成功: stdout 输出 {"ok":true,"data":...}
  失败: stderr 输出 {"ok":false,"error":{code,message,hint}}
  退出码: 0 成功, 1 I/O/未知, 2 参数, 3 页面/文件不存在, 4 版本冲突, 5 内容/格式

示例:
  AIBLOCK_WORKSPACE=~/Library/Application\\ Support/aiblock-editor/workspace aiblock-doc list
  aiblock-doc search '发布计划' --limit 5
  aiblock-doc get 430e9296-6acb-4b74-84c3-a4bd05a20701
  printf '# 会议记录\\n\\n- 结论\\n' | aiblock-doc create --title '会议记录' --markdown - --activate
  aiblock-doc append <page-id> --if-match <etag> --markdown notes.md
  aiblock-doc update <page-id> --if-match <etag> --markdown rewritten.md --dry-run
  aiblock-doc add-image screenshot.png
  aiblock-doc gc --grace-ms 0 --dry-run
`

function defaultIO(): CliIO {
  return {
    stdout: text => process.stdout.write(text),
    stderr: text => process.stderr.write(text),
  }
}

function writeSuccess(io: CliIO, data: unknown) {
  io.stdout(JSON.stringify({ ok: true, data }) + '\n')
}

function writeFailure(io: CliIO, error: CliError) {
  io.stderr(JSON.stringify({
    ok: false,
    error: { code: error.code, message: error.message, hint: error.hint },
  }) + '\n')
}

async function stdinText(io: CliIO) {
  if (io.stdin !== undefined) return io.stdin
  if (process.stdin.isTTY) throw usageError('缺少 Markdown 内容。', '通过 --markdown - 从 stdin 传入，或 --markdown <file>。')
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  return Buffer.concat(chunks).toString('utf8')
}

function onePage(args: ReturnType<typeof parseArguments>) {
  if (args.positionals.length !== 1) throw usageError('需要一个页面 ID。')
  const id = args.positionals[0]!
  if (!isPageId(id)) throw usageError(`页面 ID 无效：${id}`)
  return id
}

function noPages(args: ReturnType<typeof parseArguments>) {
  if (args.positionals.length) throw usageError('该命令不接受位置参数。')
}

function integerOption(value: string | undefined, name: string, fallback: number, minimum: number) {
  if (value === undefined) return fallback
  const parsed = /^[0-9]+$/.test(value) ? Number(value) : Number.NaN
  if (!Number.isSafeInteger(parsed) || parsed < minimum) {
    throw usageError(`--${name} 必须是大于等于 ${minimum} 的整数。`)
  }
  return parsed
}

function imageFile(args: ReturnType<typeof parseArguments>) {
  if (args.positionals.length !== 1) throw usageError('需要一个图片文件路径。')
  return args.positionals[0]!
}

function workspaceFrom(args: ReturnType<typeof parseArguments>) {
  return openCliWorkspace(resolveWorkspacePath(args.values.get('workspace')))
}

function mapError(error: unknown): CliError {
  if (error instanceof CliError) return error
  if (error instanceof WorkspaceConflictError) {
    return conflictError(`磁盘内容已变化：${error.files.join(', ') || '工作区'}。`, '重新读取后使用新的 etag 重试。')
  }
  if (error instanceof WorkspaceLockedError) {
    return conflictError('工作区正被另一个写入方占用。', '稍后重试；不要删除锁文件。')
  }
  if (error instanceof TypeError || error instanceof SyntaxError) {
    return new CliError('invalid_content', error.message, '检查输入内容和参数。')
  }
  if (error instanceof Error && /^(?:Cannot check assets|Invalid (?:page|workspace|stored)|Stored file)/.test(error.message)) {
    return new CliError('invalid_content', error.message, '工作区或页面内容损坏，请检查对应 JSON 文件。')
  }
  return new CliError('io_error', error instanceof Error ? error.message : '未知错误。', '检查工作区路径和文件权限。')
}

export async function runCli(argv: readonly string[], io: CliIO = defaultIO()): Promise<number> {
  try {
    const args = parseArguments(argv)
    if (args.help) {
      io.stdout(helpText)
      return 0
    }
    if (!args.command) {
      io.stdout(helpText)
      return 2
    }
    const workspace = (values: string[] = [], flags: string[] = []) => {
      allowedFlags(args, ['workspace', ...values], flags)
      return workspaceFrom(args)
    }
    switch (args.command) {
      case 'list':
        noPages(args)
        writeSuccess(io, await listPages(workspace()))
        return 0
      case 'get': {
        const id = onePage(args)
        const format = args.values.get('format') ?? 'markdown'
        if (format !== 'markdown' && format !== 'json') throw usageError('--format 仅支持 markdown 或 json。')
        writeSuccess(io, await getPage(workspace(['format']), id, format))
        return 0
      }
      case 'search': {
        if (args.positionals.length !== 1) throw usageError('需要一个搜索关键词。')
        const query = args.positionals[0]!.trim()
        if (!query) throw usageError('搜索关键词不能为空。')
        const limit = integerOption(args.values.get('limit'), 'limit', 20, 1)
        writeSuccess(io, await searchPages(workspace(['limit']), query, limit))
        return 0
      }
      case 'create': {
        noPages(args)
        const title = required(args, 'title')
        const parent = args.values.get('parent')
        if (parent !== undefined && !isPageId(parent)) throw usageError(`父页面 ID 无效：${parent}`)
        const files = workspace(['title', 'parent', 'icon', 'markdown'], ['activate'])
        const markdown = await readMarkdownInput(args.values.get('markdown'), {
          required: false,
          readStdin: () => stdinText(io),
          cwd: io.cwd ?? process.cwd(),
        })
        writeSuccess(io, await createPage(files, {
          title,
          parentId: parent ?? null,
          icon: args.values.get('icon') ?? '📄',
          markdown,
          activate: args.flags.has('activate'),
          dryRun: args.flags.has('dry-run'),
        }))
        return 0
      }
      case 'append': {
        const id = onePage(args)
        const ifMatch = required(args, 'if-match')
        const files = workspace(['if-match', 'markdown'])
        const markdown = await readMarkdownInput(args.values.get('markdown'), {
          required: true,
          readStdin: () => stdinText(io),
          cwd: io.cwd ?? process.cwd(),
        })
        writeSuccess(io, await appendPage(files, id, {
          ifMatch,
          markdown: markdown ?? '',
          dryRun: args.flags.has('dry-run'),
        }))
        return 0
      }
      case 'update': {
        const id = onePage(args)
        const ifMatch = required(args, 'if-match')
        const files = workspace(['if-match', 'markdown'])
        const markdown = await readMarkdownInput(args.values.get('markdown'), {
          required: true,
          readStdin: () => stdinText(io),
          cwd: io.cwd ?? process.cwd(),
        })
        writeSuccess(io, await updatePage(files, id, {
          ifMatch,
          markdown: markdown ?? '',
          dryRun: args.flags.has('dry-run'),
        }))
        return 0
      }
      case 'rename': {
        const id = onePage(args)
        const title = required(args, 'title')
        const ifMatch = required(args, 'if-match')
        writeSuccess(io, await renamePage(workspace(['title', 'if-match']), id, {
          title,
          ifMatch,
          dryRun: args.flags.has('dry-run'),
        }))
        return 0
      }
      case 'delete': {
        const id = onePage(args)
        const ifMatch = required(args, 'if-match')
        writeSuccess(io, await deletePage(workspace(['if-match']), id, {
          ifMatch,
          dryRun: args.flags.has('dry-run'),
        }))
        return 0
      }
      case 'add-image': {
        const file = imageFile(args)
        const target = resolve(io.cwd ?? process.cwd(), file)
        writeSuccess(io, await addImageAsset(workspace(), target, args.flags.has('dry-run')))
        return 0
      }
      case 'gc': {
        noPages(args)
        const graceMs = integerOption(args.values.get('grace-ms'), 'grace-ms', assetGraceMs, 0)
        writeSuccess(io, await collectGarbage(workspace(['grace-ms']), {
          graceMs,
          dryRun: args.flags.has('dry-run'),
        }))
        return 0
      }
      default:
        throw usageError(`未知命令：${args.command}`)
    }
  } catch (error) {
    const mapped = mapError(error)
    writeFailure(io, mapped)
    return mapped.exitCode
  }
}


