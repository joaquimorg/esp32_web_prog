// ESP-IDF partition table (binary and CSV) helpers
import { md5 } from './md5.js'

export const TABLE_OFFSET = 0x8000
export const TABLE_SIZE = 0xc00
export const FIRST_FREE_OFFSET = 0x9000
const ENTRY_SIZE = 32
const MAX_ENTRIES = 95

export const TYPES = { app: 0x00, data: 0x01 }

const SUBTYPES = {
  app: { factory: 0x00, test: 0x20 },
  data: {
    ota: 0x00, phy: 0x01, nvs: 0x02, coredump: 0x03, nvs_keys: 0x04, efuse: 0x05,
    undefined: 0x06, esphttpd: 0x80, fat: 0x81, spiffs: 0x82, littlefs: 0x83
  }
}
for (let i = 0; i < 16; i++) SUBTYPES.app[`ota_${i}`] = 0x10 + i

export const FLAG_ENCRYPTED = 0x1

const typeName = (type) => Object.keys(TYPES).find(k => TYPES[k] === type) ?? `0x${type.toString(16)}`

export function subtypeName(type, subtype) {
  const table = SUBTYPES[typeName(type)]
  return (table && Object.keys(table).find(k => table[k] === subtype)) ?? `0x${subtype.toString(16)}`
}

export function typeLabel(type) {
  return typeName(type)
}

export function parseTable(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const entries = []
  let md5Found = null
  for (let off = 0; off + ENTRY_SIZE <= bytes.length && entries.length < MAX_ENTRIES + 1; off += ENTRY_SIZE) {
    const magic = view.getUint16(off, true)
    if (magic === 0xebeb) {
      md5Found = bytes.slice(off + 16, off + 32)
      break
    }
    if (magic !== 0x50aa) break
    let name = ''
    for (let i = 0; i < 16; i++) {
      const c = bytes[off + 12 + i]
      if (!c) break
      name += String.fromCharCode(c)
    }
    entries.push({
      name,
      type: bytes[off + 2],
      subtype: bytes[off + 3],
      offset: view.getUint32(off + 4, true),
      size: view.getUint32(off + 8, true),
      flags: view.getUint32(off + 28, true)
    })
  }
  let md5Ok = null
  if (md5Found) {
    const raw = bytes.slice(0, entries.length * ENTRY_SIZE)
    const expected = Array.from(md5Found, b => b.toString(16).padStart(2, '0')).join('')
    md5Ok = md5(raw) === expected
  }
  return { entries, md5Ok }
}

export function buildTable(entries) {
  const out = new Uint8Array(TABLE_SIZE).fill(0xff)
  const view = new DataView(out.buffer)
  entries.forEach((e, i) => {
    const off = i * ENTRY_SIZE
    view.setUint16(off, 0x50aa, true)
    out[off + 2] = e.type
    out[off + 3] = e.subtype
    view.setUint32(off + 4, e.offset, true)
    view.setUint32(off + 8, e.size, true)
    out.fill(0, off + 12, off + 28)
    for (let c = 0; c < Math.min(e.name.length, 15); c++) out[off + 12 + c] = e.name.charCodeAt(c)
    view.setUint32(off + 28, e.flags || 0, true)
  })
  const mdOff = entries.length * ENTRY_SIZE
  const digest = md5(out.slice(0, mdOff))
  out[mdOff] = 0xeb
  out[mdOff + 1] = 0xeb
  out.fill(0xff, mdOff + 2, mdOff + 16)
  for (let i = 0; i < 16; i++) out[mdOff + 16 + i] = parseInt(digest.slice(i * 2, i * 2 + 2), 16)
  return out
}

function formatSize(size) {
  if (size && size % (1024 * 1024) === 0) return `${size / (1024 * 1024)}M`
  if (size && size % 1024 === 0) return `${size / 1024}K`
  return `0x${size.toString(16)}`
}

export function toCsv(entries) {
  const lines = ['# Name, Type, SubType, Offset, Size, Flags']
  for (const e of entries) {
    lines.push([
      e.name, typeName(e.type), subtypeName(e.type, e.subtype),
      `0x${e.offset.toString(16)}`, formatSize(e.size), e.flags & FLAG_ENCRYPTED ? 'encrypted' : ''
    ].join(', ').replace(/, $/, ''))
  }
  return lines.join('\n')
}

function parseNumber(text) {
  const t = text.trim().toLowerCase()
  const m = /^(0x[0-9a-f]+|\d+)([km]?)$/.exec(t)
  if (!m) return NaN
  const mult = m[2] === 'k' ? 1024 : m[2] === 'm' ? 1024 * 1024 : 1
  return Number.parseInt(m[1], 0) * mult
}

const alignUp = (value, to) => Math.ceil(value / to) * to

/** Parses an ESP-IDF style CSV. Throws an Error with a line number on invalid input. */
export function parseCsv(text) {
  const entries = []
  let cursor = FIRST_FREE_OFFSET
  text.split(/\r?\n/).forEach((raw, index) => {
    const line = raw.replace(/#.*/, '').trim()
    if (!line) return
    const fail = (msg) => { throw new Error(`Linha ${index + 1}: ${msg}`) }
    const cols = line.split(',').map(c => c.trim())
    if (cols.length < 5) fail('esperadas pelo menos 5 colunas (Name, Type, SubType, Offset, Size)')
    const [name, typeText, subText, offsetText, sizeText, flagsText = ''] = cols
    if (!name || name.length > 15) fail('o nome tem de ter entre 1 e 15 caracteres')

    const type = typeText.toLowerCase() in TYPES ? TYPES[typeText.toLowerCase()] : parseNumber(typeText)
    if (!Number.isInteger(type) || type < 0 || type > 0xfe) fail(`tipo inválido "${typeText}"`)
    const table = SUBTYPES[typeName(type)] || {}
    const sub = subText.toLowerCase() in table ? table[subText.toLowerCase()] : parseNumber(subText)
    if (!Number.isInteger(sub) || sub < 0 || sub > 0xff) fail(`subtipo inválido "${subText}"`)

    const size = parseNumber(sizeText)
    if (!Number.isInteger(size) || size <= 0) fail(`tamanho inválido "${sizeText}"`)
    let offset
    if (offsetText) {
      offset = parseNumber(offsetText)
      if (!Number.isInteger(offset) || offset < 0) fail(`offset inválido "${offsetText}"`)
    } else {
      offset = alignUp(cursor, type === TYPES.app ? 0x10000 : 0x1000)
    }
    const flags = flagsText.split(':').some(f => f.trim().toLowerCase() === 'encrypted') ? FLAG_ENCRYPTED : 0
    entries.push({ name, type, subtype: sub, offset, size, flags })
    cursor = offset + size
  })
  return entries
}

/** Returns human readable problems; an empty list means the table is safe to write */
export function validateTable(entries, flashBytes = 0) {
  const problems = []
  if (!entries.length) problems.push('A tabela está vazia.')
  if (entries.length > MAX_ENTRIES) problems.push(`Máximo de ${MAX_ENTRIES} partições.`)
  const names = new Set()
  for (const e of entries) {
    if (names.has(e.name)) problems.push(`Nome repetido: ${e.name}.`)
    names.add(e.name)
    if (e.offset < FIRST_FREE_OFFSET) problems.push(`${e.name}: o offset tem de ser ≥ 0x9000 (a tabela ocupa 0x8000–0x8FFF).`)
    const align = e.type === TYPES.app ? 0x10000 : 0x1000
    if (e.offset % align) problems.push(`${e.name}: o offset tem de estar alinhado a 0x${align.toString(16)}.`)
    if (e.type === TYPES.app && e.size % 0x10000) problems.push(`${e.name}: partições de aplicação devem ter um tamanho múltiplo de 64 KB.`)
    if (flashBytes && e.offset + e.size > flashBytes) problems.push(`${e.name}: termina em 0x${(e.offset + e.size).toString(16)}, depois do fim da flash.`)
  }
  const sorted = entries.slice().sort((a, b) => a.offset - b.offset)
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].offset < sorted[i - 1].offset + sorted[i - 1].size) {
      problems.push(`${sorted[i - 1].name} e ${sorted[i].name} sobrepõem-se.`)
    }
  }
  return problems
}

export const PRESETS = {
  'ota-4mb': `# Name, Type, SubType, Offset, Size
nvs, data, nvs, 0x9000, 0x5000
otadata, data, ota, 0xe000, 0x2000
app0, app, ota_0, 0x10000, 0x140000
app1, app, ota_1, 0x150000, 0x140000
spiffs, data, spiffs, 0x290000, 0x160000
coredump, data, coredump, 0x3f0000, 0x10000`,
  'noota-4mb': `# Name, Type, SubType, Offset, Size
nvs, data, nvs, 0x9000, 0x5000
otadata, data, ota, 0xe000, 0x2000
app0, app, factory, 0x10000, 0x200000
spiffs, data, spiffs, 0x210000, 0x1e0000
coredump, data, coredump, 0x3f0000, 0x10000`,
  'ota-8mb': `# Name, Type, SubType, Offset, Size
nvs, data, nvs, 0x9000, 0x5000
otadata, data, ota, 0xe000, 0x2000
app0, app, ota_0, 0x10000, 0x330000
app1, app, ota_1, 0x340000, 0x330000
spiffs, data, spiffs, 0x670000, 0x180000
coredump, data, coredump, 0x7f0000, 0x10000`,
  'ota-16mb': `# Name, Type, SubType, Offset, Size
nvs, data, nvs, 0x9000, 0x5000
otadata, data, ota, 0xe000, 0x2000
app0, app, ota_0, 0x10000, 0x640000
app1, app, ota_1, 0x650000, 0x640000
spiffs, data, spiffs, 0xc90000, 0x360000
coredump, data, coredump, 0xff0000, 0x10000`
}
