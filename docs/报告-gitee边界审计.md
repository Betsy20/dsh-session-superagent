# Gitee 边界与错误处理审计（`lib/gitee.js` + `lib/gh-format.js`）

> 版本：`dsh-session-superagent@0.9.195` · 审计时间：2026-11-05 · 方式：**只读**（未改一行代码）
> 审计范围：`lib/gitee.js`（250 行）、`lib/gh-format.js`（573 行）
> 结论速览：**必须修 3 条 / 值得改 8 条 / 确认没问题 7 项**

---

## 审计方法与取证说明

**静态读**：两个文件逐行读完；沿调用链读了 `lib/watch.js`（`filterReason` / `priorityScore` / `POLL_RESULT_FIELDS`）与 `lib/index.js`（`pollOnce` 的 Gitee 分支、`watch_ack` 的 Gitee 分支），确认每个字段/分支到底有谁在用。

**真机取证**：对 `https://gitee.com/api/v5` 打了 20 余次**只读 GET**（`curl -sS -m 20`），把真实响应落盘到 `/tmp/*.json`，再用 `/tmp/audit-gitee.mjs` 把线上真实数据喂给仓库里的函数跑。

> ⚠️ **复现提示**：审完这一轮之后，本机 IP 就被 Gitee 限流了（`HTTP 403 | 403 Forbidden (Rate Limit Exceeded)`，见 G1）。**这本身就是 G1 的活证据** —— 也意味着下面所有 `curl` 命令都需要**等限流窗口过去**再跑；跑之前先 `curl -sS -m 10 -o /dev/null -w '%{http_code}\n' https://gitee.com/api/v5/repos/oschina/git-osc` 探一下，回 `200` 才是通的。

**临时文件**：`/tmp/audit-gitee.mjs`、`/tmp/{pulls,issues,repo,h,rl}.json` —— 跑完已删，`git status` 里不留痕。

**测试基线**（审前审后一致）：

```console
$ DSH_SUPERAGENT_OFFLINE=1 node --test 2>&1 | tail -5
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 4336.8201
```

```console
$ DSH_SUPERAGENT_OFFLINE=1 node --test 2>&1 | tail -12
✔ wakeTimes 被写成非数组也不许崩（坏数据的代价不该是整个面板 500） (0.1973ms)
✔ 水位只许前进：并发 tick 手里的旧快照不许把 watch_ack 推进的 seen 写回去 (0.121ms)
✔ partitionItems 收到非数组不许抛（坏状态会让该守永久退避） (0.216ms)
✔ 孤儿目录删掉后，git worktree prune 能把管理记录清干净 (1903.6377ms)
ℹ tests 336
ℹ suites 0
ℹ pass 336
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 6548.8637
```

> 336 条全绿说明：下面 3 条必须修**都不在现有测试覆盖里**。这正是「漏一个就静默失效」的含义 —— 测试全绿，功能是错的。

---

## 一、必须修

### M1 · `normalizeGiteeState()` 的 state 白名单漏了 `merged` —— 已合并的 PR 被当成「开着」

**文件:行号**：[`lib/gitee.js:17-21`](../lib/gitee.js#L17)

```js
export function normalizeGiteeState(raw) {
  const s = String(raw || '').toLowerCase()
  if (s === 'closed' || s === 'rejected') return 'closed'
  return 'open'
}
```

**触发条件**：任何一条 Gitee **Pull Request**，只要它被合并过（`state === 'merged'`）。

**为什么是 bug**：Gitee 的 PR `state` 至少有三值（本次实测到的：`open` / `closed` / `merged`；代码自己还预留了 `draft`，见 `lib/gitee.js:53`）。这里只把 `closed` 与 `rejected` 归成关闭，`merged` 掉进 `return 'open'` 兜底。于是**已合并的 PR 在下游被当成「还开着」**：

| 下游 | 代码 | 实际后果 |
|---|---|---|
| `filterReason` | `lib/watch.js:269` `if (f.skipClosed && item.state && item.state !== 'open') return '已关闭'` | merged PR **不会被「已关闭」过滤**，直接进候选集 |
| `priorityScore` | `lib/watch.js:332-334` | 照常计分 |
| 唤醒消息 | `lib/watch.js:119` `const kind = item.pull_request ? 'PR' : 'issue'` | 告诉会话「PR 还开着，去处理」 |
| `watch_ack` | `lib/index.js:2190` | 会给一个已合并 PR 打「已处理」标签 |

Gitee 的 `merged` 与 `closed` 是**互斥的两组**（`merged_at` 只对 `merged` 有值），不是同义词。

**怎么确认的（真跑）**：

```console
$ cd /tmp
$ curl -sS -m 20 "https://gitee.com/api/v5/repos/oschina/git-osc/pulls?state=all&sort=updated&direction=desc&per_page=30" -o pulls.json -w "HTTP %{http_code} | %{size_download} bytes\n"
HTTP 200 | 134759 bytes

$ node -e "const d=JSON.parse(require('fs').readFileSync('pulls.json','utf8'));const s={};for(const p of d)s[p.state]=(s[p.state]||0)+1;console.log(JSON.stringify(s))"
{"closed":8,"merged":6}
```

```console
$ node /tmp/audit-gitee.mjs          # 摘录 A 段
=== A. normalizeGiteeState 对线上真实 PR state 的归一 ===
  线上 pulls(14 条) 的 state 值                       ["closed","merged"]
  normalizeGiteeState("open")                    "open"
  normalizeGiteeState("progressing")             "open"
  normalizeGiteeState("closed")                  "closed"
  normalizeGiteeState("rejected")                "closed"
  normalizeGiteeState("merged")                  "open"      ← 错
  normalizeGiteeState("draft")                   "open"
  normalizeGiteeState("locked")                  "open"
  merged PR #11 归一后 state                        "open"      ← 错
  merged PR 归一后 draft                            false
  默认过滤器 filterReason(merged PR)                  null        ← 通过（没被「已关闭」拦下）
  对照 closed PR 的 filterReason                    "已关闭"
```

**修复方向**（只记，不改）：`if (s === 'closed' || s === 'rejected' || s === 'merged') return 'closed'`，并给 `normalizeGiteeState` 补一条 `merged` 的用例。

---

### M2 · `fetchGiteeLastComment()` 照抄了 GitHub 的分页参数 —— 取到的是「**最早**一条评论」

**文件:行号**：[`lib/gitee.js:125-127`](../lib/gitee.js#L125)

```js
  const res = await request(`/repos/${repo}/${kind}/${number}/comments?per_page=1&sort=created&direction=desc`, { token, fetchImpl })
  if (!res.ok || !Array.isArray(res.data) || res.data.length === 0) return null
  const last = res.data[res.data.length - 1]
```

**触发条件**：任何一条**评论数 ≥ 2** 的 Gitee issue/PR。

**为什么是 bug**：`sort=created&direction=desc` 是 **GitHub** 的分页参数（`lib/index.js:1036` 的 GitHub 兜底分支就是 `--jq '.[0]'` 配这套参数，那是对的）。**Gitee 的 comments 端点不认这两个参数，恒按 `created_at` 升序返回**。于是 `per_page=1` 拿到的是**第 1 条（最早）**，而 `res.data[res.data.length - 1]` 在长度为 1 的数组里仍然是它自己 —— 函数名与返回内容完全相反。

**后果**（两处都错，且不会报错）：
1. 唤醒消息里「最后一条评论是 @某人 · 某时间」显示的是**最早**那位评论者与时间。
2. `self` 判定（`lib/gitee.js:133`）拿最早那条去比：只要**最早一条是我们自己发的**，`self: true` —— 即使之后别人回了 8 条，会话也会被告知「是我上一轮留的」，从而**跳过回应**。

**怎么确认的（真跑）** —— 用线上真机的 `oschina/git-osc#IKSFS5`（9 条评论）：

```console
$ cd /tmp
$ curl -sS -m 20 "https://gitee.com/api/v5/repos/oschina/git-osc/issues/IKSFS5/comments?per_page=100" -o c.json -w "HTTP %{http_code} | %{size_download} bytes\n"
HTTP 200 | 13168 bytes

$ node -e "const d=JSON.parse(require('fs').readFileSync('c.json','utf8'));console.log(d.map(c=>c.created_at).join(' | '))"
2026-11-02T23:02:07+08:00 | 2026-11-03T09:20:14+08:00 | 2026-11-03T12:18:16+08:00 | 2026-11-03T12:26:05+08:00 | 2026-11-03T12:30:17+08:00 | 2026-11-03T12:40:40+08:00 | 2026-11-03T12:43:43+08:00 | 2026-11-03T12:45:22+08:00 | 2026-11-03T12:46:25+08:00
```

升序 —— 说明 `sort` / `direction` 被忽略了。再直接用**函数自己发的那个 URL** 打一次：

```console
$ curl -sS -m 20 "https://gitee.com/api/v5/repos/oschina/git-osc/issues/IKSFS5/comments?per_page=1&sort=created&direction=desc" -o one.json -w "HTTP %{http_code} | %{size_download} bytes\n"
HTTP 200 | 1258 bytes

$ node -e "const d=JSON.parse(require('fs').readFileSync('one.json','utf8'));console.log(d.map(c=>c.created_at).join(' | '))"
2026-11-02T23:02:07+08:00
```

**最早那条**（`2026-11-02T23:02:07`），不是真实的最后一条 `2026-11-03T12:46:25`。把这条真实响应喂进仓库里的函数（`/tmp/audit-gitee.mjs` C 段）：

```console
=== C. fetchGiteeLastComment 的「最后一条」到底取到哪一条 ===
  请求 URL                                         "/repos/oschina/git-osc/issues/IKSFS5/comments?per_page=1&sort=created&direction=desc"
  函数返回的「最后一条」                                    {"login":"first-user","at":"2026-11-02T23:02:07+08:00","self":false}
  Gitee 上真实的最后一条                                 {"login":"last-user","at":"2026-11-03T12:46:25+08:00"}
  最早是我发的、别人后来回了 → self                           true        ← 会误判成「我上一轮留的」
```

**修复方向**（只记，不改）：去掉 `sort` / `direction`，改 `per_page=100` 后取 `res.data[res.data.length - 1]`；或先取一页再在客户端按 `created_at` 排序。

---

### M3 · `normalizeGiteeItem()` 的字段白名单漏了 `comments` —— 「有人评论 +10」在 Gitee 上恒为 0

**文件:行号**：[`lib/gitee.js:36-50`](../lib/gitee.js#L36)

```js
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
```

**触发条件**：任何一条**评论数 > 0** 的 Gitee issue/PR —— 也就是绝大多数「真的有人在等回应」的条目。

**为什么是 bug**：这就是 `POLL_RESULT_FIELDS` 那个模式的复刻 —— **手维护的字段清单，漏一个就静默失效**。线上 Gitee issue 对象里**确实有** `comments`（数字），但上面的 `out` 没有把它带出来，于是：

```js
// lib/watch.js:333
if (on.comments !== false && Number(item.comments) > 0) score += 10
```

`Number(undefined) > 0` → `false` → **「有人评论」这一档 10 分在 Gitee 上永远加不上**。排序、`【为什么是这几条】` 的解释、`filterCounts` 的可解释性全部静默退化，而没有任何一条测试/面板会告诉你。

**旁证：代码注释本身是错的。** [`lib/index.js:977`](../lib/index.js#L977) 写着：

```js
  // Gitee 的条目不一定带 comments 计数，所以这里不按计数过滤，直接取前几条。
```

线上实测**带**（`comments: 2`）。这条错注释正是「字段清单靠人记」的产物，并且顺带让 Gitee 分支对**评论数为 0 的条目也发一次评论请求**（白跑）。

**怎么确认的（真跑）**：

```console
$ cd /tmp
$ curl -sS -m 20 "https://gitee.com/api/v5/repos/oschina/git-osc/issues?state=all&sort=updated&direction=desc&per_page=30" -o issues.json -w "HTTP %{http_code} | %{size_download} bytes\n"
HTTP 200 | 322218 bytes

$ node -e "const d=JSON.parse(require('fs').readFileSync('issues.json','utf8'));const i=d.find(x=>x.comments>0);console.log('有 comments 字段:', 'comments' in i, '| 值:', i.comments)"
有 comments 字段: true | 值: 2
```

```console
=== B. normalizeGiteeItem 的输出字段 vs 线上真实字段 ===
  线上 issue 有 comments 字段                         true
  线上 issue 的 comments 值                          2
  归一后 out 的键                                     ["assignees","created_at","html_url","labels","number","state","state_reason","title","updated_at","user"]
  归一后 comments                                   undefined          ← 丢了
  priorityScore(归一后, {comments:true})            0                  ← 该拿的 10 分没了
  priorityScore(线上原始, {comments:true})           10                 ← 原始对象是 10 分
```

线上 issue 对象的完整键（`curl .../issues?per_page=30` 原样）：

```
id,url,repository_url,labels_url,comments_url,html_url,parent_url,number,parent_id,depth,state,title,body,user,labels,assignee,collaborators,repository,milestone,created_at,updated_at,plan_started_at,deadline,finished_at,scheduled_time,comments,priority,issue_type,program,security_hole,cve_id,issue_state,branch,issue_type_detail,issue_state_detail
```

**修复方向**（只记，不改）：`out.comments = Number(item.comments) || 0`，并补一条「`priorityScore(normalizeGiteeItem(realIssue))` 应为 10」的用例。

---

## 二、值得改

> 这一节都不是「静默做错」，而是**判错方向 / 给出误导动作 / 边界漏一档**。按影响面从大到小排。

### G1 · 线上 Gitee 限流回的是 **403**，但 Gitee 轮询路径把 403 判成「凭证失效」

**文件:行号**：[`lib/index.js:1059`](../lib/index.js#L1059)（Gitee 轮询路径手写的 status→kind 映射）

```js
      const status = Number(listed.status) || 0
      // 401/403 = token 问题（不会自己好）；429 = 限流（会）；其它按网络抖动处理
      const kind = status === 401 || status === 403 ? 'auth' : status === 429 ? 'ratelimit' : status === 404 ? 'notfound' : 'network'
      ...
      if (kind === 'auth') entry.needsReauth = true
```

**触发条件**：Gitee 账号被限流。

**问题**：线上真机取到的 Gitee 限流响应是 **`HTTP 403` + `403 Forbidden (Rate Limit Exceeded)`**，不是 429。这条会被判成 `'auth'` → `entry.needsReauth = true` → 面板/doctor 告诉用户「Gitee token 无效，去重新生成」 —— 而真正该做的是**等**。`status === 429` 那条分支在 Gitee 上基本打不到。

**顺带**：这条映射与 `classifyGhError()` 是**两套独立维护的 kind 清单**（`classifyGhError('403 Forbidden (Rate Limit Exceeded)')` 正确返回 `ratelimit`，见 D 段实测）。轮询路径**完全不走**这个分类器，所以修好分类器也修不到它。

**怎么确认的（真跑）**：

```console
$ curl -sS -m 20 -D - -o /tmp/rl.txt "https://gitee.com/api/v5/repos/oschina/git-osc/issues?per_page=9999"
HTTP/1.1 403 Forbidden
Server: ADAS/1.0.214
Content-Type: text/plain; charset=utf-8
X-Request-Id: 41b03842ef96df45e7ddf0e470a3233b
BDWAF-Request-ID: e903912e-803b-4252-8e92-934d0ece3a52
                            ← 没有 Retry-After

$ cat /tmp/rl.txt
403 Forbidden (Rate Limit Exceeded)
```

```console
=== D. classifyGhError 对线上真实 Gitee 报错正文的分类 ===
  403 限流（线上真机）                                   {"kind":"ratelimit","hint":"（被 GitHub 限流：等几分钟，或换成带 token 的…"}
```

（注意 hint 说的是「被 **GitHub** 限流」—— Gitee 的限流也会走到这句。）

---

### G2 · `request()` 完全不读响应头 —— Gitee 的 `Retry-After` / 限流信息一律丢弃

**文件:行号**：[`lib/gitee.js:81-89`](../lib/gitee.js#L81)

```js
    const res = await fetchImpl(url, init)
    const text = await res.text()
    if (!res.ok) {
      // Gitee 的限流是 429；401/403 是 token 问题
      return { ok: false, status: res.status, error: String(text || '').slice(0, 240) }
    }
    let data = null
    try { data = text ? JSON.parse(text) : null } catch { return { ok: false, status: res.status, error: 'non-json body' } }
```

**触发条件**：任何 4xx/5xx。

**问题**：返回值里**只有 `status` 和正文**，没有 `headers`。`lib/gh-format.js` 里现成的 `retryAfterMs()` / `parseGhInclude()` 那套「按服务端说的等」在 Gitee 上**一行都用不上** —— Gitee 侧只能硬编码 60 秒（`lib/index.js:1069` `entry.nextAt = new Date(Date.now() + 60 * 1000)`）。注释「Gitee 的限流是 429」也与线上实测（403）相反。

另外 `'non-json body'` 把**真实正文丢掉了** —— 上游给的是维护页/网关页时，调用方拿不到任何可分类的线索，只能进 `other`。

**怎么确认的（真跑）**：

```console
=== G. request() 超时与重试（真实 AbortController，默认 20000ms） ===
  429 返回（request 不读 header）                      {"ok":false,"status":429,"error":"Too Many Requests"}   ← 传进去的 retry-after:120 没出现在返回里
```

---

### G3 · `listGiteeItems()` 只取一页，且不告诉调用方「被截断了」

**文件:行号**：[`lib/gitee.js:103-116`](../lib/gitee.js#L103)

```js
  const q = 'state=all&sort=updated&direction=desc&per_page=' + Math.max(1, Math.min(100, Number(perPage) || 20)) + sinceQ
  const [issues, pulls] = await Promise.all([
    request(`/repos/${repo}/issues?${q}`, { token, fetchImpl }),
    request(`/repos/${repo}/pulls?${q}`, { token, fetchImpl }),
  ])
  ...
  return {
    ok: true,
    items: normalizeGiteeList(issues.ok ? issues.data : [], pulls.ok ? pulls.data : []),
    partial: !issues.ok || !pulls.ok ? (issues.ok ? 'pulls' : 'issues') : null,
  }
```

**触发条件**：一次轮询间隔内，issue 或 PR 的**更新条数 > per_page**（`lib/index.js:1056` 固定传 `perPage: 20`）。

**问题**：每个端点只发**一次**请求，没有 `page` 循环，也没有 `truncated` 标记。`since` 水位能让这种情况变少，但**首次轮询（`since` 为空）和长时间停机后恢复时必然发生** —— 超出的条目**静默消失**，且下一轮 `cursor` 会推进过去，永远补不回来。`partial` 只覆盖「一半端点失败」，不覆盖「一半数据被截断」。

**怎么确认的（真跑）**：

```console
=== I. per_page 夹紧与翻页 ===
  per_page 传入 → URL 里的值                          ["20","20","1","1","20","20","20","20","100","100","100","100"]
  满页(20 条)时的请求次数（无第 2 页）                         2
  返回条数 / 有无 truncated 标记                         [40,false]
```

（`per_page` 的夹紧本身是对的：`0`/`NaN` → 20，`-5` → 1，`500` → 100。）

---

### G4 · Gitee 分支抢走 GitHub 的裸状态行 / 限流措辞

**文件:行号**：[`lib/gh-format.js:92-105`](../lib/gh-format.js#L92)

```js
  if (/Access token does not exist|401\s+Unauthorized|登录失效|无权限访问该资源/i.test(text)) {
    return {
      kind: 'auth',
      short,
      hint: '（Gitee 私人令牌无效或没填：到 Gitee「设置 → 私人令牌」重新生成一个，填进面板的 token）',
    }
  }
  if (/HTTP\s+429|429\s+Too\s+Many\s+Requests/i.test(text)) {
```

**触发条件**：GitHub 守的报错里出现 `HTTP 401 Unauthorized` 或 `HTTP 429 Too Many Requests`。

**问题**：这两条 Gitee 规则**排在 GitHub 规则前面**，且认的是**通用 HTTP 状态行**，不是 Gitee 专属措辞。于是 GitHub 的 401 会被告知「去 Gitee 生成私人令牌」，GitHub 的 429 会被告知「Gitee 上未带私人令牌的请求额度低得多」。文件里第 108 行自己写了这条纪律（「两个 Gitee 专属判据都不能放宽成裸 404 / 裸 Not Found」），但 401 / 429 这两条没遵守。

**怎么确认的（真跑）**：

```console
=== E. Gitee 分支是否抢走 GitHub 的措辞 ===
  HTTP 401 Unauthorized                          {"kind":"auth","isGiteeHint":true}          ← 抢走了
  HTTP 401: Bad credentials                      {"kind":"auth","isGiteeHint":false}
  HTTP 404: Not Found                            {"kind":"notfound","isGiteeHint":false}
  HTTP 403: Resource not accessible by personal access token {"kind":"permission","isGiteeHint":false}
  HTTP 429 Too Many Requests                     {"kind":"ratelimit","isGiteeHint":true}     ← 抢走了
  HTTP 502 Bad Gateway                           {"kind":"gateway","isGiteeHint":false}
```

---

### G5 · `not found.*gh` 这条规则会抢走 404

**文件:行号**：[`lib/gh-format.js:144-146`](../lib/gh-format.js#L144)

```js
  // Windows 的 cmd 报法不一样：'gh' is not recognized as an internal or external command
  // 出处（Node 的错误码语义）：https://nodejs.org/api/errors.html#common-system-errors
  if (/ENOENT|not found.*gh|gh: command not found|not recognized as an internal or external command/i.test(text)) {
    return { kind: 'nogh', short, hint: '（找不到 gh 命令：确认已安装且在 PATH）' }
  }
```

**触发条件**：报错正文里 `Not Found` 之后还出现 `gh` 两个字母 —— 例如仓库名/路径里带 `ghost`、`though`、`tough`。

**问题**：`not found.*gh` 的 `.` 不跨行但会跨整段，于是 `HTTP 404: Not Found for owner/ghost-repo` 被判成 `nogh`「找不到 gh 命令：确认已安装且在 PATH」，而真正的原因是仓库不存在。这条规则**排在** `HTTP 404|Not Found` 那条**前面**，所以 404 永远抢不过它。

**怎么确认的（真跑）**：

```console
=== F. /ENOENT|not found.*gh|.../ 抢走 404 ===
  gh: Not Found (HTTP 404)                       "notfound"
  Get "https://api.github.com/repos/o/ghost/issues": 404 Not Found "notfound"
  HTTP 404: Not Found for owner/ghost-repo       "nogh"        ← 错
```

---

### G6 · `ensureGiteeLabel()` 在「列标签」失败后仍然盲发 POST

**文件:行号**：[`lib/gitee.js:199-213`](../lib/gitee.js#L199)

```js
  let listed = { ok: true, data: [] }
  for (let page = 1; page <= 5; page += 1) {
    const res = await request(`/repos/${repo}/labels?per_page=100&page=${page}`, { token, fetchImpl })
    if (!res.ok) { listed = res; break }
    const pageItems = Array.isArray(res.data) ? res.data : []
    listed.data = (listed.data || []).concat(pageItems)
    if (pageItems.length < 100) break
  }
  if (listed.ok) {
    const names = (Array.isArray(listed.data) ? listed.data : []).map((item) => String(item && item.name || ''))
    if (names.includes(name)) return { ok: true, created: false, reason: 'already-exists' }
  }
  const created = await request(`/repos/${repo}/labels`, { token, method: 'POST', body: { name, color }, fetchImpl })
  if (created.ok) return { ok: true, created: true, reason: 'created' }
```

**触发条件**：`GET .../labels` 非 2xx（403 无权限、404、网络抖动、超时）。

**问题**：`listed.ok` 为 false 时**跳过存在性检查**，直接 POST。标签其实已存在时，这会在别人的仓库上**重复建标签**，并把结果报成 `created: true`（`lib/index.js:2188` 会显示「（已自动新建标签「X」）」—— 假话）。函数注释说的「先查一次能省掉一次无谓写入」在失败分支上不成立。**注意**：这一步是**写操作**，是本次审计里唯一会碰到别人仓库的路径，风险等级高于本文件其它问题。

**怎么确认的（真跑）**：

```console
=== J. ensureGiteeLabel：列标签失败仍会 POST ===
  返回                                             {"ok":true,"created":true,"reason":"created"}
  请求序列                                           ["GET /repos/o/r/labels?per_page=100&page=1","POST /repos/o/r/labels"]
```

---

### G7 · `mapGiteeRepoAccess()` 读的 `permissions` 在 Gitee 仓库对象里**不存在**

**文件:行号**：[`lib/gitee.js:159-172`](../lib/gitee.js#L159)

```js
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
```

**触发条件**：任何 Gitee 守。

**问题**：线上 `GET /repos/{owner}/{repo}` 的对象里**既没有 `permissions` 也没有 `permission`**（67 个键里都没有）。于是 `push` 恒为 `false` → `accessNote()`（`lib/gh-format.js:298`）对**每一条 Gitee 守**都返回「你对 X 只有读权限……」，`repoBadges()` 也恒挂「只读」徽章。用户有写权限时这是**假警告**；而这个假警告会长期常驻，最后被无视 —— 比不显示更糟。

**怎么确认的（真跑）**：

```console
=== M. mapGiteeRepoAccess 对线上真实仓库对象 ===
  线上 repo 有 permissions / permission             [false,false]
  映射结果 push / hasIssues / fork                   [false,true,false]
  映射结果 archived / disabled                       [false,false]
```

线上仓库对象的键（`curl .../repos/oschina/git-osc` 原样）：

```
assignee,assignees_number,assigner,blobs_url,branches_url,can_comment,collaborators_url,comments_url,commits_url,contributors_url,created_at,default_branch,description,enterprise,fork,forks_count,forks_url,full_name,gvp,has_issues,has_page,has_wiki,homepage,hooks_url,html_url,human_name,id,internal,issue_comment,issue_comment_url,issue_template_source,issues_url,keys_url,labels_url,language,license,members,milestones_url,name,namespace,notifications_url,open_issues_count,outsourced,owner,paas,parent,path,private,programs,project_creator,project_labels,public,pull_requests_enabled,pulls_url,pushed_at,recommend,releases_url,ssh_url,stargazers_count,stargazers_url,status,tags_url,testers,testers_number,updated_at,url,watchers_count
```

（`docs/Gitee-真机联调清单.md:117` 已把「未带令牌时 `permissions` 是 `undefined` → 算成只读，这是对的」记为**已知且接受**。但**带令牌时 Gitee 也不返回这个字段** —— 这一层没有验证过，所以放「值得改」而不是「必须修」。）

---

### G8 · `200` 但正文不是数组时，`listGiteeItems()` 会抛 —— 违反本文件自己写的「从不抛」

**文件:行号**：[`lib/gitee.js:58-63`](../lib/gitee.js#L58) + [`lib/gitee.js:111-116`](../lib/gitee.js#L111)

```js
export function normalizeGiteeList(issues, pulls) {
  const list = []
  for (const raw of issues || []) list.push(normalizeGiteeItem(raw, { kind: 'issue' }))
  for (const raw of pulls || []) list.push(normalizeGiteeItem(raw, { kind: 'pull' }))
  return list.sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')))
}
```

**触发条件**：Gitee 对列表端点回 `200` + JSON **对象**（如 `{"message":"maintenance"}` 这类 WAF/维护页）。

**问题**：`for (const raw of issues || [])` 只防 `null`/`undefined`，不防对象 → `TypeError: (issues || []) is not iterable`。这**逃出** `request()` 的 `try`（`normalizeGiteeList` 在 `request` 外面调用），直接违反 `lib/gitee.js:10` 的「网络失败只返回结构化错误，不抛」。同一文件里 `ensureGiteeLabel` 是有 `Array.isArray` 守卫的（`:203`、`:208`）—— 两处不一致，说明这也是「手写清单」式的遗漏。

**实际影响**：`lib/index.js:1533` 的 `tick` 有 `try/catch` 兜住，会变成 `entry.lastError = "(issues || []) is not iterable"` —— 面板上直接显示这句英文内部错误，随后退避。不崩，但对客户毫无意义。

**怎么确认的（真跑）**：

```console
=== H. 200 但正文不是数组：listGiteeItems 会不会抛 ===
  !! 抛了异常                                        "(issues || []) is not iterable"
  normalizeGiteeList({message:"x"}, null)        "throw: (issues || []) is not iterable"
  ensureGiteeLabel 有 Array.isArray 守卫            {"ok":true,"created":true,"reason":"created"}
```

---

## 三、确认没问题

> 这一节里每一条都**跑过**，不是「读着像没问题」。

### N1 · 超时：`fetch` 有超时，20 秒生效，`finally` 里清定时器

[`lib/gitee.js:77-79, 92-94`](../lib/gitee.js#L77) 用 `AbortController` + `setTimeout(timeoutMs)`，默认 `timeoutMs = 20000`，`finally { if (timer) clearTimeout(timer) }`。`res.text()` 在 `try` 内，读 body 卡住也会被 abort 覆盖。

```console
=== G. request() 超时与重试（真实 AbortController，默认 20000ms） ===
  超时后返回                                          {"ok":false,"status":0,"error":"This operation was aborted"}
  耗时(ms)                                         20013
```

（`20013ms` ≈ 20s，两个端点并发，没有互相等待。）

唯一残留：`typeof AbortController === 'function' ? new AbortController() : null` —— 宿主若没有 `AbortController`，超时会**静默消失**。Node ≥ 22 一定有，不提为问题。

### N2 · 重试：不会无限重试 —— 每轮每端点只打一次

```console
  fetch 被调用次数（两个端点，各 1 次）                        2
  500 时返回                                        {"ok":false,"status":500,"error":"Internal Server Error"}
  500 时 fetch 被调次数（有无重试）                         2
```

`request()` 内部**零重试**（这是对的：重试归 `bumpFailure` 的指数退避管，`lib/index.js:484-487`）。5xx 也不会在函数内打转。

### N3 · token 不会进 URL，也不会进 `error` 字段

[`lib/gitee.js:72`](../lib/gitee.js#L72) 只把 token 放 `authorization` 头；URL 里从不带 `access_token`。用真 token 串打三种失败路径，`JSON.stringify(返回值)` 里都**搜不到** token：

```console
=== K. token 会不会出现在 URL 或 error 字段里 ===
  fetch 抛错（连接失败）                                 {"urlHasToken":false,"error":"fetch failed"}
  fetch 抛错带 URL                                  {"urlHasToken":false,"error":"request to https://gitee.com/api/v5/repos/o/r/"}
  401 正文回显                                       {"urlHasToken":false,"error":"{\"message\":\"401 Unauthorized: Access token doe"}
```

（顺带确认：`lib/index.js:282` 的 `/state` 只回 `giteeToken: "configured" | "none"`，与 `docs/Gitee-真机联调清单.md:244` 记的一致。）

**但有一个防御缺口值得记一笔**：`lib/redact.js` 的 `SECRET_PATTERNS` 只认 `ghp_`/`github_pat_`/PEM/`Authorization:` 头 —— **Gitee 私人令牌是无前缀的 32 位十六进制**，`redact()` 完全认不出。目前没有泄露路径（`request()` 不把 token 拼进任何字符串），但一旦将来有人把 `init` 或 header 塞进错误信息，`redact` 拦不住。这属于「现在没问题、以后危险」，不计入必须修。

### N4 · 中文 / emoji / 编码：没有乱码，也没有截断炸掉

- `res.text()` 按 UTF-8 解码，Gitee 的 `Content-Type` 是 `application/json; charset=utf-8`（已实测），不需要额外处理。
- 中文标题/标签走 `String(item.title || '')`，不经过任何字节切分。
- `error: String(text || '').slice(0, 240)` 切的是**已解码字符串**（不是 Buffer），不会切出半个 UTF-8 字节；理论上会在第 240 个 code unit 处把一个 emoji 的代理对切开，但那只影响错误摘要的最后一个字符，且已被 `classifyGhError` 的 `short` 再截一次。
- 实测：线上真实 404 页（6832 字，含中文）截到 240 字后，`<html>` 与 `(404)` 两个判据都还在 —— 截断**没有**破坏分类：

```console
  404 HTML 页（request 截断到 240 字）                  {"kind":"notfound","hint":"（Gitee 上标签/仓库/编号不存在：确认标签名（区分大小…"}
```

### N5 · `per_page` 夹紧正确

```console
  per_page 传入 → URL 里的值                          ["20","20","1","1","20","20","20","20","100","100","100","100"]
```

`0` / `NaN` → 20（走 `|| 20` 兜底），`-5` → 1，`500` → 100（Gitee 上限）。**没有**越界值送出去（线上 `per_page=9999` 会直接 403 限流，这里挡得住）。

### N6 · 线上真实报错形状都归对了类

```console
=== D. classifyGhError 对线上真实 Gitee 报错正文的分类 ===
  404 JSON "Not Found Project"                   {"kind":"notfound", ...}
  404 JSON "404 Not Found"                       {"kind":"notfound", ...}
  404 HTML 页（request 截断到 240 字）                  {"kind":"notfound", ...}
  401 JSON "Access token does not exist"         {"kind":"auth", ...}
  401 中文 "登录失效…"                                 {"kind":"auth", ...}
  403 限流（线上真机）                                   {"kind":"ratelimit", ...}
```

其中 401 的中文形状（`{"message":"登录失效，无权限访问该资源","code":40001}`）已被 `lib/gh-format.js:92` 的 `/登录失效|无权限访问该资源/` 正确覆盖 —— 这条是上一轮修的，**验证通过**。另外真机上「issue 编号不存在」回的是 **401 中文**（不是 404），这个反直觉形状也被正确归到 `auth`。

**还没覆盖的**（Gitee 真实的 400 形状，落到 `other`）：

```console
  400 "number is invalid"                        {"kind":"other", ...}
  400 "per_page does not have a valid value"     {"kind":"other", ...}
```

注意键名是 **`messages`（复数、数组）**，不是 `message` —— 这两种 400 是我们的调用参数错，正常不会出现；记在这里是为了将来真出现时能一眼认出来。

### N7 · `formatGhCall` / `parseGhInclude` / 退避工具函数

- `formatGhCall` 用 `String.fromCharCode(10)` 拼换行，不依赖平台行尾；`why` 由 `classifyGhError` 保证非空（该函数所有分支都 `return` 一个对象），不会出现 `why.hint` 的 `TypeError`。
- `parseGhInclude` 同时认 `\r\n\r\n` 与 `\n\n`，取最先出现的分隔符 —— 这块是 GitHub 侧，Gitee 不走它，逻辑无误。
- `retryAfterMs` / `throttleDelayMs` / `jitterMs` 的 `capMs` 都有上界（1 小时 / 5 分钟），不会算出负等待或无限等待。

---

## 附：本次审计的边界

- **只读**：`lib/gitee.js`、`lib/gh-format.js` 一个字节未改；`git status` 里的 `M lib/index.js` / `M lib/watch.js` 是本次审计**之前**就存在的改动（`git diff` 里没有本次审计的任何痕迹）。
- **只读网络**：只对 `gitee.com/api/v5` 打了 GET；`POST` 只在 `fetchImpl` 假实现里发生，没有真的往任何仓库写东西。
- **临时文件**：`/tmp/audit-gitee.mjs`、`/tmp/{pulls,issues,repo,h,rl}.json` 已删。
- **没覆盖到的**：Gitee 的 `issue_state` / `issue_state_detail`（中文自定义状态：待确认/进行中）没有进 `normalizeGiteeItem`，`docs/Gitee-真机联调清单.md:609` 已自行记为已知缺口 —— 本次没有新增证据，不重复计入。
