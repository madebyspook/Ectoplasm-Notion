import { createPrivacy } from './privacy.mjs';
const privacy = createPrivacy();
const paint = new Set(['background', 'background-color', 'background-image', 'color', 'fill', 'stroke', 'filter', 'opacity', 'text-shadow', 'box-shadow', 'outline', 'outline-color', 'outline-style', 'border', 'border-color', 'border-top-color', 'font-size', 'font-weight']);

export function summarizeDeclarations(matched) {
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

export async function traceSamples(client, capture, maximum) {
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
