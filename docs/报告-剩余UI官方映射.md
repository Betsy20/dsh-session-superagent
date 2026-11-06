# 剩余 UI 官方映射清单

固定官方 rev：`66491b05e3f05ad35bcdd4f6cd7ed26041d9e3db`。

## 有明确公共同物，已迁移

| 当前结构 | 官方组件 | 结果 |
|---|---|---|
| 主页面 SegTabs | `SegmentedTabs` | T85 已迁移，含方向键/Home/End、panel 关联与回退 |
| Btn primary/ghost/outline/toolbar | `Button` | T80/T82 已迁移；link 无同物，保留 |
| Orbit watcher 行头 | `DisclosureRow` | T84 已迁移，详情仍作 derived 内容 |
| 单行 Input | `Input` | T86 已迁移，搜索/凭证/数字/行内编辑与回退 |
| Toggle | `Switch` | T87 已迁移，id 用无样式 wrapper 保留 |
| 筛选 Pill | `Pill` | T91 已迁移，静态/交互与 aria-pressed |
| 只读 Tag / 状态点 | `Tag` / `StateDot` | T92 已迁移，独立回退 |

## 只有专用实现，不冒充公共组件

- `ConfigField.tsx` 内部有原生 textarea/select 分支，但未从 `ui-primitives/src/index.ts` 导出通用 TextArea/Select。
- `ui-schedule/PickerPopover` 是专用弹层，不是通用 Popover。
- DockLayout/FloatLayer 是 split/tabbed panes，不是 Orbit 的 watcher 列表。
- Menu 使用 `menuitem` 单动作选择语义，不适合 Orbit 的暂停/轮询/删除多动作富行。

因此原生 `textarea.dt-textarea / select.dt-select` 暂保留，复用 DSH tokens，不借专用组件换名。Orbit 容器继续使用已验证的 `MenuSurface + useAnchoredPosition + useDismissOnOutsidePointer + portal`。

## 后续候选

1. 设置导航与表单行：继续核对官方 ConfigField/SettingsRoute 的公共可复用部分，先做证据再改。
2. link 按钮：官方 Button 无 link variant，保持当前实现。
3. 任何后续迁移必须保留真实 Chromium、键盘、焦点与旧宿主回实验收。
