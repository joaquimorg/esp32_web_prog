// Helpers for preparing images before they are handed to esptool-js.
// esptool-js patches the bootloader header itself, but its patch writes the
// decimal text of the value instead of the byte, so the header is patched here.

export const BOOTLOADER_OFFSET = {
  ESP32: 0x1000,
  'ESP32-S2': 0x1000,
  'ESP32-S3': 0x0,
  'ESP32-C3': 0x0,
  'ESP32-C2': 0x0,
  'ESP32-C6': 0x0,
  'ESP32-H2': 0x0,
  'ESP32-P4': 0x2000,
  ESP8266: 0x0
}

export function bootloaderOffset(chip) {
  return BOOTLOADER_OFFSET[chip] ?? 0x1000
}

const FLASH_MODES = { qio: 0, qout: 1, dio: 2, dout: 3 }

const FREQ_ESP32 = { '80m': 0xf, '40m': 0x0, '26m': 0x1, '20m': 0x2 }
const FREQ_BY_CHIP = {
  ESP32: FREQ_ESP32,
  'ESP32-S2': FREQ_ESP32,
  ESP8266: FREQ_ESP32,
  'ESP32-S3': { '80m': 0x0, '40m': 0x1, '20m': 0x2 },
  'ESP32-C3': { '80m': 0x0, '40m': 0x1, '20m': 0x2 },
  'ESP32-P4': { '80m': 0x0, '40m': 0x1, '20m': 0x2 },
  'ESP32-C6': { '80m': 0x0, '40m': 0x0, '20m': 0x2 },
  'ESP32-C2': { '60m': 0x0, '30m': 0x1, '20m': 0x2, '15m': 0x3 },
  'ESP32-H2': { '48m': 0x0, '24m': 0x1, '16m': 0x2, '12m': 0x3 }
}

const SIZE_ESP32 = { '1MB': 0x00, '2MB': 0x10, '4MB': 0x20, '8MB': 0x30, '16MB': 0x40, '32MB': 0x50 }
const SIZE_ESP8266 = { '512KB': 0x00, '256KB': 0x10, '1MB': 0x20, '2MB': 0x30, '4MB': 0x40, '8MB': 0x80, '16MB': 0x90 }

export const FLASH_MODE_OPTIONS = ['keep', 'qio', 'dio', 'qout', 'dout']
export const FLASH_FREQ_OPTIONS = ['keep', '80m', '40m', '26m', '20m']
export const FLASH_SIZE_OPTIONS = ['detect', 'keep', '1MB', '2MB', '4MB', '8MB', '16MB']

export function flashSizeToBytes(label) {
  const m = /^(\d+)(KB|MB)$/.exec(label || '')
  if (!m) return 0
  return Number(m[1]) * (m[2] === 'MB' ? 1024 * 1024 : 1024)
}

// loader.getFlashSize() returns the size in KB
export function flashSizeLabel(kb) {
  if (!kb) return ''
  return kb >= 1024 ? `${kb / 1024}MB` : `${kb}KB`
}

async function sha256(bytes) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
}

/**
 * Applies flash mode/frequency/size to a bootloader image. Other images are
 * returned untouched. Returns a new Uint8Array when something was changed.
 */
export async function patchImageHeader(data, address, chip, { mode = 'keep', freq = 'keep', size = 'keep' } = {}) {
  if (mode === 'keep' && freq === 'keep' && size === 'keep') return data
  if (address !== bootloaderOffset(chip)) return data
  if (data.length < 24 || data[0] !== 0xe9) return data

  const out = new Uint8Array(data)
  if (mode !== 'keep') {
    if (!(mode in FLASH_MODES)) throw new Error(`Modo de flash inválido: ${mode}`)
    out[2] = FLASH_MODES[mode]
  }

  let freqNibble = out[3] & 0x0f
  if (freq !== 'keep') {
    const table = FREQ_BY_CHIP[chip] || FREQ_ESP32
    if (!(freq in table)) throw new Error(`Frequência ${freq} não suportada por ${chip}`)
    freqNibble = table[freq]
  }
  let sizeNibble = out[3] & 0xf0
  if (size !== 'keep') {
    const table = chip === 'ESP8266' ? SIZE_ESP8266 : SIZE_ESP32
    if (!(size in table)) throw new Error(`Tamanho de flash ${size} não suportado por ${chip}`)
    sizeNibble = table[size]
  }
  out[3] = sizeNibble | freqNibble

  // Images with an appended SHA-256 digest (byte 23 of the extended header) must be re-hashed
  if (chip !== 'ESP8266' && out[23] === 1) {
    const digest = await sha256(out.subarray(0, out.length - 32))
    out.set(digest, out.length - 32)
  }
  return out
}

export function bytesToBinaryString(bytes) {
  let out = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    out += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk))
  }
  return out
}

export function binaryStringToBytes(str) {
  const out = new Uint8Array(str.length)
  for (let i = 0; i < str.length; i++) out[i] = str.charCodeAt(i) & 0xff
  return out
}
