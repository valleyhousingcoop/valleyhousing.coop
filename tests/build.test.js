import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));

async function siteFixture(t) {
  const folder = await mkdtemp(path.join(tmpdir(), "vhc-build-test-"));
  t.after(() => rm(folder, { recursive: true, force: true }));
  for (const entry of [
    "CNAME", "favicon.png", "apple-touch-icon.png", "Logo Black Square.png", "media",
    "README.md", "template.html", "scripts", "content",
  ]) {
    await cp(path.join(root, entry), path.join(folder, entry), { recursive: true });
  }
  await mkdir(path.join(folder, "content/pages"), { recursive: true });
  await symlink(path.join(root, "node_modules"), path.join(folder, "node_modules"));
  return folder;
}

test("the static build renders the README, editor settings, pages, and redirects", async (t) => {
  const folder = await siteFixture(t);
  const settings = path.join(folder, "content/site.json");
  const page = path.join(folder, "content/pages/get-involved.json");
  const rules = path.join(folder, "content/redirects.json");
  await writeFile(path.join(folder, "README.md"), "![Co-op logo](media/logo.png)\n\n## Homepage content\n");
  await writeFile(settings, JSON.stringify({
    title: "Valley & neighbors",
    description: 'Community "housing"',
    socialImage: "media/logo.png",
    newsletterLabel: "Get updates",
    newsletterButton: "Sign me up",
    footerLinks: [{ label: "Get involved", url: "/get-involved/" }],
  }));
  await writeFile(page, JSON.stringify({
    title: "Get involved",
    body: "Help the co-op.\n\n![Logo](media/logo.png)",
  }));
  await writeFile(rules, JSON.stringify({
    redirects: [
      { from: "/join/", to: "/get-involved/?a=1&b=2#info" },
      { from: "/go/forum", to: "https://forum.valleyhousing.coop/signup" },
    ],
  }));

  const first = spawnSync(process.execPath, ["scripts/build.mjs"], { cwd: folder, encoding: "utf8" });
  assert.equal(first.status, 0, first.stderr);
  const home = await readFile(path.join(folder, "dist/index.html"), "utf8");
  assert.match(home, /<title>Valley &amp; neighbors<\/title>/);
  assert.match(home, /content="Community &quot;housing&quot;"/);
  assert.match(home, /og:image" content="https:\/\/www\.valleyhousing\.coop\/media\/logo\.png"/);
  assert.match(home, /<h2>Homepage content<\/h2>/);
  assert.match(home, /src="media\/logo\.png"/);
  assert.match(home, /<form method="post" action="https:\/\/vhc-workers\.s-shanabrook\.workers\.dev"/);
  assert.match(home, /<label for="email">Get updates<\/label>/);
  assert.match(home, /<button type="submit">Sign me up<\/button>/);
  assert.match(home, /id="membership-counts"/);
  assert.match(home, /href="\/get-involved\/">Get involved<\/a>/);
  const standalone = await readFile(path.join(folder, "dist/get-involved/index.html"), "utf8");
  assert.match(standalone, /<title>Get involved \| Valley &amp; neighbors<\/title>/);
  assert.match(standalone, /<h1>Get involved<\/h1>/);
  assert.match(standalone, /src="\/media\/logo\.png"/);
  assert.doesNotMatch(standalone, /membership-counts|<form/);
  const redirect = await readFile(path.join(folder, "dist/join/index.html"), "utf8");
  assert.match(redirect, /http-equiv="refresh" content="0; url=\/get-involved\/\?a=1&amp;b=2#info"/);
  assert.match(redirect, /href="\/get-involved\/\?a=1&amp;b=2#info"/);
  const external = await readFile(path.join(folder, "dist/go/forum/index.html"), "utf8");
  assert.match(external, /http-equiv="refresh" content="0; url=https:\/\/forum\.valleyhousing\.coop\/signup"/);
  await assert.rejects(readFile(path.join(folder, "dist/content/site.json")), { code: "ENOENT" });

  await writeFile(page, JSON.stringify({ title: "Take part", body: "Help the co-op." }));
  // Pages CMS can save a blank file after the last redirect is removed.
  await writeFile(rules, "");
  const second = spawnSync(process.execPath, ["scripts/build.mjs"], { cwd: folder, encoding: "utf8" });
  assert.equal(second.status, 0, second.stderr);
  assert.match(await readFile(path.join(folder, "dist/get-involved/index.html"), "utf8"), /<h1>Take part<\/h1>/);
  await assert.rejects(readFile(path.join(folder, "dist/join/index.html")), { code: "ENOENT" });

  await rm(page);
  const third = spawnSync(process.execPath, ["scripts/build.mjs"], { cwd: folder, encoding: "utf8" });
  assert.equal(third.status, 0, third.stderr);
  await assert.rejects(readFile(path.join(folder, "dist/get-involved/index.html")), { code: "ENOENT" });
});

test("the build rejects invalid or conflicting redirect routes", async (t) => {
  const folder = await siteFixture(t);
  await writeFile(path.join(folder, "content/pages/faq.json"), '{"title":"FAQ","body":"Answers"}');
  const rules = path.join(folder, "content/redirects.json");
  const cases = [
    [[{ from: "/media/nested", to: "/" }], /conflicts with a site file or asset/],
    [[{ from: "/index.html", to: "/" }], /conflicts with a site file or asset/],
    [[{ from: "/faq/", to: "/" }], /conflicts with an existing page/],
    [[{ from: "/a/../b", to: "/" }], /enter a site path/],
    [[{ from: "/go", to: "example.org" }], /enter a site path or an absolute URL/],
    [[{ from: "/go", to: "/" }, { from: "/go/", to: "/" }], /duplicate redirect path/],
    [[{ from: "/one", to: "/two/" }, { from: "/two", to: "/one/index.html" }], /redirect loop/],
  ];
  for (const [redirects, error] of cases) {
    await writeFile(rules, JSON.stringify({ redirects }));
    const result = spawnSync(process.execPath, ["scripts/build.mjs"], { cwd: folder, encoding: "utf8" });
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, error);
  }
});
