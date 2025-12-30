export default {
  async fetch(request, env) {
    if (request.method === "GET") {
      return new Response("OK. POST form data with an email field.", {
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }

    if (request.method !== "POST") {
      return new Response("Method Not Allowed", {
        status: 405,
        headers: { Allow: "POST, GET" },
      });
    }

    const contentType = request.headers.get("content-type") || "";
    const isForm =
      contentType.includes("application/x-www-form-urlencoded") ||
      contentType.includes("multipart/form-data");
    if (!isForm) {
      return new Response("Expected form submission", { status: 400 });
    }

    const form = await request.formData();
    const email = String(form.get("email") || "").trim();
    if (!email) {
      return new Response("Missing email", { status: 400 });
    }

    const apiKey = env.API_KEY;
    const baseUrl = env.BASE_URL;
    const apiUser = env.API_USER;
    const to = env.TO_ADDRESS;
    const groupIdRaw = env.GROUP_ID;

    if (!apiKey) {
      return new Response("Server misconfigured: missing API_KEY", { status: 500 });
    }
    if (!baseUrl) {
      return new Response("Server misconfigured: missing BASE_URL", { status: 500 });
    }
    if (!apiUser) {
      return new Response("Server misconfigured: missing API_USER", { status: 500 });
    }
    if (!to) {
      return new Response("Server misconfigured: missing TO_ADDRESS", { status: 500 });
    }
    if (!groupIdRaw) {
      return new Response("Server misconfigured: missing GROUP_ID", { status: 500 });
    }

    const groupId = Number(groupIdRaw);
    if (!Number.isFinite(groupId)) {
      return new Response("Server misconfigured: GROUP_ID must be a number", { status: 500 });
    }

    try {
      await handleMail({ baseUrl, apiKey, apiUser, from: email, to });

      const user = await pollLookupUserByEmail({
        baseUrl,
        apiKey,
        apiUser,
        email,
      });

      await addUserToGroup({
        baseUrl,
        apiKey,
        apiUser,
        groupId,
        username: user.username,
      });

      return new Response(renderSuccessPage(email), {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Request failed";
      return new Response(message, { status: 500 });
    }
  },
};

async function handleMail({ baseUrl, apiKey, apiUser, from, to }) {
  const subject = `subscribe ${from} ${new Date().toISOString()}`;
  const rawEmail =
    [
      `From: ${from}`,
      `To: ${to}`,
      `Subject: ${subject}`,
      `Date: ${new Date().toUTCString()}`,
      `Message-ID: <${new Date().toUTCString()}@local.test>`,
      `MIME-Version: 1.0`,
      `Content-Type: text/plain; charset=UTF-8`,
      ``,
      `subscribe`,
    ].join("\r\n") + "\r\n";

  const emailEncoded = base64EncodeUtf8(rawEmail);

  const res = await fetch(`${baseUrl}/admin/email/handle_mail`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Api-Key": apiKey,
      "Api-Username": apiUser,
    },
    body: JSON.stringify({ email_encoded: emailEncoded }),
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`handle_mail failed: HTTP ${res.status} ${text}`);
  }
}

async function pollLookupUserByEmail({ baseUrl, apiKey, apiUser, email }) {
  const maxAttempts = 10;
  const delayMs = 1500;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const user = await lookupUserByEmail({ baseUrl, apiKey, apiUser, email });
    if (user) return user;

    await sleep(delayMs);
  }
  throw new Error(`Could not find user by email after ${maxAttempts} attempts: ${email}`);
}

async function lookupUserByEmail({ baseUrl, apiKey, apiUser, email }) {
  const url = new URL(`${baseUrl}/admin/users/list/active.json`);
  url.searchParams.set("filter", email);
  url.searchParams.set("show_emails", "true");

  const res = await fetch(url.toString(), {
    headers: {
      "Api-Key": apiKey,
      "Api-Username": apiUser,
      Accept: "application/json",
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`lookup user failed: HTTP ${res.status} ${text}`);
  }

  const arr = await res.json();
  if (!Array.isArray(arr) || arr.length === 0) return null;

  const exact = arr.find((u) => (u.email || "").toLowerCase() === email.toLowerCase());
  return exact || arr[0];
}

async function addUserToGroup({ baseUrl, apiKey, apiUser, groupId, username }) {
  const res = await fetch(`${baseUrl}/groups/${encodeURIComponent(groupId)}/members.json`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Api-Key": apiKey,
      "Api-Username": apiUser,
    },
    body: new URLSearchParams({ usernames: username }).toString(),
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`add to group failed: HTTP ${res.status} ${text}`);
  }
  return text;
}

function base64EncodeUtf8(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function renderSuccessPage(email) {
  const safeEmail = escapeHtml(email);
  const homeUrl = "https://valleyhousing.coop";
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Subscribed</title>
    <style>
      body {
        font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
        margin: 40px;
        max-width: 640px;
      }
      h1 {
        margin-bottom: 12px;
      }
      .button {
        display: inline-block;
        margin-top: 16px;
        padding: 10px 16px;
        background: #111;
        color: #fff;
        text-decoration: none;
        border-radius: 6px;
      }
    </style>
  </head>
  <body>
    <h1>Subscription confirmed</h1>
    <p>Your email ${safeEmail} has been subscribed to valley housing coop newsletter.</p>
    <a class="button" href="${homeUrl}">Return to home</a>
  </body>
</html>`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => {
    switch (char) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      case "'":
        return "&#39;";
      default:
        return char;
    }
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
