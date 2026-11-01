# Ectoplasma — Agent Instructions

Ectoplasma is the macOS Notion Desktop theme in `Ectoplasm-Notion`, currently version **0.1.0**. Its design uses dark surfaces, electric-blue accents, white highlighted text, and neon glow effects. Preserve existing visuals and behavior unless explicitly asked to change them.

## Source and validation

- `src/main.scss` is the ordered SCSS entry point. Preserve module order, including tab-bar navigation after the page header.
- `src/abstracts/_variables.scss` contains the existing `--spook-*` custom properties; `_mixins.scss` is reserved for useful shared mixins and currently emits no CSS. Interface styles belong in `src/sections/`.
- Prefer existing variables and mixins over duplicate styles. Add abstractions only when they meaningfully reduce repetition.
- Preserve selectors, variable names/values, declaration order, specificity, `!important`, and separate controls unless the requested change requires otherwise.
- Use local Dart Sass: `npm ci`, `npm run build`, `npm run watch`. Do not introduce unnecessary dependencies.
- Build generates tracked `dist/Ectoplasma.theme.css`; never hand-edit it. Commit generated CSS with source changes so installation needs no Sass.
- `npm run check` compiles in memory, detects missing/stale CSS, and checks theme name/version and package-lock versions without writing files. Keep metadata in `src/main.scss`, `package.json`, and the lockfile aligned.
- For appearance-preserving edits, compile a fresh baseline before editing and compare the rebuilt output. Automated checks do not verify Notion appearance or CDP compatibility.
- Watch uses Sass polling. Compilation errors remove the generated CSS with `--no-error-css`; fixing the source restores it. Build/watch do not install files or run the loader.

## Loader and launcher

- The repository is the source of truth: SCSS → Sass → `dist/Ectoplasma.theme.css` → loader hot reload → Notion. Keep the original `~/Documents/NotionTheme/` installation and existing Automator app untouched.
- `start.sh` launches `/Applications/Notion.app/Contents/MacOS/Notion` with CDP bound to `127.0.0.1:9222` if unavailable, polls readiness, then starts Node. It resolves `loader.js` relative to its own location, independent of checkout path and current working directory. Keep path expansions quoted for spaces.
- `loader.js` uses Node's built-in WebSocket, discovers `/json/list` every 2 seconds, and connects separately to every `page` target whose URL starts with `https://app.notion.com/` or whose title is exactly `Tab Bar`.
- Each target receives CSS through `Runtime.evaluate` into the existing `spooklucence-notion-theme` style element, created if absent. This ID and the `spooklucence-test` cleanup target intentionally retain old naming to preserve element reuse and cleanup compatibility. Use Ectoplasma for messages, and keep injection acknowledgements consistent with the response handler. Preserve these compatibility IDs and target filtering unless behavior changes are explicitly requested.
- The loader reads and watches `dist/Ectoplasma.theme.css` relative to `__dirname` every 500 ms and reinjects changed CSS into connected targets. Run Sass watch and the loader together for SCSS live preview; no CSS copying or renaming is needed.
- A separate Automator Application can use Run Shell Script to invoke the repository's `start.sh` by its quoted absolute path with Node on `PATH`. Moving the checkout requires updating that external launcher path, not the scripts. Follow the README; do not modify the active app or startup configuration as part of routine development.

## Existing selectors and limitations

- Sidebar: `.notion-sidebar-container`; editor: `main.notion-frame`; page header: `header:has(> .notion-topbar)`.
- Tab-bar surfaces and navigation use `.notion-dark-theme.notion-standard-contrast.root`, `.hide-scrollbar`, and `:has()`. Preserve the dark-theme/standard-contrast assumptions.
- Tab states match inline styles: inactive `rgb(32, 32, 32)`, active `rgb(25, 25, 25)`, and hovered `hsl(from rgb(32, 32, 32)`. Title/close-button fades also depend on inline dimensions and gradients.
- Buttons/icons depend on roles and English ARIA labels such as `New Tab`, `Close Tab`, `Back`, and `Forward`. DOM, inline-style, localization, URL, or renderer-title changes can break targeting.
- These are existing implementation assumptions, not newly verified runtime guarantees. Do not broaden or repair selectors speculatively. Notion updates, new tabs, same-target reloads, and the new launcher still require manual checks.
- Notion already running without CDP must be fully quit before a debugging-enabled launch. Avoid concurrent loaders. Manually test the repository CSS, multiple-target injection, and hot reload before switching launchers. Live injection through this repository integration remains unverified until tested in Notion.

## Development and delivery

- Keep changes scoped and maintainable; preserve unrelated work and editor settings. Use temporary fixtures and mocked CDP/launcher dependencies for tooling checks, never the active installation or live Notion targets. Automated tests must not launch or terminate Notion; do not run the real startup script against the live app during tests.
- Work on a descriptive feature branch; `main` is the default branch. For repository-loader integration, use `feat/repository-loader`.
- Commit, push, or open/update PRs only when authorized. Never merge, tag, release, publish, or change repository/hosting settings without explicit permission.
- Keep documentation concise in the README and these instructions. Do not add a license, GitHub Pages, or remote CSS hosting without an explicit request.
- Handoff should name changes and checks, distinguish automated validation from Notion testing, and identify any remaining installation/launcher steps.
