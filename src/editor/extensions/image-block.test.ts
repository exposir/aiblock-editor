import { Blob as NodeBlob } from 'node:buffer'
import { createHash, webcrypto } from 'node:crypto'
import { Editor } from '@tiptap/core'
import { Slice } from '@tiptap/pm/model'
import { waitFor } from '@testing-library/react'
import { IDBFactory } from 'fake-indexeddb'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { testImage } from '../../test/image-fixture'
import { mockViewport } from '../../test/viewport-fixture'
import { MultiBlockSelection } from './multi-block-selection'
import { createBlockMoveTransaction } from './block-drag-logic'
import { createEditorExtensions } from './index'
import { finishImageTransfers } from './image-block'
import { imageDecodeTimeout, imageRejectionNotice, prepareImages, resetImageUploads } from './image-assets'

let editor: Editor | undefined
afterEach(() => {
  editor?.destroy()
  resetImageUploads()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('image block and transfers', () => {
  // @partition batch: one paste and one undo; equal assets store once
  // @partition viewport: stable placeholder then bitmap mount and release
  // @partition source: reject non-raster executable URLs in HTML
  it('pastes two clipboard files in a single undoable block insertion', async () => {
    vi.stubGlobal('Blob', NodeBlob)
    vi.stubGlobal('indexedDB', new IDBFactory())
    vi.stubGlobal('crypto', webcrypto)
    const close = vi.fn()
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 1, height: 1, close })))
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:pending')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    editor = new Editor({ extensions: createEditorExtensions(), content: '<p>正文</p>' })
    const source = testImage()
    const files = new DataTransfer()
    for (const name of ['一.png', '二.png']) {
      const file = new File([source.bytes], name, { type: source.mime })
      Object.defineProperty(file, 'arrayBuffer', { value: async () => source.bytes.buffer })
      files.items.add(file)
    }
    const event = { clipboardData: files } as ClipboardEvent
    expect(editor.view.someProp('handlePaste', handler => handler(editor!.view, event, Slice.empty))).toBe(true)
    await finishImageTransfers()
    const images = editor.state.doc.children.filter(node => node.type.name === 'imageBlock')
    expect(images.map(node => node.attrs.alt)).toEqual(['一.png', '二.png'])
    expect(new Set(images.map(node => node.attrs.assetId)).size).toBe(1)
    expect(close).toHaveBeenCalledTimes(2)
    expect(editor.commands.undo()).toBe(true)
    expect(editor.state.doc.children.map(node => node.type.name)).toEqual(['paragraph'])
    expect(editor.state.doc.textContent).toBe('正文')
    expect(editor.commands.redo()).toBe(true)
    const restored = editor.state.doc.children.filter(node => node.type.name === 'imageBlock')
    expect(restored.map(node => node.attrs)).toEqual(images.map(node => node.attrs))
  })

  it('keeps successful files when another file is oversized, malformed or times out', async () => {
    vi.useFakeTimers()
    const good = testImage().bytes
    const make = (name: string, bytes = good, type = 'image/png') => {
      const file = new File([bytes], name, { type })
      Object.defineProperty(file, 'arrayBuffer', { value: async () => bytes.buffer })
      return file
    }
    const tooLarge = make('oversized.png')
    Object.defineProperty(tooLarge, 'size', { value: 32 * 1024 * 1024 + 1 })
    const hugeCanvas = good.slice()
    new DataView(hugeCanvas.buffer).setUint32(16, 100_000)
    const close = vi.fn()
    let finishLate!: (bitmap: unknown) => void
    const decode = vi.fn((file: File) => file.name === 'hanging.png'
      ? new Promise(resolve => { finishLate = resolve }) : Promise.resolve({ width: 1, height: 1, close }))
    vi.stubGlobal('createImageBitmap', decode)
    vi.stubGlobal('crypto', { subtle: { digest: async (_algorithm: string, bytes: Uint8Array) =>
      new Uint8Array(createHash('sha256').update(bytes).digest()).buffer } })
    const files = [make('first.png'), make('hanging.png'), make('bad.png', new Uint8Array([1, 2, 3])),
      tooLarge, make('huge-canvas.png', hugeCanvas), make('truncated.png', good.slice(0, 16)),
      make('not-an-image.svg', good, 'image/svg+xml'), make('last.png')]
    const task = prepareImages(files)
    await vi.advanceTimersByTimeAsync(imageDecodeTimeout)
    const result = await task
    expect(result.images.map(image => image.metadata.name)).toEqual(['first.png', 'last.png'])
    expect(result.rejected).toEqual({ format: 2, size: 1, dimensions: 1, decode: 1, timeout: 1 })
    expect(imageRejectionNotice(result.rejected)).toContain('1 张解码超时')
    expect(decode.mock.calls.map(([file]) => file.name)).toEqual(['first.png', 'hanging.png', 'last.png'])
    finishLate({ width: 1, height: 1, close })
    await vi.advanceTimersByTimeAsync(0)
    expect(close).toHaveBeenCalledTimes(3)
  })

  it('holds the same ratio before, during and after nearby image mount', async () => {
    const viewport = mockViewport()
    editor = new Editor({ extensions: createEditorExtensions(),
      content: '<img src="https://example.test/a.png" alt="示意图" width="800" height="400">', })
    const figure = editor.view.dom.querySelector<HTMLElement>('figure')!
    const frame = figure.firstElementChild as HTMLElement
    expect(frame.style.aspectRatio).toBe('800 / 400')
    expect(frame.querySelector('img')).toBeNull()
    viewport.show(figure, true, 800)
    await waitFor(() => expect(frame.querySelector('img')).toHaveAttribute('alt', '示意图'))
    expect(frame.querySelector('img')).toHaveAttribute('decoding', 'async')
    viewport.show(figure, false, 800)
    expect(frame.querySelector('img')).toBeNull()
    expect(frame.style.aspectRatio).toBe('800 / 400')
    expect(editor.view.dom.querySelector('button,input,select,textarea')).toBeNull()
  })

  it('drops executable URLs in HTML and keeps HTTPS images', () => {
    editor = new Editor({ extensions: createEditorExtensions(),
      content: '<img src="javascript:evil()"><img src="data:image/svg+xml,evil"><img src="https://example.test/safe.png">', })
    expect(editor.state.doc.childCount).toBe(1)
    expect(editor.state.doc.firstChild?.attrs.src).toBe('https://example.test/safe.png')
  })
  it('selects a picture as a whole block and moves it into a new right column', () => {
    editor = new Editor({ extensions: createEditorExtensions(),
      content: '<img src="https://example.test/layout.png" alt="布局"><p>旁注</p>' })
    expect(editor.commands.selectBlockRange(0, 0)).toBe(true)
    expect(editor.state.selection).toBeInstanceOf(MultiBlockSelection)
    const selected = editor.state.selection as MultiBlockSelection
    const move = createBlockMoveTransaction(editor.state, selected, { blockPos: 1, side: 'right' })
    expect(move).not.toBeNull()
    editor.view.dispatch(move!)
    const columns = editor.state.doc.firstChild!
    expect(columns.type.name).toBe('columnList')
    expect(columns.child(0).textContent).toBe('旁注')
    expect(columns.child(1).firstChild?.attrs.alt).toBe('布局')
  })
})
