const forumUrl = "https://forum.valleyhousing.coop";
// Order matters: each person is counted only in their first matching type.
const memberGroups = {
  resident: ["resident-members"],
  lenderDonor: ["investor-members"],
  community: ["oc-members", "paid-members", "waived-members"],
};

export async function memberCounts(request, ctx) {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json; charset=utf-8",
  };
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: { ...headers, "Access-Control-Allow-Methods": "GET, OPTIONS" },
    });
  }
  if (request.method !== "GET") {
    return new Response(null, {
      status: 405,
      headers: { ...headers, Allow: "GET, OPTIONS" },
    });
  }

  // Ignore query strings so visitors share the same cached counts.
  const cacheKey = new Request(new URL("/api/member-counts", request.url));
  const cached = await caches.default.match(cacheKey);
  if (cached) return cached;

  try {
    const groups = await Promise.all(
      Object.entries(memberGroups).map(async ([type, names]) => {
        const members = await Promise.all(names.map(loadGroupMembers));
        return [type, new Set(members.flatMap((ids) => [...ids]))];
      }),
    );
    const seen = new Set();
    const counts = {};
    for (const [type, ids] of groups) {
      counts[type] = 0;
      for (const id of ids) {
        if (!seen.has(id)) {
          seen.add(id);
          counts[type]++;
        }
      }
    }

    const response = Response.json(
      { total: seen.size, ...counts },
      { headers: { ...headers, "Cache-Control": "public, max-age=3600" } },
    );
    ctx.waitUntil(caches.default.put(cacheKey, response.clone()));
    return response;
  } catch {
    // Never turn a private group, rate limit, or incomplete response into zero members.
    return Response.json(
      { error: "Membership counts are temporarily unavailable." },
      { status: 502, headers: { ...headers, "Cache-Control": "no-store" } },
    );
  }
}

async function loadGroupMembers(name) {
  const ids = new Set();
  let offset = 0;
  let expectedTotal;
  // Bound the work to ten pages per group (50 subrequests across all five groups).
  for (let page = 0; page < 10; page++) {
    const url = new URL(`/groups/${name}/members.json`, forumUrl);
    url.searchParams.set("limit", "1000");
    url.searchParams.set("offset", String(offset));
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error("Could not read membership group");

    const { members, meta } = await response.json();
    if (
      !Array.isArray(members) ||
      !Number.isSafeInteger(meta?.total) ||
      meta.total < 0 ||
      (expectedTotal !== undefined && meta.total !== expectedTotal)
    ) {
      throw new Error("Invalid membership page");
    }
    expectedTotal = meta.total;
    for (const member of members) {
      if (!Number.isSafeInteger(member.id) || member.id <= 0 || ids.has(member.id)) {
        throw new Error("Invalid or duplicate member");
      }
      ids.add(member.id);
    }
    offset += members.length;
    if (offset === expectedTotal) return ids;
    if (members.length === 0 || offset > expectedTotal) {
      throw new Error("Incomplete membership group");
    }
  }
  throw new Error("Membership group exceeds pagination limit");
}
