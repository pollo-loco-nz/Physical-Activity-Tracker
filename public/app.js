// Move Club frontend — plain JS, hash routing, Chart.js for graphs.

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = (n) => String(n).padStart(2, '0');
const dayKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const startOfWeek = (d) => { const s = startOfDay(d); return addDays(s, -((s.getDay() + 6) % 7)); }; // Monday
const fmtNum = (n, dp = 0) => Number(n).toLocaleString(undefined, { maximumFractionDigits: dp });

const state = { me: null, config: null, charts: [], feedTimer: null };

// ---------- API ----------
async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch('/api' + path, {
    method,
    headers: body !== undefined ? { 'content-type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  let data = null;
  try { data = await res.json(); } catch {}
  if (!res.ok) {
    const err = new Error(data?.error || `Request failed (${res.status})`);
    err.status = res.status;
    if (res.status === 401 && state.me) { state.me = null; showAuth(); }
    throw err;
  }
  return data;
}

// ---------- formatting ----------
function dayLabel(d) {
  const today = startOfDay(new Date());
  const day = startOfDay(d);
  const diff = Math.round((today - day) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  if (diff < 7) return d.toLocaleDateString(undefined, { weekday: 'long' });
  return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}
function actMeta(a) {
  const bits = [];
  if (a.type && a.type !== 'other') bits.push(a.type);
  if (a.duration_min) bits.push(`${a.duration_min} min`);
  if (a.distance_km) bits.push(`${fmtNum(a.distance_km, 2)} km`);
  return bits;
}
const initials = (name) => esc((name || '?').trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase());
const avatar = (u, cls = '') => `<a class="avatar ${cls}" href="#/u/${esc(u.username)}" style="--c:${esc(u.color)}" title="${esc(u.display_name)}">${initials(u.display_name)}</a>`;
const userLink = (u) => `<a href="#/u/${esc(u.username)}">${esc(u.display_name)}</a>`;

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('show'), 2200);
}

// ---------- orchard drawing ----------
const FRUIT_TYPES = {
  apple:   { label: 'Apple',   shape: 'round',  raw: '#9ccc65', ripe: '#e53935', blossom: '#f8bbd0', eye: '#fbc02d', leaf: true },
  pear:    { label: 'Pear',    shape: 'pear',   raw: '#aed581', ripe: '#d4c13a', blossom: '#ffffff', eye: '#8d6e63', leaf: true },
  orange:  { label: 'Orange',  shape: 'round',  raw: '#7cb342', ripe: '#fb8c00', blossom: '#ffffff', eye: '#fdd835', leaf: true },
  lemon:   { label: 'Lemon',   shape: 'oval',   raw: '#8bc34a', ripe: '#fdd835', blossom: '#fff8e1', eye: '#f9a825', leaf: true },
  feijoa:  { label: 'Feijoa',  shape: 'oval',   raw: '#aed581', ripe: '#4e7d2a', blossom: '#e53935', eye: '#ffffff', leaf: false },
  plum:    { label: 'Plum',    shape: 'round',  raw: '#9ccc65', ripe: '#6a1b9a', blossom: '#fce4ec', eye: '#fbc02d', leaf: false },
  cherry:  { label: 'Cherry',  shape: 'cherry', raw: '#aed581', ripe: '#b71c1c', blossom: '#f8bbd0', eye: '#fbc02d', leaf: false },
  peach:   { label: 'Peach',   shape: 'round',  raw: '#c5e1a5', ripe: '#ff9e6b', blossom: '#f48fb1', eye: '#ad1457', leaf: true },
  avocado: { label: 'Avocado', shape: 'pear',   raw: '#9ccc65', ripe: '#33691e', blossom: '#f0f4c3', eye: '#c0ca33', leaf: false },
};
const fruitType = (name) => FRUIT_TYPES[name] || FRUIT_TYPES.apple;
const fruitPlural = (name) => { const l = fruitType(name).label.toLowerCase(); return l.endsWith('ch') ? l + 'es' : l.endsWith('y') ? l.slice(0, -1) + 'ies' : l + 's'; };
const lerp = (a, b, t) => a + (b - a) * t;
const clamp01 = (v) => Math.max(0, Math.min(1, v));
function mix(c1, c2, t) {
  const p = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
  const [a, b] = [p(c1), p(c2)];
  return '#' + a.map((v, i) => Math.round(lerp(v, b[i], clamp01(t))).toString(16).padStart(2, '0')).join('');
}

// One fruit of the given type, centred on (x, y) with radius r.
function drawFruit(type, x, y, r, color) {
  const ft = fruitType(type);
  const shine = (cx, cy, rr) => `<circle cx="${cx - rr * 0.35}" cy="${cy - rr * 0.35}" r="${rr * 0.28}" fill="#fff" opacity=".35"/>`;
  const stem = (sx, sy, len) => `<path d="M${sx} ${sy} q1 ${-len * 0.6} ${len * 0.5} ${-len}" stroke="#6d4c41" stroke-width="${Math.max(1, r * 0.16)}" fill="none" stroke-linecap="round"/>`;
  const leaf = (lx, ly) => (ft.leaf ? `<ellipse cx="${lx + r * 0.45}" cy="${ly - r * 0.25}" rx="${r * 0.45}" ry="${r * 0.2}" transform="rotate(-30 ${lx + r * 0.45} ${ly - r * 0.25})" fill="#66bb6a"/>` : '');
  switch (ft.shape) {
    case 'pear':
      return `<g><circle cx="${x}" cy="${y - r * 0.55}" r="${r * 0.6}" fill="${color}"/><circle cx="${x}" cy="${y + r * 0.2}" r="${r * 0.85}" fill="${color}"/>${shine(x, y + r * 0.2, r * 0.85)}${stem(x, y - r * 1.1, r * 0.6)}${leaf(x, y - r * 1.1)}</g>`;
    case 'oval':
      return `<g><ellipse cx="${x}" cy="${y}" rx="${r * 0.78}" ry="${r * 1.05}" transform="rotate(-18 ${x} ${y})" fill="${color}"/>${shine(x, y, r * 0.85)}${stem(x - r * 0.25, y - r * 0.95, r * 0.45)}${leaf(x - r * 0.25, y - r * 0.95)}</g>`;
    case 'cherry': {
      const cr = r * 0.6;
      return `<g><path d="M${x - r * 0.5} ${y + r * 0.2} Q${x - r * 0.2} ${y - r * 0.9} ${x + r * 0.15} ${y - r * 1.25} M${x + r * 0.5} ${y + r * 0.3} Q${x + r * 0.3} ${y - r * 0.7} ${x + r * 0.15} ${y - r * 1.25}" stroke="#6d4c41" stroke-width="${Math.max(1, r * 0.13)}" fill="none"/>` +
        `<circle cx="${x - r * 0.5}" cy="${y + r * 0.35}" r="${cr}" fill="${color}"/><circle cx="${x + r * 0.5}" cy="${y + r * 0.45}" r="${cr}" fill="${color}"/>${shine(x - r * 0.5, y + r * 0.35, cr)}</g>`;
    }
    default:
      return `<g><circle cx="${x}" cy="${y}" r="${r}" fill="${color}"/>${shine(x, y, r)}${stem(x, y - r, r * 0.7)}${leaf(x, y - r)}</g>`;
  }
}
function fruitIcon(type, size = 14) {
  return `<svg class="fruit-ico" width="${size}" height="${size}" viewBox="0 0 20 20" aria-hidden="true">${drawFruit(type, 10, 11.5, 6.5, fruitType(type).ripe)}</svg>`;
}
function blossom(x, y, ft, r = 4) {
  const petals = [0, 72, 144, 216, 288].map((a) => {
    const rad = (a * Math.PI) / 180;
    return `<circle cx="${x + Math.cos(rad) * r * 0.55}" cy="${y + Math.sin(rad) * r * 0.55}" r="${r * 0.55}" fill="${ft.blossom}" stroke="rgba(0,0,0,.08)" stroke-width=".5"/>`;
  }).join('');
  return `<g>${petals}<circle cx="${x}" cy="${y}" r="${r * 0.32}" fill="${ft.eye}"/></g>`;
}

// Canopy clusters appear centre-out; flower/fruit spots sit on the canopy.
const CANOPY = [[100, 84, 40], [80, 62, 26], [120, 62, 26], [66, 98, 28], [134, 98, 28], [100, 116, 24], [100, 48, 22], [54, 80, 20], [146, 80, 20]];
const SPOTS = [[98, 60], [66, 94], [134, 90], [84, 118], [118, 120], [120, 70], [76, 72], [104, 96], [56, 76], [146, 78]];
const GROUND_LEAVES = [[40, 189], [62, 192], [150, 190], [168, 192], [84, 193], [126, 192], [30, 192], [176, 189], [56, 187], [140, 187], [108, 193], [72, 188], [158, 193], [92, 189]];
const STAGE_LABEL = { grow: 'Growing', leaves: 'Leafing up', flowers: 'Flowering', fruit: 'Fruiting', fall: 'Leaves falling' };

function stageText(o) {
  if (!o) return '';
  if (o.stage === 'fruit') return `Fruiting · ${o.fruit.filter((f) => f.done).length}/${o.crop} picked`;
  return STAGE_LABEL[o.stage];
}
function nextText(o, fruitLabel) {
  const n = o.steps_left;
  const acts = (k) => `${k} more ${k === 1 ? 'activity' : 'activities'}`;
  switch (o.stage) {
    case 'grow': return `Leaves come in ${acts(n)}.`;
    case 'leaves': return `Blossom in ${acts(n)}.`;
    case 'flowers': return `${o.crop} ${fruitLabel} set in ${acts(n)}.`;
    case 'fruit': return `Every activity feeds one of your ${fruitLabel} — ripe ones drop into the basket.`;
    case 'fall': return `New season starts in ${acts(n)}.`;
  }
  return '';
}

// The tree + basket picture for one person.
function orchardSvg(o, fruitName, { label = '' } = {}) {
  const ft = fruitType(fruitName);
  const stage = o?.stage || 'grow';
  const prog = o?.progress || 0;
  const scale = stage === 'grow' ? 0.35 + 0.65 * prog : 1;

  // canopy
  let canopy = '';
  if (stage !== 'grow') {
    const fallT = stage === 'fall' ? prog : 0;
    const showN = stage === 'leaves' ? prog * CANOPY.length + 0.6 : stage === 'fall' ? CANOPY.length * (1 - fallT * 0.9) : CANOPY.length;
    CANOPY.forEach(([cx, cy, r], i) => {
      const k = clamp01(showN - i);
      if (k <= 0) return;
      const at = fallT * 1.5 - i * 0.04;
      const autumn = (base, gold, rust) => (at < 0.5 ? mix(base, gold, at * 2) : mix(gold, rust, (at - 0.5) * 2));
      const dark = autumn(cssLeaf('--leaf-dark'), '#d39a1f', '#b4471c');
      const light = autumn(cssLeaf('--leaf'), '#f0c043', '#d9662a');
      canopy += `<circle cx="${cx}" cy="${cy}" r="${r * k}" fill="${dark}"/><circle cx="${cx - r * 0.2}" cy="${cy - r * 0.2}" r="${r * 0.62 * k}" fill="${light}"/>`;
    });
  } else if (prog > 0.5) {
    // little leaf buds at the branch tips near the end of growing
    canopy = [[70, 96], [132, 92], [100, 70], [60, 100], [140, 104], [82, 66], [120, 64]]
      .map(([x, y]) => `<circle cx="${x}" cy="${y}" r="${(prog - 0.5) * 8}" fill="${cssLeaf('--leaf')}"/>`).join('');
  }

  // blossoms / fruit on the tree
  let onTree = '';
  if (stage === 'flowers') {
    const n = Math.ceil(prog * SPOTS.length) || 1;
    onTree = SPOTS.slice(0, n).map(([x, y]) => blossom(x, y, ft)).join('');
  } else if (stage === 'fruit') {
    onTree = (o.fruit || []).map((f, i) => {
      if (f.done) return '';
      const [x, y] = SPOTS[i % SPOTS.length];
      const t = f.growth / f.need;
      return `<g class="on-tree"><title>${Math.round(t * 100)}% ripe</title>${drawFruit(fruitName, x, y, lerp(5, 10, t), mix(ft.raw, ft.ripe, t))}</g>`;
    }).join('');
  }

  // fallen leaves on the ground
  const fallen = stage === 'fall'
    ? GROUND_LEAVES.slice(0, Math.round(prog * GROUND_LEAVES.length) + 2).map(([x, y], i) => `<ellipse cx="${x}" cy="${y}" rx="4" ry="1.8" transform="rotate(${(i * 47) % 60 - 30} ${x} ${y})" fill="${['#e8a33a', '#c0631d', '#d4882a'][i % 3]}"/>`).join('')
    : '';

  const n = o?.basket || 0;
  const pile = [[0, 0], [-11, 2], [11, 2], [-5.5, -8], [5.5, -8], [0, -16]].slice(0, Math.min(n, 6))
    .map(([dx, dy]) => drawFruit(fruitName, 250 + dx, 150 + dy, 6.5, ft.ripe)).join('');
  const branches = [[100, 130, 70, 96, 6], [100, 130, 132, 92, 6], [100, 124, 100, 70, 6], [84, 108, 60, 100, 3.5], [116, 106, 140, 104, 3.5], [100, 94, 82, 66, 3.5], [100, 92, 120, 64, 3.5]]
    .map(([x1, y1, x2, y2, w]) => `<path d="M${x1} ${y1} Q${(x1 + x2) / 2} ${(y1 + y2) / 2 + 6} ${x2} ${y2}" stroke="#8d6e4c" stroke-width="${w}" fill="none" stroke-linecap="round"/>`).join('');

  return `<svg class="orchard" viewBox="0 0 300 200" role="img" aria-label="${esc(label)}'s ${esc(ft.label.toLowerCase())} tree: ${esc(stageText(o))}, ${n} in the basket">
    <ellipse cx="160" cy="191" rx="135" ry="7" fill="var(--ground)"/>
    ${fallen}
    <g transform="translate(100 190) scale(${scale}) translate(-100 -190)">
      <path d="M93 190 C96 165 97 145 95 126 L105 126 C103 145 104 165 107 190 Z" fill="#8d6e4c"/>
      ${branches}${canopy}${onTree}
    </g>
    ${pile}
    <path d="M226 156 h48 l-6 30 h-36 z" fill="#b07a3f"/>
    <path d="M227 164 h46 M228.5 172 h43 M230 180 h40" stroke="#8a5a2b" stroke-width="2"/>
    <path d="M226 156 h48" stroke="#8a5a2b" stroke-width="3" stroke-linecap="round"/>
    <text x="250" y="${n > 3 ? 120 : n ? 130 : 146}" text-anchor="middle" class="basket-n">${n}</text>
  </svg>`;
}
function cssLeaf(name) { return cssVar(name) || (name === '--leaf' ? '#66bb6a' : '#43a047'); }

// ---------- streaks ----------
function streaks(activities) {
  const days = new Set(activities.map((a) => dayKey(new Date(a.occurred_at))));
  let current = 0;
  let d = startOfDay(new Date());
  if (!days.has(dayKey(d))) d = addDays(d, -1); // today not logged yet doesn't break the streak
  while (days.has(dayKey(d))) { current++; d = addDays(d, -1); }
  const sorted = [...days].sort();
  let longest = 0, run = 0, prev = null;
  for (const k of sorted) {
    const cur = new Date(k + 'T00:00:00');
    run = prev && Math.round((cur - prev) / 86400000) === 1 ? run + 1 : 1;
    longest = Math.max(longest, run);
    prev = cur;
  }
  return { current, longest };
}

// ---------- charts ----------
function cssVar(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
function destroyCharts() { state.charts.forEach((c) => c.destroy()); state.charts = []; }
function chartDefaults() {
  if (!window.Chart) return;
  Chart.defaults.font.family = cssVar('--font');
  Chart.defaults.color = cssVar('--muted');
  Chart.defaults.borderColor = cssVar('--grid');
  Chart.defaults.plugins.legend.labels.boxWidth = 10;
  Chart.defaults.plugins.legend.labels.boxHeight = 10;
  Chart.defaults.plugins.legend.labels.usePointStyle = true;
  Chart.defaults.plugins.tooltip.mode = 'index';
  Chart.defaults.plugins.tooltip.intersect = false;
  Chart.defaults.maintainAspectRatio = false;
  Chart.defaults.animation.duration = 400;
}
function makeChart(id, config, emptyMsg) {
  const box = document.getElementById(id);
  if (!box) return;
  const hasData = config.data.datasets.some((ds) => ds.data.some((v) => (typeof v === 'object' && v !== null ? v.y : v)));
  if (!hasData) { box.innerHTML = `<div class="chart-empty">${esc(emptyMsg || 'Nothing logged yet')}</div>`; return; }
  if (!window.Chart) { box.innerHTML = `<div class="chart-empty">Charts failed to load</div>`; return; }
  box.innerHTML = '<canvas></canvas>';
  state.charts.push(new Chart(box.querySelector('canvas'), config));
}
// BMI = kg / m². Māori Mode (opt-in, per person) takes 30 kg off the weight first.
const MAORI_MODE_KG = 30;
function bmi(weightKg, u) {
  if (weightKg == null || !u.height_cm) return null;
  const m = u.height_cm / 100;
  return (weightKg - (u.maori_mode ? MAORI_MODE_KG : 0)) / (m * m);
}
const maoriTag = (u) => (u.maori_mode ? `<span class="mm-tag" title="BMI uses weight minus ${MAORI_MODE_KG} kg">Māori Mode</span>` : '');

// Small "▲ 1.9 kg" / "▼ 0.6 kg" badge: how far the latest weight is over/under target.
function targetBadge(latest, target) {
  if (latest == null || target == null) return '';
  const diff = Math.round((latest - target) * 10) / 10;
  if (Math.abs(diff) < 0.1) return `<span class="tgt on" title="On target (${fmtNum(target, 1)} kg)">✓ on target</span>`;
  const over = diff > 0;
  return `<span class="tgt" title="${fmtNum(Math.abs(diff), 1)} kg ${over ? 'over' : 'under'} target (${fmtNum(target, 1)} kg)">${over ? '▲' : '▼'} ${fmtNum(Math.abs(diff), 1)} kg</span>`;
}
const shortDay = (d) => d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
const alpha = (hex, a) => hex + Math.round(a * 255).toString(16).padStart(2, '0');

// ---------- feed ----------
function feedNote(it) {
  const label = fruitType(it.fruit).label.toLowerCase();
  if (it.ripened) return `<span class="ripe-note">${fruitIcon(it.fruit, 12)} a ${esc(label)} ripened!</span>`;
  const notes = { leaves: '🌿 leaves are in', flowers: '🌸 tree is flowering', fruit: `🌱 ${fruitPlural(it.fruit)} are setting`, fall: '🍂 leaves are falling' };
  return it.stage_started ? `<span class="stage-note">${notes[it.stage_started]}</span>` : '';
}
async function loadFeed() {
  const list = $('#feed-list');
  try {
    const { items } = await api('/feed?limit=60');
    // Stats are placed at the time they were saved, but no later than the end of the (local) day they're for.
    for (const it of items) {
      it._t = new Date(it.at).getTime();
      if (it.kind === 'metrics') it._t = Math.min(new Date(it.updated_at).getTime(), new Date(it.date + 'T23:59:59').getTime());
    }
    items.sort((a, b) => b._t - a._t);
    if (!items.length) { list.innerHTML = `<div class="feed-empty">Nobody has logged anything yet. Be the first — hit <b>+ Log</b>.</div>`; return; }
    let html = '';
    let lastDay = '';
    for (const it of items) {
      const when = it.kind === 'metrics' ? new Date(it.date + 'T12:00:00') : new Date(it.at);
      const label = dayLabel(when);
      if (label !== lastDay) { html += `<div class="feed-day">${esc(label)}</div>`; lastDay = label; }
      if (it.kind === 'activity') {
        const meta = actMeta(it);
        html += `<div class="feed-item">${avatar(it)}<div class="feed-text">
          ${userLink(it)} did <span class="feed-title">${esc(it.title)}</span>
          <div class="feed-meta">${meta.length ? esc(meta.join(' · ')) : ''}${feedNote(it)}</div>
          ${it.description ? `<div class="feed-desc">${esc(it.description)}</div>` : ''}
        </div></div>`;
      } else {
        html += `<div class="feed-item">${avatar(it)}<div class="feed-text">
          ${userLink(it)} logged weight <b>${fmtNum(it.weight_kg, 1)} kg</b>
          <div class="feed-meta">for ${esc(dayLabel(when).toLowerCase() === 'today' ? 'today' : shortDay(when))}</div>
        </div></div>`;
      }
    }
    list.innerHTML = html;
  } catch (e) {
    if (e.status !== 401) list.innerHTML = `<div class="feed-empty">Couldn't load the feed: ${esc(e.message)}</div>`;
  }
}

// ---------- views ----------
async function renderDashboard(view) {
  const today = startOfDay(new Date());
  const from = addDays(today, -29);
  const wFrom = addDays(today, -89);
  const [{ users }, { activities }, { weight: weights }] = await Promise.all([
    api('/users'),
    api(`/activities?since=${encodeURIComponent(from.toISOString())}&limit=2000`),
    api(`/weight?since=${dayKey(wFrom)}&limit=5000`),
  ]);
  const weekStart = startOfWeek(new Date());
  const weekCount = {};
  for (const a of activities) if (new Date(a.occurred_at) >= weekStart) weekCount[a.username] = (weekCount[a.username] || 0) + 1;

  const ranked = [...users].sort((a, b) => b.orchard.basket - a.orchard.basket || b.activity_count - a.activity_count || a.display_name.localeCompare(b.display_name));
  const medals = ['🥇', '🥈', '🥉'];

  view.innerHTML = `
    <section class="card">
      <div class="card-head"><h2>Orchard</h2><span class="muted">Every activity grows your tree · leaves → flowers → fruit → leaf fall</span></div>
      <div class="orchard-grid">${ranked.map((u) => `<a class="orchard-cell" href="#/u/${esc(u.username)}">
        ${orchardSvg(u.orchard, u.fruit, { label: u.display_name })}
        <div class="orchard-name"><span class="dot" style="background:${esc(u.color)}"></span>${esc(u.display_name)}</div>
        <div class="orchard-stage">${esc(stageText(u.orchard))}</div>
      </a>`).join('')}</div>
    </section>
    <section class="card">
      <div class="card-head"><h2>Leaderboard</h2><span class="muted">Ranked by fruit in the basket</span></div>
      <div class="board-wrap"><table class="board">
        <thead><tr><th></th><th>Who</th><th class="num">Fruit</th><th class="hide-sm">Tree</th><th class="num">This week</th><th class="num hide-sm">Activities</th><th class="hide-sm">Last active</th></tr></thead>
        <tbody>${ranked.map((u, i) => `<tr>
          <td class="rank">${u.activity_count > 0 && i < 3 ? `<span class="medal">${medals[i]}</span>` : i + 1}</td>
          <td><div class="who">${avatar(u)}${userLink(u)}</div></td>
          <td class="num pts"><span class="fruit-n">${fruitIcon(u.fruit, 15)} ${fmtNum(u.orchard.basket)}</span></td>
          <td class="hide-sm muted">${u.orchard.season > 1 ? `S${u.orchard.season} · ` : ''}${esc(stageText(u.orchard))}</td>
          <td class="num">${fmtNum(weekCount[u.username] || 0)}</td>
          <td class="num hide-sm">${fmtNum(u.activity_count)}</td>
          <td class="hide-sm muted">${u.last_active_at ? esc(dayLabel(new Date(u.last_active_at))) : '—'}</td>
        </tr>`).join('')}</tbody>
      </table></div>
    </section>
    <section class="card">
      <div class="card-head"><h2>Activity race</h2><span class="muted">Activities logged, last 30 days</span></div>
      <div class="chart-box" id="c-race"></div>
    </section>
    <section class="card">
      <div class="card-head"><h2>Activities per day</h2><span class="muted">Last 30 days</span></div>
      <div class="chart-box" id="c-daily"></div>
    </section>
    <div class="grid-2">
      <section class="card">
        <div class="card-head"><h2>Weight</h2><span class="muted">kg, last 90 days</span></div>
        <div class="chart-box" id="c-weight"></div>
        ${(() => {
          const wp = users.filter((u) => u.latest_weight_kg != null);
          return wp.length ? `<div class="wlist">${wp.map((u) => `<div class="witem">${avatar(u, 'sm')}<span class="wname">${userLink(u)}</span><span class="wval">${fmtNum(u.latest_weight_kg, 1)} kg</span>${targetBadge(u.latest_weight_kg, u.target_weight_kg)}</div>`).join('')}</div>` : '';
        })()}
      </section>
      <section class="card">
        <div class="card-head"><h2>BMI</h2><span class="muted">last 90 days</span></div>
        <div class="chart-box" id="c-bmi"></div>
        ${(() => {
          const bp = users.filter((u) => bmi(u.latest_weight_kg, u) != null);
          const noHeight = users.filter((u) => u.latest_weight_kg != null && !u.height_cm);
          return (bp.length ? `<div class="wlist">${bp.map((u) => `<div class="witem">${avatar(u, 'sm')}<span class="wname">${userLink(u)}</span><span class="wval">${fmtNum(bmi(u.latest_weight_kg, u), 1)}</span>${maoriTag(u)}</div>`).join('')}</div>` : '') +
            (noHeight.length ? `<p class="muted small" style="margin:10px 0 0">No height set: ${noHeight.map((u) => esc(u.display_name)).join(', ')} — add it in Settings to appear here.</p>` : '');
        })()}
      </section>
    </div>
    <div class="grid-2">
      <section class="card">
        <div class="card-head"><h2>Minutes moved</h2><span class="muted">Last 30 days</span></div>
        <div class="chart-box" id="c-minutes"></div>
      </section>
      <section class="card">
        <div class="card-head"><h2>What everyone's doing</h2><span class="muted">By type, last 30 days</span></div>
        <div class="chart-box" id="c-types"></div>
      </section>
    </div>`;

  const days = Array.from({ length: 30 }, (_, i) => addDays(from, i));
  const keys = days.map(dayKey);
  const labels = days.map(shortDay);
  const people = users.filter((u) => u.activity_count > 0);
  const byUserDay = {};
  for (const a of activities) {
    const k = dayKey(new Date(a.occurred_at));
    ((byUserDay[a.username] ||= {})[k] ||= []).push(a);
  }

  // Activity race: cumulative
  makeChart('c-race', {
    type: 'line',
    data: {
      labels,
      datasets: people.map((u) => {
        let total = 0;
        return {
          label: u.display_name, borderColor: u.color, backgroundColor: u.color,
          data: keys.map((k) => (total += byUserDay[u.username]?.[k]?.length || 0)),
          tension: 0.25, pointRadius: 0, pointHoverRadius: 4, borderWidth: 2.5,
        };
      }),
    },
    options: { scales: { y: { beginAtZero: true, ticks: { precision: 0 } }, x: { ticks: { maxTicksLimit: 8 } } } },
  }, 'Log an activity to start the race');

  makeChart('c-daily', {
    type: 'bar',
    data: {
      labels,
      datasets: people.map((u) => ({
        label: u.display_name, backgroundColor: u.color, borderRadius: 3,
        data: keys.map((k) => byUserDay[u.username]?.[k]?.length || 0),
      })),
    },
    options: { scales: { x: { stacked: true, ticks: { maxTicksLimit: 8 } }, y: { stacked: true, beginAtZero: true, ticks: { precision: 0 } } } },
  });

  const wDays = Array.from({ length: 90 }, (_, i) => addDays(wFrom, i));
  const weightPeople = users.filter((u) => weights.some((w) => w.username === u.username));
  makeChart('c-weight', {
    type: 'line',
    data: {
      labels: wDays.map(shortDay),
      datasets: weightPeople.map((u) => {
        const map = Object.fromEntries(weights.filter((w) => w.username === u.username).map((w) => [w.date, w.weight_kg]));
        return {
          label: u.display_name, borderColor: u.color, backgroundColor: u.color,
          data: wDays.map((d) => map[dayKey(d)] ?? null), spanGaps: true, tension: 0.25, pointRadius: 2.5, pointHoverRadius: 5, borderWidth: 2,
        };
      }),
    },
    options: { scales: { x: { ticks: { maxTicksLimit: 6 } } } },
  }, 'No weight logged yet — use + Log → Weight');

  const bmiPeople = weightPeople.filter((u) => u.height_cm);
  makeChart('c-bmi', {
    type: 'line',
    data: {
      labels: wDays.map(shortDay),
      datasets: bmiPeople.map((u) => {
        const map = Object.fromEntries(weights.filter((w) => w.username === u.username).map((w) => [w.date, bmi(w.weight_kg, u)]));
        return {
          label: u.maori_mode ? `${u.display_name} (Māori Mode)` : u.display_name,
          borderColor: u.color, backgroundColor: u.color,
          borderDash: u.maori_mode ? [6, 4] : [], pointStyle: u.maori_mode ? 'rectRot' : 'circle',
          data: wDays.map((d) => (map[dayKey(d)] != null ? Math.round(map[dayKey(d)] * 10) / 10 : null)),
          spanGaps: true, tension: 0.25, pointRadius: u.maori_mode ? 3.5 : 2.5, pointHoverRadius: 5, borderWidth: 2,
        };
      }),
    },
    options: { scales: { x: { ticks: { maxTicksLimit: 6 } } } },
  }, 'Needs weight plus height (Settings)');

  const minutes = people.map((u) => activities.filter((a) => a.username === u.username).reduce((s, a) => s + (a.duration_min || 0), 0));
  makeChart('c-minutes', {
    type: 'bar',
    data: {
      labels: people.map((u) => u.display_name),
      datasets: [{ label: 'Minutes', data: minutes, backgroundColor: people.map((u) => u.color), borderRadius: 6 }],
    },
    options: { indexAxis: 'y', plugins: { legend: { display: false } }, scales: { x: { beginAtZero: true } } },
  }, 'Add minutes to activities to see this');


  const typeCounts = {};
  for (const a of activities) typeCounts[a.type] = (typeCounts[a.type] || 0) + 1;
  const typeEntries = Object.entries(typeCounts).sort((a, b) => b[1] - a[1]);
  const typeColors = ['#ff5a36', '#4f7cff', '#2bb673', '#f5a623', '#9b59b6', '#00b8d9', '#ff8fab', '#8a9a2b', '#e67e22', '#16a085'];
  makeChart('c-types', {
    type: 'doughnut',
    data: {
      labels: typeEntries.map(([t]) => t),
      datasets: [{ data: typeEntries.map(([, n]) => n), backgroundColor: typeEntries.map((_, i) => typeColors[i % typeColors.length]), borderColor: cssVar('--surface'), borderWidth: 2 }],
    },
    options: { cutout: '62%', plugins: { legend: { position: 'right' }, tooltip: { mode: 'nearest' } } },
  });
}

async function renderProfile(view, username) {
  const { user, activities, weight: metrics } = await api(`/users/${encodeURIComponent(username)}`);
  const isMe = user.username === state.me.username;
  const { current, longest } = streaks(activities);
  const weekStart = startOfWeek(new Date());
  const thisWeek = activities.filter((a) => new Date(a.occurred_at) >= weekStart).length;
  const totalMin = activities.reduce((s, a) => s + (a.duration_min || 0), 0);
  const totalKm = activities.reduce((s, a) => s + (a.distance_km || 0), 0);
  const latestWeight = metrics.find((m) => m.weight_kg != null);

  document.title = `${user.display_name} · ${state.config.app_name}`;
  view.innerHTML = `
    <section class="card">
      <div class="profile-head">
        <span class="avatar lg" style="--c:${esc(user.color)}">${initials(user.display_name)}</span>
        <div style="flex:1;min-width:200px">
          <h1>${esc(user.display_name)}</h1>
          <div class="muted small">@${esc(user.username)} · joined ${esc(new Date(user.created_at).toLocaleDateString(undefined, { month: 'long', year: 'numeric' }))}</div>
          ${user.bio ? `<p class="bio">${esc(user.bio)}</p>` : ''}
        </div>
        ${isMe ? `<a class="btn" href="#/settings">Edit profile</a>` : ''}
      </div>
    </section>
    <section class="card orchard-hero">
      ${orchardSvg(user.orchard, user.fruit, { label: user.display_name })}
      <div class="orchard-info">
        <h2>${esc(user.display_name)}'s ${esc(fruitType(user.fruit).label.toLowerCase())} tree</h2>
        <div class="big-fruit">${fruitIcon(user.fruit, 26)} ${fmtNum(user.orchard.basket)} <small>in the basket</small></div>
        <p class="stage-line"><b>Season ${user.orchard.season} · ${esc(stageText(user.orchard))}</b></p>
        <p class="muted small">${esc(nextText(user.orchard, fruitPlural(user.fruit)))}</p>
        ${isMe ? `<p class="muted small"><a href="#/settings">Change your tree →</a></p>` : ''}
      </div>
    </section>
    <div class="tiles">
      <div class="tile"><div class="label">Fruit</div><div class="value">${fmtNum(user.orchard.basket)}</div></div>
      <div class="tile"><div class="label">Activities</div><div class="value">${fmtNum(user.activity_count)}</div></div>
      <div class="tile"><div class="label">This week</div><div class="value">${thisWeek}</div></div>
      <div class="tile"><div class="label">Streak</div><div class="value">${current} <small>days</small></div></div>
      <div class="tile"><div class="label">Best streak</div><div class="value">${longest} <small>days</small></div></div>
      <div class="tile"><div class="label">Total time</div><div class="value">${totalMin >= 60 ? fmtNum(totalMin / 60, 1) + ' <small>h</small>' : totalMin + ' <small>min</small>'}</div></div>
      <div class="tile"><div class="label">Distance</div><div class="value">${fmtNum(totalKm, 1)} <small>km</small></div></div>
      <div class="tile"><div class="label">Height</div><div class="value">${user.height_cm ? fmtNum(user.height_cm) + ' <small>cm</small>' : '—'}</div></div>
      <div class="tile"><div class="label">Weight</div><div class="value">${latestWeight ? fmtNum(latestWeight.weight_kg, 1) + ' <small>kg</small>' : '—'}</div>${targetBadge(latestWeight?.weight_kg, user.target_weight_kg)}</div>
      <div class="tile"><div class="label">BMI</div><div class="value">${bmi(latestWeight?.weight_kg, user) != null ? fmtNum(bmi(latestWeight.weight_kg, user), 1) : '—'}</div>${maoriTag(user)}</div>
      <div class="tile"><div class="label">Target</div><div class="value">${user.target_weight_kg != null ? fmtNum(user.target_weight_kg, 1) + ' <small>kg</small>' : '—'}</div></div>
    </div>
    <div class="grid-2">
      <section class="card">
        <div class="card-head"><h2>Activities per week</h2><span class="muted">Last 12 weeks</span></div>
        <div class="chart-box short" id="p-weeks"></div>
      </section>
      <section class="card">
        <div class="card-head"><h2>Activity types</h2><span class="muted">All time</span></div>
        <div class="chart-box short" id="p-types"></div>
      </section>
    </div>
    <section class="card">
      <div class="card-head"><h2>Weight</h2><span class="muted">${user.target_weight_kg != null ? `Target ${fmtNum(user.target_weight_kg, 1)} kg ${targetBadge(latestWeight?.weight_kg, user.target_weight_kg)}` : 'kg'}</span></div>
      <div class="chart-box short" id="p-weight"></div>
    </section>
    <section class="card">
      <div class="card-head"><h2>Activities</h2><span class="muted">${activities.length} logged</span></div>
      <div class="act-list">${activities.length ? activities.map((a) => `
        <div class="act">
          <div>
            <div class="act-title">${esc(a.title)}</div>
            <div class="act-meta">${esc(dayLabel(new Date(a.occurred_at)))}${actMeta(a).length ? ' · ' + esc(actMeta(a).join(' · ')) : ''}</div>
          </div>
          <div class="act-actions">${isMe ? `<button class="link-btn" data-edit="${a.id}">Edit</button><button class="link-btn" data-del="${a.id}">Delete</button>` : ''}${a.ripened ? `<span class="pill ripe" title="This one ripened a ${esc(fruitType(user.fruit).label.toLowerCase())}">${fruitIcon(user.fruit, 12)}</span>` : ''}</div>
          ${a.description ? `<div class="act-desc">${esc(a.description)}</div>` : ''}
        </div>`).join('') : `<p class="muted">No activities yet.</p>`}</div>
    </section>
    ${metrics.length ? `<section class="card">
      <div class="card-head"><h2>Weight log</h2></div>
      <div class="board-wrap"><table class="board">
        <thead><tr><th>Date</th><th class="num">Weight</th>${isMe ? '<th></th>' : ''}</tr></thead>
        <tbody>${metrics.slice(0, 60).map((m) => `<tr>
          <td>${esc(new Date(m.date + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }))}</td>
          <td class="num">${m.weight_kg != null ? fmtNum(m.weight_kg, 1) + ' kg' : '—'}</td>
          ${isMe ? `<td class="num"><button class="link-btn" data-del-metric="${esc(m.date)}">Delete</button></td>` : ''}
        </tr>`).join('')}</tbody>
      </table></div>
    </section>` : ''}`;

  // weekly bars
  const wk0 = addDays(startOfWeek(new Date()), -77);
  const weeks = Array.from({ length: 12 }, (_, i) => addDays(wk0, i * 7));
  const weekCounts = weeks.map((w) => activities.filter((a) => { const d = new Date(a.occurred_at); return d >= w && d < addDays(w, 7); }).length);
  makeChart('p-weeks', {
    type: 'bar',
    data: { labels: weeks.map(shortDay), datasets: [{ label: 'Activities', data: weekCounts, backgroundColor: user.color, borderRadius: 4 }] },
    options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { precision: 0 } }, x: { ticks: { maxTicksLimit: 6 } } } },
  });

  const typeCounts = {};
  for (const a of activities) typeCounts[a.type] = (typeCounts[a.type] || 0) + 1;
  const te = Object.entries(typeCounts).sort((a, b) => b[1] - a[1]);
  const shades = [1, 0.75, 0.55, 0.4, 0.3, 0.22, 0.16, 0.12];
  makeChart('p-types', {
    type: 'doughnut',
    data: { labels: te.map(([t]) => t), datasets: [{ data: te.map(([, n]) => n), backgroundColor: te.map((_, i) => alpha(user.color, shades[i % shades.length])), borderColor: cssVar('--surface'), borderWidth: 2 }] },
    options: { cutout: '62%', plugins: { legend: { position: 'right' }, tooltip: { mode: 'nearest' } } },
  });

  const wRows = metrics.filter((m) => m.weight_kg != null).reverse();
  makeChart('p-weight', {
    type: 'line',
    data: {
      labels: wRows.map((m) => shortDay(new Date(m.date + 'T12:00:00'))),
      datasets: [{ label: 'Weight (kg)', data: wRows.map((m) => m.weight_kg), borderColor: user.color, backgroundColor: alpha(user.color, 0.12), fill: true, tension: 0.3, pointRadius: 3, borderWidth: 2 }],
    },
    options: { plugins: { legend: { display: false } }, scales: { x: { ticks: { maxTicksLimit: 6 } } } },
  }, 'No weight logged yet — use + Log → Weight');


  if (isMe) {
    view.addEventListener('click', async (e) => {
      const del = e.target.closest('[data-del]');
      const edit = e.target.closest('[data-edit]');
      const delM = e.target.closest('[data-del-metric]');
      if (edit) {
        openLog('activity', activities.find((a) => String(a.id) === edit.dataset.edit));
      } else if (del && confirm('Delete this activity? Its growth comes off the tree too.')) {
        await api(`/activities/${del.dataset.del}`, { method: 'DELETE' });
        toast('Deleted');
        refresh();
      } else if (delM && confirm('Delete the weight for this day?')) {
        await api(`/weight/${delM.dataset.delMetric}`, { method: 'DELETE' });
        toast('Deleted');
        refresh();
      }
    });
  }
}

async function renderSettings(view) {
  const { user } = await api('/me');
  state.me = user;
  view.innerHTML = `<div class="settings">
    <section class="card">
      <div class="card-head"><h2>Profile</h2><a class="muted small" href="#/u/${esc(user.username)}">View my page →</a></div>
      <form id="profile-form" class="stack">
        <div class="row">
          <label>Display name <input name="display_name" maxlength="40" required value="${esc(user.display_name)}"></label>
          <label>Height (cm) <input name="height_cm" type="number" min="50" max="260" step="0.5" value="${user.height_cm ?? ''}"></label>
        </div>
        <div class="row">
          <label>Target weight (kg) <input name="target_weight_kg" type="number" min="20" max="400" step="0.1" placeholder="Optional" value="${user.target_weight_kg ?? ''}"></label>
          <label class="check"><input type="checkbox" name="maori_mode" ${user.maori_mode ? 'checked' : ''}> <span><b>Māori Mode</b><br><span class="muted small">Takes ${MAORI_MODE_KG} kg off your weight in the BMI calculation. You'll be tagged on the BMI chart.</span></span></label>
        </div>
        <label>Bio <textarea name="bio" maxlength="300" rows="2" placeholder="Training for a half marathon…">${esc(user.bio)}</textarea></label>
        <fieldset class="fruit-pick"><legend>Your fruit tree</legend>
          ${Object.entries(FRUIT_TYPES).map(([k, f]) => `<label class="fruit-opt"><input type="radio" name="fruit" value="${k}" ${user.fruit === k ? 'checked' : ''}>${fruitIcon(k, 26)}<span>${esc(f.label)}</span></label>`).join('')}
        </fieldset>
        <label style="max-width:160px">Colour <input name="color" type="color" value="${esc(user.color)}" style="height:42px;padding:4px"></label>
        <p class="form-error" role="alert"></p>
        <div><button class="btn primary" type="submit">Save profile</button></div>
      </form>
    </section>
    <section class="card">
      <div class="card-head"><h2>API key</h2><a class="muted small" href="#/api">API docs →</a></div>
      <p class="muted small" style="margin-top:0">Use a key to post activities from scripts, shortcuts or other apps. Generating a new key replaces the old one.</p>
      <div id="key-area" class="stack">
        <p class="small">${user.has_api_key ? 'You have an active key.' : 'No key yet.'}</p>
      </div>
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        <button class="btn" id="gen-key">${user.has_api_key ? 'Replace key' : 'Generate key'}</button>
        ${user.has_api_key ? '<button class="btn danger" id="revoke-key">Revoke key</button>' : ''}
      </div>
    </section>
    <section class="card">
      <div class="card-head"><h2>Password</h2></div>
      <form id="pw-form" class="stack">
        <div class="row">
          <label>Current password <input name="current_password" type="password" required autocomplete="current-password"></label>
          <label>New password <input name="new_password" type="password" minlength="8" required autocomplete="new-password"></label>
        </div>
        <p class="form-error" role="alert"></p>
        <div><button class="btn" type="submit">Change password</button></div>
      </form>
    </section>
    <section class="card">
      <div class="card-head"><h2>Session</h2></div>
      <button class="btn danger" id="logout-btn">Log out</button>
    </section>
  </div>`;

  $('#profile-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    const err = $('.form-error', f);
    err.textContent = '';
    try {
      const { user: u } = await api('/me', { method: 'PATCH', body: {
        display_name: f.display_name.value, bio: f.bio.value, color: f.color.value,
        height_cm: f.height_cm.value === '' ? null : Number(f.height_cm.value),
        target_weight_kg: f.target_weight_kg.value === '' ? null : Number(f.target_weight_kg.value),
        fruit: f.fruit.value,
        maori_mode: f.maori_mode.checked,
      } });
      state.me = u;
      renderMe();
      toast('Profile saved');
      loadFeed();
    } catch (ex) { err.textContent = ex.message; }
  });
  $('#gen-key').addEventListener('click', async () => {
    if (state.me.has_api_key && !confirm('Replace your key? Anything using the old one will stop working.')) return;
    const { api_key } = await api('/me/api-key', { method: 'POST', body: {} });
    state.me.has_api_key = true;
    $('#key-area').innerHTML = `<p class="small"><b>Copy this now</b> — it won't be shown again.</p><div class="key-box" id="key-text">${esc(api_key)}</div>`;
    $('#gen-key').textContent = 'Replace key';
    try { await navigator.clipboard.writeText(api_key); toast('Key copied to clipboard'); } catch {}
  });
  $('#revoke-key')?.addEventListener('click', async () => {
    if (!confirm('Revoke your API key?')) return;
    await api('/me/api-key', { method: 'DELETE' });
    toast('Key revoked');
    refresh();
  });
  $('#pw-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    const err = $('.form-error', f);
    err.textContent = '';
    try {
      await api('/me/password', { method: 'POST', body: { current_password: f.current_password.value, new_password: f.new_password.value } });
      f.reset();
      toast('Password changed');
    } catch (ex) { err.textContent = ex.message; }
  });
  $('#logout-btn').addEventListener('click', async () => {
    await api('/auth/logout', { method: 'POST', body: {} });
    state.me = null;
    showAuth();
  });
}

function renderApiDocs(view) {
  const base = location.origin;
  const rows = [
    ['POST', '/api/activities', 'Log an activity. <code>title</code> and <code>duration_min</code> required; optional <code>description</code>, <code>type</code>, <code>distance_km</code>, <code>date</code> (YYYY-MM-DD, defaults to today).'],
    ['GET', '/api/activities', 'List activities. Filters: <code>user</code>, <code>type</code>, <code>since</code>, <code>until</code>, <code>limit</code> (max 2000).'],
    ['GET', '/api/activities/:id', 'One activity.'],
    ['PATCH', '/api/activities/:id', 'Edit your own activity (any of the fields above).'],
    ['DELETE', '/api/activities/:id', 'Delete your own activity.'],
    ['POST', '/api/weight', 'Log your weight: <code>weight_kg</code> required, <code>date</code> (YYYY-MM-DD, defaults to today). Same date again replaces it.'],
    ['GET', '/api/weight', 'List weigh-ins. Filters: <code>user</code>, <code>since</code> (date), <code>limit</code>.'],
    ['DELETE', '/api/weight/:date', 'Delete your weigh-in for a day.'],
    ['GET', '/api/feed', 'The combined feed shown in the sidebar.'],
    ['GET', '/api/users', 'Everyone, with activity counts, chosen <code>fruit</code> and their <code>orchard</code> (season, stage, basket, fruit on the tree).'],
    ['GET', '/api/users/:username', 'One person with all their activities and stats.'],
    ['GET', '/api/me', 'Your own profile.'],
    ['PATCH', '/api/me', 'Update <code>display_name</code>, <code>bio</code>, <code>height_cm</code>, <code>target_weight_kg</code>, <code>maori_mode</code> (true/false), <code>fruit</code>, <code>color</code>.'],
  ];
  view.innerHTML = `<div class="settings api-doc">
    <section class="card">
      <div class="card-head"><h2>API</h2><a class="muted small" href="#/settings">Get a key →</a></div>
      <p>Every endpoint takes your API key as a bearer token and JSON bodies with <code>Content-Type: application/json</code>. Everything is visible to everyone in the club; you can only change your own things.</p>
      <pre class="code"><code>curl -X POST ${esc(base)}/api/activities \\
  -H "Authorization: Bearer YOUR_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"title":"Lunch walk","type":"walk","duration_min":30,"distance_km":2.4}'</code></pre>
      <pre class="code"><code>curl -X POST ${esc(base)}/api/weight \\
  -H "Authorization: Bearer YOUR_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"date":"${dayKey(new Date())}","weight_kg":78.4}'</code></pre>
    </section>
    <section class="card">
      <div class="card-head"><h2>Endpoints</h2></div>
      <div class="board-wrap"><table class="endpoints"><tbody>
        ${rows.map(([m, p, d]) => `<tr><td><span class="method">${m}</span>${esc(p)}</td><td>${d}</td></tr>`).join('')}
      </tbody></table></div>
      <p class="muted small" style="margin-top:12px">Errors come back as <code>{"error": "message"}</code> with a 4xx status.</p>
    </section>
  </div>`;
}

// ---------- router ----------
async function route() {
  if (!state.me) return;
  destroyCharts();
  const view = $('#view');
  const fresh = view.cloneNode(false); // drop old listeners
  view.replaceWith(fresh);
  const hash = location.hash.replace(/^#/, '') || '/';
  const [, section, arg] = hash.split('/');
  $$('.nav a').forEach((a) => a.classList.toggle('active', a.dataset.nav === (section || 'dashboard')));
  document.title = state.config.app_name;
  fresh.innerHTML = '<div class="loading">Loading…</div>';
  try {
    if (!section) await renderDashboard(fresh);
    else if (section === 'u' && arg) await renderProfile(fresh, decodeURIComponent(arg));
    else if (section === 'settings') await renderSettings(fresh);
    else if (section === 'api') renderApiDocs(fresh);
    else fresh.innerHTML = '<div class="card">Page not found. <a href="#/">Back to the dashboard</a></div>';
  } catch (e) {
    if (e.status !== 401) fresh.innerHTML = `<div class="card">Something went wrong: ${esc(e.message)}</div>`;
  }
  window.scrollTo(0, 0);
}
function refresh() { loadFeed(); route(); }

// ---------- log dialog ----------
function openLog(tab = 'activity', existing = null) {
  const dlg = $('#log-dialog');
  const af = $('#activity-form');
  const mf = $('#metrics-form');
  af.reset(); mf.reset();
  $$('.form-error', dlg).forEach((e) => (e.textContent = ''));
  af.act_id.value = '';
  af.occurred_at.value = dayKey(new Date());
  mf.date.value = dayKey(new Date());
  if (existing) {
    af.act_id.value = existing.id;
    af.title.value = existing.title;
    af.type.value = existing.type;
    af.occurred_at.value = dayKey(new Date(existing.occurred_at));
    af.duration_min.value = existing.duration_min ?? '';
    af.distance_km.value = existing.distance_km ?? '';
    af.description.value = existing.description;
  }
  $('button[type=submit]', af).textContent = existing ? 'Save changes' : 'Save activity';
  $('[data-log-tab="metrics"]').hidden = !!existing;
  setLogTab(tab);
  dlg.showModal();
  (tab === 'activity' ? af.title : mf.weight_kg).focus();
}
function setLogTab(tab) {
  $$('[data-log-tab]').forEach((b) => b.classList.toggle('active', b.dataset.logTab === tab));
  $('#activity-form').hidden = tab !== 'activity';
  $('#metrics-form').hidden = tab !== 'metrics';
}

function wireLogDialog() {
  const dlg = $('#log-dialog');
  $('#log-btn').addEventListener('click', () => openLog());
  $$('[data-log-tab]').forEach((b) => b.addEventListener('click', () => setLogTab(b.dataset.logTab)));
  $('[data-close]', dlg).addEventListener('click', () => dlg.close());
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });

  $('#activity-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    const btn = $('button[type=submit]', f);
    const err = $('.form-error', f);
    err.textContent = '';
    btn.disabled = true;
    const body = {
      title: f.title.value,
      type: f.type.value || 'other',
      description: f.description.value,
      occurred_at: new Date(f.occurred_at.value + 'T12:00:00').toISOString(), // date only; stored as local midday
      duration_min: f.duration_min.value === '' ? null : Number(f.duration_min.value),
      distance_km: f.distance_km.value === '' ? null : Number(f.distance_km.value),
    };
    try {
      let res;
      if (f.act_id.value) res = await api(`/activities/${f.act_id.value}`, { method: 'PATCH', body });
      else res = await api('/activities', { method: 'POST', body });
      dlg.close();
      const fl = fruitType(state.me.fruit).label.toLowerCase();
      const stageMsg = { leaves: 'New leaves are coming in 🌿', flowers: 'Your tree is flowering 🌸', fruit: `Your ${fruitPlural(state.me.fruit)} are setting 🌱`, fall: 'Crop is in — leaves are falling 🍂' };
      toast(f.act_id.value ? 'Activity updated'
        : res.ripened && res.orchard.stage === 'fall' ? `Last ${fl} picked — that's the season's crop! 🍂`
        : res.ripened ? `A ${fl} ripened and dropped in your basket!`
        : res.stage_changed ? stageMsg[res.orchard.stage] || 'Your tree grew 🌱'
        : 'Nice one! Your tree grew 🌱');
      refresh();
    } catch (ex) { err.textContent = ex.message; }
    finally { btn.disabled = false; }
  });

  $('#metrics-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    const btn = $('button[type=submit]', f);
    const err = $('.form-error', f);
    err.textContent = '';
    btn.disabled = true;
    try {
      await api('/weight', { method: 'POST', body: {
        date: f.date.value,
        weight_kg: f.weight_kg.value === '' ? null : Number(f.weight_kg.value),
      } });
      dlg.close();
      toast('Weight saved');
      refresh();
    } catch (ex) { err.textContent = ex.message; }
    finally { btn.disabled = false; }
  });
}

// ---------- auth ----------
function showAuth() {
  clearInterval(state.feedTimer);
  destroyCharts();
  $('#app').hidden = true;
  $('#auth').hidden = false;
  $('[data-auth-tab="register"]').hidden = !state.config.signup_open;
}
function renderMe() {
  $('#me-link').innerHTML = `<span class="avatar" style="--c:${esc(state.me.color)}">${initials(state.me.display_name)}</span>`;
  $('#me-link').title = `${state.me.display_name} — settings`;
}
function showApp() {
  $('#auth').hidden = true;
  $('#app').hidden = false;
  renderMe();
  loadFeed();
  clearInterval(state.feedTimer);
  state.feedTimer = setInterval(() => { if (!document.hidden) loadFeed(); }, 60000);
  route();
}
function wireAuth() {
  $$('[data-auth-tab]').forEach((b) => b.addEventListener('click', () => {
    $$('[data-auth-tab]').forEach((x) => x.classList.toggle('active', x === b));
    $('#login-form').hidden = b.dataset.authTab !== 'login';
    $('#register-form').hidden = b.dataset.authTab !== 'register';
    $('#auth-error').textContent = '';
  }));
  const submit = (form, path) => form.addEventListener('submit', async (e) => {
    e.preventDefault();
    $('#auth-error').textContent = '';
    const btn = $('button[type=submit]', form);
    btn.disabled = true;
    try {
      const body = Object.fromEntries(new FormData(form));
      const { user } = await api(path, { method: 'POST', body });
      state.me = user;
      form.reset();
      showApp();
    } catch (ex) { $('#auth-error').textContent = ex.message; }
    finally { btn.disabled = false; }
  });
  submit($('#login-form'), '/auth/login');
  submit($('#register-form'), '/auth/register');
}

// ---------- boot ----------
async function boot() {
  chartDefaults();
  state.config = await api('/config');
  $$('[data-app-name]').forEach((el) => (el.textContent = state.config.app_name));
  document.title = state.config.app_name;
  $('#type-list').innerHTML = state.config.suggested_types.map((t) => `<option value="${esc(t)}">`).join('');
  wireAuth();
  wireLogDialog();
  window.addEventListener('hashchange', route);
  try {
    const { user } = await api('/me');
    state.me = user;
    showApp();
  } catch {
    showAuth();
  }
}
boot();
