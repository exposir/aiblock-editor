import { appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { inspect } from 'node:util'

const maxLogBytes = 1024 * 1024
const maxDetailLength = 16_384

export function createMainLogger(userData: string) {
  const directory = join(userData, 'logs')
  const path = join(directory, 'main.log')

  function write(level: 'info' | 'warn' | 'error', context: string, detail?: unknown) {
    try {
      const description = detail instanceof Error ? detail.stack ?? detail.message
        : typeof detail === 'string' ? detail
        : detail === undefined ? undefined
        : inspect(detail, { depth: 2, maxArrayLength: 20, maxStringLength: maxDetailLength, customInspect: false })
      const line = JSON.stringify({
        timestamp: new Date().toISOString(), level, context: context.slice(0, 256),
        detail: description?.slice(0, maxDetailLength),
      }) + '\n'
      mkdirSync(directory, { recursive: true, mode: 0o700 })
      const current = statSync(path, { throwIfNoEntry: false })?.size ?? 0
      if (current && current + Buffer.byteLength(line) > maxLogBytes) renameSync(path, path + '.1')
      appendFileSync(path, line, { mode: 0o600 })
    } catch {
      try { console.error(context, detail) } catch { /* Logging must never interrupt recovery. */ }
    }
  }

  return { directory, write }
}

interface RendererExit {
  readonly reason: string
  readonly exitCode: number
}

interface RecoveryActions {
  available(): boolean
  prompt(repeated: boolean): Promise<'reload' | 'logs' | 'quit'>
  openLogs(): Promise<void>
  reload(): void
  quit(): void
}

export function createRendererRecovery(
  logger: Pick<ReturnType<typeof createMainLogger>, 'write'>,
  actions: RecoveryActions,
  now = () => performance.now(),
) {
  let lastCrash = -Infinity
  let prompting = false

  return async (exit: RendererExit) => {
    const clean = exit.reason === 'clean-exit'
    logger.write(clean ? 'info' : 'error', 'render-process-gone', exit)
    if (clean) return

    const time = now()
    const repeated = time - lastCrash <= 10_000
    lastCrash = time
    if (prompting || !actions.available()) return

    prompting = true
    try {
      while (actions.available()) {
        const choice = await actions.prompt(repeated)
        if (!actions.available()) return
        if (choice === 'logs') {
          await actions.openLogs()
          continue
        }
        if (choice === 'reload') actions.reload()
        else actions.quit()
        return
      }
    } finally {
      prompting = false
    }
  }
}
