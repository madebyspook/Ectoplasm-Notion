const { EventEmitter } = require('node:events');

const STYLE_ID = 'ectoplasma-notion-theme';

function eligible(target) {
    return target.type === 'page' &&
        (target.url.startsWith('https://app.notion.com/') || target.title === 'Tab Bar');
}

function source(css, tabBar) {
    return `(() => {
        if (window !== window.top) return 'skipped';
        const apply = () => {
            if (location.origin !== 'https://app.notion.com' &&
                !(${JSON.stringify(tabBar)} && location.protocol === 'file:')) return 'skipped';
            let style = document.getElementById(${JSON.stringify(STYLE_ID)});
            if (!style) {
                style = document.createElement('style');
                style.id = ${JSON.stringify(STYLE_ID)};
                (document.head || document.documentElement).appendChild(style);
            }
            style.textContent = ${JSON.stringify(css)};
            document.getElementById('ectoplasma-test')?.remove();
            return 'applied';
        };
        if (document.head || document.documentElement) return apply();
        return new Promise(resolve => document.addEventListener('DOMContentLoaded',
            () => resolve(apply()), { once: true }));
    })()`;
}

// A browser connection gives us target events without scanning on a timer.
class CDP extends EventEmitter {
    constructor(socket, timeout = 5000) {
        super();
        this.socket = socket;
        this.timeout = timeout;
        this.pending = new Map();
        this.sequence = 0;
        socket.addEventListener('message', event => {
            let message;
            try { message = JSON.parse(event.data); } catch { return; }
            if (message.id) {
                const request = this.pending.get(message.id);
                if (!request) return;
                clearTimeout(request.timer);
                this.pending.delete(message.id);
                message.error ? request.reject(Error(`CDP ${request.method} failed`)) : request.resolve(message.result);
            } else {
                this.emit('event', message);
            }
        });
        const closed = () => {
            for (const request of this.pending.values()) {
                clearTimeout(request.timer);
                request.reject(Error('CDP connection closed'));
            }
            this.pending.clear();
            this.emit('closed');
        };
        socket.addEventListener('close', closed);
        socket.addEventListener('error', closed);
    }

    send(method, params = {}, sessionId) {
        if (this.socket.readyState !== WebSocket.OPEN) return Promise.reject(Error('CDP connection closed'));
        return new Promise((resolve, reject) => {
            const id = ++this.sequence;
            const timer = setTimeout(() => {
                this.pending.delete(id);
                reject(Error(`CDP ${method} timed out`));
            }, this.timeout);
            this.pending.set(id, { resolve, reject, timer, method });
            try {
                this.socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
            } catch (error) {
                clearTimeout(timer);
                this.pending.delete(id);
                reject(error);
            }
        });
    }

    close() { this.socket.close(); }
}

async function connect() {
    const response = await fetch('http://127.0.0.1:9222/json/version', {
        signal: AbortSignal.timeout(5000), redirect: 'error',
    });
    if (!response.ok) throw Error('Notion CDP is unavailable');
    const { webSocketDebuggerUrl } = await response.json();
    const url = new URL(webSocketDebuggerUrl);
    if (url.protocol !== 'ws:' || !['127.0.0.1', 'localhost'].includes(url.hostname) || url.port !== '9222') {
        throw Error('Notion CDP must use localhost:9222');
    }
    const socket = new WebSocket(url);
    const client = new CDP(socket);
    await new Promise((resolve, reject) => {
        const timer = setTimeout(() => { socket.close(); reject(Error('CDP connection timed out')); }, 5000);
        const finish = error => { clearTimeout(timer); error ? reject(error) : resolve(); };
        socket.addEventListener('open', () => finish(), { once: true });
        socket.addEventListener('error', () => finish(Error('CDP connection failed')), { once: true });
        socket.addEventListener('close', () => finish(Error('CDP connection closed')), { once: true });
    });
    return client;
}

class Injector {
    constructor(client, css, { manual = false, report = console.error } = {}) {
        this.client = client;
        this.css = css;
        this.manual = manual;
        this.report = report;
        this.targets = new Map();
        this.onEvent = message => this.event(message);
    }

    async start() {
        // Subscribe before discovery/snapshot so creations during startup cannot be lost.
        if (!this.manual) {
            this.client.on('event', this.onEvent);
            await this.client.send('Target.setDiscoverTargets', { discover: true });
        }
        const { targetInfos } = await this.client.send('Target.getTargets');
        const results = await Promise.allSettled(targetInfos.map(target => this.attach(target)));
        const failures = results.filter(result => result.status === 'rejected');
        if (failures.length) {
            const error = Error(`Injection failed for ${failures.length} renderer(s)`);
            if (this.manual) throw error;
            this.report(`[Injection startup] ${error.message}`);
        }
    }

    attach(target) {
        if (!eligible(target)) return Promise.resolve();
        const existing = this.targets.get(target.targetId);
        if (existing) return existing.queue;
        const state = { target, sessionId: null, scriptId: null, queue: Promise.resolve() };
        this.targets.set(target.targetId, state);
        state.queue = (async () => {
            const { sessionId } = await this.client.send('Target.attachToTarget', { targetId: target.targetId, flatten: true });
            state.sessionId = sessionId;
            if (!this.manual) {
                await this.client.send('Page.enable', {}, sessionId);
                await this.register(state);
            }
            await this.inject(state);
        })().catch(async error => {
            // Navigation can destroy the first evaluation context. Keep the
            // installed document hook and let the next Page event retry it.
            if (!this.manual && state.scriptId) {
                this.report(`[Initial injection] ${error.message}`);
                return;
            }
            if (this.targets.get(target.targetId) === state) this.targets.delete(target.targetId);
            if (state.sessionId) {
                await this.client.send('Target.detachFromTarget', { sessionId: state.sessionId }).catch(() => {});
            }
            throw error;
        });
        return state.queue;
    }

    expression(state) { return source(this.css, state.target.title === 'Tab Bar'); }

    async register(state) {
        const previous = state.scriptId;
        const { identifier } = await this.client.send('Page.addScriptToEvaluateOnNewDocument', {
            source: this.expression(state),
        }, state.sessionId);
        state.scriptId = identifier;
        if (previous) await this.client.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: previous }, state.sessionId);
    }

    async inject(state) {
        const result = await this.client.send('Runtime.evaluate', {
            expression: this.expression(state), returnByValue: true, awaitPromise: true,
        }, state.sessionId);
        if (result.exceptionDetails) throw Error('Theme evaluation failed');
        if (result.result?.value !== 'applied' && result.result?.value !== 'skipped') {
            throw Error('Theme evaluation did not complete');
        }
    }

    enqueue(state, operation) {
        state.queue = state.queue.catch(() => {}).then(operation);
        return state.queue;
    }

    event({ method, params, sessionId }) {
        const safely = promise => promise.catch(error => this.report(`[Injection] ${error.message}`));
        if (method === 'Target.targetCreated' || method === 'Target.targetInfoChanged') {
            const target = params.targetInfo;
            const state = this.targets.get(target.targetId);
            if (state) {
                state.target = target;
                safely(this.enqueue(state, () => this.inject(state)));
            } else {
                safely(this.attach(target));
            }
        } else if (method === 'Target.targetDestroyed' || method === 'Target.detachedFromTarget') {
            for (const [id, state] of [...this.targets]) {
                if (id === params.targetId || state.sessionId === params.sessionId) {
                    this.targets.delete(id);
                    if (method === 'Target.detachedFromTarget') safely(this.attach(state.target));
                }
            }
        } else if (method === 'Page.domContentEventFired' || method === 'Page.loadEventFired' ||
            (method === 'Page.frameNavigated' && !params.frame.parentId)) {
            const state = [...this.targets.values()].find(state => state.sessionId === sessionId);
            if (state) safely(this.enqueue(state, () => this.inject(state)));
        }
    }

    async update(css) {
        this.css = css;
        const results = await Promise.allSettled([...this.targets.values()].map(state =>
            this.enqueue(state, async () => { await this.register(state); await this.inject(state); })));
        for (const result of results) if (result.status === 'rejected') this.report(`[CSS update] ${result.reason.message}`);
    }

    close() {
        this.client.off('event', this.onEvent);
        this.client.close();
    }
}

module.exports = { connect, Injector, CDP, source };
