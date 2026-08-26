#!/usr/bin/env bash
#
# LocalTrack - Proxmox VE Installer (Community-Scripts-Stil)
# Erstellt einen LXC-Container und installiert die komplette Anwendung.
#
# Variablen (per Environment ueberschreibbar, z. B.:
#   CTID=150 REPO_URL=https://github.com/HatchetMan111/RunnerStravaProxmox.git REF=v0.1.0 bash -c "$(wget -qLO - ...)"):
#
set -Eeuo pipefail

APP="localtrack"
PORT="${PORT:-8080}"
CTID="${CTID:-}"
PVE_CHECK_ROOT="${PVE_CHECK_ROOT:-1}"
RAM="${RAM:-2048}"
CORES="${CORES:-2}"
DISK_GB="${DISK_GB:-8}"
BRIDGE="${BRIDGE:-vmbr0}"
NET_MODE="${NET_MODE:-dhcp}"
NET_IP="${NET_IP:-}"
NET_GW="${NET_GW:-}"
REPO_URL="${REPO_URL:-https://github.com/HatchetMan111/RunnerStravaProxmox.git}"
REF="${REF:-main}"
STORAGE="${STORAGE:-}"

LOG_FILE="/var/log/${APP}-install.log"
DEBUG="${DEBUG:-0}"

if [[ "${DEBUG}" == "1" ]]; then
  set -x
fi

exec > >(tee -a "${LOG_FILE}") 2>&1

error_handler() {
  local exit_code="$1"
  local line_no="$2"
  echo "" >&2
  echo "============================================================" >&2
  echo "INSTALLATION FEHLGESCHLAGEN" >&2
  echo "  Fehler in Zeile : ${line_no}" >&2
  echo "  Exit-Code       : ${exit_code}" >&2
  echo "  Letzter Befehl  : ${BASH_COMMAND}" >&2
  echo "" >&2
  echo "Vollstaendiges Protokoll: ${LOG_FILE}" >&2
  echo "Debug-Ausfuehrung:  DEBUG=1 bash install-script.sh" >&2
  echo "Container-Logs:     pct exec ${CTID:-?} -- journalctl -u ${APP} -e" >&2
  echo "============================================================" >&2
}
trap 'error_handler $? $LINENO' ERR

info() { echo -e "[INFO]  $*"; }
ok() { echo -e "[OK]    $*"; }

require_host() {
  if [[ "${PVE_CHECK_ROOT}" == "1" && "${EUID}" -ne 0 ]]; then
    echo "FEHLER: Script muss als root auf dem Proxmox-Host laufen." >&2
    exit 1
  fi
  if ! command -v pveversion >/dev/null 2>&1; then
    echo "FEHLER: pveversion nicht gefunden. Bitte auf dem Proxmox-Host ausfuehren." >&2
    exit 1
  fi
  ok "Proxmox $(pveversion)"
}

vmid_in_use() {
  local id="$1"
  if pct status "${id}" >/dev/null 2>&1; then
    return 0
  fi
  if qm status "${id}" >/dev/null 2>&1; then
    return 0
  fi
  return 1
}

next_free_ctid() {
  local candidate
  candidate="$(pvesh get /cluster/nextid 2>/dev/null | tr -d '[:space:]' || true)"
  if [[ "${candidate}" =~ ^[0-9]+$ ]] && (( candidate >= 100 && candidate <= 999 )); then
    echo "${candidate}"
    return
  fi
  for candidate in $(seq 100 999); do
    if ! vmid_in_use "${candidate}"; then
      echo "${candidate}"
      return
    fi
  done
  echo ""
}

pick_storage() {
  if [[ -n "${STORAGE}" ]]; then
    echo "${STORAGE}"
    return
  fi
  local first
  first="$(pvesm status -content rootdir 2>/dev/null | awk 'NR>1 && $3 ~ /active/ {print $1; exit}')"
  if [[ -z "${first}" ]]; then
    first="$(pvesm status 2>/dev/null | awk 'NR>1 && $3 ~ /active/ && $2 ~ /^(dir|zfspool|lvm|lvmthin|btrfs|zfs|rbd)$/ {print $1; exit}')"
  fi
  if [[ -z "${first}" ]]; then
    echo "FEHLER: kein aktiver Storage für Container-Root-Disks gefunden." >&2
    echo "" >&2
    echo "-- Aktuelle Storages ('pvesm status') --" >&2
    pvesm status 2>&1 | sed 's/^/   /' >&2
    echo "" >&2
    echo "Abhilfe: STORAGE=<Name> als Umgebungsvariable setzen und Installer erneut ausführen," >&2
    echo "z. B.:  STORAGE=local bash -c \"\$(wget -qLO - ...)\"" >&2
    exit 1
  fi
  echo "${first}"
}

ensure_template() {
  pveam update >/dev/null 2>&1 || true

  local tpl_storage
  tpl_storage="$(pvesm status -content vztmpl 2>/dev/null | awk 'NR>1 && $3 ~ /active/ {print $1; exit}')"
  if [[ -z "${tpl_storage}" ]]; then
    tpl_storage="$(pvesm status 2>/dev/null | awk 'NR>1 && $3 ~ /active/ && ($2 == "dir" || $2 == "nfs" || $2 == "cifs" || $2 == "btrfs") {print $1; exit}')"
  fi
  if [[ -z "${tpl_storage}" ]]; then
    echo "FEHLER: kein aktiver Storage für Container-Templates (vztmpl) gefunden." >&2
    pvesm status 2>&1 | sed 's/^/   /' >&2
    exit 1
  fi

  local found=""
  found="$(pveam list "${tpl_storage}" 2>/dev/null | awk '{print $1}' | grep 'debian-12-standard' | head -n1 || true)"
  if [[ -z "${found}" ]]; then
    info "Lade Debian-12-Template auf '${tpl_storage}' herunter …"
    pveam download "${tpl_storage}" debian-12-standard_12.7-1_amd64.tar.zst >/dev/null 2>&1 || true
    found="$(pveam list "${tpl_storage}" 2>/dev/null | awk '{print $1}' | grep 'debian-12-standard' | head -n1 || true)"
  fi
  if [[ -z "${found}" ]]; then
    echo "FEHLER: kein Debian-12-Standard-Template verfügbar." >&2
    echo "Verfügbare System-Templates:" >&2
    pveam available --section system 2>&1 | sed 's/^/   /' >&2 || true
    echo "Manuell abhilfe: pveam download ${tpl_storage} <template>" >&2
    exit 1
  fi
  echo "${found}"
}

create_or_reuse_ct() {
  if pct status "${CTID}" >/dev/null 2>&1; then
    ok "Container ${CTID} existiert bereits – wird verwendet."
    pct start "${CTID}" >/dev/null 2>&1 || true
    return
  fi
  if qm status "${CTID}" >/dev/null 2>&1; then
    echo "FEHLER: VMID ${CTID} ist auf diesem Node durch eine VM belegt." >&2
    echo "Bitte eine andere CT-ID wählen, z. B.:  CTID=200 bash -c \"\$(wget -qLO - ...)\"" >&2
    exit 1
  fi
  local template
  template="$(ensure_template)"

  local net_line="name=net0,bridge=${BRIDGE},ip=dhcp"
  if [[ "${NET_MODE}" == "static" ]]; then
    [[ -n "${NET_IP}" && -n "${NET_GW}" ]] || {
      echo "FEHLER: NET_MODE=static braucht NET_IP und NET_GW." >&2
      exit 1
    }
    net_line="name=net0,bridge=${BRIDGE},ip=${NET_IP},gw=${NET_GW}"
  fi

  info "Erstelle LXC ${CTID}: ${CORES} vCPU / ${RAM} MB RAM / ${DISK_GB} GB auf '${STORAGE_NAME}' …"
  pct create "${CTID}" "${template}" \
    --hostname "${APP}" \
    --unprivileged 1 \
    --cores "${CORES}" \
    --memory "${RAM}" \
    --swap 512 \
    --rootfs "${STORAGE_NAME}:${DISK_GB}" \
    --net0 "${net_line}" \
    --onboot 1 \
    --start 1 \
    --features nesting=1 >/dev/null

  ok "Container erstellt."
}

wait_for_network() {
  info "Warte auf Netzwerk im Container …"
  for _ in $(seq 1 30); do
    if pct exec "${CTID}" -- getent hosts debian.org >/dev/null 2>&1; then
      ok "Netzwerk bereit."
      return
    fi
    sleep 2
  done
  echo "FEHLER: Container hat nach 60s keine Netzwerkverbindung." >&2
  exit 1
}

inner_install() {
  cat <<'INNER'
set -Eeuo pipefail

export LC_ALL=C LANG=C LANGUAGE=C
export DEBIAN_FRONTEND=noninteractive
ENV_FILE="/etc/default/localtrack"
APP_DIR="/opt/localtrack"

on_error() {
  local c=$?
  echo "" >&2
  echo "FEHLER: Installationsschritt fehlgeschlagen (Zeile ${LINENO}: ${BASH_COMMAND}, Exit ${c})" >&2
  if systemctl cat localtrack.service >/dev/null 2>&1; then
    echo "--- journalctl -u localtrack (letzte 40 Zeilen) ---" >&2
    journalctl -u localtrack -n 40 --no-pager >&2 || true
  fi
}
trap on_error ERR

: "${LT_REPO_URL:?LT_REPO_URL wurde nicht gesetzt}"
: "${LT_REF:?LT_REF wurde nicht gesetzt}"

echo ">> apt update / Basispakete"
apt-get update -qq
apt-get install -y -qq python3 python3-venv git curl ca-certificates postgresql nodejs npm openssl >/dev/null

echo ">> PostgreSQL prüfen"
if ! pg_isready -q; then
  PG_VER="$(pg_lsclusters -h | head -1 | awk '{print $1}')"
  pg_ctlcluster "${PG_VER}" main start
fi

DB_USER="localtrack"
DB_NAME="localtrack"
DB_PASS="$(openssl rand -hex 24 2>/dev/null || head -c 24 /dev/urandom | sha256sum | cut -c1-48)"
PORT_VALUE="${LT_PORT:-8080}"

pg_sql() {
  (cd /tmp && printf '%s' "$1" | su postgres -c 'psql -tA')
}

config_valid="no"
if [[ -f "${ENV_FILE}" ]] && grep -q '^LOCALTRACK_DATABASE_URL=' "${ENV_FILE}" &&
  grep -q '^LOCALTRACK_DB_PASSWORD=' "${ENV_FILE}"; then
  config_valid="yes"
fi

if [[ "${config_valid}" == "yes" ]]; then
  echo ">> Vorhandene Konfiguration übernehmen (idempotenter Lauf)"
  set -a
  # shellcheck disable=SC1090
  source "${ENV_FILE}"
  set +a
  DB_USER="${LOCALTRACK_DB_USER:-${DB_USER}}"
  DB_NAME="${LOCALTRACK_DB_NAME:-${DB_NAME}}"
  DB_PASS="${LOCALTRACK_DB_PASSWORD:-${DB_PASS}}"
  PORT_VALUE="${LOCALTRACK_PORT:-${PORT_VALUE}}"
else
  echo ">> Konfiguration neu schreiben (${ENV_FILE})"
  cat >"${ENV_FILE}" <<EOF_ENV
LOCALTRACK_PORT=${PORT_VALUE}
LOCALTRACK_DATA_DIR=/var/lib/localtrack/data
LOCALTRACK_DATABASE_URL=postgresql+psycopg://${DB_USER}:${DB_PASS}@127.0.0.1:5432/${DB_NAME}
LOCALTRACK_DB_USER=${DB_USER}
LOCALTRACK_DB_NAME=${DB_NAME}
LOCALTRACK_DB_PASSWORD=${DB_PASS}
LOCALTRACK_REF=${LT_REF}
EOF_ENV
  chmod 600 "${ENV_FILE}"
fi

echo ">> Datenbank-Benutzer und Schema prüfen"
if [[ "$(pg_sql "SELECT 1 FROM pg_roles WHERE rolname='${DB_USER}'")" == "1" ]]; then
  pg_sql "ALTER ROLE \"${DB_USER}\" WITH LOGIN PASSWORD '${DB_PASS}'" >/dev/null
else
  pg_sql "CREATE ROLE \"${DB_USER}\" LOGIN PASSWORD '${DB_PASS}'" >/dev/null
fi
if [[ "$(pg_sql "SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'")" != "1" ]]; then
  (cd /tmp && su postgres -c "createdb -O ${DB_USER} ${DB_NAME}") >/dev/null
fi

echo ">> Systembenutzer anlegen"
id localtrack >/dev/null 2>&1 || useradd -r -s /usr/sbin/nologin -d /var/lib/localtrack localtrack
mkdir -p /var/lib/localtrack/data/{originals,exports,cache}
chown -R localtrack:localtrack /var/lib/localtrack

echo ">> Anwendungscode von ${LT_REPO_URL} (${LT_REF})"
if [[ -d "${APP_DIR}/.git" ]]; then
  cd "${APP_DIR}"
  git remote set-url origin "${LT_REPO_URL}"
  git fetch --depth 1 origin "${LT_REF}"
  git reset --hard "FETCH_HEAD"
else
  rm -rf "${APP_DIR}"
  git clone --depth 1 --branch "${LT_REF}" "${LT_REPO_URL}" "${APP_DIR}"
  cd "${APP_DIR}"
fi

echo ">> Python-Umgebung (pip install, 1-2 Minuten)"
python3 -m venv .venv
.venv/bin/pip install -q --upgrade pip
.venv/bin/pip install -q .

echo ">> Frontend-Build (Node $(node --version))"
if [[ ! -f frontend/dist/index.html ]]; then
  cd frontend
  npm ci --no-audit --no-fund >/dev/null
  npm run build
  cd ..
fi

echo ">> systemd-Unit installieren"
cp systemd/localtrack.service /etc/systemd/system/localtrack.service
sed -i "s|^Documentation=.*|Documentation=${LT_REPO_URL}|" /etc/systemd/system/localtrack.service
install -m 755 scripts/localtrack-cli.sh /usr/local/bin/localtrack
systemctl daemon-reload
systemctl enable --now localtrack.service

echo ">> Warte auf Health-Endpoint (bis zu 60 Sekunden)"
HEALTH_OK=""
CODE=""
for _ in $(seq 1 30); do
  CODE="$(curl -s -m 2 -o /dev/null -w '%{http_code}' "http://127.0.0.1:${PORT_VALUE}/api/v1/health" || true)"
  if [[ "${CODE}" == "200" ]]; then
    HEALTH_OK="yes"
    break
  fi
  sleep 2
done
if [[ -z "${HEALTH_OK}" ]]; then
  echo "FEHLER: /api/v1/health nicht erreichbar (letzter Wert: ${CODE:-keiner})" >&2
  journalctl -u localtrack -n 60 --no-pager >&2 || true
  exit 1
fi
INNER
}

print_summary() {
  local ct_ip
  ct_ip="$(pct exec "${CTID}" -- hostname -I | awk '{print $1}')"
  echo ""
  echo "============================================================"
  echo " LocalTrack erfolgreich installiert"
  echo "============================================================"
  echo " Container : ${CTID}"
  echo " IP        : ${ct_ip}"
  echo " Web UI    : http://${ct_ip}:${PORT}"
  echo ""
  echo " Erste Schritte:"
  echo "   1) Web UI oeffnen und ersten Benutzer anlegen"
  echo "   2) PWA offline nutzen: HTTPS oder localhost erforderlich"
  echo ""
  echo " Service:   systemctl status ${APP}"
  echo " Logs:      journalctl -u ${APP} -f"
  echo " CLI:       localtrack diagnose | backup | update"
  echo "============================================================"
}

main() {
  require_host
  [[ -n "${CTID}" ]] || CTID="$(next_free_ctid)"
  [[ -n "${CTID}" ]] || { echo "FEHLER: keine freie CT-ID gefunden (100-999)." >&2; exit 1; }
  STORAGE_NAME="$(pick_storage)"
  info "CT-ID: ${CTID} · Storage: ${STORAGE_NAME} · Repo: ${REPO_URL} (${REF})"

  create_or_reuse_ct
  wait_for_network

  info "Installation im Container läuft (kann einige Minuten dauern) …"
  local inner_tmp
  inner_tmp="$(mktemp /tmp/${APP}-inner.XXXXXX.sh)"
  inner_install >"${inner_tmp}"
  pct push "${CTID}" "${inner_tmp}" "/usr/local/sbin/${APP}-install-inner.sh" >/dev/null
  rm -f "${inner_tmp}"

  if ! pct exec "${CTID}" -- env \
    LT_REPO_URL="${REPO_URL}" \
    LT_REF="${REF}" \
    LT_PORT="${PORT}" \
    bash "/usr/local/sbin/${APP}-install-inner.sh"; then
    echo "" >&2
    echo "FEHLER: Einrichtung im Container fehlgeschlagen – siehe Ausgabe oben." >&2
    echo "Erneuter Lauf möglich: Container wird wiederverwendet (Installation ist idempotent)." >&2
    exit 1
  fi

  if pct exec "${CTID}" -- systemctl is-active --quiet "${APP}"; then
    ok "Service aktiv."
  else
    echo "FEHLER: Service nicht aktiv." >&2
    exit 1
  fi

  local health_code
  health_code="$(pct exec "${CTID}" -- curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:${PORT}/api/v1/health")"
  if [[ "${health_code}" == "200" ]]; then
    ok "HTTP Health-Check: 200"
  else
    echo "FEHLER: Health-Check ergab ${health_code} statt 200." >&2
    exit 1
  fi

  print_summary
  ok "Installationsprotokoll: ${LOG_FILE}"
}

main "$@"
