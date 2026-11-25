export type CliErrorCode =
  | 'io_error' | 'usage' | 'not_found' | 'conflict' | 'invalid_content' | 'workspace_error'

export class CliError extends Error {
  readonly exitCode: number
  readonly code: CliErrorCode
  readonly hint: string

  constructor(code: CliErrorCode, message: string, hint = '', exitCode?: number) {
    super(message)
    this.name = 'CliError'
    this.code = code
    this.hint = hint
    this.exitCode = exitCode ?? {
      io_error: 1,
      usage: 2,
      not_found: 3,
      conflict: 4,
      invalid_content: 5,
      workspace_error: 1,
    }[code]
  }
}

export function usageError(message: string, hint = '运行 aiblock-doc --help 查看用法。') {
  return new CliError('usage', message, hint)
}

export function notFoundError(message: string, hint = '先用 aiblock-doc list 获取页面 ID。') {
  return new CliError('not_found', message, hint)
}

export function conflictError(message: string, hint = '重新读取页面后使用新的 etag 重试。') {
  return new CliError('conflict', message, hint)
}

export function contentError(message: string, hint = '检查 Markdown 或页面内容后重试。') {
  return new CliError('invalid_content', message, hint)
}
