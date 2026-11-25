import { mkdirSync, watch } from 'node:fs'
import type { FSWatcher } from 'node:fs'
import type { WorkspaceExternalChange } from '../src/workspace/workspace-format.js'
import type { WorkspaceFiles } from '../src/workspace/workspace-files.js'

export interface WorkspaceWatcher {
  refresh(): void
  close(): void
}

const ignored = /(?:^|\/)(?:\.lock|[^/]+\.tmp)$/

export function watchWorkspace(
  files: WorkspaceFiles,
  onChange: (change: WorkspaceExternalChange) => void,
  debounceMs = 150,
): WorkspaceWatcher {
  let timer: ReturnType<typeof setTimeout> | undefined
  let closed = false
  let running = false
  let again = false
  let watcher: FSWatcher | undefined

  async function scan() {
    if (closed) return
    if (running) {
      again = true
      return
    }
    running = true
    try {
      const change = await files.detectExternalChanges()
      if (!closed && (change.indexChanged || change.pageIds.length)) onChange(change)
    } catch (error) {
      console.error(error)
    } finally {
      running = false
      if (again) {
        again = false
        schedule()
      }
    }
  }

  function schedule() {
    if (closed) return
    clearTimeout(timer)
    timer = setTimeout(() => { void scan() }, debounceMs)
  }

  try {
    mkdirSync(files.directory, { recursive: true })
    watcher = watch(files.directory, { recursive: true }, (_event, filename) => {
      if (filename && ignored.test(String(filename).replaceAll('\\', '/'))) return
      schedule()
    })
  } catch (error) {
    console.error(error)
  }

  return {
    refresh: schedule,
    close() {
      closed = true
      clearTimeout(timer)
      watcher?.close()
    },
  }
}
