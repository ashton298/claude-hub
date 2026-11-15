# Claude Hub

Electron desktop app: Claude Code in terminal tabs, sidebar buttons that type skills/agents/snippets into the prompt, a subagent shortcut, a Visual activity tab, and an optional Prompt-o-Matic tab. Keep it small and plain.

Run: `start.bat` (or `npm start`). Ctrl+R in the window reloads UI + config (restarts Claude tabs).

## Where to change things

| Want to change | Edit |
|---|---|
| Pinned skills, hidden skills, snippets, built-in agent list, start folder, claude command, the text a button inserts | `config.json` (no code; personal and gitignored, created from `config.example.json` on first run) |
| Sidebar layout, tab bar, dialog markup | `src/index.html` |
| Button/tab/terminal behavior, shortcuts (Ctrl+T new tab, Ctrl+Shift+A subagent) | `src/renderer.js` (sections marked `// ---------- x ----------`) |
| Look | `src/styles.css` (colors are `:root` vars) |
| Skill/agent scanning, pty spawning, IPC | `src/main.js` |
| Visual tab look (colors, shapes, physics, HUD) | `src/visual.js` (constants at top), HUD styles at the end of `src/styles.css` |
| What counts as an event / labels shown in Visual | `src/activity.js` (`describe()`) |

## How it works

- Skills come from `~/.claude/skills/*/SKILL.md` (symlinks followed), agents from `~/.claude/agents/*.md` with a `name:` frontmatter. New ones show up on reload.
- Buttons write text into the active Claude tab as a bracketed paste (newlines don't submit). Shift+click also presses Enter. Templates in config: `{name}`, `{task}`.
- Each Claude tab is a node-pty (`@lydell/node-pty`, prebuilt, no compile) running `cmd /c <claudeCommand>` in `startFolder`, rendered with xterm.js. Inherited `CLAUDECODE`/`CLAUDE_CODE_*` env vars are stripped.
- Prompt-o-Matic tab is a `<webview>` loading `PromptOMatic/src/index.html` with its own preload; the hub registers that app's handlers via `PromptOMatic/src/ipc.js`, so both apps share one queue file. Don't run the standalone app and the hub against the same run at once expecting separate state; they're the same data.

## Visual tab (zero tokens)

`activity.js` polls Claude Code's own transcript files every 700 ms: `~/.claude/projects/<proj>/<session>.jsonl` plus `<session>/subagents/agent-*.jsonl` (linked to their Agent node via `.meta.json` `toolUseId`). No model calls. Each hub Claude tab is started with `--session-id <uuid>`; Visual follows the active tab's project folder (newest file there, so /clear and /resume carry over). Before that tab has a transcript, it shows the newest session anywhere. Tool calls become nodes by kind (read/write/run/search/agent/web/skill/mcp); the same file touched again reuses its node (×N).

## Gotchas

- `PromptOMatic/src/ipc.js` also runs Prompt-o-Matic's weekly scheduler and "needs you" notifications inside the hub's main process. After changing that file, fully close and reopen the hub; Ctrl+R doesn't reload main-process code.
- Window `did-start-loading` also fires when the webview loads; the pty cleanup on reload uses `did-start-navigation` + `isMainFrame` for that reason.
- Dev check: `HUB_SCREENSHOT=out.png HUB_WAIT=15000 HUB_EVAL="js" electron .` saves a screenshot plus `out.png.txt` (active terminal text via `hubDump()`) and quits. Screenshot mode disables native occlusion so covered windows still paint.
