# 完整面板 Chromium 验收报告

## 结论

**PASS 23 / FAIL 0 / TOTAL 23；验收命令真实 exit code = 0。**

已在真实 Chromium `156.0.8078.74` 中加载仓库真实 `client.js` UMD，捕获 `session-superagent-desk` 的 slot Component，并用安装版 `ReactDOM.createRoot` 挂载。真实点击走完：

- 主页面：`overview / judge(records) / trigger / settings`；
- 设置分区：`source / creds / update / diagnose / goal`；
- 第二阶段：搜索、总览行内编辑与放弃、触发新增表单、凭证字段、goal textarea 均可编辑；未提交任何写操作。

交付脚本：[scripts/verify-panel-chromium.mjs](../scripts/verify-panel-chromium.mjs)。

> “records”按当前产品真实结构验收为「判定」页中的判定记录、追溯记录与运行时事件；没有增加或改动产品页签。

## 1. 可复现命令与真实退出

```bash
node --check scripts/verify-panel-chromium.mjs
ego-browser nodejs < scripts/verify-panel-chromium.mjs
```

验收运行结果：

```text
PASS 23
FAIL 0
ACTUAL_EXIT=0
```

交付前再次执行 `node --check`，结果 `SYNTAX_EXIT=0`。交付脚本 SHA-256 与上述成功运行输出的脚本哈希完全一致，不是事后未复跑的改写版本。

## 2. 挂载与隔离方式

1. 复制既有 `verify-ui-primitives.mjs` 的安装 bundle 捕获/local server 路线：从安装版 frontend `dist/index.html` 读取真实 assets，以 `window.__ModuleLoader__.create` 捕获 `staticModules`，故意停止 DSH 应用启动。
2. 使用捕获的安装版 `react@18.3.1`、`react-dom/client`、`react-dom`、290 个 exports 的 `@deepseek-ai/dsh-client-ui-primitives`；捕获模块表也真实包含 `@deepseek-ai/cordis` 与 `zod`。
3. 通过 `window.__ModuleLoader__.load` 捕获真实 `client.js` 的 `factory(require)`，执行 `plugin.apply(ctx)`；`ctx.effect` 与 `ctx.slots.inject` 真实调用，`slots.register` 捕获：
   - `conversation.view / session-superagent-desk / order=30 / label=主理鱼`；
   - `conversation.composer.dock / session-superagent-orbit / order=-10`（只捕获注册，本阶段不渲染）。
4. 对捕获的 desk `Component` 执行 `ReactDOM.createRoot(...).render(...)`，传入固定 fixture `sessionId`。
5. `/session-superagent/state`、`/update`、`/trace`、`/diagnose` 全部由独立 `127.0.0.1` server 返回固定数据；`/r2`～`/r8` 只用于客户端既有 discoverBase 探测并返回 404。
6. 浏览器 `fetch` 对非同源请求直接拒绝并记录；所有 mutation 路由固定返回 `403 fixture-read-only`。本轮 API 日志只有 GET，未访问 GitHub/Gitee/npm，未执行更新、删除、暂停、恢复、保存或真实轮询。

## 3. 验收矩阵

| 区域 | 真实操作与严格断言 | 结果 |
|---|---|---|
| Chromium / 安装版模块 | Chromium 版本、React 18.3.1、同一 primitives 对象、UMD id | PASS |
| slot 挂载 | desk id/name/order/label/Component 类型严格相等 | PASS |
| overview | 四个页签、两条 watcher、五个统计项、真实仓库 DOM | PASS |
| overview 搜索 | 输入 `acme/widgets` 后严格只剩该仓库，清空恢复 | PASS |
| overview 行内编辑 | 间隔改为 90，出现“未保存”；放弃恢复 60；无提交 | PASS |
| judge / records | 两条判定记录 `#42/#41`、运行时事件、fake trace 的 seen/filter/reported/wake 全事件 | PASS |
| trigger | 新建 form、必填仓库、数字间隔；repo/goal 输入可编辑，未添加 | PASS |
| settings nav | 恰好五个既定分区，真实点击切换 `aria-current` 与右侧标题 | PASS |
| source | 仓库、gh、凭证、scope、隔离事实表及 fixture 值 | PASS |
| creds | 两个 password input、ghDir input 均可编辑，未保存 | PASS |
| update | 当前/最新均 `0.9.273`，状态严格等于“已是最新”；无安装按钮 | PASS |
| diagnose | 三个信号及 `+100/+10/+3` 权重严格相等 | PASS |
| goal | 固定 goal 回读、textarea 可编辑、保存按钮可用；未保存 | PASS |
| 网络与页面错误 | 未预期 JS error=0、外部请求=0、mutation=0 | PASS |
| 截图 | 四个主页面相关图 + 五个设置分区图，共八张 | PASS |

## 4. 基线与哈希

| 项 | 值 |
|---|---|
| Git HEAD | `b8bb72e34f936434345de73d60d68d17d6b11e7f` |
| 插件版本 | `0.9.273` |
| 交付脚本 SHA-256 | `f5ebd42a86d3cf036a2fe04343c568865b5e97f678304eb2e515aa746d9ed37a` |
| `client.js` SHA-256 | `8f2abf3cd279b62cbda556545e69231a3b08668e3c63c39dc687f2e60066246e` |
| DSH frontend | `0.2.1-rc.5` |
| 安装 asar SHA-256 | `e1b6f25fa937da98086c3e77af77aa14791105963c4d337a1c42179d232c6915` |
| React / primitives | `18.3.1` / 290 exports |
| Chromium | `156.0.8078.74` |

## 5. 截图与 SHA-256

| 页面 | 文件 | 字节 | SHA-256 |
|---|---|---:|---|
| overview | [panel-chromium-overview.png](assets/panel-chromium-overview.png) | 74785 | `3f49b5d4575f09af1c4a87ba51b4b4cf7309459de83d1efeb2014c1ea23ab875` |
| judge / records / trace | [panel-chromium-judge.png](assets/panel-chromium-judge.png) | 64030 | `23746873ff92c2317a5d5c9862d8217d607fe9da17b133e753a3ec5717e1f258` |
| trigger | [panel-chromium-trigger.png](assets/panel-chromium-trigger.png) | 54509 | `6069f169465bc374db322499e76d13cf27c99610fbab5cc892324515f077533e` |
| settings/source | [panel-chromium-settings-source.png](assets/panel-chromium-settings-source.png) | 35154 | `b58e390c0f6e7655b8fc5c87346d84724100ce605807a91bb7bb141b36b4ee6b` |
| settings/creds | [panel-chromium-settings-creds.png](assets/panel-chromium-settings-creds.png) | 45864 | `f13e7493a1f5990ec37284da1e4e40ebd1690bd3f871be1ff89adfa020bbfbca` |
| settings/update | [panel-chromium-settings-update.png](assets/panel-chromium-settings-update.png) | 42487 | `8676402728909ac55da114ea624fe0e2957c8aeb78e52aad094326a379d41f23` |
| settings/diagnose | [panel-chromium-settings-diagnose.png](assets/panel-chromium-settings-diagnose.png) | 41293 | `5c1d73ef9ed1d5e3cfb02c5dbe6f4ee240aed78a6ce63fc56994bac945b51e35` |
| settings/goal | [panel-chromium-settings-goal.png](assets/panel-chromium-settings-goal.png) | 29743 | `a66b025b8eb4855f458b5f7902542873c59142118640193681eaa7f5ddf49687` |

八图均为 1440×1000 PNG，并已逐张读取做视觉复核。overview 后续被诊断探针覆盖后，已从成功运行的只读附件原件恢复；恢复后 SHA-256 与成功运行记录逐字节一致，其余七图未被后续失败运行改写。

## 6. harness 修复记录（未改 client）

- 最小闭环先行：desk 挂载、overview DOM 与截图成功后，才扩展其它页面。
- 扩展首轮为 `13 PASS / 2 FAIL`：一处是 harness 漏算真实 trace 的 `首次看到/上次上报` 事件；另一处是把无显式 `type` 的 ghDir 原生 input 错写成 `input[type=text]` 选择器。两处都只修 harness 断言/选择器。
- 修正后同一交付脚本得到 `23 PASS / 0 FAIL / exit 0`。
- 后续额外诊断时，Ego/Chromium 的 `Page.captureScreenshot` 出现浏览器级 15 秒超时；同一 TaskSpace 新 tab 的最小静态页面截图也超时。该故障发生在已成功的验收之后，相关实验代码未纳入交付，交付脚本已按上述哈希回退到成功运行版本。当前环境再次复跑若卡在截图，应先恢复 Ego/Chromium 截图通道；不要把该环境故障改写成产品 FAIL。

## 7. 未验与动线之外观察

- 未进入需要真实会话和凭证的 DSH Web GUI；本报告证明的是独立 loopback 页面中真实 UMD、真实 slot 注册和 desk Component 的完整挂载与导航，不冒充真实宿主端到端。
- Orbit / Modal 按本阶段要求未强求；Orbit 只验注册，不渲染、不点击。
- 未执行任何真实写操作、安装更新、删除或 GitHub/Gitee/npm 请求；未验保存后的真实状态变化。
- 未验物理读屏、触摸、IME、双主题、窄屏、reduced-motion 与真实 watcher 轮询。
- 部分 primary 按钮在截图视觉描述中疑似白底浅字；后续 computed-style 观察尚未跑到对应页面即被截图通道故障中断，因此**不据此宣称对比度通过，也不把它混作本次挂载 FAIL**。本轮未改产品代码，建议后续单独核对按钮 `color/backgroundColor`。

本任务没有修改生产代码、版本文件或派单表，没有 commit / push。

## 8. 主线集成复跑

主线复跑遇到同样的 `Page.captureScreenshot` CDP 超时。已将截图采集改为 SKIP 并继续功能检查，最终脚本 exit 0；全部真实 DOM、导航、搜索、编辑、fake API 命中与禁止外部/mutation 请求均通过。截图未齐不再被误记为产品 FAIL，已有八张成功基线图保留。
