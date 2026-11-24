export interface CommentMessage {
  readonly id: string
  readonly author: string
  readonly text: string
}

export interface CommentThread {
  readonly id: string
  readonly quote: string
  readonly messages: readonly CommentMessage[]
  readonly resolved: boolean
}
