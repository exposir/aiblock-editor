import { Fragment, Slice } from '@tiptap/pm/model'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { closeHistory } from '@tiptap/pm/history'
import { Plugin, PluginKey, Selection } from '@tiptap/pm/state'
import type { EditorState, SelectionBookmark, Transaction } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'
import { observeViewport } from '../components/viewport'
import { acceptedImages, imageRejectionNotice, isImageFile, prepareImages, queueImages, watchImageSource } from './image-assets'
import { imageAttributes } from './image-attributes'
import type { ImageAttributes } from './image-attributes'
import { ImageBlockSchema } from '../schema/image-block'
import { isMarkdownFile } from '../markdown/markdown-files'

const transferKey = new PluginKey<ReadonlyMap<object, SelectionBookmark>>('imageTransfer')
interface TransferHost {
  pageId?: string
  attached(): boolean
  detached(images: readonly ImageAttributes[], position: number): Promise<void>
  notice(message: string): void
}

const hosts = new WeakMap<EditorView, TransferHost>()
const transfers = new Set<Promise<void>>()

export function setImageTransferHost(view: EditorView, host: TransferHost) {
  hosts.set(view, host)
  return () => { hosts.delete(view) }
}

export async function finishImageTransfers() {
  while (transfers.size) await Promise.allSettled([...transfers])
}

export function hasPendingImageTransfers() {
  return transfers.size > 0
}

export function insertImageBlocks(state: EditorState, images: readonly ImageAttributes[], selection = state.selection): Transaction {
  const fragment = Fragment.fromArray(images.map(image => state.schema.nodes.imageBlock!.create(image)))
  return closeHistory(state.tr.setSelection(selection).replaceSelection(new Slice(fragment, 0, 0)))
}

function insideCode(selection: Selection) {
  const { $from } = selection
  for (let depth = $from.depth; depth > 0; depth--) if ($from.node(depth).type.spec.code) return true
  return false
}

export function pasteImageFiles(view: EditorView, files: readonly File[], selection = view.state.selection, removeTrigger?: { from: number; to: number }) {
  if (!files.some(isImageFile) || insideCode(selection)) return false
  const host = hosts.get(view)
  const key = {}
  const tr = view.state.tr
  if (removeTrigger) tr.delete(removeTrigger.from, removeTrigger.to)
  const bookmark = selection.getBookmark().map(tr.mapping)
  view.dispatch(tr.setMeta(transferKey, { key, bookmark }).setMeta('addToHistory', false))
  const operation = prepareImages(files).then(async ({ images, rejected }) => {
    const pending = transferKey.getState(view.state)?.get(key)
    const position = pending?.resolve(view.state.doc).from ?? selection.from
    const attached = !view.isDestroyed && (host?.attached() ?? true)
    if (images.length) {
      const attributes = queueImages(images, host?.pageId)
      if (attached) {
        view.dispatch(insertImageBlocks(view.state, attributes, pending?.resolve(view.state.doc))
          .setMeta(transferKey, { key }))
      } else {
        await host?.detached(attributes, position)
      }
    }
    if (!images.length && attached) view.dispatch(view.state.tr.setMeta(transferKey, { key }))
    const warning = imageRejectionNotice(rejected)
    if (warning) host?.notice(warning)
  }).catch(() => { host?.notice('图片插入失败。') })
  transfers.add(operation)
  void operation.finally(() => { transfers.delete(operation) })
  return true
}

export function chooseImages(view: EditorView, range: { from: number; to: number }) {
  const input = view.dom.ownerDocument.createElement('input')
  input.type = 'file'
  input.multiple = true
  input.accept = acceptedImages
  // The picker stays outside ProseMirror, including while its native dialog is open.
  input.addEventListener('change', () => {
    if (!view.isDestroyed && input.files?.length) pasteImageFiles(view, Array.from(input.files), view.state.selection, range)
  }, { once: true })
  input.click()
}

function imageNodeView(owner: Document, initial: ProseMirrorNode) {
  const dom = owner.createElement('figure')
  dom.className = 'image-block'
  dom.dataset.imageBlock = ''
  dom.setAttribute('contenteditable', 'false')
  const frame = owner.createElement('span')
  frame.className = 'image-block-frame'
  dom.append(frame)
  let node = initial
  let near = false
  let unload: (() => void) | undefined
  let picture: HTMLImageElement | undefined

  function detach() {
    unload?.()
    unload = undefined
    frame.replaceChildren()
    picture = undefined
  }

  function renderSource(attrs: ImageAttributes) {
    if (!near) return
    unload = watchImageSource(attrs, url => {
      if (!url) {
        frame.replaceChildren()
        picture = undefined
        const placeholder = owner.createElement('span')
        placeholder.className = 'image-unavailable'
        placeholder.textContent = '图片不可用'
        placeholder.title = attrs.alt
        frame.append(placeholder)
        return
      }
      if (!picture) {
        picture = owner.createElement('img')
        picture.setAttribute('decoding', 'async')
        picture.draggable = false
        picture.setAttribute('referrerpolicy', 'no-referrer')
        picture.alt = imageAttributes(node.attrs).alt
        frame.replaceChildren(picture)
      }
      if (picture.getAttribute('src') !== url) picture.src = url
    })
  }

  function update(next: typeof node, previous?: ImageAttributes) {
    node = next
    const attrs = imageAttributes(node.attrs)
    dom.dataset.align = attrs.align
    const id = node.attrs.blockId
    if (typeof id === 'string') dom.dataset.blockId = id
    else delete dom.dataset.blockId
    const bg = node.attrs.blockBg
    if (typeof bg === 'string' && bg !== 'default') dom.dataset.blockBg = bg
    else delete dom.dataset.blockBg
    frame.style.width = `${attrs.displayWidth ?? attrs.width}px`
    frame.style.aspectRatio = `${attrs.width} / ${attrs.height}`
    frame.setAttribute('aria-label', attrs.alt || '图片')
    if (picture) picture.alt = attrs.alt
    if (!previous || previous.src !== attrs.src || previous.assetId !== attrs.assetId) {
      detach()
      renderSource(attrs)
    }
  }

  update(initial)
  const stop = observeViewport(dom, 800, visible => {
    near = visible
    if (visible) renderSource(imageAttributes(node.attrs))
    else detach()
  })
  return {
    dom,
    update(next: typeof node) {
      if (next.type !== node.type) return false
      if (!next.sameMarkup(node)) update(next, imageAttributes(node.attrs))
      else node = next
      return true
    },
    ignoreMutation: () => true,
    destroy() { stop(); detach() },
  }
}

export const ImageBlock = ImageBlockSchema.extend({
  addNodeView() {
    return ({ node, view }) => imageNodeView(view.dom.ownerDocument, node)
  },

  addProseMirrorPlugins() {
    return [new Plugin({
      key: transferKey,
      state: {
        init: () => new Map(),
        apply(tr, previous) {
          const change = tr.getMeta(transferKey) as { key: object; bookmark?: SelectionBookmark } | undefined
          if (!change && (!previous.size || !tr.docChanged)) return previous
          const pending = new Map([...previous].map(([key, bookmark]) => [key, bookmark.map(tr.mapping)]))
          if (change?.bookmark) pending.set(change.key, change.bookmark)
          else if (change) pending.delete(change.key)
          return pending
        },
      },
      props: {
        handlePaste(view, event) {
          const files = Array.from(event.clipboardData?.files ?? [])
          return pasteImageFiles(view, files)
        },
        handleDrop(view, event, _slice, moved) {
          if (moved) return false
          const files = Array.from(event.dataTransfer?.files ?? [])
          if (files.some(isMarkdownFile) || !files.some(isImageFile)) return false
          const point = view.posAtCoords({ left: event.clientX, top: event.clientY })
          const selection = point ? Selection.near(view.state.doc.resolve(point.pos)) : view.state.selection
          return pasteImageFiles(view, files, selection)
        },
      },
    })]
  },
})
