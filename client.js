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
    const { useCallback, useEffect, useRef, useState } = React

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

    // ── status orbit: composer-dock indicator ─────────────────────────────
    // One ring for the whole machine. Every satellite on the ring is one
    // session-level superagent (a live watcher): green = watching, amber =
    // paused, red = last poll failed. Icon only — details live in the
    // click-through panel, and a native tooltip carries the one-line summary.
    function orbitStateOf(w) {
      if (!w) return 'paused'
      if (w.lastError) return 'error'
      return w.enabled === false ? 'paused' : 'active'
    }

    const SAT_COLOR = { active: '#3fb950', paused: '#d29922', error: '#f85149' }
    const STATE_TEXT = { active: '值守中', paused: '已暂停', error: '异常' }

    function OrbitMark(props) {
      ensureOrbitCss()
      const watchers = props.watchers || []
      const shown = watchers.slice(0, 6)
      const states = watchers.map(orbitStateOf)
      const ringColor = states.indexOf('error') >= 0
        ? SAT_COLOR.error
        : states.indexOf('active') >= 0 ? SAT_COLOR.active : SAT_COLOR.paused
      const dashed = states.indexOf('paused') >= 0
      const dots = shown.map((w, i) => {
        const angle = (i / Math.max(shown.length, 1)) * Math.PI * 2 - Math.PI / 2
        const state = orbitStateOf(w)
        return h('circle', {
          key: String(w.repo || '') + '#' + String(w.sessionId || i),
          cx: 8 + Math.cos(angle) * 6.1,
          cy: 8 + Math.sin(angle) * 6.1,
          r: shown.length > 3 ? 1.75 : 2.05,
          fill: SAT_COLOR[state],
          className: state === 'error' ? 'sa-orbit-dot-breathe' : undefined,
        })
      })
      return h('svg', { width: 16, height: 16, viewBox: '0 0 16 16', 'aria-hidden': 'true' },
        h('circle', {
          cx: 8, cy: 8, r: 6.1, fill: 'none', stroke: ringColor, strokeWidth: 1.1,
          strokeDasharray: dashed ? '2.2 1.9' : undefined, opacity: 0.9,
        }),
        h('g', { className: states.indexOf('active') >= 0 ? 'sa-sat-spin' : undefined }, ...dots))
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

    /** 8-char session tag. Titles come from the title model and several sessions
     *  can share one, so every row carries the id suffix to stay unambiguous. */
    const sessionTag = (id) => {
      const raw = String(id || '')
      const core = raw.indexOf('session-') === 0 ? raw.slice(8) : raw
      return core.slice(0, 8) || '—'
    }

    const ageText = (iso) => {
      if (typeof iso !== 'string') return '—'
      const ms = Date.now() - Date.parse(iso)
      if (!isFinite(ms) || ms < 0) return '—'
      const s = Math.round(ms / 1000)
      if (s < 90) return s + ' 秒前'
      if (s < 5400) return Math.round(s / 60) + ' 分钟前'
      return Math.round(s / 3600) + ' 小时前'
    }
    const wakeText = (value) => {
      if (typeof value !== 'string' || value === '') return '—'
      if (value.indexOf('failed') === 0) return '失败'
      return ageText(value)
    }

    const PANEL_W = 344
    const BORDER = '1px solid var(--dsw-alias-border-l2, rgba(128,128,128,.22))'

    /** Dock entry: the machine-wide ring plus its click-through detail list. */
    function StatusOrbit() {
      const [watchers, setWatchers] = useState(null)
      const [open, setOpen] = useState(false)
      const [anchor, setAnchor] = useState(null)
      const btnRef = useRef(null)
      const panelRef = useRef(null)

      useEffect(() => {
        let alive = true
        noteOnce('orbit-mount', 'ok')
        const load = async () => {
          try {
            const body = await call('/state')
            if (alive) setWatchers(Array.isArray(body && body.watchers) ? body.watchers : [])
          } catch {
            if (alive) setWatchers((prev) => (prev === null ? [] : prev))
          }
        }
        load()
        const timer = setInterval(load, POLL_MS)
        return () => { alive = false; clearInterval(timer) }
      }, [])

      useEffect(() => {
        if (!open) return undefined
        const onDown = (event) => {
          const target = event.target
          if (panelRef.current && panelRef.current.contains(target)) return
          if (btnRef.current && btnRef.current.contains(target)) return
          setOpen(false)
        }
        const onKey = (event) => { if (event.key === 'Escape') setOpen(false) }
        document.addEventListener('mousedown', onDown, true)
        document.addEventListener('keydown', onKey, true)
        return () => {
          document.removeEventListener('mousedown', onDown, true)
          document.removeEventListener('keydown', onKey, true)
        }
      }, [open])

      const list = watchers || []
      // Nothing is being watched on this machine: stay out of the dock row
      // entirely rather than parking a dead icon next to the token counters.
      if (watchers !== null && list.length === 0) return null

      const running = list.filter((w) => orbitStateOf(w) === 'active').length
      const broken = list.filter((w) => orbitStateOf(w) === 'error').length
      const summary = '会话级 superagent：' + running + ' 运行中'
        + (broken ? '，' + broken + ' 异常' : '')
        + '（共 ' + list.length + ' 个值守）'

      const toggle = () => {
        const el = btnRef.current
        if (el) {
          const rect = el.getBoundingClientRect()
          setAnchor({ x: rect.left + rect.width / 2, y: rect.top })
        }
        setOpen((value) => !value)
      }

      const button = h('button', {
        ref: btnRef,
        type: 'button',
        title: list.length
          ? list.map((w) => (w.repo + ' · ' + (w.title || '未命名会话') + ' · ' + sessionTag(w.sessionId) + ' · ' + STATE_TEXT[orbitStateOf(w)])).join('\n')
          : 'superagent 值守',
        'aria-label': summary,
        'aria-expanded': open ? 'true' : 'false',
        onClick: toggle,
        style: {
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          height: 20, minWidth: 20, padding: '0 2px', margin: '0 2px',
          border: 'none', borderRadius: 6,
          background: open ? 'rgba(128,128,128,.16)' : 'transparent',
          cursor: 'pointer', color: 'inherit', opacity: watchers === null ? 0.45 : 1,
        },
      }, h(OrbitMark, { watchers: list }))

      if (!open) return button

      const left = anchor
        ? Math.max(8, Math.min(anchor.x - PANEL_W / 2, (window.innerWidth || 1200) - PANEL_W - 8))
        : 8
      const bottom = anchor ? Math.max(8, (window.innerHeight || 800) - anchor.y + 8) : 64

      const rows = list.map((w) => {
        const state = orbitStateOf(w)
        return h('div', {
          key: String(w.repo || '') + '#' + String(w.sessionId || ''),
          style: { padding: '6px 0', borderTop: BORDER },
        },
          h('div', { style: { display: 'flex', alignItems: 'center', gap: 6 } },
            h('span', { style: { width: 7, height: 7, borderRadius: '50%', flex: 'none', background: SAT_COLOR[state] } }),
            h('span', {
              style: { fontFamily: 'ui-monospace, Consolas, monospace', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
            }, String(w.repo || '?')),
            h('span', { style: { marginLeft: 'auto', flex: 'none', opacity: 0.7 } }, STATE_TEXT[state])),
          h('div', { style: { paddingLeft: 13, opacity: 0.72, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
            (w.title || '未命名会话') + ' · ' + sessionTag(w.sessionId)),
          h('div', { style: { paddingLeft: 13, opacity: 0.55 } },
            '每 ' + w.intervalSec + 's · 轮询 ' + ageText(w.lastPoll) + ' · 唤醒 ' + wakeText(w.lastWake)),
          w.goal && w.goal.objective
            ? h('div', { style: { paddingLeft: 13, opacity: 0.55, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
              'goal · ' + String(w.goal.objective).slice(0, 60))
            : null,
          w.lastError
            ? h('div', { style: { paddingLeft: 13, color: '#f85149', overflowWrap: 'anywhere' } }, String(w.lastError).slice(0, 160))
            : null)
      })

      const panel = h('div', {
        ref: panelRef, role: 'dialog', 'aria-label': summary,
        style: {
          position: 'fixed', left, bottom, width: PANEL_W, zIndex: 2147483000,
          border: BORDER, borderRadius: 10,
          background: 'var(--dsw-alias-bg-base, canvas)',
          color: 'var(--dsw-alias-label-primary, inherit)',
          boxShadow: '0 12px 32px rgba(0,0,0,.28)', padding: '10px 12px 8px',
          font: '12px/1.55 system-ui, sans-serif',
          maxHeight: 360, overflow: 'auto',
        },
      },
        h('div', { style: { display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 6 } },
          h('span', { style: { fontWeight: 600, fontSize: 12.5 } }, '会话级 superagent'),
          h('span', { style: { opacity: 0.6 } }, running + '/' + list.length + ' 运行中')),
        ...rows,
        h('div', { style: { marginTop: 8, paddingTop: 8, borderTop: BORDER, opacity: 0.55 } },
          '「值守台」标签页可增删、暂停并配置凭证'))

      return h(React.Fragment, null, button, panel)
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

        watchers.some((w) => w.goal && w.goal.objective) && h('div', { style: { marginTop: 10 } },
          ...watchers.filter((w) => w.goal && w.goal.objective).map((w) =>
            h('div', { key: 'goal-' + w.repo, style: { ...S.mono, opacity: 0.7 } },
              w.repo + ': ' + String(w.goal.objective).slice(0, 90)))),

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

        // ② the machine-wide orbit in the composer dock row — the same row as
        //    轮/步 · token 用量 · 上下文环. One ring, one satellite per live
        //    session-level superagent; click opens the per-agent detail list.
        ctx.effect(() => {
          try {
            return ctx.slots.inject('conversation.composer.dock', () => {
              const dispose = ctx.slots.register({
                name: 'conversation.composer.dock',
                id: 'session-superagent-orbit',
                order: 2,
              }, StatusOrbit)
              note('orbit-registered', 'ok')
              return dispose
            })
          } catch (error) {
            note('orbit-fail', String((error && error.message) || error))
            return undefined
          }
        })

        note('apply', 'done')
      },
    }
  },
})
