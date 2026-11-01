// Serialized into the renderer as well as used by the local report writer.
// Never return unrestricted runtime strings, text, IDs, URLs, or style content.
export function createPrivacy() {
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
