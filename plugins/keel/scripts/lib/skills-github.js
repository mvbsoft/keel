'use strict';
// Reads skill candidates from GitHub for scripts/skills.js `evidence` and `install`: `gh api` when gh is
// logged in, else the public API over https (60 requests an hour), and file contents from
// raw.githubusercontent.com at a pinned commit. A recorded-responses map (URL → { status, body })
// replaces the network in tests. Every request is a GET; nothing read here is ever run.
const https = require('node:https');
const { spawnSync } = require('node:child_process');

const API = 'https://api.github.com';
const RAW = 'https://raw.githubusercontent.com';
const TIMEOUT_MS = 20000;
// A JSON answer (a recursive tree of a big repository) may be large; file contents are capped by the caller.
const MAX_BODY = 8 * 1024 * 1024;
const UA = 'keel-skills';

const enc = (p) => p.split('/').map(encodeURIComponent).join('/');
const urls = {
  repo: (o, r) => `${API}/repos/${o}/${r}`,
  lastCommit: (o, r, p) => `${API}/repos/${o}/${r}/commits?per_page=1${p ? `&path=${encodeURIComponent(p)}` : ''}`,
  tree: (o, r, sha) => `${API}/repos/${o}/${r}/git/trees/${sha}?recursive=1`,
  raw: (o, r, sha, p) => `${RAW}/${o}/${r}/${sha}/${enc(p)}`,
};

function httpsGet(url, limit, hops = 0) {
  return new Promise((resolve) => {
    const req = https.get(url, { headers: { 'User-Agent': UA, Accept: url.startsWith(API) ? 'application/vnd.github+json' : '*/*' }, timeout: TIMEOUT_MS }, (res) => {
      const loc = res.headers.location;
      // The API answers a renamed repository with a redirect; only GitHub's own hosts are followed.
      if ([301, 302, 307].includes(res.statusCode) && loc && hops < 2 && /^https:\/\/(api\.github\.com|raw\.githubusercontent\.com)\//.test(loc)) {
        res.resume();
        resolve(httpsGet(loc, limit, hops + 1));
        return;
      }
      const chunks = [];
      let size = 0;
      res.on('data', (c) => {
        size += c.length;
        if (size > limit) { req.destroy(); resolve({ status: 0, error: 'answer too large' }); return; }
        chunks.push(c);
      });
      res.on('end', () => {
        const limited = (res.statusCode === 403 || res.statusCode === 429) && res.headers['x-ratelimit-remaining'] === '0';
        const buf = Buffer.concat(chunks);
        resolve({ status: limited ? 429 : res.statusCode, text: buf.toString('utf8'), buf });
      });
    });
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, error: 'timed out' }); });
    req.on('error', (e) => resolve({ status: 0, error: String(e.code || e.message) }));
  });
}

function ghGet(url) {
  const r = spawnSync('gh', ['api', '-H', 'Accept: application/vnd.github+json', url.slice(API.length + 1)], { encoding: 'utf8', timeout: TIMEOUT_MS, maxBuffer: MAX_BODY });
  if (r.status === 0) return { status: 200, text: r.stdout };
  const err = `${r.stderr || ''}`;
  if (/rate limit/i.test(err)) return { status: 429, text: '' };
  const m = /HTTP (\d{3})/.exec(err);
  return m ? { status: Number(m[1]), text: r.stdout || '' } : { status: 0, error: err.split('\n')[0] || 'gh failed' };
}

const ghLoggedIn = () => {
  const r = spawnSync('gh', ['auth', 'status'], { stdio: 'ignore', timeout: TIMEOUT_MS });
  return r.status === 0;
};

// A fetcher: get(url, limit) → Promise<{ status, text, buf, error }>; status 0 = no answer, 429 = rate limit.
// `responses` (an object read from --responses) replaces the network entirely.
function makeFetcher(responses) {
  if (responses) {
    return {
      via: 'recorded responses',
      get: async (url) => {
        const r = responses[url];
        if (!r) return { status: 0, error: 'no recorded response' };
        const body = r.body === undefined ? '' : r.body;
        const text = typeof body === 'string' ? body : JSON.stringify(body);
        return { status: r.status || 200, text, buf: Buffer.from(text, 'utf8') };
      },
    };
  }
  const gh = ghLoggedIn();
  return {
    via: gh ? 'gh api' : 'GitHub API without login (60 requests an hour)',
    get: async (url, limit = MAX_BODY) => (gh && url.startsWith(API) ? ghGet(url) : httpsGet(url, limit)),
  };
}

const json = (r) => { if (r.status !== 200) return null; try { return JSON.parse(r.text); } catch { return null; } };

// owner, repo and folder from a scout candidate, or { error }. Only https://github.com/<owner>/<repo>.
function parseCandidate(c) {
  if (!c || typeof c.repo !== 'string') return { error: 'no repository link' };
  const m = /^https:\/\/github\.com\/([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))\/([A-Za-z0-9._-]{1,100}?)(?:\.git)?\/?$/.exec(c.repo.trim());
  if (!m || m[2] === '.' || m[2] === '..') return { error: 'not a https://github.com/<owner>/<repo> link' };
  let p = typeof c.path === 'string' ? c.path.trim().replace(/^\/+|\/+$/g, '') : '';
  p = p.replace(/(^|\/)SKILL\.md$/i, '');
  if (p.includes('\\') || p.split('/').some((s) => s === '..' || s === '.' || (p && !s)) || /[\0-\x1f:]/.test(p)) return { error: 'not a folder path inside the repository' };
  return { owner: m[1], repo: m[2], path: p, need: typeof c.need === 'string' ? c.need : '' };
}

// Licence of a LICENSE text by its key phrases; 'other' when none fits.
function licenseOfText(text) {
  const t = String(text || '').replace(/\s+/g, ' ');
  if (/Apache License,? Version 2\.0/i.test(t) || (/Apache License/i.test(t) && /Version 2\.0/.test(t))) return 'Apache-2.0';
  if (/Permission is hereby granted, free of charge/i.test(t)) return 'MIT';
  if (/Permission to use, copy, modify, and\/or distribute this software for any purpose with or without fee/i.test(t)) return 'ISC';
  if (/Redistribution and use in source and binary forms/i.test(t)) return /Neither the name/i.test(t) ? 'BSD-3-Clause' : 'BSD-2-Clause';
  return 'other';
}

const LICENSE_NAME = /^(LICENSE|LICENCE|COPYING)(\.(md|txt|rst))?$/i;

module.exports = { makeFetcher, parseCandidate, licenseOfText, json, urls, LICENSE_NAME, MAX_BODY };
