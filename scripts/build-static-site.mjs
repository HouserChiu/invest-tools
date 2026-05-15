import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const ejs = require("ejs");
const { getPageContent } = require("../lib/site-content.js");
const { PAGE_ROUTES } = require("../lib/site-routes.js");

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");
const DIST_DIR = path.join(ROOT_DIR, "dist");
const VIEWS_DIR = path.join(ROOT_DIR, "views");

const STATIC_FILES = [
  "styles.css",
  "app.js",
  "portfolio-app.js",
  "portfolio-bridge.css",
  "portfolio-legacy.css",
];

async function ensureCleanDir(targetDir) {
  await fs.rm(targetDir, { recursive: true, force: true });
  await fs.mkdir(targetDir, { recursive: true });
}

async function copyStaticAssets() {
  await Promise.all(
    STATIC_FILES.map(async (relativePath) => {
      const from = path.join(ROOT_DIR, relativePath);
      const to = path.join(DIST_DIR, relativePath);
      await fs.mkdir(path.dirname(to), { recursive: true });
      await fs.copyFile(from, to);
    })
  );
}

function resolveOutputPath(routePath) {
  if (routePath === "/") {
    return path.join(DIST_DIR, "index.html");
  }

  return path.join(DIST_DIR, routePath.slice(1), "index.html");
}

async function renderRoute(route) {
  const content = getPageContent(ROOT_DIR, route.key);

  if (!content) {
    throw new Error(`Missing content for route ${route.path} (${route.key})`);
  }

  const templatePath = path.join(VIEWS_DIR, `${content.page.template}.ejs`);
  const html = await ejs.renderFile(
    templatePath,
    {
      site: content.site,
      page: content.page,
      sidebar: content.page.sidebar ? content.sidebars[content.page.sidebar] : null,
      currentPath: route.path,
    },
    {
      root: VIEWS_DIR,
      views: [VIEWS_DIR],
      filename: templatePath,
    }
  );

  const outputPath = resolveOutputPath(route.path);
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, html, "utf8");
}

async function writeManifest() {
  const manifest = {
    generatedAt: new Date().toISOString(),
    routes: PAGE_ROUTES.map((route) => route.path),
    assets: STATIC_FILES,
  };

  await fs.writeFile(
    path.join(DIST_DIR, "build-manifest.json"),
    JSON.stringify(manifest, null, 2),
    "utf8"
  );
}

async function build() {
  await ensureCleanDir(DIST_DIR);
  await copyStaticAssets();

  for (const route of PAGE_ROUTES) {
    await renderRoute(route);
  }

  await writeManifest();
  console.log(`Static site build completed at ${DIST_DIR}`);
}

build().catch((error) => {
  console.error("Static site build failed");
  console.error(error);
  process.exitCode = 1;
});
