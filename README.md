# LocalTrack

Lokale, selbst gehostete Plattform für Sport-Aktivitäten (Laufen, Radfahren, Wandern u. a.).
**Offline-first:** Aktivitäten werden im Browser (PWA) aufgezeichnet oder aus GPX/TCX/FIT importiert,
landen zuverlässig genau einmal auf dem eigenen Server – ohne Cloud, ohne Telemetrie.

> Eigenständiges Projekt mit eigenem Namen, eigenem Code und eigener UI.
> Kein Bestandteil von und keine Verbindung zu bestehenden kommerziellen Plattformen.

---

## Installation per Einzeiler (Proxmox VE 8.x)

Auf dem Proxmox-Host als root:

```bash
bash -c "$(wget -qLO - https://raw.githubusercontent.com/HatchetMan111/RunnerStravaProxmox/main/install/localtrack.sh)"
```

`REF` kann nach dem ersten Release auf ein Tag wie `v0.1.5` gesetzt werden,
damit Installationen reproduzierbar sind (Entwicklung: `main`).
Der Installer:

- prüft Proxmox und root,
- wählt automatisch eine freie CT-ID (100–999) und einen Storage mit `rootdir`,
- lädt bei Bedarf das Debian-12-Template herunter,
- erstellt einen **unprivilegierten LXC** (Standard: 2 vCPU / 2 GB RAM / 8 GB Disk, `onboot=1`),
- installiert im Container: Python, PostgreSQL, Node-Build, die App, systemd-Service,
- ist **idempotent** (erneutes Ausführen nutzt vorhandenen Container + Konfiguration),
- verifiziert sich selbst: `systemctl is-active`, HTTP-Health, echte Container-IP in der Zusammenfassung.

### Variablen (oben im Script, per Environment überschreibbar)

```bash
CTID=150 REPO_URL=https://github.com/HatchetMan111/RunnerStravaProxmox.git REF=main \
RAM=2048 CORES=2 DISK_GB=8 PORT=8080 \
NET_MODE=static NET_IP=192.168.1.50/24 NET_GW=192.168.1.1 \
DEBUG=0 \
bash -c "$(wget -qLO - https://raw.githubusercontent.com/HatchetMan111/RunnerStravaProxmox/main/install/localtrack.sh)"
```

| Variable   | Default                          | Bedeutung                        |
| ---------- | -------------------------------- | -------------------------------- |
| `CTID`     | nächste freie (100–999)          | Container-ID                     |
| `REPO_URL` | `https://github.com/HatchetMan111/RunnerStravaProxmox.git` | Codequelle                    |
| `REF`      | `main`                           | Branch oder Tag (`v0.1.0`)       |
| `PORT`     | `8080`                           | Web-UI/API-Port                  |
| `NET_MODE` | `dhcp`                           | `static` braucht `NET_IP`,`NET_GW` |

Bei Fehlern: vollständige Fehlerkette inkl. Zeile, Exit-Code, letztem Befehl;
Log unter `/var/log/localtrack-install.log`. Tieferes Debugging: `DEBUG=1 bash …`.

### Erwartete Ausgabe am Ende

```
============================================================
 LocalTrack erfolgreich installiert
============================================================
 Container : 142
 IP        : 192.168.1.50
 Web UI    : http://192.168.1.50:8080

 Erste Schritte:
   1) Web UI oeffnen und ersten Benutzer anlegen
   2) PWA offline nutzen: HTTPS oder localhost erforderlich
 ...
============================================================
```

Erster Aufruf der Web UI → Benutzername + Passwort für den einzigen Admin-Benutzer setzen
(Setup wird danach gesperrt; Passwortwechsel in den Einstellungen).

---

## Offline / PWA – so funktioniert es

```
Browser/PWA                         LXC-Server
┌──────────────────────────┐        ┌─────────────────────────┐
│ GPS-Aufzeichnung         │        │ FastAPI                 │
│ Import (GPX/TCX/FIT)     │        │  ├─ /api/v1/sync        │
│      ↓                   │  HTTP  │  ├─ /api/v1/imports     │
│ IndexedDB-Outbox         │──────▶ │  └─ PostgreSQL          │
│ (operation_id, Retries)  │        │ Originaldateien:        │
│      ↓                   │        │ /var/lib/localtrack/    │
│ Service Worker (App-Shell)│       │ data/originals/…        │
└──────────────────────────┘        └─────────────────────────┘
```

- Jede lokale Operation erhält eine eindeutige `operation_id`.
  Der Server dedupliziert darüber **und** über den Datei-Hash → Replay-sicher,
  kein Datenverlust bei abgebrochenen Uploads, keine Doppelaktivitäten.
- Sync läuft automatisch bei Netzwerk-Return, alle 60 s und manuell über den Badge.

### Wichtiger Hinweis zum „secure context“

Browser erlauben Service Worker, Geolocation-Persistenz und Installierbarkeit (PWA)
nur unter **HTTPS** oder auf `localhost`. Über reines `http://192.168.x.x` funktioniert
die App trotzdem, aber *ohne* Offline-Funktionen. Empfehlung: Reverse Proxy mit
selbstsigniertem Zertifikat/eigener CA vor den Container schalten
(der Installer bereitet nichts vor, die App verarbeitet `X-Forwarded-*` korrekt,
sobald sie hinter einem Proxy läuft).

---

## Was die App kann

- **Aufzeichnen** direkt im Browser (GPS), Pausen, Crash-sicheres Autosave in IndexedDB
- **Import** von GPX, TCX und FIT (inkl. Herzfrequenz, Kadenz, Leistung, Temperatur),
  Drag & Drop mehrerer Dateien, Duplikaterkennung pro Datei-Hash
- **Analyse**: interaktive Karte (Leaflet + OpenStreetMap-Kacheln, per Schalter abschaltbar;
  komplett offline als SVG-Track), Höhenprofil, Pace-/HF-/Leistungsdiagramme mit Flächenverlauf,
  Kilometer-Splits mit Rundenvergleich, Statistiken, Bestzeiten
- **GPS-Aufzeichnung v2**: Status-Engine (HTTPS-Hinweis/Berechtigungen/GPS-Fix), Genauigkeitsanzeige,
  Screen-Wake-Lock, Crash-sicheres Autosave
- **Verwaltung**: Suche, Filter, Tags/Notizen, Löschen, GPX-Export
- **Sicherheit**: Login (scrypt-Hashing), Bearer-Token, Rate-Limiting beim Login,
  systemd-Hardening, Upload-Limits, Pfad-Traversal-Schutz beim Speichern der Originale
- **Betrieb**: systemd (`Restart=always`, `After=network-online.target`),
  Backup/Restore/Diagnose/Update per CLI

## CLI auf dem Server

```bash
localtrack backup            # DB-Dump + Originaldateien -> /var/backups/localtrack
localtrack restore DATEI.tar.gz
localtrack diagnose          # Versionen, Service, DB, HTTP, letzte Logs
localtrack update            # Backup -> git pull -> Build -> Restart -> Health
localtrack uninstall         # entfernt alles (bestätigt mit 'JA')
```

---

## Entwicklung

```bash
python3 -m venv .venv && .venv/bin/pip install -e '.[dev]'
.venv/bin/pytest                      # 45 Unit-/API-Tests (Sync-Idempotenz, Parser, Auth …)
.venv/bin/ruff check app tests
cd frontend && npm ci && npm run build # PWA-Frontend (React/Vite/TS)

# Smoke-Test gegen laufenden Server:
LOCALTRACK_DATA_DIR=/tmp/lt .venv/bin/uvicorn app.main:app --port 8080 &
.venv/bin/python scripts/smoke_test.py http://127.0.0.1:8080
```

Qualitätswerkzeuge: `bash -n` + `shellcheck` für Installer/CLI (beide clean).

## Architektur-Entscheidungen

- **Datenmodell erweiterbar:** Streams werden als benannte Zeitreihen (JSON) gespeichert;
  unbekannte FIT-Metriken können ergänzt werden, ohne das Schema zu brechen.
- **Originale bleiben erhalten:** Jede importierte Datei liegt unverändert unter
  `/var/lib/localtrack/data/originals/<activity-id>.<ext>` (Re-Parsing möglich).
- **UTC intern**, Anzeige lokal (`timezone_name` pro Aktivität).
- **Keine externen Karten-Tiles** – die Track-Anzeige ist rein lokal (V2: optionaler
  lokaler Tile-Server, konfigurierbar).
- Keine Telemetrie, keine externen Requests zur Laufzeit außer vom Administrator konfigurierten.

## Roadmap (Auswahl)

Segmente & Heatmap · lokale Kartenkacheln · Trainingsbelastung mit versionierten Metriken ·
Ziele/Kalender · Multi-User · Reverse-Proxy-Setup im Installer · Alembic-Migrationen ·
Background Sync API.

## Lizenz

MIT – siehe [LICENSE](LICENSE).
