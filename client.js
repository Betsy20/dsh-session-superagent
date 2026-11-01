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
    const { useCallback, useEffect, useState } = React

    const BASE = '/session-superagent'
    const ENDPOINT = BASE + '/state'
    const POLL_MS = 5000

    async function call(path, options) {
      const res = await fetch(BASE + path, {
        ...(options || {}),
        headers: { 'content-type': 'application/json', accept: 'application/json', ...((options && options.headers) || {}) },
      })
      const text = await res.text()
      let body = null
      try { body = text ? JSON.parse(text) : null } catch { body = { raw: text } }
      if (!res.ok) throw new Error((body && body.error) || ('HTTP ' + res.status))
      return body
    }

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
      card: { border: '1px solid rgba(128,128,128,.25)', borderRadius: 8, padding: '12px 14px', marginBottom: 14 },
      cardTitle: { fontWeight: 600, margin: '0 0 8px' },
      field: { display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' },
      label: { minWidth: 72, opacity: 0.75 },
      input: { flex: 1, minWidth: 180, padding: '5px 8px', borderRadius: 6, border: '1px solid rgba(128,128,128,.4)', background: 'transparent', color: 'inherit', font: 'inherit' },
      button: { padding: '5px 12px', borderRadius: 6, border: '1px solid rgba(128,128,128,.5)', background: 'rgba(128,128,128,.12)', color: 'inherit', cursor: 'pointer' },
      ok: { color: '#1a7f37', fontSize: 12 },
    }

    const short = (value, width = 19) => (typeof value === 'string' && value.length > width ? value.slice(0, width - 1) + '…' : (value ?? '—'))
    const when = (iso) => (typeof iso === 'string' ? iso.replace('T', ' ').replace('Z', '').slice(5, 19) : '—')

    // ── orbit badge: session header indicator ──────────────────────────────
    // Static geometry, three states: green dot orbiting (watching), amber dot on
    // a dashed ring (paused), red dot breathing (error). Icon only — the text
    // lives in the native tooltip so it does not compete with the session title.
    const ORBIT_CSS_ID = 'session-superagent-orbit-css'
    const ORBIT_CSS = `
      @keyframes sa-orbit-spin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }
      @keyframes sa-orbit-breathe { 0%,100% { opacity: 1 } 50% { opacity: .35 } }
      .sa-orbit-dot-spin { transform-origin: 8px 8px; animation: sa-orbit-spin 3s linear infinite }
      .sa-orbit-dot-breathe { animation: sa-orbit-breathe 1.6s ease-in-out infinite }
    `
    function ensureOrbitCss() {
      try {
        if (document.getElementById(ORBIT_CSS_ID)) return
        const style = document.createElement('style')
        style.id = ORBIT_CSS_ID
        style.textContent = ORBIT_CSS
        document.head.appendChild(style)
      } catch {}
    }

    function orbitState(w) {
      if (!w) return null
      if (w.lastError) return 'error'
      return w.enabled ? 'active' : 'paused'
    }

    function OrbitIcon(props) {
      ensureOrbitCss()
      const color = props.state === 'active' ? '#3fb950' : props.state === 'paused' ? '#d29922' : '#f85149'
      const dot = h('circle', {
        cx: 8, cy: 2.4, r: 2.05, fill: color,
        className: props.state === 'active' ? 'sa-orbit-dot-spin' : (props.state === 'error' ? 'sa-orbit-dot-breathe' : undefined),
        style: props.state === 'active' ? { transformOrigin: '8px 8px' } : undefined,
      })
      const ring = props.state === 'paused'
        ? h('circle', { cx: 8, cy: 8, r: 6.1, fill: 'none', stroke: color, strokeWidth: 1.1, strokeDasharray: '2.2 1.9', opacity: 0.9 })
        : h('circle', { cx: 8, cy: 8, r: 6.1, fill: 'none', stroke: color, strokeWidth: 1.1, opacity: 0.9 })
      return h('svg', { width: 16, height: 16, viewBox: '0 0 16 16', 'aria-hidden': 'true' }, ring, dot)
    }

    const notedOnce = new Set()
    /** Diagnostics: write once per page load, never on every poll. */
    function noteOnce(key, value) {
      if (notedOnce.has(key)) return
      notedOnce.add(key)
      note(key, value)
    }

    function note(key, value) {
      try { fetch(BASE + '/client-note?key=' + encodeURIComponent(key) + '&value=' + encodeURIComponent(String(value || ''))).catch(() => {}) } catch {}
    }

    function OrbitBadge(props) {
      const sessionId = props && props.sessionId
      const [watcher, setWatcher] = useState(undefined) // undefined = loading, null = none

      useEffect(() => { note('badge-mount', String(sessionId || 'NO-SESSIONID')) }, [])

      useEffect(() => {
        let alive = true
        const load = async () => {
          try {
            const body = await call('/state' + (sessionId ? '?sessionId=' + encodeURIComponent(sessionId) : ''))
            const mine = (body.watchers || []).find((w) => w.sessionId === sessionId) || null
            noteOnce('badge-state', (mine ? ('found:' + mine.repo) : ('none:' + (body.watchers || []).length + ':' + String(sessionId || '').slice(0, 20))))
            if (alive) setWatcher(mine)
          } catch {
            if (alive) setWatcher(null)
          }
        }
        load()
        const timer = setInterval(load, 5000)
        return () => { alive = false; clearInterval(timer) }
      }, [sessionId])

      if (!watcher) return null
      const state = orbitState(watcher)
      const age = (iso) => {
        if (typeof iso !== 'string') return '—'
        const ms = Date.now() - Date.parse(iso)
        if (!isFinite(ms) || ms < 0) return '—'
        const s = Math.round(ms / 1000)
        if (s < 90) return s + ' 秒前'
        if (s < 5400) return Math.round(s / 60) + ' 分钟前'
        return Math.round(s / 3600) + ' 小时前'
      }
      // Match the session list's native tooltip shape: name line, relative
      // time line, state line. Nothing else — the panel carries the details.
      const statusText = state === 'active' ? '值守中' : state === 'paused' ? '已暂停' : '有错误'
      const lines = [
        watcher.repo,
        '每 ' + watcher.intervalSec + 's · 上次轮询 ' + age(watcher.lastPoll),
        statusText + (watcher.lastError ? '（' + String(watcher.lastError).slice(0, 60) + '）' : ''),
      ]

      return h('button', {
        type: 'button',
        title: lines.join('\n'),
        'aria-label': 'superagent 值守状态',
        onClick: () => {
          try { window.dispatchEvent(new CustomEvent('session-superagent:open-desk')) } catch {}
        },
        style: {
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          width: 24, height: 24, padding: 0, margin: '0 2px',
          border: 'none', borderRadius: 6, background: 'transparent', cursor: 'pointer', color: 'inherit',
        },
      }, h(OrbitIcon, { state }))
    }

    function Field(props) {
      return h('div', { style: S.field },
        h('span', { style: S.label }, props.label),
        h('input', {
          style: S.input,
          value: props.value,
          placeholder: props.placeholder,
          type: props.type || 'text',
          onChange: (e) => props.onChange(e.target.value),
        }),
        props.children)
    }

    function DutyDesk(props) {
      const sessionId = props && props.sessionId
      const [snapshot, setSnapshot] = useState({ loading: true, body: null, error: null })
      const [form, setForm] = useState({ repo: '', intervalSec: '60', goal: '' })
      const [token, setToken] = useState('')
      const [sshKeyPath, setSshKeyPath] = useState('')
      const [notice, setNotice] = useState(null)
      const [goalDraft, setGoalDraft] = useState('')
      const [goalTouched, setGoalTouched] = useState(false)

      const load = useCallback(async () => {
        try {
          const body = await call('/state' + (sessionId ? '?sessionId=' + encodeURIComponent(sessionId) : ''))
          setSnapshot({ loading: false, body, error: null })
          // Live sync: whatever the user typed in /goal or the agent set through
          // create_goal/update_goal lands here and refreshes the editor — unless
          // the operator is mid-edit.
          setGoalTouched((touched) => {
            if (!touched) setGoalDraft(body.sessionGoal && body.sessionGoal.objective ? body.sessionGoal.objective : '')
            return touched
          })
        } catch (error) {
          setSnapshot({ loading: false, body: null, error: String((error && error.message) || error) })
        }
      }, [sessionId])

      useEffect(() => {
        load()
        const timer = setInterval(load, POLL_MS)
        return () => clearInterval(timer)
      }, [load])

      useEffect(() => {
        const onOpen = () => { try { props && props.onOpen && props.onOpen() } catch {} }
        window.addEventListener('session-superagent:open-desk', onOpen)
        return () => window.removeEventListener('session-superagent:open-desk', onOpen)
      }, [props])

      const watchers = (snapshot.body && snapshot.body.watchers) || []
      const creds = (snapshot.body && snapshot.body.credentials) || { token: 'none', sshKeyPath: 'none' }
      const active = watchers.filter((w) => w.enabled).length

      const addWatcher = async () => {
        setNotice(null)
        try {
          await call('/watch', {
            method: 'POST',
            body: JSON.stringify({
              repo: form.repo.trim(),
              intervalSec: Number(form.intervalSec) || 60,
              goal: form.goal,
              sessionId,
            }),
          })
          setForm({ repo: '', intervalSec: form.intervalSec, goal: '' })
          setNotice({ ok: true, text: '已添加，30 秒内开始轮询' })
          load()
        } catch (error) {
          setNotice({ ok: false, text: String((error && error.message) || error) })
        }
      }

      const saveCredentials = async () => {
        setNotice(null)
        try {
          const payload = {}
          if (token.trim() !== '') payload.token = token.trim()
          if (sshKeyPath.trim() !== '') payload.sshKeyPath = sshKeyPath.trim()
          if (!Object.keys(payload).length) { setNotice({ ok: false, text: '没有要保存的内容' }); return }
          await call('/credentials', { method: 'POST', body: JSON.stringify(payload) })
          setToken('')
          setSshKeyPath('')
          setNotice({ ok: true, text: '凭证已保存：仅服务端持有，不会回显' })
          load()
        } catch (error) {
          setNotice({ ok: false, text: String((error && error.message) || error) })
        }
      }

      const saveGoal = async (objective) => {
        setNotice(null)
        try {
          await call('/goal', { method: 'POST', body: JSON.stringify({ sessionId, objective }) })
          setGoalTouched(false)
          setNotice({ ok: true, text: objective ? '已写入会话 goal（与 /goal 同一处状态）' : '已清除会话 goal' })
          load()
        } catch (error) {
          setNotice({ ok: false, text: String((error && error.message) || error) })
        }
      }

      const sessionGoal = snapshot.body && snapshot.body.sessionGoal

      return h('div', { style: S.wrap },
        h('h3', { style: S.title }, '值守台'),
        h('p', { style: S.sub },
          snapshot.loading ? '读取中…'
            : snapshot.error ? ('读取失败：' + snapshot.error)
              : (active + ' 个值守运行中 · 共 ' + watchers.length + ' 条 · 每 ' + (POLL_MS / 1000) + 's 刷新')),

        notice && h('div', { style: notice.ok ? S.ok : S.err }, notice.text),

        h('div', { style: S.card },
          h('p', { style: S.cardTitle }, '会话 goal'),
          h('div', { style: { ...S.mono, marginBottom: 4, opacity: 0.85 } },
            '会话：' + ((snapshot.body && snapshot.body.sessionTitle) || short(sessionId || ''))),
          h('div', { style: { ...S.mono, marginBottom: 8, opacity: 0.75 } },
            sessionGoal
              ? ('当前：' + (sessionGoal.phase || '?') + ' · revision ' + (sessionGoal.revision ?? '-'))
              : '当前无 goal'),
          h('textarea', {
            style: { ...S.input, minHeight: 64, width: '100%', boxSizing: 'border-box', marginBottom: 8 },
            value: goalDraft,
            placeholder: '本会话要达成的目标（写入后等同于 /goal …）',
            onChange: (e) => { setGoalTouched(true); setGoalDraft(e.target.value) },
          }),
          h('button', {
            style: S.button,
            disabled: !sessionId,
            onClick: () => saveGoal(goalDraft.trim()),
          }, '保存为会话 goal'),
          h('span', { style: { width: 8 } }),
          h('button', {
            style: S.button,
            disabled: !sessionId || !sessionGoal,
            onClick: () => { setGoalDraft(''); saveGoal('') },
          }, '清除'),
          h('div', { style: { ...S.sub, marginTop: 6 } },
            '与 /goal 命令、create_goal 工具共用同一份状态；任一方修改，这里 5 秒内同步。')),

        h('div', { style: S.card },
          h('p', { style: S.cardTitle }, '凭证'),
          h('div', { style: { ...S.mono, marginBottom: 6 } },
            'GitHub token：' + (creds.token === 'configured'
              ? ('已配置 ' + (creds.tokenHint || ''))
              : '未配置（回退到已登录的 gh CLI）')),
          h('div', { style: { ...S.mono, marginBottom: 10 } },
            'SSH 私钥：' + (creds.sshKeyPath === 'configured'
              ? ('已配置 ' + (creds.sshKeyHint || ''))
              : '未配置')),
          h(Field, { label: 'Token', value: token, onChange: setToken, type: 'password', placeholder: 'ghp_… 或 github_pat_…（留空不改）' }),
          h(Field, { label: 'SSH 私钥', value: sshKeyPath, onChange: setSshKeyPath, placeholder: 'D:\keys\id_ed25519（绝对路径，留空不改）' }),
          h('button', { style: S.button, onClick: saveCredentials }, '保存凭证')),

        h('div', { style: S.card },
          h('p', { style: S.cardTitle }, '新增值守'),
          h(Field, { label: '仓库', value: form.repo, onChange: (v) => setForm({ ...form, repo: v }), placeholder: 'owner/name' }),
          h(Field, { label: '间隔(秒)', value: form.intervalSec, onChange: (v) => setForm({ ...form, intervalSec: v }), placeholder: '60' }),
          h(Field, { label: '目标/规则', value: form.goal, onChange: (v) => setForm({ ...form, goal: v }), placeholder: '可选，会附在唤醒消息里' }),
          h('button', {
            style: S.button,
            onClick: addWatcher,
            disabled: !sessionId || !form.repo.trim(),
          }, sessionId ? '添加到当前会话' : '需要会话上下文'),
          h('div', { style: { ...S.sub, marginTop: 6 } }, '唤醒目标 = 当前打开面板的这个会话。')),

        watchers.length > 0 && h('div', { style: { ...S.row, ...S.head } },
          h('span', null, '仓库'), h('span', null, '会话'), h('span', null, '间隔'),
          h('span', null, '上次轮询'), h('span', null, '上次唤醒'), h('span', null, '状态')),

        watchers.map((w) => h('div', { key: w.repo + '#' + w.sessionId, style: S.row },
          h('span', { style: S.mono }, w.repo),
          h('span', { style: S.mono, display: 'flex', gap: 6, alignItems: 'center' },
            h('span', {
              title: w.sessionId,
              style: { width: 7, height: 7, borderRadius: '50%', flex: 'none',
                background: w.lastError ? '#cf222e' : (w.enabled ? '#1a7f37' : '#9a6700') },
            }),
            h('span', { title: w.sessionId }, w.title || short(w.sessionId))),
          h('span', null, w.intervalSec + 's'),
          h('span', { style: S.mono }, when(w.lastPoll)),
          h('span', { style: S.mono }, typeof w.lastWake === 'string' && w.lastWake.startsWith('failed') ? '失败' : when(w.lastWake)),
          h('span', { style: w.enabled ? S.badgeOn : S.badgeOff }, w.enabled ? '运行中' : '已暂停'))),

        watchers.some((w) => w.goal) && h('div', { style: { marginTop: 10 } },
          ...watchers.filter((w) => w.goal).map((w) =>
            h('div', { key: 'goal-' + w.repo, style: { ...S.mono, opacity: 0.7 } }, w.repo + ': ' + w.goal))),

        watchers.some((w) => w.lastError) && h('div', { style: { marginTop: 10 } },
          ...watchers.filter((w) => w.lastError).map((w) =>
            h('div', { key: 'err-' + w.repo, style: S.err }, w.repo + ': ' + w.lastError))),

        !snapshot.loading && watchers.length === 0 && h('div', { style: S.empty },
          '还没有值守。上面填仓库名点“添加”，或在会话里说 watch_start({ repo: "owner/name" })。'),

        h('p', { style: S.foot }, '凭证只存在服务端并在调用时使用；本页只显示是否已配置，永不回显明文。'))
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        try { note('apply', 'start') } catch {}
        try { fetch(BASE + '/client-hello').catch(() => {}) } catch {}

        // ① the 值守台 tab in the centre-column view ring
        ctx.effect(() => {
          try {
            return ctx.slots.inject('conversation.view', () => {
              const dispose = ctx.slots.register({
                name: 'conversation.view',
                id: 'session-superagent-desk',
                order: 30,
                label: '值守台',
              }, DutyDesk)
              note('desk-registered', 'ok')
              return dispose
            })
          } catch (error) {
            note('desk-fail', String((error && error.message) || error))
            return undefined
          }
        })

        // ② the orbit badge in the session header
        ctx.effect(() => {
          try {
            return ctx.slots.inject('conversation.session.header.actions', () => {
              const dispose = ctx.slots.register({
                name: 'conversation.session.header.actions',
                id: 'session-superagent-badge',
                order: 5,
              }, OrbitBadge)
              note('badge-registered', 'ok')
              return dispose
            })
          } catch (error) {
            note('badge-fail', String((error && error.message) || error))
            return undefined
          }
        })

        note('apply', 'done')
      },
    }
  },
})
