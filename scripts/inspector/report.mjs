import { createPrivacy } from './privacy.mjs';
const privacy = createPrivacy();
const states = ['default', 'hover', 'selected', 'active', 'focused', 'disabled', 'checked', 'expanded'];
const categories = ['application', 'sidebar', 'page-header', 'desktop-tab-bar', 'editor', 'block-types', 'databases', 'buttons', 'icons', 'menus', 'dialogs', 'toolbars', 'search', 'tooltips-notifications'];
const escape = value => String(value).replaceAll('|', '\\|').replaceAll('\n', ' ');
const variableCategories = name => Object.entries({ background: /bac/i, text: /tex/i, icon: /ico/i, border: /bor/i, interactive: /int|hov|sel|foc|act|dis/i }).filter(([, pattern]) => pattern.test(name)).map(([category]) => category);

export function buildResults({ reference, selectors, parserLimitations, captures, context, maxElements, samples, port, timestamp }) {
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
