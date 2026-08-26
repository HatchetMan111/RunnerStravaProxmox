import { useEffect, useState } from 'react'
import { queueFileImport, subscribe } from '../sync/engine'
import { listOps } from '../db/idb'
import type { OutboxOp } from '../db/idb'
import { Card, EmptyState, PageHeader } from '../components/ui'
import { Icon } from '../components/Icon'

export function ImportPage() {
  const [ops, setOps] = useState<OutboxOp[]>([])
  const [dragOver, setDragOver] = useState(false)
  const [lastAdded, setLastAdded] = useState(0)

  const refresh = () =>
    void listOps().then((all) => setOps(all.filter((op) => op.kind === 'import.file').sort((a, b) => a.created_at - b.created_at)))

  useEffect(() => {
    const unsubscribe = subscribe(refresh)
    refresh()
    return unsubscribe
  }, [])

  function addFiles(files: FileList | null) {
    if (!files || files.length === 0) return
    setLastAdded(files.length)
    for (const file of Array.from(files)) {
      void queueFileImport(file, file.name)
    }
  }

  const done = ops.length === 0
  return (
    <div>
      <PageHeader title="Import" subtitle="GPX · TCX · FIT – offline sicher in der Warteschlange" />

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
        <Icon name="upload" size={30} />
        <div style={{ marginTop: '.4rem' }}>
          Dateien hierher ziehen oder{' '}
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
        <p className="hint muted">Duplikate werden automatisch erkannt (Datei-Hash).</p>
      </div>

      {lastAdded > 0 && (
        <div className="notice" style={{ background: 'var(--ok-bg)', borderColor: '#a7f3d0', color: '#065f46' }}>
          <Icon name="check" size={17} /> {lastAdded} Datei(en) in die Warteschlange gestellt.
          <span className="muted" style={{ marginLeft: '.35rem', color: '#065f46' }}>
            Offline? Bleibt lokal und wird später hochgeladen.
          </span>
        </div>
      )}

      <Card title={`Warteschlange${ops.length ? ` (${ops.length})` : ''}`} icon="refresh">
        {done ? (
          <EmptyState icon="check" title="Alles übertragen" hint="Keine offenen Importe." />
        ) : (
          <ul className="queue-list">
            {ops.map((op) => (
              <li key={op.operation_id}>
                <span style={{ display: 'flex', alignItems: 'center', gap: '.5rem', minWidth: 0 }}>
                  <Icon name="route" size={15} />
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{op.label}</span>
                </span>
                {op.last_error ? (
                  <span className="pill pill-error"><Icon name="alert" size={12} /> Fehler – Wiederholung</span>
                ) : op.attempts === 0 ? (
                  <span className="pill pill-muted">wartet</span>
                ) : (
                  <span className="pill pill-info"><Icon name="upload" size={12} /> läuft / Retry</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}
