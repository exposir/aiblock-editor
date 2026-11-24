import type { Schema } from '@tiptap/pm/model'
import { useCallback, useEffect, useRef, useState } from 'react'
import { DEMO_HANDBOOK_ID, createDemoWorkspace } from './demo-workspace'
import { activatePage, clearWorkspace, findPage, formatPageHash, loadWorkspace, parseLegacyBlockHash, parsePageHash, saveWorkspace } from './page-store'
import type { PageIdentity, WorkspaceState } from './page-store'

const SAVE_DELAY = 350

function localStorageOrNull(): Storage | null {
  try { return window.localStorage } catch { return null }
}

export function newPageIdentity(): PageIdentity {
  const now = Date.now()
  if (typeof crypto.randomUUID === 'function') return { id: crypto.randomUUID(), now }
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6]! & 0x0f) | 0x40
  bytes[8] = (bytes[8]! & 0x3f) | 0x80
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
  const id = [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join('-')
  return { id, now }
}

function fromLocation(workspace: WorkspaceState) {
  const hash = window.location.hash
  const legacyBlockId = parseLegacyBlockHash(hash)
  const { pageId, blockId } = legacyBlockId
    ? { pageId: DEMO_HANDBOOK_ID, blockId: legacyBlockId }
    : parsePageHash(hash)
  return pageId && findPage(workspace, pageId)
    ? { workspace: activatePage(workspace, pageId), anchor: blockId ? { id: blockId } : null }
    : { workspace, anchor: null }
}

function syncLocation(pageId: string, blockId: string | null, mode: 'push' | 'replace') {
  const hash = formatPageHash(pageId, blockId)
  if (window.location.hash === hash) return
  if (mode === 'push') window.history.pushState(window.history.state, '', hash)
  else window.history.replaceState(window.history.state, '', hash)
}

export function useWorkspace(schema: Schema) {
  const [storage] = useState(localStorageOrNull)
  const [snapshot, setSnapshot] = useState(() => ({
    ...fromLocation(loadWorkspace(storage, schema, () => createDemoWorkspace(schema))),
    revision: 0,
  }))
  const [saveFailed, setSaveFailed] = useState(false)
  const current = useRef(snapshot)
  const pending = useRef(true)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const flush = useCallback(() => {
    clearTimeout(timer.current)
    if (!pending.current) return
    pending.current = !saveWorkspace(storage, current.current.workspace)
    setSaveFailed(pending.current)
  }, [storage])

  const publish = useCallback((next: typeof snapshot, deferred = false) => {
    pending.current ||= next.workspace !== current.current.workspace
    current.current = next
    setSnapshot(next)
    clearTimeout(timer.current)
    if (deferred) timer.current = setTimeout(flush, SAVE_DELAY)
    else flush()
  }, [flush])

  useEffect(() => {
    function followLocation() {
      const previous = current.current
      const next = fromLocation(previous.workspace)
      syncLocation(next.workspace.activePageId, next.anchor?.id ?? null, 'replace')
      if (next.workspace !== previous.workspace || next.anchor !== previous.anchor) {
        publish({ ...previous, ...next })
      }
    }
    function onVisibilityChange() {
      if (document.visibilityState === 'hidden') flush()
    }
    const restoration = history.scrollRestoration
    history.scrollRestoration = 'manual'
    syncLocation(current.current.workspace.activePageId, current.current.anchor?.id ?? null, 'replace')
    flush()
    window.addEventListener('hashchange', followLocation)
    window.addEventListener('pagehide', flush)
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      history.scrollRestoration = restoration
      window.removeEventListener('hashchange', followLocation)
      window.removeEventListener('pagehide', flush)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      clearTimeout(timer.current)
    }
  }, [flush, publish])

  function change(transform: (workspace: WorkspaceState) => WorkspaceState, deferred = false) {
    const previous = current.current
    if (snapshot.revision !== previous.revision) return
    const workspace = transform(previous.workspace)
    if (workspace === previous.workspace) return
    const switched = workspace.activePageId !== previous.workspace.activePageId
    publish({ ...previous, workspace, anchor: switched ? null : previous.anchor }, deferred && !switched)
    if (switched) syncLocation(workspace.activePageId, null, 'push')
  }

  function reset() {
    const workspace = createDemoWorkspace(schema)
    clearWorkspace(storage)
    publish({ workspace, anchor: null, revision: current.current.revision + 1 })
    syncLocation(workspace.activePageId, null, 'replace')
  }

  return { ...snapshot, saveFailed, change, reset }
}
