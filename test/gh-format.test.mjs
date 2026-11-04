// Gitee / GitHub 错误文本分类的单元测试：只测纯函数 classifyGhError，不联网。
//
// 为什么单独一个文件：Gitee 的报错**没有** `HTTP <code>` 前缀，形状和 GitHub 完全不同，
// 而 classifyGhError 原来是照着 GitHub 的形状写的 —— 于是 Gitee 的 404 / 401 / 429
// 全落到 other，客户看到「没归类的错误」，根本想不到是标签名写错了。
//
// 真实响应（2026-11-05 本机 curl 复刻，可原样重放）：
//   $ curl -sS -o /dev/null -w 'HTTP %{http_code} | %{size_download} bytes | %{content_type}\n' \
//       https://gitee.com/MYCF711/workbuddy-pro/labels/__no_such__
//   HTTP 404 | 7187 bytes | text/html; charset=utf-8
//     <title>你所访问的页面不存在 (404)</title>
//     <h3>你所访问的页面不存在！</h3>
//   $ curl -sS https://gitee.com/api/v5/repos/MYCF711/workbuddy-pro/labels/__no_such__
//   HTTP 404 | 27 bytes | {"message":"404 Not Found"}
//   同一天另一个接口回的正文是 {"message":"Not Found Project"}（31 bytes）
//   token 失效：HTTP 401 | {"message":"401 Unauthorized: Access token does not exist"}
//   限流：      HTTP 429（只有状态行，没有正文）
import assert from 'node:assert/strict'
import test from 'node:test'

import { classifyGhError } from '../lib/gh-format.js'

// 真实 Gitee 404 页的骨架（原页 7187 字节，这里只留分类要用的那几行，其余是 CSS / JS / 页脚）。
const GITEE_HTML_404 = [
  '<!DOCTYPE html>',
  '<html>',
  '',
  '<head>',
  '  <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />',
  '  <title>你所访问的页面不存在 (404)</title>',
  '</head>',
  '',
  '<body>',
  '  <div class="container error midCenter">',
  '    <div class="image-box"><img src="/static/errors/images/404.png"></div>',
  '    <h3>你所访问的页面不存在！</h3>',
  '    <p>资源不存在或者没有访问权限，<a href="/">点击这里</a>返回首页</p>',
  '  </div>',
  '</body>',
  '</html>',
].join('\n')

/** Gitee 的「标签/仓库/编号不存在」必须三个词都说到，否则客户还是不知道该去改哪。 */
function assertGiteeNotFound(why, label) {
  assert.equal(why.kind, 'notfound', label + ' 应归 notfound，实际 ' + why.kind + '（' + why.hint + '）')
  assert.match(why.hint, /Gitee/, label + ' 的提示要点名 Gitee：' + why.hint)
  for (const word of ['标签', '仓库', '编号']) {
    assert.ok(why.hint.includes(word), label + ' 的提示要提到「' + word + '」：' + why.hint)
  }
  assert.ok(why.hint.includes('不存在'), label + ' 的提示要说清是「不存在」：' + why.hint)
  assert.ok(why.short.length > 0, label + ' 缺可读描述')
}

test('Gitee 404 的 HTML 页：标签不存在要归 notfound，而不是「没归类」', () => {
  // 改之前这条是红的：整段 HTML 里既没有 `HTTP 404` 也没有 `Not Found`（只有「404」和「页面不存在」），
  // 于是命中文件末尾的兜底 → kind: 'other'，客户看到「（没归类的错误…）」。
  const why = classifyGhError(GITEE_HTML_404)
  assertGiteeNotFound(why, 'Gitee HTML 404 页')
})

test('Gitee 404 的 JSON 正文：Not Found Project 也要指向标签/仓库/编号', () => {
  const shapes = [
    '{"message":"Not Found Project"}',
    '{"message":"404 Not Found"}',
    // 真机把状态行、字节数、正文拼成一行时也要认（curl -w 那种输出）
    'HTTP 404 | 31 bytes | {"message":"Not Found Project"}',
    'HTTP 404 | 27 bytes | {"message":"404 Not Found"}',
  ]
  for (const text of shapes) {
    const why = classifyGhError(text)
    assertGiteeNotFound(why, text)
  }
})

test('Gitee 401：Access token does not exist 要归 auth，并指向 Gitee 私人令牌', () => {
  const shapes = [
    '{"message":"401 Unauthorized: Access token does not exist"}',
    'HTTP 401 | 65 bytes | {"message":"401 Unauthorized: Access token does not exist"}',
  ]
  for (const text of shapes) {
    const why = classifyGhError(text)
    assert.equal(why.kind, 'auth', text + ' 应归 auth，实际 ' + why.kind)
    assert.match(why.hint, /Gitee/, text + ' 的提示要点名 Gitee：' + why.hint)
    assert.ok(why.hint.includes('私人令牌'), text + ' 的提示要指向「Gitee 私人令牌」：' + why.hint)
  }
})

test('Gitee 429：只有状态行也要归 ratelimit（不是「没归类」）', () => {
  for (const text of ['HTTP 429', 'HTTP 429 | 0 bytes', '429 Too Many Requests']) {
    const why = classifyGhError(text)
    assert.equal(why.kind, 'ratelimit', text + ' 应归 ratelimit，实际 ' + why.kind)
    assert.ok(why.hint.length > 0, text + ' 缺下一步')
    assert.match(why.hint, /等/, text + ' 的提示要告诉客户「等」：' + why.hint)
  }
})

test('GitHub 的报错不能被 Gitee 规则抢走（措辞边界）', () => {
  // 401：GitHub 的正文是 Bad credentials，不是 401 Unauthorized
  const auth = classifyGhError('HTTP 401: Bad credentials')
  assert.equal(auth.kind, 'auth')
  assert.ok(auth.hint.includes('gh auth login'), 'GitHub 401 仍要指向 gh auth login：' + auth.hint)

  // 404：GitHub 的正文是 Not Found（没有 Project / 没有前缀 404）
  for (const text of ['HTTP 404: Not Found', '{"message":"Not Found"}']) {
    const why = classifyGhError(text)
    assert.equal(why.kind, 'notfound', text + ' → ' + why.kind)
    assert.ok(why.hint.includes('owner/name'), 'GitHub 404 仍要指向 owner/name：' + why.hint)
    assert.ok(!why.hint.includes('Gitee'), 'GitHub 的 404 不该提 Gitee：' + why.hint)
  }

  // 这几条老分类完全不变
  assert.equal(classifyGhError('gh: command not found').kind, 'nogh')
  assert.equal(classifyGhError('HTTP 403: API rate limit exceeded').kind, 'ratelimit')
  assert.equal(classifyGhError('HTTP 502 Bad Gateway').kind, 'gateway')
  assert.equal(classifyGhError('HTTP 304 Not Modified').kind, 'notmodified')
  assert.equal(classifyGhError('Repository has been moved').kind, 'moved')
  assert.equal(classifyGhError('Get "https://api.github.com/repos/a/b/issues?per_page=20": EOF').kind, 'network')
})
