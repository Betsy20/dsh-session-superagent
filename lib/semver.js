// SEMVER_COMPARATOR_SOURCE_START
// This block is duplicated verbatim in client.js because the browser UMD cannot import ESM.
// test/update-semver.test.mjs audits both copies and exercises their behavior.
const SEMVER_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/

function parseSemver(value) {
  if (typeof value !== 'string') return null
  const match = SEMVER_RE.exec(value)
  if (!match) return null
  return {
    core: [match[1], match[2], match[3]],
    prerelease: match[4] === undefined ? null : match[4].split('.'),
  }
}

// Numeric identifiers are compared as decimal strings: Number/BigInt would either
// lose precision or impose a fixed-width limit that SemVer itself does not have.
function compareNumericIdentifiers(left, right) {
  if (left.length !== right.length) return left.length < right.length ? -1 : 1
  if (left === right) return 0
  return left < right ? -1 : 1
}

function comparePrerelease(left, right) {
  if (left === null || right === null) {
    if (left === right) return 0
    return left === null ? 1 : -1
  }
  const length = Math.max(left.length, right.length)
  for (let index = 0; index < length; index += 1) {
    if (index >= left.length) return -1
    if (index >= right.length) return 1
    const a = left[index]
    const b = right[index]
    if (a === b) continue
    const aNumeric = /^\d+$/.test(a)
    const bNumeric = /^\d+$/.test(b)
    if (aNumeric && bNumeric) return compareNumericIdentifiers(a, b)
    if (aNumeric !== bNumeric) return aNumeric ? -1 : 1
    return a < b ? -1 : 1
  }
  return 0
}

/** Return -1/0/1 by SemVer precedence, or null when either input is invalid. */
function compareSemver(left, right) {
  const a = parseSemver(left)
  const b = parseSemver(right)
  if (!a || !b) return null
  for (let index = 0; index < 3; index += 1) {
    const compared = compareNumericIdentifiers(a.core[index], b.core[index])
    if (compared !== 0) return compared
  }
  return comparePrerelease(a.prerelease, b.prerelease)
}

function isStrictSemver(value) {
  return parseSemver(value) !== null
}
// SEMVER_COMPARATOR_SOURCE_END

export { compareSemver, isStrictSemver }
