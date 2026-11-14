# Ectoplasma for Notion

A custom dark theme for **Notion Desktop on macOS**, featuring electric-blue accents, subtle neon glow, and a cohesive dark interface.

Ectoplasma customizes the sidebar, editor, databases, menus, page icons, and desktop tab bar.

The theme is applied locally using Chrome DevTools Protocol (CDP), without modifying Notion's application files or requiring external hosting.

## Requirements

- macOS with [Notion Desktop](https://www.notion.com/desktop) installed.
- Notion appearance set to **Dark** with **Standard** contrast.
- [Node.js 22.4+](https://nodejs.org/).

## Installation

1. [Download Ectoplasma](https://github.com/madebyspook/Ectoplasm-Notion) and extract the ZIP, or clone the repository.
2. Fully quit Notion.
3. Open Terminal and run:

   ```bash
   /bin/bash "/path/to/Ectoplasm-Notion/start.sh"
   ```

   Replace the path with the location of your downloaded repository.

4. Notion will launch with Ectoplasma applied.

Keep the loader running while using Notion to automatically style new tabs and apply theme updates.

### Optional: Launch as a macOS app

You can create a standalone launcher using macOS Automator:

1. Open **Automator** → **New Document** → **Application**.
2. Add the **Run Shell Script** action.
3. Paste the following, replacing the repository path:

   ```bash
   export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
   /bin/bash "/path/to/Ectoplasm-Notion/start.sh"
   ```

4. Save the application and use it to launch Notion with Ectoplasma.

## Customization

Ectoplasma uses SCSS and CSS variables, making its colors and effects customizable.

To modify the theme, open Terminal in the repository directory and run:

```bash
npm ci
npm run watch
```

Edit the SCSS files in `src/`. The watcher automatically compiles your changes, and the running loader applies them to Notion.

The main design tokens are located in `src/abstracts/_variables.scss`.

To compile changes manually:

```bash
npm run build
```

To manually reapply the compiled theme without refreshing Notion:

```bash
npm run inject
```

## Troubleshooting

- **Theme not loading:** Fully quit Notion and relaunch using `start.sh`. Check that Dark appearance and Standard contrast are enabled.
- **Individual tabs missing styling:** Run `npm run inject` to reapply the theme.
- **New tabs not receiving styling:** Check that the background loader is running. Restart it if necessary.
- **Changes not appearing:** Rebuild the SCSS and check that the loader is running.
- **Loader errors:** Check `.logs/loader.log` for diagnostic information.

## Compatibility

Ectoplasma depends on Notion's internal desktop interface. Notion updates may occasionally break individual styles or theme injection.

Currently designed for **Notion Desktop on macOS**.

## License

No license has been selected yet.
