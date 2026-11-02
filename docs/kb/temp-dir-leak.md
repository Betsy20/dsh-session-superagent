# 测试漏掉的临时目录：一次 8 个，攒到 1654 个

## 出处
- 这是"资源清理"类问题的典型形态：单个用例看起来无害（一个目录几 KB），
  但**测试跑几百次**之后就是本机垃圾场。CI 上则表现为磁盘慢慢变满、偶发失败。

## 实测数据
```
$ node -e "…统计 tmpdir 里 superagent-*/zhuli-* 目录…"
临时目录残留: 1654
```
清空后跑一次 `node --test`：
```
一次测试后新残留: 8
  superagent-routes-xgeYgM
  zhuli-acct-o3jn2E
  zhuli-fmt-OsVneg
  zhuli-json-vA3AN5
  zhuli-st-mP5IKn
  zhuli-stab-r8WDcr
```

## 根因
测试里到处写 `mkdtempSync(join(tmpdir(), 'x-'))`，**有的文件删了、有的没删**，
还有的在模块顶层创建（测试失败时根本走不到清理代码）。

## 改法
1. `test/fixtures/tmpdir.mjs`：`tempDir(prefix)` 建目录并登记，`process.on('exit')` 统一删除；
2. 9 个测试文件全部改用它（`mkdtempSync(join(tmpdir()…))` 出现次数 → 0）；
3. `scripts/clean-tmp.mjs`：清历史残留（`--dry` 先看）；
4. `preflight` 新增「临时目录收口」：**只要还有测试自己建临时目录就红**。

## 效果
- 清理后残留 **0**；
- 改造后跑一次测试，残留 **0**（原来 8）；
- 用例数 188 全过。

## 为什么写进 KB
这类问题不会"报错"，只会**悄悄积累**。它和`flaky-gate.md` 是同一主题的两面：
**测试基础设施的卫生，决定了门禁能不能被信任。**

## 是否已落地
✅ 0.9.60。`preflight --fast` 新增第 3 项「临时目录收口」。

## 还没做的
- 只覆盖 `test/`，`scripts/` 里的临时目录（如 `render-preview` 的输出）没纳入；
- `process.on('exit')` 在 `SIGKILL` 下不会执行，那种情况仍会漏（`clean-tmp` 兜底）。
