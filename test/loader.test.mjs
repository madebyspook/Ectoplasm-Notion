import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, copyFile, writeFile, readFile, rm, symlink, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const require = createRequire(import.meta.url);
const { acquireInstance } = require('../scripts/loader-instance.cjs');
const repo = fileURLToPath(new URL('../', import.meta.url));
const close = server => new Promise(resolve => server.close(resolve));

async function temporary(t) {
    const directory = await mkdtemp(path.join(tmpdir(), 'ectoplasma loader-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    return directory;
}

test('concurrent claims elect one owner; aliases reuse it; release leaves no stale metadata', async t => {
    const directory = await temporary(t);
    const claims = await Promise.all(Array.from({ length: 12 }, () => acquireInstance(directory)));
    const owners = claims.filter(Boolean);
    t.after(async () => { for (const owner of owners) await close(owner); });
    assert.equal(owners.length, 1);
    const alias = directory + '-alias';
    await symlink(directory, alias);
    t.after(() => rm(alias));
    assert.equal(await acquireInstance(alias), null);
    await close(owners[0]);
    const next = await acquireInstance(directory);
    assert(next);
    await close(next);
});

test('a different service occupying the port is never reused or stopped', async t => {
    const directory = await temporary(t);
    const owner = await acquireInstance(directory);
    const { port } = owner.address();
    await close(owner);
    const service = net.createServer(socket => socket.end('unrelated service\n'));
    await new Promise(resolve => service.listen(port, '127.0.0.1', resolve));
    t.after(() => close(service));
    await assert.rejects(acquireInstance(directory), /another service; no process was stopped/);
    assert(service.listening);
});

test('an unresponsive service fails safely instead of being mistaken for a stale owner', async t => {
    const directory = await temporary(t);
    const owner = await acquireInstance(directory);
    const { port } = owner.address();
    await close(owner);
    const sockets = [];
    const service = net.createServer(socket => { sockets.push(socket); socket.on('error', () => {}); });
    await new Promise(resolve => service.listen(port, '127.0.0.1', resolve));
    t.after(async () => { sockets.forEach(socket => socket.destroy()); await close(service); });
    await assert.rejects(acquireInstance(directory), /Instance check timed out/);
    assert(service.listening);
});

// This preload replaces all CDP traffic and renderer operations. It is used only
// in copied projects under tmpdir; no real Notion endpoint or DOM is contacted.
const preload = String.raw`
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const vm = require('node:vm');
const root = __dirname;
const record = event => fs.appendFileSync(path.join(root,'events.jsonl'), JSON.stringify({pid:process.pid,...event})+'\n');
global.fetch = async () => ({ok:true,json:async()=>({webSocketDebuggerUrl:'ws://127.0.0.1:9222/devtools/browser/fixture'})});
global.WebSocket = class extends EventEmitter {
    static OPEN = 1;
    constructor() {
        super(); this.readyState=0; this.sessions=new Map(); this.scripts=new Map(); this.sequence=0;
        this.watcher=fs.watch(root,(event,filename)=>{
            if(filename==='targets.json' && this.discover) {
                for(const targetInfo of JSON.parse(fs.readFileSync(path.join(root,'targets.json')))) {
                    this.message({method:'Target.targetInfoChanged',params:{targetInfo:{...targetInfo,targetId:targetInfo.id}}});
                }
            }
            if(filename==='disconnect') { this.emit('error'); this.emit('close',{code:1006,wasClean:false}); }
            if(filename==='lifecycle.json') {
                const {id,method}=JSON.parse(fs.readFileSync(path.join(root,'lifecycle.json')));
                const session=this.sessions.get(id);
                if(session){session.styles.clear();this.message({sessionId:id,method,params:{frame:{id:'main'}}});}
            }
        });
        setImmediate(()=>{this.readyState=1;this.emit('open');});
    }
    removeEventListener(name, callback) { this.off(name,callback); }
    addEventListener(name, callback, options) { options?.once ? this.once(name,callback) : this.on(name,callback); }
    message(data) { this.emit('message',{data:JSON.stringify(data)}); }
    close() { if(this.readyState===3)return;this.readyState=3;this.watcher.close();setImmediate(()=>this.emit('close')); }
    send(data) {
        const {id,method,params,sessionId}=JSON.parse(data);
        let result={};
        if(method==='Target.getTargets') {
            record({event:'scan'});
            result.targetInfos=JSON.parse(fs.readFileSync(path.join(root,'targets.json'))).map(t=>({...t,targetId:t.id}));
        }
        if(method==='Target.setDiscoverTargets') this.discover=true;
        if(method==='Target.attachToTarget') {
            const target=JSON.parse(fs.readFileSync(path.join(root,'targets.json'))).find(t=>t.id===params.targetId);
            this.sessions.set(target.id,{target,styles:new Map()});result.sessionId=target.id;
            record({event:'open',url:target.webSocketDebuggerUrl});
        }
        if(method==='Page.addScriptToEvaluateOnNewDocument') result.identifier=String(++this.sequence);
        if(method==='Runtime.evaluate') {
            const {styles,target}=this.sessions.get(sessionId);
            const url=new URL(target.url);
            const document={
                getElementById:id=>styles.get(id)||null,
                createElement:()=>({}),
                head:{appendChild:style=>styles.set(style.id,style)}
            };
            const window={};window.top=window;
            const value=vm.runInNewContext(params.expression,{window,document,location:{origin:url.origin,protocol:url.protocol}});
            const style=styles.get('ectoplasma-notion-theme');
            record({event:'css',url:target.webSocketDebuggerUrl,id:style?.id,css:style?.textContent,styles:styles.size});
            result={result:{value}};
        }
        queueMicrotask(()=>this.message({id,result}));
    }
};
`;

async function fixture(t) {
    const directory = await mkdtemp(path.join(tmpdir(), 'ectoplasma loader-'));
    await mkdir(path.join(directory, 'scripts'));
    await mkdir(path.join(directory, 'dist'));
    await mkdir(path.join(directory, 'bin'));
    for (const file of ['loader.js', 'start.sh', 'scripts/loader-instance.cjs', 'scripts/injector.cjs', 'scripts/loader-log.cjs']) {
        await copyFile(path.join(repo, file), path.join(directory, file));
    }
    // Replace the application path as an additional safety barrier: even a
    // broken CDP-ready mock can never launch the user's real Notion application.
    const startup = await readFile(path.join(directory, 'start.sh'), 'utf8');
    const notionPath = 'NOTION="/Applications/Notion.app/Contents/MacOS/Notion"';
    assert(startup.includes(notionPath));
    await writeFile(path.join(directory, 'start.sh'), startup.replace(notionPath, `NOTION="${directory}/bin/notion"`));
    await writeFile(path.join(directory, 'bin/notion'), '#!/bin/sh\necho "Unexpected fixture Notion launch" >&2\nexit 99\n', { mode: 0o755 });
    await writeFile(path.join(directory, 'dist/Ectoplasma.theme.css'), '.fixture { color: red; }');
    await writeFile(path.join(directory, 'preload.cjs'), preload);
    // curl reports CDP ready: start.sh must not try to launch even fake Notion.
    await writeFile(path.join(directory, 'bin/curl'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    const targets = [
        { id: 'main', type: 'page', url: 'https://app.notion.com/fixture', title: 'Fixture', webSocketDebuggerUrl: 'ws://fixture/main' },
        { id: 'tabs', type: 'page', url: 'file:///fixture/tabs.html', title: 'Tab Bar', webSocketDebuggerUrl: 'ws://fixture/tabs' },
        { id: 'other', type: 'page', url: 'https://unrelated.invalid/', title: 'Unrelated', webSocketDebuggerUrl: 'ws://fixture/other' },
    ];
    await writeFile(path.join(directory, 'targets.json'), JSON.stringify(targets));
    const children = [];
    t.after(async () => {
        for (const child of children) if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
        await Promise.all(children.map(child => child.finished));
        await rm(directory, { recursive: true, force: true });
    });
    const launch = (shell = false, manual = false) => {
        const child = spawn(shell ? '/bin/bash' : process.execPath,
            [path.join(directory, shell ? 'start.sh' : 'loader.js'), ...(manual ? ['--once'] : [])], {
                cwd: tmpdir(),
                env: { ...process.env, PATH: path.join(directory, 'bin') + path.delimiter + path.dirname(process.execPath) + path.delimiter + process.env.PATH,
                    NODE_OPTIONS: '--require ' + JSON.stringify(path.join(directory, 'preload.cjs')) },
                stdio: ['ignore', 'pipe', 'pipe'],
            });
        child.output = '';
        child.stdout.on('data', data => child.output += data);
        child.stderr.on('data', data => child.output += data);
        child.finished = new Promise((resolve, reject) => { child.once('error', reject); child.once('close', (code, signal) => resolve({ code, signal })); });
        children.push(child);
        return child;
    };
    const events = async () => {
        try { return (await readFile(path.join(directory, 'events.jsonl'), 'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse); }
        catch (error) { if (error.code === 'ENOENT') return []; throw error; }
    };
    const wait = async predicate => {
        const end = Date.now() + 8000;
        while (Date.now() < end) { const data = await events(); if (predicate(data)) return data; await new Promise(resolve => setTimeout(resolve, 40)); }
        assert.fail('Fixture condition timed out: ' + children.map(c => c.output).join('\n'));
    };
    return { directory, targets, launch, events, wait };
}

test('repeated/concurrent shell and direct launches share one watcher and CDP client', { timeout: 15000 }, async t => {
    const f = await fixture(t);
    const owner = f.launch(true);
    await f.wait(data => data.filter(e => e.event === 'css').length === 2);
    const duplicates = Array.from({ length: 6 }, (_, i) => f.launch(i % 2 === 0));
    for (const child of duplicates) {
        assert.deepEqual(await child.finished, { code: 0, signal: null });
        assert.match(child.output, /already running/);
        assert.doesNotMatch(child.output, /Unexpected fixture Notion launch/);
    }
    const data = await f.events();
    assert.deepEqual([...new Set(data.map(e => e.pid))], [owner.pid]);
    assert.doesNotMatch(owner.output, /Unexpected fixture Notion launch/);
    assert.deepEqual(data.filter(e => e.event === 'open').map(e => e.url).sort(), ['ws://fixture/main', 'ws://fixture/tabs']);
    assert(data.filter(e => e.event === 'css').every(e => e.id === 'ectoplasma-notion-theme' && e.styles === 1));
});

test('simultaneous cold launcher invocations start only one owner', { timeout: 15000 }, async t => {
    const f = await fixture(t);
    const children = Array.from({ length: 6 }, (_, i) => f.launch(i % 2 === 0));
    const data = await f.wait(data => data.filter(e => e.event === 'css').length >= 2);
    const pids = [...new Set(data.map(e => e.pid))];
    assert.equal(pids.length, 1);
    for (const child of children.filter(c => c.pid !== pids[0])) {
        assert.deepEqual(await child.finished, { code: 0, signal: null });
        assert.match(child.output, /already running/);
    }
    assert.deepEqual([...new Set((await f.events()).map(e => e.pid))], pids);
});

test('the real loader still hot reloads, discovers new targets and restores replaced documents in isolated fixtures', { timeout: 15000 }, async t => {
    const f = await fixture(t);
    f.launch();
    await f.wait(data => data.filter(e => e.event === 'css').length === 2);
    await writeFile(path.join(f.directory, 'dist/Ectoplasma.theme.css'), '.fixture { color: blue; }');
    await f.wait(data => data.filter(e => e.event === 'css' && e.css.includes('blue')).length >= 2);
    await writeFile(path.join(f.directory, 'dist/replacement.css'), '.fixture { color: green; }');
    await rename(path.join(f.directory, 'dist/replacement.css'), path.join(f.directory, 'dist/Ectoplasma.theme.css'));
    await f.wait(data => data.filter(e => e.event === 'css' && e.css.includes('green')).length >= 2);
    f.targets.push({ id: 'new', type: 'page', url: 'https://app.notion.com/new', title: 'Fixture new', webSocketDebuggerUrl: 'ws://fixture/new' });
    await writeFile(path.join(f.directory, 'targets.json'), JSON.stringify(f.targets));
    await f.wait(data => data.some(e => e.event === 'css' && e.url === 'ws://fixture/new' && e.css.includes('green')));
    const before = (await f.events()).filter(e => e.event === 'css' && e.url === 'ws://fixture/main').length;
    await writeFile(path.join(f.directory, 'lifecycle.json'), JSON.stringify({id:'main',method:'Page.domContentEventFired'}));
    await f.wait(data => data.filter(e => e.event === 'css' && e.url === 'ws://fixture/main').length > before);
});

test('normal exit and a crashed fixture release ownership without PID-file cleanup', { timeout: 15000 }, async t => {
    const f = await fixture(t);
    const first = f.launch();
    await f.wait(data => data.some(e => e.pid === first.pid && e.event === 'css'));
    first.kill('SIGTERM');
    await first.finished;
    const second = f.launch();
    await f.wait(data => data.some(e => e.pid === second.pid && e.event === 'css'));
    second.kill('SIGKILL'); // Only this test-created isolated child, never Notion.
    await second.finished;
    const third = f.launch();
    await f.wait(data => data.some(e => e.pid === third.pid && e.event === 'css'));
});


test('manual injection works alongside the owner, exits, and leaves one style per renderer', { timeout: 15000 }, async t => {
    const f = await fixture(t);
    const owner = f.launch();
    await f.wait(data => data.some(e => e.event === 'css' && e.pid === owner.pid));
    const manual = f.launch(false, true);
    assert.deepEqual(await manual.finished, { code: 0, signal: null });
    assert.match(manual.output, /reinjected into 2 renderer/);
    const data = await f.events();
    assert.equal(data.filter(e => e.event === 'css' && e.pid === manual.pid).length, 2);
    assert(data.filter(e => e.event === 'css').every(e => e.styles === 1));
    assert.equal(owner.exitCode, null);
});

test('WebSocket failure reconnects once, keeps the owner, and injects new targets with latest CSS', { timeout: 15000 }, async t => {
    const f = await fixture(t);
    const owner = f.launch();
    await f.wait(data => data.filter(e => e.event === 'css').length === 2);
    await writeFile(path.join(f.directory, 'disconnect'), 'fail');
    await writeFile(path.join(f.directory, 'dist/Ectoplasma.theme.css'), '.fixture { color: purple; }');
    f.targets.push({ id: 'recovered', type: 'page', url: 'https://app.notion.com/new', title: 'Fixture', webSocketDebuggerUrl: 'ws://fixture/recovered' });
    await writeFile(path.join(f.directory, 'targets.json'), JSON.stringify(f.targets));
    const data = await f.wait(data => data.some(e => e.url === 'ws://fixture/recovered' && e.css?.includes('purple')));
    assert.deepEqual([...new Set(data.map(e => e.pid))], [owner.pid]);
    assert.equal(data.filter(e => e.event === 'scan').length, 2);
    const logs = (await readFile(path.join(f.directory, '.logs/loader.log'), 'utf8')).trim().split('\n').map(JSON.parse);
    assert.equal(logs.filter(e => e.event === 'reconnect scheduled').length, 1);
    assert(logs.some(e => e.event === 'CDP disconnected' && e.kind === 'WebSocket error'));
    assert(logs.every(e => !Number.isNaN(Date.parse(e.time))));
    assert(!JSON.stringify(logs).includes('https://app.notion.com'));
    owner.kill('SIGTERM');
    assert.deepEqual(await owner.finished, { code: 0, signal: null });
    assert.match(await readFile(path.join(f.directory, '.logs/loader.log'), 'utf8'), /shutdown.*SIGTERM/);
});

test('initial CDP outage backs off, can be stopped during retry, and manual mode fails promptly', { timeout: 15000 }, async t => {
    const f = await fixture(t);
    await writeFile(path.join(f.directory, 'preload.cjs'), preload + '\nglobal.fetch = async () => { throw Object.assign(Error("fixture offline"), { code: "ECONNREFUSED" }); };\n');
    const owner = f.launch();
    const deadline = Date.now() + 5000;
    while (!owner.output.includes('Retrying automatically') && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
    assert.match(owner.output, /Retrying automatically/);
    const duplicate = f.launch();
    assert.deepEqual(await duplicate.finished, { code: 0, signal: null });
    assert.match(duplicate.output, /already running/);
    owner.kill('SIGTERM');
    assert.deepEqual(await owner.finished, { code: 0, signal: null });
    const manual = f.launch(false, true);
    assert.deepEqual(await manual.finished, { code: 1, signal: null });
    assert.match(manual.output, /fully quit Notion/);
    const logs = await readFile(path.join(f.directory, '.logs/loader.log'), 'utf8');
    assert.match(logs, /ECONNREFUSED/);
    assert.match(logs, /reconnect scheduled/);
});

test('log rotation bounds persistent diagnostics and logging failures stay nonfatal', async t => {
    const f = await fixture(t);
    const logModule = require(path.join(f.directory, 'scripts/loader-log.cjs'));
    await mkdir(path.join(f.directory, '.logs'));
    await writeFile(logModule.LOG_PATH, 'x'.repeat(1024 * 1024));
    logModule.log('fixture rotation');
    assert.equal((await readFile(logModule.LOG_PATH + '.1')).length, 1024 * 1024);
    assert.equal(JSON.parse(await readFile(logModule.LOG_PATH, 'utf8')).event, 'fixture rotation');
    await rm(path.join(f.directory, '.logs'), { recursive: true });
    await writeFile(path.join(f.directory, '.logs'), 'blocked');
    const errors = [];
    const original = console.error;
    console.error = line => errors.push(line);
    try { assert.doesNotThrow(() => logModule.log('blocked')); }
    finally { console.error = original; }
    assert.match(errors.join('\n'), /check directory permissions/);
});

test('fatal watcher and unexpected promise errors log diagnostics, exit, and release ownership', { timeout: 15000 }, async t => {
    for (const failure of ['watcher', 'rejection']) {
        const f = await fixture(t);
        await writeFile(path.join(f.directory, 'preload.cjs'), preload + `
const originalWatch = fs.watch;
fs.watch = function(directory, ...args) {
    const watcher = originalWatch.call(this, directory, ...args);
    if (path.basename(directory) === 'dist') setTimeout(() => {
        ${failure === 'watcher' ? "watcher.emit('error', Object.assign(Error('fixture watcher failure'), {code:'ENOSPC'}));" : "Promise.reject(Object.assign(Error('fixture rejection'), {code:'FIXTURE'}));"}
    }, 150);
    return watcher;
};
`);
        const child = f.launch();
        assert.deepEqual(await child.finished, { code: 1, signal: null });
        const logs = await readFile(path.join(f.directory, '.logs/loader.log'), 'utf8');
        assert.match(logs, /fatal/);
        assert.match(logs, failure === 'watcher' ? /ENOSPC/ : /FIXTURE/);
        assert.match(child.output, /Stopped.*rerun start.sh/);
        const guard = await acquireInstance(f.directory);
        assert(guard);
        await close(guard);
    }
});

test('failed WebSocket handshakes are cleaned up before automatic retry', { timeout: 15000 }, async t => {
    const f = await fixture(t);
    await writeFile(path.join(f.directory, 'preload.cjs'), preload.replace(
        "setImmediate(()=>{this.readyState=1;this.emit('open');});",
        "setImmediate(()=>{this.emit('error');});"));
    const child = f.launch();
    const deadline = Date.now() + 5000;
    let logs = '';
    while (Date.now() < deadline) {
        try { logs = await readFile(path.join(f.directory, '.logs/loader.log'), 'utf8'); } catch {}
        if ((logs.match(/reconnect scheduled/g) || []).length >= 2) break;
        await new Promise(resolve => setTimeout(resolve, 30));
    }
    assert.equal((logs.match(/reconnect scheduled/g) || []).length, 2);
    assert.match(logs, /WebSocket handshake/);
    assert.match(logs, /"delayMs":1000/);
    assert.match(logs, /"delayMs":2000/);
    child.kill('SIGTERM');
    assert.deepEqual(await child.finished, { code: 0, signal: null });
});
