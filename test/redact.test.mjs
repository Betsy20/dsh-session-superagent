import test from 'node:test'
import assert from 'node:assert/strict'

import { hasSecret, redact } from '../lib/redact.js'

test('redacts a classic PAT', () => {
  const out = redact('token=ghp_abcdefghijklmnopqrstuvwxyz0123456789 done')
  assert.equal(out, 'token=*** done')
  assert.equal(hasSecret(out), false)
})

test('redacts a fine-grained PAT', () => {
  const out = redact('github_pat_11ABCDEFG0123456789_abcdefghijklmnop')
  assert.equal(out, '***')
})

test('redacts a PEM private key block', () => {
  const pem = '-----BEGIN OPENSSH PRIVATE KEY-----\nAAAA\n-----END OPENSSH PRIVATE KEY-----'
  assert.equal(redact(`before ${pem} after`), 'before *** after')
})

test('redacts an echoed authorization header', () => {
  assert.equal(redact('Authorization: Bearer abc.def.ghi'), '***')
  assert.equal(redact('authorization: token ghp_abcdefghijklmnopqrstuvwxyz0123456789'), '***')
})

test('leaves ordinary text untouched', () => {
  const text = 'issue #2 [open] docs/bench — @MYCF711 https://github.com/o/r/issues/2'
  assert.equal(redact(text), text)
})

test('handles null and undefined', () => {
  assert.equal(redact(null), '')
  assert.equal(redact(undefined), '')
})

test('hasSecret detects what redact removes', () => {
  assert.equal(hasSecret('ghp_abcdefghijklmnopqrstuvwxyz0123456789'), true)
  assert.equal(hasSecret('nothing to see'), false)
})

test('真实凭证形状：25 种里新增的 16 种都要脱掉（审核 M2/M3）', () => {
  // 样例串一律**运行时拼出来**：GitHub 的 push protection 会把源码里的字面量当成真凭证拦下。
  const j = (...parts) => parts.join('')
  const cases = [
    ['GitLab', j('glp', 'at-', 'abcdefghijklmnopqrstuvwxyz')],
    ['AWS', j('AK', 'IA', 'IOSFODNN7EXAMPLE')],
    ['Slack', j('xox', 'b-1234567890-abcdefghij')],
    ['Stripe', j('sk_', 'live_', 'abcdefghijklmnopqrstuvwx')],
    ['npm', j('np', 'm_', 'abcdefghijklmnopqrstuvwxyz0123456789')],
    ['Google', j('AIz', 'aSyD-abcdefghijklmnopqrstuvwxyz012345')],
    ['JWT', j('eyJhbGciOiJIUzI1NiJ9.', 'eyJzdWIiOiIxIn0.', 'abcdefghijklmnop')],
    ['DB URL', j('postgres://user:', 's3cr3t', '@localhost:5432/db')],
    ['Redis URL', j('redis://default:', 'hunter2', '@cache:6379')],
    ['裸 Bearer', j('Bearer ', 'abcdefghijklmnopqrstuvwxyz012345')],
    ['查询参数', j('https://x.example/a?access_token=', 'abcdef123456')],
    ['截断 PEM', j('-----BEGIN RSA PRIVATE KEY-----', String.fromCharCode(10), 'MIIEowIBAAKCAQEA')],
    ['PGP', j('-----BEGIN PGP PRIVATE KEY BLOCK-----', String.fromCharCode(10), 'abc', String.fromCharCode(10), '-----END PGP PRIVATE KEY BLOCK-----')],
    ['Gitee 32 位', j('gitee 私人令牌 ', '0123456789abcdef0123456789abcdef')],
  ]
  for (const [name, input] of cases) {
    assert.ok(redact(input).includes('***'), name + ' 没被脱掉：' + redact(input))
  }
})

test('不许误伤：讨论前缀 / sha / md5 都要原样保留', () => {
  const j = (...parts) => parts.join('')
  const safe = [
    j('issue 里讨论 gh', 'p_ 这个前缀'),
    j('commit ', '0123456789abcdef0123456789abcdef01234567'),
    j('md5 ', '0123456789abcdef0123456789abcdef'),
    'https://github.com/o/r/issues/42',
  ]
  for (const text of safe) {
    assert.equal(redact(text), text, '误伤了：' + text)
  }
})
