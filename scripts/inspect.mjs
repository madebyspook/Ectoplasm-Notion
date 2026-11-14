import { readFile, mkdir, writeFile, lstat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { discoverTargets, connect } from './cdp.mjs';

// Privacy filtering
// Serialized into the renderer as well as used by the local report writer.
// Never return unrestricted runtime strings, text, IDs, URLs, or style content.
function createPrivacy() {
  const labels = new Set(['Back', 'Forward', 'Open Sidebar', 'Close Sidebar', 'Inbox', 'New', 'New Tab', 'Share', 'Favorite', 'Favorited', 'Actions', 'Copy link', 'Page info', 'Filter', 'Sort', 'Search', 'Search or ask', 'Settings', 'Automations', 'Open', 'Close', 'Change page icon', 'More add options', 'View/hide details']);
  const roles = new Set('alert alertdialog application article banner button cell checkbox columnheader combobox complementary contentinfo dialog document feed figure form graphics-symbol grid gridcell group heading img link list listbox listitem log main marquee math menu menubar menuitem menuitemcheckbox menuitemradio navigation none note option presentation progressbar radio radiogroup region row rowgroup rowheader scrollbar search searchbox separator slider spinbutton status switch tab table tablist tabpanel term textbox timer toolbar tooltip tree treegrid treeitem'.split(' '));
  const nativeName = name => /^--(?:c-|ca-)[a-zA-Z][a-zA-Z0-9-]{0,70}$/.test(name);
  const variableName = name => nativeName(name) || /^--spook-[a-z][a-z0-9-]{0,60}$/.test(name);
  const references = value => [...new Set(Array.from(String(value).matchAll(/var\(\s*(--[\w-]+)/g), m => m[1]).filter(variableName))];
  const cssWords = new Set(('redacted auto none normal inherit initial unset revert revert-layer transparent currentcolor black white red blue green gray grey yellow orange purple pink brown silver lime aqua teal navy maroon olive fuchsia block inline inline-block inline-flex inline-grid flex grid contents flow flow-root list-item table table-row table-cell table-row-group table-header-group table-footer-group table-column table-column-group table-caption ruby hidden visible collapse scroll clip solid dashed dotted double groove ridge inset outset bold bolder lighter start end left right top bottom center cover contain repeat no-repeat repeat-x repeat-y round space border-box padding-box content-box text all fill stroke painted visiblepainted visiblefill visiblestroke bounding-box border-box content-box pointer default not-allowed crosshair grab grabbing col-resize row-resize nwse-resize ew-resize ns-resize move normal pre nowrap pre-wrap pre-line break-spaces rgb rgba hsl hsla hwb lab lch oklab oklch color color-mix light-dark linear-gradient radial-gradient conic-gradient repeating-linear-gradient repeating-radial-gradient repeating-conic-gradient var calc min max clamp env url src blur brightness contrast drop-shadow grayscale hue-rotate invert opacity saturate sepia circle ellipse inset polygon path rect from to in at closest-side farthest-side closest-corner farthest-corner r g b h s l c a alpha x y z srgb srgb-linear display-p3 a98-rgb prophoto-rgb rec2020 xyz xyz-d50 xyz-d65 longer shorter increasing decreasing hue deg rad grad turn px em rem ex ch ic lh rlh vw vh vmin vmax svw svh lvw lvh dvw dvh cm mm q in pt pc ms s e screen print and or not only width height min-width max-width min-height max-height display selector hover focus prefers-color-scheme dark light').split(' '));
  const classes = element => Array.from(element.classList || []).filter(name => name.length < 90 && !/[0-9a-f]{8}-|\d{8}/i.test(name) && (/^notion-[a-z][a-z0-9_-]*$/.test(name) || /^content-editable-[a-z-]+$/.test(name) || ['root', 'hide-scrollbar', 'directional-icon', 'pseudoBefore'].includes(name)));
  function css(value) {
    let text = String(value).replace(/\/\*[\s\S]*?\*\//g, '');
    // Redact before truncation. Quoted URLs can contain parentheses or escapes;
    // unfinished resource functions/strings consume the remainder defensively.
    let redacted = '';
    for (let i = 0; i < text.length;) {
      const resource = text.slice(i).match(/^(?:url|src)\s*\(/i);
      if (resource) {
        i += resource[0].length; let depth = 1, quote = null;
        while (i < text.length && depth) {
          const c = text[i++];
          if (c === '\\') { i++; continue; }
          if (quote) { if (c === quote) quote = null; }
          else if (c === '"' || c === "'") quote = c;
          else if (c === '(') depth++;
          else if (c === ')') depth--;
        }
        redacted += 'url([redacted])';
      } else if (text[i] === '"' || text[i] === "'") {
        const quote = text[i++];
        while (i < text.length) { const c = text[i++]; if (c === '\\') i++; else if (c === quote) break; }
        redacted += '[redacted]';
      } else redacted += text[i++];
    }
    text = redacted;
    text = text.replace(/(?:https?|file|data|blob):[^\s,)]*/gi, '[redacted]');
    text = text.replace(/var\(\s*(--[\w-]+)/g, (match, name) => variableName(name) || ['--x-color', '--x-fill'].includes(name) ? match : 'var(--redacted');
    // Even an inline var() fallback can contain arbitrary content. Preserve
    // known CSS vocabulary and paint-variable names, never unrestricted words.
    text = text.replace(/#[\da-f]{3,8}\b|--[\w-]+|[a-zA-Z_][\w-]*/gi, token => {
      if (token.startsWith('#') || cssWords.has(token.toLowerCase()) || variableName(token) || ['--x-color', '--x-fill'].includes(token)) return token;
      return '[redacted]';
    });
    return text.slice(0, 1500);
  }
  function variable(value) {
    const text = String(value).trim();
    if (!text) return null;
    // Computed custom properties are arbitrary strings. Only retain paint/numeric values.
    if (/["'{};@\\]|url\s*\(|(?:https?|file|data|blob):/i.test(text)) return '[redacted]';
    if (/^(?:#[\da-f]{3,8}|transparent|currentcolor|black|white|inherit|initial|unset)$/i.test(text)) return text;
    if (/^-?[\d.]+(?:px|em|rem|%|ms|s|deg)?$/.test(text)) return text;
    if (/^(?:rgb|rgba|hsl|hsla|oklab|oklch|lab|lch|color|color-mix)\(/i.test(text) && /^[\w\s#(),.%+/*-]+$/.test(text) && typeof CSS !== 'undefined' && CSS.supports('color', text)) return text;
    return '[redacted]';
  }
  function attributes(element) {
    const out = {};
    const role = element.getAttribute('role');
    if (roles.has(role)) out.role = role;
    for (const key of ['aria-selected', 'aria-pressed', 'aria-disabled', 'aria-expanded', 'aria-checked', 'aria-modal', 'aria-multiline']) {
      const value = element.getAttribute(key);
      if (['true', 'false', 'mixed'].includes(value)) out[key] = value;
    }
    const current = element.getAttribute('aria-current');
    if (['true', 'false', 'page', 'step', 'location', 'date', 'time'].includes(current)) out['aria-current'] = current;
    const popup = element.getAttribute('aria-haspopup');
    if (['true', 'false', 'menu', 'listbox', 'tree', 'grid', 'dialog'].includes(popup)) out['aria-haspopup'] = popup;
    const editable = element.getAttribute('contenteditable');
    if (['true', 'false', 'plaintext-only'].includes(editable)) out.contenteditable = editable;
    const type = element.getAttribute('type');
    if (['button', 'submit', 'reset', 'checkbox', 'radio', 'text', 'search', 'number', 'email', 'password', 'date'].includes(type)) out.type = type;
    const tab = element.getAttribute('tabindex');
    if (tab !== null && /^-?\d{1,5}$/.test(tab)) out.tabindex = Number(tab);
    const label = element.getAttribute('aria-label');
    if (labels.has(label)) out['aria-label'] = label;
    else if (label?.startsWith('Close Tab,')) out['aria-label'] = 'Close Tab';
    else if (label !== null) out.hasRedactedLabel = true;
    for (const key of ['aria-labelledby', 'aria-describedby', 'data-block-id', 'data-content-editable-root', 'data-content-editable-leaf', 'data-collection-view-id', 'data-row-index', 'data-col-index', 'placeholder', 'disabled']) {
      if (element.hasAttribute(key)) out[key] = '[present]';
    }
    return out;
  }
  function selector(value) {
    // Reference CSS is local author input, but resource/instance selectors can
    // still contain private data. Matching uses the original; reports redact it.
    return String(value)
      .replace(/\[(?:href|src|srcset|data-block-id|data-collection-view-id)\s*[~|^$*]?=\s*(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\]]*)\]/gi, '[redacted-attribute]')
      .replace(/(?:https?|file|data|blob):[^\s"'\]]*/gi, '[redacted-url]');
  }
  return { classes, attributes, css, variable, selector, references, nativeName, variableName };
}

const privacy = createPrivacy();

// Renderer snapshot
// Executed as a fixed read-only expression in the existing renderer. This does
// not create stylesheets, listeners, observers, globals, or DOM nodes.
function captureDocument(request, privacy) {
  const properties = ['background-color', 'background-image', 'color', 'font-size', 'font-weight', 'line-height', 'fill', 'stroke', 'stroke-width', 'mask-image', '-webkit-mask-image', 'mask-size', 'filter', 'opacity', 'border-top-color', 'border-top-style', 'border-top-width', 'border-right-color', 'border-bottom-color', 'border-left-color', 'border-radius', 'outline-color', 'outline-style', 'outline-width', 'outline-offset', 'box-shadow', 'text-shadow', 'display', 'visibility', 'pointer-events', 'overflow', 'clip', 'clip-path', 'content-visibility'];
  const knownVariables = ['--c-bacPri', '--c-bacSec', '--c-texPri', '--c-texSec', '--c-texTer', '--c-icoPri', '--c-icoSec', '--c-borPri', '--ca-bacIntTra'];
  const all = Array.from(document.querySelectorAll('*'));
  const skipped = new Set(['script', 'style', 'head', 'title', 'meta', 'link', 'noscript']);
  const nodes = all.filter(node => !skipped.has(node.localName)).slice(0, request.maxElements);
  const ids = new Map(nodes.map((node, i) => [node, `n${i + 1}`]));
  const styleTable = [], variableProfiles = [], styleKeys = new Map(), variableKeys = new Map();
  const groups = new Map(), variableUsage = new Map();
  const safeMatches = (node, selector) => { try { return node.matches(selector); } catch { return false; } };
  const tableId = (value, table, keys, prefix) => {
    const key = JSON.stringify(value); if (keys.has(key)) return keys.get(key);
    const id = `${prefix}${table.length + 1}`; keys.set(key, id); table.push({ id, values: value }); return id;
  };
  const readStyle = style => Object.fromEntries(properties.map(name => [name, privacy.css(style.getPropertyValue(name))]));
  const inline = node => Object.fromEntries(properties.filter(name => node.style.getPropertyValue(name)).map(name => [name, { value: privacy.css(node.style.getPropertyValue(name)), important: node.style.getPropertyPriority(name) === 'important' }]));
  function classify(node, computed, attributes, classes) {
    const result = [];
    const add = (category, kind, evidence, confidence = 'observed-hook') => result.push({ category, kind, evidence, confidence });
    const has = selector => !!node.closest(selector);
    if (safeMatches(node, '.notion-app-inner,main.notion-frame,html,body')) add('application', node.localName === 'main' ? 'main-frame' : 'layout', 'layout element or component class');
    if (request.kind === 'tab-bar') add('desktop-tab-bar', attributes['aria-labelledby'] ? 'tab' : 'content', 'separate desktop Tab Bar renderer');
    if (has('.notion-sidebar-container')) add('sidebar', attributes.role || 'content', 'sidebar ancestor');
    if (has('.notion-topbar,header')) add('page-header', attributes.role || 'content', 'header ancestor');
    if (has('.notion-page-content')) add('editor', attributes.contenteditable === 'true' ? 'editable' : 'content', 'page-content ancestor');
    for (const name of classes.filter(c => /^notion-.*-block$/.test(c))) add('block-types', name, 'block wrapper class; not a unique block count');
    if (has('.notion-collection-view-body,.notion-table-view,.notion-list-view,.notion-gallery-view,[role="grid"],[role="table"]')) {
      const kind = classes.find(c => /^notion-(?:table|list|gallery|board|calendar|timeline|chart)-view/.test(c)) || attributes.role || 'content';
      add('databases', kind, 'collection/view component or grid/table role');
    }
    if (classes.some(c => /^notion-collection-(?:filter|sort|edit-view|view-tab)/.test(c))) add('databases', classes.find(c => c.startsWith('notion-collection-')), 'database control class');
    if (node.localName === 'button' || attributes.role === 'button') add('buttons', attributes['aria-label'] || 'unlabeled-control', 'button element or button role');
    if (['svg', 'path', 'use'].includes(node.localName)) add('icons', 'svg', 'SVG structure; may also be artwork', 'heuristic');
    if (node.localName === 'img') add('icons', 'image', 'image structure; may be page content', 'heuristic');
    if (computed['mask-image'] !== 'none' || computed['-webkit-mask-image'] !== 'none') add('icons', /gradient/.test(computed['mask-image']) ? 'fade-mask' : 'masked-paint', 'computed mask; not necessarily an icon', 'heuristic');
    if (['menu', 'menubar', 'menuitem', 'listbox', 'option', 'combobox'].includes(attributes.role)) add('menus', attributes.role, 'ARIA role');
    if (['dialog', 'alertdialog'].includes(attributes.role)) add('dialogs', attributes['aria-modal'] === 'true' ? 'modal' : 'dialog-or-popover', 'ARIA role; size/purpose not inferred');
    if (attributes.role === 'toolbar' || classes.some(c => c.includes('toolbar'))) add('toolbars', attributes.role || 'toolbar-class', 'role or component-name heuristic', attributes.role ? 'observed-hook' : 'heuristic');
    if (['search', 'searchbox'].includes(attributes.role) || attributes.type === 'search') add('search', 'search-control', 'search role or input type');
    else if (['Search', 'Search or ask'].includes(attributes['aria-label'])) add('search', 'trigger', 'allowlisted UI label; panel not inferred', 'heuristic');
    if (attributes.role === 'tooltip') add('tooltips-notifications', 'tooltip', 'ARIA role; exposure recorded separately');
    if (['status', 'alert', 'log'].includes(attributes.role)) add('tooltips-notifications', 'accessibility-live-region', 'ARIA role; not evidence of a visible toast');
    return result;
  }
  const nativeVariables = new Set(knownVariables);
  const elements = nodes.map((node, i) => {
    const style = getComputedStyle(node), computed = readStyle(style), attributes = privacy.attributes(node), classes = privacy.classes(node);
    const rect = node.getBoundingClientRect();
    let parent = node.parentElement; while (parent && !ids.has(parent)) parent = parent.parentElement;
    const states = {
      hover: safeMatches(node, ':hover'), selected: attributes['aria-selected'] === 'true' || safeMatches(node, 'option:checked'),
      active: safeMatches(node, ':active'), focused: safeMatches(node, ':focus'), focusVisible: safeMatches(node, ':focus-visible'),
      disabled: safeMatches(node, ':disabled') || attributes['aria-disabled'] === 'true',
      checked: safeMatches(node, ':checked') || ['true', 'mixed'].includes(attributes['aria-checked']), expanded: attributes['aria-expanded'] === 'true',
    };
    states.default = !Object.values(states).some(Boolean);
    const usage = [];
    for (const name of Array.from(node.style)) {
      if (!properties.includes(name) && !name.startsWith('--')) continue;
      for (const variable of privacy.references(node.style.getPropertyValue(name))) {
        const property = properties.includes(name) ? name : 'local-custom-property';
        usage.push({ variable, property }); nativeVariables.add(variable);
        const key = variable + ':' + property;
        variableUsage.set(key, { variable, property, count: (variableUsage.get(key)?.count || 0) + 1, source: 'inline declaration reference' });
      }
    }
    const scopeRoot = safeMatches(node, 'html,.notion-app-inner,.notion-page-content,.notion-overlay-container,.root');
    const names = new Set([...knownVariables, ...usage.map(u => u.variable)]);
    if (scopeRoot) for (const name of Array.from(style)) if (privacy.variableName(name) && /bac|tex|ico|bor|sha|foc|glow|accent|radius/i.test(name)) { if (names.size < 300) names.add(name); }
    const variables = {};
    for (const name of names) { const value = privacy.variable(style.getPropertyValue(name)); if (value !== null) { variables[name] = value; nativeVariables.add(name); } }
    const pseudo = {};
    if (!['path', 'use', 'svg'].includes(node.localName)) {
      for (const name of ['::before', '::after', '::marker', '::placeholder', '::selection']) {
        if (name === '::placeholder' && !['input', 'textarea'].includes(node.localName)) continue;
        const ps = getComputedStyle(node, name);
        const generated = !['none', 'normal', ''].includes(ps.content);
        const exposed = name === '::placeholder' ? safeMatches(node, ':placeholder-shown') : name === '::marker' ? computed.display === 'list-item' : name === '::selection' ? !!(window.getSelection()?.rangeCount && !window.getSelection().isCollapsed && window.getSelection().containsNode(node, true)) : generated;
        if (generated || exposed) pseudo[name] = { exposed, hasGeneratedContent: generated, style: tableId(readStyle(ps), styleTable, styleKeys, 'p') };
      }
    }
    const memberships = classify(node, computed, attributes, classes);
    const id = ids.get(node);
    for (const membership of memberships) {
      const key = membership.category + ':' + membership.kind;
      if (!groups.has(key)) groups.set(key, { ...membership, elements: [] });
      groups.get(key).elements.push(id);
    }
    let checkVisibility = null;
    try { if (node.checkVisibility) checkVisibility = node.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }); } catch { /* Older renderers: keep the explicit measurements. */ }
    return { id, parent: ids.get(parent) || null, childCount: node.children.length, tag: node.localName, classes, attributes,
      rect: [rect.x, rect.y, rect.width, rect.height].map(n => Math.round(n * 10) / 10),
      visibility: { renderedBox: rect.width > 0 && rect.height > 0 && computed.display !== 'none', inViewport: rect.bottom > 0 && rect.right > 0 && rect.top < innerHeight && rect.left < innerWidth, checkVisibility, opacity: computed.opacity, visibility: computed.visibility, clipping: computed.clip !== 'auto' || computed['clip-path'] !== 'none' },
      style: tableId(computed, styleTable, styleKeys, 'p'), variables: tableId(variables, variableProfiles, variableKeys, 'v'), inline: inline(node), states, pseudo,
      // The DOM ordinal is transient and stripped locally; never a saved DOM identifier.
      ordinal: all.indexOf(node), signature: { tag: node.localName, role: attributes.role || null, classes } };
  });
  const matrix = request.selectors.map(rule => {
    const result = { id: rule.id, valid: CSS.supports(`selector(${rule.selector})`), status: 'no-matches-in-captured-state', count: 0, renderedCount: 0, elements: [], elementTypes: {}, conditions: [] };
    for (const condition of rule.conditions) {
      let applicable = null;
      try { if (condition.startsWith('@media ')) applicable = matchMedia(condition.slice(7)).matches; else if (condition.startsWith('@supports ')) applicable = CSS.supports(condition.slice(10)); else if (condition.startsWith('@layer')) applicable = true; } catch { /* Keep condition explicitly unverified. */ }
      result.conditions.push({ condition, applicable });
    }
    if (!result.valid) { result.status = 'invalid-or-unsupported-selector'; return result; }
    const pseudo = rule.selector.match(/::(before|after|marker|placeholder|selection)$/);
    if (/::/.test(rule.selector) && !pseudo) { result.status = 'unverified-pseudo-element'; return result; }
    try {
      const selector = pseudo ? rule.selector.slice(0, -pseudo[0].length) || '*' : rule.selector;
      let matched = Array.from(document.querySelectorAll(selector));
      if (pseudo) matched = matched.filter(n => elements.find(e => e.id === ids.get(n))?.pseudo[pseudo[0]]?.exposed);
      result.count = matched.length;
      for (const node of matched) {
        const id = ids.get(node), item = id && elements[Number(id.slice(1)) - 1];
        if (item?.visibility.renderedBox && item.visibility.checkVisibility !== false) result.renderedCount++;
        if (id) result.elements.push(id);
        const key = node.localName; result.elementTypes[key] = (result.elementTypes[key] || 0) + 1;
      }
      if (matched.length) result.status = 'confirmed-match';
      if (result.conditions.some(c => c.applicable === false)) result.status = 'matches-in-inactive-condition';
      if (result.conditions.some(c => c.applicable === null)) result.conditionLimitation = 'Container/scope/other conditions are not evaluated; matches are structural only.';
    } catch { result.valid = false; result.status = 'invalid-or-unsupported-selector'; }
    return result;
  });
  const interactive = elements.filter(e => ['button', 'input', 'textarea', 'select', 'option', 'a'].includes(e.tag) || e.attributes.role || e.attributes.contenteditable === 'true');
  const stateSummary = Object.fromEntries(['default', 'hover', 'selected', 'active', 'focused', 'disabled', 'checked', 'expanded'].map(state => [state, { observed: interactive.some(e => e.states[state]), count: interactive.filter(e => e.states[state]).length, evidence: 'actual native pseudo-state or semantic state attribute on captured controls; default means no other recorded state' }]));
  return { readyState: document.readyState, viewport: [innerWidth, innerHeight], totalElements: all.length, capturedElements: elements.length, truncated: nodes.length < all.filter(n => !skipped.has(n.localName)).length,
    iframeCount: document.querySelectorAll('iframe').length, openShadowRootCount: all.filter(n => n.shadowRoot).length,
    themeStyleElements: ['ectoplasma-notion-theme', 'spooklucence-notion-theme'].filter(id => document.getElementById(id)),
    elements, styles: styleTable, variableProfiles, variableUsage: [...variableUsage.values()], variableNames: [...nativeVariables], components: [...groups.values()], stateSummary, selectors: matrix };
}

// Theme selector analysis
// Small scanner for compiled CSS, not a second CSS compiler. Unknown constructs
// remain explicitly unverified; validity/matching is checked by Chromium.
function splitTopLevel(text, separator = ',') {
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

function readSelectors(css) {
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

function specificity(selector) {
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

function risks(selector) {
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

// Declaration samples
const paint = new Set(['background', 'background-color', 'background-image', 'color', 'fill', 'stroke', 'filter', 'opacity', 'text-shadow', 'box-shadow', 'outline', 'outline-color', 'outline-style', 'border', 'border-color', 'border-top-color', 'font-size', 'font-weight']);

function summarizeDeclarations(matched) {
  const properties = {}, usage = [];
  function add(style, source, depth = 0) {
    if (!style) return;
    const seen = new Set();
    for (const property of style.cssProperties || []) {
      if (!paint.has(property.name) || property.disabled || property.parsedOk === false || seen.has(property.name)) continue;
      seen.add(property.name);
      (properties[property.name] ||= []).push({ source, ancestorDepth: depth, important: !!property.important });
      for (const name of privacy.references(property.value || '')) usage.push({ name, property: property.name, source, ancestorDepth: depth });
    }
  }
  add(matched.inlineStyle, 'inline'); add(matched.attributesStyle, 'presentation-attribute');
  for (const item of matched.matchedCSSRules || []) add(item.rule.style, item.rule.origin === 'user-agent' ? 'user-agent-rule' : 'author-rule');
  for (const [i, ancestor] of (matched.inherited || []).entries()) {
    add(ancestor.inlineStyle, 'ancestor-inline', i + 1);
    for (const item of ancestor.matchedCSSRules || []) add(item.rule.style, 'ancestor-rule', i + 1);
  }
  return { properties, variableReferences: usage, inheritableProperties: ['color', 'fill', 'stroke', 'text-shadow', 'font-size', 'font-weight'],
    interpretation: 'Declaration candidates, not computed winners. Only inheritable properties can inherit; ancestor backgrounds paint behind transparent descendants. CSS rule text, source URLs and generated selectors are omitted.' };
}

async function traceSamples(client, capture, maximum) {
  if (!maximum) return [];
  const candidates = [];
  const seen = new Set();
  for (const group of capture.components) {
    if (seen.has(group.category)) continue;
    const element = capture.elements.find(e => group.elements.includes(e.id) && !['html', 'body'].includes(e.tag));
    if (element) { candidates.push(element); seen.add(group.category); }
  }
  const result = [];
  try {
    await client.send('DOM.enable'); await client.send('CSS.enable');
    await client.send('DOM.getDocument', { depth: 0 });
    for (const element of candidates.slice(0, maximum)) {
      try {
        const signature = element.signature;
        const expression = `(() => { const n = document.querySelectorAll('*')[${element.ordinal}]; return n && n.localName === ${JSON.stringify(signature.tag)} && n.getAttribute('role') === ${JSON.stringify(signature.role)} ? n : null; })()`;
        const remote = await client.send('Runtime.evaluate', { expression, objectGroup: 'ectoplasma-inspector', silent: true, allowUnsafeEvalBlockedByCSP: false });
        if (!remote.result?.objectId || remote.exceptionDetails) { result.push({ element: element.id, status: 'element-changed-or-unavailable' }); continue; }
        const { nodeId } = await client.send('DOM.requestNode', { objectId: remote.result.objectId });
        if (!nodeId) { result.push({ element: element.id, status: 'element-changed-or-unavailable' }); continue; }
        const matched = await client.send('CSS.getMatchedStylesForNode', { nodeId });
        result.push({ element: element.id, status: 'sampled', ...summarizeDeclarations(matched) });
      } catch { result.push({ element: element.id, status: 'source-diagnostics-unavailable' }); }
    }
  } catch { result.push({ status: 'source-diagnostics-unavailable' }); }
  finally {
    await client.send('Runtime.releaseObjectGroup', { objectGroup: 'ectoplasma-inspector' }).catch(() => {});
    await client.send('CSS.disable').catch(() => {}); await client.send('DOM.disable').catch(() => {});
  }
  return result;
}

// Reports
const states = ['default', 'hover', 'selected', 'active', 'focused', 'disabled', 'checked', 'expanded'];
const categories = ['application', 'sidebar', 'page-header', 'desktop-tab-bar', 'editor', 'block-types', 'databases', 'buttons', 'icons', 'menus', 'dialogs', 'toolbars', 'search', 'tooltips-notifications'];
const escape = value => String(value).replaceAll('|', '\\|').replaceAll('\n', ' ');
const variableCategories = name => Object.entries({ background: /bac/i, text: /tex/i, icon: /ico/i, border: /bor/i, interactive: /int|hov|sel|foc|act|dis/i }).filter(([, pattern]) => pattern.test(name)).map(([category]) => category);

function buildResults({ reference, selectors, parserLimitations, captures, context, maxElements, samples, port, timestamp }) {
  const successful = captures.filter(c => c.status === 'captured');
  const aggregateStates = Object.fromEntries(states.map(state => [state, {
    observed: successful.some(c => c.data.stateSummary[state].observed),
    renderers: successful.filter(c => c.data.stateSummary[state].observed).map(c => c.renderer),
    limitation: 'Observation applies only to exposed controls in this snapshot; it does not test this state for every component.',
  }]));
  const matrix = { schemaVersion: 1, reference, limitations: parserLimitations, selectors: selectors.map(selector => ({ ...selector,
    selector: privacy.selector(selector.selector), selectorRedacted: privacy.selector(selector.selector) !== selector.selector, conditions: selector.conditions.map(privacy.css),
    captures: captures.map(c => {
      if (c.status !== 'captured') return { renderer: c.renderer, kind: c.kind, status: 'renderer-unavailable', valid: null };
      const result = c.data.selectors.find(s => s.id === selector.id);
      return { renderer: c.renderer, kind: c.kind, ...result, conditions: result.conditions.map(v => ({ ...v, condition: privacy.css(v.condition) })) };
    }),
  })) };
  const nativeVariables = new Map();
  const inventory = { schemaVersion: 1, renderers: successful.map(c => {
    for (const profile of c.data.variableProfiles) for (const [name, value] of Object.entries(profile.values)) {
      if (!/^--(?:c-|ca-)/.test(name)) continue;
      if (!nativeVariables.has(name)) nativeVariables.set(name, { name, categories: variableCategories(name), categoryConfidence: 'name-based heuristic', scopes: [], usage: [] });
      const scopes = nativeVariables.get(name).scopes;
      let scope = scopes.find(s => s.renderer === c.renderer && s.value === value);
      if (!scope) { scope = { renderer: c.renderer, value, profiles: [] }; scopes.push(scope); }
      scope.profiles.push(profile.id);
    }
    for (const use of c.data.variableUsage) nativeVariables.get(use.variable)?.usage.push({ renderer: c.renderer, ...use });
    for (const trace of c.provenance) for (const use of trace.variableReferences || []) nativeVariables.get(use.name)?.usage.push({ renderer: c.renderer, element: trace.element, ...use });
    const { elements, styles, variableProfiles, components } = c.data;
    const styleDefaults = {};
    for (const name of new Set(styles.flatMap(s => Object.keys(s.values)))) {
      const counts = new Map();
      for (const style of styles) if (name in style.values) counts.set(style.values[name], (counts.get(style.values[name]) || 0) + 1);
      styleDefaults[name] = [...counts].sort((a, b) => b[1] - a[1])[0][0];
    }
    const direct = new Set(c.data.selectors.filter(s => ['confirmed-match', 'matches-in-inactive-condition'].includes(s.status) && selectors.find(r => r.id === s.id).properties.some(p => !p.startsWith('--')) && !s.conditions.some(x => x.applicable === false)).flatMap(s => s.elements));
    return { renderer: c.renderer, kind: c.kind,
      elements: elements.map(({ ordinal, signature, ...element }) => ({ ...element,
        states: Object.entries(element.states).filter(([, observed]) => observed).map(([state]) => state),
        ...(Object.keys(element.inline).length ? {} : { inline: undefined }),
        ...(Object.keys(element.pseudo).length ? {} : { pseudo: undefined }),
      })), styleDefaults,
      styles: styles.map(style => ({ id: style.id, values: Object.fromEntries(Object.entries(style.values).filter(([name, value]) => value !== styleDefaults[name])) })), variableProfiles,
      components: components.map(component => {
        return { ...component, elementCount: component.elements.length, directThemeMatches: component.elements.filter(id => direct.has(id)).length };
      }), provenance: c.provenance };
  }), nativeVariables: [] };
  inventory.nativeVariables = [...nativeVariables.values()];
  const discovered = new Set(inventory.renderers.flatMap(r => r.components.map(c => c.category)));
  const metadata = { schemaVersion: 1, capturedAt: timestamp, captureContext: context, contextIsUserAnnotation: true, reference, cdp: { host: '127.0.0.1', port },
    limits: { maxElementsPerRenderer: maxElements, declarationSamplesPerRenderer: samples, customPropertiesPerRoot: 300 },
    renderers: captures.map(c => ({ renderer: c.renderer, kind: c.kind, startedAt: c.startedAt, finishedAt: c.finishedAt, status: c.status, ...(c.status === 'captured' ? { readyState: c.data.readyState, viewport: c.data.viewport, totalElements: c.data.totalElements, capturedElements: c.data.capturedElements, truncated: c.data.truncated, iframeCount: c.data.iframeCount, openShadowRootCount: c.data.openShadowRootCount, themeStyleElements: c.data.themeStyleElements, stateSummary: c.data.stateSummary } : { reason: c.reason }) })),
    stateSummary: aggregateStates, unobservedStates: states.filter(s => !aggregateStates[s].observed), unobservedGroups: categories.filter(c => !discovered.has(c)),
    unobservedVariants: [
      ...(!inventory.renderers.some(r => r.components.some(c => c.category === 'search' && c.kind === 'search-control')) ? ['search input/results (a search trigger alone is insufficient)'] : []),
      ...(!inventory.renderers.some(r => r.components.some(c => c.kind === 'modal')) ? ['modal semantics (ordinary dialog/popover roles are insufficient)'] : []),
      ...(!inventory.renderers.some(r => r.components.some(c => c.kind === 'tooltip')) ? ['tooltip surface'] : []),
      'visible notification/toast surfaces require manual confirmation; accessibility live regions are insufficient',
    ],
    limitations: [...parserLimitations,
      'Top-level DOM only: iframe documents and shadow-root internals are not inspected. Identity/authentication frames are not traversed.',
      'A state label is not evidence. Hover, pressed, focus, checked, selected and expanded states are observed without interaction; desktop tab selection encoded only in inline styles is not inferred.',
      'Visibility measurements do not establish occlusion or accessibility. Live regions are not classified as visible notifications.',
      'Raw computed SVG fill/stroke does not describe the final composited appearance after ancestor filters, masks and opacity.',
      'No-match does not mean broken. Counts include structural matches; actual cascade winners and visual correctness require review.',
      'Native custom-property values and inline/sampled declaration references are partial usage evidence, not a complete native stylesheet dependency graph.',
      'Custom-property values outside the paint/numeric allowlist are redacted. Raw text, input values, URLs, titles, opaque IDs and native CSS source are excluded.',
      'Samples are collected sequentially; the DOM may change between the snapshot and declaration diagnostics. Node IDs are capture-local.',
      'Inventory styles merge renderer.styleDefaults with the referenced profile.values. Element states list only positive observations. Components are overlapping role groups, not individual instances.',
      'No pseudo-state forcing, DOM/CSS injection, navigation, backend API calls, or application lifecycle operations are performed.',
    ] };
  const risky = matrix.selectors.filter(s => s.dependencies.length || s.concerns.length);
  const invalid = matrix.selectors.filter(s => s.captures.some(c => c.valid === false));
  const unmatched = matrix.selectors.filter(s => s.captures.every(c => !c.count));
  const components = categories.map(category => ({ category, groups: inventory.renderers.flatMap(r => r.components.filter(c => c.category === category).map(c => ({ renderer: r.renderer, ...c }))) }));
  const report = [
    '# Ectoplasma CSS inspection', '', `Captured: ${timestamp}. Context annotation: ${context}.`, '',
    `${successful.length}/${captures.length} relevant renderer targets captured; ${selectors.length} selector branches evaluated; ${inventory.nativeVariables.length} native paint variables observed.`,
    'This is a read-only snapshot of exposed UI. No-match and unobserved states are coverage gaps, not broken-selector findings.', '',
    '## Discovered styling roles', '', '| Role | Groups | Referenced elements | Direct theme-selector matches |', '| --- | ---: | ---: | ---: |',
    ...components.map(c => `| ${c.category} | ${c.groups.length} | ${c.groups.reduce((n, g) => n + g.elementCount, 0)} | ${c.groups.reduce((n, g) => n + g.directThemeMatches, 0)} |`), '',
    'Groups aggregate structural roles, not unique component instances. Counts overlap across groups. Direct coverage excludes custom-property-only rules; inherited effects and cascade winners are not implied.', '',
    '## Observed states', '', ...states.map(s => `- ${s}: ${aggregateStates[s].observed ? `observed in ${aggregateStates[s].renderers.join(', ')}` : 'not observed'}.`), '',
    'Default means no other recorded state on a captured control. Selected is semantic selection; active is the pointer-pressed :active pseudo-state. Expanded/checked/disabled reflect native state or ARIA evidence.', '',
    '## Selector quality', '', `${invalid.length} branches invalid or unsupported in at least one captured renderer; ${unmatched.length} branches have no matches in this capture; ${risky.length} branches have heuristic dependency/scope warnings.`, '',
    '| Selector | Specificity | Per-renderer match counts | Dependencies / review risks |', '| --- | --- | --- | --- |',
    ...matrix.selectors.map(s => `| \`${escape(s.selector)}\` | ${s.specificity ? s.specificity.join(',') : 'unverified syntax'} | ${s.captures.map(c => `${c.renderer}: ${c.count ?? c.status}`).join('; ')} | ${escape([...s.dependencies, ...s.concerns].join('; ') || 'No heuristic warning')} |`), '',
    'Specificity is computed for supported standard selector constructs, independently of browser syntax validity. Nested selectors are explicitly unverified. Inline-style state inference and overbreadth warnings are hypotheses, not automatic fixes.', '',
    '## Native variables and declaration evidence', '',
    'styling-inventory.json stores native values per renderer/profile and observed inline or sampled declaration references. Variables absent from a renderer must not be assumed available there. Their categories are name-based heuristics.',
    'Declaration samples list direct versus ancestor candidates without exporting native rule text. Matching declarations are not guaranteed winners; ancestor backgrounds are paint layers rather than inherited background properties.', '',
    '## Potential issues and next captures', '',
    ...captures.filter(c => c.status !== 'captured').map(c => `- ${c.renderer}: unavailable (${c.reason}); other renderers were inspected.`),
    ...successful.filter(c => c.data.truncated).map(c => `- ${c.renderer}: element cap reached; increase --max-elements if needed.`),
    ...successful.filter(c => c.data.themeStyleElements.length > 1).map(c => `- ${c.renderer}: multiple known theme style elements exist. This does not prove multiple loader processes or different styling; none were removed.`),
    ...metadata.unobservedStates.map(s => `- Expose ${s} on a representative control and capture again; do not infer it from another state.`),
    ...metadata.unobservedGroups.map(g => `- Expose ${g} if relevant; no matching structural group was observed.`),
    ...metadata.unobservedVariants.map(v => `- Still unverified: ${v}.`),
    '- Capture database property editors, each view layout, editor block variants, menus/search/tooltips, full modals, disabled controls, and keyboard-focus states separately. A represented group does not mean every variant was tested.',
    '- Review inline color/dimension dependencies and broad descendant selectors against matched roles. Prefer verified component/semantic scopes; do not replace desktop button-like tabs with database tab selectors.', '',
    '## Limits and privacy', '', ...metadata.limitations.map(l => `- ${l}`), '',
  ].join('\n');
  return { metadata, matrix, inventory, report };
}

// Command-line capture
const project = fileURLToPath(new URL('../', import.meta.url));
const contexts = new Set(['default', 'sidebar', 'editor', 'database', 'menu', 'dialog', 'search', 'tooltip', 'notification', 'hover', 'selected', 'active', 'focused', 'disabled', 'checked', 'expanded']);
function parseOptions(args) {
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

async function inspect(options) {
  const css = await readFile(path.join(project, 'dist/Ectoplasma.theme.css'), 'utf8').catch(() => { throw Error('Compiled theme missing. Run npm run build, then retry npm run inspect.'); });
  const { selectors, limitations } = readSelectors(css);
  if (!selectors.length) throw Error('No compiled theme selectors found. Run npm run build and check the CSS.');
  let targets;
  try { targets = await discoverTargets(options.port); }
  catch { throw Error('Local Notion CDP is unavailable. Start Notion manually using your existing Automator launcher (or ./start.sh), then retry npm run inspect. The inspector did not start or restart Notion.'); }
  if (!targets.length) throw Error('No eligible Notion page or desktop Tab Bar renderer is available on the local CDP endpoint. Open the relevant interface manually and retry.');
  const captures = [], timestamp = new Date().toISOString();
  for (const target of targets) {
    const startedAt = new Date().toISOString();
    let client;
    try {
      client = await connect(target);
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

async function saveResults(results) {
  const base = path.join(project, '.inspections');
  await mkdir(base, { recursive: true, mode: 0o700 });
  if ((await lstat(base)).isSymbolicLink()) throw Error('Inspection output directory must not be a symlink.');
  const directory = path.join(base, new Date().toISOString().replaceAll(':', '-') + '-' + randomUUID().slice(0, 8));
  await mkdir(directory, { mode: 0o700 });
  for (const [name, value] of [['report.md', results.report], ['selector-matrix.json', results.matrix], ['styling-inventory.json', results.inventory], ['metadata.json', results.metadata]]) {
    await writeFile(path.join(directory, name), typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  }
  return path.relative(project, directory);
}

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
