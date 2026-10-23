import { HttpError, json, readJson, str, int, now, randomToken, randomDigits, hashPassword, safeEqual, parseCookies, cookie, getSettings, sha256Hex, logoUrl, setSettings } from './util.js';

const COOKIE = 'ivy_s';
const DAY = 86400;

export async function currentUser(request, env) {
  const token = parseCookies(request)[COOKIE];
  if (!token) return null;
  const row = await env.DB.prepare(
    `SELECT s.token, s.expires_at, u.id, u.role, u.login_id, u.name, u.class_id, u.active
       FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?`,
  )
    .bind(token)
    .first();
  if (!row || row.expires_at < now() || !row.active) return null;
  // 남은 기간이 절반 이하면 연장해요
  const life = row.role === 'admin' ? 14 * DAY : 60 * DAY;
  if (row.expires_at - now() < life / 2) {
    await env.DB.prepare('UPDATE sessions SET expires_at = ? WHERE token = ?').bind(now() + life, token).run();
  }
  return { id: row.id, role: row.role, login_id: row.login_id, name: row.name, class_id: row.class_id, token };
}

export function requireRole(user, role) {
  if (!user) throw new HttpError(401, '로그인이 필요해요.', 'login_required');
  if (role && user.role !== role) throw new HttpError(403, '권한이 없어요.', 'forbidden');
}

async function tooManyAttempts(env, key, limit = 8) {
  const row = await env.DB.prepare('SELECT count, first_at FROM login_attempts WHERE key = ?').bind(key).first();
  if (!row) return false;
  if (now() - row.first_at > 600) {
    await env.DB.prepare('DELETE FROM login_attempts WHERE key = ?').bind(key).run();
    return false;
  }
  return row.count >= limit;
}

async function noteFailure(env, key) {
  await env.DB.prepare(
    `INSERT INTO login_attempts (key, count, first_at) VALUES (?, 1, ?)
     ON CONFLICT(key) DO UPDATE SET count = count + 1`,
  )
    .bind(key, now())
    .run();
}

async function startSession(env, request, user) {
  const token = randomToken(32);
  const life = user.role === 'admin' ? 14 * DAY : 60 * DAY;
  await env.DB.batch([
    env.DB.prepare('INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').bind(token, user.id, now(), now() + life),
    env.DB.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').bind(now(), user.id),
    env.DB.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(now()),
  ]);
  const secure = new URL(request.url).protocol === 'https:';
  return cookie(COOKIE, token, { maxAge: life, secure });
}

// ---------------------------------------------------------------- 계정 되찾기
// 복구 코드: 숫자 16자리. 선생님이 사진이나 종이로 보관했다가 비밀번호를 잊으면 로그인 화면에서 넣어요.
// DB에는 비밀번호처럼 해시만 두고, 쓴 뒤에도 새로 만들기 전까지 계속 쓸 수 있어요.
// Cloudflare 에 SETUP_CODE 비밀값(8자 이상)을 넣어 두면 그 값이 비상 코드가 돼요. 복구 코드까지 잃어버렸을 때 써요.
const RC_DIGITS = 16;
const masterKey = (env) => String(env.SETUP_CODE || '').trim();
const showCode = (d) => d.replace(/(\d{4})(?=\d)/g, '$1-');

async function makeRecovery(env) {
  const code = randomDigits(RC_DIGITS);
  const { hash, salt } = await hashPassword(code);
  await setSettings(env, { recovery_hash: hash, recovery_salt: salt, recovery_at: now() });
  return showCode(code);
}

// 맞으면 'master'(Cloudflare 비상 코드)나 'code'(복구 코드), 틀리면 ''
async function checkRecovery(env, input) {
  const raw = str(input, 200);
  if (!raw) return '';
  const master = masterKey(env);
  if (master && safeEqual(await sha256Hex(raw), await sha256Hex(master))) {
    if (master.length < 8) throw new HttpError(400, 'Cloudflare 비상 코드가 너무 짧아요. SETUP_CODE 를 8자 이상으로 다시 넣어 주세요.', 'weak_master');
    return 'master';
  }
  const d = raw.replace(/\D/g, '');
  if (d.length !== RC_DIGITS) return '';
  const { results } = await env.DB.prepare("SELECT key, value FROM settings WHERE key IN ('recovery_hash', 'recovery_salt')").all();
  const s = Object.fromEntries(results.map((r) => [r.key, r.value]));
  if (!s.recovery_hash || !s.recovery_salt) return '';
  return safeEqual((await hashPassword(d, s.recovery_salt)).hash, s.recovery_hash) ? 'code' : '';
}

export async function handleAuth(request, env, path, user) {
  if (path === '/api/public/info' && request.method === 'GET') {
    const s = await getSettings(env);
    const admin = await env.DB.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'").first();
    return json({
      app_name: s.app_name,
      academy_name: s.academy_name,
      has_admin: admin.n > 0,
      needs_code: !!env.SETUP_CODE,
      logo_url: logoUrl(s),
    });
  }

  if (path === '/api/setup' && request.method === 'POST') {
    // 처음 한 번만: 선생님(관리자) 계정 만들기. SETUP_CODE 비밀값을 넣어 두었으면 그 코드도 맞아야 해요.
    const admin = await env.DB.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'").first();
    if (admin.n > 0) throw new HttpError(409, '이미 관리자 계정이 있어요.', 'exists');
    const body = await readJson(request);
    const code = str(body.setup_code, 200);
    if (masterKey(env) && !safeEqual(await sha256Hex(code), await sha256Hex(masterKey(env)))) {
      throw new HttpError(403, '처음 설정 코드가 맞지 않아요.', 'bad_setup_code');
    }
    const login_id = str(body.login_id, 40);
    const name = str(body.name, 40) || '선생님';
    const password = String(body.password || '');
    if (!/^[A-Za-z0-9_.-]{3,40}$/.test(login_id)) throw new HttpError(400, '아이디는 영문, 숫자 3자 이상으로 정해 주세요.');
    if (password.length < 8) throw new HttpError(400, '비밀번호는 8자 이상으로 정해 주세요.');
    const { hash, salt } = await hashPassword(password);
    const r = await env.DB.prepare(
      `INSERT INTO users (role, login_id, name, pw_hash, pw_salt, created_at)
       SELECT 'admin', ?, ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM users WHERE role = 'admin')`,
    )
      .bind(login_id, name, hash, salt, now())
      .run();
    if (!r.meta.changes) throw new HttpError(409, '이미 관리자 계정이 있어요.', 'exists');
    const academy = str(body.academy_name, 60);
    if (academy) await setSettings(env, { academy_name: academy, app_name: `${academy} 강의실` });
    // 비밀번호를 잊을 때를 대비해 복구 코드를 바로 만들어 드려요 (이 응답에서 한 번만 보여요)
    const recovery_code = await makeRecovery(env);
    const setCookie = await startSession(env, request, { id: r.meta.last_row_id, role: 'admin' });
    return json({ ok: true, login_id, recovery_code }, 200, { 'Set-Cookie': setCookie });
  }

  if ((path === '/api/recover/check' || path === '/api/recover/reset') && request.method === 'POST') {
    // 비밀번호를 잊었을 때: 복구 코드(또는 Cloudflare 비상 코드)를 확인하고 아이디를 보여 준 뒤 새 비밀번호를 정해요
    const body = await readJson(request);
    const ip = request.headers.get('CF-Connecting-IP') || 'local';
    const limits = [[`rc:ip:${ip}`, 8], ['rc:all', 50]];
    for (const [k, n] of limits) {
      if (await tooManyAttempts(env, k, n)) throw new HttpError(429, '시도가 너무 많아요. 10분 뒤에 다시 해 주세요.', 'rate_limited');
    }
    const { results: admins } = await env.DB.prepare("SELECT id, login_id, name FROM users WHERE role = 'admin' AND active = 1 ORDER BY id").all();
    if (!admins.length) throw new HttpError(409, '아직 선생님 계정이 없어요. 처음 설정부터 해 주세요.', 'no_admin');
    const how = await checkRecovery(env, body.code);
    if (!how) {
      for (const [k] of limits) await noteFailure(env, k);
      throw new HttpError(400, '복구 코드가 맞지 않아요. 숫자 16자리를 다시 확인해 주세요.', 'bad_code');
    }
    if (path === '/api/recover/check') return json({ ok: true, how, admins });
    const target = admins.length === 1 ? admins[0] : admins.find((a) => a.id === int(body.user_id));
    if (!target) throw new HttpError(400, '새 비밀번호를 정할 계정을 골라 주세요.');
    const password = String(body.password || '');
    if (password.length < 8) throw new HttpError(400, '새 비밀번호는 8자 이상으로 정해 주세요.');
    const { hash, salt } = await hashPassword(password);
    await env.DB.batch([
      env.DB.prepare('UPDATE users SET pw_hash = ?, pw_salt = ? WHERE id = ?').bind(hash, salt, target.id),
      // 다른 기기에 남아 있던 로그인은 모두 끊어요
      env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(target.id),
      env.DB.prepare('DELETE FROM login_attempts WHERE key IN (?, ?)').bind(`id:${target.login_id.toLowerCase()}`, `rc:ip:${ip}`),
    ]);
    // 비상 코드로 들어왔으면 복구 코드를 잃어버린 거라 새로 만들어 드려요. 복구 코드가 아직 없을 때도요.
    const had = (await getSettings(env)).recovery_at > 0;
    const recovery_code = how === 'master' || !had ? await makeRecovery(env) : null;
    const setCookie = await startSession(env, request, { id: target.id, role: 'admin' });
    return json({ ok: true, login_id: target.login_id, name: target.name, recovery_code, replaced: !!recovery_code && had }, 200, { 'Set-Cookie': setCookie });
  }

  if (path === '/api/admin/recovery') {
    // 설정 → 내 계정: 복구 코드가 있는지 보고, 지금 비밀번호를 확인한 뒤 새로 만들어요
    requireRole(user, 'admin');
    if (request.method === 'GET') {
      const s = await getSettings(env);
      return json({ ready: s.recovery_at > 0, made_at: s.recovery_at || null, master: masterKey(env).length >= 8 });
    }
    if (request.method === 'POST') {
      const body = await readJson(request);
      const key = `id:${user.login_id.toLowerCase()}`;
      if (await tooManyAttempts(env, key)) throw new HttpError(429, '비밀번호를 너무 많이 틀렸어요. 10분 뒤에 다시 해 주세요.', 'rate_limited');
      const u = await env.DB.prepare('SELECT pw_hash, pw_salt FROM users WHERE id = ?').bind(user.id).first();
      if (!safeEqual((await hashPassword(String(body.password || ''), u.pw_salt)).hash, u.pw_hash)) {
        await noteFailure(env, key);
        throw new HttpError(400, '지금 비밀번호가 맞지 않아요.', 'bad_password');
      }
      const code = await makeRecovery(env);
      return json({ ok: true, code, made_at: now() });
    }
  }

  if (path === '/api/login' && request.method === 'POST') {
    const body = await readJson(request);
    const login_id = str(body.login_id, 40);
    const password = String(body.password || '');
    const ip = request.headers.get('CF-Connecting-IP') || 'local';
    const keys = [`id:${login_id.toLowerCase()}`, `ip:${ip}`];
    for (const k of keys) {
      if (await tooManyAttempts(env, k)) throw new HttpError(429, '로그인 시도가 너무 많아요. 10분 뒤에 다시 해 주세요.', 'rate_limited');
    }
    const u = await env.DB.prepare('SELECT * FROM users WHERE login_id = ? AND active = 1').bind(login_id).first();
    const ok = u && safeEqual((await hashPassword(password, u.pw_salt)).hash, u.pw_hash);
    if (!ok) {
      for (const k of keys) await noteFailure(env, k);
      throw new HttpError(401, '아이디나 비밀번호가 맞지 않아요.', 'bad_login');
    }
    await env.DB.prepare('DELETE FROM login_attempts WHERE key = ?').bind(keys[0]).run();
    const setCookie = await startSession(env, request, u);
    return json({ ok: true, user: { id: u.id, role: u.role, name: u.name, login_id: u.login_id } }, 200, { 'Set-Cookie': setCookie });
  }

  if (path === '/api/logout' && request.method === 'POST') {
    if (user) await env.DB.prepare('DELETE FROM sessions WHERE token = ?').bind(user.token).run();
    const secure = new URL(request.url).protocol === 'https:';
    return json({ ok: true }, 200, { 'Set-Cookie': cookie(COOKIE, '', { maxAge: 0, secure }) });
  }

  if (path === '/api/me' && request.method === 'GET') {
    if (!user) return json({ user: null });
    let class_name = null;
    if (user.class_id) {
      const c = await env.DB.prepare('SELECT name FROM classes WHERE id = ?').bind(user.class_id).first();
      class_name = c ? c.name : null;
    }
    return json({ user: { id: user.id, role: user.role, name: user.name, login_id: user.login_id, class_id: user.class_id, class_name } });
  }

  if (path === '/api/me/password' && request.method === 'POST') {
    requireRole(user);
    const body = await readJson(request);
    const u = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(user.id).first();
    const ok = safeEqual((await hashPassword(String(body.current || ''), u.pw_salt)).hash, u.pw_hash);
    if (!ok) throw new HttpError(400, '지금 비밀번호가 맞지 않아요.');
    const next = String(body.next || '');
    const min = user.role === 'admin' ? 8 : 4;
    if (next.length < min) throw new HttpError(400, `새 비밀번호는 ${min}자 이상으로 정해 주세요.`);
    const { hash, salt } = await hashPassword(next);
    await env.DB.batch([
      env.DB.prepare('UPDATE users SET pw_hash = ?, pw_salt = ? WHERE id = ?').bind(hash, salt, user.id),
      env.DB.prepare('DELETE FROM sessions WHERE user_id = ? AND token != ?').bind(user.id, user.token),
    ]);
    return json({ ok: true });
  }
  return null;
}
