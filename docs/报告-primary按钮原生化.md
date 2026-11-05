# primary 按钮原生化报告

## 结论

`Btn` 的 `primary` 分支已统一委托安装版 DSH `Button`；非 primary 保持旧 `Btn`，宿主没有 `Button` 或整个 primitives 不可用时完整回退旧 DOM。最终真实 Chromium 复验中，深色新增、保存凭证、安装更新、保存 goal 四个启用态 primary 均为 **18.0823:1**，浅色对应按钮均为 **18.8965:1**，不再出现任务给定的深色旧按钮 **1.045:1**。

本次只在 `task/native-primary-buttons` 独立 worktree 修改 `client.js`、`test/update-ui.test.mjs` 和本报告；未改 `lib/`、package、版本、派单表，未 commit、未 push。

## 1. 根因与修复边界

任务给定的真实 Chromium 基线：深色旧 `Btn primary` 的文字/背景对比度为 **1.045:1**，官方 DSH `Button primary` 为 **18.0823:1**；普通 `Btn` 与 light 对照正常。旧实测值是本次输入基线，本分支没有重新渲染旧实现复量。

修复位于 `client.js` 的 `Btn`：

- `variant === 'primary' && hostButton` 时直接创建宿主 `Button`，不再创建本地 `button.dt-btn-primary`。
- 宿主路径只透传业务 `className`，例如 `dt-btn-busy`、`dt-danger`；不回填 `dt-btn` / `dt-btn-primary`，避免旧 CSS 再覆盖宿主主题。
- `type` 默认 `button`，显式 `type: 'submit'` 通过后续 props 展开保留；`onClick`、`disabled`、`icon`、`size`、aria 与 `ref` 均透传。`key` 仍由 React 管理，不写进 `props.key`。
- 其它 variant 沿用原有 `dt-btn` DOM、尺寸类、图标包裹和业务类合并，不扩大原生化范围。
- 旧宿主缺 `Button`，或 `@deepseek-ai/dsh-client-ui-primitives` 整体不可用时，走同一旧 `Btn` 回退；原有安装更新 `UpdateButton` 调用面保持不变。

## 2. primary 覆盖计数

源码共有 **10 处** `variant: 'primary'` 声明，按运行路径分为：

| 路径 | 数量 | 场景 |
|---|---:|---|
| 直接 `h(Btn, …)` | 8 | 总览空态 Onboarding、SaveBar 保存、空白新增表单、判定空态、保存凭证、保存 goal、读取失败重试、复制 AGENTS 规则 |
| 共享 `ConfirmDialog` 默认 `ButtonComponent = Btn` | 1 | 普通删除等危险确认；保留 `dt-danger`、busy、disabled、aria |
| 安装更新 `ConfirmButton` 的 `ButtonComponent = UpdateButton` | 1 | 保持已有官方 Button 委托 |

Node 集成测试真实渲染了上述 **8 个直接场景**，另验共享危险确认和安装更新，合计对应 **10 个 primary 声明路径**。SaveBar 的新增与编辑共用同一组件，未把它重复计成两个源码声明。

## 3. 自动化验证

| 命令 | 真实结果 |
|---|---|
| `timeout 180 node --test test/host-primitives-adapter.test.mjs test/client.test.mjs test/update-ui.test.mjs` | **120/120**，0 失败 |
| `timeout 120 node --test test/update-ui.test.mjs` | **14/14**，0 失败 |
| `timeout 600 npm test` | **600/600**，0 失败 |
| `timeout 60 node scripts/ui-audit.mjs --json` | **11/11，100 分**；写死颜色 0、自造 token 0 |
| `git diff --check` | 通过，无 whitespace error |

新增的 4 条定向用例覆盖：

1. primary 委托宿主、默认/显式 type、ref/key、icon/size/onClick/disabled/aria、业务 class，以及 ghost 不迁移；
2. 缺 `Button` 与缺整个 primitives 两种旧宿主回退，校验旧 class、图标 DOM 与同一组 props；
3. 8 个直接 primary 页面场景全部委托，SaveBar 的 ghost 仍走旧 `Btn`；
4. 共享删除确认的 `dt-danger`、`dt-btn-busy`、disabled、`aria-label`、`aria-busy` 透传，取消按钮保持旧 ghost。

`test/host-primitives-adapter.test.mjs` 与 `test/client.test.mjs` 无需修改：现有独立宿主适配器不是 `Btn` 的所属模块，新增用例放在已经能加载真实 UMD 并注入宿主 Button 的 `test/update-ui.test.mjs`。

## 4. 真实 Chromium 复验

### 4.1 环境与脚本边界

- Chromium：**156.0.8078.74**；安装版 DSH frontend：**0.2.1-rc.5**；React：**18.3.1**；真实 primitives 导出：**290**。
- 当前 `client.js` SHA-256：`6cfb40196696b884d9f385ea798f9e10fba2588e52ca597be987f15fbae6b4ce`。
- asar SHA-256：`e1b6f25fa937da98086c3e77af77aa14791105963c4d337a1c42179d232c6915`。
- 复用相邻 worktree 的 `scripts/verify-panel-button-contrast.mjs`，原脚本 SHA-256：`ad2464094e7ffb22c098be794a95927dbb88fc3699919aaa2a9986a12048da77`；**没有复制进本分支**。
- 脚本仅在内存中改当前仓库路径、原生化后的按钮定位器及 ego 启动顺序；对比度算法、fake API、检查规则未改。新增/凭证/goal 不再依赖已移除的 `.dt-btn-primary`，改按真实 `button` 的文案、aria 或 `type=submit` 定位。
- 为遵守可写文件范围，截图调用在内存脚本中禁用；最终 TaskSpace **89** 及遗留的自有空间 **87** 均已关闭。

### 4.2 启用态 primary 实测

| 主题 | 场景 | 文字色 / 背景色 | 对比度 | 结果 |
|---|---|---|---:|---|
| dark | 新增表单 | `rgb(15, 17, 21)` / `rgb(249, 250, 251)` | **18.0823:1** | PASS |
| dark | 保存凭证 | 同上 | **18.0823:1** | PASS |
| dark | 安装更新 | 同上 | **18.0823:1** | PASS |
| dark | 保存 goal | 同上 | **18.0823:1** | PASS |
| light | 新增表单 | `rgb(255, 255, 255)` / `rgb(15, 17, 21)` | **18.8965:1** | PASS |
| light | 保存凭证 | 同上 | **18.8965:1** | PASS |
| light | 安装更新 | 同上 | **18.8965:1** | PASS |
| light | 保存 goal | 同上 | **18.8965:1** | PASS |

实测 DOM class 为安装版 `_button_1rv3m_2 _primary_1rv3m_36 _sm/_md_1rv3m_*`，命中的官方规则使用：

- `background: var(--dsw-alias-button-primary-fill)`；
- `color: var(--dsw-alias-label-primary-foreground)`。

汇总计数：

- 检查：**23/23 PASS，0 FAIL**；
- 非禁用测量：**16/16 PASS**（8 个 primary + 8 个普通 `Btn` 对照），0 失败；
- 禁用态观察：**2 个 EXEMPT_DISABLED**，dark **3.7918:1**、light **2.6194:1**，不计入启用态 PASS/FAIL；
- 截图：**0 张，8 次显式跳过**；
- fake API：总请求 **46**，其中 state **7**、update **3**，**mutation 0**；
- 未预期页面错误 **0**，外部请求 **0**，脚本退出码 **0**。

## 5. 真实 Chromium 未验项

以下项目没有写成“已验证”：

1. 本次是独立 loopback 页面里的真实 Chromium、安装版 React/primitives/tokens 与真实 `client.js` desk；**未进入需要真实会话和凭证的 DSH Web GUI**，未做宿主 slot 的线上点击验收。
2. 真实测量只覆盖每主题 **4 个 primary**：新增、保存凭证、安装更新、保存 goal。Onboarding、判定空态、读取失败重试、复制规则和普通危险确认未在 Chromium 中量对比度；它们由 Node 的 8 场景与共享确认用例覆盖。
3. **未执行真实保存、安装更新、删除或轮询**；mutation 路由固定只读拒绝。busy/danger/ref/key 与旧宿主 fallback 是 Node 验证，不是真机交互验证。
4. 只量静态默认态；未量 `:hover`、`:active`、`:focus-visible`、动画中途、文本抗锯齿或截图像素。比值由 computed style 的颜色与 opacity 合成。
5. 禁用控件按 WCAG 1.4.3 豁免，只记录参考比值；没有宣称其达到启用态 4.5:1 门槛。
6. 因本任务文件写入白名单未生成截图；主线后续对比度复验仍需按主线口径补截图与真实 WebView 验收。
