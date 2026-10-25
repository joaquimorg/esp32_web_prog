<script setup>
import { computed, ref } from 'vue'
import { md5 } from '../lib/md5'
import { binaryStringToBytes, bytesToBinaryString, flashSizeLabel } from '../lib/flashimage'
import { downloadBytes, formatBytes, readFileBytes } from '../lib/files'
import { readFlashChunked } from '../lib/loader'
import {
  PRESETS, TABLE_OFFSET, TABLE_SIZE, buildTable, parseCsv, parseTable, subtypeName, toCsv, typeLabel, validateTable
} from '../lib/partitions'

const props = defineProps({
  connected: Boolean,
  lang: { type: String, default: 'pt' },
  chip: { type: String, default: 'ESP32' },
  run: { type: Function, required: true },
  log: { type: Function, required: true }
})

const pt = computed(() => props.lang === 'pt')
const csvText = ref(PRESETS['ota-4mb'])
const flashBytes = ref(0)
const busy = ref(false)
const progress = ref(0)
const status = ref('')
const confirmWrite = ref(false)
const targetName = ref('')
const imageFile = ref(null)
const unsupported = computed(() => props.chip === 'ESP8266')

const parsed = computed(() => {
  try {
    const entries = parseCsv(csvText.value)
    return { entries, error: '', problems: validateTable(entries, flashBytes.value) }
  } catch (err) {
    return { entries: [], error: err.message, problems: [] }
  }
})

const canWrite = computed(() => !parsed.value.error && !parsed.value.problems.length && parsed.value.entries.length > 0)
const target = computed(() => parsed.value.entries.find(e => e.name === targetName.value) || null)

const hex = (n) => `0x${n.toString(16)}`

function setProgress(pct, text) {
  progress.value = pct
  status.value = text
}

async function task(label, fn) {
  busy.value = true
  setProgress(0, pt.value ? 'A ligar ao bootloader...' : 'Connecting to bootloader...')
  const ok = await props.run(fn)
  status.value = ok ? `${label} ✓` : `${label} ✗`
  busy.value = false
  return ok
}

async function readTable() {
  await task(pt.value ? 'Leitura da tabela' : 'Read table', async (loader) => {
    const kb = await loader.getFlashSize().catch(() => 0)
    if (kb) flashBytes.value = kb * 1024
    const bytes = await loader.readFlash(TABLE_OFFSET, TABLE_SIZE)
    const { entries, md5Ok } = parseTable(bytes)
    if (!entries.length) throw new Error(pt.value ? 'Não foi encontrada nenhuma tabela de partições em 0x8000.' : 'No partition table found at 0x8000.')
    csvText.value = toCsv(entries)
    targetName.value = entries[0].name
    props.log(pt.value
      ? `✓ Tabela lida: ${entries.length} partições${md5Ok === false ? ' (atenção: o MD5 da tabela não confere)' : ''}${kb ? `, flash de ${flashSizeLabel(kb)}` : ''}.`
      : `✓ Table read: ${entries.length} partitions${md5Ok === false ? ' (warning: table MD5 mismatch)' : ''}${kb ? `, ${flashSizeLabel(kb)} flash` : ''}.`, 'success')
  })
}

async function writeTable() {
  if (!canWrite.value || !confirmWrite.value) return
  const bytes = buildTable(parsed.value.entries)
  await task(pt.value ? 'Gravação da tabela' : 'Write table', async (loader) => {
    await loader.writeFlash({
      fileArray: [{ data: bytesToBinaryString(bytes), address: TABLE_OFFSET }],
      flashMode: 'keep', flashFreq: 'keep', flashSize: 'keep', eraseAll: false, compress: true,
      calculateMD5Hash: (image) => md5(binaryStringToBytes(image)),
      reportProgress: (_i, written, total) => setProgress(Math.round((written / total) * 100), `${Math.round((written / total) * 100)}%`)
    })
    props.log(pt.value ? `✓ Tabela de partições gravada em ${hex(TABLE_OFFSET)} (${parsed.value.entries.length} partições).` : `✓ Partition table written at ${hex(TABLE_OFFSET)} (${parsed.value.entries.length} partitions).`, 'success')
  })
  confirmWrite.value = false
}

function downloadTable() {
  downloadBytes(buildTable(parsed.value.entries), 'partition-table.bin')
}

function downloadCsv() {
  downloadBytes(new TextEncoder().encode(csvText.value), 'partitions.csv', 'text/csv')
}

async function onTableFile(event) {
  const file = event.target.files?.[0]
  event.target.value = ''
  if (!file) return
  const bytes = await readFileBytes(file)
  if (bytes[0] === 0xaa && bytes[1] === 0x50) {
    csvText.value = toCsv(parseTable(bytes).entries)
  } else {
    csvText.value = new TextDecoder().decode(bytes)
  }
}

function onImageFile(event) {
  imageFile.value = event.target.files?.[0] || null
  event.target.value = ''
}

const imageProblem = computed(() => {
  if (!target.value || !imageFile.value) return ''
  if (imageFile.value.size > target.value.size) {
    return pt.value
      ? `A imagem (${formatBytes(imageFile.value.size)}) não cabe na partição ${target.value.name} (${formatBytes(target.value.size)}).`
      : `The image (${formatBytes(imageFile.value.size)}) does not fit in ${target.value.name} (${formatBytes(target.value.size)}).`
  }
  return ''
})

async function writeImage() {
  if (!target.value || !imageFile.value || imageProblem.value) return
  const part = target.value
  const bytes = await readFileBytes(imageFile.value)
  await task(pt.value ? 'Gravação da imagem' : 'Write image', async (loader) => {
    props.log(pt.value ? `A gravar ${imageFile.value.name} em ${part.name} (${hex(part.offset)})...` : `Writing ${imageFile.value.name} to ${part.name} (${hex(part.offset)})...`, 'system')
    await loader.writeFlash({
      fileArray: [{ data: bytesToBinaryString(bytes), address: part.offset }],
      flashMode: 'keep', flashFreq: 'keep', flashSize: 'keep', eraseAll: false, compress: true,
      calculateMD5Hash: (image) => md5(binaryStringToBytes(image)),
      reportProgress: (_i, written, total) => setProgress(Math.round((written / total) * 100), `${Math.round((written / total) * 100)}%`)
    })
    props.log(pt.value ? `✓ Imagem gravada em ${part.name} e verificada (MD5).` : `✓ Image written to ${part.name} and verified (MD5).`, 'success')
  })
}

async function readPartition() {
  if (!target.value) return
  const part = target.value
  await task(pt.value ? 'Leitura da partição' : 'Read partition', async (loader) => {
    const data = await readFlashChunked(loader, part.offset, part.size, (done, total) => {
      setProgress(Math.round((done / total) * 100), `${formatBytes(done)} / ${formatBytes(total)}`)
    })
    downloadBytes(data, `${part.name}-${hex(part.offset)}.bin`)
    props.log(pt.value ? `✓ Partição ${part.name} guardada (${formatBytes(part.size)}, MD5 ${md5(data)}).` : `✓ Partition ${part.name} saved (${formatBytes(part.size)}, MD5 ${md5(data)}).`, 'success')
  })
}
</script>

<template>
  <div class="tool-grid">
    <p v-if="unsupported" class="form-hint issue tool-panel wide">
      {{ pt ? 'O ESP8266 não usa tabela de partições ESP-IDF.' : 'The ESP8266 does not use an ESP-IDF partition table.' }}
    </p>

    <section class="tool-panel wide">
      <h3>{{ pt ? 'Tabela de partições' : 'Partition table' }}</h3>
      <p class="form-hint">{{ pt ? 'Leia a tabela da placa, edite o CSV (formato ESP-IDF) e grave-a em 0x8000. Se mudar offsets de partições que já têm dados, a aplicação deixa de arrancar até ser regravada.' : 'Read the table from the board, edit the CSV (ESP-IDF format) and write it at 0x8000. Moving partitions that already hold data will break the boot until they are rewritten.' }}</p>
      <div class="tool-actions">
        <button class="tool-btn" :disabled="!connected || busy || unsupported" @click="readTable">{{ pt ? 'Ler da placa' : 'Read from board' }}</button>
        <label class="tool-btn">
          {{ pt ? 'Abrir .csv / .bin' : 'Open .csv / .bin' }}
          <input type="file" accept=".csv,.bin,.txt" hidden @change="onTableFile" />
        </label>
        <select class="plotter-select" @change="csvText = PRESETS[$event.target.value]; $event.target.selectedIndex = 0" :aria-label="pt ? 'Modelos' : 'Presets'">
          <option value="">{{ pt ? 'Modelos…' : 'Presets…' }}</option>
          <option value="ota-4mb">{{ pt ? 'OTA 4 MB' : 'OTA 4 MB' }}</option>
          <option value="noota-4mb">{{ pt ? 'Sem OTA 4 MB' : 'No OTA 4 MB' }}</option>
          <option value="ota-8mb">OTA 8 MB</option>
          <option value="ota-16mb">OTA 16 MB</option>
        </select>
        <button class="tool-btn" :disabled="!canWrite" @click="downloadTable">.bin</button>
        <button class="tool-btn" @click="downloadCsv">.csv</button>
      </div>

      <textarea v-model="csvText" class="csv-editor mono-font" rows="9" spellcheck="false"></textarea>

      <p v-if="parsed.error" class="form-hint issue">{{ parsed.error }}</p>
      <p v-for="problem in parsed.problems" :key="problem" class="form-hint issue">{{ problem }}</p>

      <table v-if="parsed.entries.length" class="tool-table">
        <thead>
          <tr><th>Name</th><th>Type</th><th>SubType</th><th>Offset</th><th>Size</th></tr>
        </thead>
        <tbody>
          <tr v-for="e in parsed.entries" :key="e.name">
            <td class="mono">{{ e.name }}</td>
            <td>{{ typeLabel(e.type) }}</td>
            <td>{{ subtypeName(e.type, e.subtype) }}</td>
            <td class="mono">{{ hex(e.offset) }}</td>
            <td class="mono">{{ formatBytes(e.size) }}</td>
          </tr>
        </tbody>
      </table>

      <label class="check-row">
        <input type="checkbox" v-model="confirmWrite" :disabled="!canWrite || busy" />
        <span>{{ pt ? 'Compreendo que a tabela atual da placa será substituída' : 'I understand the board partition table will be replaced' }}</span>
      </label>
      <button class="btn-erase-flash" :disabled="!connected || busy || unsupported || !canWrite || !confirmWrite" @click="writeTable">
        <span v-if="busy" class="spinner"></span>
        <span>{{ pt ? 'Gravar tabela na placa' : 'Write table to board' }}</span>
      </button>
    </section>

    <section class="tool-panel wide">
      <h3>{{ pt ? 'Imagem de partição (NVS, SPIFFS, LittleFS, FAT…)' : 'Partition image (NVS, SPIFFS, LittleFS, FAT…)' }}</h3>
      <p class="form-hint">{{ pt ? 'Grava uma imagem já construída (por exemplo com mkspiffs, mklittlefs ou nvs_partition_gen) no início de uma partição da tabela acima, ou descarrega o conteúdo atual da partição.' : 'Writes a prebuilt image (e.g. from mkspiffs, mklittlefs or nvs_partition_gen) to the start of a partition from the table above, or downloads the current partition contents.' }}</p>
      <label class="mini-field">
        <span>{{ pt ? 'Partição' : 'Partition' }}</span>
        <select v-model="targetName" class="custom-select">
          <option value="" disabled>—</option>
          <option v-for="e in parsed.entries" :key="e.name" :value="e.name">{{ e.name }} · {{ hex(e.offset) }} · {{ formatBytes(e.size) }}</option>
        </select>
      </label>
      <label class="file-pick">
        <input type="file" accept=".bin" @change="onImageFile" :disabled="busy" />
        <span>{{ imageFile ? `${imageFile.name} · ${formatBytes(imageFile.size)}` : (pt ? 'Escolher imagem .bin' : 'Choose .bin image') }}</span>
      </label>
      <p v-if="imageProblem" class="form-hint issue">{{ imageProblem }}</p>
      <div class="tool-actions">
        <button class="btn-flash" :disabled="!connected || busy || !target || !imageFile || !!imageProblem" @click="writeImage">{{ pt ? 'Gravar imagem na partição' : 'Write image to partition' }}</button>
        <button class="tool-btn" :disabled="!connected || busy || !target" @click="readPartition">{{ pt ? 'Descarregar partição' : 'Download partition' }}</button>
      </div>
    </section>

    <div v-if="busy || progress > 0" class="progress-container tool-progress">
      <div class="progress-bar-wrap">
        <div class="progress-bar-fill" :style="{ width: `${progress}%` }"></div>
      </div>
      <div class="progress-meta">
        <span class="progress-status">{{ status }}</span>
        <span class="progress-percent">{{ progress }}%</span>
      </div>
    </div>
  </div>
</template>
