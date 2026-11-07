const fs = require('node:fs');
const path = require('node:path');
const { acquireInstance } = require('./scripts/loader-instance.cjs');
const { connect, Injector } = require('./scripts/injector.cjs');

const CSS_PATH = path.join(__dirname, 'dist', 'Ectoplasma.theme.css');

async function main() {
    const manual = process.argv.includes('--once');
    const instance = manual ? null : await acquireInstance(__dirname);
    if (!manual && !instance) {
        console.log('Ectoplasma loader already running for this checkout; using the existing instance.');
        return;
    }
    let injector;
    let watcher;
    const cleanup = () => {
        watcher?.close();
        injector?.client.removeAllListeners('closed');
        injector?.close();
        instance?.close();
    };
    try {
        const css = fs.readFileSync(CSS_PATH, 'utf8');
        const client = await connect();
        injector = new Injector(client, css, { manual });
        client.once('closed', () => {
            console.error('[CDP disconnected] Restart the loader to reconnect.');
            cleanup();
            process.exitCode = 1;
        });
        await injector.start();
        if (manual) {
            cleanup();
            console.log(`Ectoplasma CSS reinjected into ${injector.targets.size} renderer(s).`);
            return;
        }
        // Watch the directory so atomic file replacement keeps triggering updates.
        watcher = fs.watch(path.dirname(CSS_PATH), (event, filename) => {
            if (filename && filename.toString() !== path.basename(CSS_PATH)) return;
            try {
                const next = fs.readFileSync(CSS_PATH, 'utf8');
                if (next !== injector.css) void injector.update(next);
            } catch (error) {
                if (error.code !== 'ENOENT') console.error(`[CSS error] ${error.message}`);
            }
        });
        // Close the startup gap between reading CSS and installing the watcher.
        const latest = fs.readFileSync(CSS_PATH, 'utf8');
        if (latest !== injector.css) await injector.update(latest);
        console.log('Ectoplasma Notion loader running. Press Ctrl+C to stop.');
    } catch (error) {
        cleanup();
        throw error;
    }
}

main().catch(error => {
    console.error(`[Injection startup] ${error.message}`);
    process.exitCode = 1;
});
