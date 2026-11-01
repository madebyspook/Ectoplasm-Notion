import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as sass from "sass";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");

try {
  const pkg = JSON.parse(read("package.json"));
  const lock = JSON.parse(read("package-lock.json"));
  assert.equal(lock.version, pkg.version, "Lockfile version differs from package.json");
  assert.equal(lock.packages[""].version, pkg.version, "Lockfile root version differs");

  const { css } = sass.compile(fileURLToPath(new URL("src/main.scss", root)), {
    style: "expanded",
    sourceMap: false,
  });
  assert.equal(css.match(/@name\s+([^\r\n]+)/)?.[1], pkg.themeName, "Theme name differs");
  assert.equal(css.match(/@version\s+([^\r\n]+)/)?.[1], pkg.version, "Theme version differs");
  assert.equal(read("dist/Ectoplasma.theme.css"), `${css}\n`, "Generated CSS is stale; run npm run build");
  console.log("Generated CSS and theme metadata are current.");
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
