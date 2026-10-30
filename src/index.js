// Move Club — Cloudflare Worker serving a JSON API under /api and static files from ./public.

const SESSION_DAYS = 30;
const PALETTE = ['#4f7cff', '#ff6b6b', '#2bb673', '#f5a623', '#9b59b6', '#00b8d9', '#ff8fab', '#8a9a2b', '#e67e22', '#16a085'];
const SUGGESTED_TYPES = ['run', 'walk', 'ride', 'gym', 'swim', 'hike', 'sport', 'yoga', 'other'];

// ---------- small helpers ----------

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  });

const enc = new TextEncoder();
const toHex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const fromHex = (hex) => new Uint8Array(hex.match(/.{2}/g).map((h) => parseInt(h, 16)));
const randomHex = (bytes = 32) => toHex(crypto.getRandomValues(new Uint8Array(bytes)));
const sha256 = async (s) => toHex(await crypto.subtle.digest('SHA-256', enc.encode(s)));
const nowIso = () => new Date().toISOString();

// Dates without a time are interpreted in the club's time zone (TIMEZONE var, e.g. Pacific/Auckland).
const tzName = (env) => env.TIMEZONE || 'UTC';
function tzOffsetMs(date, timeZone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
      .formatToParts(date).map((p) => [p.type, p.value])
  );
  return Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second) - Math.floor(date.getTime() / 1000) * 1000;
}
const todayIn = (env) => new Intl.DateTimeFormat('en-CA', { timeZone: tzName(env) }).format(new Date()); // YYYY-MM-DD
function middayIso(date, env) {
  const [y, m, d] = date.split('-').map(Number);
  const guess = new Date(Date.UTC(y, m - 1, d, 12));
  return new Date(guess.getTime() - tzOffsetMs(guess, tzName(env))).toISOString();
}

function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function pbkdf2(password, salt, iterations) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
  return toHex(bits);
}

async function hashPassword(password, env) {
  // Kept modest so login fits inside the Workers free-plan CPU budget. Raise via PBKDF2_ITERATIONS on a paid plan.
  const iterations = Math.min(Number(env.PBKDF2_ITERATIONS) || 10000, 100000);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2$${iterations}$${toHex(salt)}$${await pbkdf2(password, salt, iterations)}`;
}

async function verifyPassword(password, stored) {
  const [scheme, iter, saltHex, hashHex] = String(stored).split('$');
  if (scheme !== 'pbkdf2') return false;
  return safeEqual(await pbkdf2(password, fromHex(saltHex), Number(iter)), hashHex);
}

function getCookie(req, name) {
  const header = req.headers.get('cookie') || '';
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return null;
}

const sessionCookie = (token, maxAge) =>
  `sid=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;

// ---------- orchard ----------
// Each person grows a fruit tree through seasons. Every activity moves the tree one step:
//   grow (first season only) -> leaves -> flowers -> fruit -> fall -> leaves -> ...
// In the fruit stage each activity feeds one unripe fruit (usually the ripest, sometimes a random one); a ripe fruit
// drops into the basket. When the whole crop is in, the leaves fall and a new season starts.
// All randomness is a hash of (user, activity id / season), so the tree is identical on every load.
const ORCHARD = {
  grow: 12, leaves: 6, flowers: 6, fall: 6,   // activities per stage
  cropMin: 4, cropMax: 6,                     // fruit per season
  needMin: 8, needMax: 12,                    // feeds for one fruit to ripen
  focus: 0.7,                                 // share of feeds that go to the ripest fruit
};
const FRUITS = ['apple', 'pear', 'orange', 'lemon', 'feijoa', 'plum', 'cherry', 'peach', 'avocado'];

function hash32(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12;
  return h >>> 0;
}
const between = (h, min, max) => min + (h % (max - min + 1));

function growOrchard(userId, activityIds) {
  const O = ORCHARD;
  let stage = 'grow', step = 0, season = 1, basket = 0, fruit = [];
  const ripenedIds = [];
  const stageIds = {}; // activity id -> stage it started
  const enter = (next, id) => { stage = next; step = 0; stageIds[id] = next; };
  const setCrop = () => {
    const crop = between(hash32(`crop:${userId}:${season}`), O.cropMin, O.cropMax);
    fruit = Array.from({ length: crop }, (_, i) => ({ growth: 0, need: between(hash32(`need:${userId}:${season}:${i}`), O.needMin, O.needMax), done: false }));
  };
  for (const id of activityIds) {
    if (stage === 'grow') { if (++step >= O.grow) enter('leaves', id); }
    else if (stage === 'leaves') { if (++step >= O.leaves) { setCrop(); enter('flowers', id); } }
    else if (stage === 'flowers') { if (++step >= O.flowers) enter('fruit', id); }
    else if (stage === 'fruit') {
      const open = fruit.filter((f) => !f.done);
      const r = hash32(`feed:${userId}:${id}`);
      let f = open[(r >>> 10) % open.length];
      if ((r % 1000) / 1000 < O.focus) f = open.reduce((a, b) => (b.growth / b.need > a.growth / a.need ? b : a));
      if (++f.growth >= f.need) {
        f.done = true;
        basket++;
        ripenedIds.push(id);
        if (fruit.every((x) => x.done)) enter('fall', id);
      }
    } else if (stage === 'fall') { if (++step >= O.fall) { season++; fruit = []; enter('leaves', id); } }
  }
  const len = { grow: O.grow, leaves: O.leaves, flowers: O.flowers, fall: O.fall }[stage];
  return {
    basket, season, stage,
    activities: activityIds.length,
    progress: stage === 'fruit' ? fruit.filter((f) => f.done).length / fruit.length : step / len,
    steps_left: stage === 'fruit' ? null : len - step,
    crop: fruit.length || null,
    fruit: fruit.map(({ growth, need, done }) => ({ growth, need, done })),
    ripenedIds, stageIds,
  };
}

async function orchardsFor(env, userIds) {
  const { results } = await env.DB.prepare('SELECT user_id, id FROM activities ORDER BY id').all();
  const ids = {};
  for (const r of results) (ids[r.user_id] ||= []).push(r.id);
  return Object.fromEntries((userIds ?? Object.keys(ids).map(Number)).map((uid) => [uid, growOrchard(uid, ids[uid] || [])]));
}

// ---------- validation ----------

function str(v, field, min, max) {
  if (typeof v !== 'string') throw new HttpError(400, `${field} must be text`);
  const s = v.trim();
  if (s.length < min) throw new HttpError(400, min === 1 ? `${field} is required` : `${field} must be at least ${min} characters`);
  if (s.length > max) throw new HttpError(400, `${field} must be at most ${max} characters`);
  return s;
}

function num(v, field, min, max, { integer = false } = {}) {
  if (v === null || v === '' || v === undefined) return null;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new HttpError(400, `${field} must be a number`);
  if (integer && !Number.isInteger(n)) throw new HttpError(400, `${field} must be a whole number`);
  if (n < min || n > max) throw new HttpError(400, `${field} must be between ${min} and ${max}`);
  return n;
}

function isoTime(v, field) {
  const d = new Date(v);
  if (typeof v !== 'string' || Number.isNaN(d.getTime())) throw new HttpError(400, `${field} must be an ISO 8601 date-time`);
  if (d.getTime() > Date.now() + 36 * 3600 * 1000) throw new HttpError(400, `${field} can't be in the future`);
  return d.toISOString();
}

function dateOnly(v, field) {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(new Date(v + 'T00:00:00Z').getTime()))
    throw new HttpError(400, `${field} must be a date like 2026-10-23`);
  return v;
}

function validateActivity(b, partial, env) {
  const out = {};
  if (!partial || 'title' in b) out.title = str(b.title ?? '', 'title', 1, 80);
  if ('description' in b) out.description = str(b.description ?? '', 'description', 0, 500);
  if ('type' in b || !partial) {
    const t = String(b.type ?? 'other').trim().toLowerCase() || 'other';
    if (!/^[a-z][a-z0-9 -]{0,29}$/.test(t)) throw new HttpError(400, 'type must be a short word like "run" or "gym"');
    out.type = t;
  }
  if (!partial || 'duration_min' in b) {
    out.duration_min = num(b.duration_min, 'duration_min', 1, 1440, { integer: true });
    if (out.duration_min === null) throw new HttpError(400, 'duration_min (how many minutes) is required');
  }
  if ('distance_km' in b) out.distance_km = num(b.distance_km, 'distance_km', 0, 1000);
  if ('date' in b && !('occurred_at' in b)) out.occurred_at = isoTime(middayIso(dateOnly(b.date, 'date'), env), 'date');
  else if ('occurred_at' in b) out.occurred_at = isoTime(b.occurred_at, 'occurred_at');
  else if (!partial) out.occurred_at = middayIso(todayIn(env), env);
  return out;
}

// ---------- serializers ----------

const ACTIVITY_SELECT = `SELECT a.id, a.title, a.description, a.type, a.duration_min, a.distance_km, a.occurred_at, a.created_at,
  u.username, u.display_name, u.color, u.fruit FROM activities a JOIN users u ON u.id = a.user_id`;

const activityOut = (r, env) => ({
  id: r.id, username: r.username, display_name: r.display_name, color: r.color, fruit: r.fruit,
  title: r.title, description: r.description, type: r.type,
  duration_min: r.duration_min, distance_km: r.distance_km,
  occurred_at: r.occurred_at, created_at: r.created_at,
});

const userOut = (u, env) => {
  const out = {
    username: u.username, display_name: u.display_name, color: u.color,
    height_cm: u.height_cm, target_weight_kg: u.target_weight_kg, maori_mode: !!u.maori_mode, bio: u.bio, created_at: u.created_at,
  };
  out.fruit = u.fruit || 'apple';
  if (u.orchard) { const { ripenedIds, stageIds, ...o } = u.orchard; out.orchard = o; }
  if ('activity_count' in u) {
    out.activity_count = u.activity_count;
    out.last_active_at = u.last_active_at;
    out.latest_weight_kg = u.latest_weight_kg;
  }
  return out;
};

const USER_STATS_SELECT = `SELECT u.*,
  (SELECT COUNT(*) FROM activities a WHERE a.user_id = u.id) AS activity_count,
  (SELECT MAX(occurred_at) FROM activities a WHERE a.user_id = u.id) AS last_active_at,
  (SELECT weight_kg FROM metrics m WHERE m.user_id = u.id AND m.weight_kg IS NOT NULL ORDER BY date DESC LIMIT 1) AS latest_weight_kg
  FROM users u`;

// ---------- auth ----------

async function startSession(env, userId) {
  const token = randomHex(32);
  const expires = new Date(Date.now() + SESSION_DAYS * 86400 * 1000).toISOString();
  await env.DB.batch([
    env.DB.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(nowIso()),
    env.DB.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').bind(await sha256(token), userId, expires),
  ]);
  return sessionCookie(token, SESSION_DAYS * 86400);
}

async function authenticate(req, env) {
  const auth = req.headers.get('authorization') || '';
  if (auth.toLowerCase().startsWith('bearer ')) {
    const key = auth.slice(7).trim();
    const user = await env.DB.prepare('SELECT * FROM users WHERE api_key_hash = ?').bind(await sha256(key)).first();
    if (!user) throw new HttpError(401, 'Invalid API key');
    return { user, via: 'api_key' };
  }
  const sid = getCookie(req, 'sid');
  if (sid) {
    const user = await env.DB.prepare(
      'SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?'
    ).bind(await sha256(sid), nowIso()).first();
    if (user) return { user, via: 'session' };
  }
  return null;
}

// ---------- handlers ----------

async function register({ env, body }) {
  if (!env.INVITE_CODE) throw new HttpError(403, 'Sign-up is closed (no INVITE_CODE configured)');
  if (!safeEqual(String(body.invite_code ?? ''), String(env.INVITE_CODE))) throw new HttpError(403, 'That invite code is not right');
  const username = str(body.username ?? '', 'username', 3, 20).toLowerCase();
  if (!/^[a-z0-9_]+$/.test(username)) throw new HttpError(400, 'username can only use letters, numbers and _');
  const password = String(body.password ?? '');
  if (password.length < 8) throw new HttpError(400, 'password must be at least 8 characters');
  const display = str(body.display_name || username, 'display_name', 1, 40);
  const exists = await env.DB.prepare('SELECT 1 FROM users WHERE username = ?').bind(username).first();
  if (exists) throw new HttpError(409, 'That username is taken');
  const { n } = await env.DB.prepare('SELECT COUNT(*) AS n FROM users').first();
  const color = PALETTE[n % PALETTE.length];
  const res = await env.DB.prepare('INSERT INTO users (username, display_name, password_hash, color) VALUES (?, ?, ?, ?)')
    .bind(username, display, await hashPassword(password, env), color).run();
  const user = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(res.meta.last_row_id).first();
  return json({ user: userOut(user, env) }, 201, { 'set-cookie': await startSession(env, user.id) });
}

async function login({ env, body }) {
  const username = String(body.username ?? '').trim().toLowerCase();
  const user = await env.DB.prepare('SELECT * FROM users WHERE username = ?').bind(username).first();
  if (!user || !(await verifyPassword(String(body.password ?? ''), user.password_hash)))
    throw new HttpError(401, 'Wrong username or password');
  return json({ user: userOut(user, env) }, 200, { 'set-cookie': await startSession(env, user.id) });
}

async function logout({ req, env }) {
  const sid = getCookie(req, 'sid');
  if (sid) await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256(sid)).run();
  return json({ ok: true }, 200, { 'set-cookie': sessionCookie('', 0) });
}

async function getMe({ env, user }) {
  return json({ user: { ...userOut(user, env), has_api_key: !!user.api_key_hash } });
}

async function updateMe({ env, user, body }) {
  const sets = {};
  if ('display_name' in body) sets.display_name = str(body.display_name ?? '', 'display_name', 1, 40);
  if ('bio' in body) sets.bio = str(body.bio ?? '', 'bio', 0, 300);
  if ('height_cm' in body) sets.height_cm = num(body.height_cm, 'height_cm', 50, 260);
  if ('fruit' in body) {
    if (!FRUITS.includes(body.fruit)) throw new HttpError(400, `fruit must be one of: ${FRUITS.join(', ')}`);
    sets.fruit = body.fruit;
  }
  if ('maori_mode' in body) {
    if (typeof body.maori_mode !== 'boolean') throw new HttpError(400, 'maori_mode must be true or false');
    sets.maori_mode = body.maori_mode ? 1 : 0;
  }
  if ('target_weight_kg' in body) sets.target_weight_kg = num(body.target_weight_kg, 'target_weight_kg', 20, 400);
  if ('color' in body) {
    if (!/^#[0-9a-fA-F]{6}$/.test(String(body.color))) throw new HttpError(400, 'color must look like #4f7cff');
    sets.color = body.color;
  }
  const keys = Object.keys(sets);
  if (keys.length) {
    await env.DB.prepare(`UPDATE users SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`)
      .bind(...keys.map((k) => sets[k]), user.id).run();
  }
  const fresh = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(user.id).first();
  return json({ user: { ...userOut(fresh, env), has_api_key: !!fresh.api_key_hash } });
}

async function changePassword({ env, user, body }) {
  if (!(await verifyPassword(String(body.current_password ?? ''), user.password_hash)))
    throw new HttpError(400, 'Current password is wrong');
  const pw = String(body.new_password ?? '');
  if (pw.length < 8) throw new HttpError(400, 'New password must be at least 8 characters');
  await env.DB.batch([
    env.DB.prepare('UPDATE users SET password_hash = ? WHERE id = ?').bind(await hashPassword(pw, env), user.id),
    env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(user.id),
  ]);
  return json({ ok: true }, 200, { 'set-cookie': await startSession(env, user.id) });
}

async function createApiKey({ env, user, via }) {
  if (via !== 'session') throw new HttpError(403, 'Log in on the website to manage API keys');
  const key = `mc_${randomHex(24)}`;
  await env.DB.prepare('UPDATE users SET api_key_hash = ? WHERE id = ?').bind(await sha256(key), user.id).run();
  return json({ api_key: key, note: 'Store this now — it will not be shown again.' }, 201);
}

async function revokeApiKey({ env, user, via }) {
  if (via !== 'session') throw new HttpError(403, 'Log in on the website to manage API keys');
  await env.DB.prepare('UPDATE users SET api_key_hash = NULL WHERE id = ?').bind(user.id).run();
  return json({ ok: true });
}

async function listUsers({ env }) {
  const { results } = await env.DB.prepare(`${USER_STATS_SELECT} ORDER BY activity_count DESC, u.display_name`).all();
  const orchards = await orchardsFor(env, results.map((u) => u.id));
  return json({ users: results.map((u) => userOut({ ...u, orchard: orchards[u.id] }, env)) });
}

async function getUser({ env, params }) {
  const u = await env.DB.prepare(`${USER_STATS_SELECT} WHERE u.username = ?`).bind(params.username.toLowerCase()).first();
  if (!u) throw new HttpError(404, 'No such person');
  const [acts, mets, ids] = await Promise.all([
    env.DB.prepare(`${ACTIVITY_SELECT} WHERE a.user_id = ? ORDER BY a.occurred_at DESC LIMIT 1000`).bind(u.id).all(),
    env.DB.prepare('SELECT date, weight_kg, updated_at FROM metrics WHERE user_id = ? AND weight_kg IS NOT NULL ORDER BY date DESC LIMIT 1000').bind(u.id).all(),
    env.DB.prepare('SELECT id FROM activities WHERE user_id = ? ORDER BY id').bind(u.id).all(),
  ]);
  const orchard = growOrchard(u.id, ids.results.map((r) => r.id));
  const ripe = new Set(orchard.ripenedIds);
  return json({
    user: userOut({ ...u, orchard }, env),
    activities: acts.results.map((r) => ({ ...activityOut(r, env), ripened: ripe.has(r.id), stage_started: orchard.stageIds[r.id] || null })),
    weight: mets.results,
  });
}

async function listActivities({ env, url }) {
  const q = url.searchParams;
  const where = [];
  const args = [];
  if (q.get('user')) { where.push('u.username = ?'); args.push(q.get('user').toLowerCase()); }
  if (q.get('type')) { where.push('a.type = ?'); args.push(q.get('type').toLowerCase()); }
  if (q.get('since')) { where.push('a.occurred_at >= ?'); args.push(isoTime(q.get('since'), 'since')); }
  if (q.get('until')) { where.push('a.occurred_at < ?'); args.push(new Date(q.get('until')).toISOString()); }
  const limit = Math.min(Math.max(Number(q.get('limit')) || 100, 1), 2000);
  const sql = `${ACTIVITY_SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY a.occurred_at DESC LIMIT ${limit}`;
  const { results } = await env.DB.prepare(sql).bind(...args).all();
  return json({ activities: results.map((r) => activityOut(r, env)) });
}

async function getActivity({ env, params }) {
  const r = await env.DB.prepare(`${ACTIVITY_SELECT} WHERE a.id = ?`).bind(Number(params.id)).first();
  if (!r) throw new HttpError(404, 'No such activity');
  return json({ activity: activityOut(r, env) });
}

async function createActivity({ env, user, body }) {
  const a = validateActivity(body, false, env);
  const res = await env.DB.prepare(
    'INSERT INTO activities (user_id, title, description, type, duration_min, distance_km, occurred_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).bind(user.id, a.title, a.description ?? '', a.type, a.duration_min ?? null, a.distance_km ?? null, a.occurred_at).run();
  const [r, ids] = await Promise.all([
    env.DB.prepare(`${ACTIVITY_SELECT} WHERE a.id = ?`).bind(res.meta.last_row_id).first(),
    env.DB.prepare('SELECT id FROM activities WHERE user_id = ? ORDER BY id').bind(user.id).all(),
  ]);
  const allIds = ids.results.map((x) => x.id);
  const orchard = growOrchard(user.id, allIds);
  const before = growOrchard(user.id, allIds.filter((id) => id !== r.id));
  const ripened = orchard.basket > before.basket;
  const { ripenedIds, stageIds, ...o } = orchard;
  return json({ activity: activityOut(r, env), orchard: o, ripened, stage_changed: before.stage !== orchard.stage || before.season !== orchard.season }, 201);
}

async function ownActivity(env, user, id) {
  const row = await env.DB.prepare('SELECT user_id FROM activities WHERE id = ?').bind(Number(id)).first();
  if (!row) throw new HttpError(404, 'No such activity');
  if (row.user_id !== user.id) throw new HttpError(403, "You can only change your own activities");
}

async function updateActivity({ env, user, params, body }) {
  await ownActivity(env, user, params.id);
  const a = validateActivity(body, true, env);
  const keys = Object.keys(a);
  if (keys.length) {
    await env.DB.prepare(`UPDATE activities SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`)
      .bind(...keys.map((k) => a[k]), Number(params.id)).run();
  }
  return getActivity({ env, params });
}

async function deleteActivity({ env, user, params }) {
  await ownActivity(env, user, params.id);
  await env.DB.prepare('DELETE FROM activities WHERE id = ?').bind(Number(params.id)).run();
  return json({ ok: true });
}

async function listMetrics({ env, url }) {
  const q = url.searchParams;
  const where = ['m.weight_kg IS NOT NULL'];
  const args = [];
  if (q.get('user')) { where.push('u.username = ?'); args.push(q.get('user').toLowerCase()); }
  if (q.get('since')) { where.push('m.date >= ?'); args.push(dateOnly(q.get('since'), 'since')); }
  const limit = Math.min(Math.max(Number(q.get('limit')) || 500, 1), 5000);
  const { results } = await env.DB.prepare(
    `SELECT m.date, m.weight_kg, m.updated_at, u.username, u.display_name, u.color
     FROM metrics m JOIN users u ON u.id = m.user_id ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY m.date DESC LIMIT ${limit}`
  ).bind(...args).all();
  return json({ weight: results });
}

async function upsertMetrics({ env, user, body }) {
  const date = dateOnly(body.date ?? todayIn(env), 'date');
  const weight = num(body.weight_kg, 'weight_kg', 20, 400);
  if (weight === null) throw new HttpError(400, 'weight_kg is required');
  await env.DB.prepare(
    `INSERT INTO metrics (user_id, date, weight_kg, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id, date) DO UPDATE SET weight_kg = excluded.weight_kg, updated_at = excluded.updated_at`
  ).bind(user.id, date, weight, nowIso()).run();
  const row = await env.DB.prepare('SELECT date, weight_kg, updated_at FROM metrics WHERE user_id = ? AND date = ?').bind(user.id, date).first();
  return json({ weight: { ...row, username: user.username } }, 201);
}

async function deleteMetric({ env, user, params }) {
  await env.DB.prepare('DELETE FROM metrics WHERE user_id = ? AND date = ?').bind(user.id, dateOnly(params.date, 'date')).run();
  return json({ ok: true });
}

async function feed({ env, url }) {
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 40, 1), 200);
  const [acts, mets, orchards] = await Promise.all([
    env.DB.prepare(`${ACTIVITY_SELECT} ORDER BY a.occurred_at DESC LIMIT ?`).bind(limit).all(),
    env.DB.prepare(
      `SELECT m.date, m.weight_kg, m.updated_at, u.username, u.display_name, u.color
       FROM metrics m JOIN users u ON u.id = m.user_id WHERE m.weight_kg IS NOT NULL ORDER BY m.date DESC, m.updated_at DESC LIMIT ?`
    ).bind(limit).all(),
    orchardsFor(env),
  ]);
  const ripe = new Set(Object.values(orchards).flatMap((o) => o.ripenedIds));
  const stageAt = Object.assign({}, ...Object.values(orchards).map((o) => o.stageIds));
  // Stats sort by when they were saved, but never later than the day they're for (so back-filled days stay in place).
  const metricAt = (m) => { const cap = `${m.date}T23:59:59.999Z`; return m.updated_at < cap ? m.updated_at : cap; };
  const items = [
    ...acts.results.map((r) => ({ kind: 'activity', at: r.occurred_at, ...activityOut(r, env), ripened: ripe.has(r.id), stage_started: stageAt[r.id] || null })),
    ...mets.results.map((m) => ({ kind: 'metrics', at: metricAt(m), ...m })),
  ].sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, limit);
  return json({ items });
}

async function config({ env }) {
  return json({
    app_name: env.APP_NAME || 'Move Club',
    orchard: ORCHARD,
    fruits: FRUITS,
    suggested_types: SUGGESTED_TYPES,
    signup_open: !!env.INVITE_CODE,
  });
}

// ---------- router ----------

const routes = [
  ['GET', '/api/config', config, false],
  ['POST', '/api/auth/register', register, false],
  ['POST', '/api/auth/login', login, false],
  ['POST', '/api/auth/logout', logout, false],
  ['GET', '/api/me', getMe, true],
  ['PATCH', '/api/me', updateMe, true],
  ['POST', '/api/me/password', changePassword, true],
  ['POST', '/api/me/api-key', createApiKey, true],
  ['DELETE', '/api/me/api-key', revokeApiKey, true],
  ['GET', '/api/users', listUsers, true],
  ['GET', '/api/users/:username', getUser, true],
  ['GET', '/api/feed', feed, true],
  ['GET', '/api/activities', listActivities, true],
  ['POST', '/api/activities', createActivity, true],
  ['GET', '/api/activities/:id', getActivity, true],
  ['PATCH', '/api/activities/:id', updateActivity, true],
  ['DELETE', '/api/activities/:id', deleteActivity, true],
  ['GET', '/api/weight', listMetrics, true],
  ['POST', '/api/weight', upsertMetrics, true],
  ['DELETE', '/api/weight/:date', deleteMetric, true],
].map(([method, path, handler, auth]) => {
  const names = [];
  const re = new RegExp('^' + path.replace(/:(\w+)/g, (_, n) => (names.push(n), '([^/]+)')) + '/?$');
  return { method, re, names, handler, auth };
});

async function handleApi(req, env, url) {
  const matches = routes.filter((r) => r.re.test(url.pathname));
  if (!matches.length) throw new HttpError(404, 'Not found');
  const route = matches.find((r) => r.method === req.method);
  if (!route) throw new HttpError(405, 'Method not allowed');

  const m = url.pathname.match(route.re);
  const params = Object.fromEntries(route.names.map((n, i) => [n, decodeURIComponent(m[i + 1])]));

  let body = {};
  if (req.method === 'POST' || req.method === 'PATCH') {
    // Requiring JSON also blocks cross-site form posts (a simple CSRF guard).
    if (!(req.headers.get('content-type') || '').includes('application/json'))
      throw new HttpError(415, 'Send a JSON body with Content-Type: application/json');
    const text = await req.text();
    if (text) {
      try { body = JSON.parse(text); } catch { throw new HttpError(400, 'Body is not valid JSON'); }
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'Body must be a JSON object');
    }
  }

  const ctx = { req, env, url, params, body };
  if (route.auth) {
    const auth = await authenticate(req, env);
    if (!auth) throw new HttpError(401, 'Not logged in');
    ctx.user = auth.user;
    ctx.via = auth.via;
  }
  return route.handler(ctx);
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(req);
    try {
      return await handleApi(req, env, url);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message }, e.status);
      console.error(e);
      return json({ error: 'Something went wrong on the server' }, 500);
    }
  },
};
