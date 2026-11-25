import type { JSONContent } from '@tiptap/core'
import type { Schema } from '@tiptap/pm/model'
import { useCallback, useEffect, useRef, useState } from 'react'
import { browserWorkspaceStorage } from '../desktop/bridge'
import type { WorkspacePersistence } from '../desktop/bridge'
import { DEMO_HANDBOOK_ID, createDemoWorkspace, upgradeDemoWorkspace } from './demo-workspace'
import { WORKSPACE_STORAGE_KEY, activatePage, findPage, formatPageHash, parseLegacyBlockHash, parsePageHash, restoreWorkspace, updatePage } from './page-store'
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

export function useWorkspace(schema: Schema, persistence?: WorkspacePersistence) {
  const [storage] = useState(() => persistence ?? browserWorkspaceStorage(localStorageOrNull(), WORKSPACE_STORAGE_KEY))
  const [snapshot, setSnapshot] = useState(() => {
    const workspace = restoreWorkspace(storage.read(), schema, () => createDemoWorkspace(schema))
    return { ...fromLocation(upgradeDemoWorkspace(schema, workspace)), revision: 0 }
  })
  const [saveFailed, setSaveFailed] = useState(false)
  const current = useRef(snapshot)
  const pending = useRef(true)
  const draft = useRef<{ id: string; read: () => JSONContent; updatedAt: number } | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const inFlight = useRef<Promise<void> | undefined>(undefined)

  const collect = useCallback(() => {
    const previous = current.current
    const editing = draft.current
    if (!editing) return previous
    const workspace = updatePage(previous.workspace, editing.id, { content: editing.read() }, editing.updatedAt)
    draft.current = null
    return { ...previous, workspace }
  }, [])

  const flush = useCallback(() => {
    clearTimeout(timer.current)
    const next = collect()
    if (next !== current.current) {
      current.current = next
      setSnapshot(next)
    }
    if (!pending.current) return inFlight.current
    pending.current = false
    const result = storage.write(JSON.stringify(current.current.workspace))
    if (typeof result === 'boolean') {
      pending.current = !result
      setSaveFailed(!result)
      return
    }

    function finish(saved: boolean) {
      if (inFlight.current !== attempt) return
      inFlight.current = undefined
      pending.current ||= !saved
      setSaveFailed(!saved)
    }
    const attempt = result.then(() => finish(true), () => finish(false))
    inFlight.current = attempt
    return attempt
  }, [collect, storage])

  const stageContent = useCallback((id: string, read: () => JSONContent) => {
    if (current.current.revision !== snapshot.revision || current.current.workspace.activePageId !== id) return
    draft.current = { id, read, updatedAt: Date.now() }
    pending.current = true
    clearTimeout(timer.current)
    timer.current = setTimeout(flush, SAVE_DELAY)
  }, [flush, snapshot.revision])

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
      const previous = collect()
      const next = fromLocation(previous.workspace)
      syncLocation(next.workspace.activePageId, next.anchor?.id ?? null, 'replace')
      if (next.workspace !== current.current.workspace || next.anchor !== previous.anchor) {
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
    const unsubscribe = storage.onClosing?.(flush)
    window.addEventListener('hashchange', followLocation)
    window.addEventListener('pagehide', flush)
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      unsubscribe?.()
      history.scrollRestoration = restoration
      window.removeEventListener('hashchange', followLocation)
      window.removeEventListener('pagehide', flush)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      clearTimeout(timer.current)
    }
  }, [collect, flush, publish, storage])

  function change(transform: (workspace: WorkspaceState) => WorkspaceState, deferred = false) {
    if (snapshot.revision !== current.current.revision) return
    const previous = collect()
    let workspace = previous.workspace
    try {
      workspace = transform(workspace)
    } catch (error) {
      if (previous !== current.current) publish(previous, true)
      throw error
    }
    if (workspace === current.current.workspace) return
    const switched = workspace.activePageId !== previous.workspace.activePageId
    publish({ ...previous, workspace, anchor: switched ? null : previous.anchor }, deferred && !switched)
    if (switched) syncLocation(workspace.activePageId, null, 'push')
  }

  function reset() {
    const workspace = createDemoWorkspace(schema)
    draft.current = null
    storage.clear()
    publish({ workspace, anchor: null, revision: current.current.revision + 1 })
    syncLocation(workspace.activePageId, null, 'replace')
  }

  return { ...snapshot, saveFailed, change, reset, stageContent }
}
