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

    // 客户端版本探针：每次模块加载写一次，用来确认浏览器里跑的是哪一版
    const CLIENT_VERSION = '0.9.23'
    let BASE = '/session-superagent'
    /**
     * 挑「最新的那个服务端实例」。
     *
     * 宿主重载时旧 handler 摘不掉，所以可能同时存在多个前缀：默认的（旧代码）和 `/rN`（新代码）。
     * 甚至出现过「新实例在默认前缀注册成功、但请求仍被旧 handler 接走」的情况 ——
     * 所以不能只看「注册成功」，要按实例自报的版本 + routeBase 匹配来选。
     */
    async function discoverBase() {
      const candidates = [BASE]
      for (let i = 2; i <= 8; i += 1) candidates.push('/session-superagent/r' + i)
      const versionScore = (v) => {
        const parts = String(v || '0').split('.').map((n) => Number(n) || 0)
        return parts[0] * 1e6 + parts[1] * 1e3 + parts[2]
      }
      let best = null
      for (const base of candidates) {
        try {
          const res = await fetch(base + '/state', { headers: { accept: 'application/json' } })
          if (!res.ok) continue
          const body = await res.json()
          // 只有「自报前缀 = 我请求的前缀」才说明这个实例真的在这条路径上服务
          if (!body || body.routeBase !== base) continue
          const score = versionScore(body.serverVersion)
          if (!best || score > best.score) best = { base, score }
        } catch {}
      }
      if (best && best.base !== BASE) {
        BASE = best.base
        // 记一笔：排查「面板到底在跟哪一代」时用得上（不像轮询那样完全不落痕迹）
        try { note('client-base', BASE) } catch {}
      } else if (best) {
        BASE = best.base
      }
      return BASE
    }

    const POLL_MS = 5000

    // 上一次 /state 的 ETag：带上它，没变化时服务端回 304，省掉整份 JSON
    let stateEtag = null

    async function call(path, options, retried) {
      const init = {
        ...(options || {}),
        headers: { 'content-type': 'application/json', accept: 'application/json', ...((options && options.headers) || {}) },
      }
      let res
      try {
        res = await fetch(BASE + path, init)
      } catch (error) {
        // 前缀失效（这一代被新实例接管并释放了）：重新探一次再试，还不行就把错抛出去
        if (retried) throw error
        await discoverBase()
        return call(path, options, true)
      }
      // 旧前缀被释放后宿主会 404：同样重探一次
      if (res.status === 404 && !retried) {
        await discoverBase()
        return call(path, options, true)
      }
      // 304：内容没变（服务端带 ETag）。不是错误，也没有正文。
      if (res.status === 304) {
        const etag = res.headers && res.headers.get ? res.headers.get('etag') : null
        if (etag) stateEtag = etag
        return { notModified: true }
      }
      const freshEtag = res.headers && res.headers.get ? res.headers.get('etag') : null
      if (freshEtag && path.startsWith('/state')) stateEtag = freshEtag
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
      row: { display: 'grid', gridTemplateColumns: '1.4fr 1fr 70px 1.2fr 1.2fr 70px 112px', gap: 10, padding: '7px 0', borderBottom: '1px solid rgba(128,128,128,.18)' },
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
      tiny: { padding: '2px 8px', fontSize: 11, lineHeight: '16px', borderRadius: 5, border: '1px solid rgba(128,128,128,.45)', background: 'transparent', color: 'inherit', cursor: 'pointer' },
      ok: { color: '#1a7f37', fontSize: 12 },
    }

    // ── 移植自官方 dsh-superagent 的设计系统（scripts/port-official-ui.mjs 生成）──
    // 官方 GUI 的 376 条选择器 / 40KB 样式原样搬过来，类名统一 `dt-` 前缀，不污染宿主。
    const PORTED_CSS = "/* Panel layout and local UI controls styled with DSH `--dsw-alias-*` design tokens; one rule per line. */\n.dt-page { box-sizing: border-box; height: 100%; overflow: auto; scrollbar-gutter: stable; scroll-padding: 48px 0 72px; container-type: inline-size; padding: 28px clamp(24px, 4vw, 48px) 0; color: var(--dsw-alias-label-primary); }\n/* Deployment page rendered inside DSH Plugin Manager, which owns scrolling and padding. */\n.dt-embedded { container-type: inline-size; color: var(--dsw-alias-label-primary); }\n/* Disable sticky positioning inside DSH Plugin Manager, where the host container owns scrolling and bottom padding. */\n.dt-embedded .dt-savebar { position: static; }\n.dt-page > .dt-column { max-width: 960px; margin: 0 auto; padding-bottom: 48px; display: flex; flex-direction: column; gap: 24px; }\n.dt-head { position: relative; z-index: 3; display: flex; align-items: flex-start; justify-content: space-between; gap: 8px 16px; flex-wrap: wrap; }\n.dt-search { position: relative; width: 240px; max-width: 100%; }\n.dt-search-results { position: absolute; top: calc(100% + 6px); right: 0; width: min(560px, 90cqw); max-height: 60vh; overflow: auto; padding: 8px 16px; border: 0.5px solid var(--dsw-alias-border-l3); border-radius: 12px; background: var(--dsw-alias-bg-layer-2); box-shadow: var(--dsw-elevation-prominent); z-index: 5; display: flex; flex-direction: column; gap: 8px; }\n.dt-mark { background: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 25%, transparent); color: inherit; border-radius: 2px; }\n[data-platform='darwin'] .dt-page .dt-head { padding-top: var(--dsh-frame-top-clearance, 0px); }\n.dt-title { margin: 0; font-size: 15px; line-height: 22px; font-weight: 600; color: var(--dsw-alias-label-secondary); }\n.dt-toolbar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; justify-content: flex-end; }\n.dt-page .dt-tabs { overflow-x: auto; display: flex; gap: 20px; max-width: none; padding: 0; border-radius: 0; background: none; border-bottom: 0.5px solid var(--dsw-alias-border-l3); }\n.dt-segmented { width: 100%; max-width: 420px; box-sizing: border-box; display: inline-grid; gap: 2px; padding: 3px; border-radius: 9px; background: var(--dsw-alias-interactive-bg-hover); }\n.dt-form.dt-block { padding: 16px; border: 0.5px solid var(--dsw-alias-border-l3); border-radius: 16px; gap: 16px; }\n.dt-block-title { display: flex; align-items: center; gap: 4px; margin: 0; font-size: 16px; line-height: 24px; font-weight: 500; }\n.dt-section { display: flex; flex-direction: column; gap: 8px; min-width: 0; }\n.dt-section-title { margin: 0; display: flex; flex-wrap: wrap; align-items: baseline; gap: 8px; font-size: 13px; line-height: 20px; font-weight: 600; color: var(--dsw-alias-label-secondary); }\n.dt-section-name { white-space: nowrap; }\n.dt-count { font-size: 14px; color: var(--dsw-alias-label-caption); font-variant-numeric: tabular-nums; font-weight: 400; }\n.dt-hint { margin: 0; font-size: 13px; line-height: 20px; color: var(--dsw-alias-label-tertiary); }\n.dt-error { margin: 0; font-size: 13px; line-height: 20px; color: var(--dsw-alias-state-error-primary); }\n.dt-banner { margin: 0; padding: 8px 12px; border-radius: 10px; font-size: 13px; line-height: 20px; background: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 10%, transparent); overflow-wrap: anywhere; }\n.dt-banner.dt-danger { background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 10%, transparent); }\n.dt-list { list-style: none; margin: 0 -8px; padding: 0; display: flex; flex-direction: column; gap: 2px; }\n.dt-row { position: relative; min-width: 0; border-radius: 12px; padding: 10px 8px; display: flex; flex-wrap: wrap; gap: 4px 12px; align-items: flex-start; }\n.dt-row.dt-link:hover { background: var(--dsw-alias-interactive-bg-hover); }\n.dt-row-main { flex: 1 1 200px; min-width: 0; display: flex; flex-direction: column; gap: 4px; }\n.dt-disclosure-body .dt-row-main { flex-basis: 0; }\n.dt-row-title { display: flex; align-items: center; gap: 8px; min-width: 0; font-size: 14px; line-height: 20px; font-weight: 500; }\n.dt-open { max-width: 100%; padding: 0; border: 0; background: transparent; color: inherit; font: inherit; font-size: 14px; line-height: 20px; font-weight: 500; text-align: left; cursor: pointer; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }\n.dt-open::after { content: ''; position: absolute; inset: 0; border-radius: 12px; }\n.dt-open:focus-visible { outline: none; }\n.dt-open-wrap { white-space: normal; }\n.dt-open:focus-visible::after { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 2px; }\n.dt-row-meta { display: flex; align-items: center; flex-wrap: wrap; gap: 4px 10px; font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-caption); overflow-wrap: anywhere; }\n.dt-row-quote { font-size: 13px; line-height: 20px; color: var(--dsw-alias-label-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }\n.dt-clamp { display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }\n/* Transparent block borders preserve vertical spacing when line clamping clips padding. */\n.dt-banner:is(.dt-clamp, .dt-clamp-8) { padding-block: 0; border-block: 8px solid transparent; }\n.dt-banner-label { font-weight: 500; }\n.dt-banner .dt-md { display: inline; }\n.dt-banner .dt-md > p:first-child { display: inline; }\n.dt-row-buttons { position: relative; z-index: 1; gap: 8px; margin-top: 4px; }\n.dt-row-actions { position: relative; z-index: 1; display: flex; align-items: center; gap: 4px; flex: none; margin-left: auto; font-size: 13px; line-height: 20px; }\n.dt-dot { flex: none; margin-top: 5px; }\n.dt-inline-link { position: relative; z-index: 1; color: var(--dsw-alias-link); text-decoration: none; }\n.dt-inline-link:hover { text-decoration: underline; }\n.dt-textlink { padding: 0; border: 0; background: none; font: inherit; color: var(--dsw-alias-link); cursor: pointer; text-align: left; }\n.dt-textlink:hover { text-decoration: underline; }\n.dt-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 13px; line-height: 20px; }\n.dt-kv { display: grid; grid-template-columns: max-content 1fr; gap: 6px 16px; margin: 0; font-size: 13px; line-height: 20px; }\n.dt-kv dt { color: var(--dsw-alias-label-tertiary); }\n.dt-kv dd { margin: 0; min-width: 0; overflow-wrap: anywhere; }\n.dt-timeline { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }\n.dt-event { padding: 12px 0; border-bottom: 0.5px solid var(--dsw-alias-border-l2); display: flex; flex-direction: column; gap: 6px; min-width: 0; }\n.dt-event:last-child { border-bottom: 0; }\n.dt-event.dt-highlight { background: var(--dsw-alias-interactive-bg-hover); border-radius: 8px; padding-inline: 8px; margin-inline: -8px; }\n.dt-event-text { margin: 0; font-size: 13px; line-height: 20px; white-space: pre-wrap; overflow-wrap: anywhere; }\n.dt-event-actor { font-weight: 500; color: var(--dsw-alias-label-secondary); }\n.dt-event-quiet .dt-event-text { color: var(--dsw-alias-label-tertiary); }\n.dt-flow { margin: 0; font-size: 13px; line-height: 20px; color: var(--dsw-alias-label-secondary); }\n.dt-clamp-8 { display: -webkit-box; -webkit-line-clamp: 8; -webkit-box-orient: vertical; overflow: hidden; }\n.dt-more { align-self: flex-start; font-size: 12px; }\n.dt-reveal { opacity: 0; }\n.dt-event:hover .dt-reveal, .dt-reveal:focus-visible { opacity: 1; }\n@media (hover: none) {\n  .dt-reveal { opacity: 1; }\n}\n.dt-event-foot { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-tertiary); }\n.dt-filters { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }\n.dt-filters .dt-search { margin-left: auto; }\n.dt-form { display: flex; flex-direction: column; gap: 24px; }\n.dt-fieldset { display: flex; flex-direction: column; gap: inherit; min-width: 0; margin: 0; padding: 0; border: 0; }\n.dt-field { display: flex; flex-direction: column; gap: 6px; font-size: 13px; line-height: 20px; min-width: 0; }\n.dt-field small { color: var(--dsw-alias-label-caption); font-size: 12px; }\n.dt-textarea { box-sizing: border-box; width: 100%; min-width: 0; border: 0.5px solid var(--dsw-alias-border-l3); border-radius: 10px; padding: 8px 12px; font: inherit; font-size: 13px; line-height: 20px; color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-layer-1, transparent); resize: vertical; }\n.dt-select { box-sizing: border-box; width: 100%; min-width: 0; height: 32px; border: 0.5px solid var(--dsw-alias-border-l4); border-radius: 8px; padding: 0 28px 0 8px; text-overflow: ellipsis; font: inherit; font-size: 14px; line-height: 22px; color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-layer-1, transparent); }\n.dt-textarea:focus-visible, .dt-select:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }\n.dt-mono { font-family: var(--ds-font-family-code, Menlo, monospace); font-size: 12px; overflow-wrap: anywhere; }\n.dt-detail { margin-top: 2px; color: var(--dsw-alias-label-secondary); }\n.dt-savebar .dt-error { white-space: pre-line; }\n.dt-switch-row { display: flex; align-items: center; justify-content: space-between; gap: 16px; min-height: 36px; font-size: 13px; }\n.dt-subhead-actions { display: inline-flex; align-items: center; gap: 4px; }\n.dt-btn-busy .dt-btn-icon svg { animation: dt-spin 1s linear infinite; }\n.dt-subhead { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; font-size: 13px; line-height: 20px; color: var(--dsw-alias-label-secondary); }\n.dt-rules, .dt-changes { list-style: none; margin: 0; padding: 0; }\n.dt-field-head { display: inline-flex; align-items: center; gap: 4px; color: var(--dsw-alias-label-secondary); }\n.dt-info { display: inline-flex; align-items: center; justify-content: center; width: 16px; height: 16px; padding: 0; border: 0; background: none; color: var(--dsw-alias-label-caption); cursor: help; }\n.dt-info:hover, .dt-info:focus-visible { color: var(--dsw-alias-label-secondary); }\n.dt-info:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 2px; border-radius: 50%; }\n.dt-tooltip { position: fixed; z-index: 1100; width: max-content; max-width: min(320px, calc(100vw - 24px)); padding: 3px 7px; border-radius: 8px; background: var(--dsw-alias-tooltip-bg); color: var(--dsw-static-neutral-bluish-00); font-size: 13px; line-height: 20px; overflow-wrap: break-word; pointer-events: none; animation: dt-tooltip-in 150ms ease-in-out; }\n@keyframes dt-tooltip-in { from { opacity: 0; } }\n.dt-rules { border-top: 0.5px solid var(--dsw-alias-border-l2); }\n.dt-rule { display: flex; align-items: flex-start; gap: 12px; padding: 6px 0; border-bottom: 0.5px solid var(--dsw-alias-border-l2); }\n.dt-rule > :first-child { flex: 1; min-width: 0; }\n.dt-rule-preview { flex: 1; min-width: 0; margin-left: 8px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; color: var(--dsw-alias-label-caption); }\n.dt-rule-switch { margin-top: 2px; flex: none; }\n.dt-rule-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: var(--dsw-alias-label-caption); }\n.dt-rule-dot[data-enabled] { background: var(--dsw-alias-brand-primary); }\n.dt-rule-body { display: flex; flex-direction: column; gap: 12px; padding: 8px 0 8px 28px; }\n.dt-model { display: flex; flex-direction: column; gap: 6px; }\n.dt-grid3 { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }\n.dt-changes { display: flex; flex-direction: column; gap: 2px; font-size: 13px; line-height: 20px; }\n.dt-changes li::before { content: '· '; color: var(--dsw-alias-label-caption); }\n.dt-main { display: flex; flex-direction: column; gap: 24px; min-width: 0; }\n.dt-modal.dt-glossary-modal { width: min(680px, 100%); }\n.dt-nav-item { display: flex; align-items: center; justify-content: space-between; gap: 8px; width: 100%; min-height: 32px; padding: 6px 10px; border: 0; border-radius: 8px; background: transparent; color: var(--dsw-alias-label-secondary); font: inherit; font-size: 13px; line-height: 20px; text-align: left; cursor: pointer; }\n.dt-nav-item:hover { background: var(--dsw-alias-interactive-bg-hover); }\n.dt-nav-item[aria-current='true'] { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); font-weight: 500; }\n.dt-nav-item:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: -2px; }\n.dt-changed-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--dsw-alias-brand-primary); flex: none; }\n.dt-add-skill { display: flex; flex-direction: column; gap: 6px; margin-top: 8px; padding-top: 8px; border-top: 0.5px solid var(--dsw-alias-border-l2); }\n.dt-prompt-main { display: flex; flex-direction: column; gap: 12px; min-width: 0; }\n.dt-editor { min-height: 360px; }\n.dt-inline-select { width: auto; }\n.dt-preview-part { display: flex; flex-direction: column; gap: 6px; padding: 2px 0 2px 12px; border-left: 2px solid var(--dsw-alias-border-l3); }\n.dt-preview-head { font-size: 13px; line-height: 20px; display: flex; align-items: baseline; gap: 8px; }\ndiv.dt-preview-head { color: var(--dsw-alias-label-secondary); }\n.dt-card { display: flex; flex-direction: column; gap: 12px; padding: 16px; border: 0.5px solid var(--dsw-alias-border-l3); border-radius: 16px; min-width: 0; }\n.dt-card-head { display: flex; align-items: center; gap: 12px; min-height: 28px; }\n.dt-card-head .dt-row-main { flex: 1 1 0; min-width: 64px; }\n.dt-card-title { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }\n.dt-row-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; font-weight: 500; }\n.dt-rows { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }\n.dt-rows-item { display: grid; grid-template-columns: repeat(var(--dt-columns), minmax(0, 1fr)) auto; gap: 8px; align-items: center; }\n.dt-filter-gap { flex: 1; }\n.dt-page-head { display: flex; flex-direction: column; align-items: flex-start; gap: 4px; }\n.dt-page-head > .dt-btn { margin-left: -10px; }\n.dt-page-title { display: flex; align-items: center; gap: 8px 16px; flex-wrap: wrap; width: 100%; }\n.dt-page-title h2 { margin: 0; flex: 1 1 auto; min-width: 0; font-size: 20px; line-height: 28px; font-weight: 500; overflow-wrap: anywhere; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }\n.dt-status-line { margin-top: -16px; }\n.dt-plain-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; font-size: 13px; line-height: 20px; }\n.dt-details { display: flex; flex-direction: column; gap: 2px; border-top: 0.5px solid var(--dsw-alias-border-l2); padding-top: 8px; }\n.dt-danger-zone { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; padding-top: 16px; border-top: 0.5px solid var(--dsw-alias-border-l2); }\n.dt-danger-zone .dt-btn { color: var(--dsw-alias-state-error-primary); }\n.dt-md { display: flex; flex-direction: column; gap: 6px; font-size: 13px; line-height: 20px; overflow-wrap: anywhere; }\n.dt-md p, .dt-md ul, .dt-md ol { margin: 0; }\n.dt-md ul, .dt-md ol { padding-left: 20px; display: flex; flex-direction: column; gap: 2px; }\n.dt-md-heading { font-weight: 500; }\n.dt-code { font-family: var(--ds-font-family-code, Menlo, monospace); font-size: 12px; padding: 0 4px; border-radius: 4px; background: var(--dsw-alias-bg-module-platform); }\n.dt-dot-wrap { display: inline-flex; flex: none; }\n.dt-search-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }\n.dt-ellipsis { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 280px; }\n.dt-legend-title { margin: 16px 0 6px; font-size: 13px; color: var(--dsw-alias-label-tertiary); }\n.dt-legend { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 6px 16px; font-size: 13px; }\n.dt-legend li { display: flex; align-items: center; gap: 6px; }\n.dt-legend .dt-dot { margin-top: 0; }\n.dt-savebar { position: sticky; bottom: 0; z-index: 2; display: flex; align-items: center; justify-content: flex-end; gap: 8px; flex-wrap: wrap; padding: 12px 0; background: var(--dsw-alias-bg-base, var(--dsw-alias-bg-layer-1)); border-top: 0.5px solid var(--dsw-alias-border-l2); }\n.dt-savebar .dt-hint { margin-right: auto; }\n.dt-card > .dt-savebar, .dt-block > .dt-savebar { margin: 0 -16px -16px; padding: 12px 16px; border-radius: 0 0 16px 16px; }\n.dt-glossary { width: 100%; border-collapse: collapse; font-size: 13px; line-height: 20px; }\n.dt-glossary th, .dt-glossary td { text-align: left; padding: 6px 8px; border-bottom: 0.5px solid var(--dsw-alias-border-l2); vertical-align: top; }\n.dt-glossary th { color: var(--dsw-alias-label-tertiary); font-weight: 400; }\n.dt-glossary th.dt-glossary-group { color: var(--dsw-alias-label-secondary); font-weight: 600; padding-top: 14px; }\n.dt-glossary th:nth-child(-n+2), .dt-glossary td:nth-child(-n+2) { white-space: nowrap; }\n.dt-values { display: grid; grid-template-columns: max-content 1fr; gap: 6px 16px; margin: 16px 0 0; font-size: 13px; }\n.dt-values dt { color: var(--dsw-alias-label-tertiary); }\n.dt-values dd { margin: 0; }\n.dt-pre { margin: 0; padding: 12px; border-radius: 10px; background: var(--dsw-alias-bg-module-platform); font-family: var(--ds-font-family-code, Menlo, monospace); font-size: 12px; line-height: 18px; white-space: pre-wrap; overflow-wrap: anywhere; max-height: 480px; overflow: auto; }\n.dt-pre ins { background: color-mix(in srgb, var(--dsw-alias-state-success-primary, green) 18%, transparent); text-decoration: none; }\n.dt-pre del { background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 18%, transparent); text-decoration: none; }\n.dt-prompt { display: grid; grid-template-columns: 200px minmax(0, 1fr); gap: 20px; align-items: start; }\n.dt-prompt-nav { display: flex; flex-direction: column; gap: 2px; }\n.dt-prompt-nav button { justify-content: flex-start; }\n.dt-disclosure-body { padding: 8px 0 8px 28px; display: flex; flex-direction: column; gap: 8px; }\n@container (max-width: 640px) {\n  .dt-tab { padding: 0 8px; font-size: 13px; }\n  .dt-segment { padding: 0 10px; }\n  .dt-head { align-items: center; }\n  .dt-search-results { right: auto; left: 0; width: 100%; }\n  .dt-page-title h2 { font-size: 17px; line-height: 24px; }\n  .dt-status-line { margin-top: -12px; }\n  .dt-page .dt-tabs { display: flex; flex-wrap: nowrap; scrollbar-width: thin; }\n  .dt-page .dt-tab { flex: none; }\n  .dt-page .dt-tabs[data-more='end'] { mask-image: linear-gradient(to right, #000 calc(100% - 40px), transparent); }\n  .dt-page .dt-tabs[data-more='start'] { mask-image: linear-gradient(to right, transparent, #000 40px); }\n  .dt-page .dt-tabs[data-more='both'] { mask-image: linear-gradient(to right, transparent, #000 40px, #000 calc(100% - 40px), transparent); }\n  .dt-kv { grid-template-columns: 1fr; gap: 2px; }\n  .dt-grid3, .dt-prompt { grid-template-columns: 1fr; }\n  .dt-search { width: 100%; }\n  .dt-filters .dt-search { margin-left: 0; }\n}\n/* Local UI primitive styles (see controls.tsx). */\n.dt-btn { display: inline-flex; align-items: center; justify-content: center; gap: 4px; border: none; border-radius: 18px; cursor: pointer; font: inherit; font-size: 14px; line-height: 22px; color: var(--dsw-alias-label-primary); background: transparent; padding: 0 14px; white-space: nowrap; }\n.dt-btn:disabled { cursor: not-allowed; opacity: 0.4; }\n.dt-btn:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 2px; }\n.dt-btn-md { height: 36px; }\n.dt-btn-sm { height: 28px; font-size: 12px; line-height: 18px; padding: 0 10px; border-radius: 14px; }\n.dt-btn-primary { background: var(--dsw-alias-button-primary-fill); color: var(--dsw-alias-label-primary-foreground); }\n.dt-btn-primary:hover:not(:disabled) { background: var(--dsw-alias-button-primary-hover); }\n.dt-btn-ghost:hover:not(:disabled), .dt-btn-outline:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }\n.dt-btn-ghost:active:not(:disabled) { background: var(--dsw-alias-interactive-bg-active); }\n.dt-btn-outline { border: 0.5px solid var(--dsw-alias-border-l3); }\n.dt-btn-icon { display: inline-flex; width: 16px; height: 16px; align-items: center; justify-content: center; }\n.dt-tag { display: inline-flex; align-items: center; border-radius: 999px; padding: 1px 8px; font-size: 11px; line-height: 17px; font-weight: 500; white-space: nowrap; }\n.dt-tag[data-tone='outline'] { border: 0.5px solid var(--dsw-alias-border-l4); color: var(--dsw-alias-label-tertiary); }\n.dt-tag[data-tone='neutral'] { background: var(--dsw-alias-bg-module-platform); color: var(--dsw-alias-label-secondary); }\n.dt-tag[data-tone='quiet'] { color: var(--dsw-alias-label-tertiary); }\n.dt-tag[data-tone='success'] { background: color-mix(in srgb, var(--dsw-alias-state-success-primary) 10%, transparent); color: var(--dsw-alias-state-success-primary); }\n.dt-tag[data-tone='info'] { background: color-mix(in srgb, var(--dsw-alias-state-business-primary) 10%, transparent); color: var(--dsw-alias-state-business-primary); }\n.dt-tag[data-tone='warning'] { background: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 12%, transparent); color: var(--dsw-alias-state-warn-primary); }\n.dt-tag[data-tone='danger'] { background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 10%, transparent); color: var(--dsw-alias-state-error-primary); }\n.dt-pill { display: inline-flex; align-items: center; gap: 4px; height: 24px; padding: 0 8px; border: none; border-radius: 12px; font: inherit; font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-secondary); background: var(--dsw-alias-bg-layer-2); cursor: pointer; }\n.dt-pill:hover { background: var(--dsw-alias-interactive-bg-hover); }\n.dt-pill-active, .dt-pill-active:hover { color: var(--dsw-alias-label-primary); background: var(--dsw-alias-button-ghost-active-fill); box-shadow: inset 0 0 0 1px var(--dsw-alias-button-ghost-active-border); }\n.dt-tabs { display: grid; padding: 4px; border-radius: 12px; background: var(--dsw-alias-bg-module-platform); }\n.dt-tab { box-sizing: border-box; height: 34px; padding: 0 12px; border: 0.5px solid transparent; border-radius: 8px; background: transparent; color: var(--dsw-alias-label-secondary); font: inherit; font-size: 14px; line-height: 20px; white-space: nowrap; cursor: pointer; transition: color 180ms ease, background 180ms ease; }\n.dt-tab:hover { color: var(--dsw-alias-label-primary); }\n.dt-tab[aria-selected='true'] { color: var(--dsw-alias-label-primary); font-weight: 600; background: var(--dsw-alias-bg-layer-3); border-color: var(--dsw-alias-border-l3); }\n.dt-tab:focus-visible { outline: none; text-decoration: underline; text-underline-offset: 4px; }\n.dt-segment { height: 28px; padding: 0 16px; border: 0; border-radius: 7px; background: transparent; color: var(--dsw-alias-label-secondary); font: inherit; font-size: 13px; line-height: 20px; font-weight: 500; white-space: nowrap; cursor: pointer; transition: color 120ms ease, background 160ms ease; }\n.dt-segment:hover:not(:disabled), .dt-segment[aria-selected='true'] { color: var(--dsw-alias-label-primary); }\n.dt-segment[aria-selected='true'] { background: var(--dsw-alias-bg-layer-1); box-shadow: var(--dsw-elevation-soft); }\n.dt-segment:disabled { cursor: default; opacity: 0.4; }\n.dt-segment:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: -2px; }\n.dt-input { box-sizing: border-box; display: inline-flex; align-items: center; gap: 6px; height: 32px; min-width: 0; padding: 0 8px; border: 0.5px solid var(--dsw-alias-border-l4); border-radius: 8px; background: var(--dsw-alias-bg-layer-1); }\n.dt-input:focus-within { border-color: var(--dsw-alias-brand-primary); }\n.dt-input-icon { display: inline-flex; width: 16px; height: 16px; align-items: center; justify-content: center; color: var(--dsw-alias-label-tertiary); }\n.dt-input input { flex: 1; min-width: 0; border: none; outline: none; background: transparent; font: inherit; font-size: 14px; line-height: 22px; color: var(--dsw-alias-label-primary); }\n.dt-input input::placeholder { color: var(--dsw-alias-label-dimmed); }\n.dt-input input::-webkit-search-cancel-button { -webkit-appearance: none; appearance: none; }\n.dt-field .dt-input, .dt-search .dt-input, .dt-add-skill .dt-input { display: flex; width: 100%; }\n.dt-switch { box-sizing: border-box; flex: 0 0 auto; width: 36px; height: 20px; padding: 2px; border: 0; border-radius: 10px; background: var(--dsw-alias-border-l3); cursor: pointer; }\n.dt-switch[aria-checked='true'] { background: var(--dsw-alias-brand-primary); }\n.dt-switch:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 2px; }\n.dt-switch-thumb { display: block; width: 16px; height: 16px; border-radius: 50%; background: var(--dsw-alias-label-primary-foreground); transition: transform 120ms ease; }\n.dt-switch[aria-checked='true'] .dt-switch-thumb { transform: translateX(16px); }\n.dt-state-dot { position: relative; display: inline-block; flex: none; width: 10px; height: 10px; color: var(--dsw-alias-state-idle-primary); }\n.dt-state-dot::after { content: ''; position: absolute; inset: 20%; border-radius: 50%; background: currentColor; }\n.dt-state-dot[data-state='done'] { color: var(--dsw-alias-state-success-primary); }\n.dt-state-dot[data-state='warning'] { color: var(--dsw-alias-state-warn-primary); }\n.dt-state-dot[data-state='error'] { color: var(--dsw-alias-state-error-primary); }\n.dt-spinner { flex: none; color: var(--dsw-alias-label-tertiary); }\n.dt-spinner g { transform-origin: center; animation: dt-spin 1.5s linear infinite; }\n.dt-spinner circle { fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; }\n.dt-spinner circle:first-child { opacity: 0.25; }\n.dt-spinner circle:last-child { stroke-dasharray: 18 150; }\n@keyframes dt-spin { to { transform: rotate(360deg); } }\n.dt-disclosure-row { display: flex; align-items: center; gap: 4px; min-height: 28px; min-width: 0; border-radius: 8px; cursor: pointer; font-size: 13px; line-height: 20px; color: var(--dsw-alias-label-secondary); }\n.dt-disclosure-row:hover { color: var(--dsw-alias-label-primary); }\n.dt-disclosure-row:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 2px; }\n.dt-disclosure-lead { position: relative; display: inline-flex; flex: none; width: 24px; height: 24px; align-items: center; justify-content: center; }\n.dt-disclosure-icon { display: inline-flex; align-items: center; justify-content: center; }\n.dt-disclosure-chevron { position: absolute; inset: 0; display: none; align-items: center; justify-content: center; }\n.dt-disclosure-row:hover .dt-disclosure-icon, .dt-disclosure[data-open] .dt-disclosure-icon { visibility: hidden; }\n.dt-disclosure-row:hover .dt-disclosure-chevron, .dt-disclosure[data-open] .dt-disclosure-chevron { display: inline-flex; }\n.dt-disclosure-title { flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }\n.dt-modal-root { position: fixed; inset: 0; z-index: 1000; display: flex; align-items: center; justify-content: center; padding: max(24px, var(--dsh-frame-top-clearance, 24px)) 24px; }\n.dt-modal-mask { position: absolute; inset: 0; background: var(--dsw-alias-bg-mask-1); backdrop-filter: var(--dsw-mask-blur); }\n.dt-modal { position: relative; z-index: 1; display: flex; flex-direction: column; gap: 20px; width: min(380px, 100%); max-height: 100%; padding: 0 0 24px; overflow: hidden; border-radius: 24px; background: var(--dsw-alias-bg-layer-2); box-shadow: var(--dsw-elevation-prominent); color: var(--dsw-alias-label-primary); outline: none; }\n.dt-modal-header { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 22px 14px 0 24px; }\n.dt-modal-header h2 { margin: 0; font-size: 16px; line-height: 24px; font-weight: 500; }\n.dt-modal-close { display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; border: none; border-radius: 8px; background: transparent; cursor: pointer; color: var(--dsw-alias-label-secondary); }\n.dt-modal-close:hover { background: var(--dsw-alias-interactive-bg-hover); }\n.dt-modal-description { margin: -8px 0 0; padding: 0 24px; font-size: 14px; line-height: 22px; }\n.dt-modal-body { min-width: 0; min-height: 0; overflow: auto; padding: 0 24px; }\n.dt-modal-footer { display: flex; align-items: center; justify-content: flex-end; gap: 8px; padding: 0 24px; }\n.dt-toast { position: fixed; top: 40px; left: 50%; z-index: 1100; pointer-events: none; width: max-content; max-width: min(640px, calc(100vw - 48px)); padding: 12px 16px; border-radius: 14px; background: var(--dsw-alias-toast-bg); color: var(--dsw-static-neutral-bluish-00); font-size: 14px; line-height: 22px; box-shadow: var(--dsw-shadow-lv3); transform: translateX(-50%); animation: dt-toast-in 160ms ease-out, dt-toast-fade 1000ms ease var(--dt-toast-hold, 3000ms) forwards; }\n@keyframes dt-toast-in { from { opacity: 0; transform: translate(-50%, -6px); } to { opacity: 1; transform: translate(-50%, 0); } }\n@keyframes dt-toast-fade { to { opacity: 0; visibility: hidden; } }\n@media (prefers-reduced-motion: reduce) {\n  .dt-tab, .dt-segment, .dt-switch-thumb, .dt-spinner g, .dt-btn-busy .dt-btn-icon svg, .dt-tooltip { transition: none; animation: none; }\n  .dt-toast { animation: dt-toast-fade 1000ms ease var(--dt-toast-hold, 3000ms) forwards; }\n}\n.dt-page .dt-tab { height: 34px; padding: 0 2px; border: 0; border-radius: 0; color: var(--dsw-alias-label-tertiary); font-size: 14px; }\n.dt-page .dt-tab[aria-selected='true'] { background: none; color: var(--dsw-alias-label-primary); font-weight: 500; box-shadow: inset 0 -1.5px 0 var(--dsw-alias-label-primary); }\n.dt-status-head { display: flex; align-items: center; gap: 8px; }\n.dt-status-title { margin: 0; flex: 1; display: flex; align-items: center; gap: 4px; font-size: 15px; line-height: 22px; font-weight: 600; }\n.dt-status-text { margin-left: auto; flex: none; font-size: 12px; font-weight: 400; color: var(--dsw-alias-label-secondary); }\n.dt-status-line .dt-status-text { margin-left: 0; }\n.dt-status-text[data-state='warning'] { color: var(--dsw-alias-state-warn-primary); }\n.dt-status-text[data-state='error'] { color: var(--dsw-alias-state-error-primary); }\n.dt-row-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; }\n.dt-lv { white-space: nowrap; }\n.dt-lv-label { color: var(--dsw-alias-label-caption); }\n.dt-lv-value { color: var(--dsw-alias-label-secondary); font-variant-numeric: tabular-nums; }\n.dt-chip { display: inline-flex; flex-wrap: wrap; max-width: 100%; border: 0.5px solid var(--dsw-alias-border-l3); border-radius: 6px; overflow: hidden; font-size: 11px; line-height: 18px; color: var(--dsw-alias-label-secondary); }\n.dt-chip-source { padding: 0 6px; color: var(--dsw-alias-label-tertiary); background: var(--dsw-alias-bg-module-platform); }\n.dt-chip-fact { padding: 0 6px; border-left: 0.5px solid var(--dsw-alias-border-l3); white-space: nowrap; }\n.dt-chip-label { margin-right: 4px; color: var(--dsw-alias-label-caption); }\n.dt-chip-link { position: relative; z-index: 1; text-decoration: none; cursor: pointer; transition: border-color 120ms ease; }\n.dt-chip-link:hover { border-color: var(--dsw-alias-brand-primary); }\n.dt-chip-link:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }\n.dt-chip-open { display: inline-flex; align-items: center; padding: 0 5px; border-left: 0.5px solid var(--dsw-alias-border-l3); color: var(--dsw-alias-brand-primary); }\n.dt-chip-problem, .dt-chip-problem .dt-chip-label { color: var(--dsw-alias-state-error-primary); }\n.dt-cards { gap: 8px; }\n.dt-att .dt-inline-link { font-size: 13px; font-weight: 500; }\n.dt-list > .dt-att { margin: 2px 8px; }\n.dt-att { padding: 10px 12px 10px 16px; border: 0; border-radius: 0; border-bottom: 0.5px solid var(--dsw-alias-border-l3); }\n.dt-att::before { content: ''; position: absolute; left: 6px; top: 10px; bottom: 10px; width: 2px; border-radius: 1px; background: var(--dsw-alias-state-warn-primary); opacity: 0.7; }\n.dt-att-error::before { background: var(--dsw-alias-state-error-primary); }\n.dt-att-what { font-size: 12px; line-height: 18px; font-weight: 500; color: var(--dsw-alias-state-warn-primary); }\n.dt-att-error .dt-att-what, .dt-att-error .dt-att-what .dt-open { color: var(--dsw-alias-state-error-primary); }\n.dt-stats { display: flex; flex-wrap: wrap; gap: 6px 20px; }\n.dt-stat { display: inline-flex; align-items: baseline; gap: 6px; font-size: 12px; color: var(--dsw-alias-label-caption); }\n.dt-stat-value { font-size: 14px; font-weight: 500; color: var(--dsw-alias-label-primary); font-variant-numeric: tabular-nums; }\n.dt-more-link { font-size: 12px; font-weight: 400; }\n.dt-settings { display: grid; grid-template-columns: 140px minmax(0, 1fr); gap: 24px; align-items: start; }\n.dt-settings-nav { position: sticky; top: 0; display: flex; flex-direction: column; gap: 2px; }\n.dt-settings-link { padding: 6px 10px; border: 0; border-radius: 8px; background: none; color: var(--dsw-alias-label-secondary); font: inherit; font-size: 14px; text-align: left; cursor: pointer; }\n.dt-settings-link:hover { color: var(--dsw-alias-label-primary); }\n.dt-settings-link[aria-current='page'] { background: var(--dsw-alias-bg-module-platform); color: var(--dsw-alias-label-primary); font-weight: 500; }\n.dt-settings-link[data-stage] + .dt-settings-link:not([data-stage]) { margin-top: 10px; }\n.dt-settings-body { display: flex; flex-direction: column; gap: 16px; min-width: 0; }\n.dt-settings-title { margin: 0; font-size: 15px; line-height: 22px; font-weight: 600; }\n.dt-subtabs { display: flex; gap: 16px; border-bottom: 0.5px solid var(--dsw-alias-border-l3); }\n.dt-subtab { padding: 0 0 6px; border: 0; background: none; color: var(--dsw-alias-label-tertiary); font: inherit; font-size: 13px; cursor: pointer; }\n.dt-subtab[aria-selected='true'] { color: var(--dsw-alias-label-primary); font-weight: 500; box-shadow: inset 0 -1.5px 0 var(--dsw-alias-label-primary); }\n.dt-part { display: flex; flex-direction: column; gap: 12px; }\n.dt-rows-summary { text-align: left; color: var(--dsw-alias-label-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 100%; }\n.dt-table { width: 100%; border-collapse: collapse; font-size: 12px; line-height: 18px; }\n.dt-table th { text-align: left; font-weight: 400; color: var(--dsw-alias-label-caption); padding: 2px 8px 2px 0; }\n.dt-table td { padding: 4px 8px 4px 0; border-top: 0.5px solid var(--dsw-alias-border-l3); vertical-align: top; color: var(--dsw-alias-label-secondary); overflow-wrap: anywhere; }\n@container (max-width: 640px) {\n  .dt-settings { grid-template-columns: 1fr; gap: 12px; }\n  .dt-settings-nav { position: static; flex-direction: row; flex-wrap: wrap; }\n  .dt-settings-link[data-stage] + .dt-settings-link:not([data-stage]) { margin-top: 0; }\n  .dt-page .dt-tabs { gap: 14px; }\n}\n.dt-list > .dt-ticket { display: grid; grid-template-columns: 112px minmax(0, 1fr); column-gap: 12px; align-items: start; margin: 0; padding: 12px 8px 12px 18px; border-radius: 0; border-bottom: 0.5px solid var(--dsw-alias-border-l3); }\n.dt-list > .dt-ticket[data-state]::before { content: ''; position: absolute; left: 6px; top: 12px; bottom: 12px; width: 2px; border-radius: 1px; background: var(--dsw-alias-state-warn-primary); opacity: 0.7; }\n.dt-list > .dt-ticket[data-state='error']::before { background: var(--dsw-alias-state-error-primary); }\n.dt-ticket-stage { align-self: stretch; padding-top: 1px; border-right: 0.5px solid var(--dsw-alias-border-l3); }\n.dt-ticket-body { display: flex; flex-direction: column; gap: 4px; min-width: 0; }\n.dt-ticket-body .dt-row-title .dt-open { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }\n.dt-ticket-meta { flex-wrap: nowrap; overflow: hidden; white-space: nowrap; }\n.dt-ticket-meta .dt-chip { flex: none; }\n.dt-ticket-note { min-width: 0; overflow: hidden; text-overflow: ellipsis; color: var(--dsw-alias-label-primary); }\n.dt-ticket-note-error { color: var(--dsw-alias-state-error-primary); }\n.dt-ticket-actions { position: relative; z-index: 1; display: flex; flex-wrap: wrap; gap: 8px; min-height: 30px; margin-top: 2px; }\n/* Pass pointer events through action containers to the row link, keeping only child controls interactive. */\n.dt-ticket-actions, .dt-row-buttons, .dt-row-actions { pointer-events: none; }\n.dt-ticket-actions > *, .dt-row-buttons > *, .dt-row-actions > * { pointer-events: auto; }\n.dt-line { min-height: 20px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }\n.dt-row-meta.dt-line { flex-wrap: nowrap; }\n.dt-line-text { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }\n.dt-error-text { color: var(--dsw-alias-state-error-primary); }\n.dt-stage { display: inline-flex; align-items: flex-start; gap: 5px; font-size: 12px; line-height: 18px; font-weight: 500; color: var(--dsw-alias-label-secondary); }\n.dt-stage svg { flex: none; margin-top: 2px; }\n.dt-stage[data-state='warning'] { color: var(--dsw-alias-state-warn-primary); }\n.dt-stage[data-state='error'] { color: var(--dsw-alias-state-error-primary); }\n.dt-stage[data-state='ongoing'] { color: var(--dsw-alias-state-business-primary); }\n.dt-icon-link { display: inline-flex; align-items: center; gap: 4px; }\na.dt-btn, a.dt-btn:hover { text-decoration: none; }\n.dt-section-icon { display: inline-flex; align-self: center; color: var(--dsw-alias-label-tertiary); }\n.dt-trigger-link { display: flex; flex-direction: column; gap: 2px; width: 100%; margin: -4px 0 -4px -8px; padding: 4px 8px; border: 0; border-radius: 8px; background: none; font: inherit; color: inherit; text-align: left; cursor: pointer; }\n.dt-trigger-link:hover { background: var(--dsw-alias-interactive-bg-hover); }\n.dt-trigger-link:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }\n.dt-trigger-text { display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }\n.dt-kv-stack { display: flex; flex-direction: column; gap: 2px; min-width: 0; }\n.dt-banner-actions { margin-top: 6px; }\n@container (max-width: 640px) {\n  .dt-list > .dt-ticket { grid-template-columns: 1fr; row-gap: 4px; }\n  .dt-ticket-stage { border-right: 0; }\n}\n.dt-nav-group { margin: 10px 10px 2px; font-size: 12px; font-weight: 600; color: var(--dsw-alias-label-secondary); }\n.dt-nav-group:first-child { margin-top: 0; }\n.dt-prompt-nav .dt-nav-item { flex-direction: column; align-items: flex-start; gap: 2px; text-align: left; }\n.dt-nav-item > span { display: inline-flex; align-items: center; gap: 6px; }\n.dt-nav-item small { font-size: 12px; line-height: 18px; font-weight: 400; color: var(--dsw-alias-label-caption); }\n.dt-preview-part[data-editable] { border-left-color: var(--dsw-alias-brand-primary); }\n.dt-preview-head b { font-weight: 500; }\n.dt-preview-head > span { font-size: 12px; color: var(--dsw-alias-label-caption); }\n.dt-changed-tag { margin-left: 6px; padding: 0 5px; border: 0.5px solid var(--dsw-alias-border-l3); border-radius: 4px; font-size: 11px; line-height: 16px; font-weight: 400; color: var(--dsw-alias-label-secondary); }\n.dt-updated-tag { border-color: var(--dsw-alias-state-warn-primary); color: var(--dsw-alias-state-warn-primary); }\n.dt-default-updated { display: flex; flex-direction: column; gap: 6px; padding: 2px 0 2px 12px; border-left: 2px solid var(--dsw-alias-state-warn-primary); }\n.dt-diff-fold { color: var(--dsw-alias-label-caption); font-style: italic; }\n.dt-compare { margin-left: auto; }\n.dt-admission th { white-space: nowrap; }\n.dt-admission thead tr:first-child th:not(:first-child) { color: var(--dsw-alias-label-secondary); font-weight: 500; }\n.dt-admission td { vertical-align: middle; }\n.dt-admission-scope { color: var(--dsw-alias-label-primary); font-size: 13px; }\n.dt-admission-scope small { display: block; font-size: 11px; color: var(--dsw-alias-label-caption); }\n.dt-admission-na { color: var(--dsw-alias-label-caption); }\n.dt-admission-cell { display: flex; align-items: center; gap: 4px; }\n.dt-admission-cell .dt-select { flex: 1; min-width: 0; }\n.dt-admission-slot { display: inline-flex; flex: none; width: 16px; }\n.dt-info-warn { color: var(--dsw-alias-state-warn-primary); }\n.dt-field-segmented { max-width: 240px; }\n";

    /** 把移植过来的样式挂到 document 上，只挂一次。 */
    /**
     * 悬浮面板只保留「定位」用 inline style，视觉全部走 dt-* + token。
     * 以前这里是一整套自成体系的 inline style，和原生界面放一起能看出断层。
     */
    const DOCK_CSS = `
.sa-dock-panel { box-shadow: var(--dsw-elevation-prominent); padding: 10px 12px 8px; font-size: 12px; line-height: 1.55; }
.sa-dock-row { padding: 6px 0; }
.sa-dock-row + .sa-dock-row { border-top: 0.5px solid var(--dsw-alias-border-l3, currentColor); }
.sa-dock-foot { margin-top: 8px; padding-top: 8px; border-top: 0.5px solid var(--dsw-alias-border-l3, currentColor); color: var(--dsw-alias-label-caption, inherit); }
.sa-mono { font-family: ui-monospace, Consolas, monospace; font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
`

    function ensurePortedCss() {
      try {
        if (document.getElementById('dsh-zhuli-ported-css')) return
        const style = document.createElement('style')
        style.id = 'dsh-zhuli-ported-css'
        style.textContent = PORTED_CSS + DOCK_CSS
        document.head.appendChild(style)
      } catch {}
    }

    // ── 官方 GUI 原语（移植自 dsh-superagent 的 src/client/controls.tsx + widgets.tsx）──
    // 类名沿用官方 `dt-*`，样式由上面的 PORTED_CSS 提供，所以视觉与官方一致。
    const ICON_PATHS = {
      'chevron-left': 'M15 5l-7 7 7 7',
      'chevron-right': 'M9 5l7 7-7 7',
      'chevron-down': 'M5 9l7 7 7-7',
      search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4',
      question: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6M12 17h.01',
      plus: 'M12 5v14M5 12h14',
      trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
      refresh: 'M20 12a8 8 0 1 1-2.3-5.6M20 4v5h-5',
      clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v5l3 2',
      history: 'M3.5 12a8.5 8.5 0 1 0 2.5-6M3.5 4v4h4M12 8v4l3 2',
      shield: 'M12 3l7 3v6c0 4.2-2.9 7.6-7 9-4.1-1.4-7-4.8-7-9V6z',
      decision: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM8.5 12.5l2.5 2.5 4.5-5',
      message: 'M5 5h14a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H10l-5 4V6a1 1 0 0 1 1-1z',
      inbox: 'M4 13l2.5-8h11l2.5 8M4 13v6h16v-6M4 13h5l1 2h4l1-2h5',
      hash: 'M10 4L8 20M16 4l-2 16M5 9h15M4 15h15',
      filter: 'M4 5h16l-6 7.5V18l-4 2v-7.5z',
      user: 'M12 4a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM4 20c1.5-3.5 4.5-5 8-5s6.5 1.5 8 5',
      close: 'M6 6l12 12M18 6L6 18',
      settings: 'M4 7h10M18 7h2M4 17h4M12 17h8M16 5v4M10 15v4',
      external: 'M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5',
      session: 'M4 5h16v14H4zM8 10l3 2-3 2M13 15h3',
      stop: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM9.5 9.5h5v5h-5z',
      pause: 'M9 6v12M15 6v12',
      play: 'M8 5l11 7-11 7z',
      copy: 'M9 9h10v11H9zM5 15V4h10',
      alert: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7.5v5.5M12 16.5h.01',
      running: 'M12 3a9 9 0 1 0 9 9',
      blocked: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM5.6 5.6l12.8 12.8',
      queue: 'M4 6h16M4 12h16M4 18h10',
    }

    function Icon({ name, size = 16 }) {
      return h('svg', {
        width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
        stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round',
        'aria-hidden': 'true',
      }, h('path', { d: ICON_PATHS[name] || ICON_PATHS.question }))
    }

    const cx = (...names) => names.filter(Boolean).join(' ')

    function Btn({ variant = 'ghost', size = 'md', icon, children, className, ...rest }) {
      // className 必须最后合并：之前 ...rest 直接覆盖，导致 ConfirmBtn 的删除按钮丢掉全部样式
      return h('button', { type: 'button', ...rest, className: cx('dt-btn', 'dt-btn-' + variant, 'dt-btn-' + size, className) },
        icon !== undefined ? h('span', { className: 'dt-btn-icon' }, icon) : null,
        children)
    }

    function Tag({ tone = 'outline', title, children }) {
      return h('span', { className: 'dt-tag', 'data-tone': tone, title }, children)
    }

    /** 页级 tab 条：点当前页会再发一次 onChange（回调里可重置到根部）。 */
    function SegTabs({ items, value, onChange, label }) {
      const buttons = useRef({})
      const walk = (event) => {
        if (items.length === 0) return
        const values = items.map((item) => item.value)
        const index = values.indexOf(value)
        const target = { ArrowRight: index + 1, ArrowLeft: index - 1, Home: 0, End: values.length - 1 }[event.key]
        if (target === undefined) return
        event.preventDefault()
        const next = values[(target + values.length) % values.length]
        if (next !== value) {
          onChange(next)
          // 焦点跟随：旧页签变成 tabIndex=-1 后，键盘用户会掉出 tablist
          const nextButton = buttons.current[next]
          if (nextButton && typeof nextButton.focus === 'function') nextButton.focus()
        }
      }
      return h('div', {
        role: 'tablist', 'aria-label': label, className: 'dt-tabs', onKeyDown: walk,
        style: { gridTemplateColumns: 'repeat(' + items.length + ', minmax(0, 1fr))' },
      }, items.map((item) => h('button', {
        key: item.value, type: 'button', role: 'tab',
        ref: (node) => { buttons.current[item.value] = node },
        'aria-selected': item.value === value,
        tabIndex: item.value === value ? 0 : -1,
        className: 'dt-tab',
        onClick: () => onChange(item.value),
      }, item.label)))
    }

    function Input({ icon, ...rest }) {
      return h('span', { className: 'dt-input' },
        icon !== undefined ? h('span', { className: 'dt-input-icon' }, icon) : null,
        h('input', rest))
    }

    function Toggle({ checked, onChange, label }) {
      return h('button', {
        type: 'button', role: 'switch', 'aria-checked': !!checked, 'aria-label': label,
        className: 'dt-switch', onClick: () => onChange(!checked),
      }, h('span', { className: 'dt-switch-thumb' }))
    }

    function StateDot({ state, className }) {
      if (state === 'ongoing') {
        return h('svg', { className: 'dt-spinner', 'data-state': 'ongoing', width: 14, height: 14, viewBox: '0 0 24 24', 'aria-hidden': 'true' },
          h('g', null,
            h('circle', { cx: 12, cy: 12, r: 9.5 }),
            h('animateTransform', { attributeName: 'transform', type: 'rotate', from: '0 12 12', to: '360 12 12', dur: '1.6s', repeatCount: 'indefinite' })))
      }
      return h('span', { className: cx('dt-state-dot', className), 'data-state': state, 'aria-hidden': 'true' })
    }

    function Dot({ state, label }) {
      const dot = h(StateDot, { className: 'dt-dot', state })
      if (!label) return dot
      return h('span', { className: 'dt-dot-wrap', title: label, role: 'img', 'aria-label': label }, dot)
    }

    // 官方 Section 还支持 hint（说明）与 action（右上角动作），我们之前只有 title/count。
    function Section({ title, count, hint, action, children }) {
      return h('section', { className: 'dt-section' },
        title
          ? h('div', { className: 'dt-section-title' },
            h('span', { className: 'dt-section-name' }, title),
            count !== undefined && count !== null ? h('span', { className: 'dt-count' }, String(count)) : null,
            action ? h('span', { className: 'dt-subhead-actions' }, action) : null)
          : null,
        hint ? h(Hint, null, hint) : null,
        children)
    }

    /**
     * 第一次打开面板时的空态：官方那种「不是白屏，而是告诉你下一步做什么」。
     * 三步走完就能跑起来 —— 客户不用去翻 README。
     */
    function Onboarding({ onStart }) {
      return h('div', { className: 'dt-card' },
        h('div', { className: 'dt-card-head' },
          h('span', { className: 'dt-card-title' }, '三步让这个会话开始盯办')),
        h('ol', { className: 'dt-plain-list' },
          h('li', null, '① 填一个仓库（owner/name，比如 MYCF711/dsh-session-superagent）'),
          h('li', null, '② 选间隔（默认 60 秒；建议先设 300 秒，别把 API 打满）'),
          h('li', null, '③ 点「添加到当前会话」——之后仓库有动静，这个会话就会被叫醒')),
        h('div', { className: 'dt-actions' },
          h(Btn, { variant: 'primary', icon: h(Icon, { name: 'plus' }), onClick: onStart }, '去添加第一条')),
        h(Hint, null, '想先看看效果？在「触发」页勾上「仅观察」：它只记录本会唤醒哪几条，不会真打扰你。'))
    }

    /** 官方 DisclosureRow 的实际用法：默认收起，点开看明细。 */
    function CollapsibleList({ title, items }) {
      const [open, setOpen] = useState(false)
      return h(DisclosureRow, {
        title: title + '（' + items.length + '）',
        open, onToggle: () => setOpen(!open),
        icon: h(Icon, { name: 'question', size: 14 }),
        collapsedContent: h('span', { className: 'dt-hint' }, items[0] ? String(items[0]).slice(0, 40) : ''),
      },
        h('ul', { className: 'dt-plain-list' },
          items.map((text, index) => h('li', { key: index }, text))))
    }

    /** 官方 Pill：可切换的小胶囊（用于「全部 / 只看失败」这类就地过滤）。 */
    function Pill({ active, onClick, children }) {
      return h('button', {
        type: 'button', className: cx('dt-pill', active && 'dt-pill-active'),
        'aria-pressed': !!active, onClick,
      }, children)
    }

    /** 官方 SegmentedControl：单选分段（与 SegTabs 的页签语义不同，用于表单内的互斥选择）。 */
    function SegmentedControl({ options, value, onChange, label, disabled }) {
      return h('div', { className: 'dt-segmented', role: 'radiogroup', 'aria-label': label },
        options.map((option) => h('button', {
          key: option.value, type: 'button', role: 'radio',
          'aria-checked': value === option.value, 'aria-selected': value === option.value,
          className: 'dt-segment', disabled: disabled || option.disabled,
          onClick: () => onChange(option.value),
        }, option.label)))
    }

    /** 官方 DisclosureRow：折叠行的标准写法（Enter / 空格可切换，带 aria-expanded）。 */
    function DisclosureRow({ icon, title, open, onToggle, collapsedContent, children }) {
      return h('div', { className: 'dt-disclosure', 'data-open': open ? 'true' : undefined },
        h('div', {
          className: 'dt-disclosure-row', role: 'button', tabIndex: 0, 'aria-expanded': !!open,
          onClick: onToggle,
          onKeyDown: (event) => {
            if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onToggle() }
          },
        },
          h('span', { className: 'dt-disclosure-lead' },
            h('span', { className: 'dt-disclosure-icon' }, icon),
            h('span', { className: 'dt-disclosure-chevron' }, h(Icon, { name: open ? 'chevron-up' : 'chevron-down' }))),
          h('span', { className: 'dt-disclosure-title' }, title),
          !open ? collapsedContent : null),
        open ? children : null)
    }

    /** 官方 InfoTip：点一下出气泡（我们之前只有 dt-info 的样式，没有组件）。 */
    function InfoTip({ text, icon = 'question', warn }) {
      const [open, setOpen] = useState(false)
      return h('span', { style: { position: 'relative', display: 'inline-flex' } },
        h('button', {
          type: 'button', className: cx('dt-info', warn && 'dt-info-warn'),
          'aria-label': text, 'aria-expanded': open,
          onClick: () => setOpen(!open), onBlur: () => setOpen(false),
        }, h(Icon, { name: icon, size: 14 })),
        open ? h('span', { className: 'dt-tooltip', role: 'tooltip', style: { position: 'absolute', bottom: '130%', left: 0, visibility: 'visible' } }, text) : null)
    }

    const Hint = ({ children }) => h('p', { className: 'dt-hint' }, children)

    function KeyValues({ rows }) {
      return h('dl', { className: 'dt-kv' },
        rows.filter(Boolean).flatMap(([key, value]) => [
          h('dt', { key: key + '-k' }, key),
          h('dd', { key: key + '-v' }, value),
        ]))
    }

    // 官方 Modal 的键盘行为：Escape 关闭 + Tab 焦点陷阱 + 关闭后焦点回到触发元素。
    // 移植时只搬了样式，行为是后补的（2026-11-02 对官方 controls.tsx 逐行比对时发现）。
    const FOCUSABLE = 'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'
    function trapTab(event, dialog) {
      const items = [...dialog.querySelectorAll('*')].filter((element) => element.matches(FOCUSABLE))
      const first = items[0]
      const last = items[items.length - 1]
      const active = document.activeElement
      const target = event.shiftKey ? last : first
      if (!target || !dialog.contains(active) || active === dialog || active === (event.shiftKey ? first : last)) {
        event.preventDefault()
        target.focus()
      }
    }

    function Modal({ open, title, children, onClose }) {
      const dialog = useRef(null)
      const restoreTo = useRef(null)
      useEffect(() => {
        if (!open || typeof document === 'undefined') return undefined
        restoreTo.current = document.activeElement
        // 打开后把焦点挪进对话框，否则键盘用户还停在背后的页面上
        const timer = setTimeout(() => {
          const node = dialog.current
          if (!node) return
          const first = [...node.querySelectorAll('*')].filter((el) => el.matches(FOCUSABLE))[0]
          ;(first || node).focus()
        }, 0)
        const onKey = (event) => {
          if (event.key === 'Escape') { event.preventDefault(); onClose(); return }
          if (event.key === 'Tab' && dialog.current) trapTab(event, dialog.current)
        }
        document.addEventListener('keydown', onKey)
        return () => {
          clearTimeout(timer)
          document.removeEventListener('keydown', onKey)
          const back = restoreTo.current
          if (back && typeof back.focus === 'function') { try { back.focus() } catch {} }
        }
      }, [open, onClose])
      if (!open) return null
      // class 必须与移植来的官方 CSS 对齐：dt-modal-root / dt-modal-mask / dt-modal-header
      return h('div', { className: 'dt-modal-root' },
        h('div', { className: 'dt-modal-mask', role: 'presentation', onClick: onClose }),
        h('div', {
          ref: dialog, tabIndex: -1,
          className: 'dt-modal', role: 'dialog', 'aria-modal': 'true',
          'aria-label': typeof title === 'string' ? title : undefined,
        },
          h('div', { className: 'dt-modal-header' },
            h('span', { className: 'dt-title' }, title),
            h('button', { type: 'button', className: 'dt-modal-close', onClick: onClose, 'aria-label': '关闭' }, h(Icon, { name: 'close' }))),
          h('div', { className: 'dt-modal-body' }, children)))
    }

    /** 危险操作二次确认：点一次变成「确定吗」，再点才执行。 */
    function ConfirmBtn({ label, confirmLabel = '确定执行', onConfirm, variant = 'ghost', icon, size }) {
      const [armed, setArmed] = useState(false)
      return h(Btn, {
        variant,
        size,
        className: armed ? 'dt-danger' : undefined,
        icon,
        'aria-label': armed ? confirmLabel : label,
        onClick: () => {
          if (!armed) { setArmed(true); return }
          setArmed(false)
          onConfirm()
        },
        onBlur: () => setArmed(false),
      }, armed ? confirmLabel : label)
    }

    const watcherId = (w) => (w && w.id) || String((w && w.repo) || '') + '#' + String((w && w.sessionId) || '')
    const short = (value, width = 19) => (typeof value === 'string' && value.length > width ? value.slice(0, width - 1) + '…' : (value ?? '—'))
    const when = (iso) => (typeof iso === 'string' ? iso.replace('T', ' ').replace('Z', '').slice(5, 19) : '—')

    // ── orbit badge: session header indicator ──────────────────────────────
    // Static geometry, three states: green dot orbiting (watching), amber dot on
    // a dashed ring (paused), red dot breathing (error). Icon only — the text
    // lives in the native tooltip so it does not compete with the session title.
    // ── status orbit: composer-dock indicator ─────────────────────────────
    // One ring for the whole machine. Every satellite on the ring is one
    // session-level superagent (a live watcher): green = watching, amber =
    // paused, red = last poll failed. Icon only — details live in the
    // click-through panel, and a native tooltip carries the one-line summary.
    /**
     * 现在是否落在活跃时段里。支持跨夜（22:00-06:00）。
     * 解析不了就返回 null —— 宁可显示「主理中」，也不要乱标。
     */
    function inWindowNow(hours) {
      const match = String(hours || '').match(/^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/)
      if (!match) return null
      const now = new Date()
      const current = now.getHours() * 60 + now.getMinutes()
      const from = Number(match[1]) * 60 + Number(match[2])
      const to = Number(match[3]) * 60 + Number(match[4])
      return from <= to ? current >= from && current < to : current >= from || current < to
    }

    function orbitStateOf(w) {
      if (!w) return 'paused'
      if (w.lastError) return 'error'
      if (w.enabled === false) return 'paused'
      // 设了活跃时段、而此刻在窗口外：它其实不会唤醒，只是把条目攒着 ——
      // 这时候还标「主理中」就是在骗人（2026-11-02 用户截图指出）。
      if (w.activeHours && inWindowNow(w.activeHours) === false) return 'dormant'
      return 'active'
    }

    // 状态色一律走 token（写死 hex 在深色/浅色两套主题里会有一个是错的）
    const SAT_COLOR = {
      active: 'var(--dsw-alias-state-success-primary)',
      paused: 'var(--dsw-alias-state-warn-primary)',
      error: 'var(--dsw-alias-state-error-primary)',
      dormant: 'var(--dsw-alias-label-caption)',
    }
    const STATE_TEXT = { active: '主理中', paused: '已暂停', error: '异常', dormant: '时段外' }

    /** 尊重系统的「减少动态效果」设置。 */
    const prefersReducedMotion = () => {
      try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches } catch { return false }
    }

    function OrbitMark(props) {
      const watchers = props.watchers || []
      const shown = watchers.slice(0, 6)
      const states = watchers.map(orbitStateOf)
      const anyActive = states.indexOf('active') >= 0
      // Zero watchers still draws the ring, just grey: an idle machine should
      // read as "nothing being watched", not as "the plugin is broken".
      const empty = states.length === 0
      const ringColor = empty
        ? 'currentColor'
        : states.indexOf('error') >= 0
          ? SAT_COLOR.error
          : anyActive ? SAT_COLOR.active : states.indexOf('dormant') >= 0 ? SAT_COLOR.dormant : SAT_COLOR.paused
      const dashed = states.indexOf('paused') >= 0
      const still = prefersReducedMotion()

      const dots = shown.map((w, i) => {
        const angle = (i / Math.max(shown.length, 1)) * Math.PI * 2 - Math.PI / 2
        const state = orbitStateOf(w)
        return h('circle', {
          key: String(w.repo || '') + '#' + String(w.sessionId || i),
          cx: 8 + Math.cos(angle) * 6.1,
          cy: 8 + Math.sin(angle) * 6.1,
          r: shown.length > 3 ? 1.75 : 2.05,
          fill: SAT_COLOR[state],
        }, state === 'error' && !still
          ? h('animate', { attributeName: 'opacity', values: '1;.3;1', dur: '1.6s', repeatCount: 'indefinite' })
          : null)
      })

      // 动画用 SMIL 写进 SVG 本身：不依赖注入的 <style>，也不吃 CSP /
      // transform-box 的差异；单独存成 .html 就能预览。
      const spin = anyActive && !still
        ? h('animateTransform', {
          attributeName: 'transform', type: 'rotate',
          from: '0 8 8', to: '360 8 8', dur: '6s', repeatCount: 'indefinite',
        })
        : null
      const breathe = anyActive && !still
        ? h('animate', { attributeName: 'opacity', values: '.95;.45;.95', dur: '2.6s', repeatCount: 'indefinite' })
        : null

      return h('svg', {
        width: 16, height: 16, viewBox: '0 0 16 16', 'aria-hidden': 'true',
        style: { overflow: 'visible' },
      },
        h('circle', {
          cx: 8, cy: 8, r: 6.1, fill: 'none', stroke: ringColor, strokeWidth: 1.1,
          strokeDasharray: dashed ? '2.2 1.9' : undefined,
          opacity: empty ? 0.38 : 0.9,
        }, breathe),
        h('g', null, spin, dots))
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

    /** 把 filters 压成一行人话，空配置返回空串。 */
    const filterText = (f) => {
      if (!f) return ''
      const parts = []
      if (f.labels && f.labels.length) parts.push('标签: ' + f.labels.join(','))
      if (f.ignoreLabels && f.ignoreLabels.length) parts.push('排除: ' + f.ignoreLabels.join(','))
      if (f.onlyAssigned) parts.push(f.assignee ? '只看指派给 @' + f.assignee : '只看已指派')
      return parts.join(' · ')
    }

    /** 只留路径最后两段，面板里放得下。 */
    const pathTail = (value) => String(value || '')
      .split(String.fromCharCode(92)).join('/')
      .split('/').filter(Boolean).slice(-2).join('/')

    /** 隔离执行状态：开着隔离就显示上次用的 worktree。 */
    const isolationText = (w) => {
      if (!w || !w.isolated) return ''
      return '隔离 · ' + (pathTail(w.lastWorktree) || pathTail(w.workdir) || '未建')
    }

    /** 最近一次唤醒的结果（面板第二行用）。 */
    const historyText = (w) => {
      const list = (w && w.history) || []
      const last = list[list.length - 1]
      if (!last) return ''
      const nums = (last.numbers || []).map((n) => '#' + n).join(' ')
      return (last.ok ? '上次唤醒 ' : '上次唤醒失败 ') + nums + ' · ' + ageText(last.at)
    }

    /** 失败退避中显示剩余秒数，否则空串。 */
    const backoffText = (w) => {
      if (!w || !w.nextAt) return ''
      const left = Date.parse(w.nextAt) - Date.now()
      if (!isFinite(left) || left <= 0) return ''
      return '退避 ' + Math.ceil(left / 1000) + 's'
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
      // Never hide the entry: with nothing being watched it stays as a grey
      // ring, so the affordance is always findable in the dock row.
      const running = list.filter((w) => orbitStateOf(w) === 'active').length
      const broken = list.filter((w) => orbitStateOf(w) === 'error').length
      const summary = list.length === 0
        ? '还没有主理鱼'
        : '会话级 superagent：' + running + ' 运行中'
          + (broken ? '，' + broken + ' 异常' : '')
          + '（共 ' + list.length + ' 条）'

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
          : '还没有主理鱼 —— 在「主理鱼」页加一条',
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

      // 空态没什么内容，窄一点更像提示而不是一张空表格
      const width = list.length === 0 ? 252 : PANEL_W
      const left = anchor
        ? Math.max(8, Math.min(anchor.x - width / 2, (window.innerWidth || 1200) - width - 8))
        : 8
      const bottom = anchor ? Math.max(8, (window.innerHeight || 800) - anchor.y + 8) : 64

      const act = async (w, action) => {
        if (action === 'delete') {
          const ok = typeof window !== 'undefined' && typeof window.confirm === 'function'
            ? window.confirm('删除主理鱼 ' + (w.repo || '') + '？')
            : true
          if (!ok) return
        }
        try {
          await call('/watch', { method: 'POST', body: JSON.stringify({ action, id: watcherId(w) }) })
        } catch {}
        try {
          const body = await call('/state')
          setWatchers(Array.isArray(body && body.watchers) ? body.watchers : [])
        } catch {}
      }

      // 悬浮面板也走移植来的 dt-* 设计系统（以前这里是一套自成体系的 inline style，
      // 和原生界面放在一起能看出断层；ui-audit ⑥ 就是在盯这件事）。
      const rows = list.map((w) => {
        const state = orbitStateOf(w)
        const extra = [
          filterText(w.filters),
          w.activeHours ? '时段 ' + w.activeHours : '',
          isolationText(w),
          backoffText(w),
          historyText(w),
          w.lastDeferred,
        ].filter(Boolean).join(' · ')
        return h('div', {
          key: String(w.repo || '') + '#' + String(w.sessionId || ''),
          className: 'dt-row sa-dock-row',
        },
          h('div', { className: 'dt-row-main' },
            h('div', { className: 'dt-row-title' },
              h('span', { className: 'dt-dot-wrap' },
                h('span', { className: 'dt-state-dot', 'data-state': state === 'active' ? 'done' : state === 'paused' ? 'warning' : state === 'error' ? 'error' : 'idle' })),
              h('span', { className: 'sa-mono' }, String(w.repo || '?')),
              h('span', { className: 'dt-row-meta' }, STATE_TEXT[state])),
            h('div', { className: 'dt-hint' }, (w.title || '未命名会话') + ' · ' + sessionTag(w.sessionId)),
            h('div', { className: 'dt-hint' }, '每 ' + w.intervalSec + 's · 轮询 ' + ageText(w.lastPoll) + ' · 唤醒 ' + wakeText(w.lastWake)),
            extra ? h('div', { className: 'dt-hint' }, extra) : null,
            w.goal && w.goal.objective
              ? h('div', { className: 'dt-hint' }, 'goal · ' + String(w.goal.objective).slice(0, 60))
              : null,
            w.lastError ? h('div', { className: 'dt-error' }, String(w.lastError).slice(0, 160)) : null),
          h('div', { className: 'dt-row-actions' },
            h(Btn, { size: 'sm', variant: 'ghost', onClick: () => act(w, 'poll') }, '立刻'),
            h(Btn, { size: 'sm', variant: 'ghost', onClick: () => act(w, w.enabled ? 'pause' : 'resume') },
              w.enabled ? '暂停' : '恢复'),
            h(ConfirmBtn, {
              label: '删除', confirmLabel: '确认删除', variant: 'ghost', size: 'sm',
              onConfirm: () => act(w, 'delete'),
            })))
      })

      const panel = h('div', {
        ref: panelRef, role: 'dialog', 'aria-label': summary, className: 'dt-card sa-dock-panel',
        style: { position: 'fixed', left, bottom, width, zIndex: 2147483000, maxHeight: 360, overflow: 'auto' },
      },
        h('div', { className: 'dt-card-head' },
          h('span', { className: 'dt-card-title' }, '主理鱼'),
          h('span', { className: 'dt-count' }, list.length === 0 ? '0 条' : running + '/' + list.length + ' 主理中')),
        list.length === 0
          ? h('div', { className: 'dt-hint' }, '在「主理鱼」页填 owner/name 加一条。')
          : h('div', { className: 'dt-rows' }, rows),
        list.length > 0
          ? h('div', { className: 'sa-dock-foot' }, '点「暂停 / 删除」直接停掉；「主理鱼」标签页可新增与配置凭证')
          : null)

      return h(React.Fragment, null, button, panel)
    }


    // ── 主理鱼面板（按官方 GUI 的信息架构重写：总览 / 触发 / 设置）────────────────
    // 布局、类名、控件都来自上面移植的 dt-* 设计系统，数据和动作接我们自己的 /state、/watch。
    // ── 官方 GUI 的三个交互件（移植自 src/client/provider.tsx + draft.tsx + src/client/controls.tsx）──

    /** 轮询：可见时按 interval，隐藏时降频 6 倍；上一轮没跑完就跳过；卸载时清干净。 */
    function usePoll(task, intervalMs = POLL_MS) {
      const ref = useRef(task)
      ref.current = task
      const busy = useRef(false)
      useEffect(() => {
        let alive = true
        let timer = null
        let discovered = false
        const step = async () => {
          if (!alive) return
          if (!discovered) {
            discovered = true
            try { await discoverBase() } catch {}
          }
          const hidden = typeof document !== 'undefined' && document.hidden === true
          const delay = hidden ? intervalMs * 6 : intervalMs
          if (!busy.current) {
            busy.current = true
            try { await ref.current() } catch {}
            finally { busy.current = false }
          }
          if (alive) timer = setTimeout(step, delay)
        }
        step()
        return () => { alive = false; if (timer) clearTimeout(timer) }
      }, [intervalMs])
    }

    /** 轻量 Toast：右下角堆叠，4 秒自动消失。 */
    function useToast() {
      // 官方 .dt-toast 是 position:fixed 顶部居中、且带自动淡出动画 —— 同时挂两条会重叠，
      // 所以这里保持「同一时刻只有最新一条」，停留时长用官方的 --dt-toast-hold 控制。
      const [item, setItem] = useState(null)
      const timer = useRef(null)
      useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])
      const notify = useCallback((text, tone = 'info') => {
        if (timer.current) clearTimeout(timer.current)
        setItem({ id: Math.random().toString(36).slice(2), text, tone })
        timer.current = setTimeout(() => setItem(null), 4000)
      }, [])
      const view = item === null ? null : h('div', {
        className: cx('dt-toast', item.tone === 'error' && 'dt-danger'),
        role: 'status',
        'aria-live': 'polite',
        // 官方 toast 是深底白字；错误态不要改成浅红底（白字会看不清），改用左侧红条标记
        style: item.tone === 'error'
          ? { '--dt-toast-hold': '3600ms', borderLeft: '3px solid var(--dsw-alias-state-error-primary)' }
          : { '--dt-toast-hold': '3600ms' },
      }, item.text)
      return [view, notify]
    }

    function ZhuliPanel(props) {
      const sessionId = props && props.sessionId
      /** 暂停原因码 → 人话（服务端 deferReason 是唯一来源）。 */
      const DEFER_LABELS = {
        'active-hours': '不在活跃时段',
        ratelimit: '被 GitHub 限流',
        quota: '额度紧张',
        unchanged: '没有变化',
        observe: '仅观察',
        'cap-session': '撞会话上限',
        'cap-watcher': '撞单守上限',
        busy: '会话忙',
      }

      const [snap, setSnap] = useState({ loading: true, error: null, body: null })
      const [tab, setTab] = useState('overview')
      const [notice, setNotice] = useState(null)
      const [form, setForm] = useState({
        repo: '', intervalSec: '60', goal: '', labels: '', onlyAssigned: false,
        activeHours: '', isolated: false, workdir: '',
      })
      const [token, setToken] = useState('')
      const [goalDraft, setGoalDraft] = useState('')
      const [goalTouched, setGoalTouched] = useState(false)
      const [toastView, notify] = useToast()
      const [editing, setEditing] = useState(null)
      const [draft, setDraft] = useState({})
      const [search, setSearch] = useState('')
      const [glossary, setGlossary] = useState(false)
      // 版本检查结果（只读）：面板里直接告诉客户「有没有新版本、该跑什么命令」
      const [update, setUpdate] = useState(null)
      const [checking, setChecking] = useState(false)
      // 设置页用官方的「左栏 + 内容」结构（dt-settings），所以要记当前分区
      const [settingsSection, setSettingsSection] = useState('source')
      // 判定页：点「跳过原因」标签就只看这一类（知识库里记的"还没做"，本轮补上）
      const [reasonFilter, setReasonFilter] = useState(null)
      // 行内徽章可点：点「只读」就只看只读的守（与跳过原因筛选同一套交互）
      const [badgeFilter, setBadgeFilter] = useState(null)
      // 只看有问题的：放在最后追加，避免打乱测试桩按位置取值的队列
      const [problemsOnly, setProblemsOnly] = useState(false)
      // 建议规则弹层：给"叫醒了没回音"一个下一步动作（只提供可复制的规则，不替客户写仓库文件）

      const load = useCallback(async () => {
        try {
          const payload = await call('/state', stateEtag ? { headers: { 'if-none-match': stateEtag } } : undefined)
          // 304：内容没变，别白白重渲染
          if (payload && payload.notModified) return null
          const body = payload
          setSnap({ loading: false, error: null, body })
          return body
        } catch (error) {
          setSnap((prev) => ({ loading: false, error: String((error && error.message) || error), body: prev.body }))
          return null
        }
      }, [])

      useEffect(() => { ensurePortedCss() }, [])
      usePoll(load, POLL_MS)

      const body = snap.body || {}
      const watchers = body.watchers || []
      const sessionGoal = body.sessionGoal || null
      const credentials = body.credentials || { token: 'none', sshKeyPath: 'none' }

      useEffect(() => {
        if (goalTouched || !sessionGoal) return
        setGoalDraft(sessionGoal.objective || '')
      }, [goalTouched, sessionGoal])

      const busyRef = useRef(false)
      const run = async (work, done) => {
        if (busyRef.current) return
        busyRef.current = true
        setNotice(null)
        try {
          await work()
          if (done) notify(done)
          await load()
        } catch (error) {
          const text = String((error && error.message) || error)
          setNotice({ ok: false, text })
          notify(text, 'error')
        } finally {
          busyRef.current = false
        }
      }

      /** 保存某条 watcher 的编辑（同一 repo+sessionId 即更新，enabled 不传 = 保持原值）。 */
      const saveEdit = (watcher) => run(async () => {
        await call('/watch', {
          method: 'POST',
          body: JSON.stringify({
            repo: watcher.repo,
            sessionId: watcher.sessionId,
            intervalSec: Number(draft.intervalSec) || watcher.intervalSec,
            filters: {
              labels: String(draft.labels || '').split(',').map((v) => v.trim()).filter(Boolean),
              onlyAssigned: !!draft.onlyAssigned,
            },
            activeHours: draft.activeHours || '',
            goal: draft.goal || '',
            isolated: !!draft.isolated,
            workdir: draft.workdir || '',
            observe: !!draft.observe,
            isolateKeepDays: Number(draft.isolateKeepDays) || undefined,
            maxIsolated: Number(draft.maxIsolated) || undefined,
            priority: {
              reopened: draft.priorityReopened !== false,
              comments: draft.priorityComments !== false,
              labels: draft.priorityLabels !== false,
              unassigned: draft.priorityUnassigned === true,
              stale: draft.priorityStale === true,
            },
            batchLimit: Number(draft.batchLimit) || undefined,
            maxWakesPerHour: Number(draft.maxWakesPerHour) || undefined,
            sessionMaxWakes: Number(draft.sessionMaxWakes) || undefined,
          }),
        })
        setEditing(null)
      }, '已保存：' + watcher.repo)

      const act = (watcher, action) => run(async () => {
        await call('/watch', { method: 'POST', body: JSON.stringify({ action, id: watcherId(watcher) }) })
      }, action === 'delete' ? '已删除 ' + watcher.repo : action === 'poll' ? '已触发一次轮询：' + watcher.repo : null)

      const actBulk = (action) => run(async () => {
        for (const watcher of watchers) {
          if (action === 'pause' && !watcher.enabled) continue
          if (action === 'resume' && watcher.enabled) continue
          await call('/watch', { method: 'POST', body: JSON.stringify({ action, id: watcherId(watcher) }) })
        }
      }, action === 'pause' ? '全部已暂停' : '全部已恢复')

      const addWatcher = () => run(async () => {
        const created = await call('/watch', {
          method: 'POST',
          body: JSON.stringify({
            repo: form.repo.trim(),
            intervalSec: Number(form.intervalSec) || 60,
            goal: form.goal,
            sessionId,
            filters: {
              labels: String(form.labels || '').split(',').map((v) => v.trim()).filter(Boolean),
              onlyAssigned: !!form.onlyAssigned,
            },
            activeHours: form.activeHours || '',
            isolated: !!form.isolated,
            workdir: form.workdir || '',
            observe: !!form.observe,
            batchLimit: Number(form.batchLimit) || undefined,
            maxWakesPerHour: Number(form.maxWakesPerHour) || undefined,
          }),
        })
        setForm({ repo: '', intervalSec: form.intervalSec, goal: '', labels: '', onlyAssigned: false, activeHours: form.activeHours, isolated: form.isolated, workdir: form.workdir, observe: form.observe })
        // 添加前体检的警告直接说出来：填错仓库名 / 只读 / 归档，这一刻讲最省事
        const warnings = (created && Array.isArray(created.warnings)) ? created.warnings : []
        if (warnings.length > 0) notify('已添加，但注意：' + warnings.join(' ／ '), 'error')
        else notify('已添加，首轮立即开始轮询', 'info')
        return warnings
      }, null)

      const saveCredentials = () => run(async () => {
        const payload = {}
        if (token.trim()) payload.token = token.trim()
        await call('/credentials', { method: 'POST', body: JSON.stringify(payload) })
        setToken('')
      }, '凭证已保存')

      const saveGoal = () => run(async () => {
        await call('/goal', { method: 'POST', body: JSON.stringify({ sessionId, objective: goalDraft }) })
        setGoalTouched(false)
      }, 'goal 已保存')

      const running = watchers.filter((w) => orbitStateOf(w) === 'active').length
      const broken = watchers.filter((w) => orbitStateOf(w) === 'error').length
      const paused = watchers.filter((w) => w.enabled === false).length

      const stateTag = (watcher) => {
        const state = orbitStateOf(watcher)
        const tone = state === 'active' ? 'success' : state === 'paused' ? 'warning' : state === 'dormant' ? 'outline' : 'danger'
        return h(Tag, { tone, title: state === 'dormant' ? '不在活跃时段：只攒条目，不唤醒' : undefined }, STATE_TEXT[state])
      }

      // 行结构对齐官方 rows.tsx 的 TicketLine：dt-ticket（左侧状态列）+ dt-open 标题 + dt-ticket-actions。
      // 标题本身是按钮 —— 官方就是点标题进详情，我们点标题展开行内编辑，交互更轻但不脱离这套结构。
      const STAGE_STATE = { active: undefined, paused: 'warning', error: 'error', dormant: 'warning' }
      const row = (watcher) => {
        const key = watcher.repo + '#' + watcher.sessionId
        const state = orbitStateOf(watcher)
        const rowBody = h('div', { className: 'dt-ticket-body' },
          h('div', { className: 'dt-row-title' },
            h('button', {
              type: 'button', className: 'dt-open', title: '展开或收起这条主理鱼的设置',
              'aria-expanded': editing === key, onClick: () => {
                setEditing(editing === key ? null : key)
                setDraft({
                  intervalSec: String(watcher.intervalSec ?? 60),
                  labels: (watcher.filters && watcher.filters.labels ? watcher.filters.labels : []).join(','),
                  activeHours: watcher.activeHours || '',
                  goal: watcher.note || watcher.goal || '',
                  onlyAssigned: !!(watcher.filters && watcher.filters.onlyAssigned),
                  // 下面这些以前没填 —— 打开一条隔离执行的守再直接保存，会把 isolated 写回 false
                  observe: !!watcher.observe,
                  isolated: !!watcher.isolated,
                  workdir: watcher.workdir || '',
                  batchLimit: watcher.batchLimit ? String(watcher.batchLimit) : '',
                  maxWakesPerHour: watcher.maxWakesPerHour ? String(watcher.maxWakesPerHour) : '',
                  sessionMaxWakes: watcher.sessionMaxWakes ? String(watcher.sessionMaxWakes) : '',
                  isolateKeepDays: watcher.isolateKeepDays ? String(watcher.isolateKeepDays) : '',
                  maxIsolated: watcher.maxIsolated ? String(watcher.maxIsolated) : '',
                  priorityReopened: (watcher.priority && watcher.priority.reopened) !== false,
                  priorityComments: (watcher.priority && watcher.priority.comments) !== false,
                  priorityLabels: (watcher.priority && watcher.priority.labels) !== false,
                  priorityUnassigned: Boolean(watcher.priority && watcher.priority.unassigned) === true,
                  priorityStale: Boolean(watcher.priority && watcher.priority.stale) === true,
                })
              },
            }, watcher.repo)),
          h('div', { className: 'dt-row-meta dt-ticket-meta' },
            stateTag(watcher),
            ...repoBadges(watcher.repoAccess).map((badge) => h(Pill, {
              key: 'b-' + badge.text,
              active: badgeFilter === badge.text,
              onClick: () => setBadgeFilter(badgeFilter === badge.text ? null : badge.text),
            }, badge.text)),
            watcher.observe ? h(Tag, { tone: 'warning' }, '仅观察') : null,
            watcher.activeHours ? h(Tag, null, '时段 ' + watcher.activeHours) : null,
            watcher.isolated ? h(Tag, null, isolationText(watcher)) : null,
            filterText(watcher.filters) ? h(Tag, null, filterText(watcher.filters)) : null,
            backoffText(watcher) ? h(Tag, { tone: 'warning' }, backoffText(watcher)) : null),
          h('div', { className: 'dt-ticket-note' },
            [
              (watcher.title || '未命名会话') + ' · ' + sessionTag(watcher.sessionId),
              '每 ' + watcher.intervalSec + 's',
              '轮询 ' + ageText(watcher.lastPoll),
              '唤醒 ' + wakeText(watcher.lastWake),
              historyText(watcher),
              watcher.note ? '目标: ' + String(watcher.note).slice(0, 40) : '',
            ].filter(Boolean).join(' · ')),
          watcher.lastDeferred ? h('div', { className: 'dt-ticket-note' }, watcher.lastDeferred) : null,
          watcher.lastError ? h('div', { className: 'dt-ticket-note dt-ticket-note-error' }, String(watcher.lastError).slice(0, 160)) : null,
          h('div', { className: 'dt-ticket-actions' },
            h(Btn, { size: 'sm', variant: 'outline', icon: h(Icon, { name: 'refresh' }), onClick: () => act(watcher, 'poll') }, '立刻'),
            h(Btn, {
              size: 'sm', variant: 'ghost',
              icon: h(Icon, { name: watcher.enabled ? 'pause' : 'play' }),
              label: watcher.enabled ? '暂停' : '恢复',
              onClick: () => act(watcher, watcher.enabled ? 'pause' : 'resume'),
            }, watcher.enabled ? '暂停' : '恢复'),
            h(ConfirmBtn, {
              size: 'sm', variant: 'ghost', icon: h(Icon, { name: 'trash' }), label: '删除',
              confirmLabel: '确认删除', onConfirm: () => act(watcher, 'delete'),
            })))
        const editor = editing === key
          ? h('div', { className: 'dt-fieldset' },
            field('间隔（秒）', h(Input, { value: draft.intervalSec, onChange: (e) => setDraft({ ...draft, intervalSec: e.target.value }) }), '多长时间检查一次这个仓库，最小 30 秒'),
            field('只处理这些标签', h(Input, { value: draft.labels, placeholder: '逗号分隔，留空 = 全部', onChange: (e) => setDraft({ ...draft, labels: e.target.value }) })),
            field('活跃时段', h(Input, { value: draft.activeHours, placeholder: '09:00-23:00，留空 = 全天', onChange: (e) => setDraft({ ...draft, activeHours: e.target.value }) }), '只在这个时间段内唤醒；窗口外只攒条目，不打扰'),
            field('目标/规则', h(Input, { value: draft.goal || '', placeholder: '可选，会附在唤醒消息里', onChange: (e) => setDraft({ ...draft, goal: e.target.value }) })),
            h('label', { className: 'dt-switch-row' }, h(Toggle, { checked: !!draft.onlyAssigned, onChange: (v) => setDraft({ ...draft, onlyAssigned: v }), label: '只看已指派' }), '只处理已指派给人的条目'),
            field('单次最多唤醒条数', h(Input, { value: draft.batchLimit || '', placeholder: '5（1-20）', onChange: (e) => setDraft({ ...draft, batchLimit: e.target.value }) })),
            field('每小时最多唤醒次数', h(Input, { value: draft.maxWakesPerHour || '', placeholder: '6（1-60）', onChange: (e) => setDraft({ ...draft, maxWakesPerHour: e.target.value }) })),
            field('这条会话每小时最多被唤醒', h(Input, { value: draft.sessionMaxWakes || '', placeholder: '12（1-60）', onChange: (e) => setDraft({ ...draft, sessionMaxWakes: e.target.value }) }), '跨所有守累计：守 5 个仓库时，光有单守上限挡不住叠加'),
            field('优先级（一次只处理 N 条时先挑谁）', h('div', { className: 'dt-actions' },
              h('label', { className: 'dt-switch-row' }, h(Toggle, { checked: draft.priorityReopened !== false, onChange: (v) => setDraft({ ...draft, priorityReopened: v }), label: '重开优先' }), '被重开的排最前'),
              h('label', { className: 'dt-switch-row' }, h(Toggle, { checked: draft.priorityComments !== false, onChange: (v) => setDraft({ ...draft, priorityComments: v }), label: '评论优先' }), '有人在等回应的靠前'),
              h('label', { className: 'dt-switch-row' }, h(Toggle, { checked: draft.priorityLabels !== false, onChange: (v) => setDraft({ ...draft, priorityLabels: v }), label: '标签优先' }), '带标签的靠前'),
              h('label', { className: 'dt-switch-row' }, h(Toggle, { checked: draft.priorityUnassigned === true, onChange: (v) => setDraft({ ...draft, priorityUnassigned: v }), label: '未认领优先' }), '没人认领的靠前（默认关：这是我们的判断，不是规则）'),
              h('label', { className: 'dt-switch-row' }, h(Toggle, { checked: draft.priorityStale === true, onChange: (v) => setDraft({ ...draft, priorityStale: v }), label: '积压优先' }), '躺了 30 天以上的靠前（默认关，只展示）')), '全部关掉时按 GitHub 的「最近更新」顺序处理'),
            h('label', { className: 'dt-switch-row' }, h(Toggle, { checked: !!draft.observe, onChange: (v) => setDraft({ ...draft, observe: v }), label: '仅观察' }), '仅观察（只记录不唤醒）'),
            h('label', { className: 'dt-switch-row' }, h(Toggle, { checked: !!draft.isolated, onChange: (v) => setDraft({ ...draft, isolated: v }), label: '隔离执行' }), '隔离执行（每次唤醒开一次性 worktree）'),
            draft.isolated ? field('隔离工作目录', h(Input, { value: draft.workdir || '', placeholder: '绝对路径，留空 = 当前工作目录', onChange: (e) => setDraft({ ...draft, workdir: e.target.value }) })) : null,
            draft.isolated ? field('隔离区保留天数', h(Input, { value: draft.isolateKeepDays || '', placeholder: '3（1-30）', onChange: (e) => setDraft({ ...draft, isolateKeepDays: e.target.value }) }), '每次唤醒前回收这个天数之前的一次性工作区；留空用默认 3 天') : null,
            draft.isolated ? field('最多保留几个隔离区', h(Input, { value: draft.maxIsolated || '', placeholder: '5（1-50）', onChange: (e) => setDraft({ ...draft, maxIsolated: e.target.value }) }), '天数之外的第二道线：超出就回收最旧的（不影响正在用的那个）') : null,
            h('div', { className: 'dt-actions' },
              h(Btn, { size: 'sm', variant: 'primary', onClick: () => saveEdit(watcher) }, '保存'),
              h(Btn, { size: 'sm', onClick: () => setEditing(null) }, '放弃')))
          : null
        // 官方 TicketLine 是 <li class="dt-row dt-link dt-ticket"> 里套「状态列 + 正文列」，
        // 展开的表单跟在正文列里，不破坏两列网格。
        const bodyChildren = [].concat(rowBody.props.children || []).filter(Boolean)
        return h('li', {
          key,
          className: 'dt-row dt-link dt-ticket',
          'data-state': state === 'error' ? 'error' : undefined,
        },
          h('div', { className: 'dt-ticket-stage' },
            h('span', { className: 'dt-stage', 'data-state': STAGE_STATE[state] }, STATE_TEXT[state])),
          h('div', { className: 'dt-ticket-body' }, ...bodyChildren, editor))
      }

      const problems = []
      // 按暂停原因筛选时，「需要关注」也一起收窄（否则列表和告警会自相矛盾）
      const deferFilter = reasonFilter && reasonFilter.startsWith('defer:') ? reasonFilter.slice(6) : null
      for (const watcher of watchers) {
        if (deferFilter && watcher.deferReason !== deferFilter) continue
        // 仓库结构问题（关闭 Issues / 是 fork）比轮询失败更早该说：它注定收不到条目
        const structure = repoStructureNote(watcher.repoAccess)
        if (structure) problems.push({ key: 's-' + watcher.repo, text: structure })
        // 只读：以前只在行内显示一个徽章，客户在「需要关注」里看不到，也不知道回写会 403
        const readOnly = accessNoteForPanel(watcher.repoAccess)
        if (readOnly) problems.push({ key: 'ro-' + watcher.repo, text: readOnly })
        // 叫醒了但没回音：守在工作、消息也进去了，但会话没动手（规则缺失或被忽略）
        if (Number(watcher.silentWakes) >= 2) {
          problems.push({
            key: 'silent-' + watcher.repo,
            text: watcher.repo + ' 已连续 ' + watcher.silentWakes + ' 次唤醒后没有回音（没看到 watch_ack）—— 检查这个仓库的 AGENTS.md 有没有给出处理规则',
            action: { label: '看建议规则', onClick: () => setGlossary('rules:' + watcher.repo) },
          })
        }
        // 被反复重开的条目：说明"之前判过不做"可能有问题，值得人看一眼
        if (watcher.lastReopened) {
          problems.push({ key: 'r-' + watcher.repo, text: watcher.repo + ' #' + watcher.lastReopened + ' 被重新打开过 —— 之前判"不做"可能不对' })
        }
        if (structure) problems.push({ key: 's-' + watcher.repo, text: structure })
        if (watcher.lastError) problems.push({ key: 'e-' + watcher.repo, text: watcher.repo + ' 轮询失败：' + watcher.lastError })
        else if (watcher.lastDeferred) problems.push({ key: 'd-' + watcher.repo, text: watcher.repo + ' 暂停唤醒：' + watcher.lastDeferred })
      }
      if (body.gh && body.gh.ok === false && credentials.token === 'none') {
        problems.push({ key: 'gh', text: 'gh CLI 不可用，且没有配置 token —— 现在所有轮询都会失败。先跑 gh auth login，或在「设置 → 来源」填一个 token。' })
      }
      if (watchers.length > 0 && credentials.token === 'none') {
        problems.push({ key: 'cred', text: '未配置 token，正在复用已登录的 gh CLI（可用 panel 填 token 换成独立凭据）' })
      }

      const needle = search.trim().toLowerCase()
      const matches = (watcher) => !needle
        || watcher.repo.toLowerCase().includes(needle)
        || (watcher.title || '').toLowerCase().includes(needle)
        || (watcher.filteredLog || []).some((entry) => String(entry.number).includes(needle) || String(entry.title || '').toLowerCase().includes(needle))
      const matchesBadge = (watcher) => !badgeFilter
        || repoBadges(watcher.repoAccess).some((badge) => badge.text === badgeFilter)
      const hasProblem = (watcher) => Boolean(watcher.lastError)
        || Number(watcher.silentWakes) >= 2
        || Boolean(repoStructureNote(watcher.repoAccess))
        || repoBadges(watcher.repoAccess).some((badge) => badge.tone === 'warning' || badge.tone === 'danger')
      const visible = watchers.filter((watcher) => matches(watcher) && matchesBadge(watcher)
        && (!problemsOnly || hasProblem(watcher))
        && (!deferFilter || watcher.deferReason === deferFilter))

      const overview = [
        watchers.some((w) => (w.filteredLog || []).length > 0)
          ? h(Section, { key: 'filtered', title: '最近被过滤' },
            h(CollapsibleList, {
              title: '看被过滤的条目',
              items: watchers.flatMap((w) => (w.filteredLog || []).slice(-2).map((entry) =>
                '#' + entry.number + ' ' + (entry.title || '') + ' — ' + entry.reason)),
            }))
          : null,
        problems.length > 0
          ? h(Section, { key: 'problems', title: '需要关注', count: problems.length },
            h('ul', { className: 'dt-plain-list' }, problems.map((item) => h('li', { key: item.key, className: 'dt-danger' }, item.text))))
          : null,
        // 中间态：已经有守、但一次都没唤醒过 —— 这不是"没配置"，是"在等"
        (watchers.length > 0 && watchers.every((w) => !w.lastWake))
          ? h('div', { className: 'sa-dock-foot', key: 'waiting' },
            '还没有唤醒过：守会在仓库出现新条目时叫醒这个会话。'
            + '想先试一次，点行里的「立刻」；如果一直没动静，看上面「需要关注」里有没有被过滤的记录。')
          : null,
        // 需要重启：这是"功能看起来没生效"最常见的根因，必须显眼
        (body.installedVersion && body.runningVersion && body.installedVersion !== body.runningVersion)
          ? h('div', { className: 'dt-banner dt-danger', key: 'restart-needed' },
            '代码已更新到 ' + body.installedVersion + '，但宿主还在跑 ' + body.runningVersion
            + ' —— 服务端改动需要重启宿主才生效（客户端部分已生效，所以界面可能看起来是新的）。')
          : null,
        badgeFilter
          ? h('div', { className: 'dt-row-meta', key: 'badge-filter' },
            h('span', null, '只看 ' + badgeFilter + ' 的守（' + visible.length + ' 条）：'),
            h(Pill, { onClick: () => setBadgeFilter(null) }, '清除'))
          : null,
        h('div', { className: 'dt-stats', key: 'stats' },
          h('div', { className: 'dt-stat' }, h('span', { className: 'dt-stat-value' }, String(watchers.length)), h('span', null, '条主理鱼')),
          h('div', { className: 'dt-stat' }, h('span', { className: 'dt-stat-value' }, String(running)), h('span', null, '主理中')),
          h('div', { className: 'dt-stat' }, h('span', { className: 'dt-stat-value' }, String(paused)), h('span', null, '已暂停')),
          h('div', { className: 'dt-stat' }, h('span', { className: 'dt-stat-value' }, String(broken)), h('span', null, '异常'))),
        h(Section, { key: 'list', title: needle ? '搜索结果' : '主理鱼', count: visible.length },
          watchers.length === 0
            ? h(Onboarding, { onStart: () => setTab('trigger') })
            : visible.length === 0
              ? h(Hint, null, '没有匹配「' + search + '」的主理鱼。')
              : h('ul', { className: 'dt-list' }, visible.map(row))),
      ]

      // 判定日志（对应官方 eval 页）：每轮的唤醒结果、跳过原因、被过滤记录，一次看全
      // 判定页用官方的时间线结构（dt-timeline / dt-event / dt-event-foot），
      // 官方在 thread.tsx 与 settings-kit.tsx 里就是这么铺「发生过什么」的。
      // 跳过原因分布：把「为什么没叫醒」做成可读的统计（客户最常问的问题）
      const reasonTotals = (() => {
        const merged = {}
        for (const w of watchers) for (const [reason, n] of Object.entries(w.filterCounts || {})) {
          merged[reason] = (Number(merged[reason]) || 0) + (Number(n) || 0)
        }
        return Object.entries(merged).sort((a, b) => b[1] - a[1]).slice(0, 8)
      })()
      const judge = h(Section, {
        title: '判定日志',
        count: watchers.reduce((n, w) => n + (w.history || []).length, 0),
        action: h(InfoTip, { text: '每轮判定都会记一条：唤醒、仅观察，或跳过及其原因。只存最近若干条。' }),
      },
        (() => {
          const counts = new Map()
          for (const w of watchers) if (w.deferReason) counts.set(w.deferReason, (counts.get(w.deferReason) || 0) + 1)
          if (counts.size === 0) return null
          return h('div', { className: 'dt-row-meta', key: 'defer-totals' },
            h('span', null, '暂停原因：'),
            [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([code, n]) => h(Pill, {
              key: code,
              active: deferFilter === code,
              onClick: () => setReasonFilter(deferFilter === code ? null : 'defer:' + code),
            }, (DEFER_LABELS[code] || code) + ' × ' + n)),
            deferFilter ? h(Pill, { key: 'clear-defer', onClick: () => setReasonFilter(null) }, '清除') : null)
        })(),
        reasonTotals.length > 0
          ? h('div', { className: 'dt-row-meta', key: 'reason-totals' },
            h('span', null, '跳过原因累计：'),
            reasonTotals.map(([reason, n]) => h(Pill, {
              key: reason,
              active: reasonFilter === reason,
              onClick: () => setReasonFilter(reasonFilter === reason ? null : reason),
            }, reason + ' × ' + n)),
            reasonFilter ? h(Pill, { key: 'clear', onClick: () => setReasonFilter(null) }, '清除筛选') : null)
          : null,
        reasonFilter
          ? h('ul', { className: 'dt-plain-list', key: 'reason-entries' },
            watchers.flatMap((w) => (w.filteredLog || [])
              .filter((entry) => entry.reason === reasonFilter)
              .map((entry) => h('li', { key: w.repo + '#' + entry.number + entry.at },
                w.repo + ' #' + entry.number + ' ' + String(entry.title || '').slice(0, 60)))))
          : null,
        watchers.length === 0
          ? h(Hint, null, '还没有主理鱼。')
          : h('ol', { className: 'dt-timeline' },
            watchers.flatMap((watcher) => (watcher.history || []).slice(-6).reverse().map((entry, index) => {
              const label = entry.ok ? '已唤醒' : entry.reason === 'observe' ? '仅观察（未唤醒）' : '跳过：' + (entry.reason || '未知')
              return h('li', {
                key: watcher.repo + '#' + watcher.sessionId + entry.at + index,
                className: 'dt-event' + (entry.ok ? '' : ' dt-event-quiet'),
              },
                h('div', { className: 'dt-event-foot' },
                  h('strong', { className: 'dt-event-actor' }, watcher.repo),
                  h('span', null, ageText(entry.at))),
                h('p', { className: 'dt-event-text' }, label),
                h('div', { className: 'dt-event-foot' },
                  (entry.numbers || []).length > 0
                    ? h('span', null, (entry.numbers || []).map((n) => '#' + n).join(' '))
                    : null,
                  h('span', null, (watcher.title || '未命名会话') + ' · ' + sessionTag(watcher.sessionId))))
            }))))

      // 迷你时间线：回答"为什么这一轮没叫醒我"
      const timeline = h(Section, { key: 'timeline', title: '时间线（最近 20 条）' },
        watchers.length === 0
          ? h(Hint, null, '还没有守。添加一条之后，这里会记录每次唤醒、攒着、限流、回收。')
          : h('div', { className: 'dt-rows' }, watchers.flatMap((watcher) => (watcher.events || []).slice().reverse().map((event, index) => h('div', {
            key: watcher.repo + '-ev' + index,
            className: 'dt-row',
          },
            h('div', { className: 'dt-row-main' },
              h('div', { className: 'dt-row-title' },
                h(Tag, { tone: event.kind === 'wake' ? 'success' : event.kind === 'wake-failed' ? 'danger' : 'outline' },
                  event.kind + (Number(event.count) > 1 ? ' ×' + event.count : '')),
                (Number(event.count) > 1 && event.since)
                  ? h('span', { className: 'dt-row-meta' }, '持续 ' + durationText(event.since, event.at))
                  : null,
                h('span', { className: 'dt-row-meta' }, ageText(event.at))),
              h('div', { className: 'dt-hint' }, watcher.repo + ' · ' + event.text)))))))

      // 按仓库汇总：守多个仓库时先看哪个健康，再看明细（渐进披露）
      const problemCount = watchers.filter(hasProblem).length
      const repoSummary = watchers.length === 0 ? null : h(Section, { key: 'repo-summary', title: '按仓库', hint: '点仓库名只看它（再点取消）' },
        h('div', { className: 'dt-row-meta' },
          h(Pill, { active: problemsOnly, onClick: () => setProblemsOnly(!problemsOnly) }, '只看有问题的' + (problemCount > 0 ? ' (' + problemCount + ')' : '')),
          problemsOnly ? h(Pill, { onClick: () => setProblemsOnly(false) }, '全部') : null),
        body.sessionUsage
          ? h('div', { className: 'dt-row-meta' },
            h('span', null, '本会话近一小时唤醒 ' + body.sessionUsage.used + '/' + body.sessionUsage.cap),
            body.sessionUsage.used >= body.sessionUsage.cap
              ? h('span', { className: 'dt-error-text' }, '已到上限：新条目会攒到下一小时，可以把「这条会话每小时最多被唤醒」调大')
              : null,
            body.sessionUsage.capped > 0
              ? h('span', { className: 'dt-error-text' }, body.sessionUsage.capped + ' 条守正因上限暂停')
              : null)
          : null,
        visible.length === 0 ? h(Hint, null, '没有符合条件的主理鱼。点上面「全部」看所有守。') : null,
        h('div', { className: 'dt-rows' }, ...summarizeByRepo(visible).map((group) => h('div', { key: 'repo-' + group.repo, className: 'dt-row' },
          h('div', { className: 'dt-row-main' },
            h('div', { className: 'dt-row-title' },
              h(StateDot, { state: group.errors > 0 ? 'error' : group.silentWakes >= 2 ? 'warning' : 'done' }),
              h('button', {
                className: 'dt-textlink dt-row-name',
                type: 'button',
                onClick: () => setSearch(search === group.repo ? '' : group.repo),
                title: '点一下只看这个仓库（再点取消）',
              }, group.repo),
              ...group.badges.map((badge) => h(Tag, { key: 'rb-' + badge.text, tone: badge.tone }, badge.text))),
            h('div', { className: 'dt-row-meta' },
              h('span', null, group.count + ' 条守（启用 ' + group.enabled + '）'),
              h('span', null, group.lastWake ? '最近唤醒 ' + ageText(group.lastWake) : '还没唤醒过'),
              group.silentWakes > 0 ? h('span', { className: 'dt-error-text' }, '未回音 ' + group.silentWakes + ' 次') : null,
              group.errors > 0 ? h('span', { className: 'dt-error-text' }, group.errors + ' 条报错') : null))))))

      const trigger = h(Section, { title: '新增主理鱼' },
        h('div', { className: 'dt-form' },
          field('仓库', h(Input, { value: form.repo, placeholder: 'owner/name', onChange: (e) => setForm({ ...form, repo: e.target.value }) })),
          field('间隔（秒）', h(Input, { value: form.intervalSec, onChange: (e) => setForm({ ...form, intervalSec: e.target.value }) })),
          field('单次最多唤醒条数', h(Input, { value: form.batchLimit || '', placeholder: '5（1-20）', onChange: (e) => setForm({ ...form, batchLimit: e.target.value }) })),
          field('每小时最多唤醒次数', h(Input, { value: form.maxWakesPerHour || '', placeholder: '6（1-60）', onChange: (e) => setForm({ ...form, maxWakesPerHour: e.target.value }) })),
          field('只处理这些标签', h(Input, { value: form.labels, placeholder: '逗号分隔，留空 = 全部', onChange: (e) => setForm({ ...form, labels: e.target.value }) })),
          field('活跃时段', h(Input, { value: form.activeHours, placeholder: '09:00-23:00，留空 = 全天', onChange: (e) => setForm({ ...form, activeHours: e.target.value }) })),
          field('目标/规则', h(Input, { value: form.goal || '', placeholder: '可选，会附在唤醒消息里', onChange: (e) => setForm({ ...form, goal: e.target.value }) })),
          h('label', { className: 'dt-switch-row' }, h(Toggle, { checked: form.onlyAssigned, onChange: (v) => setForm({ ...form, onlyAssigned: v }), label: '只看已指派' }), '只处理已指派给人的条目'),
          h('label', { className: 'dt-switch-row' }, h(Toggle, { checked: !!form.observe, onChange: (v) => setForm({ ...form, observe: v }), label: '仅观察' }), '仅观察（只记录本会唤醒哪几条，不真唤醒）'),
          h('label', { className: 'dt-switch-row' }, h(Toggle, { checked: form.isolated, onChange: (v) => setForm({ ...form, isolated: v }), label: '隔离执行' }), '隔离执行（每次唤醒开一次性 worktree）'),
          form.isolated ? field('隔离工作目录', h(Input, { value: form.workdir, placeholder: '绝对路径，留空 = 当前工作目录', onChange: (e) => setForm({ ...form, workdir: e.target.value }) })) : null,
          h('div', { className: 'dt-actions' },
            h(Btn, { variant: 'primary', icon: h(Icon, { name: 'plus' }), onClick: addWatcher, disabled: !sessionId || !form.repo.trim() },
              sessionId ? '添加到当前会话' : '需要会话上下文'))))

      const settingsSections = [
        h(Section, { key: 'source', title: '来源' },
          h(KeyValues, { rows: [
            ['仓库', watchers.length === 0 ? '未绑定' : watchers.map((w) => w.repo).join(', ')],
            ['gh CLI', !body.gh
              ? '检测中…'
              : body.gh.ok
                ? '可用 · ' + (body.gh.version || '')
                : '不可用 —— 先跑 gh auth login（或装 gh CLI）；也可以直接在下面填 token · ' + String(body.gh.error || '').slice(0, 80)],
            ['凭证', credentials.token === 'none' ? '回退到 gh CLI 登录态' : '使用面板配置的 token'],
            ['权限范围', (() => {
              const info = body.tokenScopes
              if (!info) return '正在探测…'
              if (!info.ok) return '探测失败：' + String(info.error || '').slice(0, 60)
              if (!info.scopes.length) return '细粒度 token（无 OAuth scope）'
              return info.scopes.join(', ')
            })()],
            (body.tokenScopes && body.tokenScopes.broad && body.tokenScopes.broad.length > 0)
              ? ['提示', '这个 token 带 ' + body.tokenScopes.broad.join(', ') + ' —— 我们的功能只需要「读 issue/PR + 写评论和标签」，建议换细粒度 token 只授 Issues 读写']
              : null,
            ['隔离占用', !body.isolation || (body.isolation.roots || []).length === 0
              ? '没有开隔离执行'
              : (body.isolation.roots || []).map((r) => r.count + ' 个 · ' + bytesText(r.bytes)).join('；')
                + '（合计 ' + bytesText(body.isolation.totalBytes) + '）'],
          ] })),
        h(Section, { key: 'creds', title: '凭证' },
          h(KeyValues, { rows: [['GitHub token', credentials.token === 'none' ? '未配置（回退到已登录的 gh CLI）' : '已配置'], ['SSH 私钥', credentials.sshKeyPath === 'none' ? '未配置（当前版本不使用）' : '已配置']] }),
          field('Token', h(Input, { type: 'password', value: token, placeholder: 'ghp_… / github_pat_…（留空不改）', onChange: (e) => setToken(e.target.value) })),
          h('div', { className: 'dt-actions' }, h(Btn, { variant: 'primary', onClick: saveCredentials }, '保存凭证')),
          h(Hint, null, '不填也能用：插件直接复用已登录的 gh CLI。')),
        h(Section, { key: 'update', title: '版本与更新' },
          h(KeyValues, { rows: [
            ['当前版本', (update && update.current) || CLIENT_VERSION],
            ['npm 最新', !update ? '检测中…' : update.error ? '检测失败 · ' + update.error : (update.latest || '未知')],
            ['状态', !update ? '…' : update.hasUpdate ? '有新版本，可以升级' : '已是最新'],
          ] }),
          update && update.hasUpdate
            ? h('div', null,
                h('code', { className: 'dt-code' }, update.command),
                h('div', { className: 'dt-actions' },
                  h(Btn, { size: 'sm', onClick: () => { try { navigator.clipboard.writeText(update.command) } catch {} } }, '复制命令')))
            : null,
          h('div', { className: 'dt-actions' },
            h(Btn, { size: 'sm', variant: 'ghost', onClick: () => checkUpdate(true), disabled: checking }, checking ? '检查中…' : '重新检查')),
          h(Hint, null, '升级要改 profile，装完需要重载一次宿主才会用上新版本 —— 所以这里只给命令，不替你执行。')),
        h(Section, { key: 'diagnose', title: '分诊信号与取舍' },
          h(Hint, null, '一次只处理 N 条时，这些信号的加权决定先后。事实默认展示，判断默认关闭。'),
          h('div', { className: 'dt-rows' }, (body.triageSignals || []).map((sig) => h('div', { key: sig.key, className: 'dt-row' },
            h('div', { className: 'dt-row-main' },
              h('div', { className: 'dt-row-title' },
                h('span', { className: 'dt-row-name' }, sig.label),
                h(Tag, { tone: sig.kind === 'fact' ? 'success' : 'warning' }, sig.kind === 'fact' ? '事实' : '判断'),
                h(Tag, { tone: sig.default ? 'outline' : 'quiet' }, sig.default ? '默认开' : '默认关'),
                h('span', { className: 'dt-row-meta' }, '+' + sig.weight + ' 分')),
              h('div', { className: 'dt-hint' }, sig.why)))))),
        h(Section, { key: 'diagnose', title: '诊断' },
          h(Hint, null, '反馈问题时把这段贴给对方：里面有版本、挂载状态和每条值守的最近错误（凭证已脱敏）。'),
          h('div', { className: 'dt-actions' },
            h(Btn, {
              size: 'sm', variant: 'outline',
              onClick: async () => {
                try {
                  const payload = await call('/diagnose')
                  const text = String((payload && payload.text) || '')
                  try { await navigator.clipboard.writeText(text) } catch {}
                  notify('诊断信息已复制（' + text.split(String.fromCharCode(10)).length + ' 行）', 'info')
                } catch (error) {
                  notify('生成诊断失败：' + String((error && error.message) || error), 'error')
                }
              },
            }, '复制诊断信息'))),
        h(Section, { key: 'goal', title: '会话 goal' },
          h('textarea', {
            className: 'dt-textarea', rows: 3, value: goalDraft,
            placeholder: '这个会话要达成什么（会写进 /goal）',
            onChange: (e) => { setGoalTouched(true); setGoalDraft(e.target.value) },
          }),
          h('div', { className: 'dt-actions' }, h(Btn, { variant: 'primary', onClick: saveGoal, disabled: !sessionId }, '保存 goal'))),
      ]


      // 官方设置页是「左栏导航 + 右侧内容」的网格（dt-settings / dt-settings-nav / dt-settings-body）。
      // 我们之前是单列堆叠，四个分区一起铺开，深链路里翻起来很累。
      const SETTINGS_SECTIONS = [
        { key: 'source', title: '来源' },
        { key: 'creds', title: '凭证' },
        { key: 'update', title: '版本与更新' },
        { key: 'diagnose', title: '诊断' },
        { key: 'goal', title: '会话 goal' },
      ]
      const settingsBody = settingsSections.find((node) => node && node.props && node.props.key === settingsSection)
        || settingsSections.find(Boolean)
      const settings = h('div', { className: 'dt-settings' },
        h('nav', { className: 'dt-settings-nav', 'aria-label': '设置分区' },
          SETTINGS_SECTIONS.map((item) => h('button', {
            key: item.key, type: 'button', className: 'dt-settings-link',
            'aria-current': settingsSection === item.key ? 'page' : undefined,
            onClick: () => setSettingsSection(item.key),
          }, item.title))),
        h('div', { className: 'dt-settings-body' }, settingsBody))

      const checkUpdate = useCallback(async (force) => {
        setChecking(true)
        try {
          const value = await call('/update' + (force ? '?refresh=1' : ''))
          setUpdate(value)
        } catch (error) {
          setUpdate({ current: CLIENT_VERSION, latest: null, hasUpdate: false, error: String(error && error.message || error) })
        } finally {
          setChecking(false)
        }
      }, [])

      useEffect(() => {
        let alive = true
        try {
          Promise.resolve(call('/update'))
            .then((value) => { if (alive) setUpdate(value) })
            .catch(() => {})
        } catch { /* 宿主早期渲染时 fetch 可能还不存在，忽略即可 */ }
        return () => { alive = false }
      }, [])


      /**
       * 面板自己遇到的错误也要说人话。
       *
       * 服务端那边的 gh 错误已经由 classifyGhError 归类（并附了 hint）；
       * 但**面板拉自己接口失败**（宿主正在重启、端口变了、fetch 被拒）不会经过那套，
       * 以前界面上就是一行 "Failed to fetch" —— 客户看不懂，也不知道要做什么。
       */
      function humanizeError(text) {
        const raw = String(text == null ? '' : text)
        if (!raw) return ''
        if (/Failed to fetch|NetworkError|Load failed/i.test(raw)) {
          return '连不上宿主：DSH 可能正在重启，或插件刚被重载。稍等几秒会自动重试；一直这样就去「设置 → 诊断」复制信息。'
        }
        if (/HTTP 401|HTTP 403/i.test(raw)) return '宿主拒绝了请求（401/403）：面板接口可能需要重新挂载，重启宿主即可。'
        if (/HTTP 5\d\d/.test(raw)) return '宿主内部报错（5xx）：先把「设置 → 诊断」里的信息复制出来，再重启宿主试试。'
        if (/HTTP 404/.test(raw)) return '接口不存在（404）：多半还在跑旧版本代码，重启宿主。'
        if (/timeout|timed out|ETIMEDOUT/i.test(raw)) return '请求超时：宿主可能正忙（比如同时在建隔离 worktree），稍后自动重试。'
        return raw
      }

      /** 建议追加到仓库 AGENTS.md 的处理规则（只给文本，绝不代写文件）。 */
      const AGENTS_SNIPPET = [
        '## 主理鱼（dsh-session-superagent）处理规则',
        '',
        '- 收到「【主理鱼】<owner/name> 有 N 条新动态」时，先读完整条目再决定做不做。',
        '- 做：按【完成标准】三件事写清（改了什么 / 怎么验证 / 回写到哪），改完推分支开 PR。',
        '- 不做：也要说明理由（例如"已有 PR 在做"），然后照样 ack。',
        '- **无论做还是不做，最后都要 watch_ack 打标签**，否则下一轮会被再次唤醒。',
      ].join(String.fromCharCode(10))

      /** 按仓库汇总（与服务端 watch.js:summarizeByRepo 同语义）。 */
      function summarizeByRepo(list) {
        const groups = new Map()
        for (const watcher of Array.isArray(list) ? list : []) {
          if (!watcher || !watcher.repo) continue
          const repo = String(watcher.repo)
          const group = groups.get(repo) || { repo, count: 0, lastWake: null, silentWakes: 0, errors: 0, enabled: 0, badges: [] }
          group.count += 1
          if (watcher.enabled !== false) group.enabled += 1
          if (watcher.lastWake && (!group.lastWake || String(watcher.lastWake) > String(group.lastWake))) group.lastWake = watcher.lastWake
          group.silentWakes = Math.max(group.silentWakes, Number(watcher.silentWakes) || 0)
          if (watcher.lastError) group.errors += 1
          for (const badge of repoBadges(watcher.repoAccess) || []) {
            if (!group.badges.some((b) => b.text === badge.text)) group.badges.push(badge)
          }
          groups.set(repo, group)
        }
        const weight = (g) => (g.errors > 0 ? 0 : g.silentWakes >= 2 ? 1 : 2)
        return [...groups.values()].sort((a, b) => (weight(a) - weight(b)) || a.repo.localeCompare(b.repo))
      }

      /** 持续时长（与服务端 watch.js:durationText 同语义）。 */
      function durationText(sinceIso, untilIso) {
        const from = Date.parse(String(sinceIso || ''))
        const to = Date.parse(String(untilIso || ''))
        if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) return ''
        const minutes = Math.floor((to - from) / 60000)
        if (minutes < 1) return '不到 1 分钟'
        if (minutes < 60) return minutes + ' 分钟'
        const hours = Math.floor(minutes / 60)
        const rest = minutes % 60
        return rest > 0 ? hours + ' 小时 ' + rest + ' 分' : hours + ' 小时'
      }

      /** 只读仓库的提示（与服务端 gh-format.js:accessNote 同语义；面板要独立一份）。 */
      function accessNoteForPanel(access) {
        if (!access || typeof access !== 'object') return ''
        if (access.push === true) return ''
        if (access.push !== false) return ''
        return '你对 ' + String(access.repo || '这个仓库') + ' 只有读权限：能看、能被叫醒，但没法回写评论或打标签 —— ' +
          '要么换有写权限的 token，要么把结论写在本地/PR 描述里。'
      }

      /** 仓库能力徽章（与服务端 watch.js:repoBadges 同语义）。 */
      function repoBadges(access) {
        if (!access || typeof access !== 'object') return []
        const badges = []
        if (access.archived === true) badges.push({ text: '已归档', tone: 'warning' })
        if (access.disabled === true) badges.push({ text: '已禁用', tone: 'danger' })
        if (access.hasIssues === false) badges.push({ text: '无 Issues', tone: 'warning' })
        if (access.fork === true && access.parent && access.hasIssues !== true) badges.push({ text: 'fork · 上游 ' + String(access.parent), tone: 'outline' })
        if (access.push === false) badges.push({ text: '只读', tone: 'warning' })
        if (access.private === true) badges.push({ text: '私有', tone: 'outline' })
        return badges
      }

      /** 仓库结构提示（与服务端 watch.js:repoStructureNote 同语义；客户端要独立一份，不能跨包 import）。 */
      function repoStructureNote(access) {
        if (!access || typeof access !== 'object') return ''
        const repo = String(access.repo || '这个仓库')
        // 顺序与服务端 gh-format.js:repoStructureNote 保持一致：归档/禁用优先
        if (access.archived === true) return repo + ' 已归档：GitHub 上归档仓库是只读的，评论和打标签都会失败 —— 守它只能看、不能回写。'
        if (access.disabled === true) return repo + ' 已被禁用：这个仓库当前不可用，主理鱼不会拿到任何条目。'
        if (access.hasIssues === false) return repo + ' 关闭了 Issues —— 主理鱼只认 issue / PR，这里不会有任何条目可接。'
        if (access.fork === true && access.parent && access.hasIssues !== true) {
          return repo + ' 是 ' + String(access.parent) + ' 的 fork。fork 默认不带 Issues，issue 大多落在上游 —— 确认你要守的是哪一个。'
        }
        return ''
      }

      /** 人话字节数：客户看的是"3.2 MB"，不是 3355443。 */
      function bytesText(n) {
        const value = Number(n) || 0
        if (value < 1024) return value + ' B'
        if (value < 1024 * 1024) return (value / 1024).toFixed(1) + ' KB'
        if (value < 1024 * 1024 * 1024) return (value / 1024 / 1024).toFixed(1) + ' MB'
        return (value / 1024 / 1024 / 1024).toFixed(2) + ' GB'
      }

      // 官方 settings-kit.tsx 的 Field：label + hint(InfoTip) + 控件 + note(small)。
      // 我们之前只有 label，说明只能塞进 placeholder —— 用户看不到「这个字段到底什么意思」。
      function field(label, control, hint, note) {
        return h('label', { className: 'dt-field', key: label },
          h('span', { className: 'dt-field-head' }, label, hint ? h(InfoTip, { text: hint }) : null),
          control,
          note ? h('small', null, note) : null)
      }

      return h('div', { className: 'dt-page' },
        h('div', { className: 'dt-page-head' },
          h('div', null,
            h('h1', { className: 'dt-page-title' }, '主理鱼'),
            h('span', { className: 'dt-hint' },
              (body.sessionTitle ? '会话：' + body.sessionTitle + ' · ' : '')
              + (sessionId ? '盯办 + 主动办：仓库有动静就叫醒本会话' : '需要会话上下文'))),
          h('div', { className: 'dt-toolbar' },
            h(Input, { value: search, placeholder: '搜索仓库 / 编号 / 标题', onChange: (e) => setSearch(e.target.value), 'aria-label': '搜索' }),
            h(Btn, { size: 'sm', variant: 'ghost', icon: h(Icon, { name: 'question' }), onClick: () => setGlossary(true) }, '术语'),
            h(Btn, { size: 'sm', icon: h(Icon, { name: 'refresh' }), onClick: () => load() }, '刷新'),
            watchers.length > 0 ? h(Btn, { size: 'sm', onClick: () => actBulk('pause') }, '全部暂停') : null,
            watchers.length > 0 ? h(Btn, { size: 'sm', onClick: () => actBulk('resume') }, '全部恢复') : null)),
        h(SegTabs, {
          items: [
            { value: 'overview', label: '总览' },
            { value: 'judge', label: '判定' },
            { value: 'trigger', label: '触发' },
            { value: 'settings', label: '设置' },
          ],
          value: tab, onChange: setTab, label: '主理鱼分区',
        }),
        notice ? h('div', { className: 'dt-banner dt-danger' }, notice.text) : null,
        // 有新版本时在顶部提示一次（埋在设置页里客户不会主动翻）
        update && update.hasUpdate
          ? h('div', { className: 'dt-banner dt-banner-actions' },
              h('span', { className: 'dt-banner-label' }, '有新版本 ' + update.latest + '（当前 ' + update.current + '）'),
              h('a', { className: 'dt-btn dt-btn-sm dt-btn-outline', href: '#', onClick: (e) => { e.preventDefault(); setTab('settings') } }, '看升级命令'))
          : null,
        toastView,
        snap.error ? h('div', { className: 'dt-banner dt-danger' }, '读取失败：' + humanizeError(snap.error)) : null,
        snap.loading && !snap.body ? h(Hint, null, '正在读取…') : null,
        tab === 'overview' ? overview : null,
        tab === 'overview' ? repoSummary : null,
        tab === 'judge' ? judge : null,
        tab === 'judge' ? timeline : null,
        tab === 'trigger' ? trigger : null,
        tab === 'settings' ? settings : null,
        typeof glossary === 'string' ? h(Modal, {
          open: true,
          title: '建议追加到 ' + String(glossary).replace('rules:', '') + ' 的 AGENTS.md',
          onClose: () => setGlossary(false),
        },
          h('p', { className: 'dt-hint' }, '问题通常不是"没叫醒"，而是"叫醒了但没动手"。这段规则会明确要求：无论做不做，最后都要 ack。'),
          h('pre', { className: 'dt-pre' }, AGENTS_SNIPPET),
          h('div', { className: 'dt-actions' },
            h(Btn, {
              size: 'sm',
              variant: 'primary',
              onClick: async () => {
                try {
                  await navigator.clipboard.writeText(AGENTS_SNIPPET)
                  notify('规则已复制，粘贴到 AGENTS.md 末尾即可', 'info')
                } catch {
                  notify('复制失败：请手动选中上面的文本', 'error')
                }
              },
            }, '复制这段规则'),
            h(Btn, { size: 'sm', variant: 'ghost', onClick: () => setGlossary(false) }, '关闭'))) : null,
        h(Modal, { open: glossary === true, title: '主理鱼术语表', onClose: () => setGlossary(false) },
          h(KeyValues, { rows: [
            ['主理鱼', '一条「盯办」绑定：某个仓库 → 某个会话'],
            ['盯', '轮询 issue/PR、按水位去重、冷却期吸收自己的操作'],
            ['办', '唤醒会话后按仓库 AGENTS.md 主动处理，完成后 watch_ack 打标签'],
            ['唤醒', '只在会话空闲（idle）时注入一条【主理鱼】消息'],
            ['过滤', '标签白名单/黑名单、只看已指派、跳过机器人/草稿/已关闭'],
            ['时段', 'activeHours，比如 09:00-23:00，时段外只攒不唤醒'],
            ['隔离', 'isolated：每次唤醒开一次性 git worktree，改副本不碰主工作区'],
            ['ack', '处理完给条目打「主理鱼:已处理」标签，轮询直接跳过'],
            ['goal', '会话目标（ctx.goals），和 /goal 命令同一份状态'],
            ['凭证', 'token 存在服务端 secrets.json，面板只显示是否已配置'],
          ] })))
    }


    return {
      inject: ['slots'],
      apply(ctx) {
        try { noteOnce('client-version', CLIENT_VERSION) } catch {}
        try { note('apply', 'start') } catch {}

        // ① the 主理鱼 tab in the centre-column view ring
        ctx.effect(() => {
          try {
            return ctx.slots.inject('conversation.view', () => {
              const dispose = ctx.slots.register({
                name: 'conversation.view',
                id: 'session-superagent-desk',
                order: 30,
                label: '主理鱼',
              }, ZhuliPanel)
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
                order: -10, // 最左端：activity/usage 是 0/1，上下文环在槽位之外

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
