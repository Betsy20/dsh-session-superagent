/**
 * 解码请求体。
 *
 * Windows 上命令行传进来的中文经常是 GBK 字节（argv 被转成系统 ANSI 代码页），
 * 直接按 UTF-8 解会变成一串 U+FFFD —— 真实踩过：workdir 里的「主工作区」被写成 `??????`，
 * 导致 git worktree 建不出来。所以先按 UTF-8 解，出现替换字符再用 GBK 重解一次。
 */
export function decodeBody(buffer) {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(String(buffer ?? ''), 'utf8')
  const utf8 = buf.toString('utf8')
  if (!utf8.includes('\ufffd')) return utf8
  try {
    return new TextDecoder('gbk').decode(buf)
  } catch {
    return utf8
  }
}

/**
 * 按**字符边界**截断 UTF-8 字节串。
 *
 * 审核（0.9.200 T16）：`subarray(0, 64 * 1024)` 会切在字节中间 —— 一个 3 字节的汉字被切掉 1–2 字节后，
 * 剩下的半截解出来是 U+FFFD，而 `decodeBody()` 看到替换字符就会**把整段当 GBK 重解**，
 * 于是整篇中文变成乱码（实测 21851 → 32773 个字符）。
 *
 * 做法：从上限往回退，直到落在 UTF-8 的**起始字节**上（不是 `10xxxxxx` 续接字节）。
 * 最多退 3 个字节 —— 超出的不是合法 UTF-8，按原样返回交给上层。
 */
export function truncateUtf8(buffer, maxBytes) {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(String(buffer ?? ''), 'utf8')
  const limit = Number(maxBytes)
  if (!Number.isFinite(limit) || limit <= 0 || buf.length <= limit) return buf
  let end = Math.floor(limit)
  // 续接字节形如 10xxxxxx：往回退到起始字节
  let back = 0
  while (end > 0 && back < 4 && (buf[end] & 0b1100_0000) === 0b1000_0000) {
    end -= 1
    back += 1
  }
  return buf.subarray(0, end)
}
