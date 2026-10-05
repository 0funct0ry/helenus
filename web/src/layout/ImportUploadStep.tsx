import { useRef, useState } from 'react'
import { Upload } from 'lucide-react'
import { Button } from '../ui/Button'
import { formatBytes } from '../lib/importModel'

export interface ImportUploadStepProps {
  /** Name and size of the uploaded file, once the upload finished. */
  uploaded: { name: string; size: number } | null
  uploading: boolean
  /** Upload progress from 0 to 1. */
  progress: number
  error: string | null
  onFile: (file: File) => void
}

/**
 * Step 1 of the import wizard: drop a file on the zone or pick one with the button. Shows upload progress, the name
 * and size of the uploaded file, and any upload error (for example "larger than the upload limit").
 */
export function ImportUploadStep({ uploaded, uploading, progress, error, onFile }: ImportUploadStepProps) {
  const input = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)
  const pct = Math.round(progress * 100)
  return (
    <div className="flex flex-col gap-3">
      <div
        data-testid="drop-zone"
        onDragOver={(e) => {
          e.preventDefault()
          setOver(true)
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setOver(false)
          const f = e.dataTransfer.files[0]
          if (f && !uploading) onFile(f)
        }}
        className={`flex flex-col items-center gap-2 rounded border border-dashed px-6 py-10 text-center ${over ? 'border-accent bg-selected' : 'border-line'}`}
      >
        <Upload size={22} className="text-muted" />
        <p className="m-0">Drop a CSV, TSV, JSON or NDJSON file here</p>
        <Button disabled={uploading} onClick={() => input.current?.click()}>
          Choose file…
        </Button>
        <input
          ref={input}
          type="file"
          aria-label="Import file"
          className="hidden"
          accept=".csv,.tsv,.json,.ndjson,.jsonl,.txt"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) onFile(f)
            e.target.value = ''
          }}
        />
      </div>
      {uploading && (
        <div role="progressbar" aria-label="Upload progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} className="h-2 overflow-hidden rounded bg-selected">
          <div className="h-full bg-accent transition-[width]" style={{ width: `${pct}%` }} />
        </div>
      )}
      {uploaded && !uploading && (
        <p className="m-0 text-muted">
          Uploaded <strong className="text-fg">{uploaded.name}</strong> ({formatBytes(uploaded.size)}). Choose another file to replace it.
        </p>
      )}
      {error && (
        <p role="alert" className="m-0 text-danger">
          {error}
        </p>
      )}
    </div>
  )
}
