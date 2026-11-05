// L84d：DSH 宿主原语的薄适配层。
// 这里只转换调用面，不实现焦点圈、portal、定位、计时或第二套弹层。

const TOOLTIP_ICONS = Object.freeze({
  question: 'IconQuestionOutlineMedium',
  info: 'IconInfoOutlineMedium',
  warn: 'IconWarningOutlineMedium',
  warning: 'IconWarningOutlineMedium',
  alert: 'IconWarningOutlineMedium',
})

/** 只清除 id 仍相同的 Toast；旧 Toast 的完成回调不能清除新通知。 */
export function dismissToast(current, id) {
  return current && current.id === id ? null : current
}

/**
 * 用宿主注入的 React 与 @deepseek-ai/dsh-client-ui-primitives 创建适配器。
 * 原语必须由调用方通过 factory require 取得；本模块不做文件系统包解析。
 */
export function createHostUi({ React, primitives } = {}) {
  if (!React || typeof React.createElement !== 'function' || typeof React.isValidElement !== 'function') {
    throw new TypeError('createHostUi 需要宿主 React.createElement 与 React.isValidElement')
  }
  if (!primitives || (typeof primitives !== 'object' && typeof primitives !== 'function')) {
    throw new TypeError('createHostUi 需要 DSH primitives')
  }

  const h = React.createElement
  const primitive = (name) => {
    const value = primitives[name]
    if (!value) {
      throw new Error(`DSH primitives.${name} 不可用；适配层不会创建替代弹层`)
    }
    return value
  }

  function Modal({ open, title, description, footer, onClose, className, children } = {}) {
    if (!open) return null
    return h(primitive('Modal'), {
      open,
      title,
      description,
      footer,
      onClose,
      className,
      closeLabel: '关闭',
    }, children)
  }

  function Toast({ item, onDone } = {}) {
    if (item === null || item === undefined) return null
    return h(primitive('Toast'), {
      key: item.id,
      text: item.text,
      tone: item.tone,
      holdMs: 3000,
      // success 由宿主生成内建勾；error 必须显式使用官方 warning icon。
      icon: item.tone === 'error' ? h(primitive('IconWarningOutlineMedium')) : undefined,
      // 宿主 onDone 不带参数；这里只把完成项 id 交回调用方做 id guard。
      onDone: () => onDone(item.id),
    })
  }

  const defaultTooltipIcon = (icon) => {
    if (React.isValidElement(icon)) return icon
    // 与现有 InfoTip 一样，未识别的字符串回退到 question，但不自绘 SVG。
    const exportName = TOOLTIP_ICONS[icon] || TOOLTIP_ICONS.question
    return h(primitive(exportName))
  }

  function Tooltip({ text, icon = 'question', warn = false, children } = {}) {
    const HostTooltip = primitive('Tooltip')
    // children 可替换 trigger；省略时保留 InfoTip 的 button / dt-info 调用面。
    const trigger = children === undefined
      ? h('button', {
          type: 'button',
          className: ['dt-info', warn && 'dt-info-warn'].filter(Boolean).join(' '),
          'aria-label': text,
        }, defaultTooltipIcon(icon))
      : children
    if (!React.isValidElement(trigger)) {
      throw new TypeError('Tooltip children 必须是单个 React element')
    }
    return h(HostTooltip, {
      label: text,
      side: 'top',
      portal: true,
      openOnClick: true,
      gap: 8,
    }, trigger)
  }

  // 无第二套 timer：notify 只替换当前项，dismiss 交给 Toast.onDone(id) 调用。
  function createToastState() {
    const [item, setItem] = React.useState(null)
    const sequence = React.useRef(0)
    const notify = React.useCallback((text, tone = 'info') => {
      sequence.current += 1
      const id = sequence.current
      setItem({ id, text, tone })
      return id
    }, [])
    const dismiss = React.useCallback((id) => {
      setItem((current) => dismissToast(current, id))
    }, [])
    return { item, notify, dismiss }
  }

  return { Modal, Toast, Tooltip, createToastState, dismissToast }
}
