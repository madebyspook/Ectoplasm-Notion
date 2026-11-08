const fs = require('node:fs');
const path = require('node:path');
const { acquireInstance } = require('./scripts/loader-instance.cjs');
const { connect, Injector } = require('./scripts/injector.cjs');
const { log, diagnostic, LOG_PATH } = require('./scripts/loader-log.cjs');

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
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, () => shutdown(signal));
process.on('uncaughtException', error => fatal('uncaught exception', error));
process.on('unhandledRejection', error => fatal('unhandled rejection', error));
process.on('exit', code => { if (!stopping) log('exit', { code }); });

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
main().catch(error => fatal('startup', error));
