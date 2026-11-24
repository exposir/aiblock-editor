import { useEffect, useRef } from 'react'
import type { SlashItem } from '../extensions/slash-search'

export interface SlashMenuProps {
  readonly items: readonly SlashItem[]
  readonly activeIndex: number
  readonly choose: (item: SlashItem) => void
}

export function SlashMenu({ items, activeIndex, choose }: SlashMenuProps) {
  const active = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    active.current?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex, items])

  return (
    <div className="slash-menu overlay-card" role="listbox" aria-label="插入块">
      {items.length === 0 && <p className="slash-empty" role="status">没有匹配的块</p>}
      {items.map((item, index) => (
        <div key={item.id} role="presentation">
          {item.group !== items[index - 1]?.group && <div className="slash-group" role="presentation">{item.group}</div>}
          <button ref={index === activeIndex ? active : undefined} type="button" role="option"
            aria-selected={index === activeIndex} tabIndex={-1}
            onMouseDown={event => event.preventDefault()} onClick={() => choose(item)}>
            <span>{item.label}</span><span className="slash-english">{item.english}</span>
          </button>
        </div>
      ))}
    </div>
  )
}
