#!/bin/bash

NOTION="/Applications/Notion.app/Contents/MacOS/Notion"
SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)" || exit 1
LOADER="$SCRIPT_DIR/loader.js"
PORT=9222

# Start Notion with remote debugging if it isn't already running.
if ! curl --silent --fail --max-time 1 \
    "http://127.0.0.1:$PORT/json/version" >/dev/null; then

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

# Start the CSS loader.
exec "$(command -v node || echo /opt/homebrew/bin/node)" "$LOADER"
