# UI 全景清单（每一层都要对得上官方）

目的：把「所有界面，包括二三级页面」列成一张表，每条都写清**我们用的是什么结构 / 官方对应什么 / 差在哪**。
改的时候照着表打勾，不靠记忆。

官方源码位置：`D:\主工作区\projects\dsh-superagent-prototype\src\client\`
（`controls.tsx` 原语、`rows.tsx` 行结构、`settings-kit.tsx` 设置套件、`client.css` 样式、`overview/eval/execution/trigger/prompts/deployment.tsx` 六个页面）

---

## 一、渲染面（我们挂了哪些槽）

| # | 位置 | 组件 | 官方对应 | 状态 |
|---|---|---|---|---|
| 1 | `conversation.view` → 「主理鱼」页签 | `ZhuliPanel` | 官方 `main` 槽里的整个应用 | ✅ 已移植 4 个页签 |
| 2 | `conversation.composer.dock` → 输入框左侧卫星环 | `OrbitBadge` + 悬浮面板 | 官方 **没有**（这是我们加的会话级入口） | ✅ 悬浮面板 0.8.42 起改用 `dt-*` |

## 二、页签层（一级）

| 页签 | 我们的实现 | 官方页 | 差异 / 行动 |
|---|---|---|---|
| 总览 | 统计 `dt-stats` + `dt-rows` 行列表 + 空态 | `overview.tsx` | ✅ 结构一致；官方行是 `dt-ticket`（左侧状态列），我们是 `dt-row`＋标签 —— **待对齐** |
| 判定 | `dt-rows` 里的历史条目 | `eval.tsx` | ✅ 官方空态用 `<Hint>`，我们也用 hint |
| 触发 | 新增表单 `dt-form` + `dt-field` | `trigger.tsx` | ✅ 一致 |
| 设置 | `dt-settings` 网格 + `dt-settings-nav` 左栏 | `settings-kit.tsx` | ⚠️ 我们是单列 `Section` 堆叠，官方是「左侧栏 + 右侧内容」；**待对齐** |

## 三、二级页面（页签里的分区）

| 分区 | 我们的实现 | 官方对应 | 差异 / 行动 |
|---|---|---|---|
| 行内编辑（改间隔/过滤/时段/隔离） | 展开的 `dt-form` | `TriggerForm`（trigger.tsx） | ⚠️ 官方是**独立页**（点行标题跳转），我们是行内展开 —— 行内更轻，保留，但要用官方 `dt-ticket-actions` |
| 判定日志条目 | `dt-row` + `dt-row-meta` | `eval.tsx` 的 `dt-event` / `dt-timeline` | ⚠️ 官方有 `dt-timeline`/`dt-event`，我们没用 —— **待对齐** |
| 凭证 | `dt-kv` + 密码框 + 保存按钮 | `settings-kit` 的 `Field`/`Fields` | ⚠️ 官方 `Field` 带 hint/note，我们用自制 `field()` —— **待对齐** |
| 版本与更新 | `dt-kv` + 命令 + 复制 | 官方无 | ✅ 自研，样式走 token |

## 四、三级页面（弹层）

| 弹层 | 我们的实现 | 官方对应 | 差异 / 行动 |
|---|---|---|---|
| 术语表 | `dt-modal` + `dt-glossary` 表格 | 官方无（我们自研） | ✅ 结构用官方 Modal |
| 删除确认 | `ConfirmBtn` 二段确认 | 官方 `Modal` + footer | ✅ 可接受（更轻） |
| Toast | `dt-toast` | 官方无 toast（官方用 banner） | ⚠️ 官方模式是 `dt-banner`；保留 toast 但**降级为次要**，重要结果用 banner |
| 新版本横幅 | `dt-banner` + 动作 | — | ✅ |

## 五、官方原语对照（`controls.tsx`）

| 官方 | 我们 | 状态 |
|---|---|---|
| `Icon` | `Icon` | ✅ |
| `Button` | `Btn` | ✅（命名不同，行为一致） |
| `Tag` | `Tag` | ✅ |
| `Pill` | — | ❌ **缺**（官方用于可切换小胶囊） |
| `SegmentedTabs` | `SegTabs` | ✅ |
| `SegmentedControl` | — | ❌ **缺** |
| `Input` | `Input` | ✅ |
| `Switch` | `Toggle` | ✅ |
| `StateDot` / `Dot` | — → 已在 dock 用 `dt-state-dot` | 🟡 半移植（没有组件封装） |
| `DisclosureRow` | — | ❌ **缺**（官方折叠行的标准做法，我们手写过类似的） |
| `Modal` | `Modal` | ✅ 0.8.42 补齐 **Escape + Tab 陷阱 + 焦点归还** |
| `InfoTip` | `dt-info` 样式在，组件没封装 | 🟡 半移植 |

## 六、官方素材（能直接用就别自己画）

- **图标**：官方 `controls.tsx` 的 `ICON_PATHS`（chevron/plus/close/question/refresh/pause/play/trash/settings…）—— 我们已按同一份路径移植；
  新增图标前先去官方文件里找，找不到再考虑自造。
- **样式**：`src/client/client.css`（382 行，171 处 token）与我们 `PORTED_CSS` 同源；差异只在版本。
- **文案**：官方 `locales.ts` 有中英两份；我们的界面文案是自写的（中文），术语表可当字典用。
- **空态**：官方统一用 `<Hint>`（`rulesEmpty: '暂无规则，不会主动接单。'`），不是插画 —— 我们也照此，别画图。

---

## 七、下一步（按 ROI 排）

1. ✅ **行列表改官方 `dt-ticket` 结构**（0.8.43）
2. ✅ **设置页改成官方「左栏 + 内容」**（0.8.43）
3. ✅ **判定页改用 `dt-timeline` / `dt-event`**（0.8.44）
4. ✅ **补齐缺的原语**：`Pill`、`SegmentedControl`、`DisclosureRow`、`InfoTip`（0.8.44；`StateDot` 已在 dock 用 `dt-state-dot`）
5. ✅ **表单字段统一走官方 `Field`（带 hint/note）**（0.8.45，控件旁有 ? 图标）
6. ◐ **Toast → Banner**：重要结果已用 banner（`notice`），toast 保留给「保存成功」这类轻确认 —— 决定保留，理由：官方无 toast，但一次静默的保存需要即时反馈。
7. 双主题实拍 + 键盘走查（需宿主，攒批）。
