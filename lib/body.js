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
