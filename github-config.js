/* Project SUPER 50 — GitHub sync configuration
   Fill in the three values below with your own repo details, then push all
   files in this folder to that repo. That's the only edit required. */
window.GITHUB_CONFIG = {
  // Your GitHub username or organization name.
  owner: 'Anindita006',

  // The repository that hosts this dashboard (and will store the data files).
  repo: 'TPWODL-HLF-Feeders-',

  // The branch everyone's page reads from, and uploads commit to.
  branch: 'main',

  // Folder inside the repo where the JSON data files are kept.
  // The app creates dt.json, village.json, feeder_loss.json and action.json
  // inside this folder automatically on first upload — you don't need to
  // create them yourself.
  dataPath: 'data',

  // How often (ms) every open page re-checks GitHub for newer data.
  // 8000 = 8 seconds. Lower = faster updates but more requests.
  pollIntervalMs: 8000,
};
