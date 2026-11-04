# 报告：Gitee 六条缺陷现状核对（只读审计）

> 结论先行：**6 条里 2 条未修（第 1、6 条），4 条已修（第 2、3、4、5 条）。**
> 未修的两条都不是「没改」，而是**改了一半**——每一半都有代码位置和运行时证据。

## 零、审计基线（先固定靶子）

| 项 | 值 |
| --- | --- |
| 仓库 | `D:\主工作区\projects\dsh-session-superagent` |
| 审计基线 commit | `78b501a`（`fix(gitee): ack 标签在 Gitee 上建不出来（半角冒号非法）（0.9.184）`） |
| 审计时刻 | 2026-11-05 03:50 (+08:00) |
| 读的文件 | `lib/index.js`（2685 行）、`lib/watch.js`（1125 行）、`lib/gitee.js`（229 行）、`lib/gh-format.js`（573 行）、`client.js` |
| 写操作 | 只写本文件。代码一行未动 |

**为什么要交代基线**：任务书写的基线是 `HEAD = 0.9.183`（`cb119eb`），但审计期间**另一个 agent 正在同一工作区里提交**，
HEAD 在我跑命令的过程中从 `cb119eb` 推到了 `78b501a`（0.9.183 → 0.9.184）。
所以我以「审计结束时已干净的 HEAD `78b501a`」为准，并核对了 `cb119eb..78b501a` 的差异：

```bash
$ git diff --stat cb119eb..HEAD
 CHANGELOG.md               | 35 +++++++++++++++++++
 README.md                  |  4 +--
 client.js                  |  2 +-
 lib/gh-format.js           |  5 ++-
 lib/gitee.js               | 57 ++++++++++++++++++++++++++++++
 lib/index.js               | 28 ++++++++++-----
 package.json               |  2 +-
 scripts/render-preview.mjs | 87 ++++++++++++++++++++++++++++++++++++++++++++--
 test/gh-format.test.mjs    |  7 ++++
 test/gitee.test.mjs        | 44 +++++++++++++++++++++++
 10 files changed, 256 insertions(+), 15 deletions(-)
```

这次提交只做两件事：**给 Gitee 换用合法的默认 ack 标签名**（`主理鱼:已处理` → `主理鱼-已处理`，
Gitee 不接受半角冒号）、**给 `classifyGhError` 补中文 401 判据**。
它**不改变**下面 6 条里的任何一条判定（第 5 条只被加强，没被削弱）。
**下面所有行号都是 `78b501a` 的**；`lib/watch.js` 与 `client.js` 在这两次提交之间没有逻辑改动。

验证用的临时状态目录都建在系统 `mktemp -d` 里（`DSH_SUPERAGENT_STATE`），不碰仓库。

---

## 一、六条逐条判定

### 1. Gitee 条目没有 `state_reason` —— ⚠ 标记与 `lastReopened` 在 Gitee 上永远不出现

**状态：`未修`**（⚠ 那一半已修；`lastReopened` 那一半仍然永远不出现，且有**两个**独立成因）

**代码位置**

| 位置 | 作用 | 现状 |
| --- | --- | --- |
| `lib/gitee.js:43`（`normalizeGiteeItem`） | 从 Gitee 原始 `state` 合成 `state_reason` | 合成不出来（见下） |
| `lib/watch.js:1113`（`markGiteeReopened`） | 用上一轮状态补 `state_reason='reopened'` | 已加 |
| `lib/watch.js:125` | 唤醒行前缀 `⚠ ` | **已修好** |
| `lib/index.js:1172-1173` | 算 `entry.lastReopened` | **在 1197 之前**，拿不到结果 |
| `lib/index.js:1197-1199` | 调 `markGiteeReopened` | 太晚 |
| `lib/watch.js:560-566`（`POLL_RESULT_FIELDS`） | 落盘白名单 | **不含 `lastReopened` / `lastStates`** |
| `lib/index.js:1610` | `/state` 投影 `lastReopened` | 恒为 `null` |
| `client.js:1354-1355` | 面板「被重新打开过」 | 永不出现（**GitHub 也一样**） |

**证据片段**

`lib/gitee.js:42-43` —— Gitee 的 `state` 只有 `open/progressing/closed/rejected`，**永远不等于** `'reopened'`，
所以归一化后 `state_reason` 恒为 `null`：

```js
    // Gitee 用 'rejected' 表示「关闭且不修」；state_reason 只有 reopened 会被下游用来警示
    state_reason: String(item.state_reason || (String(item.state || '').toLowerCase() === 'reopened' ? 'reopened' : '')) || null,
```

`lib/watch.js:1113-1118` —— 补判「重新打开」的纯函数（这一段是对的，⚠ 就是靠它亮起来的）：

```js
export function markGiteeReopened(items, lastStates = {}) {
  const list = items || []
  for (const item of list) {
    const prev = lastStates[String(item.number)]
    if (!item.state_reason && prev === 'closed' && item.state === 'open') item.state_reason = 'reopened'
  }
```

`lib/index.js:1171-1173` 与 `lib/index.js:1197-1199` —— **成因 A：算得太早**。
`lastReopened` 在 `markGiteeReopened` 之前就把 `items` 扫完了，那一刻 Gitee 条目的 `state_reason` 还是 `null`：

```js
  // 记住最近一条"被重新打开"的 issue：这是最该被看见的信号（之前判过不做）
  const reopened = items.find((item) => (item.state_reason || '') === 'reopened')
  if (reopened) entry.lastReopened = reopened.number
  ...
  // Gitee 没有 state_reason：用上一轮记下的状态自己判「重新打开」（GitHub 有原生字段，不覆盖）
  if (entry.provider === 'gitee') {
    entry.lastStates = markGiteeReopened(items, entry.lastStates || {})
  }
```

`lib/watch.js:560-566` —— **成因 B：落盘白名单漏字段**。`persistEntry` → `mergePollResult` 只搬白名单里的键：

```js
export const POLL_RESULT_FIELDS = [
  'lastPoll', 'lastError', 'nextAt', 'consecutiveFailures', 'seen', 'cursor', 'lastReported',
  'lastWake', 'lastWakeCount', 'lastBatch', 'lastAbsorbed', 'wakeTimes', 'lastDeferred',
  'history', 'lastWorktree', 'lastAcked', 'lastTrigger',
  // 过滤记录也是轮询结果：漏了它面板上的「最近被过滤」永远是空的
  'filteredLog',
]
```

**运行时证据**（真跑两轮 Gitee 轮询：第 1 轮 `closed`、第 2 轮 `open`，见文末命令 `H`）：

```text
  gitee /issues 被调用轮数 = 2
  entry.lastStates       = undefined
  entry.lastReopened     = undefined
  entry.lastDeferred     = "会话尚未就绪（宿主可能刚启动）：约 10 分钟后仍找不到才报错"
  entry.filteredLog      = ["已关闭:IK1"]
```

`filteredLog` 里留下了第 1 轮的 `已关闭:IK1`，说明两轮都真的跑完了；可 `lastStates` 与 `lastReopened` 都是 `undefined`。
再单独打白名单（命令 `I`）：

```text
  含 lastReopened = false
  含 lastStates   = false
  mergePollResult({lastReopened:"IK1", lastStates:{IK1:"open"}, lastPoll:…}) =>
    {"id":"gitee:o/r#s","lastPoll":"2026-11-05T00:00:00Z"}
```

**为什么这条现在还成立**

- ⚠ 那一半**确实修好了**：`markGiteeReopened` 把 `state_reason` 补上后，`lib/watch.js:125` 的 `⚠` 与
  `lib/watch.js:329` 的 `+100` 加权都看得见（命令 `A'` 打出了 `⚠ 这条被重新打开过（之前关过，判"不做"可能不对）`）。
- 但 `lastReopened` 那一半**死了两次**，而且两次互相独立：
  1. **顺序**：`lib/index.js:1172` 在 `lib/index.js:1197` 之前跑，Gitee 第一次判出 reopened 的那一轮，`lastReopened` 已经算完；
     下一轮 `lastStates` 已被更新成 `open`，再也不会触发（Gitee 的原生 `state` 不是 `reopened`）。
  2. **落盘**：即使第 1 条修了，`lastReopened` 不在 `POLL_RESULT_FIELDS` 里 → `mergePollResult` 丢弃 →
     `watchers.json` 里没有 → `lib/index.js:1610` 投影出 `null` → `client.js:1354` 永不进 `problems`。
     这一条**对 GitHub 同样成立**（GitHub 的 `state_reason` 是原生的，`1172` 能取到，但照样过不了白名单）。
- 所以修的时候必须**两处一起改**，只改一处仍然看不到。改法：把 `1172-1173` 挪到 `1197-1199` 之后
  （或改成从 `entry.lastStates` 判），同时把 `'lastReopened'`（和 `'lastStates'`）加进 `POLL_RESULT_FIELDS`。

---

### 2. `watch_trace` 对 Gitee 字符串编号（`IKSQJH`）不可用

**状态：`已修`**

**代码位置**：`lib/index.js:2208-2212`（`watch_trace` 的 `execute`）+ `lib/watch.js:904-930`（`itemTrace`）

**证据片段**（`lib/index.js:2206-2212`）：

```js
      // 编号可能是数字（GitHub 的 14）也可能是字符串（Gitee 的 IKSQJH）：
      // 统一转成字符串再比 —— 以前这里 Number('IKSQJH') = NaN，Gitee 的条目永远查不到。
      const rawNumber = args.number == null ? '' : String(args.number).trim()
      if (!/^[A-Za-z0-9_-]+$/.test(rawNumber)) {
        return (args && args.format === 'json') ? JSON.stringify({ schemaVersion: 1, error: 'number is required' }) : '[error: number is required]'
      }
      const number = rawNumber
```

`Number(...)` 已经彻底消失（`grep -n "Number(args.number)" lib/index.js` 零命中），入参先 `String()` 再走
`/^[A-Za-z0-9_-]+$/` 白名单；`itemTrace`（`lib/watch.js:907`）内部也统一 `String(number).trim()` 后与
`seen` / `filteredLog` / `history` 的键比对（`lib/watch.js:909-918`）。

**运行时证据**（命令 `B`，先用 `watch_start({ repo: 'gitee:o/r' })` 造一条 Gitee 守，再塞 `seen['IKSQJH']`）：

```text
  watch_trace({number:"IKSQJH"}) =>
    #IKSQJH @ o/r：已记入水位但没唤醒（仅观察，或上报前就已存在）
      水位 seen：2026-11-04T09:00:00.000Z
      被过滤（已关闭）：2026-11-04T08:00:00.000Z
  watch_trace({number:1}) 对照 => "#1 在所有守 里都没有痕迹 —— 可能还没被轮询到，或者编号写错了。"
  schema.number.type = {"type":"number","description":"issue or PR number to trace"}
```

**为什么这样算修了**：Gitee 字符串编号不再变 `NaN`，能正常返回 `#IKSQJH` 的完整追溯链，而不是
`[error: number is required]`。

**残留（不阻塞，但要记一笔）**：`lib/index.js:2193` 的 schema 仍写 `number: { type: 'number' }`。
本仓库的 `defineTool`（`lib/index.js:586`）只校验 `required`、不做 JSON Schema 类型校验，所以传字符串能进 `execute`；
**但宿主若哪天按 schema 校验入参，`"IKSQJH"` 会在进 `execute` 之前被拒**。彻底的做法是把 schema 改成 `type: 'string'`。

---

### 3. `watch_doctor` 里 Gitee 的 `INFO ack 标签…` 是死代码，且隔离目录/轮询停滞检查被一起跳过

**状态：`已修`**

**代码位置**

| 位置 | 内容 |
| --- | --- |
| `lib/index.js:2326` | `const isGitee = entry.provider === 'gitee'` |
| `lib/index.js:2327-2345` | Gitee 走 REST（`giteeRepo`），GitHub 走 `gh api` —— 改成 `if (isGitee) { … } else { … }` |
| `lib/index.js:2371` | `INFO ack 标签「…」：Gitee 需要先在仓库里手动建好这个标签…` |
| `lib/index.js:2377-2392` | 隔离工作目录检查 |
| `lib/index.js:2398-2413` | 轮询停滞检查 |

**证据片段**：`continue` 已经不在循环体里了（`sed -n '2320,2415p' lib/index.js | grep -n continue` → 空）。
Gitee 分支现在走 `if / else`，**落空到**下面第 3、4、5 段：

```js
        // 3. ack 标签是否存在（两家都要看：Gitee 不会自动建标签，更要说清楚）
        const label = entry.ackLabel || defaultAckLabel(entry.provider)
        if (isGitee) {
          // Gitee 没有「建标签」端点，watch_ack 也不会替它建（GitHub 会）——
          // 所以这里只能交代规则，不能假装探测过。
          lines.push(`INFO ack 标签「${label}」：Gitee 需要先在仓库里手动建好这个标签，watch_ack 才能打上`)
        } else {
```

**运行时证据**（命令 `C`：一条 Gitee 守 + `isolated:true` + `lastPoll` 两小时前 + `startedAt` 四小时前）：

```text
OK 版本一致：0.9.184
OK   面板接口挂载：9 条，无失败
INFO 没有 GitHub 守：跳过 gh 登录检查（Gitee 那条走令牌，见上面）
OK   gitee:o/r 可访问
WARN 没有配置 Gitee token：公开仓库能读，私有仓库读不到，也打不了 ack 标签
INFO Gitee 没有 ETag 条件请求，所以这条守每轮都会真的读一次列表（注意额度）
INFO ack 标签「主理鱼-已处理」：Gitee 需要先在仓库里手动建好这个标签，watch_ack 才能打上
OK   隔离工作目录 D:\主工作区\projects\dsh-session-superagent：是 git 仓库
WARN o/r 已经 120 分钟没轮询过（预期每 60 秒）—— 定时器可能丢了
INFO 运行中 · 上次轮询 2026-11-04T17:48:59.648Z · 正常
```

**为什么这样算修了**：三行原来「只有 GitHub 才有」的输出（`INFO ack 标签`、`OK 隔离工作目录`、`WARN 已经 N 分钟没轮询过`）
**全部出现在 Gitee 条目上**——这只能是那个 `continue` 被拿掉了。死代码复活的判据就是「跑得出来」，现在跑得出来。

---

### 4. `/state` 投影没有 `provider` 字段

**状态：`已修`**

**代码位置**：`lib/index.js:1589`

**证据片段**（`lib/index.js:1587-1589`）：

```js
            // 面板要能一眼分出 GitHub / Gitee：否则行内只能靠 id 前缀猜
            provider: w.provider === 'gitee' ? 'gitee' : 'github',
```

**运行时证据**（命令 `D`，直接调 `/session-superagent/state` 的 handler）：

```text
  watchers[0].provider = "gitee" | id = "gitee:o/r#session-audit"
  gh = {"ok":null,"skipped":"没有 GitHub 守"}
```

**为什么这样算修了**：投影里有了 `provider`，面板不必再从 `id` 的 `gitee:` 前缀或磁盘上的 `watchers.json` 反推；
顺带 `gh` 字段在「全 Gitee」时是 `{ok:null, skipped:"没有 GitHub 守"}`，不再假红（这一条本来就是 0.9.18x 一起做的）。

---

### 5. ack 标签不存在时看不到「标签不存在」：Gitee 回 HTML 404 页，`classifyGhError` 归到 `other`

**状态：`已修`**

**代码位置**

| 位置 | 内容 |
| --- | --- |
| `lib/gh-format.js:109-119` | `gitee404` 三条判据（含整页 HTML），命中即 `kind: 'notfound'` |
| `lib/gh-format.js:162` | `other` 兜底排在**后面** |
| `lib/index.js:2151-2153` | Gitee 的 `notfound` 换成「标签必须先建」的专属文案 |

**证据片段**（`lib/gh-format.js:106-118`）：

```js
  // 404 的判据分两路：JSON 正文里的 Gitee 专属措辞（GitHub 只说 "Not Found"），
  // 或者一整页 HTML（Gitee 的标签/编号不存在时回的就是 404 页，不是 JSON）。
  // 注意两个「Gitee 专属」判据都不能放宽成裸 `404` / 裸 `Not Found`，否则会抢走 GitHub 的 404。
  const gitee404 = /Not\s+Found\s+Project|"message"\s*:\s*"404\b/i.test(text)
    || (/gitee/i.test(text) && /404|not\s+found|不存在/i.test(text))
    || (/<!doctype\s+html|<html[\s>]|<\/html>/i.test(text) && /404|not\s+found|不存在/i.test(text))
  if (gitee404) {
    return {
      kind: 'notfound',
      short,
      hint: '（Gitee 上标签/仓库/编号不存在：确认标签名（区分大小写）、仓库全名，或改用 issue 编号；也可能是 token 没有这个仓库的权限）',
    }
  }
```

`lib/index.js:2149-2153` 再把这句换成「去建标签」：

```js
        // Gitee 的 404 有一个特例：仓库存在、**标签不存在**也是 404。
        // 不点破的话客户会去查仓库，而真正要做的是「先去 Gitee 建这个标签」。
        if (entry.provider === 'gitee' && why.kind === 'notfound') {
          why = { ...why, hint: '（Gitee 的 ack 标签必须先存在：先去仓库的「标签」页建好「' + label + '」，再 ack 一次）' }
        }
```

**运行时证据**（命令 `E`，直接用 Gitee 真机复刻的四种响应形状喂 `classifyGhError`）：

```text
  HTML 404 页 => {"kind":"notfound","short":"<!DOCTYPE html><html><head><title>你所访问的页面不存在 (404)</title></head><body>gitee.com</body></html>","hint":"（Gitee 上标签/仓库/编号不存在：确认标签名（区分大小写）、仓库全名，或改用 issue 编号；也可能是 token 没有这个仓库的权限）"}
  JSON 404    => {"kind":"notfound","short":"{\"message\":\"404 Not Found\"}","hint":"…"}
  401 token   => {"kind":"auth","short":"{\"message\":\"401 Unauthorized: Access token does not exist\"}","hint":"…"}
  429         => {"kind":"ratelimit","short":"HTTP 429 Too Many Requests","hint":"…"}
```

**为什么这样算修了**：HTML 404 页现在归 `notfound`（不再是 `other`），客户看到的是「去建标签」而不是「没归类的错误」。
`78b501a` 又给 401 补了中文判据（`登录失效|无权限访问该资源`），是加强不是回退。

**残留（不在这 6 条内，只登记）**：`lib/index.js:2156` 的 `LABELS` 表里 `ratelimit: '被 GitHub 限流'`、
`auth: 'gh 登录失效'` 仍是 GitHub 措辞。这对应清单「顺带看到的」第 3 条，本次不动。

---

### 6. 唤醒消息结尾写死「写回 GitHub」、`UNCHANGED_TEXT` 写死「304」、自回声那行少一个空格

**状态：`未修`**（前两处已修，**第三处「少一个空格」仍未修**）

**代码位置**

| 子项 | 位置 | 现状 |
| --- | --- | --- |
| 「写回 GitHub」 | `lib/watch.js:215-218` | **已修**（按 provider 分叉） |
| 「304」 | `lib/index.js:58` + `lib/index.js:1037`（Gitee 用 `UNCHANGED_TEXT_GITEE`） | **已修** |
| 自回声少空格 | `lib/watch.js:133-138` + `lib/gh-format.js:393` | **未修** |

**证据片段 —— 前两处（已修）**

`lib/watch.js:215-218`：

```js
    (options.provider === 'gitee'
      // Gitee 没有 gh CLI：回写走网页/API，别让会话去跑 gh 命令
      ? '\n3. 做完一条就写回 Gitee（网页或 API 都行），并调用 watch_ack 打上已处理标签，不要扩大范围。'
      : '\n3. 做完一条就写回 GitHub，并调用 watch_ack 打上已处理标签，不要扩大范围。')
```

`lib/index.js:56-58` + `lib/index.js:1037`：

```js
const UNCHANGED_TEXT = '未变化（304，不计入速率限制）'
// Gitee 没有 ETag/304：说「304」会让客户以为在省额度，其实每轮都真读
const UNCHANGED_TEXT_GITEE = '未变化（Gitee 无 ETag：这一轮是真空读的）'
```

Gitee 的空列表分支（`lib/index.js:1032-1037`）用的是 `UNCHANGED_TEXT_GITEE`。
另外两处 `UNCHANGED_TEXT` 不可能是 Gitee 走到的：`lib/index.js:1057` 在 `gh api` 分支里，
`lib/index.js:1125` 判的是 `parsed.status === 304`，而 Gitee 固定以
`{ status: 200, etag: null }` 调 `pollWithItems`（`lib/index.js:1043`）。

**证据片段 —— 第三处（未修）**

`lib/watch.js:133-138`：

```js
      item.lastComment
        ? '最后评论: ' + commentSummaryLine({
          login: item.lastComment.self ? '' : item.lastComment.login,
          at: item.lastComment.at,
        }, null) + (item.lastComment.self ? '我（上一轮留的）' : '')
        : null,
```

`lib/gh-format.js:390-393`：

```js
  const who = login ? (isSelf ? '我（上一轮留的）' : '@' + login) : ''
  const when = lastComment.at ? String(lastComment.at) : ''
  if (!who && !when) return ''
  return [who, when].filter(Boolean).join(' ')
```

**运行时证据**（命令 `F'`）：

```text
  自己留的: "#IKSQJH [open] 联调 A — @x (issue) u 未认领 最后评论: 2026-11-04T09:00:00Z我（上一轮留的）"
  别人留的: "#IKSQJH [open] 联调 A — @x (issue) u 未认领 最后评论: @yonijd 2026-11-04T07:23:04Z"
  缺空格的证据: /Z我（上一轮留的）/ = true  /Z 我（上一轮留的）/ = false
```

再看「写回」那一处的运行时对照（命令 `G`）：

```text
  provider=gitee => "3. 做完一条就写回 Gitee（网页或 API 都行），并调用 watch_ack 打上已处理标签，不要扩大范围。"
  provider=github => "3. 做完一条就写回 GitHub，并调用 watch_ack 打上已处理标签，不要扩大范围。"
```

**为什么这条现在还成立**

自回声时 `watch.js:135` 把 `login` 传成空串 `''`，`commentSummaryLine` 里 `who = ''`，
`[who, when].filter(Boolean).join(' ')` 只剩 `when`，**返回值不带尾随空格**；
调用方紧接着 `+ '我（上一轮留的）'`，于是拼成 `2026-11-04T09:00:00Z我（上一轮留的）`——
时间戳和中文之间没有空格，正是清单里记的那个形状。
改法二选一：`lib/watch.js:137` 改成 `' 我（上一轮留的）'`，
或把 133-137 整段改成 `[commentSummaryLine(...), item.lastComment.self ? '我（上一轮留的）' : ''].filter(Boolean).join(' ')`。

---

## 二、跑过的命令与原始输出

### 命令 `A'` —— 第 1 条：⚠ 标记那一半（已修）

```bash
$ node --input-type=module - <<'EOF'
const watch = await import(base + 'watch.js')
const items = [{ number: 'IK1', state: 'open', title: '登录后 502', user: { login: 'y' }, html_url: '…' }]
watch.markGiteeReopened(items, { IK1: 'closed' })
watch.formatWatchText('o/r', items, { provider: 'gitee' }).split('\n')[1]
EOF
```

```text
  "#IK1 [open] 登录后 502 — @y (issue) https://gitee.com/o/r/issues/IK1 ⚠ 这条被重新打开过（之前关过，判"不做"可能不对） 未认领"
```

### 命令 `H` —— 第 1 条：真跑两轮 Gitee 轮询（`lastReopened` / `lastStates` 仍是空）

```bash
$ DSH_SUPERAGENT_STATE="$(mktemp -d)" node --input-type=module -   # 假 fetch：第 1 轮 closed，第 2 轮 open
$ # （完整脚本见提交记录；36 秒等两轮，intervalSec=30）
```

```text
== H. 第1条：真跑两轮轮询（第1轮 closed → 第2轮 open），看 lastReopened 有没有被写 ==
  gitee /issues 被调用轮数 = 2
  entry.lastStates       = undefined
  entry.lastReopened     = undefined
  entry.lastDeferred     = "会话尚未就绪（宿主可能刚启动）：约 10 分钟后仍找不到才报错"
  entry.filteredLog      = ["已关闭:IK1"]
  entry.history          = []
```

### 命令 `I` —— 第 1 条：落盘白名单

```bash
$ node --input-type=module - <<'EOF'
const watch = await import(base + 'watch.js')
console.log('  含 lastReopened = ' + watch.POLL_RESULT_FIELDS.includes('lastReopened'))
console.log('  含 lastStates   = ' + watch.POLL_RESULT_FIELDS.includes('lastStates'))
console.log(JSON.stringify(watch.mergePollResult({ id: 'gitee:o/r#s' }, { lastReopened: 'IK1', lastStates: { IK1: 'open' }, lastPoll: '2026-11-05T00:00:00Z' })))
EOF
```

```text
  含 lastReopened = false
  含 lastStates   = false
  mergePollResult({lastReopened:"IK1", lastStates:{IK1:"open"}, lastPoll:…}) =>
    {"id":"gitee:o/r#s","lastPoll":"2026-11-05T00:00:00Z"}
```

### 命令 `B` —— 第 2 条：`watch_trace` 吃字符串编号

```bash
$ DSH_SUPERAGENT_OFFLINE=1 DSH_SUPERAGENT_NO_POLL=1 DSH_SUPERAGENT_STATE="$(mktemp -d)" node --input-type=module -
```

```text
== B. 第2条：watch_trace 传字符串编号 IKSQJH ==
  watch_trace({number:"IKSQJH"}) =>
    #IKSQJH @ o/r：已记入水位但没唤醒（仅观察，或上报前就已存在）
      水位 seen：2026-11-04T09:00:00.000Z
      被过滤（已关闭）：2026-11-04T08:00:00.000Z
  watch_trace({number:1}) 对照 => "#1 在所有守 里都没有痕迹 —— 可能还没被轮询到，或者编号写错了。"
  schema.number.type = {"type":"number","description":"issue or PR number to trace"}
```

### 命令 `C` —— 第 3 条：`watch_doctor` 对 Gitee 条的完整输出

```bash
$ DSH_SUPERAGENT_NO_POLL=1 DSH_SUPERAGENT_OFFLINE=1 DSH_SUPERAGENT_STATE="$(mktemp -d)" node --input-type=module -
```

```text
== C. 第3条：watch_doctor 对一条 Gitee 守的完整输出 ==
OK 版本一致：0.9.184
OK   面板接口挂载：9 条，无失败
INFO 没有 GitHub 守：跳过 gh 登录检查（Gitee 那条走令牌，见上面）
OK   gitee:o/r 可访问
WARN 没有配置 Gitee token：公开仓库能读，私有仓库读不到，也打不了 ack 标签
INFO Gitee 没有 ETag 条件请求，所以这条守每轮都会真的读一次列表（注意额度）
INFO ack 标签「主理鱼-已处理」：Gitee 需要先在仓库里手动建好这个标签，watch_ack 才能打上
OK   隔离工作目录 D:\主工作区\projects\dsh-session-superagent：是 git 仓库
WARN o/r 已经 120 分钟没轮询过（预期每 60 秒）—— 定时器可能丢了
INFO 运行中 · 上次轮询 2026-11-04T17:48:59.648Z · 正常
```

### 命令 `D` —— 第 4 条：`/state` 投影

```bash
$ # 调 routes.get('/session-superagent/state').handler(...)
```

```text
== D. 第4条：/state 投影的 provider 字段 ==
  watchers[0].provider = "gitee" | id = "gitee:o/r#session-audit"
  gh = {"ok":null,"skipped":"没有 GitHub 守"}
```

### 命令 `E` —— 第 5 条：`classifyGhError` 的四种 Gitee 形状

```bash
$ node --input-type=module - <<'EOF'
const fmt = await import(base + 'gh-format.js')
fmt.classifyGhError('<!DOCTYPE html><html><head><title>你所访问的页面不存在 (404)</title></head></html>')
…
EOF
```

```text
== E. 第5条：classifyGhError 认 Gitee 的 HTML 404 页 ==
  HTML 404 页 => {"kind":"notfound","short":"<!DOCTYPE html><html><head><title>你所访问的页面不存在 (404)</title></head><body>gitee.com</body></html>","hint":"（Gitee 上标签/仓库/编号不存在：确认标签名（区分大小写）、仓库全名，或改用 issue 编号；也可能是 token 没有这个仓库的权限）"}
  JSON 404    => {"kind":"notfound","short":"{\"message\":\"404 Not Found\"}","hint":"（Gitee 上标签/仓库/编号不存在：…）"}
  401 token   => {"kind":"auth","short":"{\"message\":\"401 Unauthorized: Access token does not exist\"}","hint":"（Gitee 私人令牌无效或没填：…）"}
  429         => {"kind":"ratelimit","short":"HTTP 429 Too Many Requests","hint":"（被限流（HTTP 429）：…）"}
```

### 命令 `F'` —— 第 6 条：自回声空格（未修）

```text
== F'. 第6条：自回声 / 别人评论 两行对照 ==
  自己留的: "#IKSQJH [open] 联调 A — @x (issue) u 未认领 最后评论: 2026-11-04T09:00:00Z我（上一轮留的）"
  别人留的: "#IKSQJH [open] 联调 A — @x (issue) u 未认领 最后评论: @yonijd 2026-11-04T07:23:04Z"
  缺空格的证据: /Z我（上一轮留的）/ = true  /Z 我（上一轮留的）/ = false
```

### 命令 `G` —— 第 6 条：「写回」按 provider 分叉（已修）

```text
== G. 第6条：结尾「写回」按 provider 分叉 ==
  provider=gitee => "3. 做完一条就写回 Gitee（网页或 API 都行），并调用 watch_ack 打上已处理标签，不要扩大范围。"
  provider=github => "3. 做完一条就写回 GitHub，并调用 watch_ack 打上已处理标签，不要扩大范围。"
```

### 命令 `J` —— 离线测试套件（全绿）

```bash
$ cd "D:/主工作区/projects/dsh-session-superagent"
$ DSH_SUPERAGENT_OFFLINE=1 node --test > /tmp/test-out.txt 2>&1; echo "exit=$?"; tail -8 /tmp/test-out.txt
```

```text
exit=0
ℹ tests 301
ℹ suites 0
ℹ pass 301
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 2530.7141
```

### 命令 `K` —— 6 条涉及的符号一次性定位（可原样重放）

```bash
$ git rev-parse --short HEAD
78b501a
$ grep -n "state_reason" lib/gitee.js
27: * assignees[].login / html_url / updated_at / state_reason / pull_request / draft。
42:    // Gitee 用 'rejected' 表示「关闭且不修」；state_reason 只有 reopened 会被下游用来警示
43:    state_reason: String(item.state_reason || (String(item.state || '').toLowerCase() === 'reopened' ? 'reopened' : '')) || null,
$ grep -n "lastReopened\|markGiteeReopened\|lastStates" lib/index.js
1173:  if (reopened) entry.lastReopened = reopened.number
1199:    entry.lastStates = markGiteeReopened(items, entry.lastStates || {})
1610:            lastReopened: w.lastReopened ?? null,
$ grep -n "POLL_RESULT_FIELDS = \[" lib/watch.js
560:export const POLL_RESULT_FIELDS = [
$ grep -n "const rawNumber = args.number\|number: { type: 'number'" lib/index.js
2098:      number: { type: 'number', description: 'issue or PR number' },
2193:      number: { type: 'number', description: 'issue or PR number to trace' },
2208:      const rawNumber = args.number == null ? '' : String(args.number).trim()
$ grep -n "provider: w.provider === 'gitee'" lib/index.js
1589:            provider: w.provider === 'gitee' ? 'gitee' : 'github',
$ grep -n "const gitee404\|if (gitee404)" lib/gh-format.js
109:  const gitee404 = /Not\s+Found\s+Project|"message"\s*:\s*"404\b/i.test(text)
112:  if (gitee404) {
$ grep -n "写回 Gitee\|写回 GitHub\|我（上一轮留的）" lib/watch.js
137:        }, null) + (item.lastComment.self ? '我（上一轮留的）' : '')
217:      ? '\n3. 做完一条就写回 Gitee（网页或 API 都行），并调用 watch_ack 打上已处理标签，不要扩大范围。'
218:      : '\n3. 做完一条就写回 GitHub，并调用 watch_ack 打上已处理标签，不要扩大范围。')
$ sed -n '2320,2415p' lib/index.js | grep -c continue
0
```

---

## 结论

**6 条里还剩 2 条要修**（第 1 条、第 6 条的自回声空格）。按影响客户的程度排序：

| 排序 | 条目 | 为什么是这个位置 | 修的时候注意 |
| --- | --- | --- | --- |
| 1 | **第 1 条** `lastReopened` 永远不出现 | 唯一一条**跨 provider 全挂**的：GitHub 与 Gitee 的面板都看不到「被重新打开过」。被关过又被重开的 issue 本来是最该先处理的一类（唤醒消息里 `+100` 加权），现在只剩聊天里那个 ⚠，面板和跨重启全丢 | **两处一起改**：`lib/index.js:1172-1173` 挪到 `1197-1199` 之后；`'lastReopened'`（和 `'lastStates'`）加进 `lib/watch.js:560-566` 的 `POLL_RESULT_FIELDS` |
| 2 | **第 6 条（自回声空格）** | 纯粹一行文案：`09:00:00Z我（上一轮留的）` 读着像时间戳后缀。不丢信息、不误判，只是每天都在 | 改 `lib/watch.js:137` 加个前导空格，或改成 `[…].filter(Boolean).join(' ')` |

**已经不用动的 4 条**：第 2 条（`String()` 化 + 白名单正则）、第 3 条（`continue` 已拿掉，三行输出都跑得出来）、
第 4 条（`/state` 有 `provider`）、第 5 条（HTML 404 归 `notfound` 并给「去建标签」的下一步）。
这 4 条都有「跑得出来」的运行时证据，不是只看代码。

**顺带说两句（本次没动，也不在这 6 条内）**

- `lib/index.js:2193` 的 `number: { type: 'number' }` —— 第 2 条只修了 `execute` 里的 `Number()`，
  schema 还写着数字。本仓库不校验，但宿主一旦校验就会在进 `execute` 前拒掉 `"IKSQJH"`。彻底做法是改成 `type: 'string'`。
- `lib/index.js:2156` 的 `LABELS` 表里 `ratelimit: '被 GitHub 限流'`、`auth: 'gh 登录失效'` 仍是 GitHub 措辞 ——
  对应清单「顺带看到的」第 3 条，Gitee 的 429 会套上「被 GitHub 限流」。
