import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, copyFile, writeFile, readFile, rm, symlink } from 'node:fs/promises';
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
require('node:http').get = (url, callback) => {
    record({event:'scan'});
    const response = new EventEmitter();
    queueMicrotask(() => {
        callback(response);
        response.emit('data',fs.readFileSync(path.join(root,'targets.json'),'utf8'));
        response.emit('end');
    });
    return new EventEmitter();
};
const sockets = new Map();
let watching = false;
global.WebSocket = class extends EventEmitter {
    static OPEN = 1;
    constructor(url) {
        super(); this.url=url; this.readyState=0; this.styles=new Map(); sockets.set(url,this);
        if (!watching) {
            watching=true;
            fs.watchFile(path.join(root,'disconnect.json'),{interval:50},() => {
                for (const url of JSON.parse(fs.readFileSync(path.join(root,'disconnect.json')))) {
                    const socket=sockets.get(url);
                    if(socket?.readyState===1){socket.readyState=3;socket.emit('close');}
                }
            });
        }
        setImmediate(()=>{this.readyState=1;record({event:'open',url});this.emit('open');});
    }
    addEventListener(name, callback) { this.on(name,callback); }
    send(data) {
        const styles=this.styles;
        const document={
            getElementById:id=>styles.get(id)||null,
            createElement:()=>({}),
            head:{appendChild:style=>styles.set(style.id,style)}
        };
        const value=vm.runInNewContext(JSON.parse(data).params.expression,{document});
        const style=styles.get('ectoplasma-notion-theme');
        record({event:'css',url:this.url,id:style?.id,css:style?.textContent,styles:styles.size});
        this.emit('message',{data:JSON.stringify({id:1,result:{result:{value}}})});
    }
};
`;

async function fixture(t) {
    const directory = await mkdtemp(path.join(tmpdir(), 'ectoplasma loader-'));
    await mkdir(path.join(directory, 'scripts'));
    await mkdir(path.join(directory, 'dist'));
    await mkdir(path.join(directory, 'bin'));
    for (const file of ['loader.js', 'start.sh', 'scripts/loader-instance.cjs']) {
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
    await writeFile(path.join(directory, 'disconnect.json'), '[]');
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
    const launch = (shell = false) => {
        const child = spawn(shell ? '/bin/bash' : process.execPath,
            [path.join(directory, shell ? 'start.sh' : 'loader.js')], {
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

test('the real loader still hot reloads, discovers new targets and reconnects in isolated fixtures', { timeout: 15000 }, async t => {
    const f = await fixture(t);
    f.launch();
    await f.wait(data => data.filter(e => e.event === 'css').length === 2);
    await writeFile(path.join(f.directory, 'dist/Ectoplasma.theme.css'), '.fixture { color: blue; }');
    await f.wait(data => data.filter(e => e.event === 'css' && e.css.includes('blue')).length >= 2);
    f.targets.push({ id: 'new', type: 'page', url: 'https://app.notion.com/new', title: 'Fixture new', webSocketDebuggerUrl: 'ws://fixture/new' });
    await writeFile(path.join(f.directory, 'targets.json'), JSON.stringify(f.targets));
    await f.wait(data => data.some(e => e.event === 'css' && e.url === 'ws://fixture/new' && e.css.includes('blue')));
    await writeFile(path.join(f.directory, 'disconnect.json'), '["ws://fixture/main"]');
    await f.wait(data => data.filter(e => e.event === 'open' && e.url === 'ws://fixture/main').length >= 2);
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
