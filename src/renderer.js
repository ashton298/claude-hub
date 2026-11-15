'use strict';
const $ = (s) => document.querySelector(s);
const fill = (tpl, vars) => tpl.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');

let cfg, skills, agents;
const tabs = []; // { id, kind: 'claude'|'pom', btn, pane, term, fit }
let active = null;
let nextId = 1;

// ---------- tabs ----------
function addTab(kind, label) {
  const id = kind === 'claude' ? `c${nextId++}` : kind;
  const btn = document.createElement('button');
  btn.className = 'tab';
  btn.innerHTML = `<span></span>`;
  btn.firstChild.textContent = label;
  const pane = document.createElement('div');
  pane.className = 'pane';
  $('#panes').append(pane);
  const tab = { id, kind, btn, pane };
  btn.onclick = () => activate(tab);
  if (kind === 'claude') {
    const x = document.createElement('span');
    x.className = 'close'; x.textContent = '×'; x.title = 'Close tab';
    x.onclick = (e) => { e.stopPropagation(); closeTab(tab); };
    btn.append(x);
    $('#tabs').insertBefore(btn, $('#newTab'));
  } else {
    $('#tabs').append(btn);
  }
  tabs.push(tab);
  return tab;
}

function activate(tab) {
  for (const t of tabs) { t.btn.classList.toggle('on', t === tab); t.pane.classList.toggle('on', t === tab); }
  active = tab;
  if (tab.kind === 'claude') { tab.fit.fit(); tab.term.focus(); hub.activityFollow(tab.sessionId); }
  if (tab.kind === 'visual') Visual.resize();
}

function closeTab(tab) {
  hub.termKill(tab.id);
  tab.term?.dispose();
  tab.btn.remove(); tab.pane.remove();
  tabs.splice(tabs.indexOf(tab), 1);
  if (active === tab) { const c = claudeTabs(); c.length ? activate(c[c.length - 1]) : newClaude(); }
}

const claudeTabs = () => tabs.filter((t) => t.kind === 'claude');

function newClaude() {
  const tab = addTab('claude', `Claude ${claudeTabs().length + 1}`);
  tab.term = new Terminal({
    fontFamily: 'Cascadia Mono, Consolas, monospace',
    fontSize: 14,
    cursorBlink: true,
    allowProposedApi: true,
    theme: { background: '#131519' },
  });
  tab.fit = new FitAddon.FitAddon();
  tab.term.loadAddon(tab.fit);
  // Own host element: FitAddon measures the parent, and the pane's padding made it overcount rows.
  const host = document.createElement('div');
  host.className = 'term-host';
  tab.pane.append(host);
  tab.term.open(host);
  new ResizeObserver(() => { if (active === tab) tab.fit.fit(); }).observe(host);
  clipboardKeys(tab);
  activate(tab);
  start(tab);
  tab.term.onData((d) => {
    if (tab.dead) { tab.dead = false; tab.term.reset(); start(tab); return; }
    hub.termWrite(tab.id, d);
  });
  tab.term.onResize(({ cols, rows }) => hub.termResize(tab.id, cols, rows));
  return tab;
}

// Ctrl+C copies when text is selected (else interrupts), Ctrl+V / Ctrl+Shift+V paste text,
// right-click copies the selection or pastes. No text on the clipboard: Ctrl+V goes to Claude (image paste).
function clipboardKeys(tab) {
  const t = tab.term;
  const copy = () => { hub.clipWrite(t.getSelection()); t.clearSelection(); };
  const paste = async () => {
    const text = await hub.clipRead();
    if (text) t.paste(text); else hub.termWrite(tab.id, '');
  };
  t.attachCustomKeyEventHandler((e) => {
    if (e.type !== 'keydown' || !e.ctrlKey || e.altKey) return true;
    const k = e.key.toLowerCase();
    if (k === 'c' && (e.shiftKey || t.hasSelection())) { e.preventDefault(); copy(); return false; }
    if (k === 'v') { e.preventDefault(); paste(); return false; }
    return true;
  });
  tab.pane.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    t.hasSelection() ? copy() : paste();
  });
}

// Fixed session id per run, so the Visual tab knows which transcript file is this tab's.
function start(tab) {
  tab.sessionId = crypto.randomUUID();
  hub.termCreate(tab.id, tab.term.cols, tab.term.rows, tab.sessionId);
  if (active === tab) hub.activityFollow(tab.sessionId);
}

hub.onTermData((id, d) => tabs.find((t) => t.id === id)?.term.write(d));
hub.onTermExit((id, code) => {
  const t = tabs.find((x) => x.id === id);
  if (!t) return;
  t.dead = true;
  t.term.write(`\r\n\x1b[90m[Claude exited (${code}). Press any key to restart.]\x1b[0m\r\n`);
});
window.addEventListener('resize', () => active?.fit?.fit());

// ---------- sending text to Claude ----------
function targetTab() {
  if (active?.kind === 'claude') return active;
  const c = claudeTabs();
  return c[c.length - 1] || newClaude();
}

// Bracketed paste so newlines in the text don't submit early.
function sendToClaude(text, submit) {
  const t = targetTab();
  activate(t);
  hub.termWrite(t.id, `\x1b[200~${text}\x1b[201~`);
  if (submit) setTimeout(() => hub.termWrite(t.id, '\r'), 150);
  t.term.focus();
}

// ---------- sidebar ----------
function chip(label, title, text) {
  const b = document.createElement('button');
  b.className = 'chip';
  b.textContent = label;
  b.title = title || text;
  b.dataset.search = `${label} ${title}`.toLowerCase();
  b.onclick = (e) => sendToClaude(text, e.shiftKey);
  return b;
}

function renderSidebar() {
  const byName = Object.fromEntries(skills.map((s) => [s.name, s]));
  const visible = skills.filter((s) => !cfg.hiddenSkills.includes(s.name)).sort((a, b) => a.name.localeCompare(b.name));
  $('#pinned').replaceChildren(...cfg.pinnedSkills.filter((n) => byName[n])
    .map((n) => chip(n, byName[n].description, fill(cfg.skillTemplate, { name: n }))));
  $('#skills').replaceChildren(...visible.map((s) => chip(s.name, s.description, fill(cfg.skillTemplate, { name: s.name }))));
  $('#agents').replaceChildren(...agents.map((a) => chip(a.name, a.description, fill(cfg.agentTemplate, { name: a.name }))));
  $('#snippets').replaceChildren(...cfg.snippets.map((s) => chip(s.label, s.text, s.text)));
  $('#subType').replaceChildren(...[...cfg.builtinAgents, ...agents.map((a) => a.name)].map((n) => new Option(n, n)));
}

$('#search').oninput = (e) => {
  const q = e.target.value.toLowerCase().trim();
  document.querySelectorAll('.chip').forEach((c) => { c.hidden = q && !c.dataset.search.includes(q); });
};
$('#configBtn').onclick = () => hub.openConfig();

// ---------- subagent dialog ----------
const dlg = $('#subDlg');
function openSubagent() { $('#subTask').value = ''; dlg.showModal(); $('#subTask').focus(); }
$('#subagentBtn').onclick = openSubagent;
dlg.addEventListener('close', () => {
  const task = $('#subTask').value.trim();
  if (!task || !['insert', 'send'].includes(dlg.returnValue)) return;
  sendToClaude(fill(cfg.subagentTemplate, { name: $('#subType').value, task }), dlg.returnValue === 'send');
});
$('#subTask').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.ctrlKey) { e.preventDefault(); dlg.close('send'); }
});

// ---------- shortcuts ----------
window.addEventListener('keydown', (e) => {
  if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'a') { e.preventDefault(); openSubagent(); }
  if (e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === 't') { e.preventDefault(); newClaude(); }
}, true);
$('#newTab').onclick = () => newClaude();

// ---------- Prompt-o-Matic tab ----------
async function addPom() {
  const tab = addTab('pom', 'Prompt-o-Matic');
  if (!(await hub.pomOk())) {
    tab.pane.innerHTML = `<p class="pom-missing">Prompt-o-Matic not found at <code></code>. Fix <b>promptOMaticPath</b> in config.json.</p>`;
    tab.pane.querySelector('code').textContent = cfg.promptOMaticPath;
    return;
  }
  const fileUrl = (p) => 'file:///' + p.replace(/\\/g, '/');
  const wv = document.createElement('webview');
  wv.setAttribute('preload', fileUrl(`${cfg.promptOMaticPath}\\src\\preload.js`));
  wv.setAttribute('src', fileUrl(`${cfg.promptOMaticPath}\\src\\index.html`));
  tab.pane.append(wv);
}

// Dev helper used by HUB_SCREENSHOT: text of the active Claude tab.
window.hubDump = () => {
  const b = targetTab().term.buffer.active;
  const out = [];
  for (let i = 0; i < b.length; i++) out.push(b.getLine(i).translateToString(true));
  return out.filter((l) => l.trim()).join('\n');
};

// ---------- boot ----------
(async () => {
  ({ config: cfg, skills, agents } = await hub.data());
  renderSidebar();
  newClaude();
  Visual.mount(addTab('visual', 'Visual').pane);
  hub.activityStart();
  if (cfg.promptOMaticPath) addPom();
  activate(claudeTabs()[0]);
})();
