# Orbit 官方结构核对与 DisclosureRow 迁移

## 边界

固定官方 rev `66491b0` 中没有通用 Popover/Card/List/IconButton/Empty 公共导出。DockLayout/FloatLayer 是右栏分栏/标签坞，Menu 是 `menuitem` 单动作选择语义，均不能冒充 Orbit 的多动作富行。

当前 Orbit 容器已经复用官方 `MenuSurface + useAnchoredPosition + useDismissOnOutsidePointer + portal`，没有另造一套定位机制。

## 实际迁移

发现官方 `DisclosureRow` 可直接承载 watcher 行头：

- 状态点、仓库名、状态标签进入官方行头。
- 暂停/轮询/删除三个独立动作进入 `headerAccessory`。
- 外层使用 `ul > li` 语义列表。
- watcher 的多行详情保留为 derived 内容，不冒充官方组件。
- 缺 `DisclosureRow` 或任何 Orbit 基础能力时，完整回退旧 StatusOrbit。

`client.js`、`test/orbit-popover-integration.test.mjs` 与 `scripts/audit-adapter-parity.mjs` 同步更新；后者把 DisclosureRow 加入依赖契约。

## 验证

- Orbit 定向 + client：103/103。
- 同源审计与适配器定向：13/13。
- 全量：602/602。
- UI 体检：11/11，100 分。
- 真实 Chromium：Orbit/Modal 全部功能项 PASS，含焦点圈、Escape、取消回焦与防写 403；截图通道继续 SKIP。

未验真实 DSH Web GUI、真实 watcher 写操作和视觉截图。
