Ectoplasma — Agent Instructions

Ectoplasma is a custom macOS Notion Desktop theme in the Ectoplasm-Notion repository, currently version 0.1.0. It uses dark surfaces, electric-blue accents, white highlighted text, and subtle neon glow. Preserve existing appearance and behavior unless explicitly requested otherwise.

Source and build

* src/main.scss is the ordered SCSS entry point; keep module order intact, including tab-bar navigation after the page header.
* src/abstracts/_variables.scss defines the existing --spook-* CSS properties. Keep the --spook-* prefix. _mixins.scss is available for genuinely reusable patterns; interface rules belong in src/sections/.
* Reuse existing variables and mixins where appropriate. Avoid unnecessary abstractions, dependencies, duplicate rules, and broad selectors.
* For appearance-preserving changes, maintain selector behavior, specificity, declaration order, and !important unless a change requires otherwise. Compare compiled CSS before and after structural refactors.
* npm ci installs dependencies; npm run build compiles SCSS to tracked dist/Ectoplasma.theme.css; npm run watch rebuilds during development. Never edit generated CSS directly. Commit generated CSS alongside source changes.
* npm run check verifies generated CSS freshness and theme/package metadata without writing files. Keep version/name metadata in src/main.scss, package.json, and the lockfile consistent.
* Sass watch uses polling. The --no-error-css option prevents Sass from writing an error stylesheet; do not assume a failed compilation deletes the existing CSS. Fix compilation errors and rebuild before testing. Build/watch do not start Notion or the loader.

Loader and macOS launcher

* The repository is the active source of truth: SCSS → Sass → dist/Ectoplasma.theme.css → loader.js → Notion. The former ~/Documents/NotionTheme/ installation is a fallback, not the active project.
* start.sh starts Notion with CDP on 127.0.0.1:9222 if the debugging endpoint is unavailable, waits for readiness, then starts Node. It resolves loader.js relative to its own location; keep path expansions quoted so checkout paths with spaces work.
* loader.js acquires scripts/loader-instance.cjs before creating watchers or CDP connections. An OS-owned localhost socket, keyed by user and canonical checkout path, elects one instance atomically; duplicates verify its identity and exit. There are no PID files or process-killing paths. A port collision with an unrelated service fails safely. Keep the guard in the loader so direct Node and Automator launches share it.
* loader.js uses Node’s built-in WebSocket, discovers /json/list targets every 2 seconds, and connects to Notion page targets (https://app.notion.com/) and the separate Tab Bar renderer.
* CSS is injected using Runtime.evaluate into the ectoplasma-notion-theme style element, creating it if absent. The test-element cleanup identifier is ectoplasma-test. Keep injection acknowledgements and their response checks consistent. Do not revert these identifiers to Spooklucence.
* The loader reads and checks dist/Ectoplasma.theme.css relative to __dirname every 500 ms and reinjects changed CSS into connected targets. For SCSS live preview, run npm run watch alongside the loader. No manual CSS copying is required.
* The existing Automator application launches the repository’s start.sh using its absolute path. Moving the checkout requires updating that path in Automator. Do not change the active Automator app or startup behavior without explicit instruction.
* If Notion is already running without CDP, fully quit it before relaunching through the themed launcher. Avoid concurrent loaders.

Notion selectors and verification

* Known targets: sidebar .notion-sidebar-container; editor main.notion-frame; page header header:has(> .notion-topbar).
* Tab bar styling uses .notion-dark-theme.notion-standard-contrast.root, .hide-scrollbar, :has(), and Notion’s inline styles. Inactive tabs use rgb(32, 32, 32), active tabs rgb(25, 25, 25), and hovered tabs a style beginning hsl(from rgb(32, 32, 32).
* Tab-title and close-button fades depend on inline gradient/dimension elements. Navigation buttons use roles and English ARIA labels such as New Tab, Close Tab, Back, Forward, and the Sidebar toggle.
* These selectors are fragile implementation details, not stable Notion APIs. Inspect the actual DOM and computed styles through CDP before adding or changing selectors; do not guess or broadly replace working selectors.
* The repository-based loader, tab-bar/page injection, new tabs, and CSS hot reload have been manually tested successfully. Automated checks alone cannot prove visual correctness. Retest affected behavior after UI, loader, or Notion updates.
* Automated tooling tests must not start/stop the user’s live Notion instance or modify the original installation. Use mocks or isolated fixtures for CDP and launcher tests.

Development and delivery

* Keep edits scoped; preserve unrelated work and editor settings. Work on descriptive feature branches; main is the default branch.
* Commit, push, or open/update PRs only when authorized. Never merge, tag, release, publish, or change repository settings without explicit permission.
* Keep installation and user-facing documentation in README.md; keep this file focused on agent-specific technical guidance. Do not add GitHub Pages, remote CSS hosting, or a license without a request.
* In handoffs, summarize files changed, checks performed, whether live Notion was tested, and any remaining manual steps.

CSS inspection utility

* `npm run inspect` runs the independent read-only inspector under scripts/inspector/ against existing local CDP. It must never start Notion, change DOM/CSS, force states, navigate, call backend APIs, or modify the loader/launcher.
* `.inspections/` contains local, Git-ignored reports. Keep renderer identities anonymous and attributes/paint values filtered; never save text, input values, URLs, page titles, opaque IDs, unrestricted labels, or native CSS source.
* `--context` is only an annotation. Preserve the distinction between observed states, no-match in the current snapshot, invalid/unsupported selectors, and heuristic risks. Source samples identify declaration candidates, not guaranteed cascade winners.
* Run `npm test` for isolated loader single-instance/lifecycle tests and inspector fixtures/privacy/protocol checks and `npm run check` for theme consistency. Use mocks or temporary fixtures for automated tests; live validation is opt-in and read-only.
