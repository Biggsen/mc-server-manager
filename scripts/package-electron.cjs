const root = process.cwd();
const [, , platform = "win32", archArg = "x64"] = process.argv;

const ignoredRoots = new Set([
  ".cursor",
  ".git",
  ".github",
  ".vscode",
  "dist-electron",
  "docs",
  "release",
  "release-smoke",
  "release-smoke2",
  "scripts",
  "tasks",
]);

const ignoredPaths = new Set([
  ".env",
  ".env.example",
  ".env.local",
  ".gitattributes",
  ".gitignore",
  "backend/.env",
  "backend/backend.log",
  "backend/data",
  "backend/node_modules/.cache",
  "electron/node_modules",
  "electron-builder.yml",
  "frontend/node_modules",
  "frontend/src",
  "node_modules/.cache",
  "README.md",
]);

function toForwardSlashRelative(path) {
  return path.replace(/\\/g, "/").replace(/^\/+/, "");
}

function isPathOrChild(path, prefix) {
  return path === prefix || path.startsWith(`${prefix}/`);
}

function ignore(path) {
  const rel = toForwardSlashRelative(path);
  if (!rel) return false;

  const [topLevel] = rel.split("/");
  if (ignoredRoots.has(topLevel)) return true;

  for (const ignoredPath of ignoredPaths) {
    if (isPathOrChild(rel, ignoredPath)) return true;
  }

  return false;
}

async function run() {
  const { packager } = await import("@electron/packager");
  const archs = archArg.split(",").map((arch) => arch.trim()).filter(Boolean);

  for (const arch of archs) {
    console.log(`[packager] Packaging ${platform}-${arch}`);
    const paths = await packager({
      dir: root,
      name: "mc-server-manager",
      platform,
      arch,
      out: "release",
      overwrite: true,
      asar: {
        unpack: "**/node_modules/{keytar,ssh2,better-sqlite3,bindings}/**",
      },
      icon:
        platform === "darwin"
          ? "assets/icon.icns"
          : platform === "linux"
            ? "assets/icon.png"
            : "assets/icon.ico",
      prune: true,
      ignore,
    });
    for (const outputPath of paths) {
      console.log(`[packager] Wrote ${outputPath}`);
    }
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
