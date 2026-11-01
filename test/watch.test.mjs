import test from 'node:test'
import assert from 'node:assert/strict'

import { advanceSeen, decideWake, formatWatchText, newestUpdatedAt, partitionItems, recordReported, splitFresh } from '../lib/watch.js'

const item = (number, updatedAt) => ({ number, updated_at: updatedAt, state: 'open', title: `t${number}`, html_url: `https://x/${number}`, user: { login: 'me' } })

test('empty state reports every item as news', () => {
  const items = [item(1, '2026-01-01T00:00:00Z'), item(2, '2026-01-02T00:00:00Z')]
  assert.equal(splitFresh(items, {}).length, 2)
})

test('per-item watermark suppresses the item it already reported', () => {
  const items = [item(2, '2026-01-02T00:00:00Z')]
  const state = { seen: { 2: '2026-01-02T00:00:00Z' } }
  assert.equal(splitFresh(items, state).length, 0, 'the same updated_at is not news')
})

test('a newer update on a seen item is news again', () => {
  const items = [item(2, '2026-01-03T00:00:00Z')]
  const state = { seen: { 2: '2026-01-02T00:00:00Z' } }
  assert.equal(splitFresh(items, state).length, 1)
})

test('the global cursor only floors never-seen items', () => {
  const items = [item(5, '2026-01-05T00:00:00Z')]
  assert.equal(splitFresh(items, { cursor: '2026-01-06T00:00:00Z' }).length, 0)
  assert.equal(splitFresh(items, { cursor: '2026-01-04T00:00:00Z' }).length, 1)
})

test('advanceSeen records each reported item and keeps old keys', () => {
  const next = advanceSeen({ 1: 'a' }, [item(2, 'b'), item(3, 'c')])
  assert.deepEqual(next, { 1: 'a', 2: 'b', 3: 'c' })
})

test('decideWake refuses a running agent and allows an idle one', () => {
  assert.equal(decideWake('running').ok, false)
  assert.match(decideWake('running').reason, /busy/)
  assert.equal(decideWake('idle').ok, true)
  assert.equal(decideWake(undefined).ok, true, 'unknown status is not a blocker')
})

test('formatWatchText is stable and greppable', () => {
  const text = formatWatchText('o/r', [item(7, '2026-01-07T00:00:00Z')])
  assert.match(text, /^【watch】o\/r 有 1 条新动态：/)
  assert.match(text, /#7 \[open\] t7 — @me \(issue\) https:\/\/x\/7/)
  assert.match(text, /不要扩大范围/)
})

test('newestUpdatedAt picks the newest timestamp', () => {
  const fresh = [item(1, '2026-01-01T00:00:00Z'), item(2, '2026-03-01T00:00:00Z')]
  assert.equal(newestUpdatedAt(fresh), '2026-03-01T00:00:00Z')
  assert.equal(newestUpdatedAt([]), null)
})

test('cooldown suppresses the churn that follows our own handling', () => {
  const now = Date.parse('2026-01-01T00:00:30Z')
  const items = [item(9, '2026-01-01T00:00:20Z')]
  const state = { seen: { 9: '2026-01-01T00:00:10Z' }, lastReported: { 9: now - 20_000 } }
  assert.equal(splitFresh(items, state, { now, cooldownMs: 180_000 }).length, 0)
})

test('after the cooldown a new update is reported again', () => {
  const now = Date.parse('2026-01-01T00:10:00Z')
  const items = [item(9, '2026-01-01T00:09:50Z')]
  const state = { seen: { 9: '2026-01-01T00:09:40Z' }, lastReported: { 9: now - 200_000 } }
  assert.equal(splitFresh(items, state, { now, cooldownMs: 180_000 }).length, 1)
})

test('recordReported stamps every reported item', () => {
  const now = 1_700_000_000_000
  const next = recordReported({ lastReported: { 1: 5 } }, [item(2, 'x')], now)
  assert.deepEqual(next, { 1: 5, 2: now })
})

test('partitionItems absorbs our own bump instead of delaying it', () => {
  const now = Date.parse('2026-01-01T00:00:30Z')
  const items = [item(9, '2026-01-01T00:00:20Z')]
  const state = { seen: { 9: '2026-01-01T00:00:10Z' }, lastReported: { 9: now - 20_000 } }
  const { fresh, absorbed } = partitionItems(items, state, { now, cooldownMs: 180_000 })
  assert.equal(fresh.length, 0)
  assert.equal(absorbed.length, 1)
})

test('absorbed bumps never resurface once the cooldown is over', () => {
  const t0 = Date.parse('2026-01-01T00:00:30Z')
  const items = [item(9, '2026-01-01T00:00:20Z')]
  let state = { seen: { 9: '2026-01-01T00:00:10Z' }, lastReported: { 9: t0 - 20_000 } }
  const first = partitionItems(items, state, { now: t0, cooldownMs: 180_000 })
  state = { ...state, seen: advanceSeen(state.seen, first.absorbed) }
  const later = partitionItems(items, { ...state, lastReported: {} }, { now: t0 + 600_000, cooldownMs: 180_000 })
  assert.equal(later.fresh.length, 0, 'watermark already covered it')
  assert.equal(later.absorbed.length, 0)
})
