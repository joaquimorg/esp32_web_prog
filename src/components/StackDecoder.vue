<script setup>
import { computed, ref } from 'vue'
import { decodeText, parseElfSymbols } from '../lib/elf'
import { formatBytes, readFileBytes } from '../lib/files'

const props = defineProps({
  lang: { type: String, default: 'pt' },
  logs: { type: Array, default: () => [] }
})

const pt = computed(() => props.lang === 'pt')
const symbols = ref([])
const elfName = ref('')
const elfError = ref('')
const input = ref('')

const results = computed(() => (symbols.value.length ? decodeText(symbols.value, input.value) : []))

async function onElf(event) {
  const file = event.target.files?.[0]
  event.target.value = ''
  if (!file) return
  elfError.value = ''
  try {
    symbols.value = parseElfSymbols(await readFileBytes(file))
    elfName.value = `${file.name} · ${formatBytes(file.size)} · ${symbols.value.length} ${pt.value ? 'funções' : 'functions'}`
  } catch (err) {
    symbols.value = []
    elfName.value = ''
    elfError.value = err.message
  }
}

// Picks the last crash report out of the console history
function useConsoleCrash() {
  const lines = props.logs.map(l => l.text)
  let at = -1
  lines.forEach((text, i) => {
    if (/guru meditation|abort\(\) was called|backtrace:|assert failed/i.test(text)) at = i
  })
  if (at < 0) {
    input.value = ''
    return
  }
  let start = at
  while (start > 0 && at - start < 30 && !/guru meditation|abort\(\)|assert failed|rst:0x/i.test(lines[start])) start--
  input.value = lines.slice(start, Math.min(lines.length, at + 25)).join('\n')
}

const hex = (n) => `0x${n.toString(16).padStart(8, '0')}`
</script>

<template>
  <div class="tool-grid">
    <section class="tool-panel wide">
      <h3>{{ pt ? 'Descodificador de stack trace' : 'Stack trace decoder' }}</h3>
      <p class="form-hint">{{ pt ? 'Escolha o ficheiro .elf do firmware que está na placa (build/*.elf no ESP-IDF/PlatformIO, ou exportado pelo Arduino IDE) e cole o relatório de crash. Os endereços de código são traduzidos para nomes de função. Nomes C++ aparecem "mangled"; números de linha exigem addr2line.' : 'Pick the .elf of the firmware running on the board (build/*.elf in ESP-IDF/PlatformIO, or exported by the Arduino IDE) and paste the crash report. Code addresses are translated to function names. C++ names stay mangled; line numbers need addr2line.' }}</p>
      <label class="file-pick">
        <input type="file" accept=".elf" @change="onElf" />
        <span>{{ elfName || (pt ? 'Escolher ficheiro .elf' : 'Choose .elf file') }}</span>
      </label>
      <p v-if="elfError" class="form-hint issue">{{ elfError }}</p>

      <div class="tool-actions">
        <button class="tool-btn" @click="useConsoleCrash">{{ pt ? 'Usar último crash da consola' : 'Use last crash from console' }}</button>
        <button class="tool-btn danger" :disabled="!input" @click="input = ''">{{ pt ? 'Limpar' : 'Clear' }}</button>
      </div>
      <textarea
        v-model="input"
        class="csv-editor mono-font"
        rows="8"
        spellcheck="false"
        :placeholder="pt ? 'Cole aqui o texto com Backtrace: 0x400d1234:0x3ffb1f50 ...' : 'Paste text such as Backtrace: 0x400d1234:0x3ffb1f50 ...'"
      ></textarea>

      <p v-if="symbols.length && input && !results.length" class="form-hint issue">
        {{ pt ? 'Nenhum endereço do texto corresponde a funções deste ELF. Confirme que é o ELF do firmware em execução.' : 'No address in the text matches a function in this ELF. Make sure it is the ELF of the running firmware.' }}
      </p>
      <table v-if="results.length" class="tool-table">
        <thead>
          <tr><th>#</th><th>{{ pt ? 'Endereço' : 'Address' }}</th><th>{{ pt ? 'Função' : 'Function' }}</th></tr>
        </thead>
        <tbody>
          <tr v-for="(r, i) in results" :key="r.addr">
            <td>{{ i }}</td>
            <td class="mono">{{ hex(r.addr) }}</td>
            <td class="mono">{{ r.hit.name }}<span class="muted-offset"> +0x{{ r.hit.offset.toString(16) }}</span></td>
          </tr>
        </tbody>
      </table>
    </section>
  </div>
</template>
