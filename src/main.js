'use strict';
const { app, BrowserWindow, ipcMain, shell, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const pty = require('@lydell/node-pty');
const activity = require('./activity');

const ROOT = path.join(__dirname, '..');
const CONFIG = path.join(ROOT, 'config.json');
const CLAUDE_DIR = path.join(os.homedir(), '.claude');
let win;
const terms = new Map(); // id -> pty

// config.json is personal and gitignored; first run copies the example.
if (!fs.existsSync(CONFIG)) fs.copyFileSync(path.join(ROOT, 'config.example.json'), CONFIG);
const readConfig = () => JSON.parse(fs.readFileSync(CONFIG, 'utf8'));

// Reads `name:` and `description:` from a markdown file's YAML frontmatter.
function frontmatter(file) {
  try {
    const m = fs.readFileSync(file, 'utf8').match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!m) return null;
    const get = (k) => (m[1].match(new RegExp(`^${k}:\\s*(.*)$`, 'm')) || [])[1]?.replace(/^["']|["']$/g, '').trim();
    return { name: get('name'), description: get('description') || '' };
  } catch { return null; }
}

function scanSkills() {
  const dir = path.join(CLAUDE_DIR, 'skills');
  return fs.readdirSync(dir)
    .filter((n) => fs.existsSync(path.join(dir, n, 'SKILL.md'))) // follows symlinked skill folders
    .map((n) => ({ name: n, description: '', ...frontmatter(path.join(dir, n, 'SKILL.md')), folder: n }))
    .map((s) => ({ ...s, name: s.name || s.folder }));
}

function scanAgents() {
  const dir = path.join(CLAUDE_DIR, 'agents');
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .map((f) => frontmatter(path.join(dir, f)))
    .filter((a) => a && a.name); // skips memory/reference files that have no agent frontmatter
}

// Prompt-o-Matic tab reuses that app's own IPC handlers, so both apps stay in sync.
function loadPromptOMatic(cfg) {
  if (!cfg.promptOMaticPath) return false;
  try {
    require(path.join(cfg.promptOMaticPath, 'runner', 'store')).ensure();
    require(path.join(cfg.promptOMaticPath, 'src', 'ipc'))(() => win);
    return true;
  } catch (e) {
    console.error('Prompt-o-Matic not loaded:', e.message);
    return false;
  }
}

function killAll() {
  for (const p of terms.values()) { try { p.kill(); } catch {} }
  terms.clear();
}

function createWindow() {
  win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 560,
    backgroundColor: '#131519',
    title: 'Claude Hub',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
    },
  });
  win.loadFile(path.join(__dirname, 'index.html'));
  // Ctrl+R reload re-creates terminals, so drop the old ones. Main frame only:
  // the Prompt-o-Matic webview loading must not kill running Claude sessions.
  win.webContents.on('did-start-navigation', (e) => { if (e.isMainFrame && !e.isSameDocument) killAll(); });

  // Dev helper: HUB_SCREENSHOT=out.png saves a screenshot after load and quits.
  if (process.env.HUB_SCREENSHOT) {
    win.webContents.once('did-finish-load', () => setTimeout(async () => {
      if (process.env.HUB_EVAL) { await win.webContents.executeJavaScript(process.env.HUB_EVAL); await new Promise((r) => setTimeout(r, 2500)); }
      fs.writeFileSync(process.env.HUB_SCREENSHOT, (await win.webContents.capturePage()).toPNG());
      fs.writeFileSync(process.env.HUB_SCREENSHOT + '.txt', await win.webContents.executeJavaScript('hubDump()'));
      app.quit();
    }, Number(process.env.HUB_WAIT || 6000)));
  }
}

// Dev screenshots: keep painting even when the window is covered by others.
if (process.env.HUB_SCREENSHOT) app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');

app.whenReady().then(() => {
  const cfg = readConfig();
  const pomOk = loadPromptOMatic(cfg);
  ipcMain.handle('pom:ok', () => pomOk);
  createWindow();
});
app.on('window-all-closed', () => { killAll(); app.quit(); });

ipcMain.handle('hub:data', () => {
  const cfg = readConfig();
  return { config: cfg, skills: scanSkills(), agents: scanAgents(), root: ROOT };
});

// If the hub was launched from inside a Claude session, don't let tabs inherit its markers.
const cleanEnv = () => Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^CLAUDE(CODE$|_CODE_|_PID$)/.test(k)));

ipcMain.handle('term:create', (_e, id, cols, rows, sessionId) => {
  const cfg = readConfig();
  const p = pty.spawn(process.env.ComSpec || 'cmd.exe', ['/c', `${cfg.claudeCommand} --session-id ${sessionId}`], {
    name: 'xterm-256color',
    cols, rows,
    cwd: fs.existsSync(cfg.startFolder) ? cfg.startFolder : os.homedir(),
    env: cleanEnv(),
  });
  terms.set(id, p);
  p.onData((d) => win && !win.isDestroyed() && win.webContents.send('term:data', id, d));
  p.onExit(({ exitCode }) => {
    if (terms.get(id) !== p) return;
    terms.delete(id);
    win && !win.isDestroyed() && win.webContents.send('term:exit', id, exitCode);
  });
  return true;
});
ipcMain.on('term:write', (_e, id, d) => terms.get(id)?.write(d));
ipcMain.on('term:resize', (_e, id, c, r) => { try { terms.get(id)?.resize(c, r); } catch {} });
ipcMain.on('term:kill', (_e, id) => { terms.get(id)?.kill(); terms.delete(id); });
ipcMain.handle('open:config', () => shell.openPath(CONFIG));
ipcMain.handle('clip:read', () => clipboard.readText());
ipcMain.on('clip:write', (_e, t) => clipboard.writeText(t));

// Visual tab: transcript watcher (local files only, zero tokens).
ipcMain.handle('activity:start', () => { activity.start((ev) => win && !win.isDestroyed() && win.webContents.send('activity', ev)); return true; });
ipcMain.on('activity:follow', (_e, sessionId) => activity.follow(sessionId));
