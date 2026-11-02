# 跳过必须说明原因，否则等于没跑

## 出处
- 测试框架提供 `{ skip: 原因 }` 就是为了让人在输出里看见"为什么没跑"。
  写成布尔值等于把原因丢掉（Node 的 test runner 文档里 `skip` 既接受布尔也接受字符串：
  <https://nodejs.org/api/test.html#testname-options-fn>）。

## 现状盘点
```
{ skip: process.platform !== 'win32' }   ← 非 Windows 只输出 skip，不说明原因
node --test → skipped 0（本机 Windows 所以没跳过）
```
另一类更隐蔽：**用例体内提前 return** —— 测试显示 `✔`，其实一行断言都没跑。

## 做法
1. `skip` 必须写成 `process.platform !== 'win32' ? '只在 Windows 上验证 ACL 收紧' : false`；
2. 扫描用例体内的裸 `return`（当前 0 处）。

## 判据收紧的一次教训
第一版判据是"值里含引号就算有原因"，而条件 `process.platform !== 'win32'` 本身就含引号 →
**假 PASS**。改成必须匹配 `? '…'` 才真正生效，立刻抓到一处。

> 与 [条件断言等于永远通过](fake-pass.md) 同源：**判据要盯着"结论"，不能盯着"像不像"。**

## 是否已落地
✅ 0.9.82。`preflight` 第 28 项「跳过可见性」。

## 还没做的
- 只扫 `test/`；`scripts/` 里的集成脚本没有 skip 概念（它们直接 exit 0）；
- 用例体内"循环里 break"这种更隐蔽的提前结束没扫。
