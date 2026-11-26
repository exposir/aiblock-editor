import { afterEach } from 'vitest'

if (typeof document !== 'undefined' && typeof window !== 'undefined') {
  const polyfilledSubmitEvents = new WeakSet<Event>()
  const [{ cleanup }] = await Promise.all([
    import('@testing-library/react'),
    import('@testing-library/jest-dom/vitest'),
  ])

  afterEach(() => {
    cleanup()
    document.body.innerHTML = ''
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

  Object.defineProperty(HTMLFormElement.prototype, 'requestSubmit', {
    configurable: true,
    writable: true,
    value(submitter: HTMLElement | null = null) {
      if (submitter && !(submitter instanceof HTMLButtonElement || submitter instanceof HTMLInputElement)) {
        throw new TypeError('requestSubmit submitter must belong to the form and be a submit button')
      }
      const isSubmitButton = submitter instanceof HTMLButtonElement
        ? submitter.type === 'submit'
        : submitter instanceof HTMLInputElement && (submitter.type === 'submit' || submitter.type === 'image')
      if (submitter && (submitter.form !== this || !isSubmitButton)) {
        throw new TypeError('requestSubmit submitter must belong to the form and be a submit button')
      }
      if (!this.noValidate && !this.checkValidity()) return
      let event: Event
      if (typeof SubmitEvent === 'function') {
        event = new SubmitEvent('submit', { bubbles: true, cancelable: true, submitter })
      } else {
        event = new Event('submit', { bubbles: true, cancelable: true })
        Object.defineProperty(event, 'submitter', { value: submitter })
      }
      polyfilledSubmitEvents.add(event)
      this.dispatchEvent(event)
    },
  })

  // Submit-button clicks still enter jsdom's internal requestSubmit path.
  // Cancel that native-only fallback while leaving our polyfilled event untouched.
  window.addEventListener('submit', event => {
    if (!polyfilledSubmitEvents.has(event)) event.preventDefault()
  })

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
}
