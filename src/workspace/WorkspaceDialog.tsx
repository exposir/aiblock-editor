import { useLayoutEffect, useRef, useState } from 'react'
import { findPage, pageAncestors, pageSubtree, pageTitle } from './page-store'
import type { WorkspaceState } from './page-store'
import type { PageMetadata } from './workspace-format'

export type WorkspaceDialogRequest = { kind: 'reset' | 'empty-trash' } | { kind: 'rename' | 'move' | 'delete' | 'purge'; pageId: string }

const titles = {
  rename: '重命名页面', move: '移动页面', delete: '删除页面', reset: '重置示例工作区',
  purge: '彻底删除页面', 'empty-trash': '清空回收站',
}
const confirmations = {
  rename: '保存', move: '保存', delete: '移入回收站', reset: '确认重置',
  purge: '确认彻底删除', 'empty-trash': '确认清空',
}

export function WorkspaceDialog({ request, workspace, onClose, onConfirm }: {
  request: WorkspaceDialogRequest
  workspace: WorkspaceState<PageMetadata>
  onClose: () => void
  onConfirm: (value: string) => void
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const tree = request.kind === 'purge' ? { ...workspace, pages: workspace.trash ?? [] } : workspace
  const page = 'pageId' in request ? findPage(tree, request.pageId) : undefined
  const [value, setValue] = useState(request.kind === 'rename' ? page?.title ?? '' : page?.parentId ?? '')
  const subtree = page ? pageSubtree(tree, page.id) : new Set<string>()
  const destructive = request.kind !== 'rename' && request.kind !== 'move'
  const descendants = subtree.size - 1
  const title = page ? pageTitle(page) : ''

  useLayoutEffect(() => {
    if (ref.current && !ref.current.open) ref.current.showModal()
  }, [])

  return (
    <dialog ref={ref} className="shortcut-dialog reset-dialog" aria-labelledby="workspace-dialog-heading"
      aria-describedby={destructive ? 'workspace-dialog-description' : undefined} onClose={onClose}>
      <div className="sidebar-heading"><h2 id="workspace-dialog-heading">{titles[request.kind]}</h2></div>
      {request.kind === 'reset' && <p id="workspace-dialog-description">本地保存的页面、评论和回收站内容将被清除，并恢复五个示例页面。</p>}
      {request.kind === 'delete' && <p id="workspace-dialog-description">
        将「{title}」{descendants > 0 && `及其 ${descendants} 个子页面`}移入回收站。可在回收站恢复。
      </p>}
      {request.kind === 'purge' && <p id="workspace-dialog-description">
        将彻底删除「{title}」{descendants > 0 && `及其 ${descendants} 个子页面`}。此操作无法撤销。
      </p>}
      {request.kind === 'empty-trash' && <p id="workspace-dialog-description">将彻底删除回收站中的所有页面。此操作无法撤销。</p>}
      <form onSubmit={event => { event.preventDefault(); ref.current?.close(); onConfirm(value.trim()) }}>
        {request.kind === 'rename' && <label className="workspace-dialog-field">页面标题
          <input autoFocus value={value} onChange={event => setValue(event.target.value)} />
        </label>}
        {request.kind === 'move' && <label className="workspace-dialog-field">移动到
          <select autoFocus value={value} onChange={event => setValue(event.target.value)}>
            <option value="">顶层页面</option>
            {workspace.pages.filter(candidate => !subtree.has(candidate.id)).map(candidate => (
              <option key={candidate.id} value={candidate.id}>
                {[...pageAncestors(workspace, candidate.id), candidate].map(pageTitle).join(' / ')}
              </option>
            ))}
          </select>
        </label>}
        <div className="reset-actions">
          <button type="button" autoFocus={destructive} onClick={() => ref.current?.close()}>取消</button>
          <button type="submit" className={destructive ? 'reset-confirm' : 'dialog-confirm'}>
            {confirmations[request.kind]}
          </button>
        </div>
      </form>
    </dialog>
  )
}
