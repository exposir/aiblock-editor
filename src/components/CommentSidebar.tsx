import { Check, MessageCircle, PanelRightClose, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { CommentThread } from '../editor/comments'

interface CommentSidebarProps {
  readonly threads: readonly CommentThread[]
  readonly active: string | null
  readonly onLocate: (thread: CommentThread) => void
  readonly onReply: (id: string, text: string) => void
  readonly onResolve: (id: string) => void
  readonly onDelete: (id: string) => void
  readonly onClose: () => void
}

function ThreadCard({ thread, chosen, onLocate, onReply, onResolve, onDelete }:
  Pick<CommentSidebarProps, 'onLocate' | 'onReply' | 'onResolve' | 'onDelete'> &
  { thread: CommentThread; chosen: boolean }) {
  const [reply, setReply] = useState('')
  const input = useRef<HTMLTextAreaElement>(null)
  const draft = !thread.messages.length
  useEffect(() => {
    if (chosen && draft) input.current?.focus({ preventScroll: true })
  }, [chosen, draft])

  return (
    <article className="comment-thread" data-active={chosen} data-resolved={thread.resolved}>
      <button type="button" className="comment-quote" disabled={thread.resolved}
        title={thread.resolved ? undefined : '定位引用'} onClick={() => onLocate(thread)}>
        {thread.quote}
      </button>
      {thread.messages.map(message => (
        <div key={message.id} className="comment-message">
          <strong>{message.author}</strong>
          <p>{message.text}</p>
        </div>
      ))}
      {thread.resolved && <p className="comment-resolved"><Check size={13} aria-hidden="true" /> 已解决</p>}
      {!thread.resolved && <form className="comment-form" onSubmit={event => {
        event.preventDefault()
        if (!reply.trim()) return
        onReply(thread.id, reply.trim())
        setReply('')
      }}>
        <textarea ref={input} aria-label={draft ? '评论内容' : '回复内容'} rows={draft ? 3 : 2}
          placeholder={draft ? '写下你的评论…' : '回复评论…'} value={reply}
          onChange={event => setReply(event.target.value)} />
        <button type="submit" className="primary-control" disabled={!reply.trim()}>{draft ? '发表评论' : '回复'}</button>
      </form>}
      <div className="comment-actions">
        {!draft && !thread.resolved &&
          <button className="icon-control" type="button" aria-label="解决评论" title="解决评论" onClick={() => onResolve(thread.id)}>
            <Check size={15} aria-hidden="true" />
          </button>}
        <button className="icon-control" type="button" aria-label={draft ? '取消评论' : '删除评论'}
          title={draft ? '取消评论' : '删除评论'} onClick={() => onDelete(thread.id)}>
          <Trash2 size={15} aria-hidden="true" />
        </button>
      </div>
    </article>
  )
}

export function CommentSidebar({ threads, active, onClose, ...actions }: CommentSidebarProps) {
  return (
    <aside className="workspace-sidebar comment-sidebar" id="document-comments" aria-label="评论">
      <div className="sidebar-heading"><MessageCircle size={16} aria-hidden="true" /><h2>评论</h2>
        <button type="button" className="icon-control" aria-label="收起评论" onClick={onClose}>
          <PanelRightClose size={16} aria-hidden="true" />
        </button>
      </div>
      <div className="comment-list">
        {threads.length ? threads.map(thread => <ThreadCard key={thread.id} thread={thread}
          chosen={thread.id === active} {...actions} />) : <p className="sidebar-empty">选中文字后可发表评论</p>}
      </div>
    </aside>
  )
}
