import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, mkdir, writeFile, readFile, readdir, stat, symlink, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { parseOptions, inspect, saveResults } from '../scripts/inspect.mjs';
import { createPrivacy } from '../scripts/inspector/privacy.mjs';
import { captureDocument } from '../scripts/inspector/capture.mjs';
import { readSelectors, specificity } from '../scripts/inspector/selectors.mjs';
import { discoverTargets, connect } from '../scripts/inspector/cdp.mjs';
import { summarizeDeclarations } from '../scripts/inspector/provenance.mjs';

const secret = 'PRIVATE_CANARY_ALICE_8291';
const privacy = createPrivacy();

test('selector scanner handles grouping, quoted commas, conditions and non-style rules', () => {
  const css = `@charset "UTF-8"; /* comment */ @media (min-width: 1px) { :is(.a,#b), [style*="rgb(1, 2, 3)"] { color: red; } } @font-face {font-family:x;src:url(secret)} @keyframes k {from {opacity:0}to {opacity:1}}`;
  const { selectors } = readSelectors(css);
  assert.equal(selectors.length, 2);
  assert.deepEqual(selectors[0].conditions, ['@media (min-width: 1px)']);
  assert.deepEqual(selectors[0].specificity, [1, 0, 0]);
  assert.deepEqual(selectors[1].specificity, [0, 1, 0]);
  assert.deepEqual(selectors[0].properties, ['color']);
  assert.equal(readSelectors('[style*="/*literal*/"] {color:red}').selectors[0].selector, '[style*="/*literal*/"]');
});

test('specificity supports modern functional selectors, escapes and namespaces', () => {
  for (const [selector, expected] of [
    [':where(#x,.y) .z', [0, 1, 0]], ['img:not([aria-label^="Close Tab"] svg)', [0, 1, 2]],
    ['.a [role="button"][aria-labelledby][style*="rgb(1,2,3)"]:not(:hover) div[style*="9px"][style*="gradient"]', [0, 7, 1]],
    ['li:nth-child(2n of .a,#b)', [1, 1, 1]], ['svg|a:hover::before', [0, 1, 2]], ['col||td', [0, 0, 2]], ['.escaped\\:class > *', [0, 1, 0]],
  ]) assert.deepEqual(specificity(selector), expected, selector);
  assert.equal(specificity('& .nested'), null);
});

test('privacy omits content attributes, IDs, generated classes and arbitrary custom-property strings', () => {
  const attrs = { role: 'button', 'aria-label': `Close Tab, ${secret}`, 'aria-labelledby': secret, 'data-block-id': secret, value: secret, title: secret, href: `https://private.invalid/${secret}` };
  const element = { classList: ['notion-topbar-more-button', 'x18942abc', secret], getAttribute: name => attrs[name] ?? null, hasAttribute: name => name in attrs };
  const data = { attributes: privacy.attributes(element), classes: privacy.classes(element), css: privacy.css(`url("https://private.invalid/(x)/${secret}") linear-gradient(red,blue)`), variable: privacy.variable(`"${secret}"`) };
  assert.equal(data.attributes['aria-label'], 'Close Tab');
  assert.deepEqual(data.classes, ['notion-topbar-more-button']);
  assert.ok(!JSON.stringify(data).includes(secret));
  assert.ok(!JSON.stringify(data).includes('private.invalid'));
  assert.equal(privacy.css(`url("${'x'.repeat(1800)}${secret}`), 'url([redacted])');
  assert.equal(privacy.variable(secret), '[redacted]');
  assert.ok(!privacy.css(`var(--c-texPri, ${secret})`).includes(secret));
  assert.equal(privacy.css('#1B1D1F'), '#1B1D1F');
  assert.equal(privacy.variable('#191919'), '#191919');
  assert.deepEqual(privacy.references('var(--c-texPri) var(--private-person)'), ['--c-texPri']);
  assert.equal(privacy.selector(`[href="https://private.invalid/${secret}"]`), '[redacted-attribute]');
});

function fixture(kind = 'page') {
  const defaults = { 'background-color': 'rgb(25, 25, 25)', 'background-image': 'none', color: 'rgb(240, 239, 237)', fill: 'currentcolor', stroke: 'none', 'mask-image': 'none', '-webkit-mask-image': 'none', filter: 'none', opacity: '1', display: 'block', visibility: 'visible', clip: 'auto', 'clip-path': 'none', content: 'none', '--c-bacPri': '#191919', '--c-texPri': '#f0efed' };
  const declaration = values => ({ ...values, getPropertyValue: name => values[name] || '', getPropertyPriority: () => '', [Symbol.iterator]: function* () { yield* Object.keys(values); } });
  class Element {
    constructor(tag, attrs = {}, parent = null, styles = {}, states = []) {
      this.localName = tag; this.attrs = attrs; this.parentElement = parent; this.children = []; parent?.children.push(this);
      this.classList = (attrs.class || '').split(' ').filter(Boolean); this.style = declaration(styles); this.computed = declaration({ ...defaults, ...styles }); this.state = new Set(states);
    }
    getAttribute(name) { if (['href', 'src', 'title', 'value'].includes(name)) throw Error('Forbidden content read'); return this.attrs[name] ?? null; }
    hasAttribute(name) { return name in this.attrs; }
    getBoundingClientRect() { return { x: 0, y: 0, width: 100, height: 30, top: 0, left: 0, right: 100, bottom: 30 }; }
    checkVisibility() { return true; }
    matches(selector) {
      if (selector.includes(',')) return selector.split(',').some(s => this.matches(s.trim()));
      if (selector === '*') return true;
      if (selector.startsWith(':')) return this.state.has(selector.slice(1));
      if (selector === 'option:checked') return this.localName === 'option' && this.state.has('checked');
      if (selector.startsWith('.')) return this.classList.includes(selector.slice(1));
      if (selector.startsWith('[')) { const match = selector.match(/^\[([^=]+)="([^"]+)"\]$/); return !!match && this.attrs[match[1]] === match[2]; }
      return selector === this.localName || selector === this.localName + '.' + this.classList[0];
    }
    closest(selector) { for (let n = this; n; n = n.parentElement) if (n.matches(selector)) return n; return null; }
    get textContent() { throw Error('Forbidden text read'); }
    get value() { throw Error('Forbidden input read'); }
  }
  const html = new Element('html'), body = new Element('body', {}, html);
  const root = new Element('div', { class: kind === 'tab-bar' ? 'root' : 'notion-app-inner notion-dark-theme' }, body);
  const button = new Element('button', { role: 'button', 'aria-label': secret, 'aria-disabled': 'true', value: secret }, root, { 'background-image': `url("https://private.invalid/${secret}")`, '--x-color': 'var(--c-texPri)' }, ['hover', 'focus']);
  const checkbox = new Element('input', { type: 'checkbox', 'aria-checked': 'true', 'aria-expanded': 'true', 'aria-selected': 'true' }, root, {}, ['checked']);
  const live = new Element('div', { role: 'status', 'aria-label': secret }, root, { clip: 'rect(1px,1px,1px,1px)' });
  const nodes = [html, body, root, button, checkbox, live];
  return { document: { querySelectorAll: selector => selector === '*' ? nodes : nodes.filter(n => n.matches(selector)), getElementById: () => null },
    getComputedStyle: (node, pseudo) => pseudo ? declaration({ ...defaults, content: 'none' }) : node.computed,
    CSS: { supports: (...args) => args.at(-1) !== 'selector(???)' }, innerWidth: 800, innerHeight: 600,
    window: { getSelection: () => ({ rangeCount: 0, isCollapsed: true }) }, nodes };
}

test('renderer capture is structural, groups roles, observes states and never reads text/values', () => {
  const env = fixture();
  const request = { selectors: readSelectors(':root {--spook-a:red} button {color:red} .missing {color:blue} ??? {color:black}').selectors, kind: 'page', maxElements: 100 };
  const data = vm.runInNewContext(`(${captureDocument.toString()})(${JSON.stringify(request)},(${createPrivacy.toString()})())`, env);
  assert.ok(!JSON.stringify(data).includes(secret));
  assert.ok(!JSON.stringify(data).includes('private.invalid'));
  assert.equal(data.selectors[1].status, 'confirmed-match');
  assert.equal(data.selectors[2].status, 'no-matches-in-captured-state');
  assert.equal(data.selectors[3].status, 'invalid-or-unsupported-selector');
  for (const state of ['hover', 'focused', 'selected', 'disabled', 'checked', 'expanded']) assert.equal(data.stateSummary[state].observed, true);
  assert.equal(data.stateSummary.active.observed, false);
  assert.equal(data.components.find(c => c.category === 'tooltips-notifications').kind, 'accessibility-live-region');
  assert.ok(data.styles.length < data.elements.length * 2);
});

test('native declarations are summarized without native source, selectors or private values', () => {
  const data = summarizeDeclarations({ inlineStyle: { cssProperties: [{ name: 'color', value: `var(--c-texPri) /*${secret}*/` }] }, matchedCSSRules: [{ rule: { origin: 'regular', selectorList: { text: '#' + secret }, style: { cssProperties: [{ name: 'background', value: `url(https://private.invalid/${secret})` }] } } }], inherited: [{ inlineStyle: { cssProperties: [{ name: 'fill', value: secret }] }, matchedCSSRules: [] }] });
  assert.ok(!JSON.stringify(data).includes(secret));
  assert.ok(!JSON.stringify(data).includes('private.invalid'));
  assert.equal(data.properties.color[0].source, 'inline');
  assert.equal(data.properties.fill[0].ancestorDepth, 1);
  assert.equal(data.variableReferences[0].name, '--c-texPri');
});

test('discovery restricts targets and sockets to the local Notion session', async () => {
  const target = (url, socket, title = secret, type = 'page') => ({ url, webSocketDebuggerUrl: socket, title, type });
  const list = [target(`https://app.notion.com/private/${secret}`, 'ws://127.0.0.1:9222/devtools/page/private-id'), target('file:///Applications/Notion.app/Contents/Resources/app.asar/.webpack/renderer/tabs/index.html', 'ws://127.0.0.1:9222/devtools/page/tabs', 'Tab Bar'), target('https://private.invalid/', 'ws://127.0.0.1:9222/devtools/page/x', 'Tab Bar'), target('https://app.notion.com/x', 'ws://remote.invalid:9222/devtools/page/x'), target('https://app.notion.com/x', 'ws://127.0.0.1:9222/devtools/page/x', '', 'worker')];
  const results = await discoverTargets(9222, async (url, options) => { assert.equal(url, 'http://127.0.0.1:9222/json/list'); assert.equal(options.redirect, 'error'); return { ok: true, text: async () => JSON.stringify(list) }; });
  assert.deepEqual(results.map(r => r.renderer), ['page-1', 'tab-bar-1']);
  assert.ok(results.every(r => !('url' in r) && !('title' in r) && !('id' in r)));
});

test('CDP rejects modifying methods, strips remote errors and closes pending requests', async () => {
  class Socket extends EventEmitter {
    static OPEN = 1;
    constructor() { super(); this.readyState = 1; queueMicrotask(() => this.emit('open')); }
    addEventListener(event, fn, options) { options?.once ? this.once(event, fn) : this.on(event, fn); }
    send(text) { const request = JSON.parse(text); queueMicrotask(() => this.emit('message', { data: JSON.stringify({ id: request.id, error: { message: secret } }) })); }
    close() { this.readyState = 3; this.emit('close'); }
  }
  const client = await connect({ socket: 'ws://127.0.0.1:9222/devtools/page/test' }, { WebSocketImpl: Socket, timeout: 100 });
  await assert.rejects(client.send('Input.dispatchMouseEvent'), /NOT_ALLOWED/);
  await assert.rejects(client.send('CSS.setStyleTexts'), /NOT_ALLOWED/);
  await assert.rejects(client.send('Runtime.evaluate'), /CSP_BYPASS_NOT_ALLOWED/);
  await assert.rejects(client.send('Runtime.evaluate', { allowUnsafeEvalBlockedByCSP: false }), /^Error: CDP_METHOD_FAILED$/);
  client.close();
});

test('CDP requests time out and pending requests reject when their connection closes', async () => {
  class QuietSocket extends EventEmitter {
    static OPEN = 1;
    constructor() { super(); this.readyState = 1; queueMicrotask(() => this.emit('open')); }
    addEventListener(event, fn, options) { options?.once ? this.once(event, fn) : this.on(event, fn); }
    send() {}
    close() { this.readyState = 3; this.emit('close'); }
  }
  const client = await connect({ socket: 'ws://127.0.0.1:9222/devtools/page/test' }, { WebSocketImpl: QuietSocket, timeout: 20 });
  await assert.rejects(client.send('DOM.getDocument'), /REQUEST_TIMEOUT/);
  const pending = client.send('DOM.getDocument');
  client.close();
  await assert.rejects(pending, /CONNECTION_CLOSED/);
});

test('multi-renderer orchestration writes four local reports, preserves failures and excludes private data', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ectoplasma-inspect-test-'));
  try {
    await mkdir(path.join(root, 'dist')); await writeFile(path.join(root, 'dist/Ectoplasma.theme.css'), `:root {--spook-a:red} button {color:red} .missing {color:blue} [href="https://private.invalid/${secret}"] {color:red}`);
    const calls = [], closed = [];
    const options = parseOptions(['--samples', '0', '--context', 'menu']);
    const results = await inspect(options, { root,
      discover: async () => [{ renderer: 'page-1', kind: 'page' }, { renderer: 'tab-bar-1', kind: 'tab-bar' }, { renderer: 'page-2', kind: 'page' }],
      connection: async target => {
        if (target.renderer === 'page-2') throw Error(secret);
        return { send: async (method, params) => { calls.push(method); assert.equal(params.allowUnsafeEvalBlockedByCSP, false); return { result: { value: vm.runInNewContext(params.expression, fixture(target.kind)) } }; }, close: () => closed.push(target.renderer) };
      },
    });
    assert.equal(results.metadata.renderers.length, 3);
    assert.equal(results.metadata.renderers[2].status, 'unavailable');
    assert.equal(results.matrix.selectors[2].captures[0].status, 'no-matches-in-captured-state');
    assert.ok(results.metadata.unobservedStates.includes('active'));
    assert.ok(results.metadata.unobservedVariants.some(v => v.includes('tooltip')));
    const renderer = results.inventory.renderers[0];
    const element = renderer.elements.find(e => e.tag === 'button');
    assert.ok(element.states.includes('disabled'));
    const style = { ...renderer.styleDefaults, ...renderer.styles.find(s => s.id === element.style).values };
    assert.equal(style.color, 'rgb(240, 239, 237)');
    assert.deepEqual(calls, ['Runtime.evaluate', 'Runtime.evaluate']);
    assert.equal(closed.length, 2);
    const output = await saveResults(results, root);
    const files = await readdir(path.join(root, output));
    assert.deepEqual(files.sort(), ['metadata.json', 'report.md', 'selector-matrix.json', 'styling-inventory.json']);
    for (const file of files) { const text = await readFile(path.join(root, output, file), 'utf8'); assert.ok(!text.includes(secret)); assert.ok(!text.includes('private.invalid')); assert.ok(!text.includes('ordinal')); assert.equal((await stat(path.join(root, output, file))).mode & 0o777, 0o600); }
    await assert.rejects(inspect(options, { root, discover: async () => { throw Error(secret); } }), /existing Automator launcher/);
    await assert.rejects(inspect(options, { root, discover: async () => [] }), /No eligible Notion/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('options reject free text and out-of-range values; outputs reject symlink roots', async () => {
  assert.throws(() => parseOptions(['--context', secret]), /predefined/);
  assert.throws(() => parseOptions(['--port', '65536']), /range/);
  assert.throws(() => parseOptions(['--endpoint', 'https://remote.invalid']), /Invalid/);
  const root = await mkdtemp(path.join(os.tmpdir(), 'ectoplasma-output-test-'));
  try { await mkdir(path.join(root, 'outside')); await symlink(path.join(root, 'outside'), path.join(root, '.inspections')); await assert.rejects(saveResults({ report: '', matrix: {}, inventory: {}, metadata: {} }, root), /symlink/); assert.deepEqual(await readdir(path.join(root, 'outside')), []); }
  finally { await rm(root, { recursive: true, force: true }); }
});
