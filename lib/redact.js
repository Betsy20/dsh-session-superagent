/**
 * Credential redaction.
 *
 * The bridge never returns a token to the model, but a tool result can still
 * carry one by accident: a GitHub API error echoing the request headers, a
 * command printing its environment, a config dump. Every string that leaves
 * the plugin passes through `redact()` first.
 */

/** Patterns that must never reach the transcript. */
export const SECRET_PATTERNS = [
  /gh[pousr]_[A-Za-z0-9]{20,}/g, // classic PAT (ghp_, gho_, ghu_, ghs_, ghr_)
  /github_pat_[A-Za-z0-9_]{20,}/g, // fine-grained PAT
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, // SSH / PEM blocks
  /Authorization:\s*(?:token|Bearer)\s+\S+/gi, // echoed request headers
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
