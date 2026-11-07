/**
 * 凭证脱敏：任何要进模型上下文的文本都先过这里。
 *
 * 为什么独立包也要带一份：语义复审会把回复正文发给模型，如果正文里本来就有
 * token / 私钥 / 数据库口令，那等于亲手把它们送出去。门禁先脱敏，再发请求。
 *
 * 两层形状：
 * 1. 供应商前缀是精确的（ghp_ / github_pat_ / glpat- / xox / sk_live_ / npm_ / AKIA ...），
 *    误伤极低；
 * 2. 通用形状（URL 里的密码、裸 Bearer、查询参数）必须配上下文词，不做裸扫。
 */

/** Patterns that must never reach the transcript. */
export const SECRET_PATTERNS = [
  /gh[pousr]_[A-Za-z0-9]{20,}/g, // GitHub PAT（ghp_ / gho_ / ghu_ / ghs_ / ghr_）
  /github_pat_[A-Za-z0-9_]{20,}/g, // GitHub 细粒度 PAT
  /glpat-[A-Za-z0-9_-]{20,}/g, // GitLab PAT
  /xox[baprs]-[A-Za-z0-9-]{10,}/g, // Slack
  /sk_live_[A-Za-z0-9]{20,}/g, // Stripe
  /npm_[A-Za-z0-9]{30,}/g, // npm automation token
  /AIza[0-9A-Za-z_-]{35}/g, // Google API key
  /AKIA[0-9A-Z]{16}/g, // AWS access key id
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, // JWT
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, // 完整 PEM 块
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*/g, // 被截断的 PEM：吃到结尾
  /-----BEGIN PGP PRIVATE KEY BLOCK-----[\s\S]*?-----END PGP PRIVATE KEY BLOCK-----/g,
  /Authorization:\s*(?:token|Bearer|Basic)\s+\S+/gi, // 回显的请求头
  /\bBearer\s+[A-Za-z0-9._~+/=-]{20,}/g, // 裸 Bearer（无头名）
  /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqp):\/\/[^:\s/]+:[^@\s]+@/gi, // 数据库 URL 里的密码
  /[?&](?:access_token|api_key|apikey|private_token)=[^&\s"']+/gi, // 查询参数里的凭证
  // Gitee 私人令牌：无前缀的 32 位十六进制。裸扫会误伤 md5 / commit sha，
  // 所以要求前面 20 字内出现 gitee / 令牌 / access_token 这类上下文词。
  /\b(?:gitee|私人令牌|access[_ ]?token)[^\n]{0,20}?\b[0-9a-f]{32}\b/gi,
]

/** Replace every credential-shaped substring with `***`. */
export function redact(text) {
  let out = String(text ?? '')
  for (const re of SECRET_PATTERNS) out = out.replace(re, '***')
  return out
}

/** True when `text` still contains a credential-shaped substring. */
export function hasSecret(text) {
  const value = String(text ?? '')
  return SECRET_PATTERNS.some((re) => {
    re.lastIndex = 0
    const hit = re.test(value)
    re.lastIndex = 0
    return hit
  })
}
