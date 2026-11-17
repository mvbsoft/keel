'use strict';
// Recorded GitHub answers for skills.js evidence and install (--responses): no test reaches the network.
// Each helper adds the answers one candidate needs; owners and repositories are invented except
// `anthropics`, whose answers are made up too.
const API = 'https://api.github.com';
const RAW = 'https://raw.githubusercontent.com';

const SHA = (c) => c.repeat(40);
const enc = (p) => p.split('/').map(encodeURIComponent).join('/');

const MIT = 'MIT License\n\nPermission is hereby granted, free of charge, to any person obtaining a copy of this software...\n';
const skillMd = (description, extra = '') => `---\nname: test-skill\ndescription: ${description}\n${extra}---\n\n# Steps\n\nDo the thing.\n`;

class Responses {
  constructor() { this.map = {}; }

  set(url, status, body) { this.map[url] = { status, body }; return this; }

  // A repository with a skill folder: files is { rel: text }, plus links (symlinks) and tree overrides.
  candidate(owner, repo, folder, { sha = SHA('a'), files = { 'SKILL.md': skillMd('Helps with tests.') }, repoInfo = {}, changed = '2026-10-01T00:00:00Z', links = [], extraTree = [], rootLicense = MIT, treeTruncated = false } = {}) {
    const info = { full_name: `${owner}/${repo}`, archived: false, pushed_at: '2026-11-01T00:00:00Z', stargazers_count: 42, license: { spdx_id: 'MIT' }, ...repoInfo };
    this.set(`${API}/repos/${owner}/${repo}`, 200, info);
    this.set(`${API}/repos/${owner}/${repo}/commits?per_page=1${folder ? `&path=${encodeURIComponent(folder)}` : ''}`, 200, [{ sha, commit: { committer: { date: changed } } }]);
    const at = (rel) => (folder ? `${folder}/${rel}` : rel);
    const tree = Object.entries(files).map(([rel, text]) => ({ path: at(rel), mode: '100644', type: 'blob', size: Buffer.byteLength(text) }));
    for (const l of links) tree.push({ path: at(l), mode: '120000', type: 'blob', size: 10 });
    if (rootLicense !== null) tree.push({ path: 'LICENSE', mode: '100644', type: 'blob', size: rootLicense.length });
    tree.push(...extraTree);
    this.set(`${API}/repos/${owner}/${repo}/git/trees/${sha}?recursive=1`, 200, { sha, tree, truncated: treeTruncated });
    for (const [rel, text] of Object.entries(files)) this.set(`${RAW}/${owner}/${repo}/${sha}/${enc(at(rel))}`, 200, text);
    if (rootLicense !== null) this.set(`${RAW}/${owner}/${repo}/${sha}/LICENSE`, 200, rootLicense);
    return this;
  }
}

module.exports = { Responses, SHA, MIT, skillMd, API, RAW };
