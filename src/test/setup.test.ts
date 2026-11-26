import { describe, expect, it, vi } from 'vitest'

describe('HTMLFormElement.requestSubmit polyfill', () => {
  it('dispatches a cancelable submit event with the submitter', () => {
    const form = document.createElement('form')
    const button = document.createElement('button')
    button.type = 'submit'
    form.append(button)
    document.body.append(form)
    const listener = vi.fn((event: SubmitEvent) => event.preventDefault())
    form.addEventListener('submit', listener)

    form.requestSubmit(button)

    expect(listener).toHaveBeenCalledOnce()
    expect(listener.mock.calls[0]![0]).toMatchObject({ cancelable: true, submitter: button })
    expect(listener.mock.calls[0]![0].defaultPrevented).toBe(true)
  })

  it('rejects a submitter outside the form or a non-submit button', () => {
    const form = document.createElement('form')
    const otherForm = document.createElement('form')
    const foreign = document.createElement('button')
    const reset = document.createElement('button')
    foreign.type = 'submit'
    reset.type = 'reset'
    otherForm.append(foreign)

    expect(() => form.requestSubmit(foreign)).toThrow(TypeError)
    expect(() => form.requestSubmit(reset)).toThrow(TypeError)
  })

  it('does not dispatch submit while constraint validation fails', () => {
    const form = document.createElement('form')
    const input = document.createElement('input')
    input.required = true
    form.append(input)
    const submit = vi.fn()
    const invalid = vi.fn()
    form.addEventListener('submit', submit)
    input.addEventListener('invalid', invalid)

    form.requestSubmit()

    expect(submit).not.toHaveBeenCalled()
    expect(invalid).toHaveBeenCalled()
  })
})
