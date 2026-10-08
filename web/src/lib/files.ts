/** Browser file helpers for .cql download and open (SPEC §9.4.1). */

export const MAX_FILE_BYTES = 1024 * 1024
export const FILE_ACCEPT = '.cql,.txt,.sql'

/** Save `text` as `filename` through a browser download: UTF-8, line endings unchanged. */
export function downloadText(filename: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

function readBuffer(file: Blob): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result as ArrayBuffer)
    r.onerror = () => reject(new Error('The file could not be read.'))
    r.readAsArrayBuffer(file)
  })
}

/** Read a file as UTF-8 text. Rejects with a displayable message when it is over 1 MiB or not valid UTF-8. */
export async function readTextFile(file: File): Promise<string> {
  if (file.size > MAX_FILE_BYTES) throw new Error('The file is larger than 1 MiB.')
  const buf = await readBuffer(file)
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf)
  } catch {
    throw new Error('The file is not valid UTF-8 text.')
  }
}
