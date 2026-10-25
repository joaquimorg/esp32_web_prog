// Minimal ELF32 reader: enough to map code addresses to function names.
// Line numbers need DWARF and are not handled here.

const SHT_SYMTAB = 2
const STT_FUNC = 2

export function parseElfSymbols(bytes) {
  if (bytes.length < 0x34 || bytes[0] !== 0x7f || bytes[1] !== 0x45 || bytes[2] !== 0x4c || bytes[3] !== 0x46) {
    throw new Error('Não é um ficheiro ELF.')
  }
  if (bytes[4] !== 1 || bytes[5] !== 1) {
    throw new Error('Só são suportados ELF de 32 bits little-endian (família ESP32).')
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const shoff = view.getUint32(0x20, true)
  const shentsize = view.getUint16(0x2e, true)
  const shnum = view.getUint16(0x30, true)
  if (!shoff || !shnum || shentsize < 40) throw new Error('O ELF não tem tabela de secções.')

  const section = (i) => {
    const o = shoff + i * shentsize
    if (o + 40 > bytes.length) throw new Error('ELF truncado.')
    return {
      type: view.getUint32(o + 4, true),
      offset: view.getUint32(o + 16, true),
      size: view.getUint32(o + 20, true),
      link: view.getUint32(o + 24, true),
      entsize: view.getUint32(o + 36, true) || 16
    }
  }

  let symtab = null
  for (let i = 0; i < shnum; i++) {
    const sec = section(i)
    if (sec.type === SHT_SYMTAB) {
      symtab = sec
      break
    }
  }
  if (!symtab) throw new Error('O ELF não tem tabela de símbolos (foi feito strip?).')
  const strtab = section(symtab.link)

  const readName = (offset) => {
    let end = strtab.offset + offset
    const start = end
    while (end < bytes.length && bytes[end] !== 0) end++
    return new TextDecoder().decode(bytes.subarray(start, end))
  }

  const symbols = []
  for (let o = symtab.offset; o + symtab.entsize <= symtab.offset + symtab.size; o += symtab.entsize) {
    const info = bytes[o + 12]
    const value = view.getUint32(o + 4, true)
    if ((info & 0xf) !== STT_FUNC || !value) continue
    symbols.push({ name: readName(view.getUint32(o, true)), addr: value, size: view.getUint32(o + 8, true) })
  }
  symbols.sort((a, b) => a.addr - b.addr)
  return symbols
}

/** Finds the function containing `addr`, or null */
export function lookupSymbol(symbols, addr) {
  let lo = 0
  let hi = symbols.length - 1
  let found = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (symbols[mid].addr <= addr) {
      found = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  if (found < 0) return null
  const sym = symbols[found]
  const delta = addr - sym.addr
  if (sym.size ? delta >= sym.size : delta > 0x100) return null
  return { name: sym.name, offset: delta }
}

const HEX_RE = /0x[0-9a-f]{8}\b/gi

/** Extracts every 32-bit hex value from the text, keeping the order and dropping repeats */
export function extractAddresses(text) {
  const seen = new Set()
  const out = []
  for (const m of text.matchAll(HEX_RE)) {
    const value = Number.parseInt(m[0], 16)
    if (seen.has(value)) continue
    seen.add(value)
    out.push(value)
  }
  return out
}

export function decodeText(symbols, text) {
  return extractAddresses(text)
    .map(addr => ({ addr, hit: lookupSymbol(symbols, addr) }))
    .filter(r => r.hit)
}
