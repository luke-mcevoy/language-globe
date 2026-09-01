#!/usr/bin/env bash
# Creates the venv on first run, installs deps, and starts the scene server.
set -euo pipefail
cd "$(dirname "$0")"

PY="${PYTHON:-python3.11}"
if ! command -v "$PY" >/dev/null; then
  echo "scene-server needs $PY (brew install python@3.11), or set PYTHON=" >&2
  exit 1
fi

if [ ! -d .venv ]; then
  "$PY" -m venv .venv
fi
./.venv/bin/pip install --quiet --disable-pip-version-check -r requirements.txt
exec ./.venv/bin/python server.py
