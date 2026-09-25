PROJECT SUPER 50 — GITHUB-SYNCED DASHBOARD
============================================

WHAT THIS DOES
- Same dashboard, same Excel/CSV upload screens, same password gate.
- Uploads are committed straight to a "data/" folder in your own GitHub
  repo, split into small chunk files (a few thousand rows each) so a
  large dataset never becomes one oversized, failure-prone commit:
    data/dt-meta.json, data/dt-chunk-0.json, data/dt-chunk-1.json, ...
    data/village-meta.json, data/village-chunk-0.json, ...
    data/feeder_loss-meta.json, data/feeder_loss-chunk-0.json, ...
    data/action-meta.json, data/action-chunk-0.json, ...
- Every open copy of the page — everyone with the link — reads those
  files and refreshes automatically every few seconds. No manual git
  steps after setup. A viewer's page only re-checks the small *-meta.json
  file each cycle, and only re-downloads the chunk files when that meta
  file shows something actually changed — so idle tabs stay cheap.

FILES IN THIS FOLDER
  index.html          the dashboard (unchanged design/logic)
  github-config.js     3 settings you fill in once
  github-adapter.js    connects the dashboard's upload/download calls to GitHub

SETUP — ONE-TIME, ABOUT 5 MINUTES
----------------------------------

1) Create (or pick) a GitHub repo, and make it PUBLIC.
   Public is what lets every viewer read the data with zero setup on
   their side. (A private repo is possible too, but then every viewer
   would also need their own token — ask me if you want that variant.)

2) Edit github-config.js
   Open it and replace:
     owner: 'YOUR_GITHUB_USERNAME'   -> your GitHub username or org
     repo:  'YOUR_REPO_NAME'         -> the repo name from step 1
   Leave branch as 'main' unless your repo's default branch is different.

3) Push all 3 files (index.html, github-config.js, github-adapter.js) to
   that repo's root.

4) Turn on GitHub Pages
   Repo -> Settings -> Pages -> Source: "Deploy from a branch" ->
   Branch: main / (root) -> Save.
   GitHub gives you a URL like:
     https://YOUR_GITHUB_USERNAME.github.io/YOUR_REPO_NAME/
   That's the link you share with viewers.

5) Create an upload token (only the person/people who will upload data need this)
   GitHub -> your profile photo -> Settings -> Developer settings ->
   Personal access tokens -> Fine-grained tokens -> Generate new token.
     - Repository access: "Only select repositories" -> pick this repo.
     - Permissions -> Repository permissions -> Contents: Read and write.
     - Generate, and copy the token (starts with github_pat_...).
   Classic tokens with the "repo" scope also work if you prefer those.

6) On the dashboard, click "Connect GitHub" (near the top of the "Data
   uploads & exports" panel), paste the token, Save. This is a ONE-TIME
   step per browser/device that will be doing uploads. The token stays
   in that browser's local storage only — it is never written into the
   page, into the repo, or shown to other viewers.

7) Upload your DT / Village / Feeder Loss / Action Taken files as before
   (password to unlock the upload button is unchanged, set inside
   index.html's UPLOAD_PASSWORD constant). Each successful upload
   commits a JSON file to your repo. Open the page in another browser —
   it should pick up the update within ~pollIntervalMs (default 8s).

EVERYDAY USE AFTER SETUP
-------------------------
- You (or whoever's connected): open the site, click Upload, pick the
  Excel/CSV, done. No git, no terminal.
- Everyone else: just open the link. Nothing to install or configure.

SECURITY NOTES
---------------
- The in-app "password" is a UI gate only, not real authentication —
  anyone who inspects the page's source can see it. It stops casual
  clicks, not a determined person.
- The GitHub token you paste in step 6 is the real permission boundary:
  only give it to people who should be able to publish data, and only
  grant it "Contents: Read and write" on this one repo (not full
  account access).
- If a token is ever exposed or you want to revoke someone's upload
  access, delete that token from GitHub -> Settings -> Developer
  settings -> Personal access tokens, and click "Disconnect GitHub" in
  the dashboard on that device.
- Data files (dt.json etc.) will be visible to anyone who can see the
  public repo, same as the dashboard itself.

TROUBLESHOOTING
-----------------
- Status tag says "Not set up": github-config.js still has the
  YOUR_GITHUB_USERNAME / YOUR_REPO_NAME placeholders.
- "Connect GitHub" fails to verify: it now does a real test write (a
  data/_connection-check.json file) before saying Connected, so the error
  it shows is the actual reason — almost always the token's permission
  isn't set to "Contents: Read and write" for this specific repo, or its
  "Repository access" doesn't include this repo.
- Upload succeeds but other viewers don't see it: give it a few
  seconds (pollIntervalMs), then check the repo's data/ folder on
  GitHub.com — you should see dt-meta.json plus one or more
  dt-chunk-N.json files (or village-/feeder_loss-/action- equivalents)
  with a commit time matching your upload.
- Upload seems to hang or fail partway on a very large file: open the
  browser console (F12) during the upload — a large dataset now commits
  as several sequential small files rather than one giant one, so a
  single failed request will show exactly which chunk failed and why.
- Nothing loads at all: confirm GitHub Pages is turned on and the URL
  you're opening matches the one GitHub Pages shows you.
