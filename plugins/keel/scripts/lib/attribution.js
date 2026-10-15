'use strict';
// AI and tool attribution in commit messages and pull requests: one list for git-flow.js, which drops
// such lines from its own commits, and hooks/no-ai-attribution.js, which refuses other commits that
// carry them. A person's own trailers and ordinary prose stay.

// "cody" and "devin" are also first names: only Sourcegraph's Cody and Devin's bot account match.
const TOOLS = 'claude|anthropic|openai|chatgpt|gpt-|copilot|codex|gemini|cursor|codeium|devin-ai|aider|windsurf|cline|sourcegraph|cody[ -]?ai|deepseek|grok';
const TOOL_WORD = new RegExp(`\\b(${TOOLS})(?![a-z])`, 'i');
const NOTE = new RegExp(`generated (with|by) \\[?(${TOOLS}|cody)`, 'i');
const ANTHROPIC_MAIL = /noreply@anthropic\.com/i;
// A co-author is a tool when its address is a tool's, or its name holds a tool's name. Two tools share
// a common first name: "Claude Martin" or "Gemini Ruiz" is a person; "Claude", "Claude Opus 5.5" or
// "Claude Code" is the tool.
const TOOL_MAIL = /@(?:[\w-]+\.)*(?:anthropic|openai|cursor|codeium|windsurf|sourcegraph|deepseek)\.|copilot[^@\s]*@users\.noreply\.github\.com/i;
const FIRST_NAMES = /^(claude|gemini)$/i;
const TOOL_EXTRA = /^(opus|sonnet|haiku|fable|code|agent|ai|bot|assistant|\[bot\]|v?\d[\w.-]*)$/i;
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

const hasAttribution = (text) => toolCoAuthor(text) || NOTE.test(text) || ANTHROPIC_MAIL.test(text);

// A message loses whole lines only: a trailer, and a "Generated with" line only when the line starts
// with it (after an optional emoji), so prose that mentions a tool stays.
const LINE_TRAILER = { test: (line) => /^\s*co-authored-by:/i.test(line) && toolCoAuthor(line) };
const LINE_NOTE = new RegExp(`^\\W*(generated|created|written) (with|by) \\[?(${TOOLS}|cody)`, 'i');
function stripAttribution(message) {
  const lines = message.replace(/\r\n/g, '\n').split('\n')
    .filter((l) => !LINE_TRAILER.test(l) && !LINE_NOTE.test(l) && !ANTHROPIC_MAIL.test(l));
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

module.exports = { hasAttribution, stripAttribution };
