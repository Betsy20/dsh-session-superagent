// L84e：StatusOrbit 的宿主弹层薄适配器。
// 定位与外点交给 DSH primitives；portal 交给宿主 react-dom 注入的 createPortal。
// 这里不包含 watcher 轮询、行数据、删除请求、确认 Modal 或另一套定位实现。

const DEFAULT_ORBIT_Z_INDEX = 1100

function focusIfConnected(node) {
  if (!node || typeof node.focus !== 'function') return false
  if ('isConnected' in node && !node.isConnected) return false
  try {
    node.focus()
    return true
  } catch {
    return false
  }
}

function closeReason(detail) {
  // DSH useDismissOnOutsidePointer 固定调用 close(false)。
  if (detail === false) return { reason: 'outside-pointer' }
  if (typeof detail === 'string') return { reason: detail }
  if (detail && typeof detail === 'object' && typeof detail.reason === 'string') return detail
  return { reason: 'dismiss' }
}

/**
 * 用宿主注入的 React 与 @deepseek-ai/dsh-client-ui-primitives 创建 Orbit 弹层。
 *
 * React.createPortal 必须由调用方从宿主 react-dom 注入；普通 React export 没有它。
 * 缺少任何必需能力都会显式报错，由调用方决定是否完整保留旧实现。
 */
export function createOrbitPopover({ React, primitives } = {}) {
  if (!React || typeof React.createElement !== 'function') {
    throw new TypeError('createOrbitPopover 需要宿主 React.createElement')
  }
  for (const hook of ['useRef', 'useCallback', 'useEffect']) {
    if (typeof React[hook] !== 'function') {
      throw new TypeError(`createOrbitPopover 需要宿主 React.${hook}`)
    }
  }
  if (typeof React.createPortal !== 'function') {
    throw new TypeError('createOrbitPopover 需要宿主 React.createPortal（从 react-dom 注入）')
  }
  if (!primitives || (typeof primitives !== 'object' && typeof primitives !== 'function')) {
    throw new TypeError('createOrbitPopover 需要 DSH primitives')
  }

  const primitive = (name, kind) => {
    const value = primitives[name]
    if (kind === 'function' ? typeof value !== 'function' : !value) {
      throw new Error(`DSH primitives.${name} 不可用；OrbitPopover 不会创建替代弹层`)
    }
    return value
  }
  const useAnchoredPosition = primitive('useAnchoredPosition', 'function')
  const useDismissOnOutsidePointer = primitive('useDismissOnOutsidePointer', 'function')
  const MenuSurface = primitive('MenuSurface')
  const h = React.createElement
  const createPortal = React.createPortal

  /**
   * 非 Modal 的 orbit 主 surface。width 必须由调用方按业务内容给出（例如 252/368）。
   * side/align 不开放成 props，避免误传宿主未实现的 center 或虚构自动 flip。
   */
  function OrbitPopover({
    open,
    anchorRef,
    orbitRef,
    panelRef: suppliedPanelRef,
    onClose,
    width,
    zIndex = DEFAULT_ORBIT_Z_INDEX,
    portalTarget: suppliedPortalTarget,
    className,
    style,
    ariaLabel,
    children,
  } = {}) {
    const internalPanelRef = React.useRef(null)
    const panelRef = suppliedPanelRef || internalPanelRef
    const returnFocusRef = orbitRef || anchorRef
    const onCloseRef = React.useRef(onClose)
    onCloseRef.current = onClose

    // stable close：父级轮询重渲染只更新 ref，不重建外点 effect 或焦点 effect。
    const close = React.useCallback((detail) => {
      const callback = onCloseRef.current
      if (typeof callback === 'function') callback(closeReason(detail))
    }, [])

    // 两个宿主 hooks 与本地 effect 都在 if (!open) return 之前无条件调用。
    const position = useAnchoredPosition({
      open: Boolean(open),
      anchorRef,
      panelRef,
      side: 'top',
      align: 'end',
      gap: 8,
      margin: 8,
    })
    useDismissOnOutsidePointer(panelRef, Boolean(open), close, anchorRef)

    const portalTarget = suppliedPortalTarget === undefined
      ? (typeof document !== 'undefined' ? document.body : null)
      : suppliedPortalTarget
    const ownerDocument = portalTarget && portalTarget.ownerDocument
      ? portalTarget.ownerDocument
      : (typeof document !== 'undefined' ? document : null)

    React.useEffect(() => {
      if (!open || !ownerDocument || typeof ownerDocument.addEventListener !== 'function') return undefined

      // effect 在 portal mount 后运行；非 Modal dialog 自身接收初始焦点，不做焦点陷阱。
      focusIfConnected(panelRef.current)
      const onKeyDown = (event) => {
        if (!event || event.key !== 'Escape' || event.repeat) return
        if (typeof event.preventDefault === 'function') event.preventDefault()
        if (typeof event.stopPropagation === 'function') event.stopPropagation()
        close({ reason: 'escape' })
      }
      ownerDocument.addEventListener('keydown', onKeyDown, true)
      return () => {
        ownerDocument.removeEventListener('keydown', onKeyDown, true)
        // 永远回圆环，不回面板里可能已随关闭/删除卸载的按钮。
        focusIfConnected(returnFocusRef && returnFocusRef.current)
      }
    }, [open, close, ownerDocument, panelRef, returnFocusRef])

    if (!open) return null
    if (!anchorRef || typeof anchorRef !== 'object') {
      throw new TypeError('OrbitPopover 需要调用方传入 anchorRef')
    }
    if (!Number.isFinite(width) || width <= 0) {
      throw new TypeError('OrbitPopover 需要调用方传入正数 width；适配器不推导业务宽度')
    }
    if (!portalTarget) {
      throw new Error('OrbitPopover portal target 不可用；不会退化为非 portal surface')
    }

    const surface = h(MenuSurface, {
      ref: panelRef,
      role: 'dialog',
      'aria-label': ariaLabel,
      tabIndex: -1,
      className,
      style: {
        ...style,
        position: 'fixed',
        left: position ? position.left : 0,
        top: position ? position.top : 0,
        width,
        zIndex,
        // useAnchoredPosition 首帧尚未测量时不在 0,0 闪现；不自行计算另一套坐标。
        visibility: position ? 'visible' : 'hidden',
      },
    }, children)
    return createPortal(surface, portalTarget)
  }

  /**
   * 删除确认的调用方策略。此 hook 不创建 Modal，也不保存 watcher/请求状态。
   * requestConfirm 永远先关闭 orbit，再调用可选 onRequestConfirm 打开调用方的确认层。
   */
  function useOrbitConfirm({ orbitRef, onCloseOrbit, onRequestConfirm } = {}) {
    const orbitRefRef = React.useRef(orbitRef)
    const onCloseOrbitRef = React.useRef(onCloseOrbit)
    const onRequestConfirmRef = React.useRef(onRequestConfirm)
    const restoreFocusRef = React.useRef(null)
    orbitRefRef.current = orbitRef
    onCloseOrbitRef.current = onCloseOrbit
    onRequestConfirmRef.current = onRequestConfirm

    const requestConfirm = React.useCallback((detail = {}) => {
      restoreFocusRef.current = 'orbit'
      if (typeof onCloseOrbitRef.current === 'function') {
        onCloseOrbitRef.current({ reason: 'confirm' })
      }
      const request = onRequestConfirmRef.current
      if (typeof request === 'function') {
        const extra = detail && typeof detail === 'object' ? detail : { value: detail }
        return request({ ...extra, reason: 'confirm', restoreFocus: 'orbit' })
      }
      return undefined
    }, [])

    const onConfirmClose = React.useCallback(() => {
      if (restoreFocusRef.current !== 'orbit') return false
      restoreFocusRef.current = null
      const ref = orbitRefRef.current
      // 特意只读取圆环 ref；requestConfirm 的删除按钮/opener 不参与焦点归还。
      return focusIfConnected(ref && ref.current)
    }, [])

    return {
      onRequestConfirm: requestConfirm,
      onConfirmClose,
      restoreFocus: restoreFocusRef.current,
    }
  }

  return { OrbitPopover, useOrbitConfirm }
}
