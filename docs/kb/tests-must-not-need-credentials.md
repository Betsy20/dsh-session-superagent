# 用例不该依赖"真实凭证"

## 出处
- 测试隔离（hermetic tests）：一条用例如果依赖外部服务或凭证，它的**通过与否取决于环境**，
  而不是代码 —— 于是它既慢又不可靠：
  <https://martinfowler.com/bliki/TestPyramid.html>（"慢/脆的测试会被跳过，被跳过的测试等于不存在"）

## 现场（真机实测）
重启后跑 `node --test`，**101 秒**才结束（上一轮还是 9 秒）。逐文件计时直接定位：

```
103571 ms  test/routes.test.mjs
 42290 ms  test/contract-stability.test.mjs
```

根因不在用例，而在环境：

```
$ gh auth status
X Failed to log in to github.com account MYCF711 (keyring)
  - The token in keyring is invalid.
```

于是每个走 `gh api` 的用例（`watch_start` 的仓库体检、`watch_ack` 打标签）都要**等到超时**。

## 改法
加一个离线模式：`DSH_SUPERAGENT_OFFLINE=1` 时 `run()` 遇到 `gh` 直接返回固定内容，不 spawn。
`preflight` 跑子进程时开启它；生产不会设这个变量（设了所有 GitHub 结果都是假的）。

## 证据
| 情况 | 耗时 |
|---|---|
| 改前 | **101.4 秒** |
| 改后（离线模式） | **1.65 秒**（225/225 通过） |

## 判据
**用例的耗时与结果，都不该随"这台机器有没有登录 GitHub"变化。**
一旦发现某个文件突然慢 10 倍，先怀疑环境依赖，而不是代码逻辑。

## 是否已落地
✅ 0.9.118。`preflight` 的子进程统一带 `DSH_SUPERAGENT_OFFLINE=1`。

## 还没做的
- 离线模式返回的是固定内容，**不能**用来验证真实 API 行为（需要真机时仍要开网络）；
- 没有"用例是否碰网"的静态检查（可以扫 test/ 里对 `gh` 的调用，但目前都走同一个 seam）。
