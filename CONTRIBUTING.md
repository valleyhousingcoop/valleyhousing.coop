# Editing the website

The homepage can be edited visually with [Pages CMS](https://app.pagescms.org/).

## For editors

1. Sign in to Pages CMS. If you were invited by email, use that email address;
   you do not need a GitHub account.
2. Open `valleyhousingcoop/valleyhousing.coop` and select the `main` branch.
3. Select **Website homepage**.
4. Edit **Page content** using the formatting toolbar, then save.

Saving to `main` publishes the change through the existing GitHub Pages workflow.
Allow the workflow to finish before checking <https://valleyhousing.coop>.

The logo is part of **Page content**. Use the image picker to select or upload an
image from **Website images**. Keep the logo at the top of the page.

The newsletter signup form and website feedback footer are kept in
`template.html`. They remain on the website when you edit the page content.

## One-time setup for a repository administrator

1. Make sure `.pages.yml` and the accompanying template changes are on GitHub.
2. Follow the [Pages CMS quick start](https://pagescms.org/docs/quick-start/):
   sign in with GitHub and install its GitHub App for the
   `valleyhousingcoop/valleyhousing.coop` repository.
3. Open the repository in Pages CMS; it reads the existing `.pages.yml`.
4. Before publishing the first CMS edit, select a temporary branch containing
   these changes. Edit and save the homepage there, inspect the resulting
   `README.md`, and build and preview that branch as described below. Check the
   headings, lists, and links, as well as the logo, signup form, and footer.
   Saves to this branch do not trigger the deployment workflow, which runs on
   pushes to `main`.
5. Switch to `main` for normal editing. Use the repository's **Collaborators**
   page in Pages CMS to invite editors by email. See the
   [collaborator documentation](https://pagescms.org/docs/configuration/collaborators/).

Only `README.md` is exposed as editable page content. The configuration stores it as
plain Markdown without front matter and disables renaming or deleting it in the
CMS. The source-mode switch is hidden so editors start with formatted text.
Images are stored in `media/`, with relative paths that work in both the GitHub
README and the website. New uploads use safe filenames to avoid spaces in image
URLs.

## Building and previewing locally

With Node.js 22 installed, run:

```sh
npm ci
npm run build
python3 -m http.server 8000 --bind 127.0.0.1
```

Open <http://127.0.0.1:8000>. Stop the server with Ctrl-C. After further edits,
run `npm run build` again and refresh the browser.

`scripts/build.mjs` renders `README.md` into `template.html`, producing the
ignored `index.html`. Keep development and editing instructions in this file;
everything in `README.md` appears on the public homepage.
