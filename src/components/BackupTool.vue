<script setup>
import { computed, ref } from 'vue'
import { md5 } from '../lib/md5'
import { binaryStringToBytes, bytesToBinaryString, flashSizeLabel, flashSizeToBytes } from '../lib/flashimage'
import { downloadBytes, formatBytes, readFileBytes } from '../lib/files'

const props = defineProps({
  connected: Boolean,
  lang: { type: String, default: 'pt' },
  chip: { type: String, default: 'ESP32' },
  run: { type: Function, required: true },
  log: { type: Function, required: true }
})

const pt = computed(() => props.lang === 'pt')
const SIZES = ['auto', '1MB', '2MB', '4MB', '8MB', '16MB']
// esptool-js grows its buffer on every packet, so large reads are split in chunks
const CHUNK = 0x40000

const sizeChoice = ref('auto')
const busy = ref(false)
const progress = ref(0)
const status = ref('')
const restoreFile = ref(null)
const confirmRestore = ref(false)

async function resolveSize(loader) {
  if (sizeChoice.value !== 'auto') return flashSizeToBytes(sizeChoice.value)
  const kb = await loader.getFlashSize().catch(() => 0)
  if (!kb) throw new Error(pt.value ? 'Não foi possível detetar o tamanho da flash. Escolha-o manualmente.' : 'Could not detect the flash size. Pick it manually.')
  props.log(pt.value ? `Tamanho da flash detetado: ${flashSizeLabel(kb)}` : `Detected flash size: ${flashSizeLabel(kb)}`, 'system')
  return kb * 1024
}

async function backup() {
  busy.value = true
  progress.value = 0
  status.value = pt.value ? 'A ligar ao bootloader...' : 'Connecting to bootloader...'
  const ok = await props.run(async (loader) => {
    const total = await resolveSize(loader)
    const image = new Uint8Array(total)
    props.log(pt.value ? `A ler ${formatBytes(total)} da flash...` : `Reading ${formatBytes(total)} from flash...`, 'system')
    for (let offset = 0; offset < total; offset += CHUNK) {
      const size = Math.min(CHUNK, total - offset)
      image.set(await loader.readFlash(offset, size), offset)
      progress.value = Math.round(((offset + size) / total) * 100)
      status.value = `${pt.value ? 'A ler' : 'Reading'}: ${progress.value}% (${formatBytes(offset + size)} / ${formatBytes(total)})`
    }
    const name = `esp-backup-${props.chip.toLowerCase()}-${flashSizeLabel(total / 1024)}-${new Date().toISOString().slice(0, 10)}.bin`
    downloadBytes(image, name)
    props.log(pt.value ? `✓ Backup guardado: ${name} (MD5 ${md5(image)})` : `✓ Backup saved: ${name} (MD5 ${md5(image)})`, 'success')
  })
  status.value = ok ? (pt.value ? 'Backup concluído.' : 'Backup complete.') : (pt.value ? 'Backup falhou.' : 'Backup failed.')
  busy.value = false
}

function onRestoreFile(event) {
  restoreFile.value = event.target.files?.[0] || null
  confirmRestore.value = false
  event.target.value = ''
}

async function restore() {
  if (!restoreFile.value || !confirmRestore.value) return
  busy.value = true
  progress.value = 0
  status.value = pt.value ? 'A ligar ao bootloader...' : 'Connecting to bootloader...'
  const data = await readFileBytes(restoreFile.value)
  const ok = await props.run(async (loader) => {
    const flashBytes = await resolveSize(loader).catch(() => 0)
    if (flashBytes && data.length > flashBytes) {
      throw new Error(pt.value ? 'A imagem é maior do que a flash da placa.' : 'The image is larger than the board flash.')
    }
    props.log(pt.value ? `A restaurar ${restoreFile.value.name} (${formatBytes(data.length)}) em 0x0...` : `Restoring ${restoreFile.value.name} (${formatBytes(data.length)}) at 0x0...`, 'system')
    await loader.writeFlash({
      fileArray: [{ data: bytesToBinaryString(data), address: 0 }],
      flashMode: 'keep',
      flashFreq: 'keep',
      flashSize: 'keep',
      eraseAll: true,
      compress: true,
      calculateMD5Hash: (image) => md5(binaryStringToBytes(image)),
      reportProgress: (_i, written, total) => {
        progress.value = Math.round((written / total) * 100)
        status.value = `${pt.value ? 'A restaurar' : 'Restoring'}: ${progress.value}%`
      }
    })
    props.log(pt.value ? '✓ Imagem restaurada e verificada (MD5).' : '✓ Image restored and verified (MD5).', 'success')
  })
  status.value = ok ? (pt.value ? 'Restauro concluído.' : 'Restore complete.') : (pt.value ? 'Restauro falhou.' : 'Restore failed.')
  confirmRestore.value = false
  busy.value = false
}
</script>

<template>
  <div class="tool-grid">
    <section class="tool-panel">
      <h3>{{ pt ? 'Criar backup da flash' : 'Back up the flash' }}</h3>
      <p class="form-hint">{{ pt ? 'Lê toda a flash da placa e guarda-a num ficheiro .bin que pode ser restaurado mais tarde. Use 921600 baud para ser mais rápido.' : 'Reads the whole flash and saves it as a .bin file you can restore later. Use 921600 baud for speed.' }}</p>
      <label class="mini-field">
        <span>{{ pt ? 'Tamanho a ler' : 'Size to read' }}</span>
        <select v-model="sizeChoice" class="custom-select" :disabled="busy">
          <option v-for="o in SIZES" :key="o" :value="o">{{ o === 'auto' ? (pt ? 'Detetar automaticamente' : 'Auto-detect') : o }}</option>
        </select>
      </label>
      <button class="btn-flash" :disabled="!connected || busy" @click="backup">
        <span v-if="busy" class="spinner"></span>
        <span>{{ pt ? 'Descarregar backup' : 'Download backup' }}</span>
      </button>
    </section>

    <section class="tool-panel">
      <h3>{{ pt ? 'Restaurar imagem completa' : 'Restore a full image' }}</h3>
      <p class="form-hint">{{ pt ? 'Apaga a flash e grava a imagem em 0x0. Use ficheiros criados pelo backup desta ferramenta (ou por "esptool read_flash").' : 'Erases the flash and writes the image at 0x0. Use files made by this backup (or by "esptool read_flash").' }}</p>
      <label class="file-pick">
        <input type="file" accept=".bin" @change="onRestoreFile" :disabled="busy" />
        <span>{{ restoreFile ? `${restoreFile.name} · ${formatBytes(restoreFile.size)}` : (pt ? 'Escolher ficheiro .bin' : 'Choose .bin file') }}</span>
      </label>
      <label class="check-row">
        <input type="checkbox" v-model="confirmRestore" :disabled="!restoreFile || busy" />
        <span>{{ pt ? 'Compreendo que todo o conteúdo atual da flash será substituído' : 'I understand the current flash contents will be replaced' }}</span>
      </label>
      <button class="btn-erase-flash" :disabled="!connected || busy || !restoreFile || !confirmRestore" @click="restore">
        <span v-if="busy" class="spinner"></span>
        <span>{{ pt ? 'Restaurar imagem' : 'Restore image' }}</span>
      </button>
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
