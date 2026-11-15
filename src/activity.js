'use strict';
// Watches Claude Code's own transcript files (~/.claude/projects/<proj>/<session>.jsonl)
// and turns tool calls into small events for the Visual tab. Reads local files only:
// no model calls, so it costs zero tokens.
const fs = require('fs');
const path = require('path');
const os = require('os');

const PROJECTS = path.join(os.homedir(), '.claude', 'projects');
const REPLAY_BYTES = 400 * 1024; // how much recent history to replay when switching session

let send = () => {};
let followId = null;   // session id of the active hub Claude tab
let mainFile = null;
const offsets = new Map(); // file -> bytes read
const subParent = new Map(); // subagent file -> Agent tool_use id

const jsonls = (dir) => {
  try { return fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl')).map((f) => path.join(dir, f)); } catch { return []; }
};
const mtime = (f) => { try { return fs.statSync(f).mtimeMs; } catch { return 0; } };
const newest = (files) => files.sort((a, b) => mtime(b) - mtime(a))[0] || null;
const projectDirs = () => { try { return fs.readdirSync(PROJECTS).map((d) => path.join(PROJECTS, d)); } catch { return []; } };

// Session file to show: newest transcript in the followed session's project folder
// (so /clear and /resume, which start a new file there, are picked up), else newest anywhere.
function pickMain() {
  if (followId) {
    for (const d of projectDirs()) {
      if (fs.existsSync(path.join(d, `${followId}.jsonl`))) return newest(jsonls(d));
    }
  }
  return newest(projectDirs().flatMap(jsonls));
}

const short = (s, n = 26) => (s = String(s || '').replace(/\s+/g, ' ').trim()).length > n ? s.slice(0, n - 1) + '…' : s;
const base = (p) => path.basename(String(p || ''));

// Tool call -> { kind, label }. Labels are short words, never code.
function describe(name, input = {}) {
  if (/^(Read|NotebookRead)$/.test(name)) return { kind: 'read', label: base(input.file_path || input.notebook_path) };
  if (/^(Edit|Write|MultiEdit|NotebookEdit)$/.test(name)) return { kind: 'write', label: base(input.file_path || input.notebook_path) };
  if (/^(Bash|PowerShell|Monitor)$/.test(name)) return { kind: 'run', label: short(input.description || String(input.command || '').split(/\s/)[0]) };
  if (/^(Grep|Glob|ToolSearch)$/.test(name)) return { kind: 'search', label: short(input.pattern || input.query, 20) };
  if (/^(Agent|Task)$/.test(name)) return { kind: 'agent', label: short(input.description || input.subagent_type || 'subagent') };
  if (name === 'WebFetch') { try { return { kind: 'web', label: new URL(input.url).host }; } catch { return { kind: 'web', label: 'web page' }; } }
  if (name === 'WebSearch') return { kind: 'web', label: short(input.query, 22) };
  if (name === 'Skill') return { kind: 'skill', label: input.skill || 'skill' };
  if (name.startsWith('mcp__')) return { kind: 'mcp', label: short(name.split('__').slice(1).join(' ').replace(/_/g, ' '), 24) };
  return { kind: 'other', label: name };
}

function parseLine(line, parent) {
  let o;
  try { o = JSON.parse(line); } catch { return; }
  const content = o.message && Array.isArray(o.message.content) ? o.message.content : [];
  if (o.type === 'assistant') {
    for (const c of content) {
      if (c.type === 'tool_use') send({ t: 'tool', id: c.id, parent, name: c.name, ...describe(c.name, c.input) });
      else if (c.type === 'text' && c.text && c.text.trim()) send({ t: 'say', parent });
      else if (c.type === 'thinking') send({ t: 'think', parent });
    }
  } else if (o.type === 'user') {
    for (const c of content) if (c.type === 'tool_result') send({ t: 'result', id: c.tool_use_id, error: !!c.is_error });
    if (typeof o.message?.content === 'string' && !parent) send({ t: 'prompt' });
  }
}

function readNew(file, parent) {
  const size = (() => { try { return fs.statSync(file).size; } catch { return 0; } })();
  let from = offsets.get(file);
  if (from === undefined) from = Math.max(0, size - REPLAY_BYTES);
  if (size <= from) { offsets.set(file, size); return; }
  const fd = fs.openSync(file, 'r');
  const buf = Buffer.alloc(size - from);
  fs.readSync(fd, buf, 0, buf.length, from);
  fs.closeSync(fd);
  const text = buf.toString('utf8');
  const end = text.lastIndexOf('\n'); // only whole lines; the rest is read next tick
  if (end < 0) return;
  let lines = text.slice(0, end).split('\n');
  if (from > 0 && !offsets.has(file)) lines = lines.slice(1); // first line of a replay is partial
  offsets.set(file, from + Buffer.byteLength(text.slice(0, end + 1)));
  for (const l of lines) if (l.trim()) parseLine(l, parent);
}

function tick() {
  const f = pickMain();
  if (!f) return;
  if (f !== mainFile) {
    mainFile = f;
    offsets.clear(); subParent.clear();
    send({ t: 'session', project: path.basename(path.dirname(f)).replace(/^C--Users-[^-]+-?/, '') || 'home', id: path.basename(f, '.jsonl') });
  }
  readNew(mainFile, null);
  const subDir = path.join(mainFile.replace(/\.jsonl$/, ''), 'subagents');
  for (const sf of jsonls(subDir)) {
    if (!subParent.has(sf)) {
      try { subParent.set(sf, JSON.parse(fs.readFileSync(sf.replace(/\.jsonl$/, '.meta.json'), 'utf8')).toolUseId); }
      catch { continue; } // meta not written yet; try next tick
    }
    readNew(sf, subParent.get(sf));
  }
}

let timer;
module.exports = {
  start(sendFn) {
    send = sendFn;
    mainFile = null; // force a replay for a freshly loaded renderer
    clearInterval(timer);
    timer = setInterval(() => { try { tick(); } catch (e) { console.error('activity:', e.message); } }, 700);
    tick();
  },
  follow(id) { if (id !== followId) { followId = id; } },
  describe, // exported for the self-check
};
