import { highlightCode } from './code-syntax'

self.onmessage = (message: MessageEvent<{ language: unknown; text: string }>) => {
  try {
    self.postMessage(highlightCode(message.data.language, message.data.text))
  } catch {
    self.postMessage([])
  }
}
