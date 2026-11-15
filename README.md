# Claude Hub

A small Electron desktop app for working with [Claude Code](https://claude.com/claude-code):

- **Claude tabs**: Claude Code running in real terminal tabs (xterm.js + node-pty). Ctrl+T opens another.
- **Sidebar buttons**: your skills (`~/.claude/skills`) and agents (`~/.claude/agents`) as buttons that type `/skill-name` or "Use the X subagent to ..." into the prompt. Shift+click also presses Enter. Add your own text snippets too.
- **New subagent dialog** (Ctrl+Shift+A): pick an agent type, type a task, insert or send.
- **Visual tab**: a live graph of the tool calls Claude is making (reads, edits, commands, searches, subagents...). It only reads Claude Code's local transcript files, so it uses zero tokens.

Tested on Windows.

## Setup

Requires [Node.js](https://nodejs.org) and Claude Code installed and logged in (`claude` on your PATH).

```
git clone https://github.com/ashton298/claude-hub.git
cd claude-hub
npm install
npm start
```

On Windows you can also double-click `start.bat` after `npm install`.

## Configure

The first run creates `config.json` from `config.example.json`. It's gitignored, so your settings stay local. Edit it, then press Ctrl+R in the hub to reload.

| Key | What it does |
|---|---|
| `claudeCommand` | Command each tab runs (e.g. `claude --model opus`) |
| `startFolder` | Folder Claude starts in (empty = home folder) |
| `pinnedSkills` / `hiddenSkills` | Skill names to pin at the top / hide |
| `snippets` | Extra buttons: `{ "label", "text" }` |
| `skillTemplate`, `agentTemplate`, `subagentTemplate` | Text a button inserts (`{name}`, `{task}`) |
| `promptOMaticPath` | Optional: path to a Prompt-o-Matic install to show it as a tab. Leave empty otherwise. |

## Privacy

Everything runs locally. The hub makes no network calls of its own; the Visual tab reads files under `~/.claude/projects` on your machine and sends nothing anywhere.

## License

MIT
