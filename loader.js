const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const crypto = require('node:crypto');
const { connect, Injector } = require('./scripts/injector.cjs');

const LOG_PATH = path.join(__dirname, '.logs', 'loader.log');
function log(event, details = {}) {
    const line = JSON.stringify({ time: new Date().toISOString(), pid: process.pid, event, ...details }) + '\n';
    try {
        fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true, mode: 0o700 });
        if (fs.existsSync(LOG_PATH) && fs.statSync(LOG_PATH).size >= 1024 * 1024) {
            fs.renameSync(LOG_PATH, LOG_PATH + '.1');
        }
        fs.appendFileSync(LOG_PATH, line, { mode: 0o600 });
    } catch (error) {
        console.error(`[Loader logging] ${error.code || error.name}: Cannot write ${LOG_PATH}; check directory permissions.`);
    }
}
// Log stacks without persisting renderer data, protocol payloads or URLs.
function diagnostic(error) {
    return { name: error?.name, code: error?.code, causeCode: error?.cause?.code,
        operation: error?.operation, status: error?.status,
        stack: String(error?.stack || '').split('\n').slice(1, 9).join('\n') };
}

function existingInstance(port, identity) {
    return new Promise((resolve, reject) => {
        const socket = net.connect({ host: "127.0.0.1", port });
        let response = "";
        const finish = (error, matches) => {
            socket.destroy();
            error ? reject(error) : resolve(matches);
        };
        socket.setTimeout(1500, () => finish(new Error("Instance check timed out")));
        socket.on("error", error => finish(error));
        socket.on("data", chunk => {
            response += chunk;
            if (response.includes("\n") || response.length > 128) {
                finish(null, response === identity);
            }
        });
        socket.on("end", () => finish(null, response === identity));
    });
}

// The OS owns this reservation: no PID files, stale-lock deletion, or signals.
// Canonical paths make symlinked launches share a guard; other checkouts differ.
async function acquireInstance(directory) {
    const key = crypto.createHash("sha256")
        .update(`${process.getuid()}\0${fs.realpathSync(directory)}`).digest("hex");
    const port = 30000 + (parseInt(key.slice(0, 8), 16) % 20000);
    const identity = `Ectoplasma loader v1 ${key}\n`;

    for (let attempt = 0; attempt < 3; attempt++) {
        const server = net.createServer(socket => {
            socket.on("error", () => {});
            socket.setTimeout(1500, () => socket.destroy());
            socket.end(identity);
        });
        try {
            await new Promise((resolve, reject) => {
                server.once("error", reject);
                server.listen({ host: "127.0.0.1", port, exclusive: true }, resolve);
            });
            return server;
        } catch (error) {
            if (error.code !== "EADDRINUSE") throw error;
        }

        try {
            if (await existingInstance(port, identity)) return null;
        } catch (error) {
            // An owner may exit between bind and connect; retry the OS election.
            if (["ECONNREFUSED", "ECONNRESET"].includes(error.code)) continue;
            throw new Error(`Cannot verify loader on localhost:${port}: ${error.message}`);
        }
        throw new Error(`Localhost:${port} belongs to another service; no process was stopped.`);
    }
    throw new Error("Loader ownership changed during startup; retry the launcher.");
}

const CSS_PATH = path.join(__dirname, 'dist', 'Ectoplasma.theme.css');
const manual = process.argv.includes('--once');
let instance, injector, watcher, retryTimer, cancelDelay;
let stopping = false;

function shutdown(reason, code = 0) {
    if (stopping) return;
    stopping = true;
    log('shutdown', { reason, code });
    clearTimeout(retryTimer);
    cancelDelay?.();
    watcher?.close();
    injector?.close();
    instance?.close();
    process.exitCode = code;
}
function fatal(reason, error) {
    log('fatal', { reason, ...diagnostic(error) });
    console.error(`[Loader ${reason}${error?.code ? ' (' + error.code + ')' : ''}] Stopped. Check ${LOG_PATH}; fix the reported problem and rerun start.sh. For CSS errors, run npm run build. For CDP, fully quit Notion and relaunch through start.sh.`);
    shutdown(reason, 1);
    // Unexpected JS errors can leave unknown handles/state; never resume them.
    process.exit(1);
}

function readCSS() { return fs.readFileSync(CSS_PATH, 'utf8'); }
function watchCSS() {
    // Directory watching survives atomic stylesheet replacement; no CSS polling.
    watcher = fs.watch(path.dirname(CSS_PATH), (event, filename) => {
        if (filename && filename.toString() !== path.basename(CSS_PATH)) return;
        try {
            const next = readCSS();
            if (injector && next !== injector.css) {
                void injector.update(next).catch(error => fatal('CSS update', error));
            }
        } catch (error) {
            log('CSS read error', diagnostic(error));
            if (error.code !== 'ENOENT') console.error(`[CSS read] Check ${CSS_PATH} and its permissions; rebuild with npm run build.`);
        }
    });
    watcher.on('error', error => fatal('CSS watcher', error));
}

async function main() {
    log('startup', { mode: manual ? 'manual' : 'background', node: process.version });
    if (typeof WebSocket !== 'function' || typeof fetch !== 'function') {
        console.error('[Loader runtime] Install Node.js 22.4 or newer and verify the launcher PATH.');
        throw Error('Unsupported Node.js runtime');
    }
    try { instance = manual ? null : await acquireInstance(__dirname); }
    catch (error) {
        // Guard diagnostics are local, with no renderer or protocol data.
        log('instance guard failed', { message: error.message });
        console.error(`[Instance guard] ${error.message}`);
        throw error;
    }
    if (!manual && !instance) {
        log('existing instance');
        console.log('Ectoplasma loader already running for this checkout; using the existing instance.');
        return;
    }
    if (stopping) { instance?.close(); return; }
    instance?.on('error', error => fatal('instance guard', error));
    readCSS(); // Fail actionably for missing/unreadable CSS, rather than retrying CDP.
    if (!manual) watchCSS();
    let attempts = 0;
    while (!stopping) {
        let client;
        try {
            log('connection attempt', { attempt: attempts + 1 });
            client = await connect();
            if (stopping) { client.close(); return; }
            let disconnected;
            const closed = new Promise(resolve => { disconnected = resolve; });
            client.once('closed', info => {
                log('CDP disconnected', info);
                disconnected();
            });
            injector = new Injector(client, readCSS(), {
                manual, report: message => { log('injection error', { message }); console.error(message); },
            });
            await injector.start();
            if (client.closed) throw Error('CDP disconnected during startup');
            if (manual) {
                console.log(`Ectoplasma CSS reinjected into ${injector.targets.size} renderer(s).`);
                shutdown('manual complete');
                return;
            }
            const latest = readCSS();
            if (latest !== injector.css) await injector.update(latest);
            log('connected', { renderers: injector.targets.size });
            console.log(`Ectoplasma Notion loader running. Log: ${LOG_PATH}. Press Ctrl+C to stop.`);
            // Reset only after a stable connection to avoid a rapid disconnect loop.
            const stable = setTimeout(() => { attempts = 0; }, 30000);
            await closed;
            clearTimeout(stable);
        } catch (error) {
            log('connection failed', diagnostic(error));
            if (manual) throw error;
        } finally {
            injector?.close();
            injector = null;
            client?.close();
        }
        if (stopping) break;
        const delay = Math.min(1000 * 2 ** Math.min(attempts++, 6), 60000);
        log('reconnect scheduled', { attempt: attempts, delayMs: delay });
        if (attempts === 1 || attempts === 6) console.error(
            `[CDP unavailable] Retrying automatically (next attempt in ${delay / 1000}s). If this persists, fully quit Notion and relaunch through start.sh. Diagnostics: ${LOG_PATH}`);
        await new Promise(resolve => { cancelDelay = resolve; retryTimer = setTimeout(resolve, delay); });
        cancelDelay = null;
    }
}
// The launcher records startup diagnostics without opening CDP or a watcher.
if (process.argv[2] === '--log') {
    log(process.argv[3]);
} else {
    for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, () => shutdown(signal));
    process.on('uncaughtException', error => fatal('uncaught exception', error));
    process.on('unhandledRejection', error => fatal('unhandled rejection', error));
    process.on('exit', code => { if (!stopping) log('exit', { code }); });
    main().catch(error => fatal('startup', error));
}
