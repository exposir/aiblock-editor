import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { codeLanguage, isPreviewLanguage } from './code-languages'
import SyntaxWorker from './code-highlight-worker?worker&inline'
import type { CodeToken } from './code-syntax'

export function isLongCode(node: ProseMirrorNode) {
  const language = codeLanguage(node.attrs.language)
  if (language === 'plaintext' || isPreviewLanguage(language)) return false
  if (node.content.size > 4096) return true
  const text = node.textContent
  let lines = 0
  for (let index = text.indexOf('\n'); index !== -1; index = text.indexOf('\n', index + 1)) {
    if (++lines >= 120) return true
  }
  return false
}

export function isHugeCode(node: ProseMirrorNode) {
  if (node.content.size > 100_000) return true
  const text = node.textContent
  let lines = 1
  for (let index = text.indexOf('\n'); index !== -1; index = text.indexOf('\n', index + 1)) {
    if (++lines >= 2_000) return true
  }
  return false
}

interface TokenWindow { from: number; to: number }

export function windowOfTokens(tokens: readonly CodeToken[], offset: number, previous?: TokenWindow): TokenWindow | null {
  let start = 0
  let end = tokens.length
  while (start < end) {
    const middle = (start + end) >>> 1
    if (tokens[middle]!.to < offset) start = middle + 1
    else end = middle
  }
  if (previous && start >= (previous.from ? previous.from + 60 : 0) &&
      start <= (previous.to === tokens.length ? previous.to : previous.to - 100)) return null
  const from = Math.max(0, start - 120)
  return { from, to: Math.min(from + 560, tokens.length) }
}

export const codeWorkerTimeout = 5000

export function codeHighlightWorker() {
  let worker: Worker | undefined
  let closed = false
  let stopCurrent: (() => void) | undefined

  return {
    async color(language: unknown, text: string): Promise<readonly CodeToken[]> {
      if (closed || typeof Worker !== 'function') throw new Error('Code highlighter is unavailable')
      const active = worker ??= new SyntaxWorker()
      try {
        return await new Promise<CodeToken[]>((resolve, reject) => {
          const timer = setTimeout(() => fail('Code highlighting timed out'), codeWorkerTimeout)
          function finish() {
            clearTimeout(timer)
            active.onmessage = active.onerror = active.onmessageerror = null
            stopCurrent = undefined
          }
          function fail(message: string) {
            finish()
            reject(new Error(message))
          }
          stopCurrent = () => fail('Code highlighter stopped')
          active.onmessage = event => { finish(); resolve(event.data) }
          active.onerror = () => fail('Code highlighter failed')
          active.onmessageerror = () => fail('Invalid code highlighter response')
          try { active.postMessage({ language, text }) } catch { fail('Code highlighter could not start') }
        })
      } catch (error) {
        if (worker === active) {
          worker = undefined
          active.terminate()
        }
        throw error
      }
    },
    destroy() {
      closed = true
      stopCurrent?.()
      worker?.terminate()
      worker = undefined
    },
  }
}
