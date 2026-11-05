# 真实 DSH CLI 探针报告（0.9.272 回归固化）

- 日期：2026-11-06
- 工作区：`D:\主工作区\projects\dsh-session-superagent-update-cli`
- 脚本：[scripts/verify-update-cli.mjs](../scripts/verify-update-cli.mjs)

## 1. 目标与边界

把 0.9.272 的真实 CLI 解析验证固化成可复跑脚本，防止 mock 全绿而真机仍 `cli_not_found`。

脚本只做两件事：

1. 在真实 `DeepSeek Harness.exe` 的 `ELECTRON_RUN_AS_NODE=1` 环境中空调用 `resolveDshCommand({})`，检查 `file` / `args` / `source`，读取并哈希解析出的官方 `bin.js`；
2. 用解析出的 `file + args` 追加唯一参数 `--help`，以 `shell:false` 执行官方 CLI 帮助。

没有执行 `plugin add`，没有安装或更新任何包，没有重启、关闭或热重载 DSH，没有请求更新路由，也没有读取或打印凭证。

## 2. 复跑方法与输出契约

在仓库根目录运行：

```bash
node scripts/verify-update-cli.mjs
```

普通 Node 进程此时仅作为启动器，按以下顺序寻找官方 exe：

```text
DSH_ELECTRON_PATH
→ process.resourcesPath / resourcesPath / DSH_RESOURCES_PATH
→ DSH_PROFILE_DIR
→ DSH_HOME
```

找到后由启动器设置 `ELECTRON_RUN_AS_NODE=1`，再用该 exe 运行同一脚本；真正的解析与帮助命令只在内层 Electron 进程执行。也可绕过启动器直接运行：

```bash
ELECTRON_RUN_AS_NODE=1 "/d/DeepSeek Harness/Desktop/DeepSeek Harness.exe" scripts/verify-update-cli.mjs
```

输出与退出码：

| 项目 | 契约 |
|---|---|
| stdout | 始终是一行可用 `JSON.parse` 读取的 JSON（`--help` 使用说明除外） |
| stderr | 默认输出逐项 `PASS` / `FAIL` 与最终摘要；`--json` 可关闭人类输出 |
| PASS | 脚本退出 `0`，JSON 为 `status:"PASS"`、`ok:true`、`ciPass:true` |
| FAIL | 脚本退出 `1`，包括解析失败、非官方入口、帮助非零、spawn 错误和超时 |
| SKIP | 找不到 exe 时脚本退出 `2`，JSON 为 `status:"SKIP"`、`ok:false`、`ciPass:false`，并打印使用说明；不是通过，CI 不得忽略 |

可选参数：

```text
--json                       只输出机器 JSON
--timeout-ms=30000           bin.js --help 的超时，允许 1..300000
--output-limit-bytes=16384   stdout/stderr 各自输出上限，允许 32..65536
```

stdout/stderr 使用同一有界收集器：捕获有上限、按 UTF-8 边界截断、输出前脱敏；截断末尾可能构成不完整 token 的长字符段会保守替换为 `***`。JSON 是逐字段脱敏后再序列化，避免正则误吃 JSON 结构字符。超时只 kill 本次官方 `--help` 的直接子进程，不触碰 DSH 宿主。

## 3. 本机真实结果

最终结果为 **PASS**，普通启动器与直接 Electron 两种入口均实际运行成功。

### 3.1 运行时与 profile

```text
profile              desktop
profile 来源          DSH_PROFILE
Electron             44.7.0
Electron 内 Node      v24.21.0
ELECTRON_RUN_AS_NODE  1
平台                  win32
```

### 3.2 `resolveDshCommand({})` 的真实返回值

```json
{
  "file": "D:\\DeepSeek Harness\\Desktop\\DeepSeek Harness.exe",
  "args": [
    "D:\\DeepSeek Harness\\Desktop\\resources\\app.asar\\dsh\\node_modules\\@deepseek-ai\\dsh\\lib\\bin.js"
  ],
  "source": "DSH installation CLI JS"
}
```

检查确认：`file` 就是当前官方 Electron，`args` 只有上述一个官方 asar `bin.js`，`source` 正是 0.9.272 新增的 `DSH installation CLI JS`，没有落到 mock、PATH 中的其他命令或 `dsh-desktop-host` 包装入口。

### 3.3 官方入口与帮助

```text
入口路径  D:\DeepSeek Harness\Desktop\resources\app.asar\dsh\node_modules\@deepseek-ai\dsh\lib\bin.js
字节数    11772
SHA-256   80112efe368efb1a39720c7ada0af00442e5131fb2744edaaff8a3e8bb499e6f
帮助首行  Usage: dsh [--profile] <name> [options] [app-args...]
help exit 0
stderr    空
```

普通 Git Bash 不能直接 `stat` asar 内部路径；本报告的字节数与哈希是在真实 Electron 内用其 asar 文件系统支持读取所得，不是根据普通文件系统猜测。

## 4. 实际命令、退出码与结果

以下均在本工作区执行；表中的“脚本 exit”是命令当时实际返回值，不是预期值。

| 场景 | 实际命令（必要环境省略时已另列） | 脚本 exit | 结果 |
|---|---|---:|---|
| Node 启动器，默认环境发现 exe | `node scripts/verify-update-cli.mjs --json` | 0 | PASS；由 `DSH_PROFILE_DIR` 找到 exe；help exit 0 |
| 直接 Electron，同时验人类输出 | `ELECTRON_RUN_AS_NODE=1 "/d/DeepSeek Harness/Desktop/DeepSeek Harness.exe" scripts/verify-update-cli.mjs` | 0 | 10 项 PASS；stdout JSON 解析成功；help exit 0 |
| 只保留 `DSH_HOME` 发现路径 | 清除 `DSH_ELECTRON_PATH` / `DSH_PROFILE_DIR` / `DSH_RESOURCES_PATH` / `resourcesPath` 后运行 `node scripts/verify-update-cli.mjs --json` | 0 | PASS；`launcher.source="DSH_HOME"` |
| 只保留 `resourcesPath` 发现路径 | 清除其他定位变量，设 `resourcesPath='D:\DeepSeek Harness\Desktop\resources'` 后运行同一命令 | 0 | PASS；`launcher.source="resourcesPath"` |
| 找不到 exe | 清除 `ELECTRON_RUN_AS_NODE` 与全部 exe 定位变量后运行 `node scripts/verify-update-cli.mjs` | 2 | SKIP；`error.code="electron_not_found"`；`ciPass=false`；打印复跑说明 |
| 强制帮助超时 | `node scripts/verify-update-cli.mjs --json --timeout-ms=1` | 1 | FAIL；`error.code="timeout"`；help exit `null`；signal `SIGKILL`；`timedOut=true` |
| 强制输出截断 | `node scripts/verify-update-cli.mjs --json --output-limit-bytes=32` | 0 | PASS；stdout 正好 32 字节且 `stdoutTruncated=true`；本次 stderr 为 0 字节 |
| 静态语法检查 | `node --check scripts/verify-update-cli.mjs` | 0 | JavaScript 语法通过 |

两个新增文件还分别执行了 `git diff --no-index --check /dev/null <file>`。两者都因“与空文件存在新增差异”实际返回 `1`，且没有任何 whitespace 诊断输出；这里的 `1` 是 `diff --no-index` 的差异语义，没有被当成测试 PASS。普通 `git diff --check` 不检查 untracked 文件，因此没有用它冒充新增文件的空白验收。

负向测试的外层断言还检查了实际退出码与 JSON 状态一致；因此上表不是“命令非零但测试包装仍成功”的假绿。强制超时和找不到 exe 是人为构造的负向场景，不代表本机正常探针失败；本机正常路径最终 exit 为 0。

## 5. 未验项

1. **没有执行真实 `plugin add`、安装、更新或重启**；因此未验证安装结果、profile bundles 变化、运行中插件版本切换或安装后的回滚。
2. 没有 POST `/session-superagent/update`，未验证宿主当前已加载的生产服务端是否包含本 worktree 代码；本探针直接导入本 worktree 的 `lib/update.js`。
3. 正常 `--help` 的真实 stderr 为空；已验 stdout 的 32 字节截断，**没有用真实凭证形 stderr 做泄漏试验，也没有触发真实 stderr 截断**。stderr 与 stdout 共用同一 capped + redacted 收集器，但这不冒充真实 stderr 样本验收。
4. 超时只在本机 Windows 上验证直接 CLI 子进程收到 kill；未验证其他操作系统、所有 Electron 版本或任意后代进程树回收。
5. 只验本机这套 Windows 安装与上述入口哈希；未验 macOS、Linux、非标准便携布局、损坏 asar、无读取权限或 help 自然非零的情况。
6. `DSH_PROFILE_DIR`、`DSH_HOME`、`resourcesPath` 三条定位路径已分别实测；额外的 `DSH_ELECTRON_PATH` / `DSH_RESOURCES_PATH` 覆盖入口未逐一做隔离实跑。
7. 未运行全量 `npm test`；本任务没有改生产代码、测试或派单表，验证焦点是真实 Electron/CLI，而不是再次用 mock 替代真机证据。

## 6. 改动范围

仅新增：

- `scripts/verify-update-cli.mjs`
- `docs/报告-真实CLI探针.md`

未改 `lib/`、`package.json`、`client.js`、版本、preflight、派单表；未 commit，未 push，未操作其他 worktree。
