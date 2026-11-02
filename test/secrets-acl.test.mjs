// Node 文档写得很清楚：Windows 上 chmod 只改写权限，owner/group/others 的区分根本没实现
// （https://nodejs.org/api/fs.html 的 fs.chmod Caveats）。
// 也就是说 mode: 0o600 在 Windows 上保护不了 token —— 这条用例验我们补的 icacls。
import { execFileSync } from 'node:child_process'
import { tempDir } from './fixtures/tmpdir.mjs'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'

test('凭证文件在 Windows 上会被收紧到「只有当前用户」', { skip: process.platform !== 'win32' }, async () => {
  const { __test } = await import('../lib/index.js')
  const dir = tempDir('zhuli-acl-')
  const file = join(dir, 'secrets.json')
  try {
    writeFileSync(file, '{"token":"x"}')
    const mode = __test.hardenSecretsFile(file)
    assert.equal(mode, 'win32-acl', '应当走 icacls 路径')
    // GBK 输出：用 iconv 太麻烦，这里只做字节层面的判断
    const out = execFileSync('icacls', [file], { encoding: 'buffer' }).toString('latin1')
    assert.ok(!/Users/i.test(out) || !/BUILTIN/.test(out.replace(/Administrators/gi, '')), '不应保留 Users 组：' + out.slice(0, 200))
    assert.match(out, /\(F\)/, '当前用户必须有完全控制')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
