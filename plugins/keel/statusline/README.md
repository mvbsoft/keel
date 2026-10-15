# keel status line

A vendored copy of the status line from [mvbsoft/claude-code-statusline](https://github.com/mvbsoft/claude-code-statusline) (MIT, commit `e3f08392581b4a2229d7f939596843f60d690a77`). `LICENSE` keeps the original terms; `statusline.sh` writes its icons as UTF-8 bytes, so they show in bash 3.2 (macOS) and without a UTF-8 locale; `statusline.ps1` rounds the plan-limit percentages down, as `statusline.sh` does. keel starts PowerShell directly on Windows, so the original `statusline.bat` is not included.

## How it runs

`/keel:configure` installs `node "<home>/.claude/keel/statusline.js"` as the Claude Code `statusLine` command, with your home folder written out as an absolute path. That shim stays put while the plugin folder changes with every update: it loads `run.js` from the plugin folder written in `~/.claude/keel/plugin-root.txt` (keel's SessionStart hook keeps it current), and when it cannot find `run.js` there it runs the wrapped command, if any. Claude Code passes the session JSON on stdin; `run.js`:

1. prints the status line, byte for byte as the child wrote it. The child gets a 5-second limit: on a timeout, or when it cannot start, nothing is printed; otherwise its output is printed as is, whatever its exit code;
2. after printing, records the plan-limit percentages (`rate_limits`) to `~/.claude/keel/limits.jsonl` when they changed. A failing recorder never changes the printed line.

## Modes

The mode is `statusline.mode` in `~/.claude/keel/usage.json`:

- `keel`: the vendored script (`statusline.ps1` on Windows, `statusline.sh` elsewhere; `.sh` needs `jq`).
- `wrap`: runs your previous status-line command (`statusline.original.command`) with the same input and prints its output, so your own line stays as it was and keel only records the limits.
- `none` (the default until configure installs the line): keel did not install the command, so `run.js` is not used.

`run.js` runs the vendored script in every mode except `wrap` with a command to wrap.
