import { cleanup } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach } from 'vitest'
import { vi } from 'vitest'

const logError = vi.spyOn(console, 'error').mockImplementation((...args) => {
  if (String(args[0]).includes('Not implemented: HTMLFormElement.prototype.requestSubmit')) return
  process.stderr.write(`${args.map(String).join(' ')}\n`)
})

if (!File.prototype.text) {
  File.prototype.text = function text() {
    return new Promise(resolve => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result ?? ''))
      reader.readAsText(this)
    })
  }
}

afterEach(() => {
  logError.mockClear()
})

afterEach(() => {
  cleanup()
  document.body.innerHTML = ''
})

if (!Element.prototype.setPointerCapture) {
  Element.prototype.setPointerCapture = function setPointerCapture() {}
  Element.prototype.releasePointerCapture = function releasePointerCapture() {}
  Element.prototype.hasPointerCapture = function hasPointerCapture() { return false }
}

if (!HTMLDialogElement.prototype.showModal) {
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.setAttribute('open', '')
  }
}

if (!HTMLDialogElement.prototype.close) {
  HTMLDialogElement.prototype.close = function close() {
    this.removeAttribute('open')
    this.dispatchEvent(new Event('close'))
  }
}

if (!window.matchMedia) {
  window.matchMedia = query => ({
    matches: query === '(min-width: 1080px)',
    media: query,
    onchange: null,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent: () => false,
  })
}

if (!Range.prototype.getClientRects) {
  Range.prototype.getClientRects = function getClientRects() {
    const rects = [] as unknown as DOMRectList
    Object.defineProperty(rects, 'item', { value: () => null })
    Object.defineProperty(rects, 'length', { value: 0 })
    return rects
  }
}

if (!Range.prototype.getBoundingClientRect) {
  Range.prototype.getBoundingClientRect = function getBoundingClientRect() {
    return {
      x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0,
      toJSON() { return this },
    } as DOMRect
  }
}

if (typeof DataTransfer === 'undefined') {
  class TestDataTransfer {
    private readonly values = new Map<string, File[]>()
    readonly items = {
      add: (file: File) => {
        const files = this.values.get('Files') ?? []
        files.push(file)
        this.values.set('Files', files)
        return null
      },
    }
    get types() { return [...this.values.keys()] }
    get files() {
      const files = this.values.get('Files') ?? []
      return Object.assign([...files], { item: (index: number) => files[index] ?? null })
    }
    getData(key: string) { return key === 'Files' ? this.files : '' }
    dropEffect = 'none'
  }
  Object.defineProperty(globalThis, 'DataTransfer', { configurable: true, value: TestDataTransfer })
}

if (typeof DragEvent === 'undefined') {
  class TestDragEvent extends Event {
    readonly dataTransfer: DataTransfer
    constructor(type: string, init: DragEventInit = {}) {
      super(type, { bubbles: init.bubbles, cancelable: init.cancelable, composed: init.composed })
      this.dataTransfer = init.dataTransfer ?? new DataTransfer()
    }
    get clientX() { return 0 }
    get clientY() { return 0 }
  }
  Object.defineProperty(globalThis, 'DragEvent', { configurable: true, value: TestDragEvent })
}

