# Windows 上 `chmod 0600` 保护不了 token

## 出处
- Node.js 文档 `fs.chmod` 的 Caveats：*"on Windows only the write permission can be changed,
  and the distinction among the permissions of group, owner, or others is not implemented."*
  <https://nodejs.org/api/fs.html>
- `fs.access` 同页也提醒：**它不会检查 ACL**，所以"能访问"不代表"权限没问题"。

## 它怎么做的
Node 在 Windows 上把 `mode` 映射到只读属性，`0o600` 里的 owner/group/others 语义丢掉了。
真要做，只能走 ACL：`icacls <file> /inheritance:r /grant:r <user>:F`。

## 我们能怎么用
我们把 GitHub token 写在 `<state>/secrets.json`，一直用 `{ mode: 0o600 }` 写 ——
在 Windows 上**约等于没有保护**。

改法：写完立刻
- POSIX：`chmod 0600`；
- Windows：`icacls <file> /inheritance:r /grant:r <当前用户>:F`（断开继承，只留本人）。
结果记进 `secretsHardened`，`/diagnose` 里显示「凭证保护: win32-acl / posix-0600 / failed」。

## 实测（本机）
```
收紧前： NT AUTHORITY\SYSTEM:(I)(F)
         BUILTIN\Administrators:(I)(F)
         OWNER RIGHTS:(I)(F)
收紧后： <用户>:(F)
```
继承来的 SYSTEM / Administrators 被断开，只剩本人。

## 是否已落地
✅ 0.8.62。用例 `test/secrets-acl.test.mjs`（Windows 专用，其他平台 skip）：
调 `hardenSecretsFile` 后用 `icacls` 回读，断言当前用户有 `(F)` 且没有残留的 Users 组。

## 还没做的
- 没做**轮换**：token 泄漏后需要人工去面板换；将来可以加"上次使用时间 + 一键轮换"；
- 没验证断开继承对备份软件的副作用（个人工具，先按最小可见面处理）。
