# 0.9.281 主理鱼剩余 UI 严格审查

> 日期：2026-11-06  
> 基线：`dsh-session-superagent@0.9.281`，HEAD `a4254eb8fe53dfff3a4a0541438a483e80beeea5`  
> 工作树：`D:\主工作区\projects\dsh-session-superagent-ui-strict-audit`  
> 口径：只读审查；本报告是唯一交付文件。没有修改 `client.js`、`lib/`、`ui-*`、package 或版本，没有 commit/push，也没有声称下列问题已经修复。

## 1. 结论与证据边界

- **必须修 11 项，值得改 18 项。** 都是当前可达的行为、状态、数据或可访问性缺陷；没有“自制不如官方”“颜色/间距不同”这类风格建议。
- 另列 **暂不改/排除项**：包括未使用的 `SegmentedControl`、不存在的 `select`、没有稳定复现的窄屏问题，以及曾被怀疑但隔离复验通过的 Switch/Tooltip。
- 当前 `client.js` SHA-256 为 `a69cc528ec964e8fb3737ab859107ea6f845fd83f935926c721da2cb77b9c531`；Chromium 证据已核对这个哈希，没有把同名版本的其他工作树结果混入。
- 证据等级在条目中明示：
  - **静态确定**：当前源码与服务端契约即可确定结果，给出可控 fixture 的最短复现；不冒称已做真机走查。
  - **渲染/异步探针**：在当前 worktree 的真实组件代码上复现了所述状态或请求序列。
  - **Chromium**：使用安装版 DSH React 18.3.1 / primitives 与真实 Chromium 156 的 loopback 页面，不是静态截图猜测。
- 本轮亲自执行 `node scripts/test.mjs`：**622/622 PASS**；定向 host primitives、Orbit、Modal/Toast/Tooltip、表单测试：**54/54 PASS**；并行定向复核另为 **148/148 PASS**。测试后生产文件未改。
- 当前哈希的完整 `scripts/verify-panel-chromium.mjs` 曾得到 43/47；优先级 Switch 与 Tooltip 的隔离 Chromium 复验 **22/22 PASS**，guard 也已得到预期 403，剩余失败是脚本日志断言。上述不稳定/harness 项均没有当成产品缺陷，也不宣称“47/47”。
- **未验证**：真实登录态 DSH WebView 中的完整会话、物理读屏、触摸、IME、真实 GitHub/Gitee 响应。窄屏证据仅限 loopback：已走查 320/360/640/768/1024px 的总览、判定、触发高级区和设置五区，未发现稳定可复现的横向溢出或遮挡；不等同于所有真实 WebView 尺寸均已通过。

### 1.1 官方基线

核对了本机官方主库、`docs/ui-decomp/01-dsh-ui-tree.md`、`02-superagent-assets.md`、`03-gap-map.md` 和当前安装版原语实现。官方/移植合同里与本报告直接相关的事实包括：

- 首次无数据应有 LoadState，后续错误保留旧内容，见 [02-superagent-assets.md:70-74](ui-decomp/02-superagent-assets.md#L70)。
- `Fields/Field` 保存期禁用，SaveBar 隐藏时修复焦点，见 [02-superagent-assets.md:74](ui-decomp/02-superagent-assets.md#L74) 与 [02-superagent-assets.md:88](ui-decomp/02-superagent-assets.md#L88)。
- 官方 `Switch.onChange` 传 `!checked` 布尔值；本次没有凭猜测把它误报为 DOM event 签名错配。

---

## 2. 必须修

### M1. 主面板 `/state` 未携带 `sessionId`，goal、标题和“本会话”用量读错作用域

- **证据**：静态确定 + 服务端契约。
- **定位**：[client.js:2022-2042](../client.js#L2022)、[lib/index.js:1877](../lib/index.js#L1877)、[lib/index.js:1944-1971](../lib/index.js#L1944)、[lib/watch.js:815-823](../lib/watch.js#L815)。
- **复现**：给 `ZhuliPanel` 传真实 `sessionId=s1`，s1 已有 goal、标题及近一小时唤醒。面板实际请求仍是 `GET /state`，没有 `?sessionId=s1`。服务端因此以空字符串调用 `goalView`、`sessionTitle`、`sessionWakesLastHour`：前两者返回 `null`，唤醒数返回 `0`。
- **影响**：设置页不能可靠回显当前会话 goal；页头丢失会话标题；“本会话近一小时唤醒”可错误显示 `0 / cap`。这不是 textarea 的外观问题，而是请求上下文错误。
- **最小修复**：为主面板实际 `load()` 构造带 `encodeURIComponent(sessionId)` 的 state path，并补齐 `useCallback` 依赖；路由发现可以只用于发现 base，但业务读取必须带当前会话。若同一宿主可切换会话，ETag/body 也要按会话隔离，不能跨会话复用 304。
- **必须验证**：两个会话分别有 goal/标题/用量时互不串值；首拉、304、手动刷新、保存后回读都带同一 `sessionId`；无 `sessionId` 时明确显示未绑定，而不是伪造空 goal/0 用量。

### M2. 主面板首次 loading/失败同时渲染“零统计 + 零配置 Onboarding”

- **证据**：当前渲染桩实测。
- **定位**：[client.js:1939](../client.js#L1939)、[client.js:2037-2051](../client.js#L2037)、[client.js:2645-2650](../client.js#L2645)、[client.js:3272-3290](../client.js#L3272)。
- **复现**：首次 `/state` pending 时，树中同时存在“正在读取…”、全 0 统计和“三步让这个会话开始盯办”；首次 `/state=500` 时，同时存在“读不到面板数据”和同一 Onboarding。根因是 `snap.body=null` 被替换为 `{}`，业务 tab 又始终渲染。
- **影响**：把“未知/失败”谎报成真实空目录，可能引导重复添加；也与 stale body + error 的正确语义冲突。
- **最小修复**：只有 `snap.body` 存在时才渲染业务 tab；无 body + loading 只显示加载，无 body + error 只显示错误/重试。至少 Onboarding 必须同时要求 `snap.body && watchers.length===0`。保留 stale body + error 的旧数据路径。
- **必须验证**：首次 pending、首次失败、stale + 失败、成功但 `watchers:[]` 四态互斥；重试成功清错；恢复时不丢新建/编辑草稿。

### M3. Orbit 把 loading、首次读取失败和真实空统一显示成“还没有主理鱼”

- **证据**：异步渲染探针实测。
- **定位**：[client.js:1556](../client.js#L1556)、[client.js:1574-1587](../client.js#L1574)、[client.js:1621-1630](../client.js#L1621)、[client.js:1796-1800](../client.js#L1796)。
- **复现**：初次请求尚未返回时，`aria-label` 已是“还没有主理鱼”；首次 `/state` reject 后，`watchers` 从 `null` 变为 `[]`，没有 read error，摘要和面板仍称零配置。
- **影响**：视觉与读屏都把加载/故障说成空配置；首败没有真实原因和重试入口。
- **最小修复**：保留 `null=loading`、`[]=真实空`，增加独立 `readError`；首败显示错误和重试，stale 失败保留旧 watchers 并提示过期，成功再清 read error。新增 hook 时同步位置化测试桩。
- **必须验证**：loading、真实空、首败、stale + 失败四态文案互斥；首败不再灰显“没有”；恢复后状态与计数正确。

### M4. 鼠标点击保存时，原生约束校验失败没有任何反馈

- **证据**：静态确定；现有测试直接调用 `onClick()`，恰好绕过真实 click 默认行为。
- **定位**：[client.js:1140-1146](../client.js#L1140)、[client.js:1206-1221](../client.js#L1206)。
- **复现**：新建填合法 repo，把间隔改成 `10`（min=30），点击“添加到当前会话”；或仓库仍空但先改其它字段。`submit()` 先 `preventDefault()`，`checkValidity()` 返回 false 后直接 return，既不 `reportValidity()` 也不写块级错误。结果为零 POST、无原生气泡、无 SaveBar/全局错误。
- **影响**：界面看起来可保存却完全无响应；鼠标与 Enter 的原生提交路径不一致。
- **最小修复**：提交按钮只走原生 `form.onSubmit`；或在校验失败时调用 `form.reportValidity()` 并保持零 POST。不要既取消 click 默认提交又不给错误。
- **必须验证**：repo required、interval 与高级数字 min/max 在鼠标和 Enter 下均出现可见错误；修正后只提交一次；保存中仍防重入。

### M5. 收起或切换 watcher 会静默丢弃 dirty 编辑

- **证据**：静态确定。
- **定位**：[client.js:2295-2328](../client.js#L2295)、[client.js:2415-2431](../client.js#L2415)。
- **复现**：展开 A，修改 goal 不保存；再点 A 标题收起，或点 B 标题。代码无条件清 `touchedRef/editSnapshotRef` 并用 watcher 重填 `draft`。重新打开 A 后修改消失。
- **影响**：未保存数据无提示丢失；“放弃”按钮之外还存在一条绕过确认的丢弃路径。
- **最小修复**：dirty 时收起/换行必须保留对应草稿，或通过现有 Modal 明确“继续编辑/放弃”；只有确认放弃或 clean 时才清 ref。非 dirty 保持现行为。
- **必须验证**：取消放弃后 draft/touched 原样；确认放弃才清；A→B→A 不串草稿；切 tab 不误清；保存成功仍正常关闭。

### M6. 凭证保存 pending 中继续输入，旧成功回调会清掉新草稿

- **证据**：静态确定。
- **定位**：[client.js:2059-2088](../client.js#L2059)、[client.js:2227-2240](../client.js#L2227)、[client.js:2924-2935](../client.js#L2924)。
- **复现**：延迟 `POST /credentials`；输入 token A→点保存→pending 中再输入 B→旧请求成功。三个输入未 disabled，成功回调无条件执行 `setToken('')/setGhDir('')/setGiteeToken('')`，尚未提交的 B 被清空。
- **影响**：新 secret/路径无提示丢失；`busyRef` 只挡第二个动作，并不保护输入。
- **最小修复**：凭证块增加可渲染 busy，保存中禁用字段/保存/解绑；或仅当当前值仍等于本次提交快照时才清理，保留 newer draft。
- **必须验证**：deferred POST 中追加输入不丢、不重复 POST；失败保留输入；只提交 token 不误清 ghDir；成功后清理的确实是已提交值。

### M7. goal 草稿状态机可覆盖新输入，且在保存回读失败或服务端 null 时显示旧值

- **证据**：静态确定 + 当前哈希 Chromium 复现；空值契约见 [lib/index.js:2477-2487](../lib/index.js#L2477)。
- **定位**：[client.js:2054-2057](../client.js#L2054)、[client.js:2072-2075](../client.js#L2072)、[client.js:2243-2250](../client.js#L2243)、[client.js:3007-3013](../client.js#L3007)。
- **复现 A（pending 新草稿）**：延迟 `/goal`；保存 A 后 pending 中继续输入 B。成功回调先 `setGoalTouched(false)`，随后 effect 用回读的 sessionGoal 覆盖 textarea，B 丢失。
- **复现 B（POST 成功、回读失败，Chromium 实测）**：初始为旧 goal，输入新 goal；`/goal` POST 200 且请求体为新值，下一 `/state` 返回 500。textarea 回到旧 goal，同时出现读取错误卡和“goal 已保存”Toast。根因是确认刷新前就清 touched，且 `load()` 内部吞掉读取失败，`run()` 仍走成功反馈。
- **复现 C（外部清空，Chromium 实测）**：textarea 初始为固定 goal，服务端清为 `sessionGoal:null` 后刷新；effect 因 `!sessionGoal` 直接 return，textarea 仍保留旧值。之后点保存会复活旧 goal。M1 的缺参数会使 null 更常见，但即使修好 M1，这个 null 分支仍需单独修。
- **影响**：新草稿丢失；保存反馈与可见草稿矛盾；UI 与服务端真值相反。
- **最小修复**：保存期间锁定 goal 或按提交快照/草稿 revision 条件结束保存态；只有新 `/state` 已确认保存值后才清 touched，刷新失败保留新草稿并明确显示“已保存但未回读”。未 touched 时无论值是对象还是 null，都同步为 `sessionGoal?.objective || ''`。可消费 POST 返回的真实 `sessionGoal`。
- **必须验证**：pending 中继续输入；POST200+GET500、POST200+GET200、POST500、POST200+304；外部有值→null、null→有值；dirty 时轮询不覆盖；M1 修复后的两会话互不串值。

### M8. `/trace` 慢旧响应可覆盖新编号结果

- **证据**：异步渲染探针实测。
- **定位**：[client.js:2670-2694](../client.js#L2670)。
- **复现**：让 `/trace?number=42` 慢、`number=43` 快；依次点击两条追溯，43 先完成、42 后完成，最终搜索框仍为 43，时间线却显示 `#42`。
- **影响**：结果与当前编号/仓库不一致，用户会按错误条目诊断。
- **最小修复**：复用 `/state` 的 latest-request-wins 序号，或使用 AbortController；成功和失败 settle 时都校验序号，并绑定 number/repo。
- **必须验证**：慢旧成功、慢旧失败均不能盖新结果；新 loading/error/empty 正确；重复同编号只接受最新一次。

### M9. Orbit“立刻/暂停/恢复”没有 busy 防重入，连点会重复 POST

- **证据**：异步探针实测 pending 期间产生 2 个 POST。
- **定位**：[client.js:1665-1684](../client.js#L1665)、[client.js:1734-1737](../client.js#L1734)。
- **复现**：挂起 `POST /watch`，连续点击两次“暂停”或“立刻”；按钮没有 disabled/`aria-busy`，`act` 也没有 pending guard。Enter 连发同路径，DSH/fallback 共用。
- **影响**：重复轮询或写操作；配合 W3 的响应乱序可显示旧状态。
- **最小修复**：按 watcher/action 加同步 pending ref 与可渲染 busy，首次 `await` 前上锁，`finally` 解锁；pending 时该行相关动作 disabled 并标记 busy。
- **必须验证**：双击和 Enter 连发均只 1 POST；pending 可见/可读；成功刷新，失败解锁并保留错误；不同 watcher 不互相误锁；DSH/fallback 同验。

### M10. DSH Orbit 删除失败后，错误写进已关闭的 Orbit，仍打开的确认 Modal 没有任何错误

- **证据**：异步展开树实测；409 与断网同路径。
- **定位**：[client.js:1665-1683](../client.js#L1665)、[client.js:1790-1815](../client.js#L1790)、[client.js:1822-1831](../client.js#L1822)、[client.js:1298-1338](../client.js#L1298)。
- **复现**：完整 DSH primitives 路径，打开 Orbit→删除→确认删除；让 `/watch` 返回 `409 {error:'冲突'}`。`act` 仅 `setOrbitError`，但 DSH 删除前已关闭 Orbit；`ConfirmDialog` 没有 error 插槽且失败不关窗。可见文本不含“冲突”。
- **影响**：确认框恢复原样却没有任何失败原因，属于写操作静默失败，容易反复点击。
- **最小修复**：给 `ConfirmDialog` 增加块级 `error` + `role="alert"`，把当前删除失败传入；打开、重试、关闭时清理旧错误，保留 busy 锁和“成功才关窗”。
- **必须验证**：409/断网均在 Modal 内可见并可宣布；busy 复位；重试一次只发一个 POST；成功才关窗并回焦圆环；取消零请求；fallback 同步回归。

### M11. 服务恢复返回 304 后，旧读取错误永久不清

- **证据**：异步时序探针实测。
- **定位**：[client.js:2028-2029](../client.js#L2028)。
- **复现**：依次让 `/state` 返回 200（ETag `"v1"`）→500→304。第三次请求确实带 `if-none-match:"v1"`，但 `notModified && hasBody` 直接 return，没有更新 `snap`；最终仍为 `error:"temporary failure"`。数据不变时后续持续 304，手动刷新也不能清错。
- **影响**：服务已经恢复，面板却持续显示故障；与 M7 的成功保存回读路径叠加时，成功/失败反馈进一步互相矛盾。
- **最小修复**：有 body 的 304 用 functional `setSnap` 清 `error/loading`；已经 clean 时返回 prev，避免无谓渲染。无 body 的首帧 304 全量重取逻辑保持不变。
- **必须验证**：200→500→304 清错；clean+304 不多渲染；无 body+304 仍全量重取；stale 旧 body 不被清空；恢复后的 goal/草稿不错误回写。

---

## 3. 值得改

### W1. 空凭证表单会 `POST {}` 并提示“凭证已保存”

- **定位/复现**：[client.js:2227-2240](../client.js#L2227)、[client.js:2935](../client.js#L2935)。三项均空时点保存，payload 为 `{}`，仍 Toast 成功。
- **影响**：没有做任何修改却给出成功反馈，掩盖“尚未填写”的真实状态。
- **最小修复/验证**：无输入或无变化时禁用保存并显示未修改；空表单零 POST；单字段保存只传该字段，失败保留草稿。

### W2. “重新打开”被列为问题，却不被问题计数和筛选承认

- **证据/定位**：渲染桩实测；[client.js:2482-2485](../client.js#L2482)、[client.js:2515-2529](../client.js#L2515)、[client.js:2821-2825](../client.js#L2821)。
- **复现/影响**：仅 `lastReopened=42` 的 watcher 会产生“需要关注”，但 `hasProblem()` 不含该字段，“涉及 N 条守”少算；点“只看有问题的”反而把它过滤掉。
- **最小修复/验证**：让问题构造、计数、`hasProblem` 使用同一事实集合；仅 reopened、reopened+其它问题、健康三例的数量和筛选结果一致。

### W3. Orbit `/state` 没有序号或重叠保护，旧响应可覆盖动作后的新状态

- **定位**：[client.js:1574-1588](../client.js#L1574)、[client.js:1675-1678](../client.js#L1675)。
- **复现/影响**：让轮询 GET A 挂起，动作成功后的 GET B 先返回新状态，再释放 A；A 无条件 `setWatchers`，可让已暂停/删除行短暂复活。M9 的 busy 锁本身不能修这个读取竞态。
- **最小修复/验证**：加 latest-request-wins 序号并跳过重叠轮询；动作回读与定时回读共用序号。旧成功/旧失败都不能覆盖新状态，stale 错误不清空现有列表。

### W4. 删除确认在 busy 中仍可“取消”/Escape 关闭，但请求不会取消

- **定位**：[client.js:1301-1305](../client.js#L1301)、[client.js:1329-1342](../client.js#L1329)、[client.js:1745-1749](../client.js#L1745)、[client.js:2411-2414](../client.js#L2411)。
- **复现/影响**：延迟删除 POST，点“确认删除”后再点“取消”或 Escape；Modal 关闭，后台仍可能完成删除。按钮文案让用户误以为已取消操作。
- **最小修复/验证**：破坏性操作 busy 时禁止 cancel/Escape/背板 dismiss，或明确改为“关闭，操作继续”并持续反馈；验证三种 dismiss 路径、请求只发一次、成功/失败最终反馈与回焦。

### W5. “运行时事件（最近 20 条）”不是全局最近 20 条，也不按时间排序

- **定位**：[client.js:2798-2818](../client.js#L2798)；服务端实际预算见 [lib/index.js:1768-1770](../lib/index.js#L1768)、[lib/index.js:1889-1930](../lib/index.js#L1889)。
- **复现/影响**：4 条 watcher 各有服务端允许的 6 条 events 时，UI 渲染 24 条；`watchers.flatMap` 使某守旧事件可排在另一守新事件前。标题、总数与“最近”口径不一致。
- **最小修复/验证**：合并结构化事件后按 `at` 倒序并 `slice(0,20)`，或诚实改成“各守最近 6 条（按守分组）”。跨守交错、超 20、空事件都要核对标题、实际 li 数和顺序。
- **排除夸大**：服务端已把每守 `history` 截到 5 条，因此本报告**不**把判定页的 `slice(-6)` 冒称为当前可显示 6 条。

### W6. “最近被过滤”丢失 repo/session/时间，且只是各守拼接而非全局最近

- **定位**：[client.js:887-897](../client.js#L887)、[client.js:2602-2608](../client.js#L2602)。
- **复现/影响**：两个 watcher 都有 `#7` 时，展开只剩 `#7 title — reason`，无法定位仓库/会话/发生时间；`flatMap` 不读取 `entry.at` 排序。这是实际诊断信息缺失，不是 CollapsibleList 自制导致的原罪。
- **最小修复/验证**：传结构化 `{repo,sessionId,number,title,reason,at}`，按时间明确排序并渲染来源/time；同编号跨 repo/session、跨时序、多原因均保持摘要与展开一致。

### W7. 同 repo 多 session 的运行事件产生重复 React key

- **证据/定位**：渲染桩得到两个 `a/b-ev0`；[client.js:2806-2808](../client.js#L2806)。过滤明细的 key 也未含 session，见 [client.js:2721-2724](../client.js#L2721)。
- **复现/影响**：`a/b#s1` 与 `a/b#s2` 各有 `events[0]`，key 相同；真实 React 更新会出现 duplicate-key 警告并进入不保证的 reconciliation，可能错复用行。
- **最小修复/验证**：key 加 sessionId，并优先组合稳定的 `at/kind/number` 而非仅用下标；同 repo 两 session 增删/刷新无警告、无串行。

### W8. 非搜索筛选的空态写“没有匹配「」”，恢复指引还可能指向不存在的“全部”

- **证据/定位**：渲染桩实测；[client.js:2645-2650](../client.js#L2645)、[client.js:2824-2825](../client.js#L2824)、[client.js:2865-2875](../client.js#L2865)。
- **复现/影响**：只选“异常”或“只读”等筛选且无结果时，搜索词为空却显示“没有匹配「」”；按仓库空态说“点上面『全部』”，但“全部”Pill 只在 `problemsOnly=true` 时存在。
- **最小修复/验证**：按实际 active filter 生成空态与恢复动作，提供始终存在的清除当前筛选/全部清除；单筛选、多筛选、搜索+筛选、真正零守分别验收。

### W9. token 修复文案指向没有 token 字段的“来源”

- **证据/定位**：渲染桩确认文案存在；[client.js:2501-2503](../client.js#L2501)、[client.js:2897-2904](../client.js#L2897)，真实字段在 [client.js:2924-2935](../client.js#L2924)。
- **复现/影响**：gh 不可用且 token=none 时写“设置 → 来源填 token”，来源卡又写“下面填 token”，但该卡没有 token 输入，用户按指引找不到修复入口。
- **最小修复/验证**：统一为“设置 → 凭证”，最好给真实 `openSettings('creds')` 动作；gh 三态下文案与落点都正确。

### W10. goal 的可见标签未进入无障碍名称；无 session 时仍可制造必然无法保存的草稿

- **证据/定位**：当前哈希 Chromium Accessibility 树实测；[client.js:847-857](../client.js#L847)、[client.js:3007-3013](../client.js#L3007)。
- **复现/影响**：`labels.length=0`，无 `aria-label/aria-labelledby`；AX name 来自 placeholder“这个会话要达成什么（会写进 /goal）”，不含可见标题“会话 goal”，读屏/语音控制无法按可见标签定位（Label in Name）。输入后可见 placeholder 消失。无 `sessionId` 时 textarea 仍可编辑，只有保存按钮 disabled 且无原因说明。
- **证据边界**：本条不宣称“完全无 accessible name”；实测名称是 placeholder，缺陷是可见标签没有进入名称，以及不可用状态没有说明。
- **最小修复/验证**：复用 Field（id+label/htmlFor），或给 Section 标题 id 并关联 `aria-labelledby`；无 session 时禁用 textarea 并给可见 Hint。验证 AX name 含“会话 goal”、输入后名称稳定、键盘焦点、无 session 禁用原因和有 session 保存回归。

### W11. SaveBar 消失/编辑关闭后没有焦点归还

- **定位**：[client.js:1069-1076](../client.js#L1069)、[client.js:2152-2155](../client.js#L2152)、[client.js:2426-2430](../client.js#L2426)。
- **复现/影响**：键盘修改字段→Tab 到“放弃”→激活；SaveBar 因 clean 卸载，没有代码把焦点送到仍存活的字段/行标题。编辑保存成功也直接卸载整个表单，键盘用户丢失位置。
- **最小修复/验证**：记录对应字段或 opener，dirty→clean/编辑卸载后聚焦合理存活节点；分别检查新建放弃、编辑放弃、保存成功的 `activeElement`，失败仍留 SaveBar。

### W12. Disclosure 在 busy 时仍可聚焦但操作被静默吞掉；长按会反复开合

- **定位**：[client.js:929-951](../client.js#L929)、[client.js:1063-1065](../client.js#L1063)、[client.js:1210-1214](../client.js#L1210)。
- **复现/影响**：保存 pending 时 Tab 到“高级设置”，它仍是 `div[role=button][tabIndex=0]`，无 `aria-disabled`；fieldset 不会禁用这个 div，Enter/Space 被 guard 吞掉。`keydown repeat=true` 每次也调用 `onToggle`，长按会抖动。
- **最小修复/验证**：把 disabled 传到 `aria-disabled`/tabIndex/handler，忽略 `event.repeat`；busy 的 Tab/click/Enter/Space 均不切换且状态可感知，普通单键仍只切一次。

### W13. 所有 Section 标题都不是 heading，读屏无法按业务标题导航

- **证据/定位**：渲染桩总览只有 h1；[client.js:847-857](../client.js#L847)。
- **复现/影响**：各块均为 `section > div.dt-section-title > span.dt-section-name`，没有 h2；总览、判定、设置均无法使用标题跳转。这是语义导航缺失，不是视觉风格差异。
- **最小修复/验证**：标题改语义 h2（保留 class），必要时 id+`aria-labelledby` 命名 section；h1→h2 不跳级，日期分组和设置分区不制造新的层级错误，视觉不回归。

### W14. 多个持久异步错误只有视觉文本，没有 alert/live 语义

- **定位**：[client.js:1903-1906](../client.js#L1903)、[client.js:3264-3276](../client.js#L3264)、[client.js:2940-2947](../client.js#L2940)。SaveBar 的 [client.js:1072-1074](../client.js#L1072) 是已有正例。
- **复现/影响**：焦点留在“追溯/保存/刷新”上触发异步失败，错误节点插入但没有 `role="alert"` 或合适 live region；读屏用户可能完全不知道失败。
- **最小修复/验证**：给持久错误块加 `role="alert"` 或预置 live 容器，不要把整页和 Toast 重复设为抢读；首败/stale/追溯/更新失败各通知一次，轮询重渲染不重复，成功移除。

### W15. 无 DSH Tooltip 的回退不支持 Escape，且缺 trigger↔tooltip 关联

- **定位**：[client.js:954-964](../client.js#L954)。
- **复现/影响**：缺整个 primitives 或仅缺 Tooltip，聚焦 InfoTip，Enter/Space 打开后按 Escape，气泡仍开；trigger 无 `aria-describedby`，tooltip 无 id。键盘不能按约定 dismiss。现有 `aria-label` 已含全文，所以不夸大为“内容完全丢失”。
- **最小修复/验证**：稳定 tooltip id，打开时关联 `aria-describedby`，Escape preventDefault 后关闭并保留 trigger 焦点，保留 blur 关闭；两种回退覆盖 click/Enter/Space/Escape/blur，官方路径不回归。

### W16. fallback 中一次 Escape 同时关闭确认 Modal 和底层 Orbit

- **证据/定位**：事件探针实测同次 Escape 产生两个 close；[client.js:1594-1618](../client.js#L1594)、[client.js:1264-1268](../client.js#L1264)。
- **复现/影响**：禁用 primitives→打开 Orbit→删除→确认框→Escape。Orbit 在 document capture 先关，随后本地 Modal 也关；一次 Escape 关闭两层，并让两个焦点恢复清理竞争。
- **最小修复/验证**：确认 Modal 存在或事件属于 Modal 时，fallback Orbit 的 capture 不得处理 Escape；第一次只关 Modal、焦点回删除按钮，第二次才关 Orbit 并回焦圆环；取消/背板不穿透且零请求。

### W17. fallback Toast 没有用 `item.id` 作为 key，连续通知不会重启动画

- **定位**：[client.js:1881-1897](../client.js#L1881)，CSS 动画定义在同一文件 [client.js:592](../client.js#L592) 的 `PORTED_CSS`。
- **复现/影响**：第一条显示约 3.5 秒时再 `notify` 第二条；React 复用同一个 div，`item.id` 只用于回调而未做 key，`dt-toast-in/dt-toast-fade` 不会重新挂载。第二条可能很快沿用第一条的淡出，错误反馈难以看见。
- **最小修复/验证**：给 fallback Toast `key:item.id`，并统一 timer 与 CSS hold/fade 时长；连续 success→error、error→success 均重新出现、完整停留，旧回调仍不能清新通知。

### W18. “清除/全部”动作被标成 `aria-pressed=false` 的切换按钮

- **证据/定位**：渲染桩实测；[client.js:899-915](../client.js#L899)、[client.js:2578-2585](../client.js#L2578)、[client.js:2637-2641](../client.js#L2637)。
- **复现/影响**：`Pill` 对所有 `onClick` 一律补 `aria-pressed=!!active`，所以“只读 ✕”“异常 ✕”“全部清除”“全部”也被读成“未按下的切换按钮”。这些是一次性清除动作，不是可切换状态。
- **最小修复/验证**：只对真正过滤开关传 `aria-pressed`，动作 Pill 不传；筛选 active=true/false 的读屏状态保持，清除动作不再被宣布为 toggle。

---

## 4. 暂不改、排除与无证据项

| 项目 | 只读结论 |
|---|---|
| `SegmentedControl`（[client.js:918-926](../client.js#L918)） | **当前没有调用点**，grep 只有定义。其本地 radiogroup 若未来启用，确实需要 roving tabindex/方向键；但现役用户不可达，不列为当前缺陷。不要仅为“存在自制代码”改生产。 |
| `select` | 当前没有原生 `<select>` 调用，只有 CSS/FOCUSABLE 选择器；没有 select 缺陷可报。`HoursField` 是两个带 aria-label 的 `input[type=time]`。 |
| `Field` / `Hint`（[client.js:971](../client.js#L971)、[client.js:1044-1061](../client.js#L1044)） | 当前调用均为单子控件，label 与 InfoTip 是兄弟，id/htmlFor 唯一；Hint 是静态说明，普通 p 合理。未发现可复现本体缺陷。 |
| 设置 nav（[client.js:3019-3038](../client.js#L3019)） | 是 nav 内原生 button，不是 tablist；Enter/Space 由浏览器提供，`aria-current=page` 与当前内容一致，不要求另造方向键模型。 |
| 本地 `DisclosureRow` / `CollapsibleList` | 不因未委托官方而判错。仅列上述 busy/repeat 与过滤信息丢失的真实问题；普通 Enter/Space、aria-expanded/controls 和焦点保留已有验收。 |
| Switch | 首次完整 Chromium 脚本的优先级不稳定 FAIL 未作为缺陷。隔离复验真实 button 的 click/Space、checked、焦点、pointer hit 均通过，22/22 PASS；官方实现也确认传布尔值。 |
| DSH Modal / Toast / Tooltip / Orbit 适配 | 定向 54/54 PASS；portal、initial focus、Escape、外点、confirm 回焦、Toast id guard、Tooltip scroll-close 均有代码与测试证据。非模态 Orbit 不设 `aria-modal` 是正确边界。 |
| 判定日志 `slice(-6)` | 服务端 `/state` 已把每守 history 截到 5 条，当前不能凭构造的 6 条假 state 冒称真机显示 6 条；不列现役数量缺陷。 |
| 窄屏、触摸、IME | 当前哈希 loopback 已走查 320/360/640/768/1024px 的总览、判定、触发高级区和设置五区，未发现稳定可复现的横向溢出/遮挡；一次 goal 按钮裁切候选经单页及原顺序重放撤销，不列缺陷。真实 WebView 全尺寸、触摸和 IME 仍未验，不写“通过”。 |
| fallback Orbit 打开后 resize | 静态上坐标只在 toggle 时计算，但宿主 resize 是否立即引发重渲染、实际越界持续多久，本轮没有可靠真机量测；不作为确定缺陷列入。 |
| 视觉风格/素材差异 | OrbitMark、StateDot、本地 watcher 内容等 derived 不因为“非官方同物”判错；本报告没有颜色、间距、圆角或文案风格建议。 |

---

## 5. 为什么 622/622 仍不能证明这些路径正确

1. **原生表单校验未被真实 click 覆盖**：[ui-l84-form-acceptance.test.mjs:391-395](../test/ui-l84-form-acceptance.test.mjs#L391) 直接 `save.props.onClick()`，没有 click event、form 默认提交或 `reportValidity`。
2. **跨 render ref/touched 与异步时序未覆盖**：同一文件 [372-374 行](../test/ui-l84-form-acceptance.test.mjs#L372) 明确承认 harness 的 useRef 跨 render 会重建；没有 pending 中继续输入、goal null、trace 慢旧响应等用例。
3. **数字门禁没有验证真实渲染口径**：[panel-numbers.test.mjs:28-38](../test/panel-numbers.test.mjs#L28) 把“最近 5 次唤醒”绑定到 `filteredLog`，把“运行时最近 20 条”绑定到 `pushHistory`，并非运行时 events 的实际 flatten/sort/limit。绿灯不能证明 W5。
4. **首载三态没有互斥断言**：现有 304 测试只证明会重取全量；没有断言无 body 时 Onboarding/零统计应消失。
5. **dirty 收起与焦点未覆盖**：现有用例验“主动点放弃恢复快照”，不验 dirty 点标题收起/换行，也没有真实 DOM `activeElement` 的 SaveBar 卸载路径。
6. **mock props 通过不等于官方组件真实行为通过**：需要保留 Chromium/真实 WebView 验收；当前完整脚本只有 43/47 且含 harness 不稳定项，隔离复验不能包装成“UI 全过”。

## 6. 建议修复与复验顺序（仅为后续计划，未执行）

1. **先修数据与写操作正确性**：M1、M4、M5、M6、M7、M8、M9、M10。
2. **再修首载与状态真值**：M2、M3、M11、W1、W2、W3、W5。
3. **再修键盘、焦点、ARIA 与回退**：W10–W18、W4。
4. **最后补信息定位与测试门禁**：W6–W9，并把真实 click、deferred race、跨 render 草稿、activeElement、同 repo 多 session、首载四态纳入回归。

每一项合入前都必须执行对应“必须验证”，不能用“622/622”或静态结构断言替代真实交互证据。
