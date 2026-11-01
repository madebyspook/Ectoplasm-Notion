const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const PORT = 9222;
const CSS_PATH = path.join(__dirname, "dist", "Ectoplasma.theme.css");
const STYLE_ID = "spooklucence-notion-theme";

const connections = new Map();
let currentCSS = "";

function getTargets() {
    return new Promise((resolve, reject) => {
        http.get(`http://127.0.0.1:${PORT}/json/list`, res => {
            let data = "";

            res.on("data", chunk => data += chunk);
            res.on("end", () => {
                try {
                    resolve(JSON.parse(data));
                } catch (error) {
                    reject(error);
                }
            });
        }).on("error", reject);
    });
}

function injectCSS(ws) {
    if (ws.readyState !== WebSocket.OPEN) return;

    const expression = `(() => {
        let style = document.getElementById(${JSON.stringify(STYLE_ID)});

        if (!style) {
            style = document.createElement("style");
            style.id = ${JSON.stringify(STYLE_ID)};
            (document.head || document.documentElement).appendChild(style);
        }

        style.textContent = ${JSON.stringify(currentCSS)};

        document.getElementById("spooklucence-test")?.remove();

        return "Spooklucence CSS applied";
    })()`;

    ws.send(JSON.stringify({
        id: 1,
        method: "Runtime.evaluate",
        params: {
            expression,
            returnByValue: true
        }
    }));
}

function connect(target) {
    if (connections.has(target.id)) return;

    const ws = new WebSocket(target.webSocketDebuggerUrl);
    connections.set(target.id, ws);

    ws.addEventListener("open", () => {
        console.log(`[Connected] ${target.title || target.url}`);
        injectCSS(ws);
    });

    // Report responses and errors from Notion's debugging interface.
    ws.addEventListener("message", event => {
    const response = JSON.parse(event.data);

    if (response.error) {
        console.error(
            `[Injection error] ${target.title}:`,
            JSON.stringify(response.error, null, 2)
        );
    }

    if (response.result?.exceptionDetails) {
        console.error(
            `[JavaScript exception] ${target.title}:`,
            JSON.stringify(response.result.exceptionDetails, null, 2)
        );
    }

    if (response.result?.result?.value === "Spooklucence CSS applied") {
        console.log(`[CSS applied] ${target.title}`);
    }
    });

    ws.addEventListener("close", () => {
        connections.delete(target.id);
    });

    ws.addEventListener("error", error => {
        console.error(`[WebSocket] ${error.message}`);
        connections.delete(target.id);
    });
}

async function scanTargets() {
    try {
        const targets = await getTargets();

        for (const target of targets) {
            if (
                target.type === "page" &&
                (
                    target.url.startsWith("https://app.notion.com/") ||
                    target.title === "Tab Bar"
                )
            ) {
                connect(target);
            }
        }
    } catch (error) {
        console.error(`[Notion unavailable] ${error.message}`);
    }
}

function loadCSS() {
    try {
        currentCSS = fs.readFileSync(CSS_PATH, "utf8");
        console.log(`[CSS loaded] ${CSS_PATH}`);

        for (const ws of connections.values()) {
            injectCSS(ws);
        }
    } catch (error) {
        console.error(`[CSS error] ${error.message}`);
    }
}

loadCSS();
scanTargets();

// Discover newly opened Notion tabs.
setInterval(scanTargets, 2000);

fs.watchFile(CSS_PATH, { interval: 500 }, (curr, prev) => {
    if (curr.mtimeMs !== prev.mtimeMs) {
        loadCSS();
    }
});

console.log("Spooklucence Notion loader running.");
console.log("Press Ctrl+C to stop.");
