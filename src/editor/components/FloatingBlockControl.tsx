import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ComponentPropsWithoutRef, FocusEvent as ReactFocusEvent, PointerEvent as ReactPointerEvent } from 'react'
import { createPortal } from 'react-dom'
import { overlayOrigin } from './overlay-geometry'
import { findOverlayHost, subscribeOverlayLayout } from './overlay-layout'

interface FloatingBlockControlProps extends ComponentPropsWithoutRef<'button'> {
  readonly revealOnHover?: boolean
}

function placeButton(anchor: HTMLElement, button: HTMLButtonElement, host: HTMLElement) {
  const origin = overlayOrigin(host)
  const rect = anchor.getBoundingClientRect()
  button.hidden = !rect.width || !rect.height || !!anchor.closest('[inert]')
  button.style.left = `${rect.left - origin.x}px`
  button.style.top = `${rect.top - origin.y}px`
  button.style.width = `${rect.width}px`
  button.style.height = `${rect.height}px`
}

export function FloatingBlockControl({ className, style, revealOnHover = false, ...props }: FloatingBlockControlProps) {
  const [anchor, setAnchor] = useState<HTMLSpanElement | null>(null)
  const [host, setHost] = useState<HTMLElement | null>(null)
  const [button, setButton] = useState<HTMLButtonElement | null>(null)
  const [revealed, setRevealed] = useState(!revealOnHover)
  const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const attach = useCallback((node: HTMLSpanElement | null) => {
    setAnchor(node)
    setHost(node ? findOverlayHost(node) : null)
  }, [])

  const reveal = useCallback(() => {
    clearTimeout(hideTimer.current)
    setRevealed(true)
  }, [])
  const conceal = useCallback(() => {
    clearTimeout(hideTimer.current)
    hideTimer.current = setTimeout(() => setRevealed(false), 140)
  }, [])

  useLayoutEffect(() => {
    if (anchor && button && host) placeButton(anchor, button, host)
  })

  useLayoutEffect(() => {
    if (anchor && !host) setHost(findOverlayHost(anchor))
  })

  useLayoutEffect(() => {
    if (!anchor || !button || !host) return
    const editorRoot = anchor.closest<HTMLElement>('.ProseMirror') ?? anchor.parentElement
    const place = () => placeButton(anchor, button, host)
    const stop = editorRoot ? subscribeOverlayLayout(editorRoot, place) : null
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(place) : null
    observer?.observe(anchor)
    return () => {
      observer?.disconnect()
      stop?.()
    }
  }, [anchor, button, host])

  useEffect(() => {
    if (!revealOnHover || !anchor) return
    const surface = anchor.closest('.callout') ?? anchor.parentElement
    if (!surface) return
    const enter = () => reveal()
    const leave = () => conceal()
    if (surface.matches(':hover')) reveal()
    surface.addEventListener('pointerenter', enter)
    surface.addEventListener('pointerleave', leave)
    return () => {
      clearTimeout(hideTimer.current)
      surface.removeEventListener('pointerenter', enter)
      surface.removeEventListener('pointerleave', leave)
    }
  }, [anchor, conceal, reveal, revealOnHover])

  const revealHandlers = revealOnHover ? {
    onPointerEnter: (event: ReactPointerEvent<HTMLButtonElement>) => {
      reveal()
      props.onPointerEnter?.(event)
    },
    onPointerLeave: (event: ReactPointerEvent<HTMLButtonElement>) => {
      conceal()
      props.onPointerLeave?.(event)
    },
    onFocus: (event: ReactFocusEvent<HTMLButtonElement>) => {
      reveal()
      props.onFocus?.(event)
    },
    onBlur: (event: ReactFocusEvent<HTMLButtonElement>) => {
      conceal()
      props.onBlur?.(event)
    },
  } : {}

  return (
    <>
      <span ref={attach} className={`block-control-anchor ${className ?? ''}`}
        style={style} contentEditable={false} aria-hidden="true" />
      {anchor && host && createPortal(
        <button ref={setButton} type="button" contentEditable={false}
          className={`floating-block-control ${className ?? ''}${revealOnHover && revealed ? ' is-revealed' : ''}`}
          {...props} {...revealHandlers} />,
        host,
      )}
    </>
  )
}
