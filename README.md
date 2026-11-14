# Ectoplasma for Notion

A dark theme for **Notion Desktop on macOS**, with electric-blue accents, subtle neon glow, and customized styling for the sidebar, editor, databases, overlays, page icons, and desktop tab bar.

Ectoplasma uses SCSS compiled to CSS and a local loader that applies the theme through Chrome DevTools Protocol (CDP). No remote stylesheet or hosting is required.

## Requirements

- macOS with Notion Desktop installed at `/Applications/Notion.app`.
- Notion set to **Dark** appearance and **Standard** contrast.
- [Node.js 22.4 or newer](https://nodejs.org/).

## Install and launch

1. [Download the repository](https://github.com/madebyspook/Ectoplasm-Notion) using **Code → Download ZIP** (then extract it), or clone it with Git.
2. Quit Notion completely before the first launch.
3. Open Terminal and run the startup script, replacing the example path with the location of your extracted repository:

   ```sh
   /bin/bash "/absolute/path/to/Ectoplasm-Notion/start.sh"
   ```

4. Notion should open with Ectoplasma applied. Keep the loader process running while using the theme. Stop it with **Ctrl+C** in Terminal.

The launcher starts Notion with local debugging enabled and injects the included `dist/Ectoplasma.theme.css` into existing tabs and the desktop Tab Bar. The loader uses CDP target and document events to apply the theme to new tabs, reloads, and navigation without reloading pages itself. It does not modify the Notion application files. If Notion was already running, quit it fully and try again.

### Optional: Launch as a macOS app

To avoid entering the command each time, create an Automator application:

1. Open **Automator** → **New Document** → **Application**.
2. Add **Run Shell Script**, choose `/bin/bash`, and enter:

   ```sh
   export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
   /bin/bash "{PATH_TO_REPOSITORY}/start.sh"
   ```

3. Replace `{PATH_TO_REPOSITORY}` with the absolute path to your extracted or cloned Ectoplasm-Notion folder (without a trailing slash), then save the application.

If Node.js is installed outside the directories listed in `PATH`, add its directory to the script.

### Loader diagnostics and recovery

Startup, shutdown, connection attempts, disconnects, and errors are recorded as timestamped JSON lines in `.logs/loader.log` inside this checkout. Each entry includes the process ID; failures include error codes and stack locations, and disconnects include available WebSocket close codes. The file rotates at 1 MiB with one backup (`loader.log.1`); both are Git-ignored. Logs exclude page content, target titles, URLs, and CDP payloads. If logging fails, check the directory permissions shown in stderr. Very early failures (such as a missing Node executable) appear in the launching Terminal or Automator's error output.

```sh
tail -n 50 .logs/loader.log
```

Transient disconnections keep the same loader and single-instance guard alive. CSS still updates through filesystem events; targets and documents still use CDP events. Reconnection attempts happen only while disconnected, with no periodic CSS verification. SIGINT, SIGTERM, and SIGHUP are logged and shut down cleanly. Unexpected JavaScript errors and watcher/guard failures log diagnostics and exit with status 1; restarting a fresh process is safer than continuing in unknown state. There are no macOS notifications.

**Investigation:** The previous loader explicitly exited on every CDP close/error, which explains how existing tabs could stay styled while newly opened tabs received no injection. This is a confirmed code path, not proof of the trigger behind a past incident. Notion restarts, transport failures, terminal/session shutdown, and unexpected errors remain possible triggers; the previous version left no persistent evidence to distinguish them. A SIGKILL or machine shutdown cannot produce a final log entry.

### Optional: supervise the loader with launchd

For automatic recovery after a process crash, use a per-user macOS LaunchAgent. Apple's [launchd documentation](https://developer.apple.com/library/archive/documentation/MacOSX/Conceptual/BPSystemStartup/Chapters/CreatingLaunchdJobs.html) describes this native supervision mechanism; its [plist reference](https://github.com/apple-oss-distributions/launchd/blob/main/man/launchd.plist.5) documents `SuccessfulExit` and restart throttling. No additional dependency is needed.

This is opt-in. The existing startup behavior and Automator application are unchanged. The agent runs **only the loader**, so it will wait for CDP without opening Notion at login. Continue opening Notion through `start.sh` or your themed Automator application. The generator embeds absolute paths to this checkout and your current Node executable.

1. Stop any existing loader with Ctrl+C (or quit its Automator application) before transferring ownership to launchd. Do not kill Notion. This matters: a duplicate loader exits successfully, so launchd would consider its job finished while the original loader kept running.
2. From the repository directory, create and load the agent:

   ```sh
   mkdir -p "$HOME/Library/LaunchAgents"
   node scripts/launchagent.cjs > "$HOME/Library/LaunchAgents/com.ectoplasma.notion-loader.plist"
   plutil -lint "$HOME/Library/LaunchAgents/com.ectoplasma.notion-loader.plist"
   launchctl bootstrap "gui/$(id -u)" "$HOME/Library/LaunchAgents/com.ectoplasma.notion-loader.plist"
   ```

The job starts at login and restarts after unsuccessful exits, throttled to avoid rapid crash loops. Intentional clean shutdowns do not trigger a restart. The existing per-checkout OS socket guard prevents duplicate watchers/CDP connections, including concurrent direct and Automator launches. Separate checkouts have separate guards; install only one agent. Routine stdout/stderr goes to `/dev/null`; use the rotating log for diagnostics and `launchctl print "gui/$(id -u)/com.ectoplasma.notion-loader"` for process/exit status (including failures before logging initializes).

To stop supervision and remove the agent:

```sh
launchctl bootout "gui/$(id -u)" "$HOME/Library/LaunchAgents/com.ectoplasma.notion-loader.plist"
rm "$HOME/Library/LaunchAgents/com.ectoplasma.notion-loader.plist"
```

After moving the checkout or changing the Node installation, boot out the old agent, regenerate the plist, and bootstrap it again. After loader code updates, boot out and bootstrap the agent to run the new code. Supervision does not repair invalid CSS, missing files, or a broken Node installation; resolve the logged error first.

## Customize the theme

To change the theme's styling, install its development dependencies and start the SCSS watcher from the repository directory:

```sh
npm ci
npm run watch
```

Edit the SCSS files in `src/`. The watcher rebuilds `dist/Ectoplasma.theme.css`, and the running loader automatically reapplies changes to Notion. **Do not edit the generated CSS directly.**

Design tokens live in `src/abstracts/_variables.scss`. Changing `--spook-electric` updates the derived application surfaces, text palette, 10% interaction backgrounds, and 25% borders. Desktop Tab Bar effects and predefined text, background, and tag palettes remain separately configurable.

Palette tokens use the suffixes `gra`, `bro`, `ora`, `yel`, `gre`, `blu`, `pur`, `pin`, and `red` (for example, `--spook-text-blu`); light-gray icon tokens use `lgr`. Semantic names such as `electric` and `primary` remain unchanged; the default tag background uses `--spook-tag-bg-def`. Shared Sass palette IDs and the inline colored-text selector live in `src/abstracts/_colors.scss`; import that module with `@use` when reusing them.

To reapply the current compiled CSS to all open Notion tabs and the Tab Bar without reloading them:

```sh
npm run inject
```

Notion must already be running with CDP enabled through `start.sh`. This command also works alongside the loader, exits after injection, and does not start another watcher. Run `npm run build` first if you have uncompiled SCSS changes.

Useful commands: `npm run build` (compile once), `npm run check` (validate generated CSS), and `npm test` (run automated tests).

## Troubleshooting

- **One tab loses the theme:** Run `npm run inject` to reapply the compiled CSS without refreshing. After updating the injector, stop the old loader with Ctrl+C and run `start.sh` again to activate the new event handling.
- **CDP disconnected / new tabs stop receiving CSS:** The loader reconnects automatically with delays of 1, 2, 4, 8, 16, 32, then 60 seconds, capped at one attempt per minute. It rediscovers renderers and reads the latest CSS after reconnecting. If CDP stays unavailable, fully quit Notion and relaunch through `start.sh`. The loader never restarts Notion itself. `npm run inject` remains a one-shot command and reports failure immediately.
- **Theme does not appear:** Make sure Notion uses Dark appearance and Standard contrast. Quit Notion completely, then relaunch with `start.sh`.
- **Node.js or WebSocket error:** Check `node --version`; Node.js 22.4 or newer is required.
- **Changes do not appear:** Keep both `npm run watch` and the loader running, and check for Sass compilation errors.
- **Automator launch fails:** Verify the repository path and the Node.js directory in `PATH`.

**Compatibility:** Ectoplasma relies on Notion's internal desktop interface, which can change after Notion updates. Some elements may need theme updates to remain styled correctly.

## License

No license has been selected yet.
