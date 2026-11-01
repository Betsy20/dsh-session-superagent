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
