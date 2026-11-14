# Ectoplasma — Agent Instructions

Ectoplasma is a custom macOS Notion Desktop theme. Preserve existing appearance and behavior unless explicitly requested otherwise.

## Architecture & Styling

- `src/main.scss` is the ordered SCSS entry point. Keep design tokens and native mappings before component styles, and the desktop Tab Bar module separate.
- Define `--spook-*` design tokens in `src/abstracts/_variables.scss`, application-wide Notion mappings in `_native-variables.scss`, and component styles in `src/sections/`.
- Prefer existing tokens, verified native Notion mappings, then narrowly scoped selectors. Keep semantically distinct tokens separate, even when their values match.
- Shared palette IDs and the colored-text selector live in `src/abstracts/_colors.scss`. Use three-character palette suffixes; preserve native channel exceptions and full icon filenames.
- Keep component base styles and interaction states together.
- Database buttons use only `db-hover-button` or `db-frame-button`; apply non-button hover surfaces directly with `--spook-bg-interact`.
- Inspect the actual DOM and computed styles via CDP before modifying unfamiliar selectors. Never guess native variable names.
- The Tab Bar uses a separate renderer. Preserve selector specificity, declaration order, and `!important` unless a verified change requires otherwise.

## Build & Runtime

- `npm ci` installs dependencies; `npm run build` generates tracked `dist/Ectoplasma.theme.css`; `npm run watch` rebuilds during development.
- Never edit generated CSS directly. Regenerate and include compiled output with source changes.
- Keep version and name metadata synchronized across `src/main.scss`, `package.json`, and `package-lock.json`. Rebuild and validate after version changes.
- `start.sh` launches Notion with CDP and starts `loader.js`, which injects compiled CSS into Notion and Tab Bar renderers with hot reload. Build/watch do not launch Notion.
- `loader.js` owns single-instance protection, logging, CSS watching, and reconnection; `scripts/injector.cjs` owns CDP target discovery and document injection. Keep these responsibilities straightforward without adding helper layers.
- Preserve loader single-instance protection, target discovery, injection, and reload behavior.
- Preserve the existing Automator launcher and startup behavior unless explicitly instructed otherwise. Avoid concurrent loaders; fully quit Notion before relaunching with CDP if necessary.

## Inspection & Validation

- `npm run inspect` is read-only. It must not start or stop Notion, navigate, modify DOM/CSS, force interaction states, or call backend APIs.
- Keep `.inspections/` reports local and Git-ignored. Never save page text, input values, URLs, page titles, opaque IDs, unrestricted labels, or native CSS source.
- Distinguish verified observations from heuristics and no-match results.
- For styling changes and SCSS refactoring, run only `npm run build` to verify successful compilation.
- For JavaScript changes, run `node --check` on modified files; for shell changes, use `bash -n`. Run `npm run build` after build-tooling changes.
- There is no automated test suite or `npm run check`. Do not add test infrastructure or dependencies unless requested.
- Ask before performing live Notion operations. Syntax checks and compilation do not establish runtime correctness.
- Run validation once after completing changes, rather than repeatedly during development.
- Leave visual verification to the user; compilation does not establish visual correctness.
- For appearance-preserving refactors, compare compiled CSS before and after, including selectors, specificity, declarations, priorities, and cascade order.

## Documentation & Handoff

- Keep installation and user-facing guidance in `README.md`.
- Avoid introducing dependencies, hosting, licensing, or unrelated infrastructure without a task-specific need.
- When completing tasks, report whether live Notion was inspected or visually verified, distinguishing those results from automated checks.
