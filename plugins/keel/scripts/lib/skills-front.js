'use strict';
// SKILL.md front matter and the risk flags of a skill folder, for scripts/skills.js. The same checks
// run on an installed folder (local files) and on a candidate (its file list on GitHub), so both are
// judged alike. Nothing here runs or loads the skill's code.

// Code a skill may run: scripts, binaries and libraries. A file in bin/ counts whatever its name.
const CODE_EXT = new Set(['js', 'mjs', 'cjs', 'ts', 'mts', 'cts', 'jsx', 'tsx', 'py', 'pyw', 'sh', 'bash', 'zsh', 'fish', 'ps1', 'psm1', 'bat', 'cmd', 'vbs', 'rb', 'pl', 'php', 'go', 'rs', 'java', 'kt', 'cs', 'lua', 'exe', 'dll', 'so', 'dylib', 'jar', 'wasm', 'bin', 'node']);

// Reads a YAML scalar of the simple shapes front matter uses; returns { value } or { broken }.
function scalar(raw, more) {
  const v = raw.trim();
  if (/^[|>][+-]?$/.test(v)) {
    const lines = more.map((l) => l.replace(/^\s+/, ''));
    return { value: v[0] === '|' ? lines.join('\n').trim() : lines.join(' ').replace(/\s+/g, ' ').trim() };
  }
  if (v.startsWith('"')) {
    const text = [v, ...more.map((l) => l.trim())].join(' ');
    if (!/"\s*$/.test(text) || text.length < 2) return { broken: 'an unclosed "' };
    try { return { value: JSON.parse(text.replace(/\s+$/, '')) }; } catch { return { broken: 'a bad quoted value' }; }
  }
  if (v.startsWith("'")) {
    const text = [v, ...more.map((l) => l.trim())].join(' ').replace(/\s+$/, '');
    if (!text.endsWith("'") || text.length < 2) return { broken: "an unclosed '" };
    return { value: text.slice(1, -1).replace(/''/g, "'") };
  }
  const text = [v, ...more.map((l) => l.trim())].join(' ').trim();
  // A plain scalar may not hold ": " (YAML reads it as a nested mapping and fails).
  if (/:\s/.test(text) && !/^[[{]/.test(text)) return { broken: 'a plain value with ": " (quote it)' };
  return { value: text };
}

// Parses the front matter of a SKILL.md text: { ok, fields, body, problem }. Only top-level keys are
// read; nested lists and maps are kept as their raw text. ok is false when there is no block, it is not
// closed, or a line cannot be read as YAML.
function frontMatter(text) {
  const src = String(text || '').replace(/^\uFEFF/, '');
  const lines = src.split(/\r?\n/);
  if (lines[0].trim() !== '---') return { ok: false, fields: {}, body: src, problem: 'no front matter' };
  const end = lines.findIndex((l, i) => i > 0 && /^(---|\.\.\.)\s*$/.test(l));
  if (end < 0) return { ok: false, fields: {}, body: src, problem: 'front matter not closed' };
  const fields = {};
  const seen = new Set();
  let problem = null;
  for (let i = 1; i < end;) {
    const line = lines[i];
    if (!line.trim() || /^\s*#/.test(line)) { i++; continue; }
    const m = /^([A-Za-z0-9_-]+):(?:\s+(.*)|\s*)$/.exec(line);
    if (!m) { problem = problem || `line ${i + 1} is not "key: value"`; i++; continue; }
    const more = [];
    let j = i + 1;
    while (j < end && (/^\s+\S/.test(lines[j]) || (!lines[j].trim() && j + 1 < end && /^\s+\S/.test(lines[j + 1])))) more.push(lines[j++]);
    if (seen.has(m[1])) problem = problem || `${m[1]} twice`;
    seen.add(m[1]);
    const raw = m[2] || '';
    if (!raw.trim() && more.length) fields[m[1]] = more.join('\n');
    else {
      const s = scalar(raw, more);
      if (s.broken) problem = problem || `${m[1]}: ${s.broken}`;
      else fields[m[1]] = s.value;
    }
    i = j;
  }
  return { ok: !problem, fields, body: lines.slice(end + 1).join('\n'), problem };
}

const isCode = (rel) => {
  const parts = rel.split('/');
  if (parts.slice(0, -1).includes('bin')) return true;
  const name = parts[parts.length - 1];
  const dot = name.lastIndexOf('.');
  return dot > 0 && CODE_EXT.has(name.slice(dot + 1).toLowerCase());
};

// Risk flags of a skill folder from its file list (paths relative to the folder) and its SKILL.md text.
// Returns { flags: [...], code: [files] }.
function riskFlags(files, skillText) {
  const flags = [];
  const code = files.filter(isCode);
  if (code.length) flags.push(`code (${code.length} file${code.length === 1 ? '' : 's'})`);
  if (files.some((f) => f.split('/').slice(0, -1).includes('bin'))) flags.push('bin/');
  if (files.some((f) => /(^|\/)hooks(\/|\.json$)/i.test(f))) flags.push('hooks');
  if (files.some((f) => /(^|\/)\.?mcp\.json$/i.test(f))) flags.push('MCP server');
  const fm = frontMatter(skillText);
  if (fm.fields['allowed-tools'] !== undefined) flags.push('allowed-tools');
  if (fm.fields.hooks !== undefined) flags.push('hooks in front matter');
  // !`command` runs when the skill loads, as does a ```! block.
  if (/!`[^`\n]+`/.test(skillText || '') || /^\s*```!/m.test(skillText || '')) flags.push('runs a command on load');
  return { flags, code };
}

// Text read from the network, a SKILL.md, a marketplace or the scout, made safe for a report line: one
// line (line breaks, Unicode line separators and control characters become spaces) and at most `max`
// characters, so it can never start a line of its own (a forged `action: install`).
function printable(text, max = 300) {
  const flat = String(text === undefined || text === null ? '' : text).replace(/[\s\x00-\x1f\x7f-\x9f]+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max)}...` : flat;
}

module.exports = { frontMatter, riskFlags, isCode, printable };
