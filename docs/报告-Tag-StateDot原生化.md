# 报告：Tag / StateDot 原生化

日期：2026-11-06  
工作树：`D:\主工作区\projects\dsh-session-superagent-native-tag-dot`  
分支：`task/native-tag-dot`  
版本：保持 `0.9.280`，未改版本号，未 commit / push。

## 1. 结论

共享 `Tag()` 与 `StateDot()` 已分别接入 `@deepseek-ai/dsh-client-ui-primitives` 的官方同名导出。两者独立探测、独立回退：缺少其中一个导出时，另一个仍走官方组件；整个 primitives 模块不可用时，两者都保留完整本地实现。

业务调用点未改。此次代码差异只涉及宿主导出探测和两个共享包装器本身；测试差异只涉及定向测试桩与新增断言。

## 2. 官方证据与运行基线

- 官方源码固定 rev：`66491b05e3f05ad35bcdd4f6cd7ed26041d9e3db`（`dsh-v0.2.2-rc.1`）。
- [Tag.tsx](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/66491b05e3f05ad35bcdd4f6cd7ed26041d9e3db/packages/client/ui-primitives/src/Tag.tsx)：静态只读，接收 `tone / className / children`，由官方输出 `data-tone`；不接收 `title`，也不接收点击或 active 交互。
- [StateDot.tsx](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/66491b05e3f05ad35bcdd4f6cd7ed26041d9e3db/packages/client/ui-primitives/src/StateDot.tsx)：状态为 `done / warning / ongoing / error / idle`，支持 `size / className`，默认尺寸由官方按状态决定。
- 真实 Chromium 验收使用本机安装版 frontend / primitives `0.2.1-rc.5`，React `18.3.1`，实际捕获 290 个 primitives 导出。
- 安装版 asar SHA-256：`e1b6f25fa937da98086c3e77af77aa14791105963c4d337a1c42179d232c6915`。

## 3. 实现

### 3.1 独立探测

`client.js:359-360,374-376,388-389` 新增 `hostTag`、`hostStateDot`，分别从同一 primitives 模块读取；模块加载失败时两者清空。任何一个导出为空的场景不会触发另一个包装器降级。

### 3.2 Tag

`client.js:740-747`：

- 有官方导出：直接创建 `h(hostTag, { tone, className }, children)`，不把旧 `dt-tag` 或自制 `data-tone` 回填到官方路径。
- `title` 保留：仅在 `title !== undefined` 时增加一个只有 `title` 的无样式 `span` wrapper；无 `title` 时不增加 wrapper。官方组件仍拥有标签 DOM、tone 和静态只读行为。
- 无官方导出：保留 `span.dt-tag`、`data-tone`、`title`、`children`，并合并可选业务 `className`。

### 3.3 StateDot

`client.js:807-816`：

- 有官方导出：直接创建 `h(hostStateDot, { state, size, className })`；状态原样传递，不自造映射或新状态，`dt-dot` 等调用方 className 不丢失。
- 无官方导出：`done / warning / error / idle` 继续渲染 `span.dt-state-dot[data-state]`，保留 `aria-hidden` 与调用方 className；`ongoing` 继续渲染原有 SMIL spinner。
- 同时修正了本地 ongoing 分支原先会丢调用方 className 的问题：`dt-spinner` 现在与 `dt-dot` 等业务类合并；spinner 尺寸默认仍为 14，可用官方同名 `size` 参数覆盖。

`Dot()` 仍按原调用点传入 `className: 'dt-dot'`，现有 watcher 状态计算与展示映射未改。

## 4. 定向覆盖

`test/update-ui.test.mjs:640-735` 新增 5 条测试：

1. Tag 官方委托：8 种官方 tone、children、className、默认 outline、title 最小 wrapper。
2. Tag 回退：整个模块缺失、空 exports、仅缺 Tag；验证 `dt-tag / title / tone / children / className`。
3. StateDot 官方委托：`done / warning / ongoing / error / idle`、size 与 `dt-dot` className。
4. StateDot 回退：整个模块缺失、空 exports、仅缺 StateDot；验证四个固态、ongoing spinner、尺寸与 className。
5. 独立回退：仅缺 Tag 时 StateDot 仍委托；仅缺 StateDot 时 Tag 仍委托。

`test/client.test.mjs` 无需修改。

## 5. 真实验收计数

| 门禁 | 命令 | 结果 |
|---|---|---|
| 定向测试 | `timeout 180 node --test test/client.test.mjs test/update-ui.test.mjs` | **125/125 通过，0 失败**；迁移前同一命令为 120/120，新增 5 条均计入 |
| 全量测试 | `timeout 600 npm test` | **618/618 通过，0 失败** |
| UI 静态审计 | `timeout 60 node scripts/ui-audit.mjs --json` | **11/11 通过，100 分**；写死颜色 0、自造 token 0、自造死类 0 |
| 真实 Chromium | `timeout 600 ego-browser nodejs -e "await import('file:///D:/%E4%B8%BB%E5%B7%A5%E4%BD%9C%E5%8C%BA/projects/dsh-session-superagent-native-tag-dot/scripts/verify-panel-chromium.mjs')"` | **47/47 通过，0 失败** |

真实 Chromium 详情：

- Chromium：`156.0.8078.74`。
- 被测 `client.js` SHA-256：`b465acce86d1190ca28b5f1fdbc02595d4231ae72e47efaeb47ac42889103db2`。
- 完整 desk + Orbit 均真实挂载；四个主页面、五个设置分区、输入/开关、Tooltip、Modal、焦点路径均通过。
- 页面未预期错误 0，外部请求 0，真实 mutation 0；唯一 POST 是脚本末尾独立 loopback 防写探针，按预期返回 403。
- 验收在独立 loopback fixture 页面中加载真实 `client.js` 与安装版 React/primitives，不冒充已进入真实 DSH Web GUI。

## 6. 未验项与边界

- 既有 Chromium 脚本的 Ego/CDP 截图通道已标记不可用，本轮 12 个截图动作均记录 SKIP，最终截图 0 张；这些 SKIP 不计入 47 条 PASS，也不伪装成视觉截图验收。
- 未执行真实保存、安装、删除、暂停、恢复、GitHub/Gitee 请求或 watcher 轮询。
- 未验物理读屏、触摸、IME 和真实 Web GUI 宿主 slot。
- 未改 `lib/`、`package.json`、版本、preflight、派单表或其它业务文件；未 commit、未 push。
