// Classification and filtering of serial console lines

const PANIC_RE = /guru meditation|\bpanic'?ed\b|abort\(\) was called|assert failed|stack smashing|brownout detector|^backtrace:|fatal exception|rst:0x[0-9a-f]+ \(WDT/i
const ERROR_RE = /^E \(\d+\)|\berror\b|\bfail(ed|ure)?\b|\bexception\b|\bfatal\b/i
const WARN_RE = /^W \(\d+\)|\bwarn(ing)?\b/i

/** Returns 'panic' | 'error' | 'warn' | '' for a line received from the device */
export function classifyLine(text) {
  if (PANIC_RE.test(text)) return 'panic'
  if (ERROR_RE.test(text)) return 'error'
  if (WARN_RE.test(text)) return 'warn'
  return ''
}

const SEVERITY = { panic: 3, error: 2, warn: 1 }

/** level: 'all' | 'warn' (warnings and worse) | 'error' (errors and panics) */
export function matchesLevel(log, level) {
  if (level === 'all') return true
  const severity = log.kind === 'error' ? SEVERITY.error : (SEVERITY[log.level] || 0)
  return severity >= (level === 'warn' ? SEVERITY.warn : SEVERITY.error)
}

export function matchesText(log, needle) {
  return !needle || log.text.toLowerCase().includes(needle)
}

/** Splits text in plain/matching parts so the matches can be highlighted */
export function highlightParts(text, needle) {
  if (!needle) return [{ text, hit: false }]
  const parts = []
  const lower = text.toLowerCase()
  let from = 0
  let at = lower.indexOf(needle, from)
  while (at !== -1) {
    if (at > from) parts.push({ text: text.slice(from, at), hit: false })
    parts.push({ text: text.slice(at, at + needle.length), hit: true })
    from = at + needle.length
    at = lower.indexOf(needle, from)
  }
  if (from < text.length) parts.push({ text: text.slice(from), hit: false })
  return parts
}
