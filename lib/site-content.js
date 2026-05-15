const fs = require("fs");
const path = require("path");
const { marked } = require("marked");

const CONTENT_FILES = [
  "data/site.json",
  "data/home.json",
  "data/stocks.json",
  "data/crypto.json",
  "data/sim.json",
  "data/portfolio.json",
];

marked.setOptions({
  gfm: true,
  breaks: true,
});

function renderMarkdownFile(rootDir, markdownPath) {
  if (!markdownPath) return null;

  const fullPath = path.join(rootDir, markdownPath);
  if (!fs.existsSync(fullPath)) return null;

  const raw = fs.readFileSync(fullPath, "utf8");
  return marked.parse(raw);
}

function enrichMarkdownContent(rootDir, value) {
  if (Array.isArray(value)) {
    return value.map((item) => enrichMarkdownContent(rootDir, item));
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  const next = Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, enrichMarkdownContent(rootDir, entry)])
  );

  if (next.markdownPath) {
    next.markdownHtml = renderMarkdownFile(rootDir, next.markdownPath);
  }

  return next;
}

function loadSiteContent(rootDir) {
  return CONTENT_FILES.reduce(
    (accumulator, relativePath) => {
      const filePath = path.join(rootDir, relativePath);
      const content = JSON.parse(fs.readFileSync(filePath, "utf8"));

      if (content.site) {
        accumulator.site = { ...accumulator.site, ...content.site };
      }

      if (content.sidebars) {
        accumulator.sidebars = { ...accumulator.sidebars, ...content.sidebars };
      }

      if (content.pages) {
        accumulator.pages = {
          ...accumulator.pages,
          ...Object.fromEntries(
            Object.entries(content.pages).map(([key, page]) => [
              key,
              enrichMarkdownContent(rootDir, page),
            ])
          ),
        };
      }

      return accumulator;
    },
    { site: {}, sidebars: {}, pages: {} }
  );
}

function getPageContent(rootDir, key) {
  const siteContent = loadSiteContent(rootDir);
  const page = siteContent.pages[key];

  if (!page) {
    return null;
  }

  return {
    site: siteContent.site,
    sidebars: siteContent.sidebars,
    page,
  };
}

module.exports = {
  CONTENT_FILES,
  loadSiteContent,
  getPageContent,
};
