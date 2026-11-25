import { mergeAttributes } from '@tiptap/core'
import TaskItem from '@tiptap/extension-task-item'
import { floatingBlockControl } from '../components/FloatingBlockControl'
import { controlIcon, syncBlockAttributes } from './attached-node-view'

export const PortalTaskItem = TaskItem.extend({
  renderHTML({ HTMLAttributes }) {
    return ['li', mergeAttributes(HTMLAttributes, { 'data-type': this.name }), ['div', 0]]
  },

  addNodeView() {
    return ({ editor, node: initial, view, getPos }) => {
      const owner = view.dom.ownerDocument
      const dom = owner.createElement('li')
      dom.dataset.type = 'taskItem'
      const body = owner.createElement('div')
      body.className = 'task-item-view'
      const contentDOM = owner.createElement('div')
      contentDOM.className = 'task-item-content'
      dom.append(body)
      let node = initial
      const control = floatingBlockControl(editor, view, dom, 'task-checkbox', (button, signal) => {
        button.setAttribute('role', 'checkbox')
        controlIcon(button, 'm4 12 5 5L20 6')
        button.addEventListener('mousedown', event => event.preventDefault(), { signal })
        button.addEventListener('click', () => {
          const pos = getPos()
          if (typeof pos === 'number' && editor.isEditable) view.dispatch(view.state.tr.setNodeAttribute(pos, 'checked', node.attrs.checked !== true))
        }, { signal })
      }, button => {
        button.disabled = !editor.isEditable
        button.setAttribute('aria-label', node.firstChild?.textContent || '待办事项')
        button.setAttribute('aria-checked', String(node.attrs.checked === true))
      })
      body.append(control.anchor, contentDOM)
      function sync() {
        syncBlockAttributes(dom, node)
        dom.dataset.checked = String(node.attrs.checked === true)
      }
      sync()
      return {
        dom, contentDOM,
        update(next) {
          if (next.type !== node.type) return false
          const markup = next.sameMarkup(node)
          node = next
          if (!markup) sync()
          control.refresh()
          return true
        },
        ignoreMutation: mutation => mutation.type !== 'selection' && !contentDOM.contains(mutation.target),
        destroy: control.destroy,
      }
    }
  },
}).configure({ nested: true })
