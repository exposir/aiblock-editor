import { Editor } from '@tiptap/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createEditorExtensions } from '../extensions'
import { revealAnchor, revealBlock } from './reveal-anchor'

const editors: Editor[] = []
function editor(content: string) {
  const instance = new Editor({ extensions: createEditorExtensions(), content })
  editors.push(instance)
  return instance
}

afterEach(() => {
  for (const instance of editors.splice(0)) instance.destroy()
  vi.restoreAllMocks()
})

describe('revealAnchor', () => {
  /*
   * Testing strategy
   * @partition heading: 普通块滚动、居中动画、减少动态
   * @partition toggle: 关闭折叠先展开，等过渡结束后滚动
   * @partition cancellation: 切页或卸载取消帧和动画
   * @partition invalid: 未知 block id、断开的 DOM
   */
  it('heading: 下一帧滚动到目标并播放暖陶土高亮', () => {
    const instance = editor('<h2 data-block-id="section">发布安排</h2>')
    const win = instance.view.dom.ownerDocument.defaultView!
    const target = instance.view.nodeDOM(1) as HTMLElement
    const scroll = vi.fn()
    Object.defineProperty(target, 'scrollIntoView', { value: scroll })
    Object.defineProperty(target, 'animate', { value: vi.fn(() => ({ cancel: vi.fn() })) })
    Object.defineProperty(target, 'closest', { value: () => null })
    Object.defineProperty(target, 'isConnected', { value: true })
    Object.defineProperty(instance.view.dom, 'querySelector', { value: () => target })
    vi.stubGlobal('matchMedia', vi.fn(() => ({
      matches: true, media: '(prefers-reduced-motion: reduce)', onchange: null,
      addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false,
    })))
    const raf = vi.spyOn(win, 'requestAnimationFrame').mockReturnValue(1)
    revealAnchor(instance, 2, () => target)
    raf.mock.calls[0]![0](0)
    expect(scroll).toHaveBeenCalledWith({ behavior: 'auto', block: 'start' })
    expect(target.animate).toHaveBeenCalledWith([
      { boxShadow: '0 0 0 4px var(--terracotta-border)' }, { boxShadow: '0 0 0 4px transparent' },
    ], { duration: 450 })
  })

  it('toggle: 关闭的分支先展开并等待过渡，再滚动', async () => {
    const instance = editor(`<div data-toggle data-open="false">
      <div data-toggle-summary>技术细节</div>
      <div data-toggle-content><h2 data-block-id="inner">内部章节</h2></div>
    </div>`)
    const target = document.createElement('div')
    target.setAttribute('data-toggle-content', '')
    const win = instance.view.dom.ownerDocument.defaultView!
    const scroll = vi.fn()
    Object.defineProperty(target, 'scrollIntoView', { value: scroll })
    Object.defineProperty(target, 'animate', { value: vi.fn(() => ({ cancel: vi.fn() })) })
    Object.defineProperty(target, 'closest', { value: () => target })
    Object.defineProperty(target, 'isConnected', { value: true })
    Object.defineProperty(target, 'getAnimations', { value: () => [] })
    const raf = vi.spyOn(win, 'requestAnimationFrame').mockReturnValue(1)
    revealAnchor(instance, 3, () => target)
    raf.mock.calls[0]![0](0)
    expect(instance.getJSON().content?.[0]?.attrs?.open).toBe(true)
    await Promise.resolve()
    expect(scroll).toHaveBeenCalledOnce()
  })

  it('invalid: 未知 block id 不执行滚动，返回 undefined', () => {
    const instance = editor('<p>普通正文</p>')
    expect(revealBlock(instance, 'not-found')).toBeUndefined()
  })

  it('cancellation: 取消帧后不再滚动或播放动画', () => {
    const instance = editor('<h2 data-block-id="section">发布安排</h2>')
    const target = instance.view.nodeDOM(1) as HTMLElement
    const win = instance.view.dom.ownerDocument.defaultView!
    const scroll = vi.fn()
    const animate = vi.fn(() => ({ cancel: vi.fn() }))
    Object.defineProperty(target, 'scrollIntoView', { value: scroll })
    Object.defineProperty(target, 'animate', { value: animate })
    let callback: FrameRequestCallback = () => {}
    const raf = vi.spyOn(win, 'requestAnimationFrame').mockImplementation(value => {
      callback = value
      return 5
    })
    const cancelFrame = vi.spyOn(win, 'cancelAnimationFrame')
    const cleanup = revealAnchor(instance, 2, () => target)!
    cleanup()
    callback(0)
    expect(raf).toHaveBeenCalledOnce()
    expect(cancelFrame).toHaveBeenCalledWith(5)
    expect(scroll).not.toHaveBeenCalled()
    expect(animate).not.toHaveBeenCalled()
  })
})
