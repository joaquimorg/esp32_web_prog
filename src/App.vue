<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ESPLoader, Transport } from 'esptool-js'
import { md5 } from './lib/md5'
import { loadJson, saveJson } from './lib/storage'
import { classifyLine, highlightParts, matchesLevel, matchesText } from './lib/logs'
import {
  bootloaderOffset, FLASH_FREQ_OPTIONS, FLASH_MODE_OPTIONS, FLASH_SIZE_OPTIONS,
  binaryStringToBytes, bytesToBinaryString, flashSizeLabel, flashSizeToBytes, patchImageHeader
} from './lib/flashimage'

// Theme & Locale
const dark = ref(true)
const lang = ref('pt') // 'pt' (PT-PT) | 'en'

// Navigation
const activeView = ref('programmer') // 'programmer' | 'console' | 'guide'

// Serial Connection
const port = ref(null)
const connected = ref(false)
const connecting = ref(false)
const identifying = ref(false)
const baudRate = ref(115200)
const lineEnding = ref('\n')
const chipType = ref('ESP32')

// Board Identification Data
const boardInfo = ref({
  detected: false,
  chipName: '',
  description: '',
  macAddress: '',
  features: [],
  crystalFreq: '',
  vendorId: '',
  productId: '',
  usbBridge: '',
  detectionMethod: '' // 'bootloader' | 'usb_vid' | 'serial_log'
})
const copiedMac = ref(false)

// Firmware Flashing & Presets
const firmwareFiles = ref([]) // [{ id, file, address }]
const firmwareSource = ref('custom') // 'custom' | 'presets'
const selectedPresetId = ref(null)
const isDragging = ref(false)
const progress = ref(0)
const isFlashing = ref(false)
const isErasing = ref(false)
const flashStatusText = ref('')
const flashMode = ref('keep')
const flashFreq = ref('keep')
const flashSize = ref('keep')
const verifyAfterFlash = ref(true)
const monitorAfterFlash = ref(true)
const showFlashOptions = ref(false)

// Serial Console
const serialCommand = ref('')
const commandHistory = ref([])
const historyIndex = ref(-1)
const autoScroll = ref(true)
const showTimestamps = ref(true)
const terminalRef = ref(null)
const logFilter = ref('')
const logLevel = ref('all') // 'all' | 'warn' | 'error'
const MAX_LOG_LINES = 5000

// Custom Line Ending Dropdown
const showEndingMenu = ref(false)
const endingDropdownRef = ref(null)

const lineEndingOptions = computed(() => {
  if (lang.value === 'pt') {
    return [
      { value: '\n', label: 'LF (\\n) — Padrão ESP32' },
      { value: '\r\n', label: 'CRLF (\\r\\n) — Windows' },
      { value: '\r', label: 'CR (\\r)' },
      { value: '', label: 'Nenhum' }
    ]
  }
  return [
    { value: '\n', label: 'LF (\\n) — ESP32 default' },
    { value: '\r\n', label: 'CRLF (\\r\\n) — Windows' },
    { value: '\r', label: 'CR (\\r)' },
    { value: '', label: 'None' }
  ]
})

const currentLineEndingLabel = computed(() => {
  if (lineEnding.value === '\n') return 'LF (\\n)'
  if (lineEnding.value === '\r\n') return 'CRLF (\\r\\n)'
  if (lineEnding.value === '\r') return 'CR (\\r)'
  return lang.value === 'pt' ? 'Nenhum' : 'None'
})

function selectEnding(val) {
  lineEnding.value = val
  showEndingMenu.value = false
}

function onClickOutside(e) {
  if (endingDropdownRef.value && !endingDropdownRef.value.contains(e.target)) {
    showEndingMenu.value = false
  }
}

const logs = ref([
  { time: getTimestamp(), text: 'ESP Studio inicializado com sucesso. Pronto para ligar ao dispositivo.', kind: 'system' }
])

let reader = null
let writer = null

// Texts / I18N (Português Europeu PT-PT & English EN)
const t = computed(() => {
  if (lang.value === 'pt') {
    return {
      title: 'ESP Studio',
      subtitle: 'Gravador Web & Monitorização Serial',
      navProgrammer: 'Programador',
      navConsole: 'Consola Serial',
      navGuide: 'Guia & Pinagem',
      webSerialSupport: 'Web Serial suportada',
      webSerialNoSupport: 'Navegador incompatível',
      connected: 'Ligado',
      disconnected: 'Desligado',
      connecting: 'A ligar...',
      disconnect: 'Desligar',
      connectDevice: 'Ligar Dispositivo',
      heroTitle: 'Gravação e Monitorização de ESP32',
      heroDesc: 'Grave firmwares (.bin) com rapidez e monitorize a sua placa em tempo real via Web Serial diretamente no navegador.',
      heroConnected: 'Dispositivo ligado e pronto a comunicar.',
      chipLabel: 'Microcontrolador (Target)',
      speedLabel: 'Velocidade (Baud Rate)',
      speedHint: 'A velocidade recomendada para a maioria das placas ESP32 é 115200 bps.',
      choosePort: 'Selecionar Porta USB',
      firmwareCardTitle: 'Ficheiro de Firmware',
      firmwareCardDesc: 'Arraste ou selecione o ficheiro binário compilado (.bin).',
      dragDropLabel: 'Arraste o ficheiro .bin para aqui ou clique para procurar',
      dragDropHint: 'Suporta binários do ESP-IDF, Arduino, MicroPython, CircuitPython e NodeMCU',
      fileSelected: 'Ficheiro pronto para gravação',
      removeFile: 'Remover ficheiro',
      addressLabel: 'Endereço de Memória (Offset)',
      flashBtn: 'Gravar Firmware no ESP32',
      flashingBtn: 'A gravar Firmware...',
      terminalTitle: 'Consola Serial Interativa',
      terminalDesc: 'Visualize a emissão de dados da placa e envie comandos em tempo real.',
      send: 'Enviar',
      cmdPlaceholder: 'Escreva um comando para enviar (ex.: help, reset)...',
      clearLogs: 'Limpar',
      exportLogs: 'Exportar .txt',
      resetChip: 'Reiniciar Placa',
      autoScroll: 'Deslocamento auto',
      timestamps: 'Horas',
      quickCommands: 'Comandos Rápidos:',
      guideTitle: 'Guia de Utilização & Pinagem',
      guideDesc: 'Instruções essenciais para ligar, gravar e diagnosticar a sua placa ESP32 com total segurança.',
      step1Title: '1. Ligação Física',
      step1Desc: 'Utilize um cabo USB de boa qualidade com suporte a dados. Ligue a sua placa ESP32 a uma porta USB direta do computador.',
      step2Title: '2. Seleção do Ficheiro',
      step2Desc: 'Compile o seu código no Arduino IDE, PlatformIO ou ESP-IDF e selecione o ficheiro gerado com extensão .bin.',
      step3Title: '3. Gravação & Monitorização',
      step3Desc: 'Clique em Gravar Firmware. Após a conclusão, aceda à Consola Serial para acompanhar a execução do projeto.',
      pinoutTitle: 'Referência Rápida de GPIOs (ESP32 DevKit V1)',
      pinoutNotice: 'Atenção aos pinos GPIO 6-11 (ligados à memória flash interna) e GPIO 0, 2, 12, 15 (pinos de arranque / strapping pins).',
      boardIdentified: 'Placa Identificada com Sucesso',
      chipAutoSelected: 'Microcontrolador selecionado automaticamente',
      macAddress: 'Endereço MAC',
      crystalClock: 'Frequência de Cristal',
      usbBridge: 'Conversor USB-Serial',
      features: 'Funcionalidades',
      reidentify: 'Reidentificar Placa',
      copyMac: 'Copiar MAC',
      macCopied: 'Copiado!'
    }
  }
  return {
    title: 'ESP Studio',
    subtitle: 'Web Flasher & Serial Monitor',
    navProgrammer: 'Programmer',
    navConsole: 'Serial Console',
    navGuide: 'Guide & Pinout',
    webSerialSupport: 'Web Serial supported',
    webSerialNoSupport: 'Browser unsupported',
    connected: 'Connected',
    disconnected: 'Disconnected',
    connecting: 'Connecting...',
    disconnect: 'Disconnect',
    connectDevice: 'Connect Device',
    heroTitle: 'ESP32 Firmware Flasher & Monitor',
    heroDesc: 'Flash .bin binaries with ultra speed and debug your boards in real-time right inside your browser via Web Serial.',
    heroConnected: 'Device connected and ready for transmission.',
    chipLabel: 'Microcontroller (Target)',
    speedLabel: 'Baud Rate Speed',
    speedHint: 'Standard recommended baud rate for most firmware is 115200.',
    choosePort: 'Choose USB Port',
    firmwareCardTitle: 'Firmware Binary File',
    firmwareCardDesc: 'Drag or select the compiled binary (.bin) file.',
    dragDropLabel: 'Drag & drop your .bin file here or browse',
    dragDropHint: 'Supports ESP-IDF, Arduino, MicroPython, CircuitPython and NodeMCU',
    fileSelected: 'File ready to flash',
    removeFile: 'Remove',
    addressLabel: 'Flash Memory Offset Address',
    flashBtn: 'Flash Firmware to ESP32',
    flashingBtn: 'Flashing Firmware...',
    terminalTitle: 'Interactive Serial Terminal',
    terminalDesc: 'Stream real-time device logs and send serial commands directly.',
    send: 'Send',
    cmdPlaceholder: 'Type a command to send (e.g., help, reset)...',
    clearLogs: 'Clear',
    exportLogs: 'Export .txt',
    resetChip: 'Reset Board',
    autoScroll: 'Auto-scroll',
    timestamps: 'Timestamps',
    quickCommands: 'Quick Commands:',
    guideTitle: 'Getting Started & Pinout Guide',
    guideDesc: 'Essential tips to connect, flash, and troubleshoot your ESP32 microcontrollers safely.',
    step1Title: '1. Physical Connection',
    step1Desc: 'Use a high-quality data USB cable and connect your ESP32 directly to a computer USB port.',
    step2Title: '2. Select Binary',
    step2Desc: 'Compile your code in Arduino IDE, PlatformIO, or ESP-IDF and locate the generated .bin file.',
    step3Title: '3. Flash & Monitor',
    step3Desc: 'Hit Flash Firmware. Once completed, jump to the Serial Console tab to inspect the running output.',
    pinoutTitle: 'ESP32 DevKit V1 Pinout Reference',
    pinoutNotice: 'Take care with GPIO 6-11 (connected to internal SPI flash) and GPIO 0, 2, 12, 15 (boot strapping pins).',
    boardIdentified: 'Board Successfully Identified',
    chipAutoSelected: 'Microcontroller automatically chosen',
    macAddress: 'MAC Address',
    crystalClock: 'Crystal Frequency',
    usbBridge: 'USB-Serial Bridge',
    features: 'Features',
    reidentify: 'Re-identify Board',
    copyMac: 'Copy MAC',
    macCopied: 'Copied!'
  }
})

const supportsSerial = computed(() => typeof navigator !== 'undefined' && 'serial' in navigator)
const connectionLabel = computed(() => {
  if (!connected.value) return t.value.disconnected
  if (boardInfo.value.chipName) return `${t.value.connected}: ${boardInfo.value.chipName}`
  return t.value.connected
})

const filterNeedle = computed(() => logFilter.value.trim().toLowerCase())
const filteredLogs = computed(() => {
  const needle = filterNeedle.value
  if (!needle && logLevel.value === 'all') return logs.value
  return logs.value.filter(l => matchesLevel(l, logLevel.value) && matchesText(l, needle))
})

function getTimestamp() {
  const d = new Date()
  return d.toTimeString().split(' ')[0]
}

let logSeq = 0
logs.value.forEach(l => { l.id = ++logSeq; l.level = '' })

function addLog(text, kind = 'device') {
  logs.value.push({ id: ++logSeq, time: getTimestamp(), text, kind, level: kind === 'device' ? classifyLine(text) : '' })
  if (logs.value.length > MAX_LOG_LINES) {
    logs.value.splice(0, logs.value.length - MAX_LOG_LINES)
  }
  if (autoScroll.value) {
    nextTick(() => {
      if (terminalRef.value) {
        terminalRef.value.scrollTop = terminalRef.value.scrollHeight
      }
    })
  }
}

function toggleTheme() {
  dark.value = !dark.value
  localStorage.setItem('esp-studio-theme', dark.value ? 'dark' : 'light')
}

function toggleLang() {
  lang.value = lang.value === 'pt' ? 'en' : 'pt'
  localStorage.setItem('esp-studio-lang', lang.value)
}

function getUsbDetails(info) {
  if (!info || !info.usbVendorId) return null
  const vid = info.usbVendorId
  const pid = info.usbProductId || 0
  let vendor = 'Dispositivo USB-Serial genérico'
  let inferredChip = null

  if (vid === 0x303a) {
    vendor = 'Espressif Systems (USB Nativo / JTAG)'
    if (pid === 0x1001) inferredChip = 'ESP32-S3'
    else if (pid === 0x0002) inferredChip = 'ESP32-S2'
    else if (pid === 0x1002) inferredChip = 'ESP32-C6'
  } else if (vid === 0x10c4) {
    vendor = 'Silicon Labs CP210x'
  } else if (vid === 0x1a86) {
    vendor = 'WCH CH340 / CH341'
  } else if (vid === 0x0403) {
    vendor = 'FTDI FT232R'
  }

  return {
    vendor,
    inferredChip,
    vidHex: `0x${vid.toString(16).padStart(4, '0').toUpperCase()}`,
    pidHex: `0x${pid.toString(16).padStart(4, '0').toUpperCase()}`
  }
}

// Automatically choose microcontroller in dropdown
function setChipTarget(name) {
  if (!name) return
  const upper = name.toUpperCase()
  if (upper.includes('ESP32-S3')) chipType.value = 'ESP32-S3'
  else if (upper.includes('ESP32-S2')) chipType.value = 'ESP32-S2'
  else if (upper.includes('ESP32-C6')) chipType.value = 'ESP32-C6'
  else if (upper.includes('ESP32-C3')) chipType.value = 'ESP32-C3'
  else if (upper.includes('ESP32-C2')) chipType.value = 'ESP32-C2'
  else if (upper.includes('ESP32-H2')) chipType.value = 'ESP32-H2'
  else if (upper.includes('ESP32-P4')) chipType.value = 'ESP32-P4'
  else if (upper.includes('ESP8266')) {
    chipType.value = 'ESP8266'
    firmwareFiles.value.forEach(f => { if (f.address === '0x10000') f.address = '0x0' })
  } else if (upper.includes('ESP32')) chipType.value = 'ESP32'
}

function copyMac() {
  if (boardInfo.value.macAddress) {
    navigator.clipboard?.writeText(boardInfo.value.macAddress)
    copiedMac.value = true
    setTimeout(() => { copiedMac.value = false }, 2000)
  }
}

// Interrogate chip using ESPLoader
async function detectBoardHardware(targetPort) {
  identifying.value = true
  addLog(lang.value === 'pt' ? 'A consultar o bootloader para identificar o modelo da placa...' : 'Probing bootloader to detect board hardware...', 'system')

  const usbInfo = targetPort.getInfo ? targetPort.getInfo() : {}
  const usbMeta = getUsbDetails(usbInfo)

  if (usbMeta) {
    boardInfo.value.vendorId = usbMeta.vidHex
    boardInfo.value.productId = usbMeta.pidHex
    boardInfo.value.usbBridge = usbMeta.vendor
    if (usbMeta.inferredChip && !boardInfo.value.chipName) {
      setChipTarget(usbMeta.inferredChip)
    }
  }

  try {
    const dummyTerminal = {
      clean: () => {},
      write: () => {},
      writeLine: () => {}
    }
    const transport = new Transport(targetPort, true)
    const loader = new ESPLoader({
      transport,
      baudrate: Number(baudRate.value),
      terminal: dummyTerminal,
      debugLogging: false
    })

    // Detect chip with 3 sync attempts
    await loader.detectChip('default_reset')

    if (loader.chip) {
      const rawName = loader.chip.CHIP_NAME || 'ESP32'
      const desc = await loader.chip.getChipDescription(loader).catch(() => rawName)
      const mac = await loader.chip.readMac(loader).catch(() => null)
      const rawFeatures = await loader.chip.getChipFeatures(loader).catch(() => [])
      const crystal = await loader.chip.getCrystalFreq(loader).catch(() => null)

      const cleanFeatures = (rawFeatures || []).map(f => String(f).trim()).filter(Boolean)

      boardInfo.value = {
        detected: true,
        chipName: rawName,
        description: desc,
        macAddress: mac,
        features: cleanFeatures,
        crystalFreq: crystal ? `${crystal} MHz` : '',
        vendorId: usbMeta?.vidHex || '',
        productId: usbMeta?.pidHex || '',
        usbBridge: usbMeta?.vendor || 'USB UART Bridge',
        detectionMethod: 'bootloader'
      }

      // Automatically select the microcontroller!
      setChipTarget(rawName)

      addLog(lang.value === 'pt'
        ? `✓ Placa identificada: ${desc}${mac ? ` (MAC: ${mac})` : ''}. Microcontrolador selecionado: ${chipType.value}`
        : `✓ Board identified: ${desc}${mac ? ` (MAC: ${mac})` : ''}. Target set to: ${chipType.value}`,
        'success'
      )
    }

    // Reset board back to normal application mode
    await loader.after('hard_reset').catch(() => {})
    await transport.disconnect().catch(() => {})
  } catch (err) {
    addLog(lang.value === 'pt'
      ? `Aviso: Sincronização do bootloader dispensada (${err.message}). A placa continuará em modo de transmissão normal.`
      : `Notice: Bootloader sync skipped (${err.message}). Board will stream normal serial.`,
      'muted'
    )
  } finally {
    identifying.value = false
  }
}

async function connect() {
  if (!supportsSerial.value) {
    addLog(lang.value === 'pt' ? 'Web Serial indisponível. Utilize o Chrome, Edge, Opera ou Brave num computador de secretária.' : 'Web Serial unavailable. Use Chrome, Edge, Opera or Brave on desktop.', 'error')
    return
  }
  connecting.value = true
  try {
    port.value = await navigator.serial.requestPort()

    // 1. First: identify board hardware via bootloader
    await detectBoardHardware(port.value)

    // 2. Open standard serial port for monitor & commands
    await new Promise(r => setTimeout(r, 60))
    await port.value.open({ baudRate: Number(baudRate.value) })
    connected.value = true
    writer = port.value.writable?.getWriter()

    addLog(lang.value === 'pt' ? `Porta serial aberta com sucesso @ ${baudRate.value} baud.` : `USB port opened successfully @ ${baudRate.value} baud.`, 'success')
    readSerial()
  } catch (error) {
    if (error.name === 'NotFoundError') {
      addLog(lang.value === 'pt' ? 'Nenhuma porta USB foi selecionada.' : 'No port was selected.', 'muted')
    } else {
      addLog(`${lang.value === 'pt' ? 'Falha ao ligar' : 'Failed to connect'}: ${error.message}`, 'error')
    }
  } finally {
    connecting.value = false
  }
}

async function reidentifyBoard() {
  if (!port.value || !connected.value) return
  addLog(lang.value === 'pt' ? 'A pausar monitor serial para reidentificar a placa...' : 'Pausing serial monitor to re-identify board...', 'system')
  try {
    if (reader) {
      await reader.cancel()
      reader.releaseLock()
      reader = null
    }
    if (writer) {
      writer.releaseLock()
      writer = null
    }
    await port.value.close()

    await detectBoardHardware(port.value)

    await new Promise(r => setTimeout(r, 60))
    await port.value.open({ baudRate: Number(baudRate.value) })
    writer = port.value.writable?.getWriter()
    readSerial()
  } catch (err) {
    addLog(`${lang.value === 'pt' ? 'Erro na reidentificação' : 'Re-identify error'}: ${err.message}`, 'error')
  }
}

async function disconnect() {
  try {
    if (reader) {
      await reader.cancel()
      reader.releaseLock()
    }
    if (writer) {
      writer.releaseLock()
    }
    if (port.value) {
      await port.value.close()
    }
  } catch (e) {
    // Port might already be closed
  }
  reader = null
  writer = null
  port.value = null
  connected.value = false
  boardInfo.value.detected = false
  addLog(lang.value === 'pt' ? 'Dispositivo desligado.' : 'Device disconnected.', 'muted')
}

function scanSerialForChip(line) {
  if (boardInfo.value.detected && boardInfo.value.detectionMethod === 'bootloader') return
  const s3Match = line.match(/esp32-?s3/i)
  const s2Match = line.match(/esp32-?s2/i)
  const c3Match = line.match(/esp32-?c3/i)
  const c6Match = line.match(/esp32-?c6/i)
  const esp8266Match = line.match(/esp8266/i)
  const esp32Match = line.match(/esp32/i)

  let detected = null
  if (s3Match) detected = 'ESP32-S3'
  else if (s2Match) detected = 'ESP32-S2'
  else if (c6Match) detected = 'ESP32-C6'
  else if (c3Match) detected = 'ESP32-C3'
  else if (esp8266Match) detected = 'ESP8266'
  else if (esp32Match) detected = 'ESP32'

  if (detected && !boardInfo.value.chipName) {
    setChipTarget(detected)
    boardInfo.value.detected = true
    boardInfo.value.chipName = detected
    boardInfo.value.description = `${detected} (detetado via log serial)`
    boardInfo.value.detectionMethod = 'serial_log'
    addLog(`✓ Microcontrolador detetado via emissão serial: ${detected}`, 'success')
  }
}

async function readSerial() {
  if (!port.value?.readable) return
  reader = port.value.readable.getReader()
  const decoder = new TextDecoder()
  try {
    while (connected.value) {
      const { value, done } = await reader.read()
      if (done) break
      const text = decoder.decode(value)
      if (text) {
        const lines = text.split(/\r?\n/)
        for (const line of lines) {
          if (line.trim()) {
            addLog(line, 'device')
            scanSerialForChip(line)
          }
        }
      }
    }
  } catch (error) {
    if (connected.value) {
      addLog(`${lang.value === 'pt' ? 'Leitura serial interrompida' : 'Serial read interrupted'}: ${error.message}`, 'error')
    }
  }
}

async function sendCommand(commandText) {
  if (!connected.value || !writer) {
    addLog(lang.value === 'pt' ? 'Ligue um dispositivo antes de enviar comandos.' : 'Connect a device first before sending commands.', 'error')
    return
  }
  try {
    const fullCmd = `${commandText}${lineEnding.value}`
    await writer.write(new TextEncoder().encode(fullCmd))
    addLog(`> ${commandText}`, 'command')
  } catch (err) {
    addLog(`${lang.value === 'pt' ? 'Erro ao enviar comando' : 'Failed to send command'}: ${err.message}`, 'error')
  }
}

async function submitCommand() {
  const cmd = serialCommand.value.trim()
  if (!cmd) return
  
  if (commandHistory.value[commandHistory.value.length - 1] !== cmd) {
    commandHistory.value.push(cmd)
  }
  historyIndex.value = -1

  await sendCommand(cmd)
  serialCommand.value = ''
}

function handleHistoryKey(e) {
  if (!commandHistory.value.length) return
  if (e.key === 'ArrowUp') {
    e.preventDefault()
    if (historyIndex.value === -1) {
      historyIndex.value = commandHistory.value.length - 1
    } else if (historyIndex.value > 0) {
      historyIndex.value--
    }
    serialCommand.value = commandHistory.value[historyIndex.value] || ''
  } else if (e.key === 'ArrowDown') {
    e.preventDefault()
    if (historyIndex.value !== -1) {
      if (historyIndex.value < commandHistory.value.length - 1) {
        historyIndex.value++
        serialCommand.value = commandHistory.value[historyIndex.value] || ''
      } else {
        historyIndex.value = -1
        serialCommand.value = ''
      }
    }
  }
}

async function hardwareReset() {
  if (!port.value) {
    addLog(lang.value === 'pt' ? 'Nenhuma placa ligada.' : 'No board connected.', 'error')
    return
  }
  try {
    addLog(lang.value === 'pt' ? 'A enviar impulso de reinicialização (RTS/DTR)...' : 'Pulsing reset signals (RTS/DTR)...', 'system')
    if (port.value.setSignals) {
      await port.value.setSignals({ dataTerminalReady: false, requestToSend: true })
      await new Promise(r => setTimeout(r, 100))
      await port.value.setSignals({ dataTerminalReady: false, requestToSend: false })
      addLog(lang.value === 'pt' ? 'Sinal de reinicialização emitido com sucesso.' : 'Reset signal pulsed.', 'success')
    } else {
      await sendCommand('reset')
    }
  } catch (err) {
    addLog(`${lang.value === 'pt' ? 'Erro ao reiniciar' : 'Reset error'}: ${err.message}`, 'error')
  }
}

let fileSeq = 0

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

function parseAddress(text) {
  const value = String(text).trim()
  if (!/^(0x[0-9a-f]+|\d+)$/i.test(value)) return NaN
  return Number.parseInt(value, 0)
}

// Typical Arduino IDE / PlatformIO / ESP-IDF output names
function guessAddress(name) {
  const n = name.toLowerCase()
  if (/merged|factory|full/.test(n)) return '0x0'
  if (n.includes('bootloader')) return `0x${bootloaderOffset(chipType.value).toString(16)}`
  if (n.includes('partition')) return '0x8000'
  if (n.includes('boot_app0')) return '0xe000'
  return chipType.value === 'ESP8266' ? '0x0' : '0x10000'
}

const firmwareTotalSize = computed(() => formatBytes(firmwareFiles.value.reduce((sum, f) => sum + f.file.size, 0)))

// Invalid addresses and overlapping images are reported before anything is written
const firmwareIssues = computed(() => {
  const issues = []
  const ranges = []
  for (const f of firmwareFiles.value) {
    const address = parseAddress(f.address)
    if (!Number.isFinite(address)) {
      issues.push(lang.value === 'pt'
        ? `Endereço inválido em ${f.file.name}. Utilize o formato hexadecimal como 0x10000.`
        : `Invalid address for ${f.file.name}.`)
      continue
    }
    ranges.push({ name: f.file.name, start: address, end: address + f.file.size })
  }
  ranges.sort((a, b) => a.start - b.start)
  for (let i = 1; i < ranges.length; i++) {
    if (ranges[i].start < ranges[i - 1].end) {
      issues.push(lang.value === 'pt'
        ? `${ranges[i - 1].name} e ${ranges[i].name} sobrepõem-se na flash.`
        : `${ranges[i - 1].name} and ${ranges[i].name} overlap in flash.`)
    }
  }
  return issues
})

function addFirmwareFiles(fileList) {
  for (const file of Array.from(fileList || [])) {
    if (!file.name.toLowerCase().endsWith('.bin')) {
      addLog(lang.value === 'pt' ? `Aviso: ${file.name} não tem extensão .bin.` : `Warning: ${file.name} does not have a .bin extension.`, 'system')
    }
    const address = guessAddress(file.name)
    firmwareFiles.value.push({ id: ++fileSeq, file, address })
    addLog(lang.value === 'pt' ? `Ficheiro carregado: ${file.name} (${formatBytes(file.size)}) em ${address}` : `Firmware loaded: ${file.name} (${formatBytes(file.size)}) at ${address}`, 'system')
  }
}

function onFileSelect(event) {
  addFirmwareFiles(event.target.files)
  event.target.value = ''
}

function handleDrop(event) {
  isDragging.value = false
  addFirmwareFiles(event.dataTransfer?.files)
}

function removeFirmwareFile(id) {
  firmwareFiles.value = firmwareFiles.value.filter(f => f.id !== id)
}

function clearFirmware() {
  firmwareFiles.value = []
  selectedPresetId.value = null
}

// Firmware Presets (Erase)
const firmwarePresets = computed(() => {
  if (lang.value === 'pt') {
    return [
      {
        id: 'erase_flash',
        title: 'Limpeza Total de Fábrica (Erase Flash)',
        badge: 'Format',
        isEraseOnly: true,
        targetChip: chipType.value,
        defaultOffset: '0x0',
        fileName: '',
        fileUrl: '',
        description: 'Apaga por completo todos os blocos da memória Flash. Remove partições corrompidas, ficheiros antigos e restaura o estado limpo de fábrica.',
        pinHint: 'Compatível com todos os modelos ESP',
        sizeFormatted: 'Erase 100%'
      }
    ]
  }
  return [
    {
      id: 'erase_flash',
      title: 'Full Factory Reset (Erase Flash)',
      badge: 'Format',
      isEraseOnly: true,
      targetChip: chipType.value,
      defaultOffset: '0x0',
      fileName: '',
      fileUrl: '',
      description: 'Erases all flash sectors completely. Wipes corrupt partition tables, stale configurations, and leaves a fresh chip.',
      pinHint: 'Works on all ESP targets',
      sizeFormatted: 'Erase 100%'
    }
  ]
})

const activePreset = computed(() => {
  return firmwarePresets.value.find(p => p.id === selectedPresetId.value) || null
})

function selectPreset(preset) {
  selectedPresetId.value = preset.id
}

async function releaseSerial() {
  if (reader) {
    await reader.cancel().catch(() => {})
    try { reader.releaseLock() } catch (e) { /* already released */ }
    reader = null
  }
  if (writer) {
    try { writer.releaseLock() } catch (e) { /* already released */ }
    writer = null
  }
  if (port.value) await port.value.close().catch(() => {})
}

const loaderTerminal = {
  clean: () => {},
  write: (data) => addLog(String(data).trim(), 'muted'),
  writeLine: (data) => addLog(String(data).trim(), 'muted'),
}

// Hands the port over to esptool-js, runs `task` against the connected bootloader
// and resets the board afterwards.
async function runWithLoader(task) {
  await releaseSerial()
  const transport = new Transport(port.value, true)
  const loader = new ESPLoader({
    transport,
    baudrate: Number(baudRate.value),
    terminal: loaderTerminal,
    debugLogging: false
  })
  try {
    const chipDesc = await loader.main()
    setChipTarget(loader.chip?.CHIP_NAME || chipDesc)
    await task(loader, chipDesc)
    await loader.after('hard_reset')
  } finally {
    await transport.disconnect().catch(() => {})
  }
}

// Re-opens the serial monitor once the bootloader session is over and the board has rebooted
async function reopenMonitor() {
  await new Promise(r => setTimeout(r, 400))
  try {
    await port.value.open({ baudRate: Number(baudRate.value) })
    writer = port.value.writable?.getWriter()
    connected.value = true
    addLog(lang.value === 'pt' ? `Monitor serial reaberto @ ${baudRate.value} baud.` : `Serial monitor reopened @ ${baudRate.value} baud.`, 'success')
    readSerial()
    return true
  } catch (err) {
    connected.value = false
    addLog(lang.value === 'pt'
      ? `Não foi possível reabrir a porta (${err.message}). Volte a ligar a placa para continuar.`
      : `Could not reopen the port (${err.message}). Reconnect the board to continue.`, 'muted')
    return false
  }
}

async function eraseFullFlash() {
  if (!connected.value) {
    addLog(lang.value === 'pt' ? 'Ligue o ESP32 antes de formatar a memória Flash.' : 'Connect your ESP32 before erasing flash.', 'error')
    return
  }
  isErasing.value = true
  progress.value = 10
  flashStatusText.value = lang.value === 'pt' ? 'A inicializar bootloader para limpeza total...' : 'Starting bootloader for full erase...'
  addLog(lang.value === 'pt' ? 'A iniciar formatação completa da memória Flash (Erase All)...' : 'Starting full flash erase (Erase All)...', 'system')

  try {
    await runWithLoader(async (loader) => {
      flashStatusText.value = lang.value === 'pt' ? 'A apagar todos os setores da flash...' : 'Erasing all flash sectors...'
      addLog(lang.value === 'pt' ? 'A apagar todos os blocos e setores da memória flash (pode demorar alguns segundos)...' : 'Erasing all flash blocks (this may take a few seconds)...', 'system')
      await loader.eraseFlash()
      flashStatusText.value = lang.value === 'pt' ? 'A reiniciar...' : 'Resetting...'
    })

    connected.value = false
    if (monitorAfterFlash.value) await reopenMonitor()
    progress.value = 100
    flashStatusText.value = lang.value === 'pt' ? 'Memória flash totalmente limpa!' : 'Flash memory completely erased!'
    addLog(lang.value === 'pt' ? '✓ Memória Flash apagada com sucesso! A placa foi reposta ao estado de fábrica limpo.' : '✓ Flash memory erased successfully! Board reset to clean factory state.', 'success')
  } catch (err) {
    connected.value = false
    flashStatusText.value = lang.value === 'pt' ? 'Falha na formatação.' : 'Erase failed.'
    addLog(`${lang.value === 'pt' ? 'Erro na limpeza da flash' : 'Erase error'}: ${err.message}`, 'error')
    if (monitorAfterFlash.value) await reopenMonitor()
  } finally {
    isErasing.value = false
  }
}

async function readFileBytes(file) {
  return new Uint8Array(await file.arrayBuffer())
}

async function flash() {
  if (!connected.value) {
    addLog(lang.value === 'pt' ? 'Ligue o ESP32 antes de gravar o firmware.' : 'Connect your ESP32 before flashing.', 'error')
    return
  }
  if (!firmwareFiles.value.length) {
    addLog(lang.value === 'pt' ? 'Selecione primeiro um ficheiro de firmware (.bin).' : 'Select a .bin firmware file first.', 'error')
    return
  }
  if (firmwareIssues.value.length) {
    firmwareIssues.value.forEach(msg => addLog(msg, 'error'))
    return
  }

  const entries = firmwareFiles.value.map(f => ({ name: f.file.name, file: f.file, addressText: f.address, address: parseAddress(f.address) }))

  isFlashing.value = true
  progress.value = 2
  flashStatusText.value = lang.value === 'pt' ? 'A iniciar bootloader...' : 'Starting bootloader...'
  addLog(lang.value === 'pt' ? 'A preparar gravação de firmware. A libertar canal serial de monitorização...' : 'Preparing flash. Releasing serial monitor lock...', 'system')

  try {
    await runWithLoader(async (loader, chipDesc) => {
      addLog(lang.value === 'pt' ? `Chip confirmado com sucesso: ${chipDesc}` : `Chip confirmed: ${chipDesc}`, 'success')

      flashStatusText.value = lang.value === 'pt' ? 'A ler ficheiros binários...' : 'Reading binaries...'
      for (const entry of entries) entry.bytes = await readFileBytes(entry.file)

      let sizeLabel = flashSize.value
      if (sizeLabel === 'detect') {
        sizeLabel = flashSizeLabel(await loader.getFlashSize().catch(() => 0)) || 'keep'
        addLog(lang.value === 'pt'
          ? `Tamanho da flash detetado: ${sizeLabel === 'keep' ? 'desconhecido' : sizeLabel}`
          : `Detected flash size: ${sizeLabel === 'keep' ? 'unknown' : sizeLabel}`, 'system')
      }
      const flashBytes = flashSizeToBytes(sizeLabel)
      for (const entry of entries) {
        if (flashBytes && entry.address + entry.bytes.length > flashBytes) {
          throw new Error(lang.value === 'pt'
            ? `${entry.name} (${(entry.bytes.length / 1024).toFixed(0)} KB em ${entry.addressText}) não cabe na flash de ${sizeLabel}.`
            : `${entry.name} (${(entry.bytes.length / 1024).toFixed(0)} KB at ${entry.addressText}) does not fit in ${sizeLabel} flash.`)
        }
      }

      const fileArray = []
      for (const entry of entries) {
        // Detected size is only written into the header when the user did not ask to keep the file's own value
        const patched = await patchImageHeader(entry.bytes, entry.address, chipType.value, {
          mode: flashMode.value,
          freq: flashFreq.value,
          size: flashSize.value === 'detect' ? sizeLabel : flashSize.value
        })
        if (patched !== entry.bytes) {
          addLog(lang.value === 'pt'
            ? `Cabeçalho de ${entry.name} ajustado (modo ${flashMode.value}, freq ${flashFreq.value}, tamanho ${sizeLabel}).`
            : `Header of ${entry.name} updated (mode ${flashMode.value}, freq ${flashFreq.value}, size ${sizeLabel}).`, 'system')
        }
        fileArray.push({ data: bytesToBinaryString(patched), address: entry.address })
        addLog(lang.value === 'pt'
          ? `A gravar ${entry.name} em ${entry.addressText} (${(patched.length / 1024).toFixed(1)} KB)...`
          : `Flashing ${entry.name} at ${entry.addressText}...`, 'system')
      }

      flashStatusText.value = lang.value === 'pt' ? 'A gravar blocos de memória...' : 'Writing flash memory blocks...'
      await loader.writeFlash({
        fileArray,
        // Header patching is done above; esptool-js would otherwise corrupt the bootloader header
        flashMode: 'keep',
        flashFreq: 'keep',
        flashSize: 'keep',
        eraseAll: false,
        compress: true,
        calculateMD5Hash: verifyAfterFlash.value ? (image) => md5(binaryStringToBytes(image)) : undefined,
        reportProgress: (index, written, total) => {
          const pct = Math.round(((index + written / total) / entries.length) * 100)
          progress.value = pct
          const label = entries.length > 1 ? ` [${index + 1}/${entries.length}] ${entries[index].name}` : ''
          flashStatusText.value = `${lang.value === 'pt' ? 'A gravar' : 'Flashing'}${label}: ${pct}% (${(written / 1024).toFixed(0)} / ${(total / 1024).toFixed(0)} KB)`
        },
      })
      if (verifyAfterFlash.value) {
        addLog(lang.value === 'pt' ? '✓ MD5 verificado: os dados na flash coincidem com os ficheiros.' : '✓ MD5 verified: flash contents match the files.', 'success')
      }

      flashStatusText.value = lang.value === 'pt' ? 'A reiniciar o microcontrolador...' : 'Resetting microcontroller...'
    })

    connected.value = false
    if (monitorAfterFlash.value && await reopenMonitor()) activeView.value = 'console'
    progress.value = 100
    flashStatusText.value = lang.value === 'pt' ? 'Gravação concluída com sucesso!' : 'Flash completed successfully!'
    addLog(lang.value === 'pt' ? `✓ ${entries.length} ficheiro(s) gravado(s) com sucesso!` : `✓ ${entries.length} file(s) flashed successfully!`, 'success')
  } catch (error) {
    connected.value = false
    flashStatusText.value = lang.value === 'pt' ? 'Falha na gravação.' : 'Flashing failed.'
    addLog(`${lang.value === 'pt' ? 'Erro na gravação' : 'Flashing failed'}: ${error.message}`, 'error')
    if (monitorAfterFlash.value) await reopenMonitor()
  } finally {
    isFlashing.value = false
  }
}

function exportLogs() {
  const content = logs.value.map(l => `[${l.time}] [${l.kind.toUpperCase()}] ${l.text}`).join('\n')
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `esp-studio-log-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.txt`
  a.click()
  URL.revokeObjectURL(url)
}

function clearConsole() {
  logs.value = []
  addLog(lang.value === 'pt' ? 'Consola limpa.' : 'Console cleared.', 'system')
}

// Settings remembered between visits
const SETTINGS_KEY = 'esp-studio-settings'
const BAUD_RATES = [115200, 921600, 460800, 230400, 74880, 9600]
const LINE_ENDINGS = lineEndingOptions.value.map(o => o.value)
const persistedSettings = {
  baudRate, lineEnding, showTimestamps, autoScroll,
  flashMode, flashFreq, flashSize, verifyAfterFlash, monitorAfterFlash
}
const settingValid = {
  baudRate: (v) => BAUD_RATES.includes(v),
  lineEnding: (v) => LINE_ENDINGS.includes(v),
  flashMode: (v) => FLASH_MODE_OPTIONS.includes(v),
  flashFreq: (v) => FLASH_FREQ_OPTIONS.includes(v),
  flashSize: (v) => FLASH_SIZE_OPTIONS.includes(v)
}

function loadSettings() {
  const saved = loadJson(SETTINGS_KEY, {})
  for (const [key, target] of Object.entries(persistedSettings)) {
    if (!(key in saved)) continue
    const check = settingValid[key]
    if (check ? check(saved[key]) : typeof saved[key] === 'boolean') target.value = saved[key]
  }
}

watch(Object.values(persistedSettings), () => {
  saveJson(SETTINGS_KEY, Object.fromEntries(Object.entries(persistedSettings).map(([k, r]) => [k, r.value])))
})

onMounted(() => {
  loadSettings()
  const savedTheme = localStorage.getItem('esp-studio-theme')
  if (savedTheme) {
    dark.value = savedTheme === 'dark'
  }
  const savedLang = localStorage.getItem('esp-studio-lang')
  if (savedLang) {
    lang.value = savedLang
  }
  window.addEventListener('click', onClickOutside)
})

onBeforeUnmount(() => {
  window.removeEventListener('click', onClickOutside)
})
</script>

<template>
  <div :class="['studio-root', { 'theme-light': !dark }]">
    <!-- Ambient glowing backdrop -->
    <div class="ambient-glow glow-1"></div>
    <div class="ambient-glow glow-2"></div>
    <div class="ambient-glow glow-3"></div>

    <!-- App Layout -->
    <div class="layout-wrapper">
      <!-- SIDEBAR (Always fixed from top to bottom) -->
      <aside class="studio-sidebar custom-scrollbar">
        <!-- Brand Header -->
        <div class="sidebar-header">
          <div class="brand-badge">
            <svg class="brand-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <rect width="16" height="16" x="4" y="4" rx="3" />
              <path d="M9 9h6v6H9z" />
              <path d="M9 1v3M15 1v3M9 20v3M15 20v3M20 9h3M20 15h3M1 9h3M1 15h3" />
            </svg>
            <div class="brand-text">
              <div class="brand-title">ESP <span>Studio</span></div>
              <span class="brand-sub">PRO FLASHER &amp; TERMINAL</span>
            </div>
          </div>
        </div>

        <!-- Navigation -->
        <nav class="sidebar-nav">
          <button
            class="nav-item"
            :class="{ active: activeView === 'programmer' }"
            @click="activeView = 'programmer'"
          >
            <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
            </svg>
            <span>{{ t.navProgrammer }}</span>
            <span class="nav-pill">BIN</span>
          </button>

          <button
            class="nav-item"
            :class="{ active: activeView === 'console' }"
            @click="activeView = 'console'"
          >
            <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="4 17 10 11 4 5" />
              <line x1="12" x2="20" y1="19" y2="19" />
            </svg>
            <span>{{ t.navConsole }}</span>
            <span v-if="connected" class="live-indicator">LIVE</span>
          </button>

          <button
            class="nav-item"
            :class="{ active: activeView === 'guide' }"
            @click="activeView = 'guide'"
          >
            <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="10" />
              <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
              <line x1="12" x2="12.01" y1="17" y2="17" />
            </svg>
            <span>{{ t.navGuide }}</span>
          </button>
        </nav>

        <!-- Sidebar Footer & Controls (Permanently docked at the bottom) -->
        <div class="sidebar-footer">
          <!-- Web Serial Status Box -->
          <div class="status-box" :class="{ ok: supportsSerial, error: !supportsSerial }">
            <div class="status-dot"></div>
            <div class="status-meta">
              <strong>Web Serial API</strong>
              <small>{{ supportsSerial ? t.webSerialSupport : t.webSerialNoSupport }}</small>
            </div>
          </div>

          <!-- Quick Actions: Theme & Language -->
          <div class="sidebar-actions">
            <button class="action-btn" @click="toggleTheme" :title="dark ? 'Alternar para tema claro' : 'Alternar para tema escuro'">
              <svg v-if="dark" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="4" />
                <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
              </svg>
              <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
              </svg>
              <span>{{ dark ? 'Dark Mode' : 'Light Mode' }}</span>
            </button>

            <button class="action-btn lang-btn" @click="toggleLang" title="Alternar idioma (PT / EN)">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="10" />
                <line x1="2" x2="22" y1="12" y2="12" />
                <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
              </svg>
              <span class="lang-tag">{{ lang.toUpperCase() }}</span>
            </button>
          </div>
        </div>
      </aside>

      <!-- MAIN CONTENT AREA -->
      <main class="studio-main">
        <!-- Top Workspace Bar -->
        <header class="top-bar">
          <div class="breadcrumbs">
            <span class="crumb-root">ESP Studio</span>
            <span class="crumb-separator">/</span>
            <span class="crumb-current">
              {{ activeView === 'programmer' ? t.navProgrammer : activeView === 'console' ? t.navConsole : t.navGuide }}
            </span>
          </div>

          <div class="top-bar-right">
            <!-- Hardware Reset Button if connected -->
            <button
              v-if="connected"
              class="top-ctrl-btn reset-btn"
              @click="hardwareReset"
              :title="t.resetChip"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                <path d="M3 3v5h5" />
                <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
                <path d="M16 21h5v-5" />
              </svg>
              <span>{{ t.resetChip }}</span>
            </button>

            <!-- Connection Status Pill -->
            <div :class="['connection-pill', { active: connected }]">
              <span class="pulsing-dot"></span>
              <span class="pill-label">{{ connectionLabel }}</span>
              <span v-if="connected" class="baud-badge">{{ baudRate }} bps</span>
            </div>

            <!-- Quick Connect / Disconnect Button -->
            <button
              v-if="!connected"
              class="quick-connect-btn"
              :disabled="connecting || !supportsSerial"
              @click="connect"
            >
              <svg v-if="!connecting" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
              </svg>
              <span v-else class="spinner mini"></span>
              <span>{{ connecting ? t.connecting : t.connectDevice }}</span>
            </button>
            <button
              v-else
              class="quick-disconnect-btn"
              @click="disconnect"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <line x1="18" x2="6" y1="6" y2="18" />
                <line x1="6" x2="18" y1="6" y2="18" />
              </svg>
              <span>{{ t.disconnect }}</span>
            </button>
          </div>
        </header>

        <!-- VIEW: PROGRAMMER -->
        <div v-if="activeView === 'programmer'" class="view-content fade-in">
          <!-- Hero Banner -->
          <div class="hero-banner">
            <div class="hero-left">
              <div class="eyebrow-tag">
                <span class="sparkle">✦</span>
                <span>ESP-IDF &bull; ARDUINO &bull; MICROPYTHON</span>
              </div>
              <h1 class="hero-heading">{{ t.heroTitle }}</h1>
              <p class="hero-description">
                {{ connected ? t.heroConnected : t.heroDesc }}
              </p>
              
              <div class="hero-badges">
                <span class="hero-tag" :class="{ active: chipType === 'ESP32' }">ESP32</span>
                <span class="hero-tag" :class="{ active: chipType === 'ESP32-S3' }">ESP32-S3</span>
                <span class="hero-tag" :class="{ active: chipType === 'ESP32-C3' }">ESP32-C3</span>
                <span class="hero-tag" :class="{ active: chipType === 'ESP32-C6' }">ESP32-C6</span>
                <span class="hero-tag" :class="{ active: chipType === 'ESP8266' }">ESP8266</span>
                <span class="hero-tag highlight">USB WebSerial</span>
              </div>
            </div>

            <!-- Stylized Silicon Microchip Graphics -->
            <div class="hero-illustration" aria-hidden="true">
              <div class="silicon-chip">
                <div class="chip-pins-top">
                  <i></i><i></i><i></i><i></i><i></i><i></i><i></i>
                </div>
                <div class="chip-body">
                  <div class="chip-notch"></div>
                  <div class="chip-logo">{{ boardInfo.chipName || chipType }}</div>
                  <div class="chip-core">{{ boardInfo.crystalFreq || '32-BIT DUAL CORE' }}</div>
                  <div class="chip-rf">{{ boardInfo.features.length ? boardInfo.features.slice(0, 2).join(' + ') : 'Wi-Fi + BLE' }}</div>
                  <div class="chip-activity" :class="{ pulsing: connected }"></div>
                </div>
                <div class="chip-pins-bottom">
                  <i></i><i></i><i></i><i></i><i></i><i></i><i></i>
                </div>
              </div>
            </div>
          </div>

          <!-- DETECTED BOARD INFORMATION CARD (Prominently displayed when hardware is identified) -->
          <div v-if="connected && boardInfo.detected" class="detected-board-card fade-in">
            <div class="detected-header">
              <div class="detected-badge-box">
                <span class="detected-badge-icon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                    <polyline points="22 4 12 14.01 9 11.01" />
                  </svg>
                </span>
                <div>
                  <span class="detected-title-tag">{{ t.boardIdentified }}</span>
                  <h3 class="detected-title">{{ boardInfo.description || boardInfo.chipName }}</h3>
                </div>
              </div>

              <div class="detected-header-actions">
                <span class="auto-selected-badge">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  <span>Target: <strong>{{ chipType }}</strong></span>
                </span>

                <button class="reidentify-btn" @click="reidentifyBoard" :disabled="identifying" :title="t.reidentify">
                  <svg :class="{ spinning: identifying }" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" />
                  </svg>
                  <span>{{ identifying ? 'A identificar...' : t.reidentify }}</span>
                </button>
              </div>
            </div>

            <div class="detected-grid">
              <!-- MAC Address Box -->
              <div v-if="boardInfo.macAddress" class="meta-box">
                <span class="meta-box-label">{{ t.macAddress }}</span>
                <div class="meta-box-value-row">
                  <code class="meta-mac">{{ boardInfo.macAddress }}</code>
                  <button class="copy-mac-btn" @click="copyMac" :title="t.copyMac">
                    <span v-if="copiedMac" class="copied-indicator">{{ t.macCopied }}</span>
                    <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
                      <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
                    </svg>
                  </button>
                </div>
              </div>

              <!-- Crystal / Frequency Clock -->
              <div v-if="boardInfo.crystalFreq" class="meta-box">
                <span class="meta-box-label">{{ t.crystalClock }}</span>
                <span class="meta-box-value">{{ boardInfo.crystalFreq }}</span>
              </div>

              <!-- USB Bridge info -->
              <div v-if="boardInfo.usbBridge" class="meta-box">
                <span class="meta-box-label">{{ t.usbBridge }}</span>
                <span class="meta-box-value">{{ boardInfo.usbBridge }} <small v-if="boardInfo.vendorId">({{ boardInfo.vendorId }}:{{ boardInfo.productId }})</small></span>
              </div>

              <!-- Chip Features / Capabilities -->
              <div v-if="boardInfo.features.length" class="meta-box full-width">
                <span class="meta-box-label">{{ t.features }}</span>
                <div class="features-pills">
                  <span v-for="(feat, fIdx) in boardInfo.features" :key="fIdx" class="feature-chip">
                    {{ feat }}
                  </span>
                </div>
              </div>
            </div>
          </div>

          <!-- Configuration & Flash Grid -->
          <div class="workbench-grid">
            <!-- CARD 1: USB SERIAL CONNECTION -->
            <div class="workbench-card">
              <div class="card-header">
                <div class="card-header-icon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <rect width="14" height="20" x="5" y="2" rx="2" />
                    <line x1="12" x2="12" y1="18" y2="18.01" />
                  </svg>
                </div>
                <div class="card-header-info">
                  <span class="step-badge">ETAPA 01</span>
                  <h2>{{ lang === 'pt' ? 'Configuração Serial' : 'Serial Configuration' }}</h2>
                </div>
              </div>

              <div class="card-body">
                <!-- Chip Target Selector (Auto-Selected Upon Connection) -->
                <div class="form-group">
                  <label class="form-label" for="chip-select">
                    <span>{{ t.chipLabel }}</span>
                    <span v-if="boardInfo.detected" class="badge-mini success">✓ Auto-detetado</span>
                    <span v-else class="badge-mini">Target</span>
                  </label>
                  <div class="select-container">
                    <select id="chip-select" v-model="chipType" class="custom-select" :class="{ 'highlight-select': boardInfo.detected }">
                      <option value="ESP32">ESP32 (Classic WROOM / WROVER)</option>
                      <option value="ESP32-S3">ESP32-S3 (Dual Core AI / USB OTG)</option>
                      <option value="ESP32-S2">ESP32-S2 (Single Core USB CDC)</option>
                      <option value="ESP32-C3">ESP32-C3 (RISC-V 160MHz)</option>
                      <option value="ESP32-C6">ESP32-C6 (RISC-V Wi-Fi 6 / Zigbee)</option>
                      <option value="ESP32-C2">ESP32-C2 (ESP8684)</option>
                      <option value="ESP32-H2">ESP32-H2 (BLE 5.3 / 802.15.4)</option>
                      <option value="ESP32-P4">ESP32-P4 (Dual RISC-V 400MHz)</option>
                      <option value="ESP8266">ESP8266 (NodeMCU / D1 Mini)</option>
                    </select>
                    <svg class="select-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <polyline points="6 9 12 15 18 9" />
                    </svg>
                  </div>
                </div>

                <!-- Baud Rate Selector -->
                <div class="form-group">
                  <label class="form-label" for="baud-select">
                    <span>{{ t.speedLabel }}</span>
                    <span class="badge-mini">Baud</span>
                  </label>
                  <div class="select-container">
                    <select id="baud-select" v-model="baudRate" :disabled="connected" class="custom-select">
                      <option :value="115200">115200 bps (Padrão ESP32)</option>
                      <option :value="921600">921600 bps (Gravação Ultra Rápida)</option>
                      <option :value="460800">460800 bps (Alta Velocidade)</option>
                      <option :value="230400">230400 bps (Intermédio)</option>
                      <option :value="74880">74880 bps (Bootloader ESP8266)</option>
                      <option :value="9600">9600 bps (Baixa Velocidade)</option>
                    </select>
                    <svg class="select-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <polyline points="6 9 12 15 18 9" />
                    </svg>
                  </div>
                  <p class="form-hint">{{ t.speedHint }}</p>
                </div>

                <!-- Connect Button Inside Card -->
                <button
                  class="btn-primary-card"
                  :class="{ connected: connected }"
                  :disabled="connecting || !supportsSerial"
                  @click="connected ? disconnect() : connect()"
                >
                  <svg v-if="!connected" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" x2="12" y1="8" y2="12" />
                    <line x1="12" x2="12.01" y1="16" y2="16" />
                  </svg>
                  <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                    <polyline points="22 4 12 14.01 9 11.01" />
                  </svg>
                  <span>{{ connected ? t.disconnect : connecting ? t.connecting : t.choosePort }}</span>
                </button>
              </div>
            </div>

            <!-- CARD 2: FIRMWARE BINARY & FLASHING -->
            <div class="workbench-card">
              <div class="card-header">
                <div class="card-header-icon flash-icon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="17 8 12 3 7 8" />
                    <line x1="12" x2="12" y1="3" y2="15" />
                  </svg>
                </div>
                <div class="card-header-info">
                  <span class="step-badge">ETAPA 02</span>
                  <h2>{{ t.firmwareCardTitle }}</h2>
                </div>
              </div>

              <div class="card-body">
                <!-- Firmware Source Selector Tabs -->
                <div class="firmware-source-tabs">
                  <button
                    type="button"
                    class="src-tab-btn"
                    :class="{ active: firmwareSource === 'presets' }"
                    @click="firmwareSource = 'presets'"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                    </svg>
                    <span>{{ lang === 'pt' ? 'Reposição' : 'Restore' }}</span>
                    <span class="tab-badge-glow">Erase</span>
                  </button>

                  <button
                    type="button"
                    class="src-tab-btn"
                    :class="{ active: firmwareSource === 'custom' }"
                    @click="firmwareSource = 'custom'"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
                      <polyline points="14 2 14 8 20 8" />
                    </svg>
                    <span>{{ lang === 'pt' ? 'Ficheiro Personalizado' : 'Custom .bin File' }}</span>
                  </button>
                </div>

                <!-- PRESETS CATALOG VIEW -->
                <div v-if="firmwareSource === 'presets'" class="presets-container fade-in">
                  <div class="presets-grid-scroll custom-scrollbar">
                    <div
                      v-for="preset in firmwarePresets"
                      :key="preset.id"
                      class="preset-item-card"
                      :class="{
                        selected: selectedPresetId === preset.id,
                        danger: preset.isEraseOnly
                      }"
                      @click="selectPreset(preset)"
                    >
                      <div class="preset-top-row">
                        <span class="preset-badge" :class="preset.isEraseOnly ? 'erase' : 'chip'">{{ preset.badge }}</span>
                        <span class="preset-size">{{ preset.sizeFormatted }}</span>
                      </div>
                      <h4 class="preset-name">{{ preset.title }}</h4>
                      <p class="preset-desc">{{ preset.description }}</p>
                      <div class="preset-bottom-meta">
                        <span class="preset-hint">{{ preset.pinHint }}</span>
                        <span v-if="selectedPresetId === preset.id" class="preset-check-tag">✓ Selecionado</span>
                      </div>
                    </div>
                  </div>

                  <!-- Action for Erase Flash Preset -->
                  <div v-if="activePreset?.isEraseOnly" class="erase-action-box">
                    <div class="erase-notice">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
                        <line x1="12" x2="12" y1="9" y2="13" />
                        <line x1="12" x2="12.01" y1="17" y2="17" />
                      </svg>
                      <span>{{ lang === 'pt' ? 'Atenção: Todos os dados, partições e ficheiros na placa serão permanentemente apagados.' : 'Warning: All flash memory and filesystem partitions will be wiped clean.' }}</span>
                    </div>
                    <button
                      class="btn-erase-flash"
                      :disabled="isErasing || !connected"
                      @click="eraseFullFlash"
                    >
                      <svg v-if="!isErasing" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <polyline points="3 6 5 6 21 6" />
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                      </svg>
                      <span v-else class="spinner"></span>
                      <span>{{ isErasing ? (lang === 'pt' ? 'A formatar Flash...' : 'Erasing Flash...') : (lang === 'pt' ? 'Formatar & Limpar Toda a Memória Flash' : 'Format & Erase Entire Flash') }}</span>
                    </button>
                  </div>
                </div>

                <!-- CUSTOM FILE UPLOAD VIEW -->
                <template v-else>
                  <!-- Dropzone (compact once files are added) -->
                  <div
                    class="dropzone"
                    :class="{ dragging: isDragging, compact: firmwareFiles.length }"
                    @dragover.prevent="isDragging = true"
                    @dragleave.prevent="isDragging = false"
                    @drop.prevent="handleDrop"
                  >
                    <input
                      id="bin-upload"
                      type="file"
                      multiple
                      accept=".bin,application/octet-stream"
                      @change="onFileSelect"
                      class="dropzone-input"
                    />
                    <label for="bin-upload" class="dropzone-label">
                      <div v-if="!firmwareFiles.length" class="dropzone-icon-ring">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                          <path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242" />
                          <path d="M12 12v9" />
                          <path d="m16 16-4-4-4 4" />
                        </svg>
                      </div>
                      <span class="dropzone-main-text">{{ firmwareFiles.length ? (lang === 'pt' ? '+ Adicionar mais ficheiros .bin' : '+ Add more .bin files') : t.dragDropLabel }}</span>
                      <span v-if="!firmwareFiles.length" class="dropzone-sub-text">{{ lang === 'pt' ? 'Pode escolher vários ficheiros (bootloader, partições, boot_app0, aplicação).' : 'You can pick several files (bootloader, partitions, boot_app0, application).' }}</span>
                    </label>
                  </div>

                  <!-- Selected files, each with its own flash address -->
                  <div v-if="firmwareFiles.length" class="firmware-list">
                    <div v-for="item in firmwareFiles" :key="item.id" class="firmware-row">
                      <div class="file-icon-box">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                          <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
                          <polyline points="14 2 14 8 20 8" />
                        </svg>
                      </div>
                      <div class="file-meta">
                        <strong class="file-name" :title="item.file.name">{{ item.file.name }}</strong>
                        <span class="file-size">{{ formatBytes(item.file.size) }}</span>
                      </div>
                      <div class="input-container firmware-addr">
                        <span class="input-prefix">HEX</span>
                        <input
                          v-model="item.address"
                          type="text"
                          class="custom-input mono-font"
                          list="flash-address-list"
                          placeholder="0x10000"
                          spellcheck="false"
                          :aria-label="t.addressLabel"
                        />
                      </div>
                      <button class="remove-file-btn" @click="removeFirmwareFile(item.id)" :title="t.removeFile">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                          <line x1="18" x2="6" y1="6" y2="18" />
                          <line x1="6" x2="18" y1="6" y2="18" />
                        </svg>
                      </button>
                    </div>
                    <datalist id="flash-address-list">
                      <option value="0x0">Full image</option>
                      <option value="0x1000">Bootloader (ESP32 / S2)</option>
                      <option value="0x2000">Bootloader (P4)</option>
                      <option value="0x8000">Partition table</option>
                      <option value="0xe000">boot_app0 (OTA data)</option>
                      <option value="0x10000">Application</option>
                    </datalist>
                    <div class="firmware-summary">
                      <span>{{ firmwareFiles.length }} {{ lang === 'pt' ? 'ficheiro(s)' : 'file(s)' }} · {{ firmwareTotalSize }}</span>
                      <button type="button" class="link-btn" @click="clearFirmware">{{ lang === 'pt' ? 'Remover todos' : 'Remove all' }}</button>
                    </div>
                    <p v-for="msg in firmwareIssues" :key="msg" class="form-hint issue">{{ msg }}</p>
                  </div>
                </template>

                <!-- Flash Options -->
                <div v-if="!activePreset?.isEraseOnly || firmwareSource === 'custom'" class="flash-options">
                  <button type="button" class="flash-options-toggle" @click="showFlashOptions = !showFlashOptions">
                    <span>{{ lang === 'pt' ? 'Opções de flash' : 'Flash options' }}</span>
                    <span class="flash-options-summary">{{ flashMode }} · {{ flashFreq }} · {{ flashSize }}{{ verifyAfterFlash ? ' · MD5' : '' }}</span>
                    <svg class="ending-chevron" :class="{ rotated: showFlashOptions }" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <polyline points="6 9 12 15 18 9" />
                    </svg>
                  </button>
                  <div v-if="showFlashOptions" class="flash-options-body fade-in">
                    <div class="flash-options-grid">
                      <label class="mini-field">
                        <span>{{ lang === 'pt' ? 'Modo' : 'Mode' }}</span>
                        <select v-model="flashMode" class="custom-select">
                          <option v-for="o in FLASH_MODE_OPTIONS" :key="o" :value="o">{{ o === 'keep' ? (lang === 'pt' ? 'Manter (ficheiro)' : 'Keep (file)') : o.toUpperCase() }}</option>
                        </select>
                      </label>
                      <label class="mini-field">
                        <span>{{ lang === 'pt' ? 'Frequência' : 'Frequency' }}</span>
                        <select v-model="flashFreq" class="custom-select">
                          <option v-for="o in FLASH_FREQ_OPTIONS" :key="o" :value="o">{{ o === 'keep' ? (lang === 'pt' ? 'Manter (ficheiro)' : 'Keep (file)') : o.toUpperCase().replace('M', ' MHz') }}</option>
                        </select>
                      </label>
                      <label class="mini-field">
                        <span>{{ lang === 'pt' ? 'Tamanho' : 'Size' }}</span>
                        <select v-model="flashSize" class="custom-select">
                          <option v-for="o in FLASH_SIZE_OPTIONS" :key="o" :value="o">{{ o === 'keep' ? (lang === 'pt' ? 'Manter (ficheiro)' : 'Keep (file)') : o === 'detect' ? (lang === 'pt' ? 'Detetar automaticamente' : 'Auto-detect') : o }}</option>
                        </select>
                      </label>
                    </div>
                    <label class="check-row">
                      <input type="checkbox" v-model="verifyAfterFlash" />
                      <span>{{ lang === 'pt' ? 'Verificar MD5 após gravar' : 'Verify MD5 after flashing' }}</span>
                    </label>
                    <label class="check-row">
                      <input type="checkbox" v-model="monitorAfterFlash" />
                      <span>{{ lang === 'pt' ? 'Voltar a ligar e abrir o monitor serial após gravar' : 'Reconnect and open the serial monitor after flashing' }}</span>
                    </label>
                    <p class="form-hint">{{ lang === 'pt' ? 'Modo, frequência e tamanho só alteram o cabeçalho de um bootloader gravado no seu endereço de arranque. Com "Manter" o ficheiro é gravado tal como está.' : 'Mode, frequency and size only rewrite the header of a bootloader written at its boot address. "Keep" writes the file untouched.' }}</p>
                  </div>
                </div>

                <!-- Flash Action Button (for custom files or standard presets) -->
                <button
                  v-if="!activePreset?.isEraseOnly || firmwareSource === 'custom'"
                  class="btn-flash"
                  :disabled="isFlashing || !firmwareFiles.length || !connected || firmwareIssues.length > 0"
                  @click="flash"
                >
                  <svg v-if="!isFlashing" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                  </svg>
                  <span v-else class="spinner"></span>
                  <span>{{ isFlashing ? t.flashingBtn : t.flashBtn }}</span>
                </button>

                <!-- Flashing Progress Indicator -->
                <div v-if="isFlashing || progress > 0" class="progress-container">
                  <div class="progress-bar-wrap">
                    <div class="progress-bar-fill" :style="{ width: `${progress}%` }"></div>
                  </div>
                  <div class="progress-meta">
                    <span class="progress-status">{{ flashStatusText }}</span>
                    <span class="progress-percent">{{ progress }}%</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- Quick Activity Snippet -->
          <div class="activity-bar">
            <div class="activity-title">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
              </svg>
              <span>{{ lang === 'pt' ? 'Atividade Recente' : 'Recent Activity' }}</span>
            </div>
            <div class="activity-feed">
              <div v-for="(item, i) in logs.slice(-3)" :key="i" class="activity-item">
                <span class="activity-time">{{ item.time }}</span>
                <span class="activity-text" :class="item.kind">{{ item.text }}</span>
              </div>
            </div>
            <button class="activity-link-btn" @click="activeView = 'console'">
              <span>{{ lang === 'pt' ? 'Abrir Consola' : 'Open Console' }}</span>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>
          </div>
        </div>

        <!-- VIEW: CONSOLE SERIAL -->
        <div v-else-if="activeView === 'console'" class="view-content fade-in console-view">
          <div class="console-card">
            <!-- Console Header / Toolbar -->
            <div class="console-toolbar">
              <div class="toolbar-left">
                <div class="term-status-pill" :class="{ live: connected }">
                  <span class="dot"></span>
                  <span>{{ connected ? (lang === 'pt' ? 'Porta Serial Aberta' : 'Serial Stream Open') : (lang === 'pt' ? 'Porta Desligada' : 'Serial Port Idle') }}</span>
                </div>
                <div v-if="boardInfo.detected" class="term-chip-tag">
                  {{ boardInfo.chipName }}
                </div>
                <div class="baud-indicator">
                  <span>{{ baudRate }} baud</span>
                </div>
              </div>

              <div class="toolbar-right">
                <!-- Line Ending Custom Dropdown -->
                <div class="line-ending-dropdown" ref="endingDropdownRef">
                  <button
                    type="button"
                    class="ending-trigger-btn"
                    @click.stop="showEndingMenu = !showEndingMenu"
                    :title="lang === 'pt' ? 'Selecionar terminação de linha' : 'Select line ending'"
                  >
                    <span class="ending-label">{{ lang === 'pt' ? 'Fim de linha:' : 'Ending:' }}</span>
                    <span class="ending-current">{{ currentLineEndingLabel }}</span>
                    <svg class="ending-chevron" :class="{ rotated: showEndingMenu }" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <polyline points="6 9 12 15 18 9" />
                    </svg>
                  </button>

                  <div v-if="showEndingMenu" class="ending-menu-popover custom-scrollbar">
                    <button
                      v-for="opt in lineEndingOptions"
                      :key="opt.value"
                      type="button"
                      class="ending-option-item"
                      :class="{ selected: lineEnding === opt.value }"
                      @click="selectEnding(opt.value)"
                    >
                      <span class="opt-text">{{ opt.label }}</span>
                      <svg v-if="lineEnding === opt.value" class="opt-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    </button>
                  </div>
                </div>

                <!-- Auto-scroll Toggle -->
                <button
                  class="tool-btn"
                  :class="{ active: autoScroll }"
                  @click="autoScroll = !autoScroll"
                  :title="t.autoScroll"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <line x1="12" x2="12" y1="5" y2="19" />
                    <polyline points="19 12 12 19 5 12" />
                  </svg>
                  <span>{{ t.autoScroll }}</span>
                </button>

                <!-- Timestamps Toggle -->
                <button
                  class="tool-btn"
                  :class="{ active: showTimestamps }"
                  @click="showTimestamps = !showTimestamps"
                  :title="t.timestamps"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <circle cx="12" cy="12" r="10" />
                    <polyline points="12 6 12 12 16 14" />
                  </svg>
                  <span>{{ t.timestamps }}</span>
                </button>

                <!-- Export Logs Button -->
                <button class="tool-btn" @click="exportLogs" :title="t.exportLogs">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="7 10 12 15 17 10" />
                    <line x1="12" x2="12" y1="15" y2="3" />
                  </svg>
                  <span>{{ t.exportLogs }}</span>
                </button>

                <!-- Clear Logs Button -->
                <button class="tool-btn danger" @click="clearConsole" :title="t.clearLogs">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="3 6 5 6 21 6" />
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                  </svg>
                  <span>{{ t.clearLogs }}</span>
                </button>
              </div>
            </div>

            <!-- Filter Bar -->
            <div class="console-filterbar">
              <div class="filter-search">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <circle cx="11" cy="11" r="8" />
                  <line x1="21" x2="16.65" y1="21" y2="16.65" />
                </svg>
                <input
                  v-model="logFilter"
                  type="search"
                  class="mono-font"
                  :placeholder="lang === 'pt' ? 'Filtrar registos...' : 'Filter logs...'"
                  spellcheck="false"
                />
              </div>
              <div class="level-tabs" role="group" :aria-label="lang === 'pt' ? 'Nível' : 'Level'">
                <button type="button" :class="{ active: logLevel === 'all' }" @click="logLevel = 'all'">{{ lang === 'pt' ? 'Tudo' : 'All' }}</button>
                <button type="button" :class="{ active: logLevel === 'warn' }" @click="logLevel = 'warn'">{{ lang === 'pt' ? 'Avisos+' : 'Warn+' }}</button>
                <button type="button" :class="{ active: logLevel === 'error' }" @click="logLevel = 'error'">{{ lang === 'pt' ? 'Erros' : 'Errors' }}</button>
              </div>
              <span class="filter-count">{{ filteredLogs.length }} / {{ logs.length }}</span>
            </div>

            <!-- Terminal Window Screen -->
            <div ref="terminalRef" class="terminal-screen custom-scrollbar">
              <div v-if="logs.length === 0" class="terminal-empty">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                  <polyline points="4 17 10 11 4 5" />
                  <line x1="12" x2="20" y1="19" y2="19" />
                </svg>
                <span>{{ lang === 'pt' ? 'Nenhum registo gravado até ao momento. Ligue o ESP32 para iniciar.' : 'No logs recorded yet. Connect ESP32 to start streaming.' }}</span>
              </div>

              <div v-for="log in filteredLogs" :key="log.id" :class="['term-row', log.kind, log.level && `lvl-${log.level}`]">
                <time v-if="showTimestamps" class="term-time">{{ log.time }}</time>
                <span class="term-content"><template v-for="(part, i) in highlightParts(log.text, filterNeedle)" :key="i"><mark v-if="part.hit">{{ part.text }}</mark><template v-else>{{ part.text }}</template></template></span>
              </div>

              <div class="terminal-cursor-line">
                <span class="cursor-block"></span>
              </div>
            </div>

            <!-- Macro Commands Bar -->
            <div class="quick-macros">
              <span class="macro-label">{{ t.quickCommands }}</span>
              <button class="macro-chip" @click="sendCommand('help')" :disabled="!connected">help</button>
              <button class="macro-chip" @click="sendCommand('restart')" :disabled="!connected">restart</button>
              <button class="macro-chip" @click="sendCommand('status')" :disabled="!connected">status</button>
              <button class="macro-chip" @click="sendCommand('ping')" :disabled="!connected">ping</button>
              <button class="macro-chip" @click="sendCommand('AT')" :disabled="!connected">AT</button>
              <button class="macro-chip reset" @click="hardwareReset" :disabled="!connected">RTS/DTR Reset</button>
            </div>

            <!-- Terminal Command Input Bar -->
            <form class="terminal-input-bar" @submit.prevent="submitCommand">
              <div class="prompt-symbol">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </div>
              <input
                v-model="serialCommand"
                type="text"
                class="cmd-input mono-font"
                :placeholder="connected ? t.cmdPlaceholder : (lang === 'pt' ? 'Ligue o dispositivo para enviar comandos...' : 'Connect device to send serial commands...')"
                :disabled="!connected"
                @keydown="handleHistoryKey"
                autocomplete="off"
                spellcheck="false"
              />
              <button
                type="submit"
                class="btn-send"
                :disabled="!connected || !serialCommand.trim()"
              >
                <span>{{ t.send }}</span>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <line x1="22" x2="11" y1="2" y2="13" />
                  <polygon points="22 2 15 22 11 13 2 9 22 2" />
                </svg>
              </button>
            </form>
          </div>
        </div>

        <!-- VIEW: GUIDE & PINOUT -->
        <div v-else class="view-content fade-in guide-view">
          <div class="guide-header-card">
            <h1>{{ t.guideTitle }}</h1>
            <p>{{ t.guideDesc }}</p>
          </div>

          <!-- 3-Step Workflow Cards -->
          <div class="steps-grid">
            <div class="guide-step-card">
              <div class="step-num">01</div>
              <div class="step-icon-wrap">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <rect width="14" height="20" x="5" y="2" rx="2" />
                  <line x1="12" x2="12" y1="18" y2="18.01" />
                </svg>
              </div>
              <h3>{{ t.step1Title }}</h3>
              <p>{{ t.step1Desc }}</p>
            </div>

            <div class="guide-step-card">
              <div class="step-num">02</div>
              <div class="step-icon-wrap">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
                  <polyline points="14 2 14 8 20 8" />
                </svg>
              </div>
              <h3>{{ t.step2Title }}</h3>
              <p>{{ t.step2Desc }}</p>
            </div>

            <div class="guide-step-card">
              <div class="step-num">03</div>
              <div class="step-icon-wrap">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                </svg>
              </div>
              <h3>{{ t.step3Title }}</h3>
              <p>{{ t.step3Desc }}</p>
            </div>
          </div>

          <!-- Troubleshooting & Hardware Tips -->
          <div class="troubleshoot-grid">
            <div class="info-card">
              <div class="info-card-header">
                <svg class="alert-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" x2="12" y1="8" y2="12" />
                  <line x1="12" x2="12.01" y1="16" y2="16" />
                </svg>
                <h4>{{ lang === 'pt' ? 'O ESP32 não entra no modo Bootloader?' : 'ESP32 won\'t enter Bootloader mode?' }}</h4>
              </div>
              <p>
                {{ lang === 'pt' ? 'Algumas placas de desenvolvimento necessitam de uma sequência manual de botões para permitir a gravação:' : 'Some clone dev boards require manual button sequence for flashing:' }}
              </p>
              <ol class="guide-list">
                <li>{{ lang === 'pt' ? 'Mantenha premido o botão' : 'Hold down the' }} <strong>BOOT (GPIO 0)</strong>.</li>
                <li>{{ lang === 'pt' ? 'Prima e solte o botão' : 'Press and release the' }} <strong>EN / RST</strong> {{ lang === 'pt' ? 'uma vez.' : 'once.' }}</li>
                <li>{{ lang === 'pt' ? 'Solte o botão' : 'Release the' }} <strong>BOOT</strong> {{ lang === 'pt' ? 'e clique em Gravar Firmware novamente.' : 'button and hit Flash Firmware again.' }}</li>
              </ol>
            </div>

            <div class="info-card">
              <div class="info-card-header">
                <svg class="driver-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <rect width="18" height="18" x="3" y="3" rx="2" />
                  <path d="M7 7h10v10H7z" />
                </svg>
                <h4>{{ lang === 'pt' ? 'A porta COM não surge no navegador?' : 'COM Port not listed in browser?' }}</h4>
              </div>
              <p>
                {{ lang === 'pt' ? 'Verifique se o seu computador tem os controladores (drivers) do conversor USB-Serial instalados:' : 'Ensure your system has the proper USB-UART bridge drivers installed:' }}
              </p>
              <div class="driver-tags">
                <span class="chip-driver">CP2102 / CP2104 (Silicon Labs)</span>
                <span class="chip-driver">CH340 / CH341 (WCH)</span>
                <span class="chip-driver">FTDI FT232R</span>
              </div>
              <p class="micro-hint">
                {{ lang === 'pt' ? 'Certifique-se também de que o cabo USB utilizado não é exclusivamente de carregamento (deve possuir linhas de dados D+ e D-).' : 'Also confirm that your USB cable is not charge-only and carries data lines.' }}
              </p>
            </div>
          </div>

          <!-- Pinout Quick Reference -->
          <div class="pinout-card">
            <div class="pinout-header">
              <div class="pinout-title">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <rect width="16" height="16" x="4" y="4" rx="3" />
                  <path d="M9 9h6v6H9z" />
                  <path d="M9 1v3M15 1v3M9 20v3M15 20v3M20 9h3M20 15h3M1 9h3M1 15h3" />
                </svg>
                <h3>{{ t.pinoutTitle }}</h3>
              </div>
              <span class="pinout-chip">30-PIN &bull; 38-PIN</span>
            </div>

            <div class="pinout-table-wrapper custom-scrollbar">
              <table class="pinout-table">
                <thead>
                  <tr>
                    <th>Função</th>
                    <th>Pinos GPIO</th>
                    <th>Descrição &amp; Uso Recomendado</th>
                    <th>Estado</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td><span class="badge-cat i2c">I2C</span></td>
                    <td><code>GPIO 21 (SDA)</code>, <code>GPIO 22 (SCL)</code></td>
                    <td>Barramento padrão I2C para sensores (BME280, OLED, MPU6050)</td>
                    <td><span class="status-safe">Disponível para uso</span></td>
                  </tr>
                  <tr>
                    <td><span class="badge-cat spi">SPI</span></td>
                    <td><code>GPIO 18 (SCK)</code>, <code>GPIO 19 (MISO)</code>, <code>GPIO 23 (MOSI)</code>, <code>GPIO 5 (CS)</code></td>
                    <td>VSPI de alta velocidade para ecrãs TFT e cartões SD</td>
                    <td><span class="status-safe">Disponível para uso</span></td>
                  </tr>
                  <tr>
                    <td><span class="badge-cat uart">UART</span></td>
                    <td><code>GPIO 1 (TX0)</code>, <code>GPIO 3 (RX0)</code></td>
                    <td>Porta Serial primária ligada ao conversor USB e à Consola</td>
                    <td><span class="status-warning">Reservado USB</span></td>
                  </tr>
                  <tr>
                    <td><span class="badge-cat adc">ADC 1</span></td>
                    <td><code>GPIO 32, 33, 34, 35, 36 (VP), 39 (VN)</code></td>
                    <td>Entradas analógicas funcionais com Wi-Fi ativo</td>
                    <td><span class="status-safe">Disponível para uso</span></td>
                  </tr>
                  <tr>
                    <td><span class="badge-cat flash">FLASH</span></td>
                    <td><code>GPIO 6, 7, 8, 9, 10, 11</code></td>
                    <td>Ligados à memória flash interna integrada</td>
                    <td><span class="status-danger">NÃO UTILIZAR</span></td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div class="pinout-footer">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" x2="12" y1="16" y2="12" />
                <line x1="12" x2="12.01" y1="8" y2="8" />
              </svg>
              <span>{{ t.pinoutNotice }}</span>
            </div>
          </div>
        </div>
      </main>
    </div>
  </div>
</template>
