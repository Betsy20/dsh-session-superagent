/**
 * Gitee（码云）适配层 —— 让「守」不只能盯 GitHub。
 *
 * 为什么要单独一层：`gh` CLI 只服务 GitHub。Gitee 没有等价 CLI，
 * 但它有 REST v5，形状和 GitHub 不完全一样（`state` 有 progressing/rejected、
 * PR 走 `/pulls`、没有 GraphQL、没有 ETag 条件请求）。
 *
 * 设计原则（和 gh-format.js 一致）：
 *   1. **纯转换**在这里做完，下游（pollOnce / 筛选 / 唤醒）完全不用知道是哪家；
 *   2. 网络失败只返回结构化错误，不抛 —— 让调用方走统一的失败分类；
 *   3. token 只在这里出现，绝不写日志。
 */

export const GITEE_API = 'https://gitee.com/api/v5'

/** Gitee 的 state → 我们内部沿用的 GitHub 口径。 */
export function normalizeGiteeState(raw) {
  const s = String(raw || '').toLowerCase()
  if (s === 'closed' || s === 'rejected') return 'closed'
  return 'open'
}

/**
 * Gitee 条目 → 内部统一形状。
 *
 * 下游只用这些字段：number / title / state / user.login / labels[].name /
 * assignees[].login / html_url / updated_at / state_reason / pull_request / draft。
 */
export function normalizeGiteeItem(raw, { kind = 'issue' } = {}) {
  const item = raw || {}
  const isPr = kind === 'pull' || Boolean(item.pull_request) || Array.isArray(item.head)
  const state = normalizeGiteeState(item.state)
  const labels = Array.isArray(item.labels)
    ? item.labels.map((l) => (typeof l === 'string' ? { name: l } : { name: l && l.name })).filter((l) => l.name)
    : []
  const out = {
    // Gitee 的 issue 编号是字符串（真机样例：number = "IKSQJH"，id = 34933085），
    // PR 才是数字（number = 14）。**别转 Number** —— 转了就全变 0，去重和 ack 全部失效。
    number: item.number === 0 || item.number ? String(item.number) : String(item.id || ''),
    title: String(item.title || ''),
    state,
    // Gitee 用 'rejected' 表示「关闭且不修」；state_reason 只有 reopened 会被下游用来警示
    state_reason: String(item.state_reason || (String(item.state || '').toLowerCase() === 'reopened' ? 'reopened' : '')) || null,
    user: { login: (item.user && item.user.login) || (item.assignee && item.assignee.login) || '?' },
    assignees: item.assignee ? [{ login: item.assignee.login }] : [],
    labels,
    html_url: String(item.html_url || ''),
    created_at: item.created_at || null,
    updated_at: item.updated_at || null,
  }
  if (isPr) {
    out.pull_request = { url: out.html_url }
    out.draft = String(item.state || '').toLowerCase() === 'draft'
  }
  return out
}

export function normalizeGiteeList(issues, pulls) {
  const list = []
  for (const raw of issues || []) list.push(normalizeGiteeItem(raw, { kind: 'issue' }))
  for (const raw of pulls || []) list.push(normalizeGiteeItem(raw, { kind: 'pull' }))
  return list.sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')))
}

/** 统一请求：成功给 {ok:true,data}，失败给 {ok:false,status,error}，从不抛。 */
async function request(path, { token, method = 'GET', body = null, fetchImpl = globalThis.fetch, timeoutMs = 20000 } = {}) {
  const url = GITEE_API + path + (token && method === 'GET' ? '' : '')
  const init = {
    method,
    headers: {
      accept: 'application/json',
      ...(token ? { authorization: 'token ' + token } : {}),
      ...(body ? { 'content-type': 'application/json; charset=utf-8' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  }
  const controller = typeof AbortController === 'function' ? new AbortController() : null
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null
  if (controller) init.signal = controller.signal
  try {
    const res = await fetchImpl(url, init)
    const text = await res.text()
    if (!res.ok) {
      // Gitee 的限流是 429；401/403 是 token 问题
      return { ok: false, status: res.status, error: String(text || '').slice(0, 240) }
    }
    let data = null
    try { data = text ? JSON.parse(text) : null } catch { return { ok: false, status: res.status, error: 'non-json body' } }
    return { ok: true, status: res.status, data }
  } catch (error) {
    return { ok: false, status: 0, error: String((error && error.message) || error).slice(0, 200) }
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/** 拉一页 issue + PR（Gitee 两者分属不同端点，缺 token 时公开仓库也能读）。 */
export async function listGiteeItems({ repo, token = '', perPage = 20, since = '', fetchImpl } = {}) {
  // `since` 是 Gitee 少有的、能省流量的手段（没有 ETag 条件请求）。
  // 真机验证：since 传给未来时间 → 返回 []；传今天 → 只返回今天之后更新的。
  // 两个端点都支持，缺了它就只能每轮全量读。
  const sinceQ = since ? '&since=' + encodeURIComponent(String(since)) : ''
  const q = 'state=all&sort=updated&direction=desc&per_page=' + Math.max(1, Math.min(100, Number(perPage) || 20)) + sinceQ
  const [issues, pulls] = await Promise.all([
    request(`/repos/${repo}/issues?${q}`, { token, fetchImpl }),
    request(`/repos/${repo}/pulls?${q}`, { token, fetchImpl }),
  ])
  if (!issues.ok && !pulls.ok) {
    return { ok: false, status: issues.status || pulls.status, error: issues.error || pulls.error }
  }
  return {
    ok: true,
    items: normalizeGiteeList(issues.ok ? issues.data : [], pulls.ok ? pulls.data : []),
    // 一半成功也要说清楚：否则客户以为 PR 一条都没有
    partial: !issues.ok || !pulls.ok ? (issues.ok ? 'pulls' : 'issues') : null,
  }
}

/** 某条 issue/PR 的最后一条评论（谁、什么时候）——唤醒消息用它回答「现在是有人在等吗」。 */
export async function fetchGiteeLastComment({ repo, token = '', item, selfLogin = '', fetchImpl } = {}) {
  // 编号可能是字符串（issue 形如 IKSQJH）也可能是数字（PR 形如 14）：都按原样拼进 URL
  const number = item && item.number != null ? String(item.number) : ''
  if (!number) return null
  const kind = item && item.pull_request ? 'pulls' : 'issues'
  const res = await request(`/repos/${repo}/${kind}/${number}/comments?per_page=1&sort=created&direction=desc`, { token, fetchImpl })
  if (!res.ok || !Array.isArray(res.data) || res.data.length === 0) return null
  const last = res.data[res.data.length - 1]
  const login = (last.user && last.user.login) || ''
  return {
    login,
    at: last.created_at || null,
    // 自己留的评论不算「有人在等」——和 GitHub 那条 GraphQL 分支保持同一口径
    self: Boolean(selfLogin) && login === selfLogin,
  }
}

/** 打标签（ack 用）。Gitee 对 issue 有这个端点；PR 视同 issue。 */
export async function addGiteeLabel({ repo, token = '', number, label, fetchImpl } = {}) {
  return request(`/repos/${repo}/issues/${number}/labels`, { token, method: 'POST', body: { labels: [label] }, fetchImpl })
}

/** 当前 token 是谁（doctor 用）。 */
export async function giteeWhoami({ token = '', fetchImpl } = {}) {
  return request('/user', { token, fetchImpl })
}

/** 仓库是否可读（doctor 用）。 */
export async function giteeRepo({ repo, token = '', fetchImpl } = {}) {
  return request(`/repos/${repo}`, { token, fetchImpl })
}

/**
 * Gitee 仓库信息 → 内部 `repoAccess` 形状（与 GitHub 那条 `gh api repos/x --jq` 同构）。
 *
 * Gitee 的 `/repos/{owner}/{name}` 里权限在 `permissions.{admin,push,pull}`；
 * 它**没有** `archived`/`disabled` 这两个字段，所以这两个保持 false 并注明来源，
 * 不要瞎猜成 true（那会让「归档仓库」提示永远不出现，属于静默错误）。
 */
export function mapGiteeRepoAccess(repo, info = {}) {
  const perms = info.permissions || {}
  return {
    repo,
    push: perms.push === true || perms.admin === true,
    private: info.private === true,
    fork: Boolean(info.parent) || info.fork === true,
    hasIssues: info.has_issues !== false,
    archived: info.archived === true,
    disabled: info.disabled === true,
    parent: (info.parent && info.parent.full_name) || null,
    checkedAt: new Date().toISOString(),
  }
}
