# 深层 UI 真实 Chromium 验收报告

> 日期：2026-11-06。工作树：`D:\主工作区\projects\dsh-session-superagent-deep-ui`。

## 结论

**最终完整运行：PASS 47 / FAIL 0 / TOTAL 47，真实 Chromium exit code = 0。**

- 既有 **35 项**检查全部保留；本轮新增 **12 项** WatcherForm 高级区、5 面优先级 Switch、Tab 顺序与 InfoTip/Tooltip 检查。
- 高级区真实 Enter 展开、Space 收起；展开时 `aria-expanded=true`，`aria-controls=watcher-new-advanced-body`，且严格指向同 id 的展开 body。
- 5 面 Switch 的 `role=switch`、`aria-checked`、默认值、受控 `onChange`、未保存草稿、鼠标/Space 操作、连续 Tab 与焦点连接状态全部通过。
- 真实 InfoTip 完成 hover 打开、click pin、Escape 关闭；另完成 focus 打开、click pin、真实 wheel/scroll 关闭并回焦。
- 放弃后 5 面 Switch 与 repo/goal/onlyAssigned 均恢复，SaveBar 卸载，高级区重新收起；没有提交 watcher。
- 功能走查结束时 mutation=0、外部请求=0、未预期页面错误=0；随后唯一 loopback 防写探针真实返回 403。
- 截图通道按既定故障策略跳过 **12 张**，不计产品 FAIL；没有生成或覆盖 PNG。

交付脚本：[scripts/verify-panel-chromium.mjs](../scripts/verify-panel-chromium.mjs)。

## 1. 最终命令、退出与基线

```bash
node --check scripts/verify-panel-chromium.mjs
timeout 240 ego-browser nodejs < scripts/verify-panel-chromium.mjs
```

最终 shell 实录：

```text
PASS 47
FAIL 0
TOTAL 47
ACTUAL_EXIT=0
SYNTAX_EXIT=0
SCREENSHOT_SKIP=12
MUTATION_BEFORE_GUARD=0
GUARD_POST_STATUS=403
```

`ACTUAL_EXIT` 是命令结束后读取并再次退出的真实状态，不是从页面文字推测。最终脚本走完 desk、Orbit、Modal、fake API、防写探针与全部新增步骤；截图 SKIP 没有计入 47 个 PASS。

| 项 | 最终值 |
|---|---|
| Git HEAD | `90b2cbfda32b5817c886ca1bca376e3f81e16f01` |
| 插件版本 | `0.9.279` |
| Chromium | `156.0.8078.74` |
| React / primitives 导出数 | `18.3.1` / `290` |
| DSH frontend / primitives range | `0.2.1-rc.5` / `0.2.1-rc.5` |
| 最终脚本 SHA-256 | `394cd36f9371574bc03dd95a04f9c2d8c830ea46e525b105849c0bbdd2e9ad28` |
| 最终 `client.js` SHA-256 | `927c1987a5c5bb44cfeaf2cc622fee7660b73e2c362fb3e13530e3019de59bf4` |
| 安装 asar SHA-256 | `e1b6f25fa937da98086c3e77af77aa14791105963c4d337a1c42179d232c6915` |
| 最终 loopback origin | `http://127.0.0.1:56800` |

最终运行后复算脚本哈希与上表一致；成功运行后未再改脚本。

## 2. 新增高级区与 Switch 验收

### 2.1 展开、收起与 aria 关联

| 检查 | 真实操作与严格结果 |
|---|---|
| 默认状态 | `aria-expanded=false`，高级 body 未挂载，高级 Switch 数=0；PASS |
| Enter 展开 | 聚焦 `#watcher-new .dt-disclosure-row` 后按 Enter，body 可见且恰好 5 面 Switch；焦点仍在触发行且节点已连接；PASS |
| aria 关联 | `aria-expanded=true`；`aria-controls` 与 body `id` 均为 `watcher-new-advanced-body`，`getElementById` 严格命中该 body；PASS |
| Space 收起 | 放弃恢复后按 Space，body 卸载、`aria-expanded=false`，焦点仍在已连接触发行；PASS |

最终生产对照为 [client.js:895](../client.js#L895) 的 `bodyId/aria-controls` 和 [client.js:1176](../client.js#L1176) 的 `watcher-new-advanced-body` 传入。

### 2.2 五面 Switch 的真实受控变化

| id 后缀 | 名称 | 默认值 | 本轮操作 | 操作后 | 草稿/焦点 |
|---|---|---:|---|---:|---|
| `priorityReopened` | 重开优先 | true | 真实 click | false | 未保存；焦点在该 Switch |
| `priorityComments` | 评论优先 | true | 真实 Space | false | 未保存；焦点在该 Switch |
| `priorityLabels` | 标签优先 | true | 真实 Space | false | 未保存；焦点在该 Switch |
| `priorityUnassigned` | 未认领优先 | false | 真实 click | true | 未保存；焦点在该 Switch |
| `priorityStale` | 积压优先 | false | 真实 Space | true | 未保存；焦点在该 Switch |

每一步都同时核对五个 `aria-checked`，不是只确认被点的一面；同时确认其余面未被连带修改、SaveBar 含“未保存”、`document.activeElement` 是对应 Switch 且节点仍连接。

连续 Tab 从优先级 InfoTip 出发，实际顺序严格为：

```text
重开优先 → 评论优先 → 标签优先 → 未认领优先 → 积压优先
```

随后真实 Escape 复位可能延迟出现的 Tooltip，再进行 Switch 鼠标操作，避免浮层遮挡造成假失败。

### 2.3 恢复现场且不提交

点击 `#watcher-new .dt-savebar button:text-is("放弃")` 后：

- 五面优先级恢复 `true / true / true / false / false`；
- 新建 repo 与 goal 恢复空值；
- onlyAssigned 恢复 `aria-checked=false`；
- SaveBar 卸载；
- 高级区再用 Space 收起，焦点不丢。

整个功能走查没有点击“添加到当前会话”或任何真实保存动作。最终防写探针之前，`apiLog.filter(method !== 'GET')` 为空。

## 3. InfoTip / Tooltip 真实验收

目标页面为「触发 → 高级设置 → 优先级」，目标真实可见，没有选择器缺失降级：

```text
#watcher-new button.dt-info[aria-label="全部关掉时按 GitHub 的「最近更新」顺序处理"]
```

| 动线 | 严格证据 | 结果 |
|---|---|---|
| hover 打开 | 真实 hover 后气泡可见，`role=tooltip`、精确原文、portal 到 BODY、`aria-expanded=true`，且 `aria-describedby` 严格等于气泡 id | PASS |
| Escape 关闭 | click pin 后移出指针，150ms 后仍 `data-pinned=true` 且可见；再按 Escape，气泡消失、describedby 清除、expanded=false，焦点保留 trigger | PASS |
| focus 打开 | 先聚焦高级区触发行，再真实 focus InfoTip；气泡角色、精确文本、BODY portal、describedby→bubble id 与焦点全部正确 | PASS |
| wheel/scroll 关闭 | focus 打开后 click pin；滚动前再次确认可见+pinned；真实 wheel 使 `.dt-page.scrollTop` 从 **405** 变为 **165**，随后气泡消失、expanded=false，焦点回到新 trigger | PASS |

本轮没有对“没有可见 InfoTip 的页面”伪造通过结论。脚本保留显式前置分支：若上述目标未来未命中可见元素，会记录页面、选择器和“未命中可见 InfoTip”的未验原因，并将前置检查记 FAIL，而不是编造 hover/focus 结果。

## 4. 既有完整面板回归

最终运行继续覆盖并通过：

- 安装版 React/primitives 与真实 `client.js` UMD；desk/orbit slot 注册和真实 Component 挂载；
- 总览四页签、两条 watcher、统计、搜索严格筛选、行内编辑与放弃恢复；
- 判定日志、运行时事件与 fake trace 的 seen/filter/reported/wake 全事件；
- 新增表单必填/数字字段、基础官方 Switch、设置五分区、凭证/更新/分诊/goal 草稿；
- Orbit 打开、trigger 关闭、Escape 回焦、删除确认 Modal、Tab 焦点圈、取消后回焦；
- fake state/update/trace 真实命中 loopback；未预期 JS error=0、外部请求=0；
- 功能走查 mutation=0，随后唯一显式 fixture `POST /session-superagent/watch` 返回 403。

## 5. 有效性与防假阳性处理

最终计数只取上述最后一次完整运行，不把开发 harness 的中断尝试混入：

1. 修正 stdin 运行时的仓库回退路径，确保读取本 worktree 的 0.9.279，而不是主工作区旧版。
2. Switch 选择器同时覆盖 id 直接位于 `[role=switch]` 与 id 位于官方 wrapper 的两种真实 DOM。
3. Tooltip 目标先进入视口；hover/Escape 必须证明 Escape 前仍 pinned+visible，scroll 必须证明 wheel 前仍 pinned+visible 且 scrollTop 真变化。
4. focus/hover 均校验精确气泡身份和 describedby 关联；Tab 后先关闭可能延迟复现的 Tooltip，避免遮挡后续点击。
5. 独立只读审查子代理 `b9f76537-bf0b-44b8-8b5f-9cc774ecc181` 检查了旧检查保留、Switch/Tab/恢复、防写与 Tooltip 假阳性风险；其 pinned、focus 身份、describedby 与“放弃”选择器建议均已落实。`node --check` 与 `git diff --check` 通过。

## 6. 并行生产变更边界

本任务自身只写验收脚本和本报告，没有修改 `client.js`、`lib/`、`package/`、版本、preflight 或派单表，没有 commit / push。

验收期间父任务并行修复并提交了高级区 aria 关联：

- `6dd9aa99e29f8ac3f6931a979bc598c3f9f4809a fix: 补齐高级区 aria-controls 与 body id`
- `90b2cbfda32b5817c886ca1bca376e3f81e16f01 fix: 合并高级区 aria 关联用于复验`

早期快照曾真实测得 `controls=null / bodyId=null`；最终 47/47 明确基于上述 HEAD `90b2cbf` 和最终 `client.js` 哈希，不把早期 FAIL 隐去，也不把并行生产修复记为本任务改动。

## 7. 截图 SKIP 与未验项

- `CAPTURE_SCREENSHOTS=false` 沿用已证实的 Ego/CDP 截图通道故障降级；overview、judge、trigger、trigger-tooltip、trigger-advanced、五个设置分区、Orbit 与 Modal 共 **12 张**均明确 SKIP。
- 没有新增 `docs/assets/deep-ui-*.png`，没有覆盖既有 desk/panel-chromium 基线，不对本轮视觉像素作通过声明。
- 未进入需要真实会话与凭证的 DSH Web GUI；本报告证明独立 loopback 页面中的真实 UMD、真实安装版 primitives、真实 Chromium DOM/键鼠/焦点，不冒充真实宿主端到端。
- 未执行真实保存、安装更新、删除、暂停、恢复或 watcher 轮询；唯一 POST 是 loopback 防写探针。
- 未验物理读屏、触摸、IME、真实 GitHub/Gitee 响应与真实 watcher 状态变化。
- Ego Lite 0.6.2.7 运行期间提示有更新；本任务未升级工具。
