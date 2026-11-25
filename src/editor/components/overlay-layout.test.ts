import { afterEach, describe, expect, it } from 'vitest'
import { findOverlayHost, subscribeOverlayLayout } from './overlay-layout'

function wait(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

afterEach(() => {
  document.body.replaceChildren()
})

describe('document overlay layout', () => {
  // @partition host lookup: the layer is a sibling of the editable root, outside contenteditable
  it('finds the overlay host inside the document surface but outside contenteditable', () => {
    document.body.innerHTML = `
      <main data-document-surface>
        <div class="editor-content">
          <div data-document-overlays></div>
          <div class="ProseMirror" contenteditable="true"><p><span id="anchor"></span></p></div>
        </div>
      </main>`
    const anchor = document.getElementById('anchor')!
    const host = findOverlayHost(anchor)
    expect(host).toBe(document.querySelector('[data-document-overlays]'))
    expect(anchor.closest('.ProseMirror')?.parentElement?.contains(host)).toBe(true)
    expect(host?.closest('[contenteditable]')).toBeNull()
  })

  it('returns null when the editor is rendered outside a document surface', () => {
    document.body.innerHTML = '<div class="ProseMirror"><span id="anchor"></span></div>'
    expect(findOverlayHost(document.getElementById('anchor')!)).toBeNull()
  })

  // @partition scheduling: mutations coalesce into one frame and stop after unsubscribe
  it('re-measures once per frame after mutations and detaches cleanly', async () => {
    const root = document.createElement('div')
    root.innerHTML = '<p>a</p>'
    document.body.append(root)
    let calls = 0
    const stop = subscribeOverlayLayout(root, () => { calls += 1 })

    root.querySelector('p')!.textContent = 'b'
    root.append(document.createElement('p'))
    await wait(80)
    expect(calls).toBe(1)

    stop()
    root.append(document.createElement('p'))
    await wait(80)
    expect(calls).toBe(1)
  })

  it('shares one observer between subscribers and notifies all of them', async () => {
    const root = document.createElement('div')
    document.body.append(root)
    const calls: string[] = []
    const stopA = subscribeOverlayLayout(root, () => { calls.push('a') })
    const stopB = subscribeOverlayLayout(root, () => { calls.push('b') })

    root.append(document.createElement('p'))
    await wait(80)
    expect(calls.sort()).toEqual(['a', 'b'])

    stopA()
    stopB()
  })

  it('scheduling: all controls read the same layout before any applies changes', async () => {
    const root = document.createElement('div')
    document.body.append(root)
    let updated = false
    let finish!: () => void
    const complete = new Promise<void>(resolve => { finish = resolve })
    let readBeforeCommit = false
    const stopFirst = subscribeOverlayLayout(root, rect => {
      rect(root)
      return () => { updated = true }
    })
    const stopSecond = subscribeOverlayLayout(root, rect => {
      readBeforeCommit = !updated && rect(root) === rect(root)
      return finish
    })
    try {
      root.append(document.createElement('p'))
      await complete
      expect(readBeforeCommit).toBe(true)
      expect(updated).toBe(true)
    } finally {
      stopFirst()
      stopSecond()
    }
  })
})
