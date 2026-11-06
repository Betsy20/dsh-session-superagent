/**
 * 门禁配置与本地审核。
 *
 * 顺序：插件默认 → 用户全局 → 项目专属 → 本地覆盖。
 * 规则是确定性的（regex / 长度 / 引用），不调用模型；语义复审只允许
 * release / merge，由用户显式打开。
 */
import { readFileSync, existsSync, mkdirSync, copyFileSync, writeFileSync, renameSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { redact } from './redact.js'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const DEFAULT_PATH = join(ROOT, 'gates', 'default.json')
const USER_PATH = () => join(homedir(), '.dsh', 'state', 'session-superagent', 'gates.json')
const PROJECT_PATH = (repo) => join(repo || process.cwd(), '.superagent', 'gates.json')
const LOCAL_PATH = (repo) => join(repo || process.cwd(), '.superagent', 'gates.local.json')

const ALLOWED_TYPES = new Set(['regex', 'contains', 'maxLength', 'nonEmpty', 'foreign-ref'])
const SEMANTIC_TRIGGERS = new Set(['release', 'merge'])

function readJson(path) {
  try {
    if (!existsSync(path)) return null
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return null
  }
}

function normalizeRule(rule) {
  if (!rule || typeof rule !== 'object') return null
  if (typeof rule.id !== 'string' || !/^[a-z][a-z0-9-]{1,63}$/.test(rule.id)) return null
  if (!ALLOWED_TYPES.has(rule.type)) return null
  if (rule.type === 'regex') {
    try { new RegExp(rule.pattern, rule.flags || '') } catch { return null }
  }
  return {
    id: rule.id,
    label: String(rule.label || rule.id),
    description: String(rule.description || ''),
    severity: rule.severity === 'warn' ? 'warn' : 'error',
    triggers: Array.isArray(rule.triggers) ? rule.triggers.map(String) : ['issue.reply', 'pr.reply'],
    type: rule.type,
    pattern: rule.pattern,
    flags: typeof rule.flags === 'string' ? rule.flags : '',
    value: rule.value,
    message: String(rule.message || rule.label || '未通过门禁'),
  }
}

export function normalizeConfig(input) {
  const config = input && typeof input === 'object' ? input : {}
  const rules = Array.isArray(config.rules) ? config.rules.map(normalizeRule).filter(Boolean) : []
  return {
    version: 1,
    name: String(config.name || 'config'),
    rules,
    semantic: config.semantic && typeof config.semantic === 'object' ? { ...config.semantic } : undefined,
  }
}

export function mergeConfig(base, override) {
  const a = normalizeConfig(base)
  const b = normalizeConfig(override)
  const byId = new Map(a.rules.map((rule) => [rule.id, rule]))
  for (const rule of b.rules) byId.set(rule.id, rule)
  return {
    version: 1,
    name: b.name !== 'config' ? b.name : a.name,
    rules: [...byId.values()],
    semantic: b.semantic || a.semantic,
  }
}

export function loadGateConfig({ repo = process.cwd() } = {}) {
  const layers = [
    ['default', DEFAULT_PATH],
    ['user', USER_PATH()],
    ['project', PROJECT_PATH(repo)],
    ['local', LOCAL_PATH(repo)],
  ]
  const sources = []
  let config = normalizeConfig(readJson(DEFAULT_PATH))
  for (const [name, path] of layers.slice(1)) {
    const next = readJson(path)
    if (!next) continue
    sources.push({ name, path })
    // 项目/本地只允许关掉语义复审，不能替用户选模型或开复审。
    if (name !== 'user' && next.semantic === false) {
      config = { ...config, semantic: { ...(config.semantic || {}), enabled: false } }
      delete next.semantic
    }
    config = mergeConfig(config, next)
  }
  return { config, sources }
}

function ruleMatches(rule, text, current) {
  if (rule.type === 'nonEmpty') return text.trim().length === 0
  if (rule.type === 'maxLength') return text.length > Number(rule.value || 0)
  if (rule.type === 'contains') return text.includes(String(rule.value || ''))
  const re = new RegExp(rule.pattern, rule.flags || '')
  if (rule.type === 'foreign-ref') {
    const refs = [...text.matchAll(new RegExp(rule.pattern, 'g'))].map((m) => m[1])
    const foreign = [...new Set(refs.filter((n) => current !== undefined && n !== String(current)))]
    return foreign.length > 0
  }
  return re.test(text)
}

export function lintText(text, config, { trigger = 'issue.reply', current } = {}) {
  const body = String(text ?? '')
  const hits = []
  for (const rule of normalizeConfig(config).rules) {
    if (!rule.triggers.includes(trigger)) continue
    if (!ruleMatches(rule, body, current)) continue
    hits.push({ id: rule.id, label: rule.label, severity: rule.severity, message: rule.message })
  }
  return { ok: hits.every((hit) => hit.severity !== 'error'), hits }
}

function parseJsonReply(content) {
  const text = String(content || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  try { return JSON.parse(text) } catch { return null }
}

async function postChat({ baseURL, model, messages, timeoutMs = 15000, fetchImpl = fetch }) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), Math.max(1000, Number(timeoutMs) || 15000))
  try {
    const res = await fetchImpl(String(baseURL || '').replace(/\/$/, '') + '/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model, messages, temperature: 0, max_tokens: 600 }),
      signal: controller.signal,
    })
    if (!res.ok) throw new Error('HTTP ' + res.status)
    const data = await res.json()
    return String(data?.choices?.[0]?.message?.content || '')
  } finally {
    clearTimeout(timer)
  }
}

export async function semanticReview(text, config, { trigger = 'merge', current, fetchImpl = fetch } = {}) {
  const semantic = normalizeConfig(config).semantic || {}
  if (!semantic.enabled || !SEMANTIC_TRIGGERS.has(trigger)) {
    return { skipped: true, ok: true, hits: [] }
  }
  const body = redact(String(text ?? '')).slice(0, Number(semantic.maxInputChars) || 8000)
  try {
    const content = await postChat({
      baseURL: semantic.baseURL,
      model: semantic.model,
      timeoutMs: semantic.timeoutMs,
      fetchImpl,
      messages: [
        { role: 'system', content: String(semantic.prompt || '') },
        { role: 'user', content: body },
      ],
    })
    const parsed = parseJsonReply(content)
    if (!parsed || typeof parsed.pass !== 'boolean') {
      return { skipped: false, ok: true, warning: '模型返回不是合法 JSON，已放行', hits: [] }
    }
    const hits = (Array.isArray(parsed.issues) ? parsed.issues : []).map((issue) => ({
      id: 'semantic-' + String(issue.rule || 'scope'),
      label: '语义复审',
      severity: semantic.mode === 'block' ? 'error' : 'warn',
      message: String(issue.reason || '语义复审未通过'),
    }))
    return { skipped: false, ok: parsed.pass || semantic.mode !== 'block', hits, model: semantic.model }
  } catch (error) {
    return { skipped: false, ok: true, warning: '语义复审不可用，已放行：' + String(error?.message || error), hits: [] }
  }
}

export async function optimizePrompt(prompt, { baseURL, model, timeoutMs = 20000, fetchImpl = fetch } = {}) {
  const content = await postChat({
    baseURL,
    model,
    timeoutMs,
    fetchImpl,
    messages: [
      { role: 'system', content: '你是提示词编辑。只输出润色后的审核提示词，不要解释，不要加代码围栏。' },
      { role: 'user', content: '把下面这段门禁审核提示词改得更清楚、更短、可执行；保留 JSON 输出要求：\n\n' + String(prompt || '') },
    ],
  })
  return String(content || '').trim()
}

export async function listModels({ baseURL, fetchImpl = fetch, timeoutMs = 5000 } = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetchImpl(String(baseURL || '').replace(/\/$/, '') + '/models', { signal: controller.signal })
    if (!res.ok) throw new Error('HTTP ' + res.status)
    const data = await res.json()
    return (Array.isArray(data?.data) ? data.data : []).map((item) => ({ id: String(item.id), label: String(item.display_name || item.id) }))
  } finally {
    clearTimeout(timer)
  }
}

export const DEFAULT_GATE_PATH = DEFAULT_PATH
export const USER_GATE_PATH = USER_PATH
export const PROJECT_GATE_PATH = PROJECT_PATH

export function validateConfig(input) {
  if (!input || typeof input !== 'object') return { ok: false, error: '配置必须是对象' }
  if (!Array.isArray(input.rules)) return { ok: false, error: 'rules 必须是数组' }
  for (const raw of input.rules) {
    const rule = normalizeRule(raw)
    if (!rule) return { ok: false, error: '规则非法：' + String(raw?.id || '?') }
    if (rule.type === 'regex' && String(rule.pattern || '').length > 400) return { ok: false, error: '正则过长：' + rule.id }
  }
  return { ok: true, config: normalizeConfig(input) }
}

export function readGateScope(scope, { repo = process.cwd() } = {}) {
  const path = scope === 'user' ? USER_PATH() : scope === 'project' ? PROJECT_PATH(repo) : scope === 'local' ? LOCAL_PATH(repo) : DEFAULT_PATH
  return { path, config: readJson(path) }
}

export function writeGateConfig(scope, config, { repo = process.cwd() } = {}) {
  if (!['user', 'project', 'local'].includes(scope)) throw new Error('scope 只能是 user / project / local')
  const checked = validateConfig(config)
  if (!checked.ok) throw new Error(checked.error)
  const path = scope === 'user' ? USER_PATH() : scope === 'project' ? PROJECT_PATH(repo) : LOCAL_PATH(repo)
  mkdirSync(dirname(path), { recursive: true })
  const tmp = path + '.tmp-' + process.pid
  if (existsSync(path)) copyFileSync(path, path + '.bak')
  writeFileSync(tmp, JSON.stringify(checked.config, null, 2) + '\n', 'utf8')
  renameSync(tmp, path)
  return { path, config: checked.config }
}
