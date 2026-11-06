# 凭证与 goal 保存 pending 状态机修复报告

## 1. 范围与结论

- 工作树：`D:\主工作区\projects\dsh-session-superagent-pending-saves`，分支 `task/pending-saves`，基线 `4253b4f`（`0.9.282`）。
- 改动仅涉及 `client.js`、`test/update-ui.test.mjs` 与本报告；没有修改 watcher 新建、行内编辑或切换草稿逻辑。
- 没有修改 `lib/`、`package.json`、版本号、preflight、派单表；没有 commit、push、重启或重载 DSH。
- 结果：凭证和 goal 在保存 pending 中仍可输入，晚到的旧响应不会清理或覆盖新输入；POST 成功但回读失败时不再假报成功；`sessionGoal:null` 能清空干净草稿且保留 dirty 草稿。

## 2. 根因与修复

### 2.1 旧保存响应覆盖 pending 后的新输入

旧凭证回调在 POST 成功后无条件执行 `setToken('')`、`setGhDir('')`、`setGiteeToken('')`；旧 goal 回调无条件执行 `setGoalTouched(false)`。因此 pending 中继续输入后，早先那次保存的回调仍会清新草稿，或通过 goal 同步 effect 回写服务端旧值。

修复采用 **草稿版本 + 保存序号**，不锁定输入，也不新增 `useState` 槽位：

- 三个凭证输入和 goal textarea 的每次 `onChange` 都递增各自的草稿版本 ref。
- 每次实际进入保存工作时递增保存序号；POST 始终使用点击时的受控值快照。
- 回读成功后，只有“保存序号仍最新且草稿版本未变化”才清理本次已提交字段或把 goal 标为 clean。
- 既有 `busyRef` 继续同步防重入；pending 中重复点击返回 `false`，不会产生第二个 POST。序号递增放在 `run()` 接受工作之后，因此被拒绝的重复点击不会使第一次保存的清理失效。

相关实现：`client.js:1993-1998`、`client.js:2267-2312`、`client.js:2990-2992`、`client.js:3073`。

### 2.2 POST200 + GET500 假成功

旧 `run()` 的顺序是 `work() → 成功 Toast → load()`，而 `load()` 捕获 GET 错误后返回 `null`。所以 POST200 + GET500 仍显示成功，goal 还可能先被标成 clean，再让旧快照回写。

修复给 `run()` 增加仅由凭证和 goal 使用的局部选项：

- `requireReload:true`：先等待 `/state` 回读；没有得到有效结果就抛出“已提交，但回读失败，请重试”。
- `afterReload`：只在有效回读后执行受版本保护的清理。
- 成功 Toast 移到有效回读之后；其它 watcher/批量动作继续使用原来的通知与刷新契约。
- 有本地 body 的 304 是有效回读；首帧没有 body 的 304 仍清 ETag 并重取全量，不改变旧首载修复。
- `loadSeqRef` 继续丢弃后到旧 `/state` 响应。若保存自己的回读已被更新请求取代，保存不会把这次 `null` 当成确认成功。

相关实现：`client.js:2054-2075`、`client.js:2093-2129`。

### 2.3 `sessionGoal:null` 不同步

旧 effect 在 `!sessionGoal` 时直接返回。现在只在 `goalTouched` 时保留用户草稿；干净状态下，goal 对象同步其 `objective`，`null` 同步为空串。

相关实现：`client.js:2087-2091`。

## 3. 先红后绿证据

新增 7 条真实 UMD 行为测试，控制 deferred POST/GET、记录 setter 与 Toast，并在需要时模拟 async setter 后的重渲染/effect。

首次修正夹具后的基线：**5 失败 / 7**；另外 2 条（乱序 `/state`、正常成功清理）在旧实现上已通过，用作防回归守卫。修复后：**7/7 通过**。

| 覆盖点 | 旧实现结果 | 修复后 |
|---|---:|---:|
| 凭证 pending 新输入、晚到旧成功、重复点击只有一个 POST | 红：三个字段被清空 | 绿 |
| goal pending 新输入、晚到旧成功、重复点击只有一个 POST | 红：dirty 被清成 false | 绿 |
| 凭证 POST200 + GET500 | 红：返回 true、成功 Toast、清草稿 | 绿 |
| goal POST200 + GET500、重渲染后不回写旧 goal | 红：返回 true、成功 Toast、标 clean | 绿 |
| `sessionGoal:null` 清干净草稿且保留 dirty | 红：干净草稿未清空 | 绿 |
| 两次 `/state` 逆序完成，后到旧响应被丢弃 | 绿（既有能力守卫） | 绿 |
| 无 pending 新输入时，成功回读后正常清凭证并标 goal clean | 绿（正常路径守卫） | 绿 |

## 4. 验证结果

| 命令 / 验收 | 结果 |
|---|---:|
| `timeout 120 node --test --test-name-pattern='pending\|POST200\|sessionGoal:null\|乱序 /state\|无 pending' test/update-ui.test.mjs` | **7/7** |
| `timeout 180 node scripts/test.mjs test/update-ui.test.mjs` | **48/48** |
| `timeout 180 node scripts/test.mjs test/client.test.mjs` | **96/96** |
| `timeout 300 npm test` | **637/637，exit 0** |
| `timeout 60 node scripts/ui-audit.mjs --json` | **11/11，100 分** |
| `node --check client.js`、`git diff --check` | 通过 |
| 主线 `scripts/verify-panel-chromium.mjs` | **47/47，exit 0** |
| 主线 47 项 + 本任务 5 项真实 Chromium 专项 | **52/52，exit 0** |

UI 审计原始关键值：可点但不可键盘操作的裸 div 0、焦点可见规则 17、自造样式写死颜色 0、缺名图标按钮 0、空态分支 17、弹层键盘行为 3/3、自造死类 0、官方结构采用 8/8、含 inline/JS 写死颜色 0、自造 token 0。

## 5. 真实 Chromium 证据

- Chromium：`156.0.8078.74`；安装版 frontend/primitives：`0.2.1-rc.5`；React：`18.3.1`。
- 被测 `client.js` SHA-256：`c0b30683253234ff13d42f54b15cc6830c89411ee1379941b34c1f6eaba605a8`。
- 主线完整走查 47/47，包括 desk/orbit、表单、键盘焦点、设置分区、Toast/Modal 与防写 guard。
- 专项复用主线真实 client.js、安装版 React/primitives 和 loopback 页面；只在页面侧 mock `/credentials`、`/goal` 与指定 `/state` 响应，不放宽服务端防写 guard，不执行真实保存：
  1. 凭证 pending 中真实键入 `fixture-pending-new-token`，旧响应结束后仍在；重复点击 `posts=1`。
  2. goal pending 中真实键入 `fixture-pending-new-goal`，旧响应结束后仍在；重复点击 `posts=1`。
  3. goal POST200 + GET500 后草稿仍为 `fixture-pending-new-goal`，唯一当前 alert 为“goal 已提交，但回读失败，请重试”，没有成功 Toast。
  4. `sessionGoal:null` 清空干净 goal；随后输入的 dirty 草稿经刷新仍保留。
  5. 专项无未捕获页面错误、无外部请求；服务端防写探针仍返回 403。

## 6. 边界与未验项

- 真实浏览器验收使用独立 loopback fixture，不冒充已执行真实 DSH Web GUI 宿主安装、重载或真实凭证/goal 写入。
- 既有 Ego/CDP 截图通道按主线设置跳过；本报告的功能结论来自真实 Chromium DOM、键鼠、Toast 和请求控制，不宣称新增视觉截图验收。
- 未验物理读屏、IME、触摸与真实 GitHub/Gitee 响应；这些不属于本次状态机改动的新边界。
- watcher 切换草稿按任务要求留给另一批，本报告没有处理或宣称验证它。
- 浏览器工具提示 Ego Lite 有更新（当前 `0.6.2.7`）；本任务未升级工具。
