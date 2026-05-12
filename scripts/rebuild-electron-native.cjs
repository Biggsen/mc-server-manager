const { spawnSync } = require("node:child_process");
const { existsSync } = require("node:fs");
const { join } = require("node:path");

const root = join(__dirname, "..");
const electronVersion = require(join(root, "node_modules", "electron", "package.json")).version;
const betterSqliteDir = join(root, "node_modules", "better-sqlite3");
const npx = process.platform === "win32" ? "npx.cmd" : "npx";
const prebuildInstall = join(
  root,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "prebuild-install.cmd" : "prebuild-install",
);

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? root,
    stdio: "inherit",
    shell: process.platform === "win32",
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

if (!existsSync(betterSqliteDir)) {
  console.error("[native] better-sqlite3 is not installed at", betterSqliteDir);
  process.exit(1);
}

if (!existsSync(prebuildInstall)) {
  console.error("[native] prebuild-install is not installed at", prebuildInstall);
  process.exit(1);
}

console.log(`[native] Installing better-sqlite3 prebuild for Electron ${electronVersion} (${process.platform}-${process.arch})`);
run(
  prebuildInstall,
  [
    "--runtime",
    "electron",
    "--target",
    electronVersion,
    "--platform",
    process.platform,
    "--arch",
    process.arch,
  ],
  { cwd: betterSqliteDir },
);

console.log("[native] Rebuilding keytar for Electron");
run(npx, ["electron-rebuild", "-f", "-w", "keytar"], { cwd: root });
