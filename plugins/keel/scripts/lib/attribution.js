'use strict';
// AI and tool attribution in commit messages and pull requests: one list for git-flow.js, which drops
// such lines from its own commits, and hooks/no-ai-attribution.js, which refuses other commits that
// carry them. A person's own trailers and ordinary prose stay.

// "cody" and "devin" are also first names: only Sourcegraph's Cody and Devin's bot account match.
const TOOLS = 'claude|anthropic|openai|chatgpt|gpt-|copilot|codex|gemini|cursor|codeium|devin-ai|aider|windsurf|cline|sourcegraph|cody[ -]?ai|deepseek|grok';
// A tool name ends a word, except "gpt-", which is a prefix (gpt-oss, gpt-engineer).
const NAME_END = '(?:(?<=-)|(?![a-z]))';
const TOOL_WORD = new RegExp(`\\b(${TOOLS})${NAME_END}`, 'i');
const ANTHROPIC_MAIL = /noreply@anthropic\.com/i;
// A co-author is a tool when its address is a tool's, or its name holds a tool's name. Two tools share
// a common first name: "Claude Martin" or "Gemini Ruiz" is a person; "Claude", "Claude Opus 5.5" or
// "Claude Code" is the tool.
const TOOL_MAIL = /@(?:[\w-]+\.)*(?:anthropic|openai|cursor|codeium|windsurf|sourcegraph|deepseek)\.|copilot[^@\s]*@users\.noreply\.github\.com/i;
const FIRST_NAMES = /^(claude|gemini)$/i;
const TOOL_EXTRA = /^(opus|sonnet|haiku|fable|code|cli|pro|flash|ultra|nano|agent|ai|bot|assistant|\[bot\]|mythos|desktop|cowork|max|team|enterprise|api|app|chat|web|advanced|instant|live|exp|experimental|v?\d[\w.-]*)$/i;
function toolCoAuthor(text) {
  for (const m of text.matchAll(/co-authored-by:[ \t]*([^<\n"']*)(?:<([^>\n]*)>)?/gi)) {
    if (TOOL_MAIL.test(m[2] || '')) return true;
    const words = m[1].trim().split(/\s+/).filter(Boolean);
    if (!words.some((w) => TOOL_WORD.test(w))) continue;
    if (FIRST_NAMES.test(words[0]) && words.slice(1).some((w) => !TOOL_EXTRA.test(w))) continue;
    return true;
  }
  return false;
}

// "Generated with <tool>" notes. A tool name inside a longer word (Cursorial) is no tool, and "Claude
// Shannon" or "Gemini Ruiz" after a first-name tool is a person, as in a co-author line.
const noteRe = (lead) => new RegExp(`${lead} (?:with|by) \\[?(${TOOLS}|cody)${NAME_END}(?: ([a-z]+))?`, 'gi');
const NOTE = noteRe('generated');
const LINE_NOTE = noteRe('^\\W*(?:generated|created|written)');
function toolNote(re, text) {
  for (const m of text.matchAll(re)) {
    if (!(FIRST_NAMES.test(m[1]) && /^[A-Z][a-z]+$/.test(m[2] || '') && !TOOL_EXTRA.test(m[2]))) return true;
  }
  return false;
}

const hasAttribution = (text) => toolCoAuthor(text) || toolNote(NOTE, text) || ANTHROPIC_MAIL.test(text);

// A message loses whole lines only: a trailer, and a "Generated with" line only when the line starts
// with it (after an optional emoji), so prose that mentions a tool stays.
const LINE_TRAILER = { test: (line) => /^\s*co-authored-by:/i.test(line) && toolCoAuthor(line) };
function stripAttribution(message) {
  const lines = message.replace(/\r\n/g, '\n').split('\n')
    .filter((l) => !LINE_TRAILER.test(l) && !toolNote(LINE_NOTE, l) && !ANTHROPIC_MAIL.test(l));
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

module.exports = { hasAttribution, stripAttribution };
