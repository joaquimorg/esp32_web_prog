// Shared esptool-js helpers

// esptool-js grows its buffer on every packet, so large reads are split in chunks
const READ_CHUNK = 0x40000

export async function readFlashChunked(loader, address, total, onProgress = () => {}) {
  const image = new Uint8Array(total)
  for (let offset = 0; offset < total; offset += READ_CHUNK) {
    const size = Math.min(READ_CHUNK, total - offset)
    image.set(await loader.readFlash(address + offset, size), offset)
    onProgress(offset + size, total)
  }
  return image
}
