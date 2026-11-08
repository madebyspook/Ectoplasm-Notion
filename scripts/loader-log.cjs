const fs = require('node:fs');
const path = require('node:path');

const LOG_PATH = path.join(__dirname, '..', '.logs', 'loader.log');
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
if (require.main === module) log(process.argv[2]);
module.exports = { log, diagnostic, LOG_PATH };
