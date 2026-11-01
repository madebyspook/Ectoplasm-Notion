// Small scanner for compiled CSS, not a second CSS compiler. Unknown constructs
// remain explicitly unverified; validity/matching is checked by Chromium.
export function splitTopLevel(text, separator = ',') {
  const result = []; let start = 0, depth = 0, quote = null;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '\\') { i++; continue; }
    if (quote) { if (char === quote) quote = null; continue; }
    if (char === '"' || char === "'") quote = char;
    else if ('(['.includes(char)) depth++;
    else if (')]'.includes(char)) depth--;
    else if (char === separator && depth === 0) { result.push(text.slice(start, i).trim()); start = i + 1; }
  }
  result.push(text.slice(start).trim());
  return result.filter(Boolean);
}

export function readSelectors(css) {
  let source = '', quote = null;
  for (let i = 0; i < css.length;) {
    const char = css[i];
    if (char === '\\') { source += css.slice(i, i + 2); i += 2; continue; }
    if (quote) { if (char === quote) quote = null; source += char; i++; continue; }
    if (char === '"' || char === "'") { quote = char; source += char; i++; continue; }
    if (css.slice(i, i + 2) === '/*') {
      const end = css.indexOf('*/', i + 2), next = end < 0 ? css.length : end + 2;
      source += css.slice(i, next).replace(/[^\n]/g, ' '); i = next;
    } else { source += char; i++; }
  }
  const selectors = [], limitations = [];
  function walk(start, end, conditions = []) {
    let cursor = start;
    while (cursor < end) {
      while (/\s/.test(source[cursor] || '') && cursor < end) cursor++;
      const preludeStart = cursor; let quote = null, depth = 0;
      while (cursor < end) {
        const c = source[cursor];
        if (c === '\\') { cursor += 2; continue; }
        if (quote) { if (c === quote) quote = null; }
        else if (c === '"' || c === "'") quote = c;
        else if ('(['.includes(c)) depth++;
        else if (')]'.includes(c)) depth--;
        else if (!depth && (c === '{' || c === ';')) break;
        cursor++;
      }
      const prelude = source.slice(preludeStart, cursor).trim();
      if (source[cursor] !== '{') { cursor++; continue; }
      const bodyStart = ++cursor; let braces = 1; quote = null;
      while (cursor < end && braces) {
        const c = source[cursor];
        if (c === '\\') { cursor += 2; continue; }
        if (quote) { if (c === quote) quote = null; }
        else if (c === '"' || c === "'") quote = c;
        else if (c === '{') braces++;
        else if (c === '}') braces--;
        cursor++;
      }
      if (braces) { limitations.push('Unclosed CSS block; selector inventory may be incomplete.'); break; }
      const bodyEnd = cursor - 1;
      if (/^@(media|supports|layer|container|scope|starting-style)\b/i.test(prelude)) {
        walk(bodyStart, bodyEnd, [...conditions, prelude]);
      } else if (!prelude.startsWith('@')) {
        const properties = splitTopLevel(source.slice(bodyStart, bodyEnd), ';').map(p => p.match(/^\s*((?:--)?[a-zA-Z][\w-]*)\s*:/)?.[1]).filter(Boolean);
        if (source.slice(bodyStart, bodyEnd).includes('{')) limitations.push('Nested CSS requires separate validation; descendant rules may be incomplete.');
        for (const selector of splitTopLevel(prelude)) selectors.push({ id: `s${selectors.length + 1}`, selector, line: source.slice(0, preludeStart).split('\n').length, conditions, properties, specificity: specificity(selector), ...risks(selector) });
      }
    }
  }
  walk(0, source.length);
  return { selectors, limitations: [...new Set(limitations)] };
}

function identifier(text, start) {
  let i = start;
  while (i < text.length) {
    if (text[i] === '\\') { i++; const hex = text.slice(i).match(/^[\da-f]{1,6}\s?/i); i += hex ? hex[0].length : 1; }
    else if (/[\w\u0080-\uffff-]/.test(text[i])) i++;
    else break;
  }
  return i;
}

export function specificity(selector) {
  const total = [0, 0, 0]; let i = 0;
  const add = value => { if (!value) throw Error(); value.forEach((n, j) => total[j] += n); };
  const maximum = list => list.map(specificity).reduce((a, b) => {
    if (!a || !b) throw Error();
    for (let j = 0; j < 3; j++) if (a[j] !== b[j]) return a[j] > b[j] ? a : b;
    return a;
  }, [0, 0, 0]);
  function group(open, close) {
    const start = ++i; let depth = 1, quote = null;
    while (i < selector.length && depth) {
      const c = selector[i];
      if (c === '\\') { i += 2; continue; }
      if (quote) { if (c === quote) quote = null; }
      else if (c === '"' || c === "'") quote = c;
      else if (c === open) depth++;
      else if (c === close) depth--;
      i++;
    }
    if (depth) throw Error();
    return selector.slice(start, i - 1);
  }
  try {
    while (i < selector.length) {
      const c = selector[i];
      if (/[\s>+~,]/.test(c)) { i++; continue; }
      if (c === '|') { i++; continue; }
      if (c === '*') { i++; continue; }
      if (c === '&') return null;
      if (c === '#') { total[0]++; i = identifier(selector, i + 1); continue; }
      if (c === '.') { total[1]++; i = identifier(selector, i + 1); continue; }
      if (c === '[') { total[1]++; group('[', ']'); continue; }
      if (c === ':') {
        const pseudoElement = selector[i + 1] === ':'; i += pseudoElement ? 2 : 1;
        const start = i; i = identifier(selector, i); const name = selector.slice(start, i).toLowerCase();
        if (!name) return null;
        const argument = selector[i] === '(' ? group('(', ')') : null;
        if (pseudoElement || ['before', 'after', 'first-line', 'first-letter'].includes(name)) {
          total[2]++; if (name === 'slotted' && argument) add(maximum(splitTopLevel(argument))); continue;
        }
        if (name === 'where') continue;
        if (['is', 'not', 'has', 'matches', '-webkit-any'].includes(name)) { add(maximum(splitTopLevel(argument || ''))); continue; }
        total[1]++;
        if (['host', 'host-context'].includes(name) && argument) add(maximum(splitTopLevel(argument)));
        if (['nth-child', 'nth-last-child'].includes(name) && argument) {
          const of = argument.match(/\s+of\s+([\s\S]+)$/i); if (of) add(maximum(splitTopLevel(of[1])));
        }
        continue;
      }
      const next = identifier(selector, i);
      if (next === i) return null;
      if (selector[next] !== '|' || selector[next + 1] === '|') total[2]++;
      i = next;
    }
    return total;
  } catch { return null; }
}

export function risks(selector) {
  const dependencies = [], concerns = [];
  if (/\[style[~|^$*]?=/i.test(selector)) dependencies.push('inline-style serialization');
  if (/\d+(?:px|rem|em)|rgb\(|hsl\(/i.test(selector)) dependencies.push('literal geometry or color');
  if (/aria-label[~|^$*]?=/.test(selector)) dependencies.push('localized or state-dependent label');
  if (/:first-child|:nth-|\s[+~]\s|:has\(\s*>/.test(selector)) dependencies.push('DOM structure');
  if (/\.[x][a-z0-9]{5,}/i.test(selector) || /#[\w-]+|data-(?:block|collection-view)-id/.test(selector)) dependencies.push('generated or instance identifier');
  if (/\*/.test(selector.replace(/\[[^\]]*\]/g, ''))) concerns.push('Universal matching: review matched element roles before narrowing.');
  if (/img:not\([^)]*\bsvg\)/.test(selector)) concerns.push('Possible ineffective image/SVG exclusion; compare match sets and specificity.');
  if (/\.hide-scrollbar/.test(selector) && !/\.root/.test(selector)) concerns.push('Generic scroll-container scope: verify other renderers and overlays.');
  const states = [...new Set(Array.from(selector.matchAll(/:(hover|active|focus-visible|focus-within|focus|disabled|enabled|checked|selected)\b/g), m => m[1]).concat(Array.from(selector.matchAll(/aria-(selected|pressed|disabled|checked|expanded|current)/g), m => `aria-${m[1]}`)))];
  if (/\[style/.test(selector)) states.push('possible inline-encoded state (unverified)');
  return { dependencies, concerns, stateDependencies: states, riskAssessment: 'heuristic; matching evidence is reported separately' };
}
