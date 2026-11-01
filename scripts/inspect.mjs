import { readFile, mkdir, writeFile, lstat } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { discoverTargets, connect } from './inspector/cdp.mjs';
import { createPrivacy } from './inspector/privacy.mjs';
import { captureDocument } from './inspector/capture.mjs';
import { readSelectors } from './inspector/selectors.mjs';
import { traceSamples } from './inspector/provenance.mjs';
import { buildResults } from './inspector/report.mjs';

const project = fileURLToPath(new URL('../', import.meta.url));
const contexts = new Set(['default', 'sidebar', 'editor', 'database', 'menu', 'dialog', 'search', 'tooltip', 'notification', 'hover', 'selected', 'active', 'focused', 'disabled', 'checked', 'expanded']);
export function parseOptions(args) {
  const options = { port: 9222, maxElements: 6000, samples: 8, context: 'default' };
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (flag === '--help') return { help: true };
    if (!['--port', '--max-elements', '--samples', '--context'].includes(flag) || args[i + 1] === undefined) throw Error('Invalid inspector option; use --help.');
    const value = args[++i];
    if (flag === '--context') { if (!contexts.has(value)) throw Error('Use a predefined --context value from --help.'); options.context = value; }
    else {
      if (!/^\d+$/.test(value)) throw Error('Numeric inspector options require an integer.');
      const number = Number(value);
      const [minimum, maximum] = flag === '--port' ? [1, 65535] : flag === '--samples' ? [0, 24] : [100, 20000];
      if (number < minimum || number > maximum) throw Error('Numeric inspector option is out of range; use --help.');
      options[flag === '--port' ? 'port' : flag === '--samples' ? 'samples' : 'maxElements'] = number;
    }
  }
  return options;
}

export async function inspect(options, { discover = discoverTargets, connection = connect, root = project } = {}) {
  const css = await readFile(path.join(root, 'dist/Ectoplasma.theme.css'), 'utf8').catch(() => { throw Error('Compiled theme missing. Run npm run build, then retry npm run inspect.'); });
  const { selectors, limitations } = readSelectors(css);
  if (!selectors.length) throw Error('No compiled theme selectors found. Run npm run build and check the CSS.');
  let targets;
  try { targets = await discover(options.port); }
  catch { throw Error('Local Notion CDP is unavailable. Start Notion manually using your existing Automator launcher (or ./start.sh), then retry npm run inspect. The inspector did not start or restart Notion.'); }
  if (!targets.length) throw Error('No eligible Notion page or desktop Tab Bar renderer is available on the local CDP endpoint. Open the relevant interface manually and retry.');
  const captures = [], timestamp = new Date().toISOString();
  for (const target of targets) {
    const startedAt = new Date().toISOString();
    let client;
    try {
      client = await connection(target);
      const expression = `(${captureDocument.toString()})(${JSON.stringify({ selectors, kind: target.kind, maxElements: options.maxElements })}, (${createPrivacy.toString()})())`;
      const response = await client.send('Runtime.evaluate', { expression, returnByValue: true, silent: true, allowUnsafeEvalBlockedByCSP: false, timeout: 8000 });
      if (response.exceptionDetails || !response.result?.value?.elements) throw Error('CAPTURE_UNAVAILABLE');
      const data = response.result.value;
      const provenance = await traceSamples(client, data, options.samples);
      captures.push({ renderer: target.renderer, kind: target.kind, startedAt, finishedAt: new Date().toISOString(), status: 'captured', data, provenance });
    } catch { captures.push({ renderer: target.renderer, kind: target.kind, startedAt, finishedAt: new Date().toISOString(), status: 'unavailable', reason: 'Renderer closed, timed out, or has no usable runtime context.' }); }
    finally { client?.close(); }
  }
  const reference = { file: 'dist/Ectoplasma.theme.css', sha256: createHash('sha256').update(css).digest('hex') };
  return buildResults({ reference, selectors, parserLimitations: limitations, captures, context: options.context, maxElements: options.maxElements, samples: options.samples, port: options.port, timestamp });
}

export async function saveResults(results, root = project) {
  const base = path.join(root, '.inspections');
  await mkdir(base, { recursive: true, mode: 0o700 });
  if ((await lstat(base)).isSymbolicLink()) throw Error('Inspection output directory must not be a symlink.');
  const directory = path.join(base, new Date().toISOString().replaceAll(':', '-') + '-' + randomUUID().slice(0, 8));
  await mkdir(directory, { mode: 0o700 });
  for (const [name, value] of [['report.md', results.report], ['selector-matrix.json', results.matrix], ['styling-inventory.json', results.inventory], ['metadata.json', results.metadata]]) {
    await writeFile(path.join(directory, name), typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  }
  return path.relative(root, directory);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const options = parseOptions(process.argv.slice(2));
    if (options.help) console.log('Usage: npm run inspect -- [--port 9222] [--max-elements 6000] [--samples 8] [--context default]\nContexts: ' + [...contexts].join(', ') + '\nOne read-only snapshot of existing local Notion targets. Outputs: .inspections/<capture>/. No interactions or application startup.');
    else {
      const results = await inspect(options);
      const directory = await saveResults(results);
      const successful = results.metadata.renderers.filter(r => r.status === 'captured').length;
      console.log(`Captured ${successful}/${results.metadata.renderers.length} renderer targets. Reports: ${directory}`);
      console.log(`Unobserved states: ${results.metadata.unobservedStates.join(', ') || 'none (per-component coverage still requires review)'}`);
      if (!successful) process.exitCode = 1;
    }
  } catch (error) {
    const safe = /^(?:Invalid inspector|Use a predefined|Numeric inspector|Compiled theme missing|No compiled theme|Local Notion CDP|No eligible Notion|Inspection output)/.test(error.message);
    console.error(safe ? error.message : 'Inspection failed. Check local project permissions and the existing CDP connection. No application changes were made.');
    process.exitCode = 1;
  }
}
