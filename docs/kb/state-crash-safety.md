# 状态文件被写坏时，别当"空状态"

## 出处
- SQLite《Write-Ahead Logging》：<https://www.sqlite.org/wal.html>
  核心思路：**改动先落到一份已提交的日志/副本上**，主文件损坏时可以用它恢复；
  而不是"就地覆盖，坏了就从头开始"。

## 它怎么做的
WAL 把变更写进独立的日志文件并 fsync，主库文件坏掉时仍能从日志重放；
对比 `journal_mode=DELETE` 的原地修改，抗断电能力差很多。

## 我们能怎么用
我们的状态是 `<state>/watchers.json`：原子写（tmp → rename）+ 合并写 + 墓碑，已经很稳，
但**只有一份**。一旦主文件被写坏（断电、磁盘满、用户手改、杀软截断），
`readState()` 的 `catch` 会直接返回 `{ watchers: {} }` —— 客户看到的是「所有守一夜消失」。

改法（不需要数据库，一个文件就够）：
1. 每次覆盖前，若**当前主文件能正常解析**，先把它存成 `watchers.json.bak`；
2. 读取时主文件解析失败 → 退回 `.bak`，并把它写回主文件；
3. 备份也坏 → 把坏文件改名成 `watchers.json.corrupt-<时间戳>` 留证，再从空状态开始；
4. `/state` 暴露 `stateSource`（ok / backup / corrupt / new），面板能显示"已从备份恢复"。

## 是否已落地
✅ 0.8.61。用例 `test/state-merge.test.mjs`：写两次造出 `.bak` → 主文件写成非法 JSON →
`readState()` 必须从备份恢复出条目，且主文件被修好。

## 附带修的测试问题
`/update` 那条用例会真的访问 npm registry，机器慢时会跑到 5010ms 才超时失败（本轮真出现过）。
已给它单独 60 秒超时 —— 要验的是「离线也必须给出 current」，不是网速。
