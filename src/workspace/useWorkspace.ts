import { hasUnsavedImages, imageUploadFailures, recordImageReferences, resetImageUploads, waitForImageUploads } from '../editor/extensions/image-assets'
import { withDeadline } from './deadline'
import { finishImageTransfers, hasPendingImageTransfers } from '../editor/extensions/image-block'
import type { JSONContent } from '@tiptap/core'
import type { Schema } from '@tiptap/pm/model'
import { useCallback, useEffect, useRef, useState } from 'react'
import { browserWorkspaceStorage } from './workspace-storage'
import { activeBrowserAssetIds } from './asset-store'
import { DEMO_HANDBOOK_ID, createDemoWorkspace, upgradeDemoWorkspace } from './demo-workspace'
import { activatePage, checkedPageContent, emptyTrash, findPage, formatPageHash, parseLegacyBlockHash, parsePageHash, purgeTrashedPage, updatePage } from './page-store'
import type { PageIdentity, PageRecord, WorkspacePage, WorkspaceState } from './page-store'
import { isPageId, pageMetadata } from './workspace-format'
import type {
  PageShard, WorkspaceCloseResult, WorkspaceExternalChange, WorkspaceIndex, WorkspacePersistence,
} from './workspace-format'

const SAVE_DELAY = 350
export const imageCloseGrace = 4500

export interface WorkspaceConflict {
  readonly files: readonly string[]
  readonly locked: boolean
}

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

function fromLocation(workspace: Pages) {
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

type Pages = WorkspaceState<WorkspacePage>

interface Snapshot {
  workspace: Pages
  anchor: { id: string } | null
  revision: number
}

function withActiveContent(workspace: Pages, content: JSONContent | undefined): Pages {
  return {
    ...workspace,
    pages: workspace.pages.map(page => {
      if (page.id === workspace.activePageId && content) {
        return page.content === content ? page : { ...page, content }
      }
      return page.content ? pageMetadata(page) : page
    }),
  }
}

function sameDocument(schema: Schema, left: JSONContent | undefined, right: JSONContent | undefined) {
  if (left === right) return true
  if (!left || !right) return false
  try {
    return schema.nodeFromJSON(left).eq(schema.nodeFromJSON(right))
  } catch {
    return false
  }
}

function workspaceConflict(error: unknown): WorkspaceConflict | null {
  if (!error || typeof error !== 'object') return null
  const value = error as { name?: unknown; code?: unknown; files?: unknown }
  if (value.name !== 'WorkspaceConflictError' && value.code !== 'workspace-conflict') return null
  return { files: Array.isArray(value.files) ? value.files.filter((file): file is string => typeof file === 'string') : [], locked: false }
}

export function useWorkspace(schema: Schema, persistence?: WorkspacePersistence) {
  const [storage] = useState(() => persistence ?? browserWorkspaceStorage(localStorageOrNull()))
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [saveFailed, setSaveFailed] = useState(false)
  const [loadFailed, setLoadFailed] = useState(false)
  const [attempt, retryLoad] = useState(0)
  const [externalConflict, setExternalConflict] = useState<WorkspaceConflict | null>(null)
  const current = useRef<Snapshot | null>(null)
  const mounted = useRef(false)
  const dirty = useRef(new Map<string, PageShard | null>())
  const dirtyIndex = useRef<WorkspaceIndex | null>(null)
  const draft = useRef<{ id: string; read: () => JSONContent; updatedAt: number } | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const inFlight = useRef<Promise<boolean> | null>(null)
  const writeAgain = useRef(false)
  const cache = useRef(new Map<string, JSONContent>())
  const reads = useRef(new Map<string, Promise<PageShard | null>>())
  const forceWrite = useRef(false)
  const reloading = useRef(false)
  const purgeRequested = useRef(new Set<string>())
  const pruneRequested = useRef(false)
  const editorAssets = useRef<{ id: string; assets: ReadonlySet<string> } | null>(null)

  const remember = useCallback((id: string, content: JSONContent) => {
    const entries = cache.current
    entries.delete(id)
    entries.set(id, content)
    if (entries.size > 3) entries.delete(entries.keys().next().value!)
  }, [])

  const track = useCallback((before: Pages | null, after: Pages) => {
    if (before === after) return
    const previous = new Map(before?.pages.map(page => [page.id, page]))
    const removed = new Set([...previous.keys(), ...before?.trash?.map(page => page.id) ?? []])
    for (const page of after.pages) {
      const oldPage = previous.get(page.id)
      if (page.content && page.content !== oldPage?.content) {
        dirty.current.set(page.id, { id: page.id, content: page.content, updatedAt: page.updatedAt })
        remember(page.id, page.content)
      }
      removed.delete(page.id)
    }
    for (const page of after.trash ?? []) removed.delete(page.id)
    for (const id of removed) {
      dirty.current.set(id, null)
      cache.current.delete(id)
      reads.current.delete(id)
    }
    dirtyIndex.current = {
      version: 2, activePageId: after.activePageId, pages: after.pages.map(pageMetadata),
      ...(after.trash === undefined ? {} : { trash: after.trash }),
      ...(after.demoVersion === undefined ? {} : { demoVersion: after.demoVersion }),
    }
  }, [remember])

  const publish = useCallback((next: Snapshot) => {
    current.current = next
    if (mounted.current) setSnapshot(next)
  }, [])

  const collect = useCallback(() => {
    const previous = current.current
    const editing = draft.current
    if (!editing || !previous) return previous
    const page = findPage(previous.workspace, editing.id)
    const workspace = page ? updatePage(previous.workspace, editing.id, { content: editing.read() },
      Math.max(page.updatedAt, editing.updatedAt)) : previous.workspace
    draft.current = null
    track(previous.workspace, workspace)
    const next = { ...previous, workspace }
    current.current = next
    return next
  }, [track])

  const commitDraft = useCallback(() => {
    clearTimeout(timer.current)
    const previous = current.current
    const next = collect()
    if (next && next !== previous) publish(next)
    return next
  }, [collect, publish])

  const flush = useCallback(() => {
    const next = commitDraft()
    writeAgain.current = true
    if (inFlight.current) return inFlight.current

    async function drain() {
      do {
        writeAgain.current = false
        const pendingIndex = dirtyIndex.current
        const pendingPages = new Map(dirty.current)
        if (!pendingIndex && !pendingPages.size) return true
        try {
          const pages = [...pendingPages.values()].filter(page => page !== null)
          const removedPageIds = [...pendingPages].filter(([, page]) => page === null).map(([id]) => id)
          recordImageReferences(pages, removedPageIds, current.current?.workspace.activePageId)
          const payload = { ...(pendingIndex ? { index: pendingIndex } : {}), pages, removedPageIds }
          const outcome = forceWrite.current
            ? await storage.commit(payload, { force: true })
            : await storage.commit(payload)
          forceWrite.current = false
          if (outcome?.conflict) {
            if (mounted.current) setExternalConflict({ files: outcome.files ?? [], locked: outcome.locked === true })
            return false
          }
        } catch (error) {
          forceWrite.current = false
          const conflict = workspaceConflict(error)
          if (conflict) {
            if (mounted.current) setExternalConflict(conflict)
            return false
          }
          if (mounted.current) setSaveFailed(true)
          if (!writeAgain.current) return false
          continue
        }
        if (dirtyIndex.current === pendingIndex) dirtyIndex.current = null
        for (const [id, page] of pendingPages) {
          if (dirty.current.get(id) === page) dirty.current.delete(id)
          if (page === null && purgeRequested.current.delete(id)) pruneRequested.current = true
        }
        if (mounted.current) {
          setSaveFailed(false)
          setExternalConflict(null)
        }
      } while (writeAgain.current)
      return true
    }
    const writing = drain().finally(() => { inFlight.current = null })
    inFlight.current = writing
    void writing.then(async saved => {
      if (!saved || !pruneRequested.current || !storage.pruneOrphanAssets || inFlight.current || reloading.current ||
          draft.current || dirty.current.size || dirtyIndex.current || hasPendingImageTransfers() ||
          imageUploadFailures() || hasUnsavedImages()) return
      pruneRequested.current = false
      const protectedIds = new Set(editorAssets.current?.assets)
      if (!persistence) for (const id of activeBrowserAssetIds()) protectedIds.add(id)
      await storage.pruneOrphanAssets(undefined, [...protectedIds])
    }).catch(error => console.warn('Unable to prune unused images', error))
    return writing
  }, [commitDraft, persistence, storage])

  const cachedContent = useCallback((id: string) => {
    const pending = dirty.current.get(id)
    return pending === null ? undefined :
      pending?.content ?? current.current?.workspace.pages.find(page => page.id === id)?.content ?? cache.current.get(id)
  }, [])

  const readContent = useCallback(async (id: string, stillNeeded: () => boolean) => {
    let content = cachedContent(id)
    if (!content) {
      const requested = reads.current
      let reading = requested.get(id)
      if (!reading) {
        const pending = storage.readPage(id).finally(() => {
          if (requested.get(id) === pending) requested.delete(id)
        })
        requested.set(id, pending)
        reading = pending
      }
      const shard = await reading
      if (reads.current !== requested || !stillNeeded()) return
      content = cachedContent(id) ?? checkedPageContent(schema, shard, id).content
    }
    remember(id, content)
    return content
  }, [cachedContent, remember, schema, storage])

  useEffect(() => {
    mounted.current = true
    function flushOnHide() { void flush() }
    function onVisibilityChange() {
      if (document.visibilityState === 'hidden') flushOnHide()
    }
    const restoration = history.scrollRestoration
    history.scrollRestoration = 'manual'
    const unsubscribe = storage.onClosing?.(async (): Promise<WorkspaceCloseResult> => {
      if (!await flush()) return 'workspace-failed'
      const settled = await withDeadline(imageCloseGrace, async signal => {
        await finishImageTransfers()
        signal.throwIfAborted()
        if (!await flush()) return false
        await waitForImageUploads()
        return true
      }).catch(() => false)
      do {
        if (!await flush()) return 'workspace-failed'
      } while (draft.current || dirtyIndex.current || dirty.current.size)
      return settled && !hasUnsavedImages() ? 'saved' : 'images-pending'
    })
    window.addEventListener('pagehide', flushOnHide)
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      mounted.current = false
      unsubscribe?.()
      history.scrollRestoration = restoration
      window.removeEventListener('pagehide', flushOnHide)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      clearTimeout(timer.current)
    }
  }, [flush, storage])

  useEffect(() => {
    if (current.current) return
    let cancelled = false
    void (async () => {
      const index = await storage.readIndex()
      const before: Pages | null = index && {
        activePageId: index.activePageId, pages: index.pages,
        ...(index.trash === undefined ? {} : { trash: index.trash }),
        ...(index.demoVersion === undefined ? {} : { demoVersion: index.demoVersion }),
      }
      const restored = before ? upgradeDemoWorkspace(schema, before) : createDemoWorkspace(schema)
      const next = fromLocation(restored)
      const id = next.workspace.activePageId
      let content = findPage(next.workspace, id)?.content
      if (!content) {
        try { content = checkedPageContent(schema, await storage.readPage(id), id).content }
        catch { if (!cancelled) setLoadFailed(true) }
      }
      if (cancelled) return
      track(before, next.workspace)
      if (content) remember(id, content)
      syncLocation(id, next.anchor?.id ?? null, 'replace')
      publish({ ...next, workspace: withActiveContent(next.workspace, content), revision: 0 })
      if (dirtyIndex.current) void flush()
    })().catch(() => { if (!cancelled) setLoadFailed(true) })
    return () => { cancelled = true }
  }, [attempt, flush, publish, remember, schema, storage, track])

  const selectContent = useCallback((id: string, revision: number) => {
    setLoadFailed(false)
    const selected = () => current.current?.revision === revision && current.current.workspace.activePageId === id
    void readContent(id, selected).then(content => {
      const next = current.current
      if (!content || !next || !selected() || findPage(next.workspace, id)?.content) return
      publish({ ...next, workspace: withActiveContent(next.workspace, content) })
    }, () => {
      const next = current.current
      if (next?.revision === revision && next.workspace.activePageId === id && mounted.current) setLoadFailed(true)
    })
  }, [publish, readContent])

  const apply = useCallback((previous: Snapshot, workspace: Pages, anchor: Snapshot['anchor'], deferred: boolean) => {
    track(previous.workspace, workspace)
    const id = workspace.activePageId
    const content = findPage(workspace, id)?.content ?? cachedContent(id)
    if (previous.workspace.activePageId !== id) {
      const previousContent = findPage(previous.workspace, previous.workspace.activePageId)?.content
      if (previousContent && findPage(workspace, previous.workspace.activePageId)) remember(previous.workspace.activePageId, previousContent)
      setLoadFailed(false)
    }
    publish({ ...previous, workspace: withActiveContent(workspace, content), anchor })
    if (!content) selectContent(id, previous.revision)
    clearTimeout(timer.current)
    if (deferred) timer.current = setTimeout(flush, SAVE_DELAY)
    else void flush()
  }, [cachedContent, flush, publish, remember, selectContent, track])

  const reloadFromDisk = useCallback(async (change: WorkspaceExternalChange, forceRemount: boolean) => {
    const previous = current.current
    if (!previous || reloading.current) return
    if (inFlight.current) await inFlight.current.catch(() => undefined)
    reloading.current = true
    try {
      const index = await storage.readIndex()
      if (!index) throw new Error('Workspace is missing')
      const activePageId = index.activePageId
      const pageIds = new Set([activePageId, ...change.pageIds])
      const contents = new Map<string, JSONContent>()
      for (const id of pageIds) {
        const shard = await storage.readPage(id)
        if (!shard) {
          if (id === activePageId) throw new Error('Active page is missing')
          continue
        }
        contents.set(id, checkedPageContent(schema, shard, id).content)
      }
      const workspace: Pages = {
        activePageId: index.activePageId,
        pages: index.pages,
        ...(index.trash === undefined ? {} : { trash: index.trash }),
        ...(index.demoVersion === undefined ? {} : { demoVersion: index.demoVersion }),
      }
      const previousActiveContent = findPage(previous.workspace, previous.workspace.activePageId)?.content
      const preserveEditor = !forceRemount &&
        activePageId === previous.workspace.activePageId &&
        !change.pageIds.includes(activePageId) &&
        sameDocument(schema, previousActiveContent, contents.get(activePageId))
      if (preserveEditor) {
        const retained = new Set([...workspace.pages, ...workspace.trash ?? []].map(page => page.id))
        for (const id of new Set([...change.pageIds, ...cache.current.keys(), ...reads.current.keys()])) {
          if (id === activePageId && retained.has(id)) continue
          if (retained.has(id) && !change.pageIds.includes(id)) continue
          cache.current.delete(id)
          reads.current.delete(id)
        }
        publish({
          workspace: withActiveContent(workspace, previousActiveContent),
          anchor: previous.anchor,
          revision: previous.revision,
        })
        setExternalConflict(null)
        setSaveFailed(false)
        setLoadFailed(false)
        return
      }
      draft.current = null
      dirty.current.clear()
      dirtyIndex.current = null
      purgeRequested.current.clear()
      pruneRequested.current = false
      reads.current = new Map()
      cache.current.clear()
      for (const [id, content] of contents) cache.current.set(id, content)
      forceWrite.current = false
      publish({
        workspace: withActiveContent(workspace, contents.get(activePageId)),
        anchor: null,
        revision: previous.revision + 1,
      })
      syncLocation(activePageId, null, 'replace')
      setExternalConflict(null)
      setSaveFailed(false)
      setLoadFailed(false)
    } catch (error) {
      if (mounted.current) setLoadFailed(true)
      throw error
    } finally {
      reloading.current = false
    }
  }, [publish, schema, storage])

  const keepLocal = useCallback(() => {
    forceWrite.current = true
    setExternalConflict(null)
    void flush()
  }, [flush])

  const reloadExternal = useCallback(() => {
    const conflict = externalConflict
    const change: WorkspaceExternalChange = conflict
      ? {
          indexChanged: conflict.files.includes('index'),
          pageIds: conflict.files.filter(file => file !== 'index' && isPageId(file)),
        }
      : { indexChanged: true, pageIds: [] }
    void reloadFromDisk(change, true).catch(() => undefined)
  }, [externalConflict, reloadFromDisk])

  const externalHandler = useRef<(change: WorkspaceExternalChange) => void>(() => {})
  externalHandler.current = change => {
    if (!current.current || reloading.current) return
    if (draft.current || dirty.current.size || dirtyIndex.current || inFlight.current) {
      setExternalConflict({
        files: [...(change.indexChanged ? ['index'] : []), ...change.pageIds],
        locked: false,
      })
      return
    }
    void reloadFromDisk(change, false).catch(() => undefined)
  }
  useEffect(() => storage.onExternalChange?.(change => externalHandler.current(change)), [storage])

  useEffect(() => {
    function followLocation() {
      const value = current.current
      if (!value) return
      const next = fromLocation(value.workspace)
      syncLocation(next.workspace.activePageId, next.anchor?.id ?? null, 'replace')
      if (next.workspace === value.workspace && next.anchor?.id === value.anchor?.id) return
      const previous = collect()!
      apply(previous, activatePage(previous.workspace, next.workspace.activePageId), next.anchor, false)
    }
    window.addEventListener('hashchange', followLocation)
    window.addEventListener('popstate', followLocation)
    return () => {
      window.removeEventListener('hashchange', followLocation)
      window.removeEventListener('popstate', followLocation)
    }
  }, [apply, collect])

  const revision = snapshot?.revision
  const stageContent = useCallback((id: string, read: () => JSONContent) => {
    const next = current.current
    if (!next || next.revision !== revision || next.workspace.activePageId !== id) return
    draft.current = { id, read, updatedAt: Date.now() }
    clearTimeout(timer.current)
    timer.current = setTimeout(flush, SAVE_DELAY)
  }, [flush, revision])

  function change(transform: (workspace: Pages) => Pages, deferred = false) {
    if (current.current?.revision !== revision) return
    const value = current.current
    const previous = collect()
    if (!previous) return
    let workspace: Pages
    try {
      workspace = transform(previous.workspace)
    } catch (error) {
      if (previous !== value) publish(previous)
      throw error
    }
    if (previous === value && workspace === previous.workspace) return
    const switched = workspace.activePageId !== previous.workspace.activePageId
    if (switched) syncLocation(workspace.activePageId, null, 'push')
    apply(previous, workspace, switched ? null : previous.anchor, deferred && !switched)
  }

  function deferTitle(id: string, title: string) {
    const previous = current.current
    if (!previous || previous.revision !== revision) return
    const workspace = updatePage(previous.workspace, id, { title }, Date.now())
    if (workspace !== previous.workspace) apply(previous, workspace, previous.anchor, true)
  }

  async function loadPage(id: string): Promise<PageRecord | undefined> {
    const starting = current.current
    if (!starting || !findPage(starting.workspace, id)) return
    const content = await readContent(id, () => {
      const latest = current.current
      return latest?.revision === starting.revision && !!findPage(latest.workspace, id)
    })
    const latest = current.current
    if (!content || latest?.revision !== starting.revision) return
    const page = findPage(latest.workspace, id)
    if (!page) return
    const editing = draft.current
    return { ...page, content: (editing?.id === id ? editing.read() : cachedContent(id)) ?? content }
  }

  const searchContent = useCallback(async (id: string): Promise<JSONContent | null> => {
    if (!current.current || !findPage(current.current.workspace, id)) return null
    if (draft.current?.id === id) return draft.current.read()
    const cached = cachedContent(id)
    if (cached) return cached
    const shard = storage.peekPage ? await storage.peekPage(id) : await storage.readPage(id)
    if (!shard || !current.current || !findPage(current.current.workspace, id)) return null
    return checkedPageContent(schema, shard, id).content
  }, [cachedContent, schema, storage])

  const holdEditorAssets = useCallback((id: string, assets: ReadonlySet<string> | null) => {
    if (assets) editorAssets.current = { id, assets }
    else if (editorAssets.current?.id === id) editorAssets.current = null
  }, [])

  function purgeTrash(id?: string) {
    change(workspace => {
      const result = id === undefined ? emptyTrash(workspace) : purgeTrashedPage(workspace, id)
      for (const removed of result.removedPageIds) purgeRequested.current.add(removed)
      return result.workspace
    })
  }

  function reset() {
    const previous = current.current
    if (!previous) return
    const workspace = createDemoWorkspace(schema)
    draft.current = null
    forceWrite.current = false
    purgeRequested.current.clear()
    pruneRequested.current = false
    setExternalConflict(null)
    resetImageUploads()
    cache.current.clear()
    reads.current = new Map()
    track(previous.workspace, workspace)
    setLoadFailed(false)
    publish({ workspace: withActiveContent(workspace, findPage(workspace, workspace.activePageId)!.content),
      anchor: null, revision: previous.revision + 1 })
    syncLocation(workspace.activePageId, null, 'replace')
    void flush()
  }

  function retry() {
    setLoadFailed(false)
    const next = current.current
    if (next) selectContent(next.workspace.activePageId, next.revision)
    else retryLoad(value => value + 1)
  }

  return {
    workspace: snapshot?.workspace ?? null, anchor: snapshot?.anchor ?? null, revision: revision ?? 0,
    saveFailed, loadFailed, retry, change, reset, stageContent, commitDraft, flush, loadPage, deferTitle,
    externalConflict, keepLocal, reloadExternal, searchContent, purgeTrash, holdEditorAssets,
  }
}
