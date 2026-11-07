import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const { Injector, CDP, source } = createRequire(import.meta.url)('../scripts/injector.cjs');

const target = (id, url = 'https://app.notion.com/fixture') => ({ targetId: id, type: 'page', url, title: 'Fixture' });
const tick = () => new Promise(resolve => setImmediate(resolve));

class Browser extends EventEmitter {
    constructor(targets) {
        super(); this.targets = targets; this.calls = []; this.scripts = new Map(); this.sequence = 0;
        this.failEvaluation = false;
    }
    async send(method, params = {}, sessionId) {
        this.calls.push({ method, params, sessionId });
        if (method === 'Target.setDiscoverTargets') {
            // Discovery can arrive before getTargets and again in its snapshot.
            for (const targetInfo of this.targets) this.emit('event', { method: 'Target.targetCreated', params: { targetInfo } });
        }
        if (method === 'Target.getTargets') return { targetInfos: this.targets };
        if (method === 'Target.attachToTarget') return { sessionId: params.targetId };
        if (method === 'Page.addScriptToEvaluateOnNewDocument') {
            const identifier = String(++this.sequence);
            this.scripts.set(identifier, params.source);
            return { identifier };
        }
        if (method === 'Page.removeScriptToEvaluateOnNewDocument') this.scripts.delete(params.identifier);
        if (method === 'Runtime.evaluate') {
            if (this.failEvaluation) { this.failEvaluation = false; throw Error('Context was destroyed'); }
            return { result: { value: 'applied' } };
        }
        return {};
    }
    event(method, params = {}, sessionId) { this.emit('event', { method, params, sessionId }); }
    close() {}
}

function documentFixture({ early = false, origin = 'https://app.notion.com', protocol = 'https:' } = {}) {
    const styles = new Map();
    const listeners = [];
    const head = { appendChild(style) { styles.set(style.id, style); } };
    const document = {
        head: early ? null : head, documentElement: null,
        getElementById: id => styles.get(id), createElement: () => ({}),
        addEventListener(name, callback, options) {
            assert.equal(name, 'DOMContentLoaded'); assert.equal(options.once, true); listeners.push(callback);
        },
    };
    const window = {}; window.top = window;
    const context = vm.createContext({ window, document, location: { origin, protocol } });
    return { styles, document, run: expression => vm.runInContext(expression, context),
        ready() { document.head = head; listeners.splice(0).forEach(callback => callback()); } };
}

test('injection waits for a document root and repeated evaluations keep exactly one updated style', async () => {
    const doc = documentFixture({ early: true });
    const pending = doc.run(source('red', false));
    assert.equal(doc.styles.size, 0);
    doc.ready();
    assert.equal(await pending, 'applied');
    const style = doc.styles.get('ectoplasma-notion-theme');
    assert.equal(doc.run(source('blue', false)), 'applied');
    assert.equal(doc.styles.size, 1);
    assert.equal(doc.styles.get('ectoplasma-notion-theme'), style);
    assert.equal(style.textContent, 'blue');
    const other = documentFixture({ origin: 'https://unrelated.invalid' });
    assert.equal(other.run(source('red', false)), 'skipped');
    assert.equal(other.styles.size, 0);
    const tabs = documentFixture({ origin: 'null', protocol: 'file:' });
    assert.equal(tabs.run(source('red', true)), 'applied');
});

test('startup discovery and snapshot deduplicate targets; blank targets attach when their URL becomes Notion', async () => {
    const browser = new Browser([target('one'), target('blank', 'about:blank'), target('other', 'https://unrelated.invalid/')]);
    const injector = new Injector(browser, 'red');
    await injector.start();
    assert.equal(browser.calls.filter(c => c.method === 'Target.attachToTarget').length, 1);
    assert.equal(browser.calls.filter(c => c.method === 'Runtime.evaluate').length, 1);
    browser.event('Target.targetInfoChanged', { targetInfo: target('blank') });
    await tick();
    assert.equal(injector.targets.size, 2);
    assert.equal(browser.calls.filter(c => c.method === 'Runtime.evaluate').length, 2);
    const methods = browser.calls.filter(c => c.sessionId === 'one').map(c => c.method);
    assert.deepEqual(methods, ['Page.enable', 'Page.addScriptToEvaluateOnNewDocument', 'Runtime.evaluate']);
});

test('navigation timing errors recover on the next document event; CSS updates replace future-document scripts', async () => {
    const errors = [];
    const browser = new Browser([target('one')]);
    const injector = new Injector(browser, 'red', { report: message => errors.push(message) });
    await injector.start();
    browser.failEvaluation = true;
    browser.event('Page.frameNavigated', { frame: { id: 'main' } }, 'one');
    await tick();
    assert.equal(errors.length, 1);
    browser.event('Page.domContentEventFired', {}, 'one');
    browser.event('Page.loadEventFired', {}, 'one');
    await tick();
    assert.equal(browser.calls.filter(c => c.method === 'Runtime.evaluate').length, 4);
    await injector.update('blue');
    assert.equal(browser.scripts.size, 1);
    const doc = documentFixture({ early: true });
    const applied = doc.run([...browser.scripts.values()][0]);
    doc.ready(); await applied;
    assert.equal(doc.styles.get('ectoplasma-notion-theme').textContent, 'blue');
    assert.equal(browser.calls.at(-1).params.expression.includes('blue'), true);
    assert(!browser.calls.some(c => c.method === 'Page.reload'));
});

test('destroyed targets release state and a recreated renderer gets a new session', async () => {
    const browser = new Browser([target('one')]);
    const injector = new Injector(browser, 'red');
    await injector.start();
    browser.event('Target.targetDestroyed', { targetId: 'one' });
    assert.equal(injector.targets.size, 0);
    browser.event('Target.targetCreated', { targetInfo: target('one') });
    await tick();
    assert.equal(browser.calls.filter(c => c.method === 'Target.attachToTarget').length, 2);
});

test('manual mode only injects existing targets and reports failures without installing persistent scripts', async () => {
    const browser = new Browser([target('one')]);
    const injector = new Injector(browser, 'red', { manual: true });
    await injector.start();
    assert.deepEqual(browser.calls.map(c => c.method), ['Target.getTargets', 'Target.attachToTarget', 'Runtime.evaluate']);
    const failed = new Browser([target('one')]);
    failed.failEvaluation = true;
    await assert.rejects(new Injector(failed, 'red', { manual: true }).start(), /Injection failed/);
});

test('CDP correlates concurrent requests, reports protocol/evaluation errors and rejects pending work on disconnect', async () => {
    class Socket extends EventEmitter {
        readyState = WebSocket.OPEN;
        sent = [];
        addEventListener(name, callback) { this.on(name, callback); }
        send(data) { this.sent.push(JSON.parse(data)); }
        close() { this.emit('close'); }
        reply(data) { this.emit('message', { data: JSON.stringify(data) }); }
    }
    const socket = new Socket();
    const cdp = new CDP(socket, 100);
    const one = cdp.send('Page.enable', {}, 'one');
    const two = cdp.send('Runtime.evaluate', {}, 'two');
    socket.reply({ id: socket.sent[1].id, result: { result: { value: 'applied' } } });
    socket.reply({ id: socket.sent[0].id, error: { message: 'private details' } });
    await assert.rejects(one, /CDP Page.enable failed/);
    assert.equal((await two).result.value, 'applied');
    const pending = cdp.send('Page.enable');
    socket.close();
    await assert.rejects(pending, /connection closed/);
    assert.equal(cdp.pending.size, 0);
});


test('a destroyed initial context retains its document hook and recovers without stopping other targets', async () => {
    const browser = new Browser([target('one'), target('two')]);
    browser.failEvaluation = true;
    const errors = [];
    const injector = new Injector(browser, 'red', { report: message => errors.push(message) });
    await injector.start();
    assert.equal(injector.targets.size, 2);
    assert.equal(errors.length, 1);
    browser.event('Page.domContentEventFired', {}, 'one');
    await tick();
    assert.equal(browser.calls.filter(c => c.method === 'Runtime.evaluate').length, 3);
    browser.event('Target.detachedFromTarget', { sessionId: 'one' });
    await tick();
    assert.equal(browser.calls.filter(c => c.method === 'Target.attachToTarget').length, 3);
});
