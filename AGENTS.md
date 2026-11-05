# Ectoplasma — Agent Instructions

Ectoplasma is a custom macOS Notion Desktop theme. Preserve existing appearance and behavior unless the task explicitly requests a change.

## Project structure and styling

- `src/main.scss` is the ordered SCSS entry point. Keep design tokens and native mappings before component styles; keep the separate desktop Tab Bar module isolated.
- Define `--spook-*` design tokens in `src/abstracts/_variables.scss`. Put application-wide Notion variable mappings in `_native-variables.scss` and component-specific rules in `src/sections/`.
- Prefer, in order: existing tokens, verified native Notion variable mappings, then narrowly scoped selectors. Add tokens when a distinct styling responsibility needs independent control; do not merge semantic tokens solely because values match.
- Keep each component's base rules and interaction states together. Use concise headings and comments describing non-obvious consumers or constraints; avoid documenting obvious CSS mechanics.
- Notion selectors and inline styles are unstable. Inspect the actual DOM and computed styles via CDP before changing unfamiliar selectors. Do not guess native variable names.
- The Tab Bar is a separate renderer and uses specialized selectors. Treat its rules and cascade as particularly sensitive. Preserve selector specificity, declaration order, and `!important` unless a verified change requires otherwise.

## Build and runtime

- `npm ci` installs dependencies; `npm run build` compiles SCSS to tracked `dist/Ectoplasma.theme.css`; `npm run watch` rebuilds during development. Never edit generated CSS directly; include updated compiled CSS with source changes when committing.
- `npm run check` validates generated CSS freshness and metadata; `npm test` runs automated tests. Keep version/name metadata consistent across `src/main.scss`, `package.json`, and the lockfile.
- `start.sh` launches Notion with CDP and starts `loader.js`. The loader injects compiled CSS into Notion page and Tab Bar renderers and hot-reloads changes. Build/watch do not launch Notion. Preserve loader single-instance protection, target discovery, injection, and reload behavior.
- Do not change the existing Automator launcher or startup behavior without explicit instruction. Avoid concurrent loaders; if Notion was started without CDP, fully quit it before relaunching through the themed launcher.

## Inspection and testing

- `npm run inspect` uses the read-only CDP inspector. It must not start or stop Notion, navigate, modify DOM/CSS, force interaction states, or call backend APIs.
- Keep `.inspections/` reports local and Git-ignored. Never save page text, input values, URLs, page titles, opaque IDs, unrestricted labels, or native CSS source. Distinguish observations from no-match results and heuristics.
- Automated tooling tests must use mocks or isolated fixtures, not alter the user's live Notion instance or fallback installation. Run `npm run build`, `npm run check`, and `npm test` for relevant changes; visually verify affected components when feasible. Automated checks alone do not establish visual correctness.
- For appearance-preserving refactors, compare compiled CSS before and after, including selector specificity, declarations, priorities, and cascade order.

## Development workflow

- Always work on a descriptive feature branch. Before making changes, check the current branch. If on main, create and switch to a new feature branch. If already on a feature branch, continue using it unless instructed otherwise. Never modify main directly.
- After each task, leave changes uncommitted and provide a concise, ready-to-use commit message summarizing the work. Do not stage or commit automatically. Commit only with explicit approval; push and create/update pull requests only when requested. Never merge, tag, release, publish, or change repository settings without explicit permission.
- Keep installation and user-facing guidance in `README.md`. Do not add dependencies, hosting, licensing, or unrelated infrastructure without a task-specific reason and approval.
- In handoffs, summarize files changed, validation results, whether live Notion was checked, and any remaining limitations or manual steps.
- Follow Semantic Versioning (MAJOR.MINOR.PATCH) for every code-changing commit:
  - PATCH: Bug fixes, styling adjustments, and refactoring without new functionality.
  - MINOR: New backward-compatible features or capabilities.
  - MAJOR: Breaking changes.
  - Use the highest applicable bump when a commit contains multiple change types.
  - Do not bump versions for documentation-only changes.
- Prepare the version bump when changes are ready to commit, not after every development iteration. Keep versions synchronized across `src/main.scss`, `package.json`, and `package-lock.json`.
- Rebuild and run checks after updating the version. Include the version bump in the same commit as the changes, never as a separate commit. Do not commit without explicit approval.

## Maintaining this file

- Treat `AGENTS.md` as durable instructions for future agents, not a changelog or implementation reference.
- Update it only when a task changes a lasting project convention, architectural boundary, workflow, or safety requirement. Do not update it for routine styling additions, temporary experiments, or one-off fixes.
- Prefer concise rules explaining what to do and why; leave discoverable implementation details in source code and user-facing setup details in `README.md`.
- Before adding guidance, check for an existing rule to revise instead. Remove or replace stale instructions rather than accumulating exceptions or historical notes.
- Keep instructions consistent with the actual repository. If a task reveals a conflict, flag it and propose a specific update; do not silently rewrite unrelated guidance.