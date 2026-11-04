import assert from "node:assert/strict";
import { afterEach, beforeEach, mock, test } from "node:test";
import worker from "../main.js";

const endpoint = "https://worker.example/api/member-counts";
const fixtures = {
  "resident-members": [1, 2],
  "investor-members": [2, 3],
  "oc-members": [1, 3, 4, 5],
  "paid-members": [4, 6],
  "waived-members": [5, 6, 7],
};
let cache;
let pending;
let ctx;
const originalCaches = Object.getOwnPropertyDescriptor(globalThis, "caches");

beforeEach(() => {
  cache = new Map();
  pending = [];
  ctx = { waitUntil: (promise) => pending.push(promise) };
  Object.defineProperty(globalThis, "caches", {
    configurable: true,
    value: {
      default: {
        async match(key) { return cache.get(key.url)?.clone(); },
        async put(key, response) { cache.set(key.url, response); },
      },
    },
  });
  mock.method(globalThis, "fetch", async (input, options) => {
    const url = new URL(input);
    assert.equal(url.origin, "https://forum.valleyhousing.coop");
    assert.deepEqual(options.headers, { Accept: "application/json" });
    const name = url.pathname.split("/")[2];
    const offset = Number(url.searchParams.get("offset"));
    const ids = fixtures[name];
    // Simulate an upstream page limit smaller than requested to exercise pagination.
    return Response.json({
      members: ids.slice(offset, offset + 3).map((id) => ({
        id, username: `private-name-${id}`, email: `private-${id}@example.com`,
      })),
      meta: { total: ids.length },
    });
  });
});

afterEach(() => {
  mock.restoreAll();
  if (originalCaches) Object.defineProperty(globalThis, "caches", originalCaches);
  else delete globalThis.caches;
});

test("deduplicates in resident, lender/donor, community order and exposes only counts", async () => {
  const response = await worker.fetch(new Request(endpoint), { API_KEY: "never-forward-this" }, ctx);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), "*");
  assert.equal(response.headers.get("Cache-Control"), "public, max-age=3600");
  assert.deepEqual(await response.json(), {
    total: 7, resident: 2, lenderDonor: 1, community: 4,
  });
  assert.equal(fetch.mock.callCount(), 6);
  await Promise.all(pending);
  const stored = await cache.get(endpoint).json();
  assert.deepEqual(stored, { total: 7, resident: 2, lenderDonor: 1, community: 4 });
});

test("query strings share the cache and do not trigger further forum requests", async () => {
  await worker.fetch(new Request(`${endpoint}?a=1`), {}, ctx);
  await Promise.all(pending);
  const calls = fetch.mock.callCount();
  const response = await worker.fetch(new Request(`${endpoint}?a=2`), {}, ctx);
  assert.equal(response.status, 200);
  assert.equal(fetch.mock.callCount(), calls);
});

test("counts empty groups as zero", async () => {
  fetch.mock.mockImplementation(async () => Response.json({ members: [], meta: { total: 0 } }));
  const response = await worker.fetch(new Request(endpoint), {}, ctx);
  assert.deepEqual(await response.json(), { total: 0, resident: 0, lenderDonor: 0, community: 0 });
});

for (const [label, upstream] of [
  ["private group", () => new Response("sensitive upstream error", { status: 403 })],
  ["rate limit", () => new Response("rate limited", { status: 429 })],
  ["timeout", () => { throw new Error("upstream timeout"); }],
  ["invalid JSON", () => new Response("<html>Error</html>")],
  ["missing metadata", () => Response.json({ members: [] })],
  ["incomplete page", () => Response.json({ members: [], meta: { total: 1 } })],
  ["invalid member", () => Response.json({ members: [{}], meta: { total: 1 } })],
  ["duplicate members", () => Response.json({ members: [{ id: 1 }, { id: 1 }], meta: { total: 2 } })],
  ["changing total", (input) => Response.json({
    members: [{ id: Number(new URL(input).searchParams.get("offset")) + 1 }],
    meta: { total: Number(new URL(input).searchParams.get("offset")) === 0 ? 2 : 3 },
  })],
  ["unbounded pagination", (input) => Response.json({
    members: [{ id: Number(new URL(input).searchParams.get("offset")) + 1 }],
    meta: { total: 100 },
  })],
]) {
  test(`${label} fails without caching partial counts or exposing upstream details`, async () => {
    fetch.mock.mockImplementation(upstream);
    const response = await worker.fetch(new Request(endpoint), {}, ctx);
    assert.equal(response.status, 502);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    assert.deepEqual(await response.json(), { error: "Membership counts are temporarily unavailable." });
    assert.equal(cache.size, 0);
  });
}

test("preflight and unsupported methods do not fetch member details", async () => {
  const preflight = await worker.fetch(new Request(endpoint, { method: "OPTIONS" }), {}, ctx);
  assert.equal(preflight.status, 204);
  const post = await worker.fetch(new Request(endpoint, { method: "POST" }), {}, ctx);
  assert.equal(post.status, 405);
  assert.equal(post.headers.get("Allow"), "GET, OPTIONS");
  assert.equal(fetch.mock.callCount(), 0);
});

test("existing newsletter routes still handle requests", async () => {
  const response = await worker.fetch(new Request("https://worker.example/"), {}, ctx);
  assert.equal(await response.text(), "OK. POST form data with an email field.");
  const post = await worker.fetch(new Request("https://worker.example/", { method: "POST" }), {}, ctx);
  assert.equal(post.status, 400);
  assert.equal(fetch.mock.callCount(), 0);
});
