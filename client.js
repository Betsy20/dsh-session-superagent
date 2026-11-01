/**
 * dsh-session-superagent — browser half.
 *
 * Registers one list entry into `conversation.view` (the centre-column view
 * ring: chat / trajectory / waterfall live there), so the panel appears as a
 * tab beside them. It reads the read-only host route the server half
 * registers; no credential ever crosses this boundary.
 */
window.__ModuleLoader__.load({
  id: 'dsh-session-superagent',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useEffect, useState } = React

    const ENDPOINT = '/session-superagent/state'
    const POLL_MS = 5000

    const S = {
      wrap: { padding: '16px 20px', font: '13px/1.5 system-ui, sans-serif', height: '100%', overflow: 'auto' },
      title: { fontSize: 15, fontWeight: 600, margin: '0 0 4px' },
      sub: { opacity: 0.65, margin: '0 0 14px' },
      row: { display: 'grid', gridTemplateColumns: '1.4fr 1fr 70px 1.2fr 1.2fr 70px', gap: 10, padding: '7px 0', borderBottom: '1px solid rgba(128,128,128,.18)' },
      head: { fontWeight: 600, opacity: 0.7, borderBottom: '1px solid rgba(128,128,128,.35)' },
      mono: { fontFamily: 'ui-monospace, Consolas, monospace', fontSize: 12 },
      badgeOn: { color: '#1a7f37' },
      badgeOff: { color: '#9a6700' },
      err: { color: '#cf222e', fontSize: 12 },
      empty: { opacity: 0.6, marginTop: 12 },
      foot: { marginTop: 14, opacity: 0.55, fontSize: 12 },
    }

    const short = (value, width = 19) => (typeof value === 'string' && value.length > width ? value.slice(0, width - 1) + '…' : (value ?? '—'))
    const when = (iso) => (typeof iso === 'string' ? iso.replace('T', ' ').replace('Z', '').slice(5, 19) : '—')

    function DutyDesk() {
      const [snapshot, setSnapshot] = useState({ loading: true, body: null, error: null })

      useEffect(() => {
        let alive = true
        const load = async () => {
          try {
            const res = await fetch(ENDPOINT, { headers: { accept: 'application/json' } })
            if (!res.ok) throw new Error(`HTTP ${res.status}`)
            const body = await res.json()
            if (alive) setSnapshot({ loading: false, body, error: null })
          } catch (error) {
            if (alive) setSnapshot({ loading: false, body: null, error: String(error?.message ?? error) })
          }
        }
        load()
        const timer = setInterval(load, POLL_MS)
        return () => { alive = false; clearInterval(timer) }
      }, [])

      const watchers = snapshot.body?.watchers ?? []
      const active = watchers.filter((w) => w.enabled).length

      return h('div', { style: S.wrap },
        h('h3', { style: S.title }, '值守台'),
        h('p', { style: S.sub },
          snapshot.loading
            ? '读取中…'
            : snapshot.error
              ? `读取失败：${snapshot.error}`
              : `${active} 个值守运行中 · 共 ${watchers.length} 条 · 每 ${POLL_MS / 1000}s 刷新`),

        watchers.length > 0 && h('div', { style: { ...S.row, ...S.head } },
          h('span', null, '仓库'),
          h('span', null, '会话'),
          h('span', null, '间隔'),
          h('span', null, '上次轮询'),
          h('span', null, '上次唤醒'),
          h('span', null, '状态')),

        watchers.map((w) => h('div', { key: `${w.repo}#${w.sessionId}`, style: S.row },
          h('span', { style: S.mono }, w.repo),
          h('span', { style: S.mono }, short(w.sessionId)),
          h('span', null, `${w.intervalSec}s`),
          h('span', { style: S.mono }, when(w.lastPoll)),
          h('span', { style: S.mono }, typeof w.lastWake === 'string' && w.lastWake.startsWith('failed') ? '失败' : when(w.lastWake)),
          h('span', { style: w.enabled ? S.badgeOn : S.badgeOff }, w.enabled ? '运行中' : '已暂停'))),

        watchers.some((w) => w.lastError) &&
          h('div', { style: { marginTop: 10 } },
            ...watchers.filter((w) => w.lastError).map((w) =>
              h('div', { key: `err-${w.repo}`, style: S.err }, `${w.repo}: ${w.lastError}`))),

        !snapshot.loading && watchers.length === 0 &&
          h('div', { style: S.empty }, '还没有值守。回到会话里说一句：watch_start({ repo: "owner/name" })'),

        h('p', { style: S.foot }, '只读面板：凭据留在插件内，本页从不接收 token。'))
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.effect(() => ctx.slots.inject('conversation.view', () => ctx.slots.register({
          name: 'conversation.view',
          id: 'session-superagent-desk',
          order: 50,
          label: '值守台',
        }, DutyDesk)))
      },
    }
  },
})
