# Ectoplasma for Notion

A dark theme with electric-blue accents and glow effects for macOS Notion Desktop. This is the Notion counterpart to [Ectoplasma for Discord](https://github.com/madebyspook/Ectoplasma-Discord), built with SCSS and injected into Notion renderer processes through Chrome DevTools Protocol (CDP) on port **9222**.

Version: **0.1.0**. The repository is the source of truth: **SCSS → Sass → `dist/Ectoplasma.theme.css` → loader hot reload → Notion**. Repository-loader integration still requires manual testing in Notion; automated checks do not establish live injection or visual compatibility.

## Requirements

- macOS with Notion Desktop at `/Applications/Notion.app`.
- Notion's dark theme and standard contrast, matching the existing selectors.
- [Node.js 22.4 or newer](https://nodejs.org/api/globals.html#class-websocket). The loader uses Node's built-in `WebSocket`; it needs no npm packages.
- Automator, if you want a launcher application.

Sass and npm are only needed for development. The repository includes compiled `dist/Ectoplasma.theme.css`; there is no remote CSS import or hosting.

## Download and run

**Manual verification required before switching launchers.** Keep the working `~/Documents/NotionTheme/` installation and existing Automator application untouched.

1. Clone this repository, or choose **Code → Download ZIP** on GitHub and extract it. Keep `loader.js`, `start.sh`, and `dist/Ectoplasma.theme.css` in their repository layout. The checkout can live anywhere, including a path with spaces. Do not rename or copy the CSS to the old installation.
2. At a convenient time, stop the old loader so only one loader injects CSS. If Notion is already running without CDP, fully quit it manually first; startup flags cannot enable debugging on an existing process.
3. Run the repository's startup script, replacing the example with your actual path:

   ```sh
   /bin/bash "/absolute/path/to/Ectoplasm-Notion/start.sh"
   ```

   The script locates `loader.js` beside itself, regardless of the terminal's current directory. It starts Notion with debugging bound to `127.0.0.1:9222` if unavailable, waits for readiness, and starts the loader. The loader reads and watches `dist/Ectoplasma.theme.css` relative to its own directory.
4. Confirm `[CSS loaded]` shows the repository's `dist/Ectoplasma.theme.css`, followed by `[Connected]` and `[CSS applied]` for eligible page and Tab Bar targets. Inspect the sidebar, editor, active/inactive/hovered tabs, title fades, icons, navigation, and page header. Open another Notion tab and confirm it is styled.
5. To verify the full development loop, run `npm ci` and `npm run watch` in the repository in another terminal. Make a temporary SCSS change, confirm Sass recompiles and the loader reports CSS reload/reinjection, and inspect the result in Notion. Restore the change and verify it again. Do not edit generated CSS manually.

Stop each terminal process with Ctrl+C when finished. If verification fails, stop the repository loader and use the original launcher; restart Notion manually if styling needs to be cleared. No automated setup migrates or edits the old installation or Automator app.

## Create a separate Automator launcher

Do this only after the repository loader passes the manual checks above. Leave the existing Automator application unchanged.

1. In Automator, choose **New Document → Application** and add **Run Shell Script**. See Apple's [workflow guide](https://support.apple.com/guide/automator/create-a-workflow-aut7cac58839/mac) and [shell script guide](https://support.apple.com/guide/automator/use-a-shell-script-action-in-a-workflow-autbbd4cc11c/mac).
2. Choose `/bin/bash` and enter the following, replacing the example path:

   ```sh
   export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
   /bin/bash "/absolute/path/to/Ectoplasm-Notion/start.sh"
   ```

3. Save as a **new application**, for example `Ectoplasma Notion.app`. Stop the terminal loader, launch the new app, and repeat the connection, visual, new-tab, and reload checks.

Automator does not inherit your interactive shell setup. If Node is installed elsewhere, add its actual directory to `PATH`. The scripts need no edits after moving the checkout, but a launcher referring to its old absolute path must be updated. The launcher starts the loader; run Sass watch separately while developing.

## Development

```sh
git clone https://github.com/madebyspook/Ectoplasm-Notion.git
cd Ectoplasm-Notion
npm ci
npm run check
npm run build
npm run watch
```

Run `start.sh` in a separate terminal when ready for manual Notion testing. `npm run watch` compiles SCSS; the loader watches that output and reinjects it without a copying step.

Open the folder in VS Code using **File → Open Folder** or `code .`. **Run Build Task** runs build; **Run Task → Watch theme** starts watch. Stop it with Ctrl+C. No VS Code extensions are required. If Restricted Mode disables npm tasks, review and trust the project folder locally.

- `npm run build` generates expanded `dist/Ectoplasma.theme.css` without source maps.
- `npm run watch` builds initially and polls for SCSS changes. With `--no-error-css`, compilation errors remove the generated CSS; fixing the source recreates it. Fix build errors before checking reload behavior.
- `npm run check` runs read-only `scripts/check.mjs`: it compiles in memory, rejects missing/stale CSS, and validates theme name/version and package-lock versions. It does not test live CDP injection or Notion visuals.

Edit SCSS, then commit the rebuilt CSS with source changes. Keep `src/main.scss` metadata aligned with `themeName` and `version` in `package.json`, and update the lockfile when changing the version. Dart Sass is the only direct development dependency. Build/watch only write repository CSS; they do not launch Notion or the loader.

```text
src/main.scss                         Ordered entry point and theme metadata
src/abstracts/_variables.scss         Existing --spook-* design tokens
src/abstracts/_mixins.scss            Reserved for useful shared mixins
src/sections/                        Sidebar, editor, tabs, header, navigation
dist/Ectoplasma.theme.css             Generated, committed CSS watched by loader
loader.js                            CDP injection and CSS hot reload
start.sh                             macOS startup; resolves the loader locally
scripts/check.mjs                    Read-only output and metadata validation
.vscode/                             Build, watch, and check tasks
AGENTS.md                            Project and development instructions
```

Keep module order, selectors, variables, and visuals intact unless a change is requested. `_mixins.scss` currently emits no CSS.

## Troubleshooting

- **Notion unavailable / connection refused:** check `curl http://127.0.0.1:9222/json/version`. If unavailable, fully quit Notion manually and retry `start.sh`. Keep CDP bound to `127.0.0.1`.
- **Node missing / `WebSocket is not defined`:** check `node --version` and the launcher's `PATH`. Use Node 22.4 or newer without disabling its built-in WebSocket support.
- **Missing CSS or no reload:** run `npm run build`, inspect Sass errors, and confirm `[CSS loaded]` names this checkout's `dist/Ectoplasma.theme.css`. Run watch and the repository loader together for SCSS live preview. Stop duplicate loaders; the old Automator app still invokes the old installation.
- **Missing styling or targets:** confirm dark mode/standard contrast and inspect loader errors. Target discovery accepts `page` targets with `https://app.notion.com/` URLs or the exact title `Tab Bar`. DOM, inline-style, localization, URL, or renderer-title changes may require investigation; builds do not verify them.
- **Terminal works but Automator does not:** verify its repository path, Node directory in `PATH`, and Notion application path. Check the action's errors.

No license has been selected.
