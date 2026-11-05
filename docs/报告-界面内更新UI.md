# 界面内更新 UI 实施与验收报告

## 结论

已在主理鱼「设置 → 版本与更新」中把单一命令入口升级为「安装更新 + 复制命令回退」。前端只在用户确认后发送真实 `POST /session-superagent/update`，请求体为 `{ "version": <latest> }`；不会自行拼接 shell 命令、不会触发宿主重启，也不会把安装副本版本冒充为运行中版本。

本次客户端改动文件：

- `client.js`
- `test/update-ui.test.mjs`（新增）
- `docs/报告-界面内更新UI.md`（本报告）

本子任务从 `0.9.270` 基线实施，未修改任何版本号，未提交 commit。服务端更新路由由并行子任务实现；本报告的客户端测试全部使用模拟 fetch，没有执行真实安装。收尾时工作区另有并行版本与 UI 改动，未由本子任务写入或回滚，需由父代理单独集成验收。

## 实现行为

### 1. 官方确认动线与命令回退

- `update.hasUpdate` 为真时，同时显示 primary「安装更新」和原「复制命令」。
- 安装按钮优先使用 `require('@deepseek-ai/dsh-client-ui-primitives')` 暴露的 DSH `Button`，并复用现有 `ConfirmButton / ConfirmDialog` 动线。
- 点击安装按钮只打开 DSH `Modal`，不发写请求。确认文案明确列出当前版本、目标版本、会修改安装副本、需要重载才生效以及不会自动重启。
- 取消、关闭确认层、复制命令均不会发送安装 POST。
- 老宿主缺少 `Button` 时回退到既有同源 `Btn`；缺少 `Modal / Toast` 时保留既有本地实现。缺整个 primitives 模块和仅缺 exports 两种情形均有测试。
- 未新增 CSS、颜色、图标或自造弹层样式。官方依据为现有 `docs/ui-decomp/01-dsh-ui-tree.md` 中登记的 DSH `Button`、`Modal`、`Toast` 原语及本机官方 UI 主库。

### 2. 请求、busy 与状态真值

- 只有「确认安装」才调用：

  ```http
  POST /session-superagent/update
  content-type: application/json

  {"version":"0.9.271"}
  ```

  示例中的 `0.9.271` 是测试里的 `update.latest`；实际代码始终取当前状态中的 `update.latest`，不写死目标版本。

- 确认期间复用 `ConfirmDialog` 的同步 `busyRef` 与 state busy：连点第二次直接返回 `false`，只发送一个 POST；按钮同时具有 `disabled`、`aria-busy` 和既有 busy class。
- 成功后单独保存安装回执，并显示：
  - `installedVersion`：服务端返回的安装副本版本；
  - `runningVersion`：服务端返回的当前运行版本；
  - `needsReload`：是否需要重载，包含 `true / false` 的可见文字。
- 成功 Toast 同样使用服务端回执中的版本值；随后执行一次 `GET /session-superagent/update?refresh=1`，用 GET 结果刷新版本检查状态。
- 安装回执与 `update` 检查状态分开存放。POST 失败不会改写 `update`，因此当前版本、目标版本、命令文本和「复制命令」都保留。
- 失败写入现有 Section notice，并发送 error Toast；确认层不因失败而假装成功关闭。成功结果留在版本 Section，并发送 success Toast。
- 界面没有「已运行新版」文案，也不根据 `installedVersion` 推断运行中已经切换到新版。

## 定向测试覆盖

`test/update-ui.test.mjs` 共 **5 条**：

1. 官方 primary 按钮、确认前零 POST、取消/关闭零 POST、确认说明完整、复制命令真实写入剪贴板。
2. 确认后 POST 路径与 `{version: latest}` 精确匹配；同步 busy 防连点；POST 完成前不刷新；完成后只安装一次并强制 GET。
3. 成功回执三字段、GET 新状态、success Toast、`needsReload=true/false` 两种显示，以及不宣称「已运行新版」。
4. 失败保留当前版本和命令回执，不强制刷新、不写安装回执、不关闭确认层；错误同时进入 Section 与 Toast。
5. 老宿主 primitives 整体缺失及 exports 缺失时，本地 Button/Modal/Toast 完整回退，仍能完成同一 POST 与刷新动线。

## 真实验收计数

| 命令 | 结果 | 说明 |
|---|---:|---|
| `node scripts/test.mjs test/update-ui.test.mjs` | **5/5 通过，0 失败** | 新增定向测试；模拟 fetch，不真实安装 |
| `npm test` | **570/570 通过，0 失败，0 跳过** | 当前集成工作树的完整 Node 套件，含新增 5 条与并行路由/响应式测试 |
| `node scripts/ui-audit.mjs --json` | **11/11 通过，100 分** | 写死颜色 0、自造 token 0、死自造类 0、缺名图标按钮 0；官方结构采用 8/8 |
| `node scripts/audit-contrast.mjs --json` | **浅色 16 组 / 深色 13 组不达标** | 独立脚本按既有违规返回 **exit 1**；未超过浅 16 / 深 13 的既有基线 |

### 对比度原始计数

- 浅色：**121 组 / 1510 节点**；不达标 **16 组 / 310 节点**，其中控件边框/状态面 7 组、文字 9 组；豁免 25 组。
- 深色：**133 组 / 1510 节点**；不达标 **13 组 / 231 节点**，其中控件边框/状态面 10 组、文字 3 组；豁免 26 组。
- 本次没有修改 `PORTED_CSS`、颜色 token 或对比度基线。上述计数来自真实 `client.js` 经 `render-preview.mjs` 静态渲染后的无头 Chromium 测量，不能写成「WCAG 全部达标」或「真实 DSH 宿主的全部交互态已验」。独立脚本的 exit 1 已如实保留。

## 真机与端到端未验项

以下项目本轮**未验证**，不能由 Node 测试或静态对比度代替：

1. 没有在真实 DSH Web GUI 中点击「安装更新」并修改实际安装副本；因此真实 CLI 安装、profile 解析、文件权限、非零退出与超时只由并行服务端测试覆盖，不属于本次真机验收。
2. 没有在真实宿主中核对 DSH `Button / Modal / Toast` 的实际 portal、焦点圈、焦点归还、键盘动线、读屏、窄屏排版和深浅主题 computed style。
3. 没有重载或重启宿主，未验证真实安装后 `runningVersion` 的变化；界面也未主动触发这类动作。
4. 对比度脚本测量的是静态 preview 与近似 token，不含真实宿主的 `:hover / :focus` 状态，也不等于真实 DSH WebView 验收。
5. 未做真实剪贴板权限拒绝的浏览器验收；复制成功与命令保留由模拟剪贴板和渲染测试覆盖。

## 0.9.273 状态一致性补丁

- 手动「重新检查」清除旧 `updateResult`，避免旧回执覆盖新的 hasUpdate 状态。
- 安装成功后的强制刷新使用 `checkUpdate(true, true)`，保留刚写入的 installed/running/needsReload。
- 顶部入口从「看升级命令」改为「去更新」。

验证：更新 UI **6/6**，全量 **572/572**。仍未执行真实 GUI 安装或宿主重载。
