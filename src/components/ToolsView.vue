<script setup>
import { computed, ref } from 'vue'
import BackupTool from './BackupTool.vue'

defineProps({
  connected: Boolean,
  lang: { type: String, default: 'pt' },
  chip: { type: String, default: 'ESP32' },
  run: { type: Function, required: true },
  log: { type: Function, required: true }
})

const tab = ref('backup')
const tabs = computed(() => [
  { id: 'backup', label: 'Backup / Restore' }
])
</script>

<template>
  <div class="tools-view">
    <div class="tools-tabs" role="tablist">
      <button
        v-for="t in tabs"
        :key="t.id"
        type="button"
        role="tab"
        class="src-tab-btn"
        :class="{ active: tab === t.id }"
        :aria-selected="tab === t.id"
        @click="tab = t.id"
      >
        <span>{{ t.label }}</span>
      </button>
    </div>

    <p v-if="!connected" class="form-hint issue tools-offline">
      {{ lang === 'pt' ? 'Ligue uma placa na página do Programador para usar estas ferramentas.' : 'Connect a board on the Programmer page to use these tools.' }}
    </p>

    <BackupTool v-if="tab === 'backup'" :connected="connected" :lang="lang" :chip="chip" :run="run" :log="log" />
  </div>
</template>
