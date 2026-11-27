# Editing the website

## For editors

1. Sign in to [Pages CMS](https://app.pagescms.org/). If you were invited by
   email, use that address. You can sign in without a GitHub account.
2. Open `valleyhousingcoop/valleyhousing.coop` and select the `main` branch.
3. Choose the section you want to edit and save when finished.

- **Website homepage** edits the same Markdown that appears in `README.md` on
  GitHub. Use the visual toolbar for headings, links, and images. Keep the
  logo at the top of the page.
- **Pages** creates standalone pages. Give a new page a title and use the
  create form's filename to set its URL. For example, `get-involved.json`
  gives the page `/get-involved/`. Use lowercase letters, numbers, and
  hyphens. Changing the title keeps the URL. Add a link from the homepage
  or footer when you want people to find the page on the site.
- **Site settings** controls the browser title, search description,
  social sharing image, newsletter signup wording, and footer links.
- **Redirects** creates shortcuts such as `/join`. Set the destination to a
  path such as `/get-involved/` or a full web URL. The path `/join/` serves
  a page that forwards visitors in the browser. Removing an entry removes
  the shortcut at the next publish.
- **Website images** holds uploaded images. Select an existing image or
  upload one from the visual editor.

Saving to `main` publishes through GitHub Pages. Wait for the
[Build and deploy Pages workflow](https://github.com/valleyhousingcoop/valleyhousing.coop/actions/workflows/pages.yml)
before checking <https://www.valleyhousing.coop/>. If a build fails, open the
workflow's build log to see which entry needs a correction.

## For repository administrators

Install the Pages CMS GitHub App using the
[quick start](https://pagescms.org/docs/quick-start/). The app reads `.pages.yml`
from the selected branch. Use the repository's **Collaborators** page in
Pages CMS to [invite editors](https://pagescms.org/docs/configuration/collaborators/).

Use a temporary branch to try CMS configuration changes or test content.
Only builds from `main` publish to the custom domain. Standalone pages,
settings, and redirects are stored under `content/`. Keep development
instructions here and public homepage content in `README.md`.

## Building and previewing locally

With Node.js 22 installed, run:

```sh
npm ci
npm test
npm run build
python3 -m http.server 8000 --bind 127.0.0.1 --directory dist
```

Open <http://127.0.0.1:8000>. After further edits, run `npm run build` again
and refresh the browser. Stop the server with Ctrl-C.

The build renders the Markdown and copies the public images into `dist/`.
GitHub Actions uploads this directory to GitHub Pages. The newsletter
form and membership counter use the Cloudflare Worker described below.

## Membership counter

The homepage fetches `/api/member-counts` from the existing
`vhc-workers.s-shanabrook.workers.dev` Cloudflare Worker. `member-counts.js` reads
these public Discourse groups without authentication:

1. Resident: `resident-members`.
2. Lender / donor: `investor-members`.
3. Community: `oc-members`, `paid-members`, and `waived-members`.

Each person is assigned to the first matching type in that order, so the three
counts add up to the total. The Worker follows pagination and uses only member
IDs for deduplication; its response and one-hour cache contain only aggregate
counts. No member names, email addresses, IDs, or API keys are sent to the
homepage. It does not change the forum's existing public group visibility.

If a group becomes private or a request fails, the page shows counts as
temporarily unavailable instead of publishing partial or zero counts. Keep any
future credentials on the Worker; even a scoped key must not go in the HTML.
The newsletter's existing `API_KEY` secret is not used for counting members.

After Worker changes, run `npm test` and deploy with
`npx wrangler@4 deploy` (Cloudflare login required). The existing newsletter
configuration and secret must remain in place. Deploy the Worker before
publishing template changes through GitHub Pages. Run `npm run build` and
preview the page locally to check the counter.
