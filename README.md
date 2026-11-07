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

## Customize the theme

To change the theme's styling, install its development dependencies and start the SCSS watcher from the repository directory:

```sh
npm ci
npm run watch
```

Edit the SCSS files in `src/`. The watcher rebuilds `dist/Ectoplasma.theme.css`, and the running loader automatically reapplies changes to Notion. **Do not edit the generated CSS directly.**

Design tokens live in `src/abstracts/_variables.scss`. Changing `--spook-electric` updates the derived application surfaces, text palette, 10% interaction backgrounds, and 25% borders. Desktop Tab Bar effects and predefined text, background, and tag palettes remain separately configurable.

To reapply the current compiled CSS to all open Notion tabs and the Tab Bar without reloading them:

```sh
npm run inject
```

Notion must already be running with CDP enabled through `start.sh`. This command also works alongside the loader, exits after injection, and does not start another watcher. Run `npm run build` first if you have uncompiled SCSS changes.

Useful commands: `npm run build` (compile once), `npm run check` (validate generated CSS), and `npm test` (run automated tests).

## Troubleshooting

- **One tab loses the theme:** Run `npm run inject` to reapply the compiled CSS without refreshing. After updating the injector, stop the old loader with Ctrl+C and run `start.sh` again to activate the new event handling.
- **CDP disconnected:** Restart the loader with `start.sh`. The loader reports a lost browser connection and exits; it does not poll or automatically restart Notion.
- **Theme does not appear:** Make sure Notion uses Dark appearance and Standard contrast. Quit Notion completely, then relaunch with `start.sh`.
- **Node.js or WebSocket error:** Check `node --version`; Node.js 22.4 or newer is required.
- **Changes do not appear:** Keep both `npm run watch` and the loader running, and check for Sass compilation errors.
- **Automator launch fails:** Verify the repository path and the Node.js directory in `PATH`.

**Compatibility:** Ectoplasma relies on Notion's internal desktop interface, which can change after Notion updates. Some elements may need theme updates to remain styled correctly.

## License

No license has been selected yet.
