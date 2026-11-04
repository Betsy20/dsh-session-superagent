## 这个 PR 修/加了什么

<!-- 一句话说清「什么问题」和「怎么改的」 -->

## 根因（修 bug 必填）

<!-- 为什么会出现这个现象？能贴复现步骤/探针更好 -->

## 验证

```bash
node --test
node scripts/preflight.mjs --fast
```

- [ ] 新增/修改了测试（修 bug 时**必须**有一条会红的用例，否则下一个人会改回去）
- [ ] 改的是用户可见文案 / 数字 → 跑了 `render-panel-copy.mjs --write`
- [ ] 改的是 `client.js` → 出图核对（深浅各一张）
- [ ] 版本号五处一致（`package.json` / `lib/index.js` / `client.js` / README 徽章 / CHANGELOG）

## 影响面

<!-- 动了哪些文件；服务端改动要不要重启宿主；有没有破坏性变更 -->
