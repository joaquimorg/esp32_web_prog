// Turns serial lines into numeric samples for the plotter.
// Accepted lines (everything else is ignored):
//   12.5                    one series
//   1, 2.5, -3              several series, separated by comma / space / tab / semicolon
//   temp:21.5,hum:40        named series (":" or "=")

const NUMBER = '[-+]?(?:\\d+\\.?\\d*|\\.\\d+)(?:[eE][-+]?\\d+)?'
const NUMBER_RE = new RegExp(`^${NUMBER}$`)
const PAIR_RE = new RegExp(`^([A-Za-z_][\\w .-]*?)\\s*[:=]\\s*(${NUMBER})$`)

export const MAX_POINTS = 1000

export function parsePlotLine(line) {
  const text = line.trim()
  if (!text) return null
  const tokens = text.split(/[,;	 ]+/).filter(Boolean)
  if (!tokens.length) return null

  const samples = []
  let unnamed = 0
  for (const token of tokens) {
    if (NUMBER_RE.test(token)) {
      samples.push([`v${++unnamed}`, Number(token)])
      continue
    }
    const pair = PAIR_RE.exec(token)
    if (!pair) return null
    samples.push([pair[1].trim(), Number(pair[2])])
  }
  return samples.every(([, v]) => Number.isFinite(v)) ? samples : null
}

export function createPlotterStore() {
  const series = new Map()

  return {
    series,
    /** Returns true when the line produced samples */
    ingest(line) {
      const samples = parsePlotLine(line)
      if (!samples) return false
      for (const [name, value] of samples) {
        let values = series.get(name)
        if (!values) {
          values = []
          series.set(name, values)
        }
        values.push(value)
        if (values.length > MAX_POINTS) values.splice(0, values.length - MAX_POINTS)
      }
      return true
    },
    clear() {
      series.clear()
    }
  }
}
