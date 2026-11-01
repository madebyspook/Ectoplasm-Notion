const net = require("node:net");
const fs = require("node:fs");
const crypto = require("node:crypto");

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

module.exports = { acquireInstance };
