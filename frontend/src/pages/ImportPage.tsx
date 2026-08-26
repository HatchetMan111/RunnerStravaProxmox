import { useEffect, useState } from 'react'
import { queueFileImport, subscribe } from '../sync/engine'
import { listOps } from '../db/idb'
import type { OutboxOp } from '../db/idb'

export function ImportPage() {
  const [ops, setOps] = useState<OutboxOp[]>([])
  const [dragOver, setDragOver] = useState(false)

  const refresh = () => void listOps().then((all) => setOps(all.filter((op) => op.kind === 'import.file')))
  useEffect(() => {
    const unsubscribe = subscribe(refresh)
    refresh()
    return unsubscribe
  }, [])

  const addFiles = (files: FileList | null) => {
    if (!files) return
    for (const file of Array.from(files)) {
      void queueFileImport(file, file.name)
    }
  }

  return (
    <div>
      <h2>Import</h2>
      <p className="muted">
        GPX-, TCX- und FIT-Dateien werden ausgewertet und auf den Server geladen. Ohne
        Internetverbindung landen die Dateien in der lokalen Warteschlange und werden später
        automatisch hochgeladen – Duplikate werden erkannt.
      </p>

      <div
        className={`dropzone ${dragOver ? 'over' : ''}`}
        onDragOver={(e) => {
          e.preventDefault()
          setDragOver(true)
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragOver(false)
          addFiles(e.dataTransfer.files)
        }}
      >
        Dateien hierher ziehen oder
        <label className="file-label">
          auswählen
          <input
            type="file"
            multiple
            accept=".gpx,.tcx,.fit"
            onChange={(e) => {
              addFiles(e.target.files)
              e.target.value = ''
            }}
          />
        </label>
      </div>

      {ops.length > 0 && (
        <>
          <h3>Warteschlange ({ops.length})</h3>
          <ul className="queue-list">
            {[...ops]
              .sort((a, b) => a.created_at - b.created_at)
              .map((op) => (
                <li key={op.operation_id}>
                  <span>{op.label}</span>
                  <span className={`queue-status s-${op.attempts === 0 ? 'pending' : 'waiting'}`}>
                    {op.last_error
                      ? `Fehler: ${op.last_error} (erneuter Versuch folgt)`
                      : op.attempts === 0
                        ? 'wartet'
                        : `Upload läuft / Wiederholung (${op.attempts})`}
                  </span>
                </li>
              ))}
          </ul>
        </>
      )}
    </div>
  )
}
