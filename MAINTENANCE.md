# MAINTENANCE —— 维护台账（给接手的 agent 看）

## 一、身份

- 包名：`dsh-session-superagent`
- 形态：DSH 插件（tools-only + 自带 `cordis.patch.yml`）
- 目标宿主：DeepSeek Harness ≥ 0.2.1-rc.5
- 依赖：宿主已安装并登录 `gh` CLI；Node ≥ 22.19

## 二、当前状态（2026-11-01）

- [x] 七个工具可用（github / repo_here / watch_start / watch_status / watch_stop / watch_ack / watch_doctor），`node --test` 135/135 通过
- [x] 自回声抑制（逐条水位）
- [x] 仅空闲注入（避免草稿回放）
- [x] 唤醒失败不推进水位
- [ ] webhook 代替轮询（未做）
- [ ] 多仓库单会话（未做，当前每会话一仓库）

## 三、下一步

1. 真实仓库连跑 24h，统计 `lastWake` 与误唤醒次数；
2. 把 `trigger.json` 从正式包移出（或加开关），它只是测试通道；
3. 评估 `steer()` 与 `followup()` 在不同场景下的取舍。

## 四、硬约束

1. **不注入正在运行的会话**——会污染客户端输入框，可能导致重复发送。
2. **凭证永不出插件**：所有返回必须过 `redact()`；新增输出路径要补测试。
3. **不改 profile 的 `bundles`**：那是操作者动作，包只带 patch。
4. **不删除用户文件**；状态文件写失败必须静默降级。
5. **没跑过的写成“未验证”**，不写“通过”。

## 五、最短接手路径

读 `README.md`（做什么）→ 本文件（现状与约束）→ `CHECKLIST.md`（交付门）→ `UPDATING.md`（怎么发版）→ `lib/watch.js`（核心逻辑，纯函数，测试齐全）。
