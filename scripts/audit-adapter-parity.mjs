#!/usr/bin/env node
// 独立 ESM 适配器与 client.js 内联 UMD 适配器的结构化同源审计。
// 不依赖第三方 parser：先按词法边界抽取函数/调用/对象实参，再比较语义字段。
// 因此注释、格式化以及 h/hostH、React/HostReact 等合法 UMD 适配差异不会误报。

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const MISSING = Symbol('missing')

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// 把注释与字符串内容打空，但保留长度和换行；所有括号/调用定位都在 mask 上进行。
// 模板字符串整体视为字面量；目标适配器不把待审计调用藏在模板插值中。
function maskSource(source) {
  const output = source.split('')
  let state = 'code'
  let quote = ''
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]
    const next = source[index + 1]
    if (state === 'line-comment') {
      if (char === '\n') state = 'code'
      else output[index] = ' '
      continue
    }
    if (state === 'block-comment') {
      if (char === '*' && next === '/') {
        output[index] = output[index + 1] = ' '
        index += 1
        state = 'code'
      } else if (char !== '\n') output[index] = ' '
      continue
    }
    if (state === 'string') {
      if (char === '\\') {
        output[index] = ' '
        if (index + 1 < source.length) {
          if (source[index + 1] !== '\n') output[index + 1] = ' '
          index += 1
        }
      } else {
        if (char !== '\n') output[index] = ' '
        if (char === quote) state = 'code'
      }
      continue
    }
    if (char === '/' && next === '/') {
      output[index] = output[index + 1] = ' '
      index += 1
      state = 'line-comment'
    } else if (char === '/' && next === '*') {
      output[index] = output[index + 1] = ' '
      index += 1
      state = 'block-comment'
    } else if (char === "'" || char === '"' || char === '`') {
      output[index] = ' '
      quote = char
      state = 'string'
    }
  }
  return output.join('')
}

function stripComments(source) {
  const output = source.split('')
  let state = 'code'
  let quote = ''
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]
    const next = source[index + 1]
    if (state === 'line-comment') {
      if (char === '\n') state = 'code'
      else output[index] = ' '
      continue
    }
    if (state === 'block-comment') {
      if (char === '*' && next === '/') {
        output[index] = output[index + 1] = ' '
        index += 1
        state = 'code'
      } else if (char !== '\n') output[index] = ' '
      continue
    }
    if (state === 'string') {
      if (char === '\\') index += 1
      else if (char === quote) state = 'code'
      continue
    }
    if (char === '/' && next === '/') {
      output[index] = output[index + 1] = ' '
      index += 1
      state = 'line-comment'
    } else if (char === '/' && next === '*') {
      output[index] = output[index + 1] = ' '
      index += 1
      state = 'block-comment'
    } else if (char === "'" || char === '"' || char === '`') {
      quote = char
      state = 'string'
    }
  }
  return output.join('')
}

function matchingDelimiter(source, openIndex) {
  const pairs = { '(': ')', '{': '}', '[': ']' }
  const open = source[openIndex]
  const close = pairs[open]
  if (!close) throw new Error(`位置 ${openIndex} 不是支持的左括号`)
  const masked = maskSource(source)
  let depth = 0
  for (let index = openIndex; index < source.length; index += 1) {
    if (masked[index] === open) depth += 1
    else if (masked[index] === close) {
      depth -= 1
      if (depth === 0) return index
    }
  }
  throw new Error(`位置 ${openIndex} 的 ${open}${close} 不成对`)
}

function splitTopLevel(source, separator = ',') {
  const masked = maskSource(source)
  const parts = []
  const stack = []
  let start = 0
  const pairs = { '(': ')', '{': '}', '[': ']' }
  for (let index = 0; index <= source.length - separator.length; index += 1) {
    const char = masked[index]
    if (pairs[char]) stack.push(pairs[char])
    else if (char === stack.at(-1)) stack.pop()
    if (stack.length === 0 && masked.startsWith(separator, index)) {
      parts.push(source.slice(start, index))
      start = index + separator.length
      index += separator.length - 1
    }
  }
  parts.push(source.slice(start))
  return parts
}

function topLevelIndex(source, separator) {
  const parts = splitTopLevel(source, separator)
  if (parts.length === 1) return -1
  return parts[0].length
}

function cleanKey(value) {
  const key = value.trim()
  if ((key.startsWith("'") && key.endsWith("'")) || (key.startsWith('"') && key.endsWith('"'))) {
    return key.slice(1, -1)
  }
  return key
}

function parseObject(source) {
  const text = source.trim()
  if (!text.startsWith('{')) throw new Error(`不是对象字面量：${text.slice(0, 80)}`)
  const close = matchingDelimiter(text, 0)
  if (text.slice(close + 1).trim()) throw new Error(`对象字面量后有多余内容：${text.slice(close + 1, close + 81)}`)
  const properties = new Map()
  for (const rawEntry of splitTopLevel(text.slice(1, close))) {
    const entry = stripComments(rawEntry).trim()
    if (!entry) continue
    if (entry.startsWith('...')) {
      properties.set(entry.slice(3).trim(), { spread: true, value: entry })
      continue
    }
    const colon = topLevelIndex(entry, ':')
    if (colon >= 0) {
      const key = cleanKey(entry.slice(0, colon))
      properties.set(key, { value: entry.slice(colon + 1).trim() })
    } else {
      const key = cleanKey(entry)
      properties.set(key, { shorthand: true, value: key })
    }
  }
  return properties
}

function property(properties, key) {
  const entry = properties.get(key)
  return entry && !entry.spread ? entry.value : undefined
}

function parseDestructuredParam(params) {
  const start = params.indexOf('{')
  if (start < 0) return { keys: [], defaults: {} }
  const close = matchingDelimiter(params, start)
  const keys = []
  const defaults = {}
  for (const rawEntry of splitTopLevel(params.slice(start + 1, close))) {
    let entry = rawEntry.trim()
    if (!entry || entry.startsWith('...')) continue
    const colon = topLevelIndex(entry, ':')
    const key = cleanKey(colon >= 0 ? entry.slice(0, colon) : entry.split('=')[0])
    keys.push(key)
    if (colon >= 0) entry = entry.slice(colon + 1).trim()
    const equal = topLevelIndex(entry, '=')
    if (equal >= 0) defaults[key] = entry.slice(equal + 1).trim()
  }
  return { keys, defaults }
}

function extractFunction(source, name) {
  const masked = maskSource(source)
  const declaration = new RegExp(`\\bfunction\\s+${escapeRegExp(name)}\\s*\\(`).exec(masked)
  if (declaration) {
    const open = masked.indexOf('(', declaration.index)
    const close = matchingDelimiter(source, open)
    const bodyOpen = masked.indexOf('{', close + 1)
    if (bodyOpen < 0) throw new Error(`${name} 缺少函数体`)
    const bodyClose = matchingDelimiter(source, bodyOpen)
    return {
      name,
      params: source.slice(open + 1, close),
      body: source.slice(bodyOpen + 1, bodyClose),
      source: source.slice(declaration.index, bodyClose + 1),
    }
  }

  const assignment = new RegExp(`\\b(?:const|let|var)\\s+${escapeRegExp(name)}\\s*=`).exec(masked)
  if (!assignment) throw new Error(`找不到 function ${name} 或 ${name} = … =>`)
  const arrow = masked.indexOf('=>', assignment.index + assignment[0].length)
  if (arrow < 0) throw new Error(`${name} 不是可识别的箭头函数`)
  const bodyOpen = masked.indexOf('{', arrow + 2)
  if (bodyOpen < 0) throw new Error(`${name} 缺少箭头函数体`)
  const bodyClose = matchingDelimiter(source, bodyOpen)
  return {
    name,
    params: source.slice(assignment.index + assignment[0].length, arrow).trim(),
    body: source.slice(bodyOpen + 1, bodyClose),
    source: source.slice(assignment.index, bodyClose + 1),
  }
}

function findCalls(source, callee) {
  const masked = maskSource(source)
  const expression = typeof callee === 'string'
    ? new RegExp(`\\b${escapeRegExp(callee)}\\s*\\(`, 'g')
    : new RegExp(callee.source, callee.flags.includes('g') ? callee.flags : callee.flags + 'g')
  const calls = []
  let match
  while ((match = expression.exec(masked))) {
    const open = masked.indexOf('(', match.index + match[0].length - 1)
    const close = matchingDelimiter(source, open)
    calls.push({
      args: splitTopLevel(source.slice(open + 1, close)).map((arg) => arg.trim()),
      start: match.index,
      end: close + 1,
      source: source.slice(match.index, close + 1),
    })
  }
  return calls
}

function findPropsCall(source, markers) {
  for (const call of findCalls(source, /\b(?:h|hostH)\s*\(/)) {
    if (!call.args[1] || !call.args[1].startsWith('{')) continue
    const props = parseObject(call.args[1])
    if (markers.every((marker) => props.has(marker))) return { call, props }
  }
  throw new Error(`找不到带 ${markers.join('/')} 的 React.createElement 实参对象`)
}

function findIfStatements(source) {
  const masked = maskSource(source)
  const statements = []
  const expression = /\bif\s*\(/g
  let match
  while ((match = expression.exec(masked))) {
    const open = masked.indexOf('(', match.index)
    const close = matchingDelimiter(source, open)
    let bodyOpen = close + 1
    while (/\s/.test(masked[bodyOpen] || '')) bodyOpen += 1
    let bodyEnd
    if (masked[bodyOpen] === '{') bodyEnd = matchingDelimiter(source, bodyOpen) + 1
    else {
      bodyEnd = masked.indexOf(';', bodyOpen)
      bodyEnd = bodyEnd < 0 ? source.length : bodyEnd + 1
    }
    statements.push({
      condition: source.slice(open + 1, close),
      body: source.slice(bodyOpen, bodyEnd),
      start: match.index,
      end: bodyEnd,
    })
  }
  return statements
}

function findTryCatch(source) {
  const masked = maskSource(source)
  const blocks = []
  const expression = /\btry\s*\{/g
  let match
  while ((match = expression.exec(masked))) {
    const tryOpen = masked.indexOf('{', match.index)
    const tryClose = matchingDelimiter(source, tryOpen)
    const catchMatch = /^\s*catch(?:\s*\([^)]*\))?\s*\{/.exec(masked.slice(tryClose + 1))
    if (!catchMatch) continue
    const catchOpen = tryClose + 1 + catchMatch[0].lastIndexOf('{')
    const catchClose = matchingDelimiter(source, catchOpen)
    blocks.push({
      tryBody: source.slice(tryOpen + 1, tryClose),
      catchBody: source.slice(catchOpen + 1, catchClose),
    })
  }
  return blocks
}

function expressionEnd(source, start) {
  const masked = maskSource(source)
  const stack = []
  const pairs = { '(': ')', '{': '}', '[': ']' }
  for (let index = start; index < source.length; index += 1) {
    const char = masked[index]
    if (pairs[char]) stack.push(pairs[char])
    else if (char === stack.at(-1)) stack.pop()
    if (stack.length > 0) continue
    if (char === ';') return index
    if (char !== '\n') continue
    let previous = index - 1
    while (previous >= start && /\s/.test(source[previous])) previous -= 1
    let next = index + 1
    while (next < source.length && /\s/.test(source[next])) next += 1
    const previousChar = source[previous] || ''
    const nextChar = source[next] || ''
    if ('=([{,:?&|+-*/!'.includes(previousChar)) continue
    if ('?.:)]},&|'.includes(nextChar)) continue
    return index
  }
  return source.length
}

function readVariable(source, name) {
  const masked = maskSource(source)
  const match = new RegExp(`\\b(?:const|let|var)\\s+${escapeRegExp(name)}\\s*=`).exec(masked)
  if (!match) return undefined
  const start = match.index + match[0].length
  return source.slice(start, expressionEnd(source, start)).trim()
}

function readLineConstant(source, name) {
  const masked = maskSource(source)
  const match = new RegExp(`\\bconst\\s+${escapeRegExp(name)}\\s*=`).exec(masked)
  if (!match) return undefined
  const start = match.index + match[0].length
  let end = source.indexOf('\n', start)
  if (end < 0) end = source.length
  return source.slice(start, end).replace(/;\s*$/, '').trim()
}

function readAssignment(source, left) {
  const masked = maskSource(source)
  const member = left.split('.').map(escapeRegExp).join('\\s*\\.\\s*')
  const match = new RegExp(`\\b${member}\\s*=`).exec(masked)
  if (!match) return undefined
  let start = match.index + match[0].length
  while (start < source.length && /\s/.test(source[start])) start += 1
  return {
    value: source.slice(start, expressionEnd(source, start)).trim(),
    start: match.index,
  }
}

function canonical(value) {
  if (value === undefined || value === null) return value
  if (Array.isArray(value)) return value.map(canonical)
  return stripComments(String(value))
    .replace(/\s+/g, '')
    .replace(/\bHostReact\b/g, 'React')
    .replace(/\bhostH\b/g, 'h')
    .replace(/"([^"\\]*)"/g, "'$1'")
}

function sameValue(left, right) {
  if (left === MISSING || right === MISSING) return false
  return JSON.stringify(left) === JSON.stringify(right)
}

function printable(value) {
  if (value === MISSING || value === undefined) return '<缺失>'
  if (typeof value === 'string') return value
  return JSON.stringify(value)
}

function makeAuditor() {
  const differences = []
  let checks = 0
  function push(path, standalone, inline, expected, detail) {
    differences.push({ path, standalone, inline, expected, detail })
  }
  return {
    differences,
    get checks() { return checks },
    parity(path, standalone, inline, ...expected) {
      checks += 1
      const expectedMismatch = expected.length === 1 && (
        !sameValue(standalone, expected[0]) || !sameValue(inline, expected[0])
      )
      if (!sameValue(standalone, inline) || expectedMismatch) {
        push(path, standalone, inline, expected[0], '独立适配器与 client.js 内联实现不一致')
      }
    },
    value(path, actual, expected, detail = 'client.js 回退条件不符合约定') {
      checks += 1
      if (!sameValue(actual, expected)) push(path, actual, MISSING, expected, detail)
    },
    section(path, run) {
      try { run() } catch (error) {
        differences.push({ path, detail: error instanceof Error ? error.message : String(error) })
      }
    },
  }
}

function effectWith(source, needle) {
  return findCalls(source, /\b(?:React|HostReact)\.useEffect\s*\(/)
    .find((call) => (call.args[0] || '').includes(needle))
}

function eventCall(source, method, eventName) {
  return findCalls(source, new RegExp(`\\.${method}\\s*\\(`))
    .find((call) => canonical(call.args[0]) === `'${eventName}'`)
}

function auditTooltipPair(audit, standaloneBody, inlineBody) {
  const scrollA = effectWith(standaloneBody, 'addEventListener')
  const scrollB = effectWith(inlineBody, 'addEventListener')
  const focusA = effectWith(standaloneBody, '.focus')
  const focusB = effectWith(inlineBody, '.focus')
  const regA = scrollA && eventCall(scrollA.args[0], 'addEventListener', 'scroll')
  const regB = scrollB && eventCall(scrollB.args[0], 'addEventListener', 'scroll')
  const closeA = regA && extractFunction(standaloneBody, regA.args[1])
  const closeB = regB && extractFunction(inlineBody, regB.args[1])
  const remountA = closeA && findCalls(closeA.body, 'setRemountKey')[0]
  const remountB = closeB && findCalls(closeB.body, 'setRemountKey')[0]
  const assignA = closeA && readAssignment(closeA.body, 'restoreFocusRef.current')
  const assignB = closeB && readAssignment(closeB.body, 'restoreFocusRef.current')
  const booleanA = closeA && findCalls(closeA.body, 'Boolean').find((call) => call.args[0]?.includes('activeElement'))
  const booleanB = closeB && findCalls(closeB.body, 'Boolean').find((call) => call.args[0]?.includes('activeElement'))
  const focusCallA = focusA && findCalls(focusA.args[0], /\.focus\s*\(/)[0]
  const focusCallB = focusB && findCalls(focusB.args[0], /\.focus\s*\(/)[0]
  const focusPropsA = focusCallA?.args[0]?.startsWith('{') ? parseObject(focusCallA.args[0]) : new Map()
  const focusPropsB = focusCallB?.args[0]?.startsWith('{') ? parseObject(focusCallB.args[0]) : new Map()
  const guardA = focusA && findIfStatements(focusA.args[0]).find((statement) => statement.body.includes('.focus'))
  const guardB = focusB && findIfStatements(focusB.args[0]).find((statement) => statement.body.includes('.focus'))
  const resetA = focusA && readAssignment(focusA.args[0], 'restoreFocusRef.current')
  const resetB = focusB && readAssignment(focusB.args[0], 'restoreFocusRef.current')

  audit.parity('host.Tooltip.scroll.capture', canonical(regA?.args[2]), canonical(regB?.args[2]), 'true')
  audit.parity('host.Tooltip.scroll.listener', canonical(regA?.args[1]), canonical(regB?.args[1]), 'closeOnScroll')
  audit.parity('host.Tooltip.scroll.remountUpdater', canonical(remountA?.args[0]), canonical(remountB?.args[0]), '(current)=>current+1')
  audit.parity('host.Tooltip.scroll.focusSnapshot', canonical(booleanA?.args[0]), canonical(booleanB?.args[0]))
  audit.parity('host.Tooltip.scroll.focusBeforeRemount', Boolean(assignA && remountA && assignA.start < remountA.start), Boolean(assignB && remountB && assignB.start < remountB.start), true)
  audit.parity('host.Tooltip.focus.effectDeps', canonical(focusA?.args[1]), canonical(focusB?.args[1]), '[remountKey]')
  audit.parity('host.Tooltip.focus.preventScroll', canonical(property(focusPropsA, 'preventScroll')), canonical(property(focusPropsB, 'preventScroll')), 'true')
  audit.parity('host.Tooltip.focus.connectedGuard', canonical(guardA?.condition), canonical(guardB?.condition))
  audit.parity('host.Tooltip.focus.consumeFlagBeforeFocus', Boolean(resetA && focusCallA && resetA.start < focusCallA.start), Boolean(resetB && focusCallB && resetB.start < focusCallB.start), true)
}

function auditHost(hostSource, clientSource, audit) {
  audit.section('host.Modal', () => {
    const standalone = extractFunction(hostSource, 'Modal')
    const inline = extractFunction(clientSource, 'HostModal')
    const paramA = parseDestructuredParam(standalone.params)
    const paramB = parseDestructuredParam(inline.params)
    const expectedParams = ['children', 'className', 'description', 'footer', 'onClose', 'open', 'title']
    audit.parity('host.Modal.props', paramA.keys.sort(), paramB.keys.sort(), expectedParams)
    const callA = findPropsCall(standalone.body, ['closeLabel'])
    const callB = findPropsCall(inline.body, ['closeLabel'])
    audit.parity('host.Modal.primitive', canonical(callA.call.args[0]), canonical(callB.call.args[0]), "primitive('Modal')")
    for (const key of expectedParams.filter((key) => key !== 'children')) {
      const expected = key === 'closeLabel' ? "'关闭'" : key
      audit.parity(`host.Modal.${key}`, canonical(property(callA.props, key)), canonical(property(callB.props, key)), expected)
    }
    audit.parity('host.Modal.closeLabel', canonical(property(callA.props, 'closeLabel')), canonical(property(callB.props, 'closeLabel')), "'关闭'")
    audit.parity('host.Modal.children', canonical(callA.call.args[2]), canonical(callB.call.args[2]), 'children')
  })

  audit.section('host.Toast', () => {
    const standalone = extractFunction(hostSource, 'Toast')
    const inline = extractFunction(clientSource, 'HostToast')
    const callA = findPropsCall(standalone.body, ['holdMs', 'onDone'])
    const callB = findPropsCall(inline.body, ['holdMs', 'onDone'])
    audit.parity('host.Toast.primitive', canonical(callA.call.args[0]), canonical(callB.call.args[0]), "primitive('Toast')")
    for (const [key, expected] of [['key', 'item.id'], ['text', 'item.text'], ['tone', 'item.tone'], ['holdMs', '3000']]) {
      audit.parity(`host.Toast.${key}`, canonical(property(callA.props, key)), canonical(property(callB.props, key)), expected)
    }
    const doneA = findCalls(property(callA.props, 'onDone') || '', 'onDone')[0]
    const doneB = findCalls(property(callB.props, 'onDone') || '', 'onDone')[0]
    audit.parity('host.Toast.onDone.id', canonical(doneA?.args), canonical(doneB?.args), ['item.id'])
    audit.parity('host.Toast.errorIcon', canonical(property(callA.props, 'icon')), canonical(property(callB.props, 'icon')))
  })

  audit.section('host.Tooltip', () => {
    const standalone = extractFunction(hostSource, 'Tooltip')
    const inline = extractFunction(clientSource, 'HostTooltip')
    const callA = findPropsCall(standalone.body, ['label', 'side'])
    const callB = findPropsCall(inline.body, ['label', 'side'])
    for (const [key, expected] of [
      ['key', 'remountKey'], ['label', 'text'], ['side', "'top'"], ['portal', 'true'],
      ['openOnClick', 'true'], ['gap', '8'],
    ]) {
      audit.parity(`host.Tooltip.${key}`, canonical(property(callA.props, key)), canonical(property(callB.props, key)), expected)
    }
    const primitiveA = findCalls(standalone.body, 'primitive').some((call) => canonical(call.args[0]) === "'Tooltip'")
    const primitiveB = findCalls(inline.body, 'primitive').some((call) => canonical(call.args[0]) === "'Tooltip'")
    audit.parity('host.Tooltip.primitive', primitiveA, primitiveB, true)
    auditTooltipPair(audit, standalone.body, inline.body)
  })
}

function andTerms(condition) {
  return condition === undefined ? undefined : splitTopLevel(condition, '&&').map(canonical).sort()
}

function assignmentIf(statements, needle, conditionNeedle) {
  return statements.find((statement) => statement.body.includes(needle)
    && (!conditionNeedle || statement.condition.includes(conditionNeedle)))
}

function auditFallbacks(clientSource, audit) {
  audit.section('host.fallback', () => {
    const statements = findIfStatements(clientSource)
    const modal = assignmentIf(statements, 'hostUi = createHostUi', 'primitives.Modal')
    const tooltip = assignmentIf(statements, 'hostTooltip = hostUi.Tooltip', 'primitives.Tooltip')
    audit.value('host.fallback.ModalToast', andTerms(modal?.condition), [
      'primitives', 'primitives.IconWarningOutlineMedium', 'primitives.Modal', 'primitives.Toast',
    ])
    audit.value('host.fallback.Tooltip', andTerms(tooltip?.condition), [
      'primitives.Tooltip', "typeofReact.forwardRef==='function'",
    ])
    const hostTry = findTryCatch(clientSource).find((block) => block.tryBody.includes('hostUi = createHostUi'))
    const catchMask = hostTry ? maskSource(hostTry.catchBody) : ''
    audit.value('host.fallback.catch.hostUi', /\bhostUi\s*=\s*null/.test(catchMask), true)
    audit.value('host.fallback.catch.hostTooltip', /\bhostTooltip\s*=\s*null/.test(catchMask), true)
    const infoTip = extractFunction(clientSource, 'InfoTip')
    const returned = infoTip.body.match(/return\s+([^\n;]+)/)
    audit.value('host.fallback.InfoTipBranch', canonical(returned?.[1]), 'hostTooltip?h(hostTooltip,props):h(FallbackInfoTip,props)')
  })

  audit.section('orbit.fallback', () => {
    const statements = findIfStatements(clientSource)
    const primitives = assignmentIf(statements, 'hostOrbit = createOrbitPopover', 'primitives.MenuSurface')
    const portal = assignmentIf(statements, 'hostOrbit = createOrbitPopover', 'reactDom.createPortal')
    audit.value('orbit.fallback.primitives', andTerms(primitives?.condition), [
      'primitives', 'primitives.MenuSurface', 'typeofprimitives.useAnchoredPosition===\'function\'',
      'typeofprimitives.useDismissOnOutsidePointer===\'function\'',
    ])
    audit.value('orbit.fallback.portal', andTerms(portal?.condition), [
      'reactDom', "typeofreactDom.createPortal==='function'",
    ])
    const orbitTry = findTryCatch(clientSource).find((block) => block.tryBody.includes('hostOrbit = createOrbitPopover'))
    audit.value('orbit.fallback.catch', /\bhostOrbit\s*=\s*null/.test(orbitTry ? maskSource(orbitTry.catchBody) : ''), true)
  })
}

function orbitParts(source) {
  const factory = extractFunction(source, 'createOrbitPopover')
  const popover = extractFunction(factory.body, 'OrbitPopover')
  const params = parseDestructuredParam(popover.params)
  const anchor = findCalls(popover.body, 'useAnchoredPosition')[0]
  if (!anchor?.args[0]) throw new Error('OrbitPopover 缺少 useAnchoredPosition 实参')
  const outside = findCalls(popover.body, 'useDismissOnOutsidePointer')[0]
  const surface = findPropsCall(popover.body, ['role', 'style'])
  const style = parseObject(property(surface.props, 'style'))
  const portal = findCalls(popover.body, 'createPortal')[0]
  const effect = effectWith(popover.body, 'keydown')
  const keydown = effect && eventCall(effect.args[0], 'addEventListener', 'keydown')
  const remove = effect && eventCall(effect.args[0], 'removeEventListener', 'keydown')
  const onKeyDown = keydown && extractFunction(effect.args[0], keydown.args[1])
  const escapeGuard = onKeyDown && findIfStatements(onKeyDown.body)
    .find((statement) => statement.condition.includes('event.key'))
  const escapeClose = onKeyDown && findCalls(onKeyDown.body, 'close')[0]
  const focusEffect = effectWith(popover.body, 'didFocusRef')
  const initialFocus = focusEffect && findCalls(focusEffect.args[0], 'focusIfConnected')
    .find((call) => canonical(call.args[0]) === 'panelRef.current')
  const returnFocus = effect && findCalls(effect.args[0], 'focusIfConnected')
    .find((call) => canonical(call.args[0]) === 'returnFocusRef&&returnFocusRef.current')
  const portalGuard = findIfStatements(popover.body)
    .find((statement) => canonical(statement.condition) === '!portalTarget')
  return {
    factory, popover, params, anchor, anchorProps: parseObject(anchor.args[0]), outside,
    surface, style, portal, effect, keydown, remove, onKeyDown, escapeGuard, escapeClose,
    initialFocus, returnFocus, portalGuard, focusEffect,
    zIndexConstant: readLineConstant(source, 'DEFAULT_ORBIT_Z_INDEX'),
    portalTarget: readVariable(popover.body, 'portalTarget'),
    returnFocusRef: readVariable(popover.body, 'returnFocusRef'),
  }
}

function auditOrbit(orbitSource, clientSource, audit) {
  audit.section('orbit.OrbitPopover', () => {
    const a = orbitParts(orbitSource)
    const b = orbitParts(clientSource)
    const expectedParams = ['anchorRef', 'ariaLabel', 'children', 'className', 'onClose', 'open', 'orbitRef', 'panelRef', 'portalTarget', 'style', 'width', 'zIndex']
    audit.parity('orbit.props', a.params.keys.sort(), b.params.keys.sort(), expectedParams)
    audit.parity('orbit.zIndex.defaultName', canonical(a.params.defaults.zIndex), canonical(b.params.defaults.zIndex), 'DEFAULT_ORBIT_Z_INDEX')
    audit.parity('orbit.zIndex.defaultValue', canonical(a.zIndexConstant), canonical(b.zIndexConstant), '1100')
    for (const [key, expected] of [
      ['open', 'Boolean(open)'], ['anchorRef', 'anchorRef'], ['panelRef', 'panelRef'],
      ['side', "'top'"], ['align', "'end'"], ['gap', '8'], ['margin', '8'],
    ]) {
      audit.parity(`orbit.anchor.${key}`, canonical(property(a.anchorProps, key)), canonical(property(b.anchorProps, key)), expected)
    }
    audit.parity('orbit.outsidePointer.args', canonical(a.outside?.args), canonical(b.outside?.args), ['panelRef', 'Boolean(open)', 'close', 'anchorRef'])
    audit.parity('orbit.role', canonical(property(a.surface.props, 'role')), canonical(property(b.surface.props, 'role')), "'dialog'")
    for (const [key, expected] of [
      ['position', "'fixed'"], ['left', 'position?position.left:0'], ['top', 'position?position.top:0'],
      ['width', 'width'], ['zIndex', 'zIndex'], ['visibility', "position?'visible':'hidden'"],
    ]) {
      audit.parity(`orbit.surface.${key}`, canonical(property(a.style, key)), canonical(property(b.style, key)), expected)
    }
    audit.parity('orbit.portal.args', canonical(a.portal?.args), canonical(b.portal?.args), ['surface', 'portalTarget'])
    audit.parity('orbit.portal.defaultTarget', canonical(a.portalTarget), canonical(b.portalTarget))
    audit.parity('orbit.portal.noInlineFallback', Boolean(a.portalGuard && /\bthrow\b/.test(maskSource(a.portalGuard.body))), Boolean(b.portalGuard && /\bthrow\b/.test(maskSource(b.portalGuard.body))), true)
    audit.parity('orbit.focus.returnTarget', canonical(a.returnFocusRef), canonical(b.returnFocusRef), 'orbitRef||anchorRef')
    audit.parity('orbit.focus.initialPanel', canonical(a.initialFocus?.args), canonical(b.initialFocus?.args), ['panelRef.current'])
    const visibleGuardA = a.focusEffect && findIfStatements(a.focusEffect.args[0]).find((statement) => statement.body.includes('focusIfConnected'))
    const visibleGuardB = b.focusEffect && findIfStatements(b.focusEffect.args[0]).find((statement) => statement.body.includes('focusIfConnected'))
    audit.parity('orbit.focus.visibleOnly', canonical(visibleGuardA?.condition), canonical(visibleGuardB?.condition), 'position&&!didFocusRef.current')
    const escapeReturnGuardA = findIfStatements(a.effect.args[0]).find((statement) => statement.condition.includes('closeReasonRef'))
    const escapeReturnGuardB = findIfStatements(b.effect.args[0]).find((statement) => statement.condition.includes('closeReasonRef'))
    audit.parity('orbit.focus.escapeOnlyReturn', canonical(escapeReturnGuardA?.condition), canonical(escapeReturnGuardB?.condition), "closeReasonRef.current==='escape'")
    audit.parity('orbit.keydown.capture', canonical(a.keydown?.args), canonical(b.keydown?.args), ["'keydown'", 'onKeyDown', 'true'])
    audit.parity('orbit.keydown.cleanup', canonical(a.remove?.args), canonical(b.remove?.args), ["'keydown'", 'onKeyDown', 'true'])
    audit.parity('orbit.Escape.guard', canonical(a.escapeGuard?.condition), canonical(b.escapeGuard?.condition), "!event||event.key!=='Escape'||event.repeat")
    const escapePropsA = a.escapeClose?.args[0]?.startsWith('{') ? parseObject(a.escapeClose.args[0]) : new Map()
    const escapePropsB = b.escapeClose?.args[0]?.startsWith('{') ? parseObject(b.escapeClose.args[0]) : new Map()
    audit.parity('orbit.Escape.reason', canonical(property(escapePropsA, 'reason')), canonical(property(escapePropsB, 'reason')), "'escape'")
    const preventedA = onKeyDownCalls(a.onKeyDown, 'preventDefault')
    const preventedB = onKeyDownCalls(b.onKeyDown, 'preventDefault')
    audit.parity('orbit.Escape.preventDefault', preventedA, preventedB, true)
    audit.parity('orbit.Escape.stopPropagation', onKeyDownCalls(a.onKeyDown, 'stopPropagation'), onKeyDownCalls(b.onKeyDown, 'stopPropagation'), true)
    audit.parity('orbit.focus.cleanupReturn', canonical(a.returnFocus?.args), canonical(b.returnFocus?.args), ['returnFocusRef&&returnFocusRef.current'])
    audit.parity('orbit.focus.cleanupAfterRemove', Boolean(a.remove && a.returnFocus && a.remove.start < a.returnFocus.start), Boolean(b.remove && b.returnFocus && b.remove.start < b.returnFocus.start), true)
  })
}

function onKeyDownCalls(handler, method) {
  if (!handler) return false
  return findCalls(handler.body, new RegExp(`\\bevent\\s*\\.\\s*${method}\\s*\\(`))
    .some((call) => call.args.length === 1 && call.args[0] === '')
}

function confirmParts(source) {
  const hook = extractFunction(source, 'useOrbitConfirm')
  const request = extractFunction(hook.body, 'requestConfirm')
  const close = extractFunction(hook.body, 'onConfirmClose')
  const restore = readAssignment(request.body, 'restoreFocusRef.current')
  const closeOrbit = findCalls(request.body, /onCloseOrbitRef\s*\.\s*current\s*\(/)[0]
  const requestConfirm = findCalls(request.body, 'request')[0]
  const closeGuard = findIfStatements(close.body)
    .find((statement) => statement.condition.includes('restoreFocusRef.current'))
  const clear = readAssignment(close.body, 'restoreFocusRef.current')
  const focus = findCalls(close.body, 'focusIfConnected')[0]
  return {
    hook, request, close, restore, closeOrbit, requestConfirm, closeGuard, clear, focus,
    closeProps: closeOrbit?.args[0]?.startsWith('{') ? parseObject(closeOrbit.args[0]) : new Map(),
    requestProps: requestConfirm?.args[0]?.startsWith('{') ? parseObject(requestConfirm.args[0]) : new Map(),
    orbitRef: readVariable(close.body, 'ref'),
  }
}

function auditConfirm(orbitSource, clientSource, audit) {
  audit.section('orbit.useOrbitConfirm', () => {
    const a = confirmParts(orbitSource)
    const b = confirmParts(clientSource)
    audit.parity('orbit.confirm.markRestoreFocus', canonical(a.restore?.value), canonical(b.restore?.value), "'orbit'")
    audit.parity('orbit.confirm.closeReason', canonical(property(a.closeProps, 'reason')), canonical(property(b.closeProps, 'reason')), "'confirm'")
    audit.parity('orbit.confirm.requestReason', canonical(property(a.requestProps, 'reason')), canonical(property(b.requestProps, 'reason')), "'confirm'")
    audit.parity('orbit.confirm.requestRestoreFocus', canonical(property(a.requestProps, 'restoreFocus')), canonical(property(b.requestProps, 'restoreFocus')), "'orbit'")
    audit.parity('orbit.confirm.preserveDetail', a.requestProps.get('extra')?.spread === true, b.requestProps.get('extra')?.spread === true, true)
    audit.parity('orbit.confirm.order', confirmOrder(a), confirmOrder(b), 'markRestoreFocus<closeOrbit<requestConfirm')
    audit.parity('orbit.confirm.closeGuard', canonical(a.closeGuard?.condition), canonical(b.closeGuard?.condition), "restoreFocusRef.current!=='orbit'")
    audit.parity('orbit.confirm.clearRestoreFocus', canonical(a.clear?.value), canonical(b.clear?.value), 'null')
    audit.parity('orbit.confirm.onlyOrbitRef', canonical(a.orbitRef), canonical(b.orbitRef), 'orbitRefRef.current')
    audit.parity('orbit.confirm.focusCurrentOrbit', canonical(a.focus?.args), canonical(b.focus?.args), ['ref&&ref.current'])
  })
}

function confirmOrder(parts) {
  if (!parts.restore || !parts.closeOrbit || !parts.requestConfirm) return '<缺失>'
  if (!(parts.restore.start < parts.closeOrbit.start && parts.closeOrbit.start < parts.requestConfirm.start)) {
    return '顺序错误'
  }
  return 'markRestoreFocus<closeOrbit<requestConfirm'
}

export function auditAdapterParity({ hostSource, orbitSource, clientSource }) {
  for (const [name, value] of Object.entries({ hostSource, orbitSource, clientSource })) {
    if (typeof value !== 'string') throw new TypeError(`${name} 必须是源码字符串`)
  }
  const audit = makeAuditor()
  auditHost(hostSource, clientSource, audit)
  auditFallbacks(clientSource, audit)
  auditOrbit(orbitSource, clientSource, audit)
  auditConfirm(orbitSource, clientSource, audit)
  return { ok: audit.differences.length === 0, checks: audit.checks, differences: audit.differences }
}

export function formatAdapterDifferences(result) {
  if (result.ok) return `适配器同源审计通过：${result.checks} 项结构化断言，0 处漂移。`
  const lines = [`适配器同源审计失败：${result.checks} 项结构化断言，${result.differences.length} 处差异。`]
  for (const difference of result.differences) {
    lines.push(`- ${difference.path}: ${difference.detail || '语义不一致'}`)
    if (Object.hasOwn(difference, 'standalone')) lines.push(`  独立/实际：${printable(difference.standalone)}`)
    if (Object.hasOwn(difference, 'inline') && difference.inline !== MISSING) lines.push(`  UMD/对照：${printable(difference.inline)}`)
    if (difference.expected !== undefined) lines.push(`  应为：${printable(difference.expected)}`)
  }
  return lines.join('\n')
}

const invokedPath = process.argv[1] ? fileURLToPath(import.meta.url) === process.argv[1] : false
if (invokedPath) {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..')
  const result = auditAdapterParity({
    hostSource: readFileSync(join(root, 'ui-host-primitives.js'), 'utf8'),
    orbitSource: readFileSync(join(root, 'ui-orbit-popover.js'), 'utf8'),
    clientSource: readFileSync(join(root, 'client.js'), 'utf8'),
  })
  console.log(formatAdapterDifferences(result))
  if (!result.ok) process.exitCode = 1
}
