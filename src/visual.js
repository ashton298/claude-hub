'use strict';
// Visual tab: a live 2D graph of what Claude is doing, drawn on a canvas.
// Events come from activity.js (transcript files on disk), so this costs no tokens.
// Tweak the look with the constants below.

const Visual = (() => {
  // ---------- look & feel ----------
  const COLORS = {
    core: '#d97757', read: '#5aa9ff', write: '#ff9f43', run: '#3ddc97', search: '#b884ff',
    agent: '#ff5d8f', web: '#2ee6d6', skill: '#ffd166', mcp: '#8fa3bf', other: '#9aa4b2', error: '#ff4d4d',
  };
  const VERB = {
    read: 'Reading', write: 'Editing', run: 'Running', search: 'Searching', agent: 'Subagent',
    web: 'Browsing', skill: 'Using skill', mcp: 'Using tool', other: 'Using',
  };
  const MAX_NODES = 70;       // oldest finished nodes are dropped past this
  const FADE_AFTER = 60e3;    // ms before a finished node starts to dim
  const IDLE_AFTER = 8e3;     // ms of quiet before the HUD says Idle
  const LINK_LEN = { core: 190, agent: 95 };
  const BG = '#0b0d12';

  let canvas, ctx, hud, W = 0, H = 0, dpr = 1;
  let nodes = [], links = [], fx = [], stars = [];
  const byId = new Map();   // tool_use id -> node
  const byKey = new Map();  // parent|kind|label -> node (same file touched again reuses its node)
  const counts = {};
  const ticker = [];
  let core, lastEvent = 0, thinkUntil = 0, now = performance.now();
  let session = { project: '' };

  // ---------- setup ----------
  function mount(pane) {
    pane.classList.add('visual-pane');
    canvas = document.createElement('canvas');
    canvas.className = 'visual';
    hud = document.createElement('div');
    hud.className = 'vhud';
    hud.innerHTML = `
      <div class="vh-top"><span class="vh-dot"></span><span class="vh-state">Waiting</span><span class="vh-proj"></span></div>
      <div class="vh-now"><span class="vh-verb">Waiting for Claude</span><span class="vh-label"></span></div>
      <div class="vh-counts"></div>
      <ol class="vh-ticker"></ol>`;
    pane.append(canvas, hud);
    ctx = canvas.getContext('2d');
    reset();
    for (let i = 0; i < 140; i++) stars.push({ x: Math.random(), y: Math.random(), z: Math.random() * 0.8 + 0.2, tw: Math.random() * 6 });
    window.addEventListener('resize', resize);
    hub.onActivity(onEvent);
    requestAnimationFrame(frame);
  }

  function resize() {
    if (!canvas || !canvas.clientWidth) return;
    dpr = window.devicePixelRatio || 1;
    W = canvas.clientWidth; H = canvas.clientHeight;
    canvas.width = W * dpr; canvas.height = H * dpr;
  }

  function reset() {
    nodes = []; links = []; fx = [];
    byId.clear(); byKey.clear();
    for (const k in counts) delete counts[k];
    ticker.length = 0;
    core = { x: 0, y: 0, vx: 0, vy: 0, r: 30, kind: 'core', fixed: true, born: now, pulse: 1, children: 0 };
    nodes.push(core);
    renderHud();
  }

  // ---------- events ----------
  function onEvent(ev) {
    lastEvent = performance.now();
    if (ev.t === 'session') { reset(); session = ev; push('Watching ' + (ev.project || 'session')); return; }
    if (ev.t === 'think') { thinkUntil = lastEvent + 2500; setNow('Thinking', ''); return; }
    if (ev.t === 'say') { core.pulse = 1; setNow('Writing a reply', ''); return; }
    if (ev.t === 'prompt') { core.pulse = 1.6; ring(core, COLORS.core, 2); push('New prompt'); setNow('Got a new prompt', ''); return; }
    if (ev.t === 'result') {
      const n = byId.get(ev.id);
      if (!n) return;
      n.pending = Math.max(0, n.pending - 1);
      n.done = performance.now();
      if (ev.error) { n.error = performance.now(); ring(n, COLORS.error, 1.4); }
      else { ring(n, COLORS[n.kind], 0.8); packet(n, n.parent, COLORS[n.kind], true); }
      return;
    }
    if (ev.t !== 'tool') return;
    const parent = (ev.parent && byId.get(ev.parent)) || core;
    const key = `${ev.parent || 'core'}|${ev.kind}|${ev.label}`;
    let n = byKey.get(key);
    if (n && nodes.includes(n)) {
      n.hits++; n.pending++; n.pulse = 1; n.born = performance.now();
    } else {
      const a = Math.random() * Math.PI * 2;
      n = {
        x: parent.x + Math.cos(a) * 30, y: parent.y + Math.sin(a) * 30, vx: Math.cos(a) * 4, vy: Math.sin(a) * 4,
        kind: ev.kind, label: ev.label, parent, hits: 1, pending: 1, pulse: 1, born: performance.now(), children: 0,
        r: ev.kind === 'agent' ? 18 : 11, spin: Math.random() * 6,
      };
      parent.children++;
      nodes.push(n);
      links.push({ a: parent, b: n });
      byKey.set(key, n);
      sparks(n, COLORS[ev.kind]);
      prune();
    }
    byId.set(ev.id, n);
    parent.pulse = 1;
    packet(parent, n, COLORS[ev.kind], false);
    counts[ev.kind] = (counts[ev.kind] || 0) + 1;
    setNow(VERB[ev.kind], ev.label);
    push(`${VERB[ev.kind]} ${ev.label}`, ev.kind);
  }

  function prune() {
    while (nodes.length > MAX_NODES) {
      const victim = nodes.find((n) => n !== core && !n.pending && !n.children);
      if (!victim) return;
      nodes.splice(nodes.indexOf(victim), 1);
      links = links.filter((l) => l.b !== victim);
      victim.parent.children--;
    }
  }

  // ---------- HUD (DOM, easier to style than canvas text) ----------
  let nowText = ['Waiting for Claude', ''];
  function setNow(verb, label) { nowText = [verb, label]; renderHud(); }
  function push(text, kind) {
    ticker.unshift({ text, kind, t: Date.now() });
    ticker.length = Math.min(ticker.length, 7);
    renderHud();
  }
  function renderHud() {
    if (!hud) return;
    hud.querySelector('.vh-verb').textContent = nowText[0];
    hud.querySelector('.vh-label').textContent = nowText[1];
    hud.querySelector('.vh-proj').textContent = session.project ? `· ${session.project}` : '';
    hud.querySelector('.vh-counts').innerHTML = Object.keys(VERB).filter((k) => counts[k])
      .map((k) => `<span><i style="background:${COLORS[k]}"></i>${VERB[k]} <b>${counts[k]}</b></span>`).join('');
    const ol = hud.querySelector('.vh-ticker');
    ol.replaceChildren(...ticker.map((t, i) => {
      const li = document.createElement('li');
      li.textContent = t.text;
      li.style.opacity = 1 - i * 0.13;
      if (t.kind) li.style.setProperty('--c', COLORS[t.kind]);
      return li;
    }));
  }

  // ---------- effects ----------
  function ring(n, color, size) { fx.push({ type: 'ring', n, color, size, t0: performance.now() }); }
  function sparks(n, color) {
    for (let i = 0; i < 14; i++) {
      const a = Math.random() * Math.PI * 2, s = 1 + Math.random() * 3;
      fx.push({ type: 'spark', x: n.x, y: n.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, color, t0: performance.now(), life: 500 + Math.random() * 500 });
    }
  }
  function packet(a, b, color, back) { fx.push({ type: 'packet', a, b, color, back, t0: performance.now(), dur: 650 }); }

  // ---------- physics ----------
  function step(dt) {
    const k = Math.min(dt, 32) / 16;
    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i];
      for (let j = i + 1; j < nodes.length; j++) {
        const b = nodes[j];
        let dx = b.x - a.x, dy = b.y - a.y, d2 = dx * dx + dy * dy + 0.01;
        if (d2 > 90000) continue;
        const f = 900 / d2, d = Math.sqrt(d2);
        dx /= d; dy /= d;
        if (!a.fixed) { a.vx -= dx * f * k; a.vy -= dy * f * k; }
        if (!b.fixed) { b.vx += dx * f * k; b.vy += dy * f * k; }
      }
    }
    for (const l of links) {
      const rest = LINK_LEN[l.a.kind] || 80;
      const dx = l.b.x - l.a.x, dy = l.b.y - l.a.y, d = Math.hypot(dx, dy) || 1;
      const f = (d - rest) * 0.004 * k;
      l.b.vx -= (dx / d) * f; l.b.vy -= (dy / d) * f;
      if (!l.a.fixed) { l.a.vx += (dx / d) * f * 0.5; l.a.vy += (dy / d) * f * 0.5; }
    }
    const bx = W / 2 - 40, by = H / 2 - 40;
    for (const n of nodes) {
      if (n.fixed) continue;
      n.vx -= n.x * 0.0004 * k; n.vy -= n.y * 0.0004 * k; // gentle pull to center
      n.vx *= 0.9; n.vy *= 0.9;
      n.x = Math.max(-bx, Math.min(bx, n.x + n.vx * k));
      n.y = Math.max(-by, Math.min(by, n.y + n.vy * k));
      n.pulse *= 0.96;
    }
    core.pulse *= 0.96;
  }

  // ---------- drawing ----------
  function frame(t) {
    requestAnimationFrame(frame);
    const dt = t - now; now = t;
    if (!canvas.offsetParent) return; // tab hidden: skip work
    if (canvas.width !== Math.round(canvas.clientWidth * dpr)) resize();
    step(dt);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawBackground(t);
    ctx.save();
    ctx.translate(W / 2 + 120, H / 2); // offset right so the HUD on the left stays clear
    for (const l of links) drawLink(l, t);
    for (const f of fx) if (f.type === 'packet') drawPacket(f, t);
    for (const n of nodes) if (n !== core) drawNode(n, t);
    drawCore(t);
    for (const f of fx) if (f.type !== 'packet') drawFx(f, t);
    ctx.restore();
    fx = fx.filter((f) => t - f.t0 < (f.life || f.dur || 900));
    const idle = t - lastEvent > IDLE_AFTER && !nodes.some((n) => n.pending);
    hud.classList.toggle('idle', idle);
    hud.querySelector('.vh-state').textContent = lastEvent ? (idle ? 'Idle' : 'Working') : 'Waiting';
  }

  function drawBackground(t) {
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, W, H);
    const g = ctx.createRadialGradient(W / 2 + 120, H / 2, 0, W / 2 + 120, H / 2, Math.max(W, H) * 0.7);
    g.addColorStop(0, 'rgba(217,119,87,0.07)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(255,255,255,0.035)'; // dot grid
    for (let x = 12; x < W; x += 28) for (let y = 12; y < H; y += 28) ctx.fillRect(x, y, 1.2, 1.2);
    for (const s of stars) { // slow drifting stars
      const x = ((s.x * W + t * 0.006 * s.z) % W), y = s.y * H;
      ctx.globalAlpha = (0.25 + 0.25 * Math.sin(t / 900 + s.tw)) * s.z;
      ctx.fillStyle = '#cfd8ff';
      ctx.fillRect(x, y, s.z * 1.6, s.z * 1.6);
    }
    ctx.globalAlpha = 1;
  }

  const age = (n) => (n.pending ? 1 : Math.max(0.28, 1 - Math.max(0, now - n.born - FADE_AFTER) / 40e3));

  function curve(a, b) {
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2, dx = b.x - a.x, dy = b.y - a.y;
    return { cx: mx - dy * 0.18, cy: my + dx * 0.18 };
  }
  function pointOn(a, b, p) {
    const { cx, cy } = curve(a, b), q = 1 - p;
    return { x: q * q * a.x + 2 * q * p * cx + p * p * b.x, y: q * q * a.y + 2 * q * p * cy + p * p * b.y };
  }

  function drawLink(l, t) {
    const { a, b } = l, c = COLORS[b.kind], alpha = age(b);
    const { cx, cy } = curve(a, b);
    const g = ctx.createLinearGradient(a.x, a.y, b.x, b.y);
    g.addColorStop(0, hexA(COLORS[a.kind] || COLORS.core, 0.15 * alpha));
    g.addColorStop(1, hexA(c, 0.7 * alpha));
    ctx.strokeStyle = g;
    ctx.lineWidth = b.pending ? 2 : 1.2;
    ctx.setLineDash(b.pending ? [6, 6] : []);
    ctx.lineDashOffset = -t / 30;
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.quadraticCurveTo(cx, cy, b.x, b.y); ctx.stroke();
    ctx.setLineDash([]);
    if (b.pending) { // stream of dots while the tool is running
      for (let i = 0; i < 3; i++) {
        const p = ((t / 900) + i / 3) % 1, pt = pointOn(a, b, p);
        glowDot(pt.x, pt.y, 2.2, c, 0.9);
      }
    }
  }

  function drawPacket(f, t) {
    const p = Math.min(1, (t - f.t0) / f.dur), e = 1 - Math.pow(1 - p, 3);
    const pt = f.back ? pointOn(f.b, f.a, 1 - e) : pointOn(f.a, f.b, e);
    glowDot(pt.x, pt.y, 4, f.color, 1 - p * 0.4);
  }

  function drawNode(n, t) {
    const c = n.error && t - n.error < 1500 ? COLORS.error : COLORS[n.kind];
    const alpha = age(n);
    const shake = n.error && t - n.error < 500 ? Math.sin(t / 20) * 3 : 0;
    const x = n.x + shake, y = n.y, r = n.r + Math.min(6, (n.hits - 1) * 1.5) + n.pulse * 4;
    ctx.globalAlpha = alpha;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r * 3); // glow
    g.addColorStop(0, hexA(c, 0.35 + n.pulse * 0.3));
    g.addColorStop(1, hexA(c, 0));
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, r * 3, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#12151c';
    ctx.strokeStyle = c;
    ctx.lineWidth = 2;
    shape(n.kind, x, y, r, t + n.spin * 1000);
    ctx.fill(); ctx.stroke();
    icon(n.kind, x, y, r * 0.55, c);
    if (n.pending) { // spinning arc while running
      ctx.beginPath();
      ctx.arc(x, y, r + 5, t / 200, t / 200 + 1.6);
      ctx.strokeStyle = hexA(c, 0.9); ctx.lineWidth = 2; ctx.stroke();
    }
    if (n.hits > 1) {
      ctx.fillStyle = c; ctx.font = '600 10px "Segoe UI"'; ctx.textAlign = 'center';
      ctx.fillText(`×${n.hits}`, x + r + 6, y - r);
    }
    ctx.fillStyle = `rgba(228,230,235,${0.85 * alpha})`;
    ctx.font = '11px "Segoe UI"'; ctx.textAlign = 'center';
    ctx.fillText(n.label, x, y + r + 16);
    ctx.globalAlpha = 1;
  }

  function shape(kind, x, y, r, t) {
    ctx.beginPath();
    const poly = (sides, rot) => {
      for (let i = 0; i < sides; i++) {
        const a = rot + (i / sides) * Math.PI * 2;
        i ? ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r) : ctx.moveTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
      }
      ctx.closePath();
    };
    if (kind === 'write') poly(4, 0);
    else if (kind === 'run') ctx.roundRect(x - r * 0.85, y - r * 0.85, r * 1.7, r * 1.7, 4);
    else if (kind === 'search') poly(3, -Math.PI / 2);
    else if (kind === 'agent') poly(6, t / 3000);
    else if (kind === 'skill') { for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * 0.5 : r * 1.1; i ? ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr) : ctx.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); } ctx.closePath(); }
    else ctx.arc(x, y, r, 0, Math.PI * 2);
  }

  // Tiny line icons inside each node.
  function icon(kind, x, y, s, c) {
    ctx.save();
    ctx.strokeStyle = c; ctx.fillStyle = c; ctx.lineWidth = 1.6; ctx.lineCap = 'round';
    ctx.beginPath();
    if (kind === 'read') { ctx.ellipse(x, y, s, s * 0.55, 0, 0, Math.PI * 2); ctx.stroke(); ctx.beginPath(); ctx.arc(x, y, s * 0.25, 0, 7); ctx.fill(); }
    else if (kind === 'write') { ctx.moveTo(x - s * 0.6, y + s * 0.6); ctx.lineTo(x + s * 0.6, y - s * 0.6); ctx.moveTo(x - s * 0.6, y + s * 0.6); ctx.lineTo(x - s * 0.3, y + s * 0.3); ctx.stroke(); }
    else if (kind === 'run') { ctx.moveTo(x - s * 0.6, y - s * 0.45); ctx.lineTo(x - s * 0.1, y); ctx.lineTo(x - s * 0.6, y + s * 0.45); ctx.moveTo(x, y + s * 0.5); ctx.lineTo(x + s * 0.6, y + s * 0.5); ctx.stroke(); }
    else if (kind === 'search') { ctx.arc(x - s * 0.1, y + s * 0.05, s * 0.35, 0, 7); ctx.moveTo(x + s * 0.15, y + s * 0.3); ctx.lineTo(x + s * 0.45, y + s * 0.6); ctx.stroke(); }
    else if (kind === 'web') { ctx.arc(x, y, s * 0.7, 0, 7); ctx.moveTo(x - s * 0.7, y); ctx.lineTo(x + s * 0.7, y); ctx.ellipse(x, y, s * 0.3, s * 0.7, 0, 0, 7); ctx.stroke(); }
    else if (kind === 'agent') { ctx.arc(x, y, s * 0.35, 0, 7); ctx.fill(); }
    else if (kind === 'skill') { ctx.arc(x, y, s * 0.2, 0, 7); ctx.fill(); }
    else { ctx.arc(x, y, s * 0.3, 0, 7); ctx.stroke(); }
    ctx.restore();
  }

  function drawCore(t) {
    const thinking = t < thinkUntil;
    const speed = thinking ? 600 : 2400;
    const r = core.r + core.pulse * 8 + Math.sin(t / 700) * 1.5;
    const c = COLORS.core;
    let g = ctx.createRadialGradient(0, 0, 0, 0, 0, r * 4);
    g.addColorStop(0, hexA(c, 0.45 + core.pulse * 0.2));
    g.addColorStop(1, hexA(c, 0));
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(0, 0, r * 4, 0, Math.PI * 2); ctx.fill();
    // orbit rings
    ctx.strokeStyle = hexA(c, 0.35); ctx.lineWidth = 1;
    ctx.setLineDash([3, 7]); ctx.lineDashOffset = -t / 40;
    ctx.beginPath(); ctx.arc(0, 0, r + 22, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);
    for (let i = 0; i < 3; i++) {
      const a = t / speed + (i * Math.PI * 2) / 3;
      glowDot(Math.cos(a) * (r + 22), Math.sin(a) * (r + 22), 2.5, c, 1);
    }
    // core body + spark rays
    g = ctx.createRadialGradient(-r * 0.3, -r * 0.3, 0, 0, 0, r);
    g.addColorStop(0, '#ffb49a'); g.addColorStop(1, c);
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#fff4ee'; ctx.lineWidth = 2.4; ctx.lineCap = 'round';
    const rot = t / (thinking ? 900 : 4000);
    for (let i = 0; i < 8; i++) {
      const a = rot + (i * Math.PI) / 4, len = r * (i % 2 ? 0.42 : 0.62);
      ctx.beginPath(); ctx.moveTo(Math.cos(a) * r * 0.12, Math.sin(a) * r * 0.12); ctx.lineTo(Math.cos(a) * len, Math.sin(a) * len); ctx.stroke();
    }
  }

  function drawFx(f, t) {
    const p = (t - f.t0) / (f.life || 900);
    if (f.type === 'ring') {
      ctx.strokeStyle = hexA(f.color, 1 - p);
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(f.n.x, f.n.y, f.n.r + p * 40 * f.size, 0, Math.PI * 2); ctx.stroke();
    } else if (f.type === 'spark') {
      f.x += f.vx; f.y += f.vy; f.vx *= 0.94; f.vy *= 0.94;
      glowDot(f.x, f.y, 1.6, f.color, 1 - p);
    }
  }

  function glowDot(x, y, r, c, a) {
    ctx.save();
    ctx.globalAlpha *= Math.max(0, a);
    ctx.fillStyle = hexA(c, 0.25);
    ctx.beginPath(); ctx.arc(x, y, r * 3, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = c;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  function hexA(hex, a) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${Math.max(0, Math.min(1, a))})`;
  }

  return { mount, resize };
})();
