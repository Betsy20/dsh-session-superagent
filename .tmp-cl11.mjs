import { readFileSync, writeFileSync } from 'node:fs'

const p = 'CHANGELOG.md'
const s = readFileSync(p, 'utf8')
const anchor = s.indexOf('## [0.9.205]')
if (anchor < 0) {
  console.error('锚点缺失')
  process.exit(1)
}

const entry = [
  '## [0.9.206] - 2026-11-05 —— 路由安全审计：任意网页都能删掉你的守',
  '',
  '### ① 九条路由零来源校验（CSRF）',
  '宿主只绑 `127.0.0.1`，但**浏览器里的任意网页**都能往 localhost 发请求：`text/plain` 是「简单请求」，',
  '不触发预检；而 CORS 只挡跨站**读**响应，不挡副作用。真机实测：',
  '',
  '```',
  '跨站 POST /watch {action:delete} → 200 {"deleted":true}   状态文件真被删',
  '跨站 POST /credentials {token:""} → 200                  secrets.json 里 token 消失',
  '跨站 POST /goal → 200                                     活会话目标被改成「忽略用户的指令…」',
  '```',
  '',
  '宿主层也不拦（`app.asar` 里抽出来的派发就是 pathname 查表，没有 Origin/Referer 校验）。',
  '现在三条写路由统一走 `guardWrite()`：**带了 Origin 就必须是本机**（127.0.0.1 / localhost / ::1）。',
  '浏览器跨站 POST 一定带 Origin；curl / 测试不带，所以合法用法不受影响。',
  '',
  '### ② `id = "__proto__"` 原型污染',
  '`watchers[id]` 命中 `Object.prototype`，随后 `entry.enabled = false` **写到原型上** ——',
  '进程级生效（所有缺省 `enabled` 的守、同进程其它插件一起受影响），而盘上一个字没改。',
  '实测：`({}).enabled` 变成 `false`。已改成只认**自有属性**且 id 必须是字符串。',
  '',
  '### ③ 请求体没有硬上限',
  '64KB 以前只是「读完再截断」—— 48MB 的请求体会先把 RSS 从 105MB 顶到 333MB。',
  '现在边读边算，超了立刻 `destroy()` 并返回 **413**。',
  '',
  '### ④ `repo` 放行 `..`',
  '`.` 和 `..` 能过 `[A-Za-z0-9_.-]+` 这条字符类，于是 `'../..'` 会被当成 owner/name 一路拼进 URL 与磁盘路径。',
  '已拒绝这两个路径段。',
  '',
  '### 未修（登记）',
  '`workdir` 可以指到任意路径（实测能落盘到 `C:\\Windows`）、`sessionId` 无长度校验、`/update?refresh=1` 可被迫出站、',
  '守数量无上限。这些都需要产品级决策（workdir 该不该限制到某个根），单独立项。',
  '',
  '### 证据',
  '```',
  'node --test → 355/355（新增：跨站 403 / __proto__ 被拒 / repo 拒绝 ..）',
  '实测：__proto__ → {"ok":false}，({}).enabled = undefined，正常 id 照旧',
  '```',
  '',
].join('\n')

writeFileSync(p, s.slice(0, anchor) + entry + s.slice(anchor))
console.log('CHANGELOG 0.9.206 已写')
