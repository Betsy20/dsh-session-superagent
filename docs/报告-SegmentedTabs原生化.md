# SegTabs 迁移到 DSH SegmentedTabs 报告

## 结论

主理鱼主页面的 `SegTabs` 已接入 DSH 官方 `SegmentedTabs`：宿主提供该导出时，适配层只转发受控 `items / value / onChange / label`，官方组件接管点击、ArrowLeft/ArrowRight、Home/End、唯一 tab stop、`aria-selected / aria-controls` 与焦点移动。宿主缺少 `SegmentedTabs` 或整个 primitives 映射时，完整保留原 `div.dt-tabs[role=tablist]`、四个原生 button、原键盘循环和焦点跟随实现。

四个主 tab 的数量、顺序、文案和业务页面内容均未改变。每个 item 已补稳定 `id / panelId`；当前激活页面有且只有一个对应的 `div.dt-tabpanel[role=tabpanel]`，并通过 `aria-labelledby` 反向关联当前 tab。

## 1. 官方证据

核对官方固定 rev `66491b05e3f05ad35bcdd4f6cd7ed26041d9e3db` 的 [packages/client/ui-primitives/src/SegmentedTabs.tsx](https://github.com/deepseek-ai/deepseek-harness/blob/66491b05e3f05ad35bcdd4f6cd7ed26041d9e3db/packages/client/ui-primitives/src/SegmentedTabs.tsx)：

| 官方行为 | 本次适配 |
|---|---|
| item 合同包含 `value / label / id / panelId` | 四个 item 全部补齐稳定 DOM id |
| 受控 props 为 `items / value / onChange / label`，另有可选 `className / size` | 只转发前四个既有调用 props，使用官方默认 `md`；不回填旧 `dt-tabs` |
| `onClick={() => { onChange(item.value) }}` 不按当前值去重 | 原样传入 `setTab`，点击当前 tab 仍会调用 `onChange` |
| ArrowLeft/Right 循环，Home/End 到首尾；`preventDefault + stopPropagation` | 官方路径不挂本地 `onKeyDown`，不复制键盘实现 |
| 键盘先聚焦目标 tab，再调用 `onChange` | 焦点移动完全交给官方 |
| 每个 tab 使用 item `id`、`aria-controls=panelId`，仅当前项 `tabIndex=0` | items 的 id/panelId 与四个 panel 一一对应 |
| panel 由调用方持有 | 保留现有按 tab 条件渲染，只给四个业务页面补最小容器 |

## 2. 实现范围

### 2.1 官方委托与独立回退

`client.js` 新增 `hostSegmentedTabs` 可选探测。存在导出时：

```js
if (hostSegmentedTabs) return h(hostSegmentedTabs, { items, value, onChange, label })
```

缺少导出、缺少整个 `@deepseek-ai/dsh-client-ui-primitives` 或 require 失败时，`hostSegmentedTabs = null`，继续执行迁移前的本地 `SegTabs`。本地路径保留：

- `div.dt-tabs[role=tablist]` 与原 `aria-label`、grid 样式；
- 四个 `button.dt-tab[role=tab]`、原点击回调和 roving `tabIndex`；
- 原 ArrowLeft/ArrowRight 循环、Home/End、目标按钮 focus；
- 原有点击当前 tab 仍重发 `onChange` 的行为。

本地 tab 另按官方合同补上 `id=item.id` 与 `aria-controls=item.panelId`，因此回退路径也具备 tab/panel 关联。

### 2.2 稳定 id 与 panel 容器

| value | tab id | panel id |
|---|---|---|
| `overview` | `sa-main-tab-overview` | `sa-main-panel-overview` |
| `judge` | `sa-main-tab-judge` | `sa-main-panel-judge` |
| `trigger` | `sa-main-tab-trigger` | `sa-main-panel-trigger` |
| `settings` | `sa-main-tab-settings` | `sa-main-panel-settings` |

总览容器包含原 `overview + repoSummary`，判定容器包含原 `judge + timeline`，触发和设置分别包含原 `trigger`、`settings`。没有把四个业务页面改成同时挂载，也没有改其数据、表单、API 或状态逻辑。

原页面靠 `.dt-page > * + *` 维持 16px 纵向间距。新增 panel 容器后，同一规则最小扩展为 `.dt-page > * + *, .dt-tabpanel > * + *`，避免 wrapper 吞掉总览/判定内部的既有间距；未新增颜色、token 或另一套视觉样式。

## 3. 测试覆盖

`test/update-ui.test.mjs` 新增 4 条真实 UMD 集成测试：

1. **官方委托**：逐项检查四个 items 的 value/label/id/panelId、受控 value、官方组件身份；四种 tab 各自渲染时只有一个正确 panel，且 `aria-labelledby` 反向关联。
2. **完整回退**：分别覆盖整个 primitives 缺失、空 exports、仅缺 `SegmentedTabs`；检查原 tablist/button/class/grid、四个 tab、唯一 tab stop、aria-selected/controls 和 panel 关联。
3. **当前 tab 重置**：官方路径直接验证适配器未包装/去重 `onChange`；两个 fallback 场景真实调用当前 button 的 `onClick`，三种场景都断言 `setTab('overview')` 再发一次。
4. **键盘与焦点**：fallback 覆盖 ArrowRight、ArrowLeft、两端循环、Home、End 共 6 条路径，逐条断言 `preventDefault`、目标 `onChange` 与目标按钮 focus；官方路径断言没有本地 keydown/tablist。

说明：Node 测试验证的是本仓库适配与回退，不把宿主组件字符串桩展开成另一份官方键盘复制品。官方内部实现以第 1 节固定 rev 为证据，真实浏览器交互仍由主线复验。

## 4. 实际执行结果

迁移前同一客户端定向命令为 **109/109**。迁移后实际结果：

| 命令 | 真实结果 |
|---|---|
| `timeout 60 node --check client.js` | 通过 |
| `timeout 60 node --check test/update-ui.test.mjs` | 通过 |
| `timeout 240 node --test test/client.test.mjs test/update-ui.test.mjs` | **113/113 通过，0 失败，0 skipped** |
| `timeout 600 npm test` | **606/606 通过，0 失败，0 skipped** |
| `timeout 60 node scripts/ui-audit.mjs --json` | **11/11，100 分** |
| `timeout 30 git diff --check` | 通过，无 whitespace error |

`ui-audit` 原始关键计数：可点但不可键盘操作的裸 div **0**；自造样式写死颜色 **0**；含 inline/JS 常量写死颜色 **0**；自造 token **0**；自造类死代码 **0**；图标按钮缺可读名字 **0**；裸 button / 原生 Btn 趋势计数 **15/25**。

全量计数从基线 602 增至 606，正好对应本报告新增的 4 条测试；客户端定向从 109 增至 113，也是同 4 条。

## 5. 未验项与主线复验边界

本子任务没有运行真实 Chromium，也没有进入真实 DSH Web GUI，因此不宣称完成视觉、读屏或真实浏览器键盘验收。主线将以真实 Chromium 34 项复验；与本迁移直接相关的观察点是：

- 实际 DOM 来自官方 `SegmentedTabs`，不是 `.dt-tabs` 自制路径；
- 四个 tab 的 id/controls 与当前 panel 对应，只有当前 tab 是 tab stop；
- ArrowLeft/Right 循环、Home/End、焦点跟随和点击当前 tab 重发回调；
- 新增 panel wrapper 后总览、判定、触发、设置的内容与纵向间距无回归；
- 旧宿主回退仍可通过测试桩复现，真实宿主官方路径不能由 fallback 结果替代。

## 6. 改动边界

仅修改 `client.js`、`test/update-ui.test.mjs`，并新增本报告。`test/client.test.mjs` 无需修改。未改 `lib/`、package、版本、preflight、派单表或其它业务文件；未 commit、未 push，未启动替代服务或重启 DSH。
