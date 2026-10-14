#!/bin/sh
set -eu
export CI_BASE_URL="${INFRAXIS_BASE_URL:-${CI_BASE_URL:-http://127.0.0.1:8787}}"
export CI_WORKER_TOKEN="${INFRAXIS_WORKER_TOKEN:-${CI_WORKER_TOKEN:?Set CI_WORKER_TOKEN or INFRAXIS_WORKER_TOKEN}}"
export CI_WORKER_ID="${INFRAXIS_WORKER_ID:-${CI_WORKER_ID:-mac-agent-01}}"
export CI_WORKER_LABELS="${INFRAXIS_WORKER_LABELS:-${CI_WORKER_LABELS:-ios,android,release}}"
export CI_WORK_DIR="${INFRAXIS_WORK_DIR:-${CI_WORK_DIR:-$HOME/infraxis-work}}"
exec node worker/agent.js
