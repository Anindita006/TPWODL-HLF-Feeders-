/* Project SUPER 50 — GitHub-backed data adapter
   ------------------------------------------------
   The dashboard's own code never talks to GitHub directly — it just calls
   window.claude.use('db') / window.claude.use('downloads'), the same calls
   it used inside Claude. This file is the only thing that changes: it
   implements that same interface, but reads/writes small JSON files inside
   your GitHub repo instead.

   STORAGE LAYOUT (inside data/, one dataset per upload panel)
     <dataset>-meta.json        {count, chunks, filename, uploadedAt}
     <dataset>-chunk-0.json     {rows: [...]}
     <dataset>-chunk-1.json     {rows: [...]}
     ...
   Each row-chunk is its own small file (a few thousand rows) instead of one
   giant commit — this avoids ever pushing an oversized single file, which
   is the main way an upload can silently fail on large datasets.
   dataset is one of: dt, village, feeder_loss, action.

   HOW DATA GETS SHARED
   - WRITE (admin only): uploading a file in the dashboard calls this
     adapter, which commits the parsed data straight to your repo via the
     GitHub REST API. This needs a personal access token, entered once via
     the "Connect GitHub" button and stored only in that browser's
     localStorage (never in the code, never in the repo).
   - READ (everyone): every open page — no token needed — fetches the
     public raw JSON files from your repo on load, and again every few
     seconds (see pollIntervalMs in github-config.js), so uploads show up
     for everyone automatically. To keep this cheap, a viewer's page only
     re-fetches the small meta file each cycle, and only pulls the full set
     of chunk files when the meta file shows something actually changed.

   REQUIREMENT: the repo (or at least its data/ folder) must be public for
   step 2 to work with zero setup for viewers. If your repo is private,
   every viewer would need their own token too — ask if you want that
   variant instead.
*/
(function(){
  const API_BASE = 'https://api.github.com';
  const RAW_BASE = 'https://raw.githubusercontent.com';
  const TOKEN_KEY = 'super50GithubToken';

  const mapMeta = {
    dtMeta: 'dt', villageMeta: 'village', feederLossMeta: 'feeder_loss', actionMeta: 'action'
  };
  const mapCollection = {
    dtChunks: 'dt', villageChunks: 'village', feederLossChunks: 'feeder_loss', actionChunks: 'action'
  };

  // dataset -> {meta, rows, chunkArrays}, refreshed only when the remote
  // meta file's uploadedAt/count/chunks actually differ from what we have.
  const readCache = {};

  function cfg(){ return window.GITHUB_CONFIG || {}; }
  function isConfigured(){
    const c = cfg();
    return !!(c.owner && c.repo &&
      !String(c.owner).includes('YOUR_') && !String(c.repo).includes('YOUR_'));
  }

  // ---------------- token handling ----------------
  function getToken(){
    try{ return localStorage.getItem(TOKEN_KEY) || null; } catch(e){ return null; }
  }
  function hasToken(){ return !!getToken(); }
  function clearToken(){
    try{ localStorage.removeItem(TOKEN_KEY); } catch(e){}
  }
  async function setToken(token){
    const c = cfg();
    if(!isConfigured()) throw new Error('github-config.js is not filled in yet (owner/repo are still placeholders).');

    // Step 1: can this token even see the repo?
    const readRes = await fetch(`${API_BASE}/repos/${c.owner}/${c.repo}`, { headers: authHeaders(token) });
    if(!readRes.ok){
      if(readRes.status === 401) throw new Error('GitHub rejected this token as invalid or expired.');
      if(readRes.status === 404) throw new Error("Repo not found with this token — check owner/repo in github-config.js, and that the token's \"Repository access\" includes this repo.");
      throw new Error('Could not read the repo (HTTP ' + readRes.status + ').');
    }

    // Step 2: can it actually WRITE? The repo's "permissions" field reflects
    // your GitHub account's role on the repo, not this token's own scope —
    // so a token with only read access still passes step 1. We only trust a
    // real test write.
    try{
      await commitJsonFile(
        `${(c.dataPath || 'data')}/_connection-check.json`,
        { connectedAt: new Date().toISOString() },
        'Verify GitHub connection',
        token
      );
    }catch(err){
      throw new Error(
        (err && err.message ? err.message : String(err)) +
        ' — check the token\'s permission is set to "Contents: Read and write" for this repo.'
      );
    }

    try{ localStorage.setItem(TOKEN_KEY, token); } catch(e){}
    return true;
  }

  function authHeaders(token){
    return {
      'Authorization': 'Bearer ' + token,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    };
  }

  function b64EncodeUnicode(str){
    return btoa(encodeURIComponent(str).replace(/%([0-9A-F]{2})/g,
      (_, p1) => String.fromCharCode(parseInt(p1, 16))));
  }

  // ---------------- paths ----------------
  function metaPath(dataset){ return `${(cfg().dataPath || 'data')}/${dataset}-meta.json`; }
  function chunkPath(dataset, i){ return `${(cfg().dataPath || 'data')}/${dataset}-chunk-${i}.json`; }
  function rawUrlForPath(path){
    const c = cfg();
    return `${RAW_BASE}/${c.owner}/${c.repo}/${c.branch || 'main'}/${path}?t=${Date.now()}`;
  }
  function contentsUrlForPath(path){
    const c = cfg();
    return `${API_BASE}/repos/${c.owner}/${c.repo}/contents/${encodeURIComponent(path).replace(/%2F/g,'/')}`;
  }

  // ---------------- low-level read/write of one file ----------------
  async function fetchJsonRaw(path){
    if(!isConfigured()) return null;
    try{
      const res = await fetch(rawUrlForPath(path), { cache: 'no-store' });
      if(res.status === 404) return null;
      if(!res.ok){ console.warn('GitHub raw fetch failed for', path, res.status); return null; }
      return await res.json();
    }catch(err){
      console.error('fetchJsonRaw', path, err);
      return null;
    }
  }

  async function commitJsonFile(path, payload, message, tokenOverride){
    if(!isConfigured()){
      throw new Error('GitHub sync is not configured — edit github-config.js with your repo details.');
    }
    const token = tokenOverride || getToken();
    if(!token){
      throw new Error('No GitHub token saved on this device — click "Connect GitHub" first.');
    }
    const c = cfg();
    const url = contentsUrlForPath(path);

    let sha = null;
    const getRes = await fetch(url + '?ref=' + encodeURIComponent(c.branch || 'main'), { headers: authHeaders(token) });
    if(getRes.ok){
      const j = await getRes.json();
      sha = j.sha || null;
    } else if(getRes.status !== 404){
      const errJson = await getRes.json().catch(() => ({}));
      throw new Error('Could not check ' + path + ' (HTTP ' + getRes.status + '): ' + (errJson.message || getRes.statusText));
    }

    const body = {
      message: message || ('Update ' + path + ' — ' + new Date().toISOString()),
      content: b64EncodeUnicode(JSON.stringify(payload)),
      branch: c.branch || 'main',
    };
    if(sha) body.sha = sha;

    const putRes = await fetch(url, {
      method: 'PUT',
      headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if(!putRes.ok){
      const errJson = await putRes.json().catch(() => ({}));
      throw new Error('GitHub write failed for ' + path + ' (HTTP ' + putRes.status + '): ' + (errJson.message || putRes.statusText));
    }
    return true;
  }

  async function deleteJsonFile(path){
    const token = getToken();
    if(!token) return;
    try{
      const c = cfg();
      const url = contentsUrlForPath(path);
      const getRes = await fetch(url + '?ref=' + encodeURIComponent(c.branch || 'main'), { headers: authHeaders(token) });
      if(!getRes.ok) return; // already gone, nothing to do
      const j = await getRes.json();
      const body = { message: 'Remove ' + path, sha: j.sha, branch: c.branch || 'main' };
      await fetch(url, {
        method: 'DELETE',
        headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    }catch(err){
      console.error('deleteJsonFile', path, err);
    }
  }

  // ---------------- dataset-level read (meta + chunks, with caching) ----------------
  async function loadDataset(dataset){
    const meta = await fetchJsonRaw(metaPath(dataset));
    if(!meta){
      delete readCache[dataset];
      return null;
    }
    const cached = readCache[dataset];
    const unchanged = cached && cached.meta &&
      cached.meta.uploadedAt === meta.uploadedAt &&
      cached.meta.chunks === meta.chunks &&
      cached.meta.count === meta.count;
    if(unchanged) return cached;

    const chunkCount = meta.chunks || 0;
    const chunkPromises = [];
    for(let i = 0; i < chunkCount; i++){ chunkPromises.push(fetchJsonRaw(chunkPath(dataset, i))); }
    const chunkResults = await Promise.all(chunkPromises);
    const chunkArrays = chunkResults.map(c => (c && c.rows) || []);
    let rows = [];
    chunkArrays.forEach(arr => { rows = rows.concat(arr); });

    const result = { meta, rows, chunkArrays };
    readCache[dataset] = result;
    return result;
  }

  // ---------------- db interface (mirrors the Firestore-style calls the dashboard makes) ----------------
  function dbAdapter(){
    return {
      doc(path){
        const [collection, id] = String(path).split('/');
        return {
          async get(){
            if(mapMeta[collection]){
              const dataset = mapMeta[collection];
              const loaded = await loadDataset(dataset);
              return { exists: !!loaded, data: () => (loaded ? loaded.meta : null) };
            }
            if(mapCollection[collection]){
              const dataset = mapCollection[collection];
              const loaded = await loadDataset(dataset);
              const idx = Number(id);
              if(!loaded || !loaded.chunkArrays[idx]) return { exists: false, data: () => null };
              return { exists: true, data: () => ({ rows: loaded.chunkArrays[idx] }) };
            }
            throw new Error('Unknown document ' + path);
          },
          async set(value){
            if(mapMeta[collection]){
              const dataset = mapMeta[collection];
              await commitJsonFile(metaPath(dataset), value, 'Update ' + dataset + ' metadata — ' + new Date().toISOString());
              delete readCache[dataset]; // force a fresh read next time, now that all chunks + meta are committed
              return;
            }
            if(mapCollection[collection]){
              const dataset = mapCollection[collection];
              const idx = Number(id);
              await commitJsonFile(chunkPath(dataset, idx), value, 'Update ' + dataset + ' chunk ' + idx + ' — ' + new Date().toISOString());
              return;
            }
            throw new Error('Unknown document ' + path);
          },
          async delete(){
            if(mapCollection[collection]){
              const dataset = mapCollection[collection];
              await deleteJsonFile(chunkPath(dataset, Number(id)));
            }
          },
        };
      },
      collection(name){
        return {
          limit(){
            return {
              async get(){
                const dataset = mapCollection[name];
                if(!dataset) throw new Error('Unknown collection ' + name);
                const loaded = await loadDataset(dataset);
                if(!loaded) return { docs: [] };
                const docs = loaded.chunkArrays.map((arr, i) => ({ id: String(i), data: () => ({ rows: arr }) }));
                return { docs };
              },
            };
          },
          doc(id){ return dbAdapter().doc(name + '/' + id); },
        };
      },
    };
  }

  function browserDownloads(){
    return {
      save: async ({ filename, data }) => {
        const blob = new Blob([data], { type: 'application/octet-stream' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      },
    };
  }

  window.claude = window.claude || {};
  const oldUse = window.claude.use;
  window.claude.use = async function(name){
    if(name === 'db') return dbAdapter();
    if(name === 'downloads') return browserDownloads();
    if(typeof oldUse === 'function') return oldUse(name);
    return null;
  };

  window.SUPER50_GITHUB = { setToken, clearToken, hasToken, isConfigured };

  if(!isConfigured()){
    console.warn('Project SUPER 50: add your GitHub username and repo name in github-config.js');
  }
})();
