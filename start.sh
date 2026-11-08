#!/bin/bash

NOTION="/Applications/Notion.app/Contents/MacOS/Notion"
SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)" || exit 1
LOADER="$SCRIPT_DIR/loader.js"
PORT=9222
NODE="$(command -v node || echo /opt/homebrew/bin/node)"
if [ ! -x "$NODE" ]; then
    echo "[Ectoplasma] Node.js is missing. Install Node.js 22.4+ and add it to PATH." >&2
    exit 1
fi
log() { "$NODE" "$SCRIPT_DIR/scripts/loader-log.cjs" "$1"; }
log "launcher startup"

# Start Notion with remote debugging if it isn't already running.
if ! curl --silent --fail --max-time 1 \
    "http://127.0.0.1:$PORT/json/version" >/dev/null; then

    if [ ! -x "$NOTION" ]; then
        log "Notion executable missing"
        echo "[Ectoplasma] Install Notion at /Applications/Notion.app." >&2
        exit 1
    fi
    log "launching Notion with CDP"
    "$NOTION" \
        --remote-debugging-address=127.0.0.1 \
        --remote-debugging-port="$PORT" &

    # Wait until Notion's debugging interface becomes available.
    for i in {1..30}; do
        if curl --silent --fail --max-time 1 \
            "http://127.0.0.1:$PORT/json/version" >/dev/null; then
            break
        fi
        sleep 1
    done
fi

if ! curl --silent --fail --max-time 1 "http://127.0.0.1:$PORT/json/version" >/dev/null; then
    log "CDP unavailable after launcher wait"
    echo "[Ectoplasma] CDP is unavailable. Loader will retry. If Notion is already open, fully quit it and rerun start.sh." >&2
fi

# Start the CSS loader.
exec "$NODE" "$LOADER"
