# recs.sjaykh.in

Recommendations for me: books, films, articles and videos people think I should get to. One static page on GitHub Pages, with a Google Sheet behind it.

The page only opens once recs.sjaykh.in is connected (step 2 below). Until then, sjaykh.github.io/recs/ redirects to sjaykh.in/recs/, because the old sjaykh.github.io site still has sjaykh.in set as its custom domain, and sjaykh.in now points to Bear.

## Files

- `index.html`: the whole page
- `Code.gs`: the Google Sheet backend. It lives in Apps Script, not on the site; it's kept here for reference.

## Setup

### 1. Sheet and backend (about 5 min)

1. Create a Google Sheet at sheets.new and name it "Recommendations".
2. Go to Extensions → Apps Script. Replace the contents of `Code.gs` there with this repo's `Code.gs`, then save.
3. Choose `setup` in the function dropdown and click Run. Approve the permissions it asks for.
4. Go to Deploy → New deployment → Web app. Set "Execute as" to **Me** and "Who has access" to **Anyone**.
5. Copy the web app URL (it ends in `/exec`). Then open `index.html` in this repo, click the pencil icon, replace `PASTE_YOUR_WEB_APP_URL_HERE` with the URL, and commit.

### 2. Connect recs.sjaykh.in

1. Go to GoDaddy → sjaykh.in → DNS → Add record.
2. Add a **CNAME** record with Name `recs` and Value `sjaykh.github.io`. Leave TTL at the default.
3. In this repo, go to Settings → Pages → Custom domain, enter `recs.sjaykh.in` and click Save. GitHub adds a `CNAME` file to the repo for you.
4. Once the DNS check passes (usually minutes, up to a few hours), tick **Enforce HTTPS**.
5. Recommended: verify sjaykh.in under your GitHub account's Settings → Pages → Verified domains. This stops anyone else from claiming subdomains of it on GitHub Pages.

### 3. Link it from the blog

In Bear's nav settings, add `[recommend me something](https://recs.sjaykh.in)`.

## Day to day

- **New recommendations:** they arrive at the bottom of the sheet with **Approved** unticked, and you get an email for each one. Tick Approved to publish it.
- **Status:** change it from the dropdown. It decides the group on the page: In progress, Up next (Not started) or Done.
- **Your own finds:** add them as rows with a Type. Leave "Recommended by" empty and fill "Found through" (e.g. Instagram) instead.
- **Links:** "Link" makes the title clickable. "Their website" makes the recommender's name clickable.
- **Timing:** edits show on the page right away. Visitors may see the old list for up to a minute.

## Changing things later

- **Editing `Code.gs`:** in Apps Script, go to Deploy → Manage deployments → Edit (pencil) → Version: New version → Deploy. That keeps the same URL.
- **Editing `index.html`:** commit to `main`. GitHub Pages republishes in about a minute.
- **Spam:** the honeypot field, the minimum fill time and the hourly cap are set in the `CONFIG` block at the top of `Code.gs`.
