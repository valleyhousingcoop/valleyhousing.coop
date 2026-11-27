import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { marked } from "marked";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = path.join(root, "dist");
const website = new URL("https://www.valleyhousing.coop/");
const publicAssets = ["CNAME", "favicon.png", "apple-touch-icon.png", "Logo Black Square.png", "media"];
const reservedPaths = new Set(publicAssets.map((asset) => asset.toLowerCase()));
const pageSlug = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const redirectPath = /^\/[A-Za-z0-9][A-Za-z0-9._~-]*(\/[A-Za-z0-9][A-Za-z0-9._~-]*)*\/?$/;

const [readme, template, site, redirectFile, pageFiles] = await Promise.all([
  readFile(path.join(root, "README.md"), "utf8"),
  readFile(path.join(root, "template.html"), "utf8"),
  readJson("content/site.json"),
  readJson("content/redirects.json", { allowEmpty: true }),
  readdir(path.join(root, "content/pages"), { withFileTypes: true }),
]);

if (template.split("{{BODY}}").length !== 2) {
  throw new Error("Expected template.html to contain exactly one {{BODY}} placeholder.");
}

const pages = new Map();
for (const file of pageFiles) {
  if (!file.isFile() || file.name.startsWith(".")) continue;
  const slug = path.basename(file.name, ".json");
  if (!file.name.endsWith(".json") || !pageSlug.test(slug)) {
    throw new Error(`content/pages/${file.name}: use a lowercase filename such as get-involved.json.`);
  }
  const route = `/${slug}`;
  validateRoute(route, `content/pages/${file.name}`);
  const page = await readJson(`content/pages/${file.name}`);
  pages.set(route, page);
}

const redirects = new Map();
for (const [index, { from, to }] of (redirectFile.redirects ?? []).entries()) {
  const field = `Redirect ${index + 1} (${from})`;
  if (!redirectPath.test(from)) {
    throw new Error(`${field}: enter a site path such as /join or /go/join.`);
  }
  const route = from.replace(/\/$/, "");
  validateRoute(route, field);
  if (pages.has(route.toLowerCase())) throw new Error(`${field}: conflicts with an existing page.`);
  if (redirects.has(route.toLowerCase())) throw new Error(`${field}: duplicate redirect path.`);
  redirects.set(route.toLowerCase(), { route, to: linkUrl(to, field) });
}

for (const { route, to } of redirects.values()) {
  const visited = new Set([route.toLowerCase()]);
  let target = new URL(to, website);
  while (target.host === website.host || target.host === "valleyhousing.coop") {
    let pathname;
    try {
      pathname = decodeURIComponent(target.pathname);
    } catch {
      throw new Error(`Redirect ${route}: the destination path has invalid URL encoding.`);
    }
    const next = pathname.replace(/(?:\/index\.html|\/)$/i, "").toLowerCase();
    if (visited.has(next)) throw new Error(`Redirect ${route}: redirect loop through ${next}.`);
    const redirect = redirects.get(next);
    if (!redirect) break;
    visited.add(next);
    target = new URL(redirect.to, website);
  }
}

const footerLinks = (site.footerLinks ?? []).map(({ label, url }, index) => {
  const href = linkUrl(url, `Footer link ${index + 1} (${label})`, true);
  return `<li><a href="${escapeHtml(href)}">${escapeHtml(label)}</a></li>`;
});
const footer = footerLinks.length ? `      <ul>\n        ${footerLinks.join("\n        ")}\n      </ul>` : "";
const socialImage = site.socialImage ? new URL(`/${site.socialImage.replace(/^\//, "")}`, website) : null;
const documents = new Map([["", renderPage(site.title, marked.parse(readme), "")]]);
for (const [route, page] of pages) {
  const body = marked.parse(page.body, {
    walkTokens(token) {
      if (token.type === "image" && token.href.startsWith("media/")) {
        token.href = `/${token.href}`;
      }
    },
  });
  const title = escapeHtml(page.title);
  documents.set(route, renderPage(`${page.title} | ${site.title}`, `<h1>${title}</h1>\n${body}`, route));
}

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
for (const asset of publicAssets) {
  await cp(path.join(root, asset), path.join(output, asset), { recursive: true });
}
for (const [route, html] of documents) {
  await writePage(route, html);
}
for (const { route, to } of redirects.values()) {
  const href = escapeHtml(to);
  await writePage(route, `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Redirecting</title>
    <meta http-equiv="refresh" content="0; url=${href}" />
  </head>
  <body>
    <p><a href="${href}">Continue to the destination</a></p>
  </body>
</html>
`);
}

async function readJson(file, { allowEmpty = false } = {}) {
  try {
    const content = await readFile(path.join(root, file), "utf8");
    if (allowEmpty && !content.trim()) return {};
    return JSON.parse(content);
  } catch (error) {
    throw new Error(`${file}: ${error.message}`, { cause: error });
  }
}

function validateRoute(route, field) {
  const segments = route.slice(1).toLowerCase().split("/");
  if (reservedPaths.has(segments[0]) || segments.includes("index.html")) {
    throw new Error(`${field}: ${route} conflicts with a site file or asset.`);
  }
}

function linkUrl(value, field, allowEmail = false) {
  const url = typeof value === "string" ? value.trim() : "";
  const sitePath = url.startsWith("/") && !url.startsWith("//");
  const webUrl = /^https?:\/\//i.test(url);
  const email = allowEmail && /^mailto:[^?]+/i.test(url);
  if (
    (!sitePath && !webUrl && !email) ||
    /[\\\u0000-\u001f\u007f]/u.test(url) ||
    !URL.canParse(url, website)
  ) {
    throw new Error(`${field}: enter a site path or an absolute URL.`);
  }
  return url;
}

function escapeHtml(value) {
  const entities = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  return String(value).replace(/[&<>"']/g, (character) => entities[character]);
}

function renderPage(title, body, route) {
  const homepage = route === "";
  const meta = [
    `<meta property="og:title" content="${escapeHtml(title)}" />`,
    '<meta property="og:type" content="website" />',
    `<meta property="og:url" content="${new URL(`${route}/`, website).href}" />`,
  ];
  if (site.description) {
    const description = escapeHtml(site.description);
    meta.push(`<meta name="description" content="${description}" />`);
    meta.push(`<meta property="og:description" content="${description}" />`);
  }
  if (socialImage) meta.push(`<meta property="og:image" content="${escapeHtml(socialImage.href)}" />`);

  const fields = {
    TITLE: escapeHtml(title),
    META: meta.join("\n    "),
    BODY: body.trimEnd().split("\n").map((line) => line && `    ${line}`).join("\n"),
    FOOTER_LINKS: footer,
    NEWSLETTER_LABEL: escapeHtml(site.newsletterLabel),
    NEWSLETTER_BUTTON: escapeHtml(site.newsletterButton),
    HOME_LINK: homepage ? "" : '<p><a href="/">Home</a></p>',
  };
  return template
    .replace(/^    <!-- home-only -->\n([\s\S]*?)^    <!-- \/home-only -->\n/gm, (_, html) => homepage ? html : "")
    .replace(/\{\{([A-Z_]+)\}\}/g, (_, key) => fields[key]);
}

async function writePage(route, html) {
  const directory = path.join(output, route.slice(1));
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, "index.html"), html);
}
