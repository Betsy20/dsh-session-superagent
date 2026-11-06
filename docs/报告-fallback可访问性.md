# fallback 可访问性报告

## 修复

- W15：无官方 Tooltip 的回退支持 Escape 关闭，焦点留在 trigger；有稳定 id 与 `aria-describedby`，关闭清除关联。
- W16：fallback 确认 Modal 独占 Escape，底部 Orbit 不再同时关闭；关闭后焦点回 opener。
- W17：fallback Toast 以 `item.id` 作为 key，连续通知会重新挂载并重启动画；hold 与 timer 对齐。

## 验证

- 新增三条用例先红 3/3，修后 116/116。
- 全量：669/669。
- 真实 Chromium：47/47。
- 未改 lib/package/版本/preflight/派单表。

未进入真实 DSH Web GUI，未做物理读屏、触摸或 IME 验收。
