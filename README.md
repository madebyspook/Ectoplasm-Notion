# Ectoplasma for Notion

A dark theme with electric-blue accents and glow effects for macOS Notion Desktop. This is the Notion counterpart to [Ectoplasma for Discord](https://github.com/madebyspook/Ectoplasma-Discord), built with SCSS and injected into Notion renderer processes through Chrome DevTools Protocol (CDP) on port **9222**.

Version: **0.1.0**. The migration preserves the existing CSS selectors, values, priorities, and rule order. It has not yet been visually verified in Notion.

## Requirements

- macOS with Notion Desktop at `/Applications/Notion.app`.
- Notion's dark theme and standard contrast, matching the existing selectors.
- [Node.js 22.4 or newer](https://nodejs.org/api/globals.html#class-websocket). The loader uses Node's built-in `WebSocket`; it needs no npm packages.
- Automator, if you want a launcher application.

Sass and npm are only needed for development. Installation uses the committed `dist/Ectoplasma.theme.css`; there is no remote CSS import or hosting.

## Migration status

The original CSS has been migrated into SCSS modules and verified against a fresh compiled baseline; no duplicate CSS backup is kept. Root `loader.js` and `start.sh` retain the original script contents and paths:

- `loader.js` watches `Spooklucence-Notion.css` beside itself, connects to eligible Notion page and Tab Bar targets, scans for new targets every two seconds, and checks CSS changes every 500 ms.
- `start.sh` still points to `~/Documents/NotionTheme/loader.js`. **Running the repository's `start.sh` uses the old installation.** It does not load the new compiled CSS.

The existing installation and Automator application remain the active setup. Building or watching this project only writes to `dist/`; it does not install CSS or start Notion. Unrelated files from the original installation are not included.

## Download and install

**Intended process — verify in Notion before switching your launcher.** While the setup pull request is open, select `feat/initial-theme-setup` on GitHub before choosing **Code → Download ZIP**. After merging, download from `main`. No release asset is required.

1. Extract the ZIP. Create a separate installation folder, such as `~/Documents/EctoplasmaNotion`. Keep `~/Documents/NotionTheme/` untouched.
2. Copy the root `loader.js` and `start.sh` into that separate folder.
3. Copy `dist/Ectoplasma.theme.css` into the same folder **as `Spooklucence-Notion.css`**. This compatibility filename lets the unchanged loader read the newly compiled theme.
4. In the **new copy** of `start.sh` only, change the `LOADER` line to `LOADER="$HOME/Documents/EctoplasmaNotion/loader.js"`. Leave the working installation's script unchanged.
5. At a convenient time, stop the existing loader so only one loader is active. If Notion is already running without CDP, fully quit it first; the startup script cannot add debugging flags to an existing process. Then test the separate installation in Terminal:

   ```sh
   /bin/bash "$HOME/Documents/EctoplasmaNotion/start.sh"
   ```

6. Confirm `[Connected]` and `[CSS applied]` messages. Inspect the sidebar, editor, inactive/active/hovered tabs, title fades, icons, navigation buttons, and page header. Open another Notion tab and confirm it is styled. Save a harmless CSS comment in the **separate installed CSS** and confirm `[CSS loaded]` and reinjection messages to test live reloading.
7. Stop the test loader with Ctrl+C. Until those checks pass, continue using your original launcher. After verification, create a separate Automator launcher as described below.

To update this separate installation later, replace only its `Spooklucence-Notion.css` with the latest compiled `dist/Ectoplasma.theme.css`. The loader watches that installed copy. To return to the old setup, stop the new loader and launch the original app; restart Notion if old styling needs to be cleared.

## Create an Automator launcher

These steps apply to the separate installation above and still need a launch test after migration. Do not edit or overwrite the existing Automator application.

1. Open Automator, choose **New Document → Application**, and add **Run Shell Script**. See Apple's [workflow guide](https://support.apple.com/guide/automator/create-a-workflow-aut7cac58839/mac) and [shell script guide](https://support.apple.com/guide/automator/use-a-shell-script-action-in-a-workflow-autbbd4cc11c/mac).
2. Choose `/bin/bash` as the shell and enter:

   ```sh
   export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
   /bin/bash "$HOME/Documents/EctoplasmaNotion/start.sh"
   ```

3. Save as a **new application**, for example `Ectoplasma Notion.app`.
4. Stop any test loader, launch the new app, and repeat the connection, visual, new-tab, and live-reload checks. Automator does not inherit your interactive shell setup. If Node is installed elsewhere, add its actual directory to `PATH` and retest.

## Development

```sh
git clone https://github.com/madebyspook/Ectoplasm-Notion.git
cd Ectoplasm-Notion
# While the initial PR is open:
git switch feat/initial-theme-setup
npm ci
npm run build
npm run check
npm run watch
```

Open the folder in VS Code with **File → Open Folder**, or `code .` if its CLI is installed. **Run Build Task** runs `npm run build`; **Run Task → Watch theme** starts the watcher. Stop it with Ctrl+C in the task terminal. No VS Code extensions are required. If VS Code opens in Restricted Mode, review and trust this project folder to enable npm tasks.

- `npm run build` compiles expanded CSS to `dist/Ectoplasma.theme.css` without source maps.
- `npm run watch` performs an initial build and rebuilds after SCSS changes using Sass polling. Compilation errors are reported without emitting an error page. Sass removes the generated CSS on an error and recreates it after the next successful compilation; fix the error before copying output to a test installation.
- `npm run check` runs `scripts/check.mjs`: it compiles SCSS in memory, fails on missing/stale generated CSS, verifies the theme name/version against `package.json`, and checks both lockfile version fields. It writes no files and catches consistency errors that build alone does not; it does not validate Notion visuals, CDP injection, or live reload.

Edit SCSS rather than generated CSS, then commit the rebuilt `dist/Ectoplasma.theme.css` with source changes. Keep the metadata comment in `src/main.scss` aligned with `themeName` and `version` in `package.json`, and update the lockfile when changing the package version. Dart Sass is the only direct development dependency.

```text
src/main.scss                         Ordered entry point and theme metadata
src/abstracts/_variables.scss         Existing --spook-* design tokens
src/abstracts/_mixins.scss            Reserved for useful shared mixins
src/sections/_sidebar.scss            Sidebar
src/sections/_editor.scss             Main editor
src/sections/_tab-bar.scss            Tabs, fades, buttons, and icons
src/sections/_page-header.scss        Page header
src/sections/_tab-bar-navigation.scss Final navigation rule, in original order
dist/Ectoplasma.theme.css             Generated, committed installation CSS
loader.js                            CDP injection and CSS reload script
start.sh                             macOS startup script (original loader path)
AGENTS.md                            Project and development instructions
scripts/check.mjs                    Read-only output and metadata check
.vscode/                             Build, watch, and check tasks
```

The mixins file emits no CSS yet; the migration does not invent abstractions. Keep the entry-point order. For development preview, deliberately copy rebuilt CSS to your separate test installation under the legacy filename. The copied loader does not watch `dist/`, and the Sass watcher does not deploy files.

## Troubleshooting

- **Notion unavailable / connection refused:** check `curl http://127.0.0.1:9222/json/version`. If it fails, fully quit Notion and retry the separate startup script. Keep debugging bound to `127.0.0.1` as in the supplied script.
- **Node missing / `WebSocket is not defined`:** check `node --version` and the launcher's `PATH`. Use Node 22.4 or newer without disabling its built-in WebSocket support.
- **CSS file missing or no updates:** the unchanged loader expects `Spooklucence-Notion.css` beside `loader.js`. Confirm you copied the compiled output under that name and are running the intended loader. SCSS saves require rebuilding and copying the output to the separate installation.
- **Unexpected or missing styling:** confirm dark mode and standard contrast, inspect loader errors, and stop duplicate loaders. Notion updates can change the DOM, inline styles, or CDP behavior. Automated builds do not verify those assumptions; retest the interface before changing selectors.
- **Terminal works but Automator does not:** verify the new script's absolute loader path, Node directory in `PATH`, and Notion application path. Check the Automator action's errors.

No license has been selected.
