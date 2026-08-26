#!/usr/bin/env bash
set -uo pipefail

APP_NAME="localtrack"
APP_DIR="/opt/localtrack"
DATA_DIR="/var/lib/localtrack/data"
ENV_FILE="/etc/default/${APP_NAME}"
SERVICE_NAME="${APP_NAME}.service"
BACKUP_DIR="/var/backups/${APP_NAME}"

usage() {
  cat <<EOF
Usage: localtrack <command>

Commands:
  backup              Datenbank + Originaldateien sichern (${BACKUP_DIR})
  restore <archiv>    Backup wiederherstellen
  diagnose            System-, Service-, DB- und HTTP-Status prüfen
  update              Auf neueste Version im Repo-Ref aktualisieren
  uninstall           App stoppen und entfernen (Daten werden nachgefragt)
EOF
}

fail() {
  echo "ERROR: $*" >&2
  exit 1
}

# shellcheck source=/dev/null
load_env() {
  [[ -f "${ENV_FILE}" ]] || fail "${ENV_FILE} nicht gefunden – ist LocalTrack installiert?"
  set -a
  # shellcheck disable=SC1090
  source "${ENV_FILE}"
  set +a
  export PGPASSWORD="${LOCALTRACK_DB_PASSWORD:-}"
  PG_OPTS=(-h 127.0.0.1 -U "${LOCALTRACK_DB_USER:-localtrack}")
}

cmd_backup() {
  load_env
  mkdir -p "${BACKUP_DIR}"
  local stamp archive
  stamp="$(date +%Y%m%d-%H%M%S)"
  archive="${BACKUP_DIR}/${APP_NAME}-backup-${stamp}.tar.gz"
  local tmp
  tmp="$(mktemp -d)"

  echo ">> Erzeuge Datenbank-Dump …"
  pg_dump "${PG_OPTS[@]}" -d "${LOCALTRACK_DB_NAME:-localtrack}" >"${tmp}/database.sql" || {
    rm -rf "${tmp}"
    fail "pg_dump fehlgeschlagen (Exit $?)"
  }

  echo ">> Kopiere Dateien aus ${DATA_DIR} …"
  cp -r "${DATA_DIR}" "${tmp}/data"

  tar -czf "${archive}" -C "${tmp}" database.sql data
  rm -rf "${tmp}"
  chown root:root "${archive}"
  chmod 600 "${archive}"
  echo "[OK] Backup erstellt: ${archive}"
  echo "     Größe: $(du -h "${archive}" | cut -f1)"
  find "${BACKUP_DIR}" -name "${APP_NAME}-backup-*.tar.gz" 2>/dev/null | sort -r | tail -n +8 | xargs -r rm --
  echo "     (ältere Backups über 7 hinaus werden gelöscht)"
}

cmd_restore() {
  [[ $# -ge 1 ]] || fail "restore braucht einen Pfad zum Backup-Archiv"
  local archive="$1"
  [[ -f "${archive}" ]] || fail "Datei nicht gefunden: ${archive}"
  load_env
  systemctl stop "${SERVICE_NAME}"
  local tmp
  tmp="$(mktemp -d)"
  tar -xzf "${archive}" -C "${tmp}"

  echo ">> Stelle Datenbank wieder her …"
  psql -h 127.0.0.1 -U "${LOCALTRACK_DB_USER:-localtrack}" -d postgres \
    -c "DROP DATABASE IF EXISTS \"${LOCALTRACK_DB_NAME:-localtrack}\";" >/dev/null
  psql -h 127.0.0.1 -U "${LOCALTRACK_DB_USER:-localtrack}" -d postgres \
    -c "CREATE DATABASE \"${LOCALTRACK_DB_NAME:-localtrack}\" OWNER \"${LOCALTRACK_DB_USER:-localtrack}\";" >/dev/null
  psql "${PG_OPTS[@]}" -d "${LOCALTRACK_DB_NAME:-localtrack}" <"${tmp}/database.sql"

  echo ">> Stelle Dateien wieder her …"
  rm -rf "${DATA_DIR:?}/"*
  cp -r "${tmp}/data/." "${DATA_DIR}/"
  chown -R localtrack:localtrack "${DATA_DIR}"
  rm -rf "${tmp}"
  systemctl start "${SERVICE_NAME}"
  sleep 2
  if systemctl is-active --quiet "${SERVICE_NAME}"; then
    echo "[OK] Restore abgeschlossen"
  else
    fail "Service läuft nach Restore nicht – bitte journalctl -u ${SERVICE_NAME} prüfen"
  fi
}

cmd_diagnose() {
  load_env
  echo "=== LocalTrack diagnose ==="
  local app_version="unbekannt"
  if [[ -d "${APP_DIR}/.git" ]]; then
    app_version="$(git -C "${APP_DIR}" describe --tags --always 2>/dev/null || echo unbekannt)"
  fi
  echo "Version (App):        ${app_version}"
  echo "Kernel:               $(uname -r)"
  echo "RAM:                  $(free -h | awk '/Mem:/ {print $3 " belegt / " $2}')"
  echo "Disk (/var/lib):      $(df -h /var/lib | awk 'NR==2 {print $4 " frei"}')"
  echo ""
  echo "-- systemd --"
  systemctl status "${SERVICE_NAME}" --no-pager -l | head -6 || true
  echo ""
  echo "-- PostgreSQL --"
  if pg_isready "${PG_OPTS[@]}" -d "${LOCALTRACK_DB_NAME:-localtrack}"; then
    echo "[OK] DB erreichbar"
  else
    echo "[FEHLER] DB nicht erreichbar"
  fi
  echo ""
  echo "-- HTTP --"
  local http_code
  http_code="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:${LOCALTRACK_PORT:-8080}/api/v1/health" || echo 000)"
  echo "GET /api/v1/health -> ${http_code}"
  [[ "${http_code}" == "200" ]] && curl -s "http://127.0.0.1:${LOCALTRACK_PORT:-8080}/api/v1/health" | head -c 300
  echo ""
  echo ""
  echo "-- Letzte Logzeilen --"
  journalctl -u "${SERVICE_NAME}" -n 15 --no-pager || true
}

cmd_update() {
  load_env
  echo ">> Backup vor Update …"
  cmd_backup
  cd "${APP_DIR}" || fail "${APP_DIR} fehlt"
  local old_ref new_ref
  old_ref="$(git describe --tags --always 2>/dev/null || echo unknown)"
  git fetch --tags origin "${LOCALTRACK_REF:-main}" || fail "git fetch fehlgeschlagen"
  git reset --hard "origin/${LOCALTRACK_REF:-main}" >/dev/null 2>&1 || true
  new_ref="$(git describe --tags --always 2>/dev/null || echo unknown)"

  echo ">> Installiere Python-Abhängigkeiten neu …"
  "${APP_DIR}/.venv/bin/pip" install -q . || fail "pip install fehlgeschlagen"

  echo ">> Baue Frontend neu …"
  (cd frontend && npm ci --no-audit --no-fund && npm run build) || fail "Frontend-Build fehlgeschlagen"

  systemctl restart "${SERVICE_NAME}"
  sleep 2
  if systemctl is-active --quiet "${SERVICE_NAME}"; then
    local http_code
    http_code="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:${LOCALTRACK_PORT:-8080}/api/v1/health" || true)"
    echo "[OK] Update: ${old_ref} -> ${new_ref}, Health HTTP ${http_code}"
    [[ "${http_code}" == "200" ]] || {
      echo "WARNUNG: Health-Check nicht OK – Rollback manuell möglich:" >&2
      echo "  cd ${APP_DIR} && git checkout ${old_ref} && systemctl restart ${SERVICE_NAME}" >&2
    }
  else
    fail "Service nach Update nicht aktiv. Alte Version: ${old_ref}
  Rollback:  cd ${APP_DIR} && git checkout ${old_ref} && systemctl restart ${SERVICE_NAME}"
  fi
}

cmd_uninstall() {
  echo "Achtung: entfernt LocalTrack inklusive Datenbank."
  read -r -p "Wirklich deinstallieren? 'JA' eingeben: " confirm
  [[ "${confirm}" == "JA" ]] || exit 0
  systemctl disable --now "${SERVICE_NAME}" 2>/dev/null || true
  rm -f "/etc/systemd/system/${SERVICE_NAME}"
  systemctl daemon-reload
  rm -rf "${APP_DIR}" "${DATA_DIR}" "/usr/local/bin/${APP_NAME}"
  if [[ -f "${ENV_FILE}" ]]; then
    set -a
    # shellcheck disable=SC1090
    source "${ENV_FILE}"
    set +a
    su postgres -c "psql -c \"DROP DATABASE IF EXISTS \\\"${LOCALTRACK_DB_NAME:-localtrack}\\\";\"" || true
    su postgres -c "psql -c \"DROP ROLE IF EXISTS \\\"${LOCALTRACK_DB_USER:-localtrack}\\\";\"" || true
    rm -f "${ENV_FILE}"
  fi
  userdel -r localtrack 2>/dev/null || true
  echo "[OK] LocalTrack entfernt."
}

case "${1:-}" in
backup) shift; cmd_backup "$@" ;;
restore) shift; cmd_restore "$@" ;;
diagnose) cmd_diagnose ;;
update) cmd_update ;;
uninstall) cmd_uninstall ;;
*) usage; exit 1 ;;
esac
