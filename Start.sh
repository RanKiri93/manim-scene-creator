#!/usr/bin/env bash
# Start the measure server and the Vite editor in one go (Linux / macOS).
# Usage, from the repository root:  ./Start.sh
# Ctrl+C stops whatever this script started.
set -euo pipefail
set -m

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

MEASURE_HOST="127.0.0.1"
MEASURE_PORT="8765"
APP_HOST="127.0.0.1"
APP_PORT="5173"
MEASURE_URL="http://${MEASURE_HOST}:${MEASURE_PORT}"
APP_URL="http://localhost:${APP_PORT}/"

VENV_PY="${ROOT}/.venv/bin/python"
TIMELINE_DIR="${ROOT}/manim-timeline"

STARTED_PIDS=()

die() {
  echo "error: $*" >&2
  exit 1
}

http_ok() {
  local url="$1"
  if command -v curl >/dev/null 2>&1; then
    curl -sf --max-time 1 "$url" >/dev/null 2>&1
  else
    "$VENV_PY" - "$url" <<'PY'
import sys, urllib.request
urllib.request.urlopen(sys.argv[1], timeout=1)
PY
  fi
}

wait_http() {
  local url="$1"
  local label="$2"
  local i
  for i in $(seq 1 80); do
    if http_ok "$url"; then
      return 0
    fi
    sleep 0.25
  done
  die "${label} did not become ready at ${url}"
}

open_browser() {
  if command -v xdg-open >/dev/null 2>&1; then
    xdg-open "$APP_URL" >/dev/null 2>&1 || true
  elif command -v open >/dev/null 2>&1; then
    open "$APP_URL" >/dev/null 2>&1 || true
  fi
}

cleanup() {
  trap - EXIT INT TERM
  local pid
  for pid in "${STARTED_PIDS[@]:-}"; do
    if [[ -n "$pid" ]]; then
      kill -- "-$pid" 2>/dev/null || kill "$pid" 2>/dev/null || true
    fi
  done
  wait 2>/dev/null || true
}
trap cleanup EXIT INT TERM

[[ -x "$VENV_PY" ]] || die "missing ${VENV_PY}. Create the venv first (python3.13 -m venv .venv) and pip-install manim, fastapi, uvicorn."
[[ -f "${ROOT}/measure_server.py" ]] || die "measure_server.py not found in ${ROOT}"
[[ -d "$TIMELINE_DIR" ]] || die "manim-timeline/ not found in ${ROOT}"
[[ -d "${TIMELINE_DIR}/node_modules" ]] || die "missing manim-timeline/node_modules. Run: cd manim-timeline && npm install"
command -v npm >/dev/null 2>&1 || die "npm is not on PATH"

started_any=false

if http_ok "${MEASURE_URL}/health"; then
  echo "Measure server already running at ${MEASURE_URL}"
else
  echo "Starting measure server at ${MEASURE_URL} ..."
  "$VENV_PY" -m uvicorn measure_server:app --reload --host "$MEASURE_HOST" --port "$MEASURE_PORT" &
  STARTED_PIDS+=("$!")
  started_any=true
  wait_http "${MEASURE_URL}/health" "measure server"
  echo "Measure server ready."
fi

if http_ok "$APP_URL"; then
  echo "Editor already running at ${APP_URL}"
else
  echo "Starting editor at ${APP_URL} ..."
  (
    cd "$TIMELINE_DIR"
    exec npm run dev -- --host "$APP_HOST" --port "$APP_PORT"
  ) &
  STARTED_PIDS+=("$!")
  started_any=true
  wait_http "$APP_URL" "editor"
  echo "Editor ready."
fi

echo
echo "  App:     ${APP_URL}"
echo "  Measure: ${MEASURE_URL}  (health → {\"status\":\"ok\"})"
echo "  In the editor, Measure server URL should stay ${MEASURE_URL}"
echo

open_browser

if [[ "$started_any" == true ]]; then
  echo "Ctrl+C stops the processes started by this script."
  wait
else
  echo "Both were already running; opened the browser."
fi
