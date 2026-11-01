// Executed as a fixed read-only expression in the existing renderer. This does
// not create stylesheets, listeners, observers, globals, or DOM nodes.
export function captureDocument(request, privacy) {
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
