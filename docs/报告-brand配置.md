# 报告：品牌与默认 ack 配置链路（issue #11）

> 分支 `feat/brand-config`，worktree `D:\主工作区\projects\dsh-session-superagent-brand-config`，基线 `3bc0f56`（0.10.0）。
> 本次不 commit、不改版本号。

## 结论

- 三个配置项 `brandName` / `defaultAckLabel` / `defaultAckLabelGitee` 从 `Config`（schemastery）一路接到
  `lib` 的默认 ack 派生、`/state` 下发、`client.js` 的三处 ack 回落与标题/空态；默认值全部等于 0.10.0 的旧字面量，
  **不配置时行为逐字不变**。
- 唤醒抬头（`formatWatchText` / `mergeWakeTexts`）支持品牌名，三处抬头统一；已有 watcher 的显式 `ackLabel` 不被覆盖。
- 门禁：`npm test` **689/689**；`ui-audit` **11/11 = 100**；真实 Chromium **47/47**（见 §五）。

## 一、配置面

`lib/index.js` 新增 `export const Config`（[lib/index.js:126](../lib/index.js#L126)）：

| 键 | 默认 | 作用范围 |
|---|---|---|
| `brandName` | `主理鱼` | 唤醒抬头、合并抬头、面板标题/空态/dock 标题 |
| `defaultAckLabel` | `主理鱼:已处理` | **GitHub** 守的默认 ack 标签 |
| `defaultAckLabelGitee` | `主理鱼-已处理` | **Gitee** 守的默认 ack 标签 |

归一化在 `apply()` 入口完成（[lib/index.js:159](../lib/index.js#L159) `resolveBrandConfig`）：

- 品牌名 trim、压平换行（抬头是单行结构，换行会伪造出第二条消息），空值回落 `主理鱼`。
- 两个 ack 标签 trim；空值回落各自默认。
- Gitee 标签用 `isValidGiteeLabel`（[lib/gitee.js:275](../lib/gitee.js#L275)）校验：汉字/字母/数字/`. _ - / \`、2–20 字、不能有半角冒号；
  非法值回落 `主理鱼-已处理`，避免「每次 ack 都 404，但报错看起来像仓库问题」。
- GitHub 标签保留手工填写的 60 字上限（与 `watch_start` / 面板保存同口径）。

## 二、链路上每一跳

### 1. `lib/watch.js`

- 新增 `DEFAULT_BRAND_NAME` 与 `normalizeBrandName`（[lib/watch.js:19](../lib/watch.js#L19)、[:27](../lib/watch.js#L27)）。
- `buildWakeSections` 抬头改为 `【${brandName}】…`，覆盖「首次同步」与「有 N 条新动态」两种（[lib/watch.js:287](../lib/watch.js#L287)）。
- `mergeWakeTexts(parts, { brandName })` 合并抬头同步（[lib/watch.js:906](../lib/watch.js#L906)）；单条时原样返回，不重写抬头。
- 新增 `defaultAckLabelFor(provider, labels)` 与 `statusView(..., { defaultAckLabels })`（[lib/watch.js:1168](../lib/watch.js#L1168)、[:1214](../lib/watch.js#L1214)）；
  不传时保持旧默认。
- 为拿到 Gitee 默认常量复用了 `./gitee.js` 的 `DEFAULT_ACK_LABEL_GITEE`（纯常量，模块顶层无副作用）。

### 2. `lib/index.js`

- `Config` + `normalizeDefaultAckLabel` + `resolveBrandConfig`（见上）。
- `apply()` 解析出 `brand` 后，所有默认 ack 派生都带配置：
  - `pollOnce` 的 ack 判定（[lib/index.js:1469](../lib/index.js#L1469)）；
  - `/state` 的 watcher 投影（[:1963](../lib/index.js#L1963)）；
  - HTTP 创建（[:2244](../lib/index.js#L2244)）；
  - `watch_start` 新建（[:3128](../lib/index.js#L3128)）；
  - `watch_ack` 的默认 label（[:2682](../lib/index.js#L2682)）；
  - `watch_doctor` 的标签检查（[:2952](../lib/index.js#L2952)）；
  - `watch_status` 视图（[:3289](../lib/index.js#L3289)）。
- 唤醒：`formatWatchText` 传 `brandName`（[:1634](../lib/index.js#L1634)），`wakeMerged` 增加末位 `brandName` 参数并传给 `mergeWakeTexts`（[:912](../lib/index.js#L912)、[:1711](../lib/index.js#L1711)）。
- 工具 schema 文本由 `apply` 按品牌生成（[:2649](../lib/index.js#L2649)、[:2656](../lib/index.js#L2656)、[:3093](../lib/index.js#L3093)），静态常量与注释未动。
- **修正一个会吞掉配置的旧行为**：[lib/index.js:274](../lib/index.js#L274) 的 Gitee 历史归一化以前对「没有 ackLabel」的条目也会补默认值，
  于是 `entry.ackLabel ||` 永远先命中旧默认。现在只迁移「存了 Gitee 建不出来的旧标签」，空值留给调用方按配置派生。

### 3. `/state`

顶层新增（[lib/index.js:2041](../lib/index.js#L2041)）：

```json
{
  "brandName": "主理鱼",
  "defaultAckLabels": { "github": "主理鱼:已处理", "gitee": "主理鱼-已处理" }
}
```

两个字段都在 `stateBody` 里、参与 ETag 的稳定指纹（`updatedAt` 之外整份 body）计算 —— 配置变化时下一次轮询不会命中 304。
老客户端不认识这两个字段，行为不变。

### 4. `client.js`

- 三处 ack 回落改读 `/state.defaultAckLabels`，缺省仍回落旧字面量：
  - `watcherValuesFrom(watcher, ackDefaults)`（[client.js:1056](../client.js#L1056)）；
  - `applyWatcherEditor` 的 `ackLabel`（[client.js:2317](../client.js#L2317)）；
  - 行内「回执 …」Tag（[client.js:2657](../client.js#L2657)）。
  统一走 `ackLabelFallback`（[client.js:1043](../client.js#L1043)），GitHub/Gitee 各一张。
- 主面板 `BRAND = body.brandName || '主理鱼'`、`ACK_DEFAULTS = body.defaultAckLabels`（[client.js:2300](../client.js#L2300)）：
  主标题（[:3584](../client.js#L3584)）、Section「主理鱼」（[:2975](../client.js#L2975)）、统计条单位（[:2898](../client.js#L2898)）、
  新增 Section（[:3225](../client.js#L3225)）、列表/判定空态（[:2984](../client.js#L2984)、[:3072](../client.js#L3072)）、术语表（[:3679](../client.js#L3679)）。
- dock 增加第 5 个状态槽 `brandName`（[client.js:1696](../client.js#L1696)），`/state` 回来后更新；
  dock 标题、空态、footer、圆环 `title`/`aria-label` 的空态文案都跟着走（[:1798](../client.js#L1798)、[:1823](../client.js#L1823)、[:1993](../client.js#L1993)、[:2004](../client.js#L2004)、[:2010](../client.js#L2010)）。
- 没有为其余写死文案做大重构（清单见 §四）。

### 5. 依赖

`package.json` / `package-lock.json` 增加 `"@deepseek-ai/schemastery": "3.18.5"`（精确对齐宿主 profile 里的版本，避免用更新版本引入行为差异）。

## 三、测试（先红后绿）

新增 `test/brand-config.test.mjs`，14 条：

1. `Config` 默认值与自定义字段；
2. normalize：trim / 空值 / 换行 / 非法 Gitee 回落；
3. 唤醒抬头 + 合并抬头 + 默认值；
4. `statusView` 的默认 ack（按 provider）与显式 ack；
5. `/state` 下发 `brandName` / `defaultAckLabels`，缺省派生 + 显式不覆盖；
6. Gitee 历史旧标签迁移，但不吞配置默认；
7. `watch_start` 新建用品牌默认、显式优先、重复 start 不覆盖；
8. `watch_ack` 对无 `ackLabel` 的历史守用品牌默认；
9. 工具描述由 `apply` 生成；
10. 轮询路径（`pollWithItems`）按品牌默认 ack 过滤，旧默认不再误判；
11-13. client 三处 ack 读 state / 缺省回落 / 编辑草稿；
14. client 主标题、dock 标题、空态与默认品牌。

红→绿记录：先写用例（此时 `Config` 未导出、抬头仍是 `【主理鱼】`、`/state` 没有字段、三处 ack 仍是旧字面量），
`node --test test/brand-config.test.mjs` 得 11 红 1 绿（当时 12 条，Gitee 迁移与轮询路径两条是随后补的）；实现后 14/14 绿，再跑全量。

必要的配套测试/工具同步（说明理由，避免"测试被改绿"的误解）：

- `test/client.test.mjs` 样式注入用例的源码窗口 2500 → 3200：`StatusOrbit` 增加了品牌状态与文案，原窗口量不到 `ensurePortedCss(true)`，断言本身未改。
- `test/ui-l84-records-confirm.test.mjs` / `test/ui-l84-host-modal-toast.test.mjs`：状态槽队列插入 `'主理鱼'`（第 5 位）；
  成功关闭 Modal 的断言 index 4 → 5。这是项目约定的「位置化 hook 队列必须同步」，不是放宽断言。
- `scripts/render-preview.mjs` 的预览快照补 `brandName` / `defaultAckLabels`，否则 `preview-contract` 会红（该测试的本意就是快照必须覆盖 client 读的字段）。

真实数字：

| 门禁 | 结果 |
|---|---|
| `npm test` | **689 / 689 通过**（基线 675 + 新增 14） |
| `node scripts/ui-audit.mjs` | **11/11 通过 = 100 分**（写死颜色 0、自造 token 0） |
| 真实 Chromium（`scripts/verify-panel-chromium.mjs`） | **47 / 47 通过，0 失败，exit 0**；Chromium `156.0.8078.74`，前端 `0.2.1-rc.5`，`clientSha256 = 1616218c4bf6d7d09af56b8c71af5584e75d1e7eedca8dfe79133ac885be7a87`（与本 worktree 的 `client.js` 一致） |

## 四、未覆盖清单（真实计数）

「不配置时行为不变」优先，以下位置仍写死 `主理鱼` 或旧标签。它们都在正文里可见/可复制，但本次没有继续展开：

### A. client.js 里用户可见、仍写死（7 行共 13 个字符串）

| 行 | 文案 | 说明 |
|---|---|---|
| [1085](../client.js#L1085) | ack 输入框 placeholder `主理鱼:已处理` | 只是占位提示；实际值已按 state 填 |
| [3255](../client.js#L3255) | `不需要（没有 GitHub 主理鱼）` | 凭证卡片副文案 |
| [3489](../client.js#L3489)–[3491](../client.js#L3491) | 可复制的 `AGENTS_SNIPPET` 规则（`## 主理鱼…`、`【主理鱼】<owner/name>…`） | 静态常量，复制进用户 AGENTS.md |
| [3559](../client.js#L3559)–[3560](../client.js#L3560) | 仓库被禁用 / 关闭 Issues 的提示 | 与 `lib/gh-format.js` 重复的一份客户端文案 |
| [3599](../client.js#L3599)–[3611](../client.js#L3611) | 全部暂停/恢复的 `title` 与 `aria-label`（6 处） | 可访问性名称，读屏会念 |
| [3621](../client.js#L3621) | SegTabs `aria-label: '主理鱼分区'` | 分区名 |
| [3718](../client.js#L3718) | 中间栏 tab `label: '主理鱼'` | 在模块注册时生成，早于 `/state` 首次返回，需要另设注入通道才改得动 |

### B. 设计上保留的旧字面量（不是漏改）

- `ACK_LABEL_FALLBACK`（[client.js:1042](../client.js#L1042)）与 `BRAND`/`brandName` 的缺省：老服务端没有新字段时的兼容回落。
- 注释里的「主理鱼」（[1694](../client.js#L1694)、[1730](../client.js#L1730)、[2050](../client.js#L2050)、[3069](../client.js#L3069)、[3710](../client.js#L3710)）。

### C. lib 侧（不在本次可写范围或属于错误短句）

- `/diagnose` 抬头 `主理鱼诊断 · …`（[lib/index.js:2380](../lib/index.js#L2380)）。
- 会话缺失/未知守的错误短句（[lib/index.js:933](../lib/index.js#L933)、[:1599](../lib/index.js#L1599)、[:2178](../lib/index.js#L2178)、[:2179](../lib/index.js#L2179)）。
- `lib/gh-format.js` 的仓库结构提示（[lib/gh-format.js:328](../lib/gh-format.js#L328)、[:331](../lib/gh-format.js#L331)）。

## 五、未验项与边界

- 自定义品牌在**真实宿主**里的端到端（改 profile 行配置 → 重载宿主 → 看唤醒抬头）未做：本任务不重启宿主、不写 profile 配置；
  链路由单测（Config / 路由 / 工具 / client 渲染）+ 真实 Chromium 的默认品牌路径覆盖。
- 配置在 `apply()` 时读取，**改完必须重载宿主**才生效（服务端部分）；客户端 `/state` 轮询会在重载后自动跟上。
- 未做物理读屏、触摸、IME 验收（与既有 Chromium 验收的未验项一致）。
- 未 commit / 未 push（按要求）。

## 六、附带改动

- `README.md` 新增「配置：品牌与默认 ack 标签」一节（键、默认值、YAML 片段、生效时机、校验规则）。
- `SETUP.md` 的「默认值」一条注明三项可配置、计划里按实际配置写。
- 为保持门禁绿：预览快照补两字段、两处测试队列同步（见 §三）。
- `package-lock.json` 的 root version 被 `npm install` 自动对齐到 `0.10.0`（package.json 的版本号未改）。
